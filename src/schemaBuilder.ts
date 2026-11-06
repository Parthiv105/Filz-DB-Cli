export type DataType =
  | "INT"
  | "BIGINT"
  | "TINYINT"
  | "SMALLINT"
  | "MEDIUMINT"
  | "VARCHAR"
  | "CHAR"
  | "TEXT"
  | "TINYTEXT"
  | "MEDIUMTEXT"
  | "LONGTEXT"
  | "BINARY"
  | "VARBINARY"
  | "BLOB"
  | "TINYBLOB"
  | "MEDIUMBLOB"
  | "LONGBLOB"
  | "DECIMAL"
  | "FLOAT"
  | "DOUBLE"
  | "DATE"
  | "DATETIME"
  | "TIMESTAMP"
  | "TIME"
  | "YEAR"
  | "ENUM"
  | "JSON"
  | "UUID"
  | "CUSTOM";

export type DefaultValueRaw = string | number | boolean | Date | null;
export type DefaultValueFn = () => DefaultValueRaw;
export type DefaultValue = DefaultValueRaw | DefaultValueFn;

export type ReferentialAction =
  | "CASCADE"
  | "RESTRICT"
  | "SET NULL"
  | "NO ACTION"
  | "cascade"
  | "restrict"
  | "set null"
  | "no action";

export interface ForeignKeyConfig {
  table: string;
  column?: string; // Defaults to "Id" or target table's primary key
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  constraintName?: string;
}

export type ReferenceInput = string | ForeignKeyConfig;

export interface ColumnDefinition {
  type: DataType;
  customType?: string;
  length?: number | string;
  enumValues?: string[];
  nullable: boolean;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isUnique: boolean;
  isUnsigned?: boolean;
  charset?: string;
  collation?: string;
  defaultValue?: DefaultValue;
  onUpdate?: string;
  comment?: string;
  renamedFrom?: string;
  keepName?: boolean;
  ignoreExisting?: boolean;
  foreignKey?: ForeignKeyConfig;
}

export class ColumnBuilder {
  def: ColumnDefinition;

  constructor(type: DataType, length?: number | string) {
    this.def = {
      type,
      length,
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      isUnique: false,
    };
  }

  notNull() {
    this.def.nullable = false;
    return this;
  }

  nullable() {
    this.def.nullable = true;
    return this;
  }

  primaryKey() {
    this.def.isPrimaryKey = true;
    this.def.nullable = false;
    return this;
  }

  autoIncrement() {
    this.def.isAutoIncrement = true;
    return this;
  }

  unique() {
    this.def.isUnique = true;
    return this;
  }

  unsigned() {
    this.def.isUnsigned = true;
    return this;
  }

  charset(charsetName: string) {
    this.def.charset = charsetName;
    return this;
  }

  collate(collationName: string) {
    this.def.collation = collationName;
    return this;
  }

  collation(collationName: string) {
    this.def.collation = collationName;
    return this;
  }

  caseSensitive() {
    this.def.collation = "utf8mb4_bin";
    return this;
  }

  default(val: DefaultValue) {
    this.def.defaultValue = val;
    return this;
  }

  onUpdate(sql: string) {
    this.def.onUpdate = sql;
    return this;
  }

  onUpdateCurrentTimestamp() {
    this.def.onUpdate = "CURRENT_TIMESTAMP";
    return this;
  }

  comment(txt: string) {
    this.def.comment = txt;
    return this;
  }

  from(oldColumnName: string) {
    this.def.renamedFrom = oldColumnName;
    return this;
  }

  renamedFrom(oldColumnName: string) {
    this.def.renamedFrom = oldColumnName;
    return this;
  }

  keepName() {
    this.def.keepName = true;
    return this;
  }

  ignoreExisting() {
    this.def.ignoreExisting = true;
    return this;
  }

