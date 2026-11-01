import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { createDatabasePool } from "./db.js";
import { compileCreateTableSQL } from "./schemaBuilder.js";
import type { TableDefinition } from "./schemaBuilder.js";
import {
  checkTableExists,
  fetchTableColumns,
  fetchTableIndexes,
} from "./schemaInspector.js";
import { computeTableDiff } from "./schemaDiff.js";
import type { ExistingColumnStrategy } from "./schemaDiff.js";

export async function runCli(): Promise<void> {
  const cwd = process.cwd();

  // Load .env from target project directory
  const envPath = path.resolve(cwd, ".env");
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // ignore
    }
  }

  const args = process.argv.slice(2);
  const isAlterFlag = args.includes("--alter");
  const isDryRunFlag = args.includes("--dry-run");
  const isDropFlag = args.includes("--drop");
  const isKeepNamesFlag =
    args.includes("--keep-names") || args.includes("--no-rename");
  const isIgnoreExistingFlag =
    args.includes("--ignore-existing") || args.includes("--add-only");
  const isNonInteractive =
    args.includes("--yes") ||
    args.includes("-y") ||
    args.includes("--non-interactive") ||
    args.includes("--ci");

  let pool: ReturnType<typeof createDatabasePool> | null = null;
  let hasError = false;

  try {
    p.intro(pc.bgCyan(pc.black(" DB Modeler CLI ")));

    // Discover models in project directory
    const modelCandidates: string[] = [
      path.resolve(cwd, "src/Utils/Database/MariaDB/index.ts"),
      path.resolve(cwd, "src/Utils/Database/MariaDB/index.js"),
      path.resolve(cwd, "src/Utils/Database/MariaDB/models.ts"),
      path.resolve(cwd, "src/Utils/Database/MariaDB/models.js"),
      path.resolve(cwd, "src/database/index.ts"),
      path.resolve(cwd, "src/database/index.js"),
      path.resolve(cwd, "src/models/index.ts"),
      path.resolve(cwd, "src/models/index.js"),
      path.resolve(cwd, "src/db/index.ts"),
      path.resolve(cwd, "src/db/index.js"),
    ];

    const modelsFlagIdx = args.indexOf("--models");
    if (modelsFlagIdx !== -1 && args[modelsFlagIdx + 1]) {
      modelCandidates.unshift(path.resolve(cwd, args[modelsFlagIdx + 1]));
    }

    let modelFilePath = modelCandidates.find((f) => fs.existsSync(f));

    if (!modelFilePath) {
      p.log.error(
        `Could not find models registry in project. Checked:\n  - ${modelCandidates.slice(0, 4).join("\n  - ")}\n\nYou can specify custom path using --models <path>`
      );
      p.outro(pc.red("Exiting..."));
      process.exit(1);
    }

    const imported = await import(pathToFileURL(modelFilePath).href);
    const models: TableDefinition[] = imported.models || [];

    if (!models || models.length === 0) {
      p.log.warn(`No models exported in: ${modelFilePath}`);
      p.outro(pc.dim("Exiting..."));
      process.exit(0);
    }

    const isInteractive = !isNonInteractive && Boolean(process.stdin.isTTY);

    let action: "alter" | "sync" | "dry-run" | "exit" = "alter";
    let strategy: ExistingColumnStrategy = "rename";
    let dropColumns = false;

    if (isInteractive) {
      const selectedAction = await p.select({
        message: "What action would you like to perform?",
        initialValue: isAlterFlag ? "alter" : isDryRunFlag ? "dry-run" : "alter",
        options: [
          {
            value: "alter",
            label: "Alter Tables",
            hint: "Update existing schemas, rename or add columns (recommended)",
          },
          {
            value: "sync",
            label: "Create Missing Tables",
            hint: "Only create missing tables without altering existing ones",
          },
          {
            value: "dry-run",
            label: "Dry Run",
            hint: "Preview SQL statements without modifying live database",
          },
          {
            value: "exit",
            label: "Exit",
            hint: "Quit CLI without making changes",
          },
        ],
      });

      if (p.isCancel(selectedAction) || selectedAction === "exit") {
        p.cancel("Operation cancelled. Goodbye!");
        process.exit(0);
      }

      action = selectedAction as "alter" | "sync" | "dry-run" | "exit";

      if (action === "alter" || action === "dry-run") {
        const selectedStrategy = await p.select({
          message: "How should existing columns be handled?",
          initialValue: isIgnoreExistingFlag
            ? "ignore-existing"
            : isKeepNamesFlag
              ? "keep-names"
              : "rename",
          options: [
            {
              value: "rename",
              label: "Rename & Update (Zero Data Loss)",
              hint: "Smart rename old columns to model names, update types/collations",
            },
            {
              value: "keep-names",
              label: "Keep Old Column Names",
              hint: "Preserve database column names, only update types/collations",
            },
            {
              value: "ignore-existing",
              label: "Ignore Existing Columns",
              hint: "Leave all existing columns untouched; only add new columns",
            },
          ],
        });

        if (p.isCancel(selectedStrategy)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        strategy = selectedStrategy as ExistingColumnStrategy;

        const selectedDrop = await p.select({
          message: "Drop extra database columns not present in your models?",
          initialValue: isDropFlag,
          options: [
            {
              value: false,
              label: "No (Safe)",
              hint: "Keep extra database columns untouched",
            },
            {
              value: true,
              label: "Yes (Caution)",
              hint: "Drop columns from DB that are not defined in models",
            },
          ],
        });

        if (p.isCancel(selectedDrop)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        dropColumns = selectedDrop as boolean;
      }
    } else {
      action = isDryRunFlag ? "dry-run" : isAlterFlag ? "alter" : "sync";
      strategy = isIgnoreExistingFlag
        ? "ignore-existing"
        : isKeepNamesFlag
          ? "keep-names"
          : "rename";
      dropColumns = isDropFlag;
    }

    const s = p.spinner();
    s.start("Connecting to MariaDB and analyzing live schemas...");

    pool = createDatabasePool();

    const toCreate: { table: TableDefinition; sql: string }[] = [];
    const toAlter: {
      table: TableDefinition;
      statements: string[];
      descriptions: string[];
      warnings: string[];
    }[] = [];
    const upToDateTables: string[] = [];
    const skippedExistingTables: string[] = [];

    for (const table of models) {
      const exists = await checkTableExists(pool, table.tableName);

      if (!exists) {
        const createSQL = compileCreateTableSQL(table);
        toCreate.push({ table, sql: createSQL });
        continue;
      }

      if (action === "sync") {
        skippedExistingTables.push(table.tableName);
        continue;
      }

      const liveColumns = await fetchTableColumns(pool, table.tableName);
      const liveIndexes = await fetchTableIndexes(pool, table.tableName);

      const diff = computeTableDiff(table, liveColumns, liveIndexes, {
        dropColumns,
        strategy,
      });

      if (diff.statements.length > 0) {
        toAlter.push({
          table,
          statements: diff.statements,
          descriptions: diff.descriptions,
          warnings: diff.warnings,
        });
      } else {
        upToDateTables.push(table.tableName);
      }
    }

    s.stop("Schema analysis completed.");

    if (toCreate.length === 0 && toAlter.length === 0) {
      p.log.success(
        pc.green(
          `All tables are up to date! (${models.map((m) => m.tableName).join(", ")})`
        )
      );
      p.outro(pc.cyan("Database synchronized!"));
      return;
    }

    const summaryLines: string[] = [];

    if (toCreate.length > 0) {
      summaryLines.push(pc.bold(pc.green("Tables to create:")));
      for (const item of toCreate) {
        summaryLines.push(`  + CREATE TABLE ${pc.cyan(item.table.tableName)}`);
      }
      summaryLines.push("");
    }

    if (toAlter.length > 0) {
      summaryLines.push(pc.bold(pc.yellow("Tables to alter:")));
      for (const item of toAlter) {
        summaryLines.push(`  Table ${pc.cyan(item.table.tableName)}:`);
        for (const desc of item.descriptions) {
          summaryLines.push(`    ${desc}`);
        }
        for (const warn of item.warnings) {
          summaryLines.push(`    ${pc.yellow(`[WARN] ${warn}`)}`);
        }
      }
      summaryLines.push("");
    }

    if (upToDateTables.length > 0) {
      summaryLines.push(
        pc.dim(`Up to date tables: ${upToDateTables.join(", ")}`)
      );
    }

    if (skippedExistingTables.length > 0) {
      summaryLines.push(
        pc.dim(
          `Existing tables skipped (sync mode): ${skippedExistingTables.join(", ")}`
        )
      );
    }

    p.note(summaryLines.join("\n").trim(), "Proposed Schema Changes");

    if (action === "dry-run") {
      const sqlLines: string[] = [];
      for (const item of toCreate) {
        sqlLines.push(item.sql);
      }
      for (const item of toAlter) {
        sqlLines.push(...item.statements);
      }

      p.note(sqlLines.join("\n\n"), "Generated SQL (Dry Run)");
      p.outro(
        pc.yellow("Dry run complete. No changes were executed in your database.")
      );
      return;
    }

    const totalChanges =
      toCreate.length +
      toAlter.reduce((acc, curr) => acc + curr.statements.length, 0);

    if (isInteractive) {
      const proceed = await p.confirm({
        message: `Execute ${totalChanges} schema change(s) in your live MariaDB database?`,
        initialValue: true,
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Migration cancelled. No changes were applied.");
        process.exit(0);
      }
    }

    const execSpinner = p.spinner();
    execSpinner.start("Applying schema changes to MariaDB...");

    for (const item of toCreate) {
      await pool.query(item.sql);
      p.log.success(`Created table '${item.table.tableName}'`);
    }

    for (const item of toAlter) {
      for (const sql of item.statements) {
        await pool.query(sql);
      }
      p.log.success(`Altered table '${item.table.tableName}'`);
    }

    execSpinner.stop("All changes successfully executed!");

    p.outro(
      pc.green(
        pc.bold(
          `Success! ${toCreate.length} created, ${toAlter.length} altered. Database is now in sync!`
        )
      )
    );
  } catch (error: unknown) {
    hasError = true;
    const err = error as { message?: string; cause?: { message?: string } };
    const errMsg = err.cause?.message || err.message || String(error);

    p.log.error(pc.red(`Migration failed: ${errMsg}`));

    if (errMsg.includes("auth_gssapi_client")) {
      p.note(
        "MariaDB on Windows requested GSSAPI (Windows Domain) authentication.\nNode.js MariaDB drivers require standard password authentication.\n\nTo resolve this, run this query in HeidiSQL or DataGrip:\n  ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('your_password');\n  FLUSH PRIVILEGES;\n\nOr create a dedicated app user and set DB_USER / DB_PASSWORD in your .env file.",
        "Authentication Troubleshooting"
      );
    }
  } finally {
    try {
      if (pool) {
        await pool.end();
      }
    } catch {
      // ignore
    }
    process.exit(hasError ? 1 : 0);
  }
}

