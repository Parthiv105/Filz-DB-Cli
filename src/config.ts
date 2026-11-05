import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { PoolConfig } from "mariadb";
import type { TableDefinition, TableOptions } from "./schemaBuilder.js";
import type { ExistingColumnStrategy } from "./schemaDiff.js";

export interface DatabaseConfigOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  url?: string;
  ssl?: boolean;
  socketPath?: string;
  connectTimeout?: number;
}

export interface ModelerConfig {
  /**
   * Table models imported from anywhere, or path/glob pattern to model files.
   *
   * @example
   * ```ts
   * models: [usersTable, ordersTable]
   * // or
   * models: { usersTable, ordersTable }
   * // or
   * models: "./src/models/*.ts"
   * ```
   */
  models:
    | TableDefinition
    | TableDefinition[]
    | Record<string, unknown>
    | string
    | string[];

  /**
   * Database connection configuration or connection URL.
   */
  database?: DatabaseConfigOptions | string;

  /**
   * Path to custom .env file (defaults to .env in project root).
   */
  envPath?: string;

  /**
   * Default strategy for altering existing columns ("both", "properties", "names", "ignore-existing").
   */
  strategy?: ExistingColumnStrategy;

  /**
   * Whether to drop extra database columns not present in models.
   */
  dropColumns?: boolean;

  /**
   * Global table options (e.g. timestamps, engine, charset, collation).
   */
  tableOptions?: TableOptions;
}

export type ModelerConfigFn = () => ModelerConfig | Promise<ModelerConfig>;
export type ModelerConfigInput = ModelerConfig | ModelerConfigFn;

/**
 * Type-safe configuration helper for modaler.config.ts
 *
 * @example
 * ```ts
 * import { withModaler } from "@bossdev/db-modeler";
 * import { usersTable } from "./src/models/users.js";
 *
 * export default withModaler({
 *   models: [usersTable],
 * });
 * ```
 */
export function withModaler(config: ModelerConfigInput): ModelerConfigInput {
  return config;
}

export const withModeler = withModaler;
export const defineConfig = withModaler;

export function isTableDefinition(obj: unknown): obj is TableDefinition {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "tableName" in obj &&
    typeof (obj as TableDefinition).tableName === "string" &&
    "columns" in obj &&
    typeof (obj as TableDefinition).columns === "object" &&
    (obj as TableDefinition).columns !== null
  );
}

export function extractTablesFromModule(mod: unknown): TableDefinition[] {
  if (!mod || typeof mod !== "object") return [];

  const found: TableDefinition[] = [];

  // Check mod.models
  if ("models" in mod) {
    const m = (mod as { models: unknown }).models;
    if (Array.isArray(m)) {
      found.push(...m.filter(isTableDefinition));
    } else if (isTableDefinition(m)) {
      found.push(m);
    } else if (typeof m === "object" && m !== null) {
      found.push(...Object.values(m).filter(isTableDefinition));
    }
  }

  // Check mod.default
  if ("default" in mod) {
    const d = (mod as { default: unknown }).default;
    if (Array.isArray(d)) {
      found.push(...d.filter(isTableDefinition));
    } else if (isTableDefinition(d)) {
      found.push(d);
    } else if (typeof d === "object" && d !== null) {
      found.push(...Object.values(d).filter(isTableDefinition));
    }
  }

  // Check named exports
  for (const [key, val] of Object.entries(mod)) {
    if (key === "models" || key === "default") continue;
    if (isTableDefinition(val)) {
      found.push(val);
    } else if (Array.isArray(val)) {
      found.push(...val.filter(isTableDefinition));
    }
  }

  // Deduplicate by tableName
  const unique: TableDefinition[] = [];
  const seen = new Set<string>();
  for (const t of found) {
    const norm = t.tableName.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      unique.push(t);
    }
  }

  return unique;
}

export function findConfigFile(cwd: string, explicitPath?: string): string | null {
  // 1. Explicit path from --config
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath);
    if (fs.existsSync(resolved)) return resolved;
  }

  // 2. Check package.json for "modaler" or "modeler" field
  try {
    const pkgPath = path.resolve(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const pkgConfig = pkg.modaler ?? pkg.modeler ?? pkg["db-modeler"];
      if (typeof pkgConfig === "string") {
        const resolved = path.resolve(cwd, pkgConfig);
        if (fs.existsSync(resolved)) return resolved;
      } else if (typeof pkgConfig === "object" && pkgConfig?.config) {
        const resolved = path.resolve(cwd, pkgConfig.config);
        if (fs.existsSync(resolved)) return resolved;
      }
    }
  } catch {
    // ignore
  }

  // 3. Fast direct check in common locations
  const configNames = [
    "modaler.config.ts",
    "modaler.config.js",
    "modaler.config.mjs",
    "modaler.config.cjs",
    "modeler.config.ts",
    "modeler.config.js",
    "modeler.config.mjs",
    "modeler.config.cjs",
    "db-modeler.config.ts",
    "db-modeler.config.js",
    "db-modeler.config.mjs",
  ];

  const searchDirs = [
    cwd,
    path.join(cwd, "src"),
    path.join(cwd, "config"),
    path.join(cwd, "src", "config"),
    path.join(cwd, "src", "database"),
    path.join(cwd, "src", "db"),
    path.join(cwd, "src", "Utils", "Database", "MariaDB"),
    path.join(cwd, "src", "Utils", "Database"),
    path.join(cwd, "database"),
    path.join(cwd, "db"),
  ];

  for (const dir of searchDirs) {
    for (const name of configNames) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // 4. Recursive search anywhere in the project tree
  return findConfigAnywhere(cwd);
}