  ref(
    tableOrConfig: string | ForeignKeyConfig,
    columnOrOptions?:
      | string
      | {
          onDelete?: ReferentialAction;
          onUpdate?: ReferentialAction;
          name?: string;
          constraintName?: string;
        },
    options?: {
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
      name?: string;
      constraintName?: string;
    }
  ): this {
    if (typeof tableOrConfig === "object" && tableOrConfig !== null) {
      const onDel = (
        (tableOrConfig.onDelete || "RESTRICT") as string
      ).toUpperCase() as ReferentialAction;
      const onUpd = (
        (tableOrConfig.onUpdate || "CASCADE") as string
      ).toUpperCase() as ReferentialAction;
      this.def.foreignKey = {
        table: tableOrConfig.table,
        column: tableOrConfig.column || "Id",
        onDelete: onDel,
        onUpdate: onUpd,
        constraintName: tableOrConfig.constraintName,
      };
      return this;
    }

    const table = tableOrConfig;
    let column = "Id";
    let opts: {
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
      name?: string;
      constraintName?: string;
    } = {};

    if (typeof columnOrOptions === "string") {
      column = columnOrOptions;
      if (options) opts = options;
    } else if (typeof columnOrOptions === "object" && columnOrOptions !== null) {
      opts = columnOrOptions;
    }

    const onDel = ((opts.onDelete || "RESTRICT") as string).toUpperCase() as ReferentialAction;
    const onUpd = ((opts.onUpdate || "CASCADE") as string).toUpperCase() as ReferentialAction;

    this.def.foreignKey = {
      table,
      column,
      onDelete: onDel,
      onUpdate: onUpd,
      constraintName: opts.name || opts.constraintName,
    };
    return this;
  }

  references(
    tableOrConfig: string | ForeignKeyConfig,
    columnOrOptions?:
      | string
      | {
          onDelete?: ReferentialAction;
          onUpdate?: ReferentialAction;
          name?: string;
          constraintName?: string;
        },
    options?: {
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
      name?: string;
      constraintName?: string;
    }
  ): this {
    return this.ref(tableOrConfig, columnOrOptions, options);
  }
}

export const col = {
  int: () => new ColumnBuilder("INT"),
  bigint: () => new ColumnBuilder("BIGINT"),
  tinyint: (length = 1) => new ColumnBuilder("TINYINT", length),
  boolean: () => new ColumnBuilder("TINYINT", 1),
  smallint: () => new ColumnBuilder("SMALLINT"),
  mediumint: () => new ColumnBuilder("MEDIUMINT"),
  varchar: (length = 255) => new ColumnBuilder("VARCHAR", length),
  char: (length = 1) => new ColumnBuilder("CHAR", length),
  binary: (length = 16) => new ColumnBuilder("BINARY", length),
  varbinary: (length = 255) => new ColumnBuilder("VARBINARY", length),
  apiKey: (length = 64) =>
    new ColumnBuilder("VARCHAR", length).caseSensitive(),
  text: () => new ColumnBuilder("TEXT"),
  tinytext: () => new ColumnBuilder("TINYTEXT"),
  mediumtext: () => new ColumnBuilder("MEDIUMTEXT"),
  longtext: () => new ColumnBuilder("LONGTEXT"),
  blob: () => new ColumnBuilder("BLOB"),
  tinyblob: () => new ColumnBuilder("TINYBLOB"),
  mediumblob: () => new ColumnBuilder("MEDIUMBLOB"),
  longblob: () => new ColumnBuilder("LONGBLOB"),
  json: () => new ColumnBuilder("JSON"),
  uuid: () => new ColumnBuilder("UUID"),
  decimal: (precision = 10, scale = 2) =>
    new ColumnBuilder("DECIMAL", `${precision}, ${scale}`),
  float: () => new ColumnBuilder("FLOAT"),
  double: () => new ColumnBuilder("DOUBLE"),
  date: () => new ColumnBuilder("DATE"),
  datetime: () => new ColumnBuilder("DATETIME"),
  timestamp: () => new ColumnBuilder("TIMESTAMP"),
  time: () => new ColumnBuilder("TIME"),
  year: () => new ColumnBuilder("YEAR"),
  enum: (values: string[]) => {
    const builder = new ColumnBuilder("ENUM");
    builder.def.enumValues = values;
    return builder;
  },
  custom: (sqlType: string) => {
    const builder = new ColumnBuilder("CUSTOM");
    builder.def.customType = sqlType;
    return builder;
  },
};

export interface TableOptions {
  timestamps?: boolean | { createdAt?: string; updatedAt?: string };
  engine?: string;
  charset?: string;
  collation?: string;
  comment?: string;
}

