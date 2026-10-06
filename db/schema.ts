import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('cms_users', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(),
  password: text('password').notNull(), role: text('role').notNull(),
  enabled: integer('enabled').notNull().default(1), createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('cms_sessions', {
  token: text('token').primaryKey(), userId: text('user_id').notNull(),
  visitor: text('visitor').notNull(), csrf: text('csrf').notNull(), expires: integer('expires').notNull(),
});
export const records = sqliteTable('cms_records', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), data: text('data').notNull(),
  published: integer('published').notNull().default(0), revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(), updatedBy: text('updated_by').notNull(),
});
export const attempts = sqliteTable('cms_attempts', {
  key: text('key').primaryKey(), count: integer('count').notNull().default(0),
  resetAt: integer('reset_at').notNull(),
});
export const imports = sqliteTable('cms_imports', {
  id: text('id').primaryKey(), importedAt: integer('imported_at').notNull(),
});
export const pageViews = sqliteTable('cms_page_views', {
  day: text('day').notNull(), path: text('path').notNull(), views: integer('views').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.day, table.path] })]);
