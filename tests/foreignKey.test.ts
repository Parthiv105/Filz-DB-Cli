import test from "node:test";
import assert from "node:assert/strict";
import {
  defineTable,
  col,
  compileCreateTableSQL,
  compileAddForeignKeySQL,
  compileDropForeignKeySQL,
  resolveForeignKeyReferences,
  TABLE_REGISTRY,
} from "../src/schemaBuilder.js";
import { computeTableDiff } from "../src/schemaDiff.js";
import type { LiveColumnInfo, LiveIndexInfo, LiveForeignKeyInfo } from "../src/schemaInspector.js";

test("1. Declarative Object Syntax - Simple string shorthand ref", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerId: {
      type: "int",
      required: true,
      ref: "Users",
    },
  });

  const ownerCol = workspacesTable.columns["OwnerId"];
  assert.ok(ownerCol.foreignKey, "foreignKey should be defined");
  assert.equal(ownerCol.foreignKey.table, "Users");
  assert.equal(ownerCol.foreignKey.column, "Id");
  assert.equal(ownerCol.foreignKey.onDelete, "RESTRICT");
  assert.equal(ownerCol.foreignKey.onUpdate, "CASCADE");
  assert.equal(
    ownerCol.foreignKey.constraintName,
    "fk_Workspaces_OwnerId_Users"
  );
});

test("2. Declarative Object Syntax - Full object ref with custom rules", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: {
      type: "UUID",
      required: true,
      ref: {
        table: "Users",
        column: "UID",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
        constraintName: "fk_custom_workspace_owner",
      },
    },
  });

  const ownerCol = workspacesTable.columns["OwnerUID"];
  assert.ok(ownerCol.foreignKey);
  assert.equal(ownerCol.foreignKey.table, "Users");
  assert.equal(ownerCol.foreignKey.column, "UID");
  assert.equal(ownerCol.foreignKey.onDelete, "CASCADE");
  assert.equal(ownerCol.foreignKey.onUpdate, "CASCADE");
  assert.equal(
    ownerCol.foreignKey.constraintName,
    "fk_custom_workspace_owner"
  );
});

test("3. Declarative Object Syntax - 'references' alias and lowercase action normalization", () => {
  const tasksTable = defineTable("Tasks", {
    Id: col.int().autoIncrement().primaryKey(),
    AssigneeId: {
      type: "int",
      references: {
        table: "Users",
        column: "Id",
        onDelete: "set null" as any,
        onUpdate: "restrict" as any,
      },
    },
  });

  const assigneeCol = tasksTable.columns["AssigneeId"];
  assert.ok(assigneeCol.foreignKey);
  assert.equal(assigneeCol.foreignKey.table, "Users");
  assert.equal(assigneeCol.foreignKey.onDelete, "SET NULL");
  assert.equal(assigneeCol.foreignKey.onUpdate, "RESTRICT");
});

test("4. Fluent col builder API - .ref() with full parameters", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: col
      .uuid()
      .notNull()
      .ref("Users", "UID", { onDelete: "CASCADE", onUpdate: "CASCADE" }),
  });

  const ownerCol = workspacesTable.columns["OwnerUID"];
  assert.ok(ownerCol.foreignKey);
  assert.equal(ownerCol.foreignKey.table, "Users");
  assert.equal(ownerCol.foreignKey.column, "UID");
  assert.equal(ownerCol.foreignKey.onDelete, "CASCADE");
  assert.equal(ownerCol.foreignKey.onUpdate, "CASCADE");
  assert.equal(
    ownerCol.foreignKey.constraintName,
    "fk_Workspaces_OwnerUID_Users"
  );
});

test("5. Fluent col builder API - .ref() shorthands and .references() alias", () => {
  const table1 = defineTable("TableA", {
    Id: col.int().primaryKey(),
    UserId: col.int().ref("Users"),
  });
  assert.equal(table1.columns["UserId"].foreignKey?.table, "Users");
  assert.equal(table1.columns["UserId"].foreignKey?.column, "Id");
  assert.equal(table1.columns["UserId"].foreignKey?.onDelete, "RESTRICT");
  assert.equal(table1.columns["UserId"].foreignKey?.onUpdate, "CASCADE");

  const table2 = defineTable("TableB", {
    Id: col.int().primaryKey(),
    OrgId: col.varchar(36).references("Orgs", { onDelete: "SET NULL" }),
  });
  assert.equal(table2.columns["OrgId"].foreignKey?.table, "Orgs");
  assert.equal(table2.columns["OrgId"].foreignKey?.column, "Id");
  assert.equal(table2.columns["OrgId"].foreignKey?.onDelete, "SET NULL");
});

test("6. Auto-resolution of Target Primary Key (e.g. UID instead of Id)", () => {
  const usersTable = defineTable("Users", {
    UID: col.uuid().primaryKey(),
    Name: col.varchar(100).notNull(),
  });

  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: {
      type: "UUID",
      ref: "Users",
    },
  });

  resolveForeignKeyReferences([usersTable, workspacesTable]);

  assert.equal(
    workspacesTable.columns["OwnerUID"].foreignKey?.column,
    "UID",
    "Should auto-resolve target column to 'UID' since Users table primary key is UID"
  );
});