export type SupportedType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | ObjectConstructor
  | ArrayConstructor
  | DataType
  | "string"
  | "varchar"
  | "number"
  | "int"
  | "integer"
  | "bigint"
  | "smallint"
  | "tinyint"
  | "boolean"
  | "bool"
  | "date"
  | "datetime"
  | "timestamp"
  | "apiKey"
  | "apikey"
  | "uuid"
  | "json"
  | "text"
  | "tinytext"
  | "mediumtext"
  | "longtext"
  | "blob"
  | "tinyblob"
  | "mediumblob"
  | "longblob"
  | "decimal"
  | "float"
  | "double"
  | "enum"
  | any[];

export interface FieldOptions {
  type: SupportedType;
  length?: number | string;
  maxlength?: number | string;
  size?: number | string;
  precision?: number;
  scale?: number;
  required?: boolean;
  nullable?: boolean;
  primaryKey?: boolean;
  primary?: boolean;
  id?: boolean;
  autoIncrement?: boolean;
  auto?: boolean;
  unique?: boolean;
  unsigned?: boolean;
  default?: DefaultValue;
  defaultValue?: DefaultValue;
  enum?: string[];
  enumValues?: string[];
  charset?: string;
  collate?: string;
  collation?: string;
  caseSensitive?: boolean;
  comment?: string;
  from?: string;
  renamedFrom?: string;
  keepName?: boolean;
  ignoreExisting?: boolean;
  onUpdate?: string;
  onUpdateCurrentTimestamp?: boolean;
  customType?: string;
  text?: boolean;
  ref?: ReferenceInput;
  references?: ReferenceInput;
}

export type FieldDefinitionInput =
  | ColumnBuilder
  | FieldOptions
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | ObjectConstructor
  | ArrayConstructor
  | DataType
  | any[];

export const Types = {
  String,
  Number,
  Boolean,
  Date,
  Buffer,
  Array,
  Object,
  ObjectId: "UUID" as const,
  UUID: "UUID" as const,
  Mixed: "JSON" as const,
  JSON: "JSON" as const,
  ApiKey: "apiKey" as const,
  Int: "INT" as const,
  BigInt: "BIGINT" as const,
  TinyInt: "TINYINT" as const,
  Text: "TEXT" as const,
  LongText: "LONGTEXT" as const,
  Decimal: "DECIMAL" as const,
  Float: "FLOAT" as const,
  Double: "DOUBLE" as const,
};

export class Schema {
  fields: Record<string, FieldDefinitionInput>;
  options: TableOptions;

  static Types = Types;

  constructor(
    fields: Record<string, FieldDefinitionInput>,
    options: TableOptions = {}
  ) {
    this.fields = fields;
    this.options = options;
  }
}

