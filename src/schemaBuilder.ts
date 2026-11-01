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
  defaultValue?: string | number | boolean | null;
  onUpdate?: string;
  comment?: string;
  renamedFrom?: string;
  keepName?: boolean;
  ignoreExisting?: boolean;
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

  default(val: string | number | boolean | null) {
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

export interface TableDefinition {
  tableName: string;
  columns: Record<string, ColumnDefinition>;
}

export function defineTable(
  tableName: string,
  columnsConfig: Record<string, ColumnBuilder>
): TableDefinition {
  const columns: Record<string, ColumnDefinition> = {};
  for (const key of Object.keys(columnsConfig)) {
    columns[key] = columnsConfig[key].def;
  }
  return { tableName, columns };
}

export function escapeId(identifier: string): string {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

export function escapeLiteral(val: string): string {
  return `'${val.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
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

  let defaultSQL = "";
  if (column.defaultValue !== undefined) {
    if (column.defaultValue === null) {
      defaultSQL = "DEFAULT NULL";
    } else if (typeof column.defaultValue === "string") {
      const upper = column.defaultValue.toUpperCase();
      if (
        upper === "CURRENT_TIMESTAMP" ||
        upper === "CURRENT_TIMESTAMP()" ||
        upper === "NOW()" ||
        upper === "NULL"
      ) {
        defaultSQL = `DEFAULT ${upper.replace("()", "")}`;
      } else {
        defaultSQL = `DEFAULT ${escapeLiteral(column.defaultValue)}`;
      }
    } else if (typeof column.defaultValue === "boolean") {
      defaultSQL = `DEFAULT ${column.defaultValue ? 1 : 0}`;
    } else {
      defaultSQL = `DEFAULT ${Number(column.defaultValue)}`;
    }
  }

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

export function compileCreateTableSQL(table: TableDefinition): string {
  const colLines: string[] = [];
  const primaryKeys: string[] = [];
  const uniqueKeys: { name: string; col: string }[] = [];

  for (const colName of Object.keys(table.columns)) {
    const colDef = table.columns[colName];
    colLines.push(`  ${compileColumnSQL(colName, colDef)}`);

    if (colDef.isPrimaryKey) {
      primaryKeys.push(escapeId(colName));
    }

    if (colDef.isUnique) {
      uniqueKeys.push({ name: `uq_${table.tableName}_${colName}`, col: colName });
    }
  }

  if (primaryKeys.length > 0) {
    colLines.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  }

  for (const uq of uniqueKeys) {
    colLines.push(`  UNIQUE KEY ${escapeId(uq.name)} (${escapeId(uq.col)})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${escapeId(table.tableName)} (\n${colLines.join(
    ",\n"
  )}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
}

