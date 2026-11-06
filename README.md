<div align="center">

# @bossdev/db-modeler

**Declarative schema modeling, intelligent zero-data-loss table synchronization, and interactive migration CLI for MariaDB & MySQL.**

[![npm version](https://img.shields.io/npm/v/@bossdev/db-modeler.svg?style=flat-square&color=crimson)](https://www.npmjs.com/package/@bossdev/db-modeler)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![Database: MariaDB & MySQL](https://img.shields.io/badge/database-MariaDB%20%7C%20MySQL-orange.svg?style=flat-square)](https://mariadb.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20Types-blue.svg?style=flat-square)](https://www.typescriptlang.org/)

<p align="center">
  <a href="#key-features">Key Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#schema-modeling-guide">Schema Modeling</a> •
  <a href="#interactive-cli-workflow">Interactive CLI</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#migration-mechanics">Under the Hood</a>
</p>

</div>

---

## Overview

`@bossdev/db-modeler` is a developer-centric database modeling and schema synchronization engine built for modern Node.js and TypeScript environments. It eliminates tedious raw SQL migration files by allowing you to define database schemas declaratively in TypeScript, automatically comparing your models against live database tables, and performing non-destructive, zero-data-loss column migrations with interactive terminal guidance.

---

## Key Features

- **Dual Modeling Paradigms**: Write schemas in clean, declarative **MongoDB/Mongoose-style objects** or using a fluent **type-safe column builder API**.
- **Interactive Migration CLI**: Terminal UI powered by `@clack/prompts` with visual progress, colored SQL previews, and explicit safety confirmations.
- **Zero Data Loss Migrations**: Smart column matching (handles casing, normalization, rename tracking via `.from()`, and semantic aliases) with non-destructive `CHANGE COLUMN` and `RENAME COLUMN` operations.
- **Dynamic Defaults & SQL Expressions**: Full support for raw SQL defaults (`CURRENT_TIMESTAMP`, `UUID()`, `NOW()`), dynamic JavaScript callback functions (`() => ...`), and automatic `Date` formatting.
- **Enterprise Unicode & Collations**: Native support for modern collations (e.g. `utf8mb4_uca1400_ai_ci`), case-sensitive binary columns (`apiKey`), UUID, ENUM, and JSON fields.
- **Location-Agnostic Config (`modaler.config.ts`)**: Put your configuration anywhere in the repository — root, `src/`, `config/`, or nested subdirectories — with glob pattern and direct model import support.
- **Database Auto-Provisioning**: Detects missing databases on startup and offers one-click automated creation.

---

## Installation

```bash
# npm
npm install @bossdev/db-modeler

# pnpm
pnpm add @bossdev/db-modeler

# yarn
yarn add @bossdev/db-modeler

# bun
bun add @bossdev/db-modeler
```

> **Requirements:** Node.js `>= 18.0.0` and MariaDB `>= 10.5` or MySQL `>= 8.0`.

---

## Quick Start

### 1. Define a Table Model

Create your model file using either the **Declarative Object syntax** (recommended) or the **Fluent Builder API**:

```ts
// src/models/users.ts
import { defineTable } from "@bossdev/db-modeler";

export const usersTable = defineTable("Users", {
  Id: { type: Number, autoIncrement: true, primaryKey: true },
  Name: { type: String, length: 100, required: true },
  Email: {
    type: String,
    length: 255,
    required: true,
    unique: true,
    charset: "utf8mb4",
    collate: "utf8mb4_uca1400_ai_ci",
  },
  ApiKey: { type: "apiKey", length: 64, nullable: true },
  ProfilePicture: { type: "text", nullable: true, from: "Profile_Picture" },
  Status: { type: "enum", enum: ["active", "suspended", "pending"], default: "pending" },
}, {
  timestamps: true, // Automatically manages CreatedAt and UpdatedAt
});
```

### 2. Configure `modaler.config.ts`

Create `modaler.config.ts` in your project root (or inside `src/` / `config/`):

```ts
// modaler.config.ts
import { withModaler } from "@bossdev/db-modeler";
import { usersTable } from "./src/models/users.js";

export default withModaler({
  models: [usersTable],
  // Database credentials can also be defined in .env
  database: {
    host: "127.0.0.1",
    user: "root",
    password: "",
    database: "my_database",
  },
});
```

### 3. Add Script & Run

Add the CLI command to your `package.json`:

```json
{
  "scripts": {
    "db": "db-modeler"
  }
}
```

Then run the synchronizer:

```bash
npm run db
```

---

## Configuration

The configuration file `modaler.config.ts` (or `modeler.config.ts`) provides centralized control over models and connections.

### Automatic Discovery Anywhere

The CLI automatically scans and discovers your configuration file across the project hierarchy:
- Project root (`./modaler.config.ts`)
- Source folder (`./src/modaler.config.ts`)
- Config directories (`./config/modaler.config.ts`, `./src/config/modaler.config.ts`)
- Database directories (`./src/database/`, `./src/db/`, `./src/Utils/Database/`)
- Any custom nested directory (via recursive project scan, excluding `node_modules` and `dist`)

### Full Configuration Reference

```ts
// modaler.config.ts
import { withModaler } from "@bossdev/db-modeler";
import { usersTable } from "./src/models/users.js";
import { ordersTable } from "./src/models/orders.js";

export default withModaler({
  /**
   * Models can be supplied as:
   * 1. An array of table definitions: [usersTable, ordersTable]
   * 2. An object/namespace: import * as models from './models'; models: models
   * 3. A glob pattern: "./src/**\/*.model.ts"
   * 4. An array of file paths: ["./src/users.ts", "./src/orders.ts"]
   */
  models: [usersTable, ordersTable],

  /**
   * Database credentials (optional if using environment variables)
   * Supports either an object or a connection URL string
   */
  database: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "production_db",
    ssl: process.env.DB_SSL === "true",
  },

  /**
   * Custom path to .env file (default: .env in project root)
   */
  envPath: ".env",

  /**
   * Default column alteration strategy:
   * "both" | "properties" | "names" | "ignore-existing"
   */
  strategy: "both",

  /**
   * Whether to drop extra database columns not defined in models (default: false)
   */
  dropColumns: false,

  /**
   * Global table creation defaults
   */
  tableOptions: {
    engine: "InnoDB",
    charset: "utf8mb4",
    collation: "utf8mb4_unicode_ci",
  },
});
```

---

## Schema Modeling Guide

`@bossdev/db-modeler` supports two distinct modeling paradigms: the declarative **Mongoose/MongoDB-Style** and the **Fluent Builder API**. Both compile to identical high-performance MariaDB/MySQL DDL.

### Paradigm A: Declarative Object Syntax (MongoDB Style)

Modeled after modern declarative document schemas, this syntax allows you to define fields using JavaScript constructors or configuration objects:

```ts
import { defineTable, Schema } from "@bossdev/db-modeler";

export const customersTable = defineTable("Customers", {
  // Primary key with Auto-Increment
  Id: { type: Number, primaryKey: true, autoIncrement: true },

  // Standard primitives with constraints
  FirstName: { type: String, length: 80, required: true },
  LastName: { type: String, length: 80, required: true },

  // Unique constraint with custom Unicode collation
  Email: {
    type: String,
    length: 255,
    required: true,
    unique: true,
    charset: "utf8mb4",
    collate: "utf8mb4_uca1400_ai_ci",
  },

  // Binary case-sensitive string (utf8mb4_bin) for secure tokens
  ApiKey: { type: "apiKey", length: 64, nullable: true },

  // Numeric decimals (precision & scale)
  Balance: { type: "decimal", precision: 12, scale: 2, default: 0.00 },

  // Enums
  Tier: { type: "enum", enum: ["free", "pro", "enterprise"], default: "free" },

  // Native JSON storage (LONGTEXT)
  Preferences: Object, // or { type: Object }
  Tags: [String],      // Array of strings mapped to JSON

  // Dynamic default functions & SQL expressions
  RegisteredAt: { type: Date, default: () => "CURRENT_TIMESTAMP" },
  TokenId: { type: "varchar", length: 36, default: () => "UUID()" },

  // Renamed column mapping for zero data loss
  AvatarUrl: { type: "text", nullable: true, from: "profile_picture_url" },
}, {
  timestamps: true, // Automatically manages CreatedAt and UpdatedAt
});
```

#### Alternative: Mongoose `new Schema(...)` Format

```ts
import { defineTable, Schema } from "@bossdev/db-modeler";

const customerSchema = new Schema({
  Id: { type: Number, primaryKey: true, autoIncrement: true },
  FullName: String,     // Shorthand: VARCHAR(255) NULL
  Age: Number,          // Shorthand: INT NULL
  IsActive: Boolean,    // Shorthand: TINYINT(1) NULL
  Metadata: Object,     // Shorthand: JSON NULL
}, {
  timestamps: true,
});

export const customersTable = defineTable("Customers", customerSchema);
```

---

### Paradigm B: Fluent Builder API (`col.xxx()`)

For developers who prefer chaining methods with autocomplete assistance:

```ts
import { defineTable, col } from "@bossdev/db-modeler";

export const ordersTable = defineTable("Orders", {
  Id: col.int().autoIncrement().primaryKey(),
  OrderNumber: col.varchar(50).notNull().unique(),
  CustomerId: col.int().notNull().unsigned(),
  Subtotal: col.decimal(10, 2).notNull().default(0),
  Tax: col.decimal(10, 2).notNull().default(0),
  Status: col.enum(["pending", "processing", "shipped", "delivered"]).default("pending"),
  Notes: col.text().nullable(),
  InternalSecret: col.apiKey(64).nullable(),
  CreatedAt: col.timestamp().default("CURRENT_TIMESTAMP"),
  UpdatedAt: col.timestamp().default("CURRENT_TIMESTAMP").onUpdateCurrentTimestamp(),
});
```

---

### Foreign Keys & Relations (`ref`)

`@bossdev/db-modeler` supports declarative, Mongoose-style Foreign Key references (`ref`) across schema definitions, table creation DDL, database inspection, and two-pass migration diffing.

#### 1. Mongoose-Style Shorthand (String)
Specify the target table name as a string. If the target column is omitted, it automatically resolves to the target table's Primary Key (such as `UID` or `Id`):

```ts
export const workspacesTable = defineTable("Workspaces", {
  Id: col.int().autoIncrement().primaryKey(),
  OwnerUID: {
    type: "UUID",
    required: true,
    ref: "Users", // Auto-resolves target table's PK / UID
  },
});
```

#### 2. Detailed Object Syntax
Configure custom cascade rules (`onDelete` and `onUpdate`) and custom constraint names:

```ts
export const workspacesTable = defineTable("Workspaces", {
  Id: col.int().autoIncrement().primaryKey(),
  OwnerUID: {
    type: "UUID",
    required: true,
    ref: {
      table: "Users",
      column: "UID",                                 // Target column in foreign table
      onDelete: "RESTRICT",                          // "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION" (default: "RESTRICT")
      onUpdate: "CASCADE",                           // default: "CASCADE"
      constraintName: "fk_Workspaces_OwnerUID_Users" // Optional custom name
    },
  },
});
```

#### 3. Fluent Column Builder (`col.ref()`)

```ts
export const workspacesTable = defineTable("Workspaces", {
  Id: col.int().autoIncrement().primaryKey(),
  OwnerUID: col
    .uuid()
    .notNull()
    .ref("Users", "UID", { onDelete: "CASCADE", onUpdate: "CASCADE" }),
});
```

#### 4. Two-Pass Migration Engine (Zero Circular Dependency Deadlocks)
When running migrations across interconnected or circular tables (e.g. `Users` references `Workspaces` while `Workspaces` references `Users`):
- **Pass 1**: Creates all base tables and modifies columns (without foreign key constraints).
- **Pass 2**: Applies `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY ...` after all referenced tables exist.
This guarantees circular references and cross-table relations apply safely without constraint check failures.

---

### Column Type Reference

| Type Builder | Declarative Type | Output MariaDB / MySQL SQL | Description |
| :--- | :--- | :--- | :--- |
| `col.int()` | `Number` / `"int"` | `INT` | 32-bit signed integer |
| `col.bigint()` | `"bigint"` | `BIGINT` | 64-bit integer |
| `col.tinyint(len)` | `"tinyint"` | `TINYINT(1)` | Small integer |
| `col.boolean()` | `Boolean` / `"bool"` | `TINYINT(1)` | Boolean flag |
| `col.varchar(length)`| `String` / `{ length }` | `VARCHAR(n)` | Variable-length character string |
| `col.apiKey(length)` | `"apiKey"` | `VARCHAR(n) COLLATE utf8mb4_bin` | Case-sensitive binary token column |
| `col.text()` | `"text"` | `TEXT` | Multiline text storage |
| `col.longtext()` | `"longtext"` | `LONGTEXT` | Up to 4GB text storage |
| `col.decimal(p, s)` | `"decimal"` / `{ precision, scale }` | `DECIMAL(p, s)` | Exact-fixed-point numeric |
| `col.float()` | `"float"` | `FLOAT` | Floating-point number |
| `col.double()` | `"double"` | `DOUBLE` | Double-precision number |
| `col.date()` | `"date"` | `DATE` | Calendar date (`YYYY-MM-DD`) |
| `col.datetime()` | `Date` / `"datetime"` | `DATETIME` | Date and time |
| `col.timestamp()` | `"timestamp"` | `TIMESTAMP` | Auto-updating timestamp |
| `col.enum([...])` | `{ enum: [...] }` | `ENUM('a', 'b')` | Enumeration set |
| `col.json()` | `Object` / `[Type]` / `"json"` | `LONGTEXT` | JSON data document |
| `col.uuid()` | `"uuid"` | `UUID` | Universally Unique Identifier |
| `col.blob()` | `Buffer` / `"blob"` | `BLOB` | Binary large object |
| `col.custom(sql)` | `{ customType: "..." }` | *Custom SQL string* | Custom database-specific type |

---

### Dynamic Defaults & SQL Expressions

You can define defaults using raw SQL functions, literal values, or JavaScript functions:

```ts
// 1. Unquoted SQL Functions
CreatedAt: { type: Date, default: () => "CURRENT_TIMESTAMP" }
Token: { type: "varchar", length: 36, default: () => "UUID()" }

// 2. JavaScript Date Instances (automatically formatted to 'YYYY-MM-DD HH:mm:ss')
ReleaseDate: { type: Date, default: () => new Date("2026-01-01T00:00:00Z") }

// 3. Chained Fluent Builder with Callback
CreatedAt: col.timestamp().default(() => "CURRENT_TIMESTAMP")
```

---

## Interactive CLI Workflow

When you run `db-modeler`, the CLI launches an interactive terminal interface:

```
┌  DB Modeler CLI
│
◇  Loaded config from modaler.config.ts
◇  Connected to MariaDB (12 tables found in database)
```

The synchronizer guides you through a structured 4-step workflow:

### Step 1: Select Operation Mode
- **`Create`**: Detects and provisions non-existing tables defined in your models.
- **`Alter`**: Updates and alters existing live tables (zero data loss or hard recreation).
- **`Delete`**: Drop existing database tables with safety checks.

### Step 2: Multi-Select Tables
- Filtered dynamically based on mode:
  - `Create` displays **only non-existing tables**.
  - `Alter` displays **existing tables matching models**.
  - `Delete` displays **existing live database tables**.
- Toggle individual tables or all tables using <kbd>Space</kbd>, and confirm with <kbd>Enter</kbd>.

### Step 3: Select Alteration Strategy (in Alter Mode)
- **`Both (Rename & Column Properties)`** *(Recommended)*:
  Smart renames mismatched columns to model names (`CHANGE COLUMN`) and updates data types, lengths, collations, and nullability with zero data loss.
- **`Only Column Properties`**:
  Preserves existing database column names (`keep-names`); updates only data types, nullability, and collations.
- **`Only Alter Names`**:
  Renames old columns to model names (`RENAME COLUMN`) without altering existing column types or properties.
- **`Hard Alter (Drop & Recreate)`**:
  Executes `DROP TABLE IF EXISTS` and recreates the table fresh from the model schema.
- **Drop Extra Columns**:
  Optional cleanup to remove columns present in the live database that are absent in your models.

### Step 4: Review Changes & Confirm Execution
- Displays a color-coded overview of all proposed alterations (`+` Add, `~` Modify/Rename, `-` Drop).
- Displays a syntax-highlighted **Generated SQL Preview** showing the exact DDL queries.
- Requires explicit user confirmation before applying any changes to your live database.

---

## CLI Reference

### Command Line Options

```bash
db-modeler [options]
```

| Flag | Description |
| :--- | :--- |
| `--config <path>` | Specify a custom path to `modaler.config.ts`. |
| `--models <path>` | Specify a custom path to a model file or index export. |
| `--create` / `--sync` | Pre-select `Create` mode. |
| `--alter` | Pre-select `Alter` mode. |
| `--delete` | Pre-select `Delete` mode. |
| `--table <name>` | Target a specific table by name. |
| `--tables <a,b>` | Target a comma-separated list of tables. |
| `--hard` | Execute hard alter (drop & recreate from scratch). |
| `--names-only` | Execute name renames only (`RENAME COLUMN`). |
| `--keep-names` | Preserve database column names; only update types and properties. |
| `--drop` | Automatically drop extra database columns not in models. |
| `--dry-run` | Output generated SQL statements and preview without touching the database. |
| `--yes`, `-y`, `--ci` | Run in non-interactive CI/CD mode (auto-approves changes). |

### Example CLI Usages

```bash
# Interactive mode (default)
npm run db

# Preview changes without modifying live database (Dry Run)
npx db-modeler --dry-run

# Run non-interactive in CI/CD pipeline
npx db-modeler --alter --yes

# Target a specific table with custom config location
npx db-modeler --config ./config/modaler.config.ts --table Users
```

---

## Migration Mechanics

### Intelligent Column Matching (Zero Data Loss)

When altering existing tables, `@bossdev/db-modeler` uses a multi-tier resolution algorithm to prevent accidental column drops and preserve data:

1. **Explicit Tracking (`from` / `renamedFrom`)**:
   Matches columns explicitly flagged with `.from("old_name")` or `{ from: "old_name" }`.
2. **Exact Name Match**:
   Matches identical column names.
3. **Case-Insensitive Match**:
   Matches `email` to `Email`, `createdat` to `CreatedAt`.
4. **Normalized Match**:
   Strips underscores and dashes: matches `user_name` or `user-name` to `userName`.
5. **Semantic Alias Mapping**:
   Recognizes common industry aliases:
   - `image` $\leftrightarrow$ `avatar`, `photo`, `picture`, `profile_picture`
   - `name` $\leftrightarrow$ `fullname`, `display_name`, `username`
   - `phone` $\leftrightarrow$ `mobile`, `contact_number`
   - `password` $\leftrightarrow$ `pwd`, `pass`, `password_hash`
   - `api_key` $\leftrightarrow$ `apikey`, `token`, `secret_key`

---

## Environment Variables

You can configure database access via environment variables (or in your `.env` file):

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=secret
DB_NAME=my_application
DB_SSL=false
# Or use a single connection string:
DATABASE_URL=mysql://root:secret@127.0.0.1:3306/my_application
```

---

## License

MIT © [Parthiv Chhayani](https://github.com/Parthiv105) / [BossDev](https://github.com/bossdev)