export function normalizeFieldDefinition(
  input: FieldDefinitionInput,
  columnName?: string,
  tableName?: string
): ColumnDefinition {
  if (input instanceof ColumnBuilder) {
    if (
      columnName &&
      tableName &&
      input.def.foreignKey &&
      !input.def.foreignKey.constraintName
    ) {
      input.def.foreignKey.constraintName = `fk_${tableName}_${columnName}_${input.def.foreignKey.table}`;
    }
    return input.def;
  }

  // Handle direct constructor primitives
  if (input === String) {
    return new ColumnBuilder("VARCHAR", 255).def;
  }
  if (input === Number) {
    return new ColumnBuilder("INT").def;
  }
  if (input === Boolean) {
    return new ColumnBuilder("TINYINT", 1).def;
  }
  if (input === Date) {
    return new ColumnBuilder("DATETIME").def;
  }
  if (input === Object) {
    return new ColumnBuilder("JSON").def;
  }
  if (input === Array || Array.isArray(input)) {
    return new ColumnBuilder("JSON").def;
  }
  if (typeof Buffer !== "undefined" && (input as any) === Buffer) {
    return new ColumnBuilder("BLOB").def;
  }

  // Handle string data types like "INT" or "VARCHAR"
  if (typeof input === "string") {
    const upper = input.toUpperCase();
    if (upper === "APIKEY") {
      return new ColumnBuilder("VARCHAR", 64).caseSensitive().def;
    }
    return new ColumnBuilder(upper as DataType).def;
  }

  // Handle FieldOptions object: { type: ... }
  if (typeof input === "object" && input !== null) {
    const opts = input as FieldOptions;
    const typeVal = opts.type;
    let length: number | string | undefined =
      opts.length ?? opts.maxlength ?? opts.size;
    let baseType: DataType = "VARCHAR";
    let isApiKey = false;
    const customType = opts.customType;
    const enumValues: string[] | undefined = opts.enum ?? opts.enumValues;

    if (Array.isArray(typeVal)) {
      baseType = "JSON";
    } else if (typeVal === String) {
      if (opts.text || length === "text" || (typeof length === "number" && length > 65535)) {
        baseType = "TEXT";
        length = undefined;
      } else {
        baseType = "VARCHAR";
        length = length ?? 255;
      }
    } else if (typeVal === Number) {
      if (opts.precision !== undefined && opts.scale !== undefined) {
        baseType = "DECIMAL";
        length = `${opts.precision}, ${opts.scale}`;
      } else {
        baseType = "INT";
      }
    } else if (typeVal === Boolean) {
      baseType = "TINYINT";
      length = 1;
    } else if (typeVal === Date) {
      baseType = "DATETIME";
    } else if (typeVal === Object) {
      baseType = "JSON";
    } else if (typeVal === Array) {
      baseType = "JSON";
    } else if (typeof Buffer !== "undefined" && (typeVal as any) === Buffer) {
      baseType = "BLOB";
    } else if (typeof typeVal === "string") {
      const lower = typeVal.toLowerCase();
      if (lower === "apikey") {
        baseType = "VARCHAR";
        length = length ?? 64;
        isApiKey = true;
      } else if (lower === "string" || lower === "varchar") {
        baseType = "VARCHAR";
        length = length ?? 255;
      } else if (lower === "int" || lower === "integer" || lower === "number") {
        baseType = "INT";
      } else if (lower === "bigint") {
        baseType = "BIGINT";
      } else if (lower === "smallint") {
        baseType = "SMALLINT";
      } else if (lower === "tinyint") {
        baseType = "TINYINT";
        length = length ?? 1;
      } else if (lower === "boolean" || lower === "bool") {
        baseType = "TINYINT";
        length = 1;
      } else if (lower === "date") {
        baseType = "DATE";
      } else if (lower === "datetime") {
        baseType = "DATETIME";
      } else if (lower === "timestamp") {
        baseType = "TIMESTAMP";
      } else if (lower === "text") {
        baseType = "TEXT";
      } else if (lower === "longtext") {
        baseType = "LONGTEXT";
      } else if (lower === "mediumtext") {
        baseType = "MEDIUMTEXT";
      } else if (lower === "tinytext") {
        baseType = "TINYTEXT";
      } else if (lower === "blob") {
        baseType = "BLOB";
      } else if (lower === "uuid" || lower === "objectid") {
        baseType = "UUID";
      } else if (lower === "json" || lower === "mixed") {
        baseType = "JSON";
      } else if (lower === "decimal") {
        baseType = "DECIMAL";
        if (opts.precision !== undefined && opts.scale !== undefined) {
          length = `${opts.precision}, ${opts.scale}`;
        } else {
          length = length ?? "10, 2";
        }
      } else if (lower === "float") {
        baseType = "FLOAT";
      } else if (lower === "double") {
        baseType = "DOUBLE";
      } else if (lower === "enum") {
        baseType = "ENUM";
      } else {
        baseType = typeVal.toUpperCase() as DataType;
      }
    }

    const isPrimaryKey = Boolean(opts.primaryKey || opts.primary || opts.id);
    const isAutoIncrement = Boolean(opts.autoIncrement || opts.auto);
    const isUnique = Boolean(opts.unique);
    const isUnsigned = Boolean(opts.unsigned);

    let nullable = true;
    if (isPrimaryKey) {
      nullable = false;
    } else if (opts.required !== undefined) {
      nullable = !opts.required;
    } else if (opts.nullable !== undefined) {
      nullable = opts.nullable;
    }

    let collation = opts.collation ?? opts.collate;
    if (isApiKey || opts.caseSensitive) {
      collation = "utf8mb4_bin";
    }

    let onUpdate = opts.onUpdate;
    if (opts.onUpdateCurrentTimestamp) {
      onUpdate = "CURRENT_TIMESTAMP";
    }

    let defaultValue =
      opts.default !== undefined ? opts.default : opts.defaultValue;

    if (typeof defaultValue === "function") {
      try {
        defaultValue = (defaultValue as DefaultValueFn)();
      } catch {
        // keep callback
      }
    }

    const refInput = opts.ref !== undefined ? opts.ref : opts.references;
    let foreignKey: ForeignKeyConfig | undefined;

    if (refInput) {
      if (typeof refInput === "string") {
        foreignKey = {
          table: refInput,
          column: "Id",
          onDelete: "RESTRICT",
          onUpdate: "CASCADE",
          constraintName:
            columnName && tableName
              ? `fk_${tableName}_${columnName}_${refInput}`
              : undefined,
        };
      } else if (typeof refInput === "object" && refInput !== null) {
        const onDel = (
          (refInput.onDelete || "RESTRICT") as string
        ).toUpperCase() as ReferentialAction;
        const onUpd = (
          (refInput.onUpdate || "CASCADE") as string
        ).toUpperCase() as ReferentialAction;
        foreignKey = {
          table: refInput.table,
          column: refInput.column || "Id",
          onDelete: onDel,
          onUpdate: onUpd,
          constraintName:
            refInput.constraintName ||
            (columnName && tableName
              ? `fk_${tableName}_${columnName}_${refInput.table}`
              : undefined),
        };
      }
    }

    return {
      type: baseType,
      customType,
      length,
      enumValues,
      nullable,
      isPrimaryKey,
      isAutoIncrement,
      isUnique,
      isUnsigned: isUnsigned ? true : undefined,
      charset: opts.charset,
      collation,
      defaultValue,
      onUpdate,
      comment: opts.comment,
      renamedFrom: opts.from ?? opts.renamedFrom,
      keepName: opts.keepName,
      ignoreExisting: opts.ignoreExisting,
      foreignKey,
    };
  }

  return new ColumnBuilder("VARCHAR", 255).def;
}

