import {
  compileColumnSQL,
  escapeId,
  formatDateToMySQL,
  compileAddForeignKeySQL,
  compileDropForeignKeySQL,
} from "./schemaBuilder.js";
import type {
  ColumnDefinition,
  TableDefinition,
  ForeignKeyConfig,
} from "./schemaBuilder.js";
import type {
  LiveColumnInfo,
  LiveIndexInfo,
  LiveForeignKeyInfo,
} from "./schemaInspector.js";

export type ExistingColumnStrategy =
  | "both"
  | "rename"
  | "properties"
  | "keep-names"
  | "names"
  | "only-names"
  | "ignore-existing";

export interface DiffOptions {
  dropColumns?: boolean;
  strategy?: ExistingColumnStrategy;
  keepNames?: boolean;
  ignoreExisting?: boolean;
  namesOnly?: boolean;
  liveForeignKeys?: LiveForeignKeyInfo[];
}

export interface TableDiffResult {
  tableName: string;
  statements: string[];
  descriptions: string[];
  warnings: string[];
  dropForeignKeyStatements: string[];
  addForeignKeyStatements: string[];
}

const COMMON_ALIASES: Record<string, string[]> = {
  image: ["profile_picture", "profile_image", "avatar", "photo", "picture", "user_image", "img"],
  name: ["full_name", "fullname", "display_name", "user_name", "username"],
  email: ["email_address", "user_email", "mail"],
  phone: ["mobile", "phone_number", "contact_number", "telephone"],
  password: ["pass", "pwd", "password_hash"],
  api_key: ["apikey", "api_token", "token", "secret", "secret_key"],
  created_at: ["creation_date", "created_date", "registered_at"],
  updated_at: ["modification_date", "modified_at", "last_updated"],
};

function normalizeName(str: string): string {
  return str.toLowerCase().replace(/[_\-\s]+/g, "");
}

function normalizeType(typeStr: string): string {
  return typeStr
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/int\(\d+\)/g, "int")
    .replace(/tinyint\(1\)/g, "tinyint(1)")
    .replace(/bigint\(\d+\)/g, "bigint");
}

function normalizeDefault(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().toLowerCase();
  if (s.startsWith("current_timestamp")) return "current_timestamp";
  return s;
}

function isColumnDifferent(
  modelDef: ColumnDefinition,
  liveCol: LiveColumnInfo
): boolean {
  if (modelDef.nullable !== liveCol.nullable) {
    return true;
  }

  const modelAutoInc = modelDef.isAutoIncrement;
  const liveAutoInc = liveCol.extra.includes("auto_increment");
  if (modelAutoInc !== liveAutoInc) {
    return true;
  }

  const isModelUnsigned = Boolean(modelDef.isUnsigned);
  const isLiveUnsigned = liveCol.columnType.includes("unsigned");
  if (isModelUnsigned !== isLiveUnsigned) {
    return true;
  }

  let modelTypeStr = (modelDef.customType || modelDef.type).toLowerCase();
  if (!modelDef.customType) {
    if (modelDef.length !== undefined) {
      modelTypeStr = `${modelDef.type.toLowerCase()}(${modelDef.length})`;
    } else if (modelDef.type === "ENUM" && modelDef.enumValues) {
      const vals = modelDef.enumValues.map((v) => `'${v}'`).join(",");
      modelTypeStr = `enum(${vals})`;
    } else if (modelDef.type === "JSON") {
      modelTypeStr = "longtext";
    }
  }

  const normModel = normalizeType(modelTypeStr);
  const normLive = normalizeType(liveCol.columnType);

  if (normModel !== normLive) {
    return true;
  }

  // Check Collation (e.g. utf8mb4_uca1400_ai_ci or utf8mb4_bin)
  if (modelDef.collation && liveCol.collation) {
    if (modelDef.collation.toLowerCase() !== liveCol.collation.toLowerCase()) {
      return true;
    }
  }

  // Check Character Set
  if (modelDef.charset && liveCol.charset) {
    if (modelDef.charset.toLowerCase() !== liveCol.charset.toLowerCase()) {
      return true;
    }
  }

  if (modelDef.defaultValue !== undefined) {
    let rawVal = modelDef.defaultValue;
    if (typeof rawVal === "function") {
      try {
        rawVal = rawVal();
      } catch {
        // ignore
      }
    }

    const modelDefaultStr =
      rawVal === null
        ? null
        : typeof rawVal === "boolean"
          ? rawVal
            ? "1"
            : "0"
          : rawVal instanceof Date
            ? formatDateToMySQL(rawVal)
            : String(rawVal);

    if (normalizeDefault(modelDefaultStr) !== normalizeDefault(liveCol.defaultValue)) {
      return true;
    }
  }

  return false;
}