function findConfigAnywhere(dir: string, depth = 0): string | null {
  if (depth > 6) return null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const subdirs: string[] = [];

    // First scan files in current directory
    for (const entry of entries) {
      if (entry.isFile()) {
        if (
          /^(modaler|modeler|db-modeler)\.config\.(ts|js|mjs|cjs)$/i.test(
            entry.name
          )
        ) {
          return path.join(dir, entry.name);
        }
      } else if (entry.isDirectory()) {
        const dName = entry.name.toLowerCase();
        if (
          !dName.startsWith(".") &&
          dName !== "node_modules" &&
          dName !== "dist" &&
          dName !== "build" &&
          dName !== ".git" &&
          dName !== "out" &&
          dName !== "coverage"
        ) {
          subdirs.push(path.join(dir, entry.name));
        }
      }
    }

    // Then recurse into subdirectories
    for (const sub of subdirs) {
      const found = findConfigAnywhere(sub, depth + 1);
      if (found) return found;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function loadConfigFile(
  configFilePath: string
): Promise<ModelerConfig> {
  const configUrl = pathToFileURL(configFilePath).href;
  const imported = await import(configUrl);

  const rawConfig = imported.default ?? imported.config ?? imported;
  const resolved =
    typeof rawConfig === "function" ? await rawConfig() : rawConfig;

  return resolved as ModelerConfig;
}

function matchFiles(pattern: string, cwd: string, baseDir?: string): string[] {
  // Check relative to baseDir (config directory) first
  if (baseDir) {
    const directBase = path.resolve(baseDir, pattern);
    if (fs.existsSync(directBase)) {
      return [directBase];
    }
  }

  // Check relative to cwd (project root)
  const directPath = path.resolve(cwd, pattern);
  if (fs.existsSync(directPath)) {
    return [directPath];
  }

  const cleanPattern = pattern.replace(/^\.\//, "").replace(/\\/g, "/");
  const regexPattern = new RegExp(
    "^" +
      cleanPattern
        .replace(/\./g, "\\.")
        .replace(/\*\*\//g, "(?:.*/)?")
        .replace(/\*/g, "[^/]*") +
      "$"
  );

  const matched: string[] = [];
  const dirsToSearch = baseDir && baseDir !== cwd ? [baseDir, cwd] : [cwd];

  for (const searchDir of dirsToSearch) {
    try {
      const allFiles = fs.readdirSync(searchDir, { recursive: true });
      for (const f of allFiles) {
        if (typeof f !== "string") continue;
        const normalized = f.replace(/\\/g, "/");
        if (regexPattern.test(normalized)) {
          const fullPath = path.resolve(searchDir, f);
          if (!matched.includes(fullPath)) {
            matched.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return matched;
}

export async function resolveModelsFromConfig(
  modelsOption: ModelerConfig["models"],
  cwd: string,
  configDir?: string
): Promise<TableDefinition[]> {
  if (!modelsOption) return [];

  // 1. Single TableDefinition
  if (isTableDefinition(modelsOption)) {
    return [modelsOption];
  }

  // 2. Array
  if (Array.isArray(modelsOption)) {
    // Array of TableDefinitions
    if (modelsOption.every((item) => isTableDefinition(item))) {
      return modelsOption as TableDefinition[];
    }

    // Array containing file paths or globs
    const results: TableDefinition[] = [];
    for (const item of modelsOption) {
      if (isTableDefinition(item)) {
        results.push(item);
      } else if (typeof item === "string") {
        const files = matchFiles(item, cwd, configDir);
        for (const file of files) {
          const mod = await import(pathToFileURL(file).href);
          results.push(...extractTablesFromModule(mod));
        }
      }
    }
    return deduplicateTables(results);
  }

  // 3. String (path or glob)
  if (typeof modelsOption === "string") {
    const files = matchFiles(modelsOption, cwd, configDir);
    const results: TableDefinition[] = [];
    for (const file of files) {
      const mod = await import(pathToFileURL(file).href);
      results.push(...extractTablesFromModule(mod));
    }
    return deduplicateTables(results);
  }

  // 4. Object dictionary of tables (e.g. import * as models)
  if (typeof modelsOption === "object") {
    return deduplicateTables(
      Object.values(modelsOption).filter(isTableDefinition)
    );
  }

  return [];
}

function deduplicateTables(tables: TableDefinition[]): TableDefinition[] {
  const unique: TableDefinition[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const norm = t.tableName.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      unique.push(t);
    }
  }
  return unique;
}

export function parseDatabaseConfig(
  dbOption?: ModelerConfig["database"]
): Partial<PoolConfig> {
  if (!dbOption) return {};

  if (typeof dbOption === "string") {
    try {
      const url = new URL(dbOption);
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

  const result: Partial<PoolConfig> = {};
  if (dbOption.host) result.host = dbOption.host;
  if (dbOption.port) result.port = dbOption.port;
  if (dbOption.user) result.user = dbOption.user;
  if (dbOption.password !== undefined) result.password = dbOption.password;
  if (dbOption.database) result.database = dbOption.database;
  if (dbOption.ssl !== undefined) result.ssl = dbOption.ssl;
  if (dbOption.socketPath) result.socketPath = dbOption.socketPath;
  if (dbOption.connectTimeout) result.connectTimeout = dbOption.connectTimeout;

  if (dbOption.url) {
    try {
      const url = new URL(dbOption.url);
      result.host = result.host || url.hostname;
      if (url.port) result.port = result.port || Number(url.port);
      if (url.username) result.user = result.user || decodeURIComponent(url.username);
      if (url.password) result.password = result.password || decodeURIComponent(url.password);
      if (url.pathname) result.database = result.database || url.pathname.replace(/^\//, "");
      if (url.searchParams.get("ssl") === "true") result.ssl = true;
    } catch {
      // ignore
    }
  }

  return result;
}