export interface TableDefinition {
  tableName: string;
  columns: Record<string, ColumnDefinition>;
  options?: TableOptions;
}

export const TABLE_REGISTRY = new Map<string, TableDefinition>();

export function resolveForeignKeyReferences(tables: TableDefinition[]): void {
  for (const t of tables) {
    TABLE_REGISTRY.set(t.tableName.toLowerCase(), t);
  }

  for (const table of tables) {
    for (const [colName, colDef] of Object.entries(table.columns)) {
      if (colDef.foreignKey) {
        const targetTableName = colDef.foreignKey.table;
        const targetTable = TABLE_REGISTRY.get(targetTableName.toLowerCase());

        if (targetTable) {
          const targetCols = targetTable.columns;
          const pkEntry = Object.entries(targetCols).find(
            ([_, def]) => def.isPrimaryKey
          );

          if (
            !colDef.foreignKey.column ||
            (colDef.foreignKey.column === "Id" && !targetCols["Id"])
          ) {
            if (pkEntry) {
              colDef.foreignKey.column = pkEntry[0];
            } else if (targetCols["UID"]) {
              colDef.foreignKey.column = "UID";
            } else if (targetCols["uid"]) {
              colDef.foreignKey.column = "uid";
            } else if (targetCols["id"]) {
              colDef.foreignKey.column = "id";
            }
          }
        }
      }
    }
  }
}

