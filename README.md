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

## License

MIT
