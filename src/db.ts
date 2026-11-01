import mariadb from "mariadb";
import type { Connection, ConnectionConfig, Pool, PoolConfig } from "mariadb";

function parseDatabaseUrl(urlStr: string): Partial<PoolConfig> {
  try {
    const url = new URL(urlStr);
    return {
      host: url.hostname || "127.0.0.1",
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username || "root"),
      password: decodeURIComponent(url.password || ""),
      database: url.pathname.replace(/^\//, ""),
      ssl: url.searchParams.get("ssl") === "true",
    };
  } catch {
    return {};
  }
}

export async function ensureDatabaseExists(
  overrideConfig: Partial<PoolConfig> = {}
): Promise<void> {
  let urlConfig: Partial<PoolConfig> = {};
  if (process.env.DATABASE_URL) {
    urlConfig = parseDatabaseUrl(process.env.DATABASE_URL);
  }

  const databaseName =
    overrideConfig.database ||
    urlConfig.database ||
    process.env.DB_NAME ||
    process.env.MARIADB_DATABASE;

  if (!databaseName) {
    return;
  }

  const serverConfig: ConnectionConfig = {
    host:
      overrideConfig.host ||
      urlConfig.host ||
      process.env.DB_HOST ||
      "127.0.0.1",
    port:
      overrideConfig.port ||
      urlConfig.port ||
      (process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306),
    user:
      overrideConfig.user ||
      urlConfig.user ||
      process.env.DB_USER ||
      "root",
    password:
      overrideConfig.password !== undefined
        ? overrideConfig.password
        : urlConfig.password !== undefined
          ? urlConfig.password
          : process.env.DB_PASSWORD || "",
    connectTimeout: 5000,
    bigIntAsNumber: true,
    ...(process.env.DB_SSL === "true" || urlConfig.ssl ? { ssl: true } : {}),
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
  };

  let conn: Connection | undefined;
  try {
    conn = await mariadb.createConnection(serverConfig);
    const safeDbName = databaseName.replace(/`/g, "``");
    const charset = process.env.DB_CHARSET || "utf8mb4";
    const collation = process.env.DB_COLLATION;
    const collateClause = collation ? ` COLLATE ${collation}` : "";

    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET ${charset}${collateClause};`
    );
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

export function createDatabasePool(overrideConfig: Partial<PoolConfig> = {}): Pool {
  let urlConfig: Partial<PoolConfig> = {};
  if (process.env.DATABASE_URL) {
    urlConfig = parseDatabaseUrl(process.env.DATABASE_URL);
  }

  const databaseName =
    overrideConfig.database ||
    urlConfig.database ||
    process.env.DB_NAME ||
    process.env.MARIADB_DATABASE;

  if (!databaseName) {
    throw new Error(
      "Database name is not defined. Please set DB_NAME or DATABASE_URL in your environment."
    );
  }

  const config: PoolConfig = {
    host:
      overrideConfig.host ||
      urlConfig.host ||
      process.env.DB_HOST ||
      "127.0.0.1",
    port:
      overrideConfig.port ||
      urlConfig.port ||
      (process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306),
    user:
      overrideConfig.user ||
      urlConfig.user ||
      process.env.DB_USER ||
      "root",
    password:
      overrideConfig.password !== undefined
        ? overrideConfig.password
        : urlConfig.password !== undefined
          ? urlConfig.password
          : process.env.DB_PASSWORD || "",
    database: databaseName,
    connectTimeout: 5000,
    bigIntAsNumber: true,
    ...(process.env.DB_SSL === "true" || urlConfig.ssl ? { ssl: true } : {}),
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
    ...overrideConfig,
  };

  return mariadb.createPool(config);
}