export function defineTable(
  tableName: string,
  schemaOrColumns: Record<string, FieldDefinitionInput> | Schema,
  options?: TableOptions
): TableDefinition {
  const fields =
    schemaOrColumns instanceof Schema
      ? schemaOrColumns.fields
      : schemaOrColumns;

  const mergedOptions: TableOptions = {
    ...(schemaOrColumns instanceof Schema ? schemaOrColumns.options : {}),
    ...(options || {}),
  };

  const columns: Record<string, ColumnDefinition> = {};
  for (const key of Object.keys(fields)) {
    const colDef = normalizeFieldDefinition(fields[key], key, tableName);
    if (colDef.foreignKey) {
      if (!colDef.foreignKey.column) {
        colDef.foreignKey.column = "Id";
      }
      if (!colDef.foreignKey.onDelete) {
        colDef.foreignKey.onDelete = "RESTRICT";
      }
      if (!colDef.foreignKey.onUpdate) {
        colDef.foreignKey.onUpdate = "CASCADE";
      }
      if (!colDef.foreignKey.constraintName) {
        colDef.foreignKey.constraintName = `fk_${tableName}_${key}_${colDef.foreignKey.table}`;
      }
    }
    columns[key] = colDef;
  }

  // Handle timestamps: true (Mongoose-style)
  if (mergedOptions.timestamps) {
    const keys = Object.keys(columns);
    const hasPascalCase = keys.some((k) => /^[A-Z]/.test(k));

    let createdKey = hasPascalCase ? "CreatedAt" : "createdAt";
    let updatedKey = hasPascalCase ? "UpdatedAt" : "updatedAt";

    if (typeof mergedOptions.timestamps === "object") {
      if (mergedOptions.timestamps.createdAt) {
        createdKey = mergedOptions.timestamps.createdAt;
      }
      if (mergedOptions.timestamps.updatedAt) {
        updatedKey = mergedOptions.timestamps.updatedAt;
      }
    }

    if (!columns[createdKey]) {
      columns[createdKey] = new ColumnBuilder("TIMESTAMP")
        .default("CURRENT_TIMESTAMP")
        .def;
    }

    if (!columns[updatedKey]) {
      columns[updatedKey] = new ColumnBuilder("TIMESTAMP")
        .default("CURRENT_TIMESTAMP")
        .onUpdateCurrentTimestamp()
        .def;
    }
  }

  const tableDef: TableDefinition = { tableName, columns, options: mergedOptions };
  TABLE_REGISTRY.set(tableName.toLowerCase(), tableDef);
  resolveForeignKeyReferences([tableDef]);
  return tableDef;
}

// Aliases matching Mongoose / MongoDB convention
export const defineModel = defineTable;
export const createModel = defineTable;
export const model = defineTable;