export function computeTableDiff(
  table: TableDefinition,
  liveColumns: Record<string, LiveColumnInfo>,
  liveIndexes: LiveIndexInfo[],
  options: DiffOptions = {},
  liveForeignKeys?: LiveForeignKeyInfo[]
): TableDiffResult {
  const statements: string[] = [];
  const descriptions: string[] = [];
  const warnings: string[] = [];

  const modelColEntries = Object.entries(table.columns);
  const liveColNames = Object.keys(liveColumns);
  const matchedLiveCols = new Set<string>();
  const modelToLiveColMap = new Map<string, string>();

  for (const [modelName, def] of modelColEntries) {
    let matchedLiveName: string | null = null;

    if (def.renamedFrom) {
      const explicitMatch = liveColNames.find(
        (name) =>
          name.toLowerCase() === def.renamedFrom?.toLowerCase() &&
          !matchedLiveCols.has(name)
      );
      if (explicitMatch) {
        matchedLiveName = explicitMatch;
      }
    }

    if (!matchedLiveName && liveColumns[modelName] && !matchedLiveCols.has(modelName)) {
      matchedLiveName = modelName;
    }

    if (!matchedLiveName) {
      const caseMatch = liveColNames.find(
        (name) =>
          name.toLowerCase() === modelName.toLowerCase() &&
          !matchedLiveCols.has(name)
      );
      if (caseMatch) {
        matchedLiveName = caseMatch;
      }
    }

    if (!matchedLiveName) {
      const normModel = normalizeName(modelName);
      const normMatch = liveColNames.find(
        (name) =>
          normalizeName(name) === normModel &&
          !matchedLiveCols.has(name)
      );
      if (normMatch) {
        matchedLiveName = normMatch;
      }
    }

    if (!matchedLiveName) {
      const aliases = COMMON_ALIASES[modelName.toLowerCase()] || [];
      const aliasMatch = liveColNames.find((name) => {
        if (matchedLiveCols.has(name)) return false;
        const normLive = normalizeName(name);
        return aliases.some((a) => normalizeName(a) === normLive);
      });
      if (aliasMatch) {
        matchedLiveName = aliasMatch;
      }
    }

    if (matchedLiveName) {
      matchedLiveCols.add(matchedLiveName);
      modelToLiveColMap.set(modelName, matchedLiveName);
      const liveCol = liveColumns[matchedLiveName];

      const shouldIgnore =
        options.ignoreExisting ||
        options.strategy === "ignore-existing" ||
        def.ignoreExisting;

      if (shouldIgnore) {
        descriptions.push(
          `= Ignored existing column '${matchedLiveName}' (left untouched)`
        );
        continue;
      }

      const isNamesOnly =
        options.namesOnly ||
        options.strategy === "names" ||
        options.strategy === "only-names";

      if (isNamesOnly) {
        if (matchedLiveName !== modelName) {
          statements.push(
            `ALTER TABLE ${escapeId(table.tableName)} RENAME COLUMN ${escapeId(matchedLiveName)} TO ${escapeId(modelName)};`
          );
          descriptions.push(
            `~ Rename column '${matchedLiveName}' -> '${modelName}' (properties unchanged)`
          );
        }
        continue;
      }

      const shouldKeepName =
        options.keepNames ||
        options.strategy === "keep-names" ||
        options.strategy === "properties" ||
        def.keepName;

      if (matchedLiveName !== modelName && !shouldKeepName) {
        statements.push(
          `ALTER TABLE ${escapeId(table.tableName)} CHANGE COLUMN ${escapeId(matchedLiveName)} ${compileColumnSQL(modelName, def)};`
        );
        descriptions.push(
          `~ Rename column '${matchedLiveName}' -> '${modelName}' (${def.type}) [data preserved]`
        );
      } else {
        const targetColName = shouldKeepName ? matchedLiveName : modelName;

        if (isColumnDifferent(def, liveCol)) {
          statements.push(
            `ALTER TABLE ${escapeId(table.tableName)} MODIFY COLUMN ${compileColumnSQL(targetColName, def)};`
          );
          descriptions.push(
            shouldKeepName && matchedLiveName !== modelName
              ? `~ Keep name '${matchedLiveName}' & update properties (${def.type})`
              : `~ Modify column '${targetColName}' (${def.type})`
          );
        }
      }
    } else {
      statements.push(
        `ALTER TABLE ${escapeId(table.tableName)} ADD COLUMN ${compileColumnSQL(modelName, def)};`
      );
      descriptions.push(`+ Add column '${modelName}' (${def.type})`);
    }

    if (def.isUnique) {
      const isIgnoring =
        options.ignoreExisting ||
        options.strategy === "ignore-existing" ||
        def.ignoreExisting;

      const isNamesOnly =
        options.namesOnly ||
        options.strategy === "names" ||
        options.strategy === "only-names";

      if (!isIgnoring && !isNamesOnly) {
        const targetColName =
          (options.keepNames ||
            options.strategy === "keep-names" ||
            options.strategy === "properties" ||
            def.keepName) &&
          matchedLiveName
            ? matchedLiveName
            : modelName;

        const hasUnique = liveIndexes.some(
          (idx) =>
            idx.columnName.toLowerCase() === targetColName.toLowerCase() &&
            Number(idx.nonUnique) === 0
        );

        if (!hasUnique) {
          statements.push(
            `ALTER TABLE ${escapeId(table.tableName)} ADD UNIQUE KEY ${escapeId(`uq_${table.tableName}_${targetColName}`)} (${escapeId(targetColName)});`
          );
          descriptions.push(`+ Add unique constraint on '${targetColName}'`);
        }
      }
    }
  }

  for (const liveName of liveColNames) {
    if (!matchedLiveCols.has(liveName)) {
      if (options.dropColumns) {
        statements.push(
          `ALTER TABLE ${escapeId(table.tableName)} DROP COLUMN ${escapeId(liveName)};`
        );
        descriptions.push(`- Drop column '${liveName}'`);
      } else {
        warnings.push(
          `Column '${liveName}' exists in database but not in model (use --drop to remove it)`
        );
      }
    }
  }

  // --- Foreign Key Diffs ---
  const actualLiveFKs = liveForeignKeys || options.liveForeignKeys || [];
  const dropForeignKeyStatements: string[] = [];
  const addForeignKeyStatements: string[] = [];
  const fkDescriptions: string[] = [];
  const matchedLiveFKNames = new Set<string>();

  for (const [modelName, def] of modelColEntries) {
    if (def.foreignKey) {
      const fk = def.foreignKey;
      const targetTable = fk.table;
      const targetCol = fk.column || "Id";
      const onDel = ((fk.onDelete || "RESTRICT") as string).toUpperCase();
      const onUpd = ((fk.onUpdate || "CASCADE") as string).toUpperCase();
      const constraintName =
        fk.constraintName || `fk_${table.tableName}_${modelName}_${targetTable}`;

      const matchedLiveCol = modelToLiveColMap.get(modelName);

      const matchingLive = actualLiveFKs.find(
        (lfk) =>
          lfk.constraintName.toLowerCase() === constraintName.toLowerCase() ||
          lfk.columnName.toLowerCase() === modelName.toLowerCase() ||
          (matchedLiveCol &&
            lfk.columnName.toLowerCase() === matchedLiveCol.toLowerCase()) ||
          (def.renamedFrom &&
            lfk.columnName.toLowerCase() === def.renamedFrom.toLowerCase())
      );

      if (matchingLive) {
        matchedLiveFKNames.add(matchingLive.constraintName.toLowerCase());

        const sameTable =
          matchingLive.referencedTable.toLowerCase() === targetTable.toLowerCase();
        const sameColumn =
          matchingLive.referencedColumn.toLowerCase() === targetCol.toLowerCase();
        const sameDelete = matchingLive.onDelete.toUpperCase() === onDel;
        const sameUpdate = matchingLive.onUpdate.toUpperCase() === onUpd;

        if (!sameTable || !sameColumn || !sameDelete || !sameUpdate) {
          dropForeignKeyStatements.push(
            compileDropForeignKeySQL(table.tableName, matchingLive.constraintName)
          );
          addForeignKeyStatements.push(
            compileAddForeignKeySQL(table.tableName, modelName, {
              ...fk,
              constraintName,
            })
          );
          fkDescriptions.push(
            `~ Update foreign key on '${modelName}': ${matchingLive.referencedTable}(${matchingLive.referencedColumn}) [${matchingLive.onDelete}/${matchingLive.onUpdate}] -> ${targetTable}(${targetCol}) [${onDel}/${onUpd}]`
          );
        }
      } else {
        addForeignKeyStatements.push(
          compileAddForeignKeySQL(table.tableName, modelName, {
            ...fk,
            constraintName,
          })
        );
        fkDescriptions.push(
          `+ Add foreign key '${constraintName}' on '${modelName}' -> ${targetTable}(${targetCol}) [ON DELETE ${onDel} ON UPDATE ${onUpd}]`
        );
      }
    }
  }

  // Check for foreign keys present in live DB but removed from model
  for (const liveFK of actualLiveFKs) {
    if (!matchedLiveFKNames.has(liveFK.constraintName.toLowerCase())) {
      const colInModel = modelColEntries.find(
        ([cName, cDef]) =>
          cName.toLowerCase() === liveFK.columnName.toLowerCase() ||
          cDef.renamedFrom?.toLowerCase() === liveFK.columnName.toLowerCase() ||
          (modelToLiveColMap.get(cName)?.toLowerCase() ===
            liveFK.columnName.toLowerCase())
      );

      if (colInModel) {
        // Column exists in model, but does NOT have a foreignKey definition (ref removed)
        dropForeignKeyStatements.push(
          compileDropForeignKeySQL(table.tableName, liveFK.constraintName)
        );
        fkDescriptions.push(
          `- Drop foreign key '${liveFK.constraintName}' on '${liveFK.columnName}' (removed from model)`
        );
      } else if (options.dropColumns) {
        // Column is being dropped, drop foreign key constraint first
        dropForeignKeyStatements.push(
          compileDropForeignKeySQL(table.tableName, liveFK.constraintName)
        );
        fkDescriptions.push(
          `- Drop foreign key '${liveFK.constraintName}' on dropped column '${liveFK.columnName}'`
        );
      } else {
        warnings.push(
          `Foreign key '${liveFK.constraintName}' exists on unmanaged column '${liveFK.columnName}' (use --drop to remove)`
        );
      }
    }
  }

  return {
    tableName: table.tableName,
    statements: [
      ...dropForeignKeyStatements,
      ...statements,
      ...addForeignKeyStatements,
    ],
    descriptions: [...descriptions, ...fkDescriptions],
    warnings,
    dropForeignKeyStatements,
    addForeignKeyStatements,
  };
}

