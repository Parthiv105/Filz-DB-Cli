import { compileColumnSQL, escapeId } from "./schemaBuilder.js";
import type { ColumnDefinition, TableDefinition } from "./schemaBuilder.js";
import type { LiveColumnInfo, LiveIndexInfo } from "./schemaInspector.js";

export type ExistingColumnStrategy = "rename" | "keep-names" | "ignore-existing";

export interface DiffOptions {
  dropColumns?: boolean;
  strategy?: ExistingColumnStrategy;
  keepNames?: boolean;
  ignoreExisting?: boolean;
}

export interface TableDiffResult {
  tableName: string;
  statements: string[];
  descriptions: string[];
  warnings: string[];
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
    const modelDefaultStr =
      modelDef.defaultValue === null
        ? null
        : typeof modelDef.defaultValue === "boolean"
          ? modelDef.defaultValue
            ? "1"
            : "0"
          : String(modelDef.defaultValue);

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
  options: DiffOptions = {}
): TableDiffResult {
  const statements: string[] = [];
  const descriptions: string[] = [];
  const warnings: string[] = [];

  const modelColEntries = Object.entries(table.columns);
  const liveColNames = Object.keys(liveColumns);
  const matchedLiveCols = new Set<string>();

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

      const shouldKeepName =
        options.keepNames ||
        options.strategy === "keep-names" ||
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

      if (!isIgnoring) {
        const targetColName =
          (options.keepNames || options.strategy === "keep-names" || def.keepName) && matchedLiveName
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

  return {
    tableName: table.tableName,
    statements,
    descriptions,
    warnings,
  };
}

