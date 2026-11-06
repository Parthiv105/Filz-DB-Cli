export interface LiveColumnInfo {
  name: string;
  columnType: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  extra: string;
  key: string;
  collation: string | null;
  charset: string | null;
}

export interface LiveIndexInfo {
  indexName: string;
  columnName: string;
  nonUnique: number;
}

export interface LiveForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface DatabaseExecutor {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<T>;
}

export async function fetchAllTables(
  db: DatabaseExecutor
): Promise<string[]> {
  const rows = await db.query<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE != 'VIEW' ORDER BY TABLE_NAME"
  );
  return (rows || []).map((r) => r.TABLE_NAME);
}

export async function checkTableExists(
  db: DatabaseExecutor,
  tableName: string
): Promise<boolean> {
  const rows = await db.query<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return Boolean(rows && rows.length > 0);
}

export async function fetchTableColumns(
  db: DatabaseExecutor,
  tableName: string
): Promise<Record<string, LiveColumnInfo>> {
  const rows = await db.query<
    Array<{
      COLUMN_NAME: string;
      COLUMN_TYPE: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      EXTRA: string;
      COLUMN_KEY: string;
      COLLATION_NAME: string | null;
      CHARACTER_SET_NAME: string | null;
    }>
  >(
    `SELECT 
      COLUMN_NAME, 
      COLUMN_TYPE, 
      DATA_TYPE, 
      IS_NULLABLE, 
      COLUMN_DEFAULT, 
      EXTRA, 
      COLUMN_KEY,
      COLLATION_NAME,
      CHARACTER_SET_NAME
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? 
    ORDER BY ORDINAL_POSITION`,
    [tableName]
  );

  const result: Record<string, LiveColumnInfo> = {};

  for (const row of rows) {
    result[row.COLUMN_NAME] = {
      name: row.COLUMN_NAME,
      columnType: row.COLUMN_TYPE.toLowerCase(),
      dataType: row.DATA_TYPE.toLowerCase(),
      nullable: row.IS_NULLABLE.toUpperCase() === "YES",
      defaultValue: row.COLUMN_DEFAULT,
      extra: (row.EXTRA || "").toLowerCase(),
      key: (row.COLUMN_KEY || "").toUpperCase(),
      collation: row.COLLATION_NAME,
      charset: row.CHARACTER_SET_NAME,
    };
  }

  return result;
}

export async function fetchTableIndexes(
  db: DatabaseExecutor,
  tableName: string
): Promise<LiveIndexInfo[]> {
  const rows = await db.query<
    Array<{
      INDEX_NAME: string;
      COLUMN_NAME: string;
      NON_UNIQUE: number;
    }>
  >(
    `SELECT 
      INDEX_NAME, 
      COLUMN_NAME, 
      NON_UNIQUE 
    FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return rows.map((r) => ({
    indexName: r.INDEX_NAME,
    columnName: r.COLUMN_NAME,
    nonUnique: Number(r.NON_UNIQUE),
  }));
}

export async function fetchTableForeignKeys(
  db: DatabaseExecutor,
  tableName: string,
  databaseName?: string
): Promise<LiveForeignKeyInfo[]> {
  const schemaCondition = databaseName
    ? "kcu.TABLE_SCHEMA = ?"
    : "kcu.TABLE_SCHEMA = DATABASE()";
  const params = databaseName ? [databaseName, tableName] : [tableName];

  const query = `SELECT 
    kcu.CONSTRAINT_NAME as constraintName,
    kcu.COLUMN_NAME as columnName,
    kcu.REFERENCED_TABLE_NAME as referencedTable,
    kcu.REFERENCED_COLUMN_NAME as referencedColumn,
    rc.DELETE_RULE as onDelete,
    rc.UPDATE_RULE as onUpdate
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc 
    ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME 
    AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
  WHERE ${schemaCondition} AND kcu.TABLE_NAME = ?
    AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY kcu.ORDINAL_POSITION`;

  const rows = await db.query<any[]>(query, params);

  return (rows || []).map((r) => ({
    constraintName: String(r.constraintName ?? r.CONSTRAINT_NAME ?? ""),
    columnName: String(r.columnName ?? r.COLUMN_NAME ?? ""),
    referencedTable: String(r.referencedTable ?? r.REFERENCED_TABLE_NAME ?? ""),
    referencedColumn: String(r.referencedColumn ?? r.REFERENCED_COLUMN_NAME ?? ""),
    onDelete: String(r.onDelete ?? r.DELETE_RULE ?? "RESTRICT").toUpperCase(),
    onUpdate: String(r.onUpdate ?? r.UPDATE_RULE ?? "CASCADE").toUpperCase(),
  }));
}

