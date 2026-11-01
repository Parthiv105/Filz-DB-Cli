# @bossdev/db-modeler

Declarative MariaDB schema synchronization and interactive migration CLI with zero-data-loss table alteration.

## Features

- **TypeScript Models**: Define tables using strongly-typed fluent column builders instead of raw SQL.
- **Interactive CLI**: Modern terminal UI powered by `@clack/prompts` with arrow keys and spinner animations.
- **Zero Data Loss**: Smart `CHANGE COLUMN` migrations for renames, casing adjustments, and property modifications.
- **Advanced Data Types & Unicode**: Full support for custom collations (e.g. `utf8mb4_uca1400_ai_ci`), binary/case-sensitive columns (`apiKey`), UUID, JSON, and blobs.

## Installation

```bash
npm install @bossdev/db-modeler
```

## Quick Start

### 1. Define Models (`src/Utils/Database/MariaDB/users.ts`)

You can define models using either **MongoDB / Mongoose declarative format** (recommended) or the **fluent `col` builder**:

#### Option A: MongoDB / Mongoose Style (Declarative & Clean)

```ts
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
}, {
  timestamps: true, // Automatically manages CreatedAt and UpdatedAt!
});
```

You can also use Mongoose-style `new Schema(...)`:

```ts
import { defineTable, Schema } from "@bossdev/db-modeler";

const userSchema = new Schema({
  Id: { type: Number, autoIncrement: true, primaryKey: true },
  Name: { type: String, length: 100, required: true },
  Email: { type: String, length: 255, required: true, unique: true },
  Age: Number,
  IsActive: Boolean,
  Tags: [String], // Stored as JSON
  Metadata: Object, // Stored as JSON
}, {
  timestamps: true,
});

export const usersTable = defineTable("Users", userSchema);
```

#### Option B: Fluent Builder Style

```ts
import { defineTable, col } from "@bossdev/db-modeler";

export const usersTable = defineTable("users", {
  Id: col.int().autoIncrement().primaryKey(),
  Name: col.varchar(100).notNull(),
  Email: col
    .varchar(255)
    .notNull()
    .unique()
    .charset("utf8mb4")
    .collate("utf8mb4_uca1400_ai_ci"),
  ApiKey: col.apiKey(64).nullable(),
  ProfilePicture: col.text().nullable().from("Profile_Picture"),
  CreatedAt: col.timestamp().default("CURRENT_TIMESTAMP"),
  UpdatedAt: col
    .timestamp()
    .default("CURRENT_TIMESTAMP")
    .onUpdateCurrentTimestamp(),
});
```

### 2. Export All Models (`src/Utils/Database/MariaDB/index.ts`)

```ts
import { usersTable } from "./users.js";

export const models = [usersTable];
```

### 3. Run the CLI

In your `package.json`:

```json
{
  "scripts": {
    "db": "db-modeler"
  }
}
```

Then run:

```bash
npm run db
```

## Interactive CLI Workflow

When you run `db-modeler`, the CLI guides you through an organized 4-step migration workflow:

1. **Select Mode**:
   - `Create`: Discover and provision non-existing tables in the database.
   - `Alter`: Modify existing tables with intelligent zero-data-loss column diffing or hard recreation.
   - `Delete`: Selectively drop existing tables from the database.
2. **Select Table(s)**:
   - For `Create`: Only non-existing tables are displayed.
   - For `Alter`: Only existing database tables matching models are displayed.
   - For `Delete`: Existing database tables are displayed.
   - Use <kbd>Space</kbd> to select/deselect individual or multiple tables, and <kbd>Enter</kbd> to confirm.
3. **Select Alteration Strategy (in Alter Mode)**:
   - **Both (Rename & Column Properties)**: Smart rename old columns to model names AND update column types, collations, and defaults with zero data loss.
   - **Only Column Properties**: Preserve database column names; only update data types, nullability, collations, and defaults.
   - **Only Alter Names**: Only rename columns to model names using `RENAME COLUMN`; keep existing data types and properties untouched.
   - **Hard Alter (Drop & Recreate)**: Drop the table first (`DROP TABLE IF EXISTS`) and recreate fresh from model definitions.
   - Optional: Drop extra database columns not present in your models.
4. **Display Changes & Confirmation**:
   - Displays a comprehensive visual summary of all proposed modifications and warnings.
   - Previews the exact generated SQL statements.
   - Prompts for explicit user confirmation before executing any changes on your live database.

## License

MIT