export function escapeId(identifier: string): string {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

export function escapeLiteral(val: string): string {
  return `'${val.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export function formatDateToMySQL(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatDefaultSQL(rawVal: DefaultValue | undefined): string {
  if (rawVal === undefined) return "";

  let val = rawVal;
  if (typeof val === "function") {
    try {
      val = (val as DefaultValueFn)();
    } catch {
      return "";
    }
  }

  if (val === null) {
    return "DEFAULT NULL";
  }

  if (val instanceof Date) {
    return `DEFAULT '${formatDateToMySQL(val)}'`;
  }

  if (typeof val === "boolean") {
    return `DEFAULT ${val ? 1 : 0}`;
  }

  if (typeof val === "number") {
    return `DEFAULT ${val}`;
  }

  if (typeof val === "string") {
    const trimmed = val.trim();
    const upper = trimmed.toUpperCase();

    // Standard unquoted SQL expressions & keywords
    const unquotedKeywords = [
      "CURRENT_TIMESTAMP",
      "CURRENT_TIMESTAMP()",
      "NOW()",
      "NOW(6)",
      "NULL",
      "TRUE",
      "FALSE",
      "UUID()",
      "CURDATE()",
      "CURRENT_DATE",
      "CURRENT_DATE()",
      "CURTIME()",
      "CURRENT_TIME",
      "CURRENT_TIME()",
      "UTC_TIMESTAMP",
      "UTC_TIMESTAMP()",
      "UTC_DATE",
      "UTC_DATE()",
      "UTC_TIME",
      "UTC_TIME()",
    ];

    if (
      unquotedKeywords.includes(upper) ||
      upper.startsWith("CURRENT_TIMESTAMP") ||
      (trimmed.startsWith("(") && trimmed.endsWith(")"))
    ) {
      const cleanSQL =
        upper === "CURRENT_TIMESTAMP()" ? "CURRENT_TIMESTAMP" : upper;
      return `DEFAULT ${cleanSQL}`;
    }

    return `DEFAULT ${escapeLiteral(val)}`;
  }

  return `DEFAULT ${escapeLiteral(String(val))}`;
}

export function compileColumnSQL(name: string, column: ColumnDefinition): string {
  let typeSQL = column.customType || column.type;

  if (!column.customType) {
    if (column.type === "ENUM" && column.enumValues) {
      const escaped = column.enumValues.map((val) => escapeLiteral(val)).join(", ");
      typeSQL = `ENUM(${escaped})`;
    } else if (column.type === "JSON") {
      typeSQL = "LONGTEXT";
    } else if (column.length !== undefined) {
      typeSQL = `${column.type}(${column.length})`;
    }
  }

  if (column.isUnsigned) {
    typeSQL += " UNSIGNED";
  }

  if (column.charset) {
    typeSQL += ` CHARACTER SET ${column.charset.replace(/[^a-zA-Z0-9_]/g, "")}`;
  }

  if (column.collation) {
    typeSQL += ` COLLATE ${column.collation.replace(/[^a-zA-Z0-9_]/g, "")}`;
  }

  const nullSQL = column.nullable ? "NULL" : "NOT NULL";
  const autoIncSQL = column.isAutoIncrement ? "AUTO_INCREMENT" : "";
  const defaultSQL = formatDefaultSQL(column.defaultValue);

  const onUpdateSQL = column.onUpdate ? `ON UPDATE ${column.onUpdate}` : "";
  const commentSQL = column.comment
    ? `COMMENT ${escapeLiteral(column.comment)}`
    : "";

  return [
    escapeId(name),
    typeSQL,
    nullSQL,
    defaultSQL,
    onUpdateSQL,
    autoIncSQL,
    commentSQL,
  ]
    .filter(Boolean)
    .join(" ");
}

export function compileForeignKeyConstraint(
  tableName: string,
  colName: string,
  fk: ForeignKeyConfig
): string {
  const cName = fk.constraintName || `fk_${tableName}_${colName}_${fk.table}`;
  const targetCol = fk.column || "Id";
  const onDel = ((fk.onDelete || "RESTRICT") as string).toUpperCase();
  const onUpd = ((fk.onUpdate || "CASCADE") as string).toUpperCase();
  return `CONSTRAINT ${escapeId(cName)} FOREIGN KEY (${escapeId(colName)}) REFERENCES ${escapeId(fk.table)} (${escapeId(targetCol)}) ON DELETE ${onDel} ON UPDATE ${onUpd}`;
}

export function compileAddForeignKeySQL(
  tableName: string,
  colName: string,
  fk: ForeignKeyConfig
): string {
  return `ALTER TABLE ${escapeId(tableName)} ADD ${compileForeignKeyConstraint(tableName, colName, fk)};`;
}

export function compileDropForeignKeySQL(
  tableName: string,
  constraintName: string
): string {
  return `ALTER TABLE ${escapeId(tableName)} DROP FOREIGN KEY ${escapeId(constraintName)};`;
}

export function compileCreateTableSQL(
  table: TableDefinition,
  options?: { includeForeignKeys?: boolean }
): string {
  const includeFKs = options?.includeForeignKeys !== false;
  const colLines: string[] = [];
  const primaryKeys: string[] = [];
  const uniqueKeys: { name: string; col: string }[] = [];
  const foreignKeys: string[] = [];

  for (const colName of Object.keys(table.columns)) {
    const colDef = table.columns[colName];
    colLines.push(`  ${compileColumnSQL(colName, colDef)}`);

    if (colDef.isPrimaryKey) {
      primaryKeys.push(escapeId(colName));
    }

    if (colDef.isUnique) {
      uniqueKeys.push({ name: `uq_${table.tableName}_${colName}`, col: colName });
    }

    if (includeFKs && colDef.foreignKey) {
      foreignKeys.push(
        `  ${compileForeignKeyConstraint(table.tableName, colName, colDef.foreignKey)}`
      );
    }
  }

  if (primaryKeys.length > 0) {
    colLines.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  }

  for (const uq of uniqueKeys) {
    colLines.push(`  UNIQUE KEY ${escapeId(uq.name)} (${escapeId(uq.col)})`);
  }

  for (const fkSQL of foreignKeys) {
    colLines.push(fkSQL);
  }

  const engine = table.options?.engine || "InnoDB";
  const charset = table.options?.charset || "utf8mb4";
  const collation = table.options?.collation || "utf8mb4_unicode_ci";
  const comment = table.options?.comment
    ? ` COMMENT=${escapeLiteral(table.options.comment)}`
    : "";

  return `CREATE TABLE IF NOT EXISTS ${escapeId(table.tableName)} (\n${colLines.join(
    ",\n"
  )}\n) ENGINE=${engine} DEFAULT CHARSET=${charset} COLLATE=${collation}${comment};`;
}

