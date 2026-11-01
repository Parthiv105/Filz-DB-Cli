import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { createDatabasePool, ensureDatabaseExists } from "./db.js";
import { compileCreateTableSQL, escapeId } from "./schemaBuilder.js";
import type { TableDefinition } from "./schemaBuilder.js";
import {
  fetchAllTables,
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
  const isCreateFlag = args.includes("--create") || args.includes("--sync");
  const isAlterFlag = args.includes("--alter");
  const isDeleteFlag = args.includes("--delete") || args.includes("--drop-table");
  const isDryRunFlag = args.includes("--dry-run");
  const isDropFlag = args.includes("--drop");
  const isHardFlag = args.includes("--hard") || args.includes("--hard-alter");
  const isKeepNamesFlag =
    args.includes("--keep-names") ||
    args.includes("--no-rename") ||
    args.includes("--properties-only");
  const isNamesOnlyFlag =
    args.includes("--names-only") || args.includes("--only-names");
  const isIgnoreExistingFlag =
    args.includes("--ignore-existing") || args.includes("--add-only");
  const isNonInteractive =
    args.includes("--yes") ||
    args.includes("-y") ||
    args.includes("--non-interactive") ||
    args.includes("--ci");

  let tableFilter: string[] | null = null;
  const tableArgIdx = args.indexOf("--table");
  if (tableArgIdx !== -1 && args[tableArgIdx + 1]) {
    tableFilter = [args[tableArgIdx + 1]];
  }
  const tablesArgIdx = args.indexOf("--tables");
  if (tablesArgIdx !== -1 && args[tablesArgIdx + 1]) {
    tableFilter = args[tablesArgIdx + 1].split(",").map((s) => s.trim());
  }

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

    const modelFilePath = modelCandidates.find((f) => fs.existsSync(f));

    if (!modelFilePath && !isDeleteFlag) {
      p.log.error(
        `Could not find models registry in project. Checked:\n  - ${modelCandidates.slice(0, 4).join("\n  - ")}\n\nYou can specify a custom path using --models <path>`
      );
      p.outro(pc.red("Exiting..."));
      process.exit(1);
    }

    let models: TableDefinition[] = [];
    if (modelFilePath) {
      const imported = await import(pathToFileURL(modelFilePath).href);
      models = imported.models || [];
    }

    if ((!models || models.length === 0) && !isDeleteFlag) {
      p.log.warn(`No models exported in: ${modelFilePath}`);
      p.outro(pc.dim("Exiting..."));
      process.exit(0);
    }

    // Connect to MariaDB to fetch live tables
    const connSpinner = p.spinner();
    connSpinner.start("Connecting to MariaDB and fetching database tables...");

    await ensureDatabaseExists();
    pool = createDatabasePool();
    const liveTableNames = await fetchAllTables(pool);

    connSpinner.stop(
      `Connected to MariaDB (${liveTableNames.length} table(s) found in database).`
    );

    const isInteractive = !isNonInteractive && Boolean(process.stdin.isTTY);

    // 1. First select mode: create, alter, delete
    let mode: "create" | "alter" | "delete" = isCreateFlag
      ? "create"
      : isDeleteFlag
        ? "delete"
        : "alter";

    if (isInteractive) {
      const selectedMode = await p.select({
        message: "Select an operation mode:",
        initialValue: mode,
        options: [
          {
            value: "create",
            label: "Create",
            hint: "Create non-existing tables in the database",
          },
          {
            value: "alter",
            label: "Alter",
            hint: "Modify existing tables (Zero data loss or hard alter)",
          },
          {
            value: "delete",
            label: "Delete",
            hint: "Drop existing tables from the database",
          },
          {
            value: "exit",
            label: "Exit",
            hint: "Quit CLI without making changes",
          },
        ],
      });

      if (p.isCancel(selectedMode) || selectedMode === "exit") {
        p.cancel("Operation cancelled. Goodbye!");
        process.exit(0);
      }

      mode = selectedMode as "create" | "alter" | "delete";
    }

    // 2. Select table/tables based on mode:
    // - create: only show non-existing tables in db
    // - alter: only show existing tables in db
    // - delete: only show existing tables in db
    let selectedTableNames: string[] = [];

    if (mode === "create") {
      const nonExistingModelTables = models.filter(
        (m) =>
          !liveTableNames.some(
            (lt) => lt.toLowerCase() === m.tableName.toLowerCase()
          )
      );

      if (nonExistingModelTables.length === 0) {
        p.log.info(
          pc.cyan(
            "All model tables already exist in the database! There are no tables to create."
          )
        );
        p.outro(pc.green("Database is up to date."));
        return;
      }

      if (isInteractive) {
        const selected = await p.multiselect({
          message: "Select table(s) to create:",
          options: nonExistingModelTables.map((t) => ({
            value: t.tableName,
            label: t.tableName,
            hint: `${Object.keys(t.columns).length} column(s) defined`,
          })),
          initialValues: nonExistingModelTables.map((t) => t.tableName),
          required: true,
        });

        if (p.isCancel(selected)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        selectedTableNames = selected as string[];
      } else {
        selectedTableNames = tableFilter
          ? nonExistingModelTables
              .filter((t) => tableFilter!.includes(t.tableName))
              .map((t) => t.tableName)
          : nonExistingModelTables.map((t) => t.tableName);
      }
    } else if (mode === "alter") {
      const existingModelTables = models.filter((m) =>
        liveTableNames.some(
          (lt) => lt.toLowerCase() === m.tableName.toLowerCase()
        )
      );

      if (existingModelTables.length === 0) {
        p.log.warn(
          pc.yellow(
            "No model tables exist in the database yet. Use 'Create' mode to create them first."
          )
        );
        p.outro(pc.dim("Exiting..."));
        return;
      }

      if (isInteractive) {
        const selected = await p.multiselect({
          message: "Select table(s) to alter:",
          options: existingModelTables.map((t) => ({
            value: t.tableName,
            label: t.tableName,
            hint: `${Object.keys(t.columns).length} column(s) in model`,
          })),
          initialValues: existingModelTables.map((t) => t.tableName),
          required: true,
        });

        if (p.isCancel(selected)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        selectedTableNames = selected as string[];
      } else {
        selectedTableNames = tableFilter
          ? existingModelTables
              .filter((t) => tableFilter!.includes(t.tableName))
              .map((t) => t.tableName)
          : existingModelTables.map((t) => t.tableName);
      }
    } else if (mode === "delete") {
      if (liveTableNames.length === 0) {
        p.log.warn(pc.yellow("No tables found in the database to delete."));
        p.outro(pc.dim("Exiting..."));
        return;
      }

      if (isInteractive) {
        const selected = await p.multiselect({
          message: "Select table(s) to delete (DROP):",
          options: liveTableNames.map((tbl) => {
            const matchesModel = models.some(
              (m) => m.tableName.toLowerCase() === tbl.toLowerCase()
            );
            return {
              value: tbl,
              label: tbl,
              hint: matchesModel ? "defined in models" : "in database only",
            };
          }),
          required: true,
        });

        if (p.isCancel(selected)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        selectedTableNames = selected as string[];
      } else {
        if (!tableFilter || tableFilter.length === 0) {
          p.log.error(
            "Non-interactive delete requires --table <name> or --tables <list>"
          );
          process.exit(1);
        }
        selectedTableNames = liveTableNames.filter((t) =>
          tableFilter!.includes(t)
        );
      }
    }

    if (selectedTableNames.length === 0) {
      p.log.warn("No tables were selected.");
      p.outro(pc.dim("Exiting..."));
      return;
    }

    // 3. Select related options:
    // hard alter (drop table first and create from scratch) || only alter names || only col property || both
    let alterOption: "both" | "properties" | "names" | "hard" = "both";
    let dropColumns = false;

    if (mode === "alter") {
      if (isInteractive) {
        const selectedAlterOption = await p.select({
          message: "Select alteration method / strategy:",
          initialValue: isHardFlag
            ? "hard"
            : isNamesOnlyFlag
              ? "names"
              : isKeepNamesFlag
                ? "properties"
                : "both",
          options: [
            {
              value: "both",
              label: "Both (Rename & Column Properties)",
              hint: "Smart rename old columns to model names AND update types/properties (Zero Data Loss)",
            },
            {
              value: "properties",
              label: "Only Column Properties",
              hint: "Preserve database column names; only update data types, collations, and defaults",
            },
            {
              value: "names",
              label: "Only Alter Names",
              hint: "Only rename columns to model names; keep existing types and properties unchanged",
            },
            {
              value: "hard",
              label: "Hard Alter (Drop & Recreate)",
              hint: "DROP table first and create fresh from model (Destroys all existing table data!)",
            },
          ],
        });

        if (p.isCancel(selectedAlterOption)) {
          p.cancel("Operation cancelled.");
          process.exit(0);
        }

        alterOption = selectedAlterOption as
          | "both"
          | "properties"
          | "names"
          | "hard";

        if (alterOption !== "hard") {
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
        alterOption = isHardFlag
          ? "hard"
          : isNamesOnlyFlag
            ? "names"
            : isKeepNamesFlag
              ? "properties"
              : "both";
        dropColumns = isDropFlag;
      }
    }

    // 4. Compute changes, display all changes, and confirm from user
    const toCreate: { table: TableDefinition; sql: string }[] = [];
    const toAlter: {
      table: TableDefinition;
      statements: string[];
      descriptions: string[];
      warnings: string[];
    }[] = [];
    const toDelete: { tableName: string; sql: string }[] = [];
    const upToDateTables: string[] = [];

    if (mode === "create") {
      for (const name of selectedTableNames) {
        const table = models.find(
          (m) => m.tableName.toLowerCase() === name.toLowerCase()
        )!;
        toCreate.push({
          table,
          sql: compileCreateTableSQL(table),
        });
      }
    } else if (mode === "alter") {
      if (alterOption === "hard") {
        for (const name of selectedTableNames) {
          const table = models.find(
            (m) => m.tableName.toLowerCase() === name.toLowerCase()
          )!;
          toAlter.push({
            table,
            statements: [
              `DROP TABLE IF EXISTS ${escapeId(table.tableName)};`,
              compileCreateTableSQL(table),
            ],
            descriptions: [
              `! DROP TABLE ${escapeId(table.tableName)} (All existing records will be destroyed)`,
              `+ CREATE TABLE ${escapeId(table.tableName)} fresh from model schema`,
            ],
            warnings: [
              `Hard alter permanently drops table '${table.tableName}' and destroys all its data!`,
            ],
          });
        }
      } else {
        const diffSpinner = p.spinner();
        diffSpinner.start(
          "Analyzing schema differences for selected table(s)..."
        );

        let diffStrategy: ExistingColumnStrategy = "rename";
        if (isIgnoreExistingFlag) {
          diffStrategy = "ignore-existing";
        } else if (alterOption === "properties") {
          diffStrategy = "properties";
        } else if (alterOption === "names") {
          diffStrategy = "names";
        } else {
          diffStrategy = "both";
        }

        for (const name of selectedTableNames) {
          const table = models.find(
            (m) => m.tableName.toLowerCase() === name.toLowerCase()
          )!;
          const liveColumns = await fetchTableColumns(pool, table.tableName);
          const liveIndexes = await fetchTableIndexes(pool, table.tableName);

          const diff = computeTableDiff(table, liveColumns, liveIndexes, {
            dropColumns,
            strategy: diffStrategy,
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

        diffSpinner.stop("Schema diff analysis completed.");
      }
    } else if (mode === "delete") {
      for (const name of selectedTableNames) {
        toDelete.push({
          tableName: name,
          sql: `DROP TABLE IF EXISTS ${escapeId(name)};`,
        });
      }
    }

    const totalChanges =
      toCreate.length +
      toDelete.length +
      toAlter.reduce((acc, curr) => acc + curr.statements.length, 0);

    if (totalChanges === 0) {
      if (upToDateTables.length > 0) {
        p.log.success(
          pc.green(
            `All selected tables are up to date! (${upToDateTables.join(", ")})`
          )
        );
      } else {
        p.log.info(pc.cyan("No changes to perform."));
      }
      p.outro(pc.cyan("Database synchronized!"));
      return;
    }

    const summaryLines: string[] = [];

    if (toCreate.length > 0) {
      summaryLines.push(pc.bold(pc.green("Tables to create:")));
      for (const item of toCreate) {
        summaryLines.push(
          `  + CREATE TABLE ${pc.cyan(item.table.tableName)} (${Object.keys(item.table.columns).length} columns)`
        );
      }
      summaryLines.push("");
    }

    if (toAlter.length > 0) {
      summaryLines.push(
        pc.bold(
          alterOption === "hard"
            ? pc.red("Tables to drop & recreate (Hard Alter):")
            : pc.yellow("Tables to alter:")
        )
      );
      for (const item of toAlter) {
        summaryLines.push(`  Table ${pc.cyan(item.table.tableName)}:`);
        for (const desc of item.descriptions) {
          summaryLines.push(`    ${desc}`);
        }
        for (const warn of item.warnings) {
          summaryLines.push(`    ${pc.red(`[WARN] ${warn}`)}`);
        }
      }
      summaryLines.push("");
    }

    if (toDelete.length > 0) {
      summaryLines.push(pc.bold(pc.red("Tables to delete (DROP):")));
      for (const item of toDelete) {
        summaryLines.push(
          `  - DROP TABLE ${pc.red(pc.bold(item.tableName))} (All data will be permanently deleted)`
        );
      }
      summaryLines.push("");
    }

    if (upToDateTables.length > 0) {
      summaryLines.push(
        pc.dim(`Up to date tables: ${upToDateTables.join(", ")}`)
      );
    }

    p.note(summaryLines.join("\n").trim(), "Proposed Schema Changes");

    const allSqlLines: string[] = [];
    for (const item of toCreate) {
      allSqlLines.push(item.sql);
    }
    for (const item of toAlter) {
      allSqlLines.push(...item.statements);
    }
    for (const item of toDelete) {
      allSqlLines.push(item.sql);
    }

    p.note(allSqlLines.join("\n\n"), "Generated SQL Preview");

    if (isDryRunFlag) {
      p.outro(
        pc.yellow("Dry run complete. No changes were executed in your database.")
      );
      return;
    }

    if (isInteractive) {
      const isDestructive =
        mode === "delete" || alterOption === "hard" || dropColumns;

      const confirmMsg = isDestructive
        ? pc.red(
            pc.bold(
              `Execute ${totalChanges} schema change(s) including DESTRUCTIVE actions in your MariaDB database?`
            )
          )
        : `Execute ${totalChanges} schema change(s) in your live MariaDB database?`;

      const proceed = await p.confirm({
        message: confirmMsg,
        initialValue: !isDestructive,
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Operation cancelled. No changes were applied.");
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
      if (alterOption === "hard") {
        p.log.success(`Dropped and recreated table '${item.table.tableName}'`);
      } else {
        p.log.success(`Altered table '${item.table.tableName}'`);
      }
    }

    for (const item of toDelete) {
      await pool.query(item.sql);
      p.log.success(`Dropped table '${item.tableName}'`);
    }

    execSpinner.stop("All changes successfully executed!");

    p.outro(
      pc.green(
        pc.bold(
          `Success! Executed ${totalChanges} change(s). Database is now in sync!`
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