test("7. DDL generation - compileCreateTableSQL with inline foreign keys", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: col
      .uuid()
      .notNull()
      .ref("Users", "UID", { onDelete: "RESTRICT", onUpdate: "CASCADE" }),
  });

  const sql = compileCreateTableSQL(workspacesTable);
  assert.ok(
    sql.includes(
      "CONSTRAINT `fk_Workspaces_OwnerUID_Users` FOREIGN KEY (`OwnerUID`) REFERENCES `Users` (`UID`) ON DELETE RESTRICT ON UPDATE CASCADE"
    ),
    "Generated CREATE TABLE should include formatted FOREIGN KEY constraint with backticks"
  );

  // Two-pass support: includeForeignKeys: false
  const sqlWithoutFK = compileCreateTableSQL(workspacesTable, {
    includeForeignKeys: false,
  });
  assert.ok(
    !sqlWithoutFK.includes("FOREIGN KEY"),
    "When includeForeignKeys is false, no FOREIGN KEY clause should be emitted"
  );
});

test("8. DDL generation - compileAddForeignKeySQL & compileDropForeignKeySQL", () => {
  const addSql = compileAddForeignKeySQL("Workspaces", "OwnerUID", {
    table: "Users",
    column: "UID",
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
    constraintName: "fk_Workspaces_OwnerUID_Users",
  });
  assert.equal(
    addSql,
    "ALTER TABLE `Workspaces` ADD CONSTRAINT `fk_Workspaces_OwnerUID_Users` FOREIGN KEY (`OwnerUID`) REFERENCES `Users` (`UID`) ON DELETE RESTRICT ON UPDATE CASCADE;"
  );

  const dropSql = compileDropForeignKeySQL(
    "Workspaces",
    "fk_Workspaces_OwnerUID_Users"
  );
  assert.equal(
    dropSql,
    "ALTER TABLE `Workspaces` DROP FOREIGN KEY `fk_Workspaces_OwnerUID_Users`;"
  );
});

test("9. Schema Diffing - Detect missing foreign key and generate ADD CONSTRAINT", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: col
      .uuid()
      .notNull()
      .ref("Users", "UID", { onDelete: "RESTRICT", onUpdate: "CASCADE" }),
  });

  const liveColumns: Record<string, LiveColumnInfo> = {
    Id: {
      name: "Id",
      columnType: "int",
      dataType: "int",
      nullable: false,
      defaultValue: null,
      extra: "auto_increment",
      key: "PRI",
      collation: null,
      charset: null,
    },
    OwnerUID: {
      name: "OwnerUID",
      columnType: "varchar(36)",
      dataType: "varchar",
      nullable: false,
      defaultValue: null,
      extra: "",
      key: "",
      collation: null,
      charset: null,
    },
  };

  const liveIndexes: LiveIndexInfo[] = [];
  const liveForeignKeys: LiveForeignKeyInfo[] = []; // No live foreign keys

  const diff = computeTableDiff(
    workspacesTable,
    liveColumns,
    liveIndexes,
    {},
    liveForeignKeys
  );

  assert.equal(diff.addForeignKeyStatements.length, 1);
  assert.equal(
    diff.addForeignKeyStatements[0],
    "ALTER TABLE `Workspaces` ADD CONSTRAINT `fk_Workspaces_OwnerUID_Users` FOREIGN KEY (`OwnerUID`) REFERENCES `Users` (`UID`) ON DELETE RESTRICT ON UPDATE CASCADE;"
  );
  assert.equal(diff.dropForeignKeyStatements.length, 0);
  assert.ok(
    diff.descriptions.some((d) => d.includes("+ Add foreign key")),
    "Should include description for added foreign key"
  );
});

test("10. Schema Diffing - Detect deleted foreign key in Model and generate DROP FOREIGN KEY", () => {
  // Model no longer has ref on OwnerUID
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: col.uuid().notNull(), // no ref
  });

  const liveColumns: Record<string, LiveColumnInfo> = {
    Id: {
      name: "Id",
      columnType: "int",
      dataType: "int",
      nullable: false,
      defaultValue: null,
      extra: "auto_increment",
      key: "PRI",
      collation: null,
      charset: null,
    },
    OwnerUID: {
      name: "OwnerUID",
      columnType: "varchar(36)",
      dataType: "varchar",
      nullable: false,
      defaultValue: null,
      extra: "",
      key: "",
      collation: null,
      charset: null,
    },
  };

  const liveIndexes: LiveIndexInfo[] = [];
  const liveForeignKeys: LiveForeignKeyInfo[] = [
    {
      constraintName: "fk_Workspaces_OwnerUID_Users",
      columnName: "OwnerUID",
      referencedTable: "Users",
      referencedColumn: "UID",
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    },
  ];

  const diff = computeTableDiff(
    workspacesTable,
    liveColumns,
    liveIndexes,
    {},
    liveForeignKeys
  );

  assert.equal(diff.dropForeignKeyStatements.length, 1);
  assert.equal(
    diff.dropForeignKeyStatements[0],
    "ALTER TABLE `Workspaces` DROP FOREIGN KEY `fk_Workspaces_OwnerUID_Users`;"
  );
  assert.equal(diff.addForeignKeyStatements.length, 0);
  assert.ok(
    diff.descriptions.some((d) => d.includes("- Drop foreign key")),
    "Should describe dropped foreign key"
  );
});

test("11. Schema Diffing - Detect modified rules and generate DROP then ADD", () => {
  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    OwnerUID: col
      .uuid()
      .notNull()
      .ref("Users", "UID", { onDelete: "CASCADE", onUpdate: "CASCADE" }), // changed from RESTRICT to CASCADE
  });

  const liveColumns: Record<string, LiveColumnInfo> = {
    Id: {
      name: "Id",
      columnType: "int",
      dataType: "int",
      nullable: false,
      defaultValue: null,
      extra: "auto_increment",
      key: "PRI",
      collation: null,
      charset: null,
    },
    OwnerUID: {
      name: "OwnerUID",
      columnType: "varchar(36)",
      dataType: "varchar",
      nullable: false,
      defaultValue: null,
      extra: "",
      key: "",
      collation: null,
      charset: null,
    },
  };

  const liveIndexes: LiveIndexInfo[] = [];
  const liveForeignKeys: LiveForeignKeyInfo[] = [
    {
      constraintName: "fk_Workspaces_OwnerUID_Users",
      columnName: "OwnerUID",
      referencedTable: "Users",
      referencedColumn: "UID",
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
    },
  ];

  const diff = computeTableDiff(
    workspacesTable,
    liveColumns,
    liveIndexes,
    {},
    liveForeignKeys
  );

  assert.equal(diff.dropForeignKeyStatements.length, 1);
  assert.equal(
    diff.dropForeignKeyStatements[0],
    "ALTER TABLE `Workspaces` DROP FOREIGN KEY `fk_Workspaces_OwnerUID_Users`;"
  );
  assert.equal(diff.addForeignKeyStatements.length, 1);
  assert.equal(
    diff.addForeignKeyStatements[0],
    "ALTER TABLE `Workspaces` ADD CONSTRAINT `fk_Workspaces_OwnerUID_Users` FOREIGN KEY (`OwnerUID`) REFERENCES `Users` (`UID`) ON DELETE CASCADE ON UPDATE CASCADE;"
  );

  // In statements array, DROP FOREIGN KEY must come before ADD FOREIGN KEY
  const dropIdx = diff.statements.indexOf(diff.dropForeignKeyStatements[0]);
  const addIdx = diff.statements.indexOf(diff.addForeignKeyStatements[0]);
  assert.ok(dropIdx < addIdx, "DROP FOREIGN KEY must occur before ADD FOREIGN KEY");
});

test("12. Circular references & Two-Pass Migration Strategy", () => {
  // Circular dependency: Users references Workspaces, Workspaces references Users
  const usersTable = defineTable("Users", {
    UID: col.uuid().primaryKey(),
    Name: col.varchar(100).notNull(),
    CurrentWorkspaceId: col.int().ref("Workspaces", "Id"),
  });

  const workspacesTable = defineTable("Workspaces", {
    Id: col.int().autoIncrement().primaryKey(),
    Title: col.varchar(100).notNull(),
    OwnerUID: col.uuid().ref("Users", "UID"),
  });

  resolveForeignKeyReferences([usersTable, workspacesTable]);

  // Pass 1: Base table creations have no foreign keys (eliminating chicken-and-egg table dependency)
  const pass1Users = compileCreateTableSQL(usersTable, {
    includeForeignKeys: false,
  });
  const pass1Workspaces = compileCreateTableSQL(workspacesTable, {
    includeForeignKeys: false,
  });

  assert.ok(!pass1Users.includes("FOREIGN KEY"));
  assert.ok(!pass1Workspaces.includes("FOREIGN KEY"));

  // Pass 2: Foreign key constraints added via ALTER TABLE after all base tables exist
  const pass2UsersFK = compileAddForeignKeySQL(
    "Users",
    "CurrentWorkspaceId",
    usersTable.columns["CurrentWorkspaceId"].foreignKey!
  );
  const pass2WorkspacesFK = compileAddForeignKeySQL(
    "Workspaces",
    "OwnerUID",
    workspacesTable.columns["OwnerUID"].foreignKey!
  );

  assert.equal(
    pass2UsersFK,
    "ALTER TABLE `Users` ADD CONSTRAINT `fk_Users_CurrentWorkspaceId_Workspaces` FOREIGN KEY (`CurrentWorkspaceId`) REFERENCES `Workspaces` (`Id`) ON DELETE RESTRICT ON UPDATE CASCADE;"
  );
  assert.equal(
    pass2WorkspacesFK,
    "ALTER TABLE `Workspaces` ADD CONSTRAINT `fk_Workspaces_OwnerUID_Users` FOREIGN KEY (`OwnerUID`) REFERENCES `Users` (`UID`) ON DELETE RESTRICT ON UPDATE CASCADE;"
  );
});

