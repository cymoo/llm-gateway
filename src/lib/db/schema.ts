import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).unique().notNull(),
  remark: varchar("remark", { length: 1000 }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    passwordHash: varchar("password_hash", { length: 255 }),
    apiKey: varchar("api_key", { length: 64 }).unique().notNull(),
    remark: varchar("remark", { length: 1000 }),
    isActive: boolean("is_active").default(true),
    isAdmin: boolean("is_admin").default(false),
    groupId: uuid("group_id").references(() => groups.id),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [
    index("idx_users_api_key").on(table.apiKey),
    index("idx_users_email").on(table.email),
    index("idx_users_group_id").on(table.groupId),
  ]
);

export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    alias: varchar("alias", { length: 100 }).unique().notNull(),
    backendUrl: varchar("backend_url", { length: 500 }).notNull(),
    backendModel: varchar("backend_model", { length: 200 }).notNull(),
    backendApiKey: varchar("backend_api_key", { length: 200 }),
    type: varchar("type", { length: 20 }).notNull().default("chat"),
    remark: varchar("remark", { length: 1000 }),
    isActive: boolean("is_active").default(true),
    defaultMaxTokensPerDay: bigint("default_max_tokens_per_day", {
      mode: "number",
    }),
    defaultMaxRequestsPerDay: integer("default_max_requests_per_day"),
    defaultMaxRequestsPerMin: integer("default_max_requests_per_min"),
    defaultAllowedTimeStart: time("default_allowed_time_start"),
    defaultAllowedTimeEnd: time("default_allowed_time_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [index("idx_models_alias").on(table.alias)]
);

export const userModels = pgTable(
  "user_models",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [primaryKey({ columns: [table.userId, table.modelId] })]
);

export const userModelQuotas = pgTable(
  "user_model_quotas",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    maxTokensPerDay: bigint("max_tokens_per_day", { mode: "number" }),
    maxRequestsPerDay: integer("max_requests_per_day"),
    maxRequestsPerMin: integer("max_requests_per_min"),
    allowedTimeStart: time("allowed_time_start"),
    allowedTimeEnd: time("allowed_time_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [unique().on(table.userId, table.modelId)]
);

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id),
    modelId: uuid("model_id").references(() => models.id),
    requestType: varchar("request_type", { length: 50 }).notNull(),
    promptTokens: integer("prompt_tokens").default(0),
    completionTokens: integer("completion_tokens").default(0),
    totalTokens: integer("total_tokens").default(0),
    isStream: boolean("is_stream").default(false),
    durationMs: integer("duration_ms"),
    status: varchar("status", { length: 20 }),
    promptPreview: text("prompt_preview"),
    clientIp: varchar("client_ip", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [
    index("idx_usage_logs_user_created").on(table.userId, table.createdAt),
    index("idx_usage_logs_model_created").on(table.modelId, table.createdAt),
    index("idx_usage_logs_created_at").on(table.createdAt),
  ]
);

export const dailyUsage = pgTable(
  "daily_usage",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id),
    modelId: uuid("model_id").references(() => models.id),
    date: date("date").notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" }).default(0),
    requestCount: integer("request_count").default(0),
  },
  (table) => [
    unique().on(table.userId, table.modelId, table.date),
    index("idx_daily_usage_user_model_date").on(
      table.userId,
      table.modelId,
      table.date
    ),
    index("idx_daily_usage_date").on(table.date),
  ]
);

export const groupModels = pgTable(
  "group_models",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.modelId] })]
);

export const groupModelQuotas = pgTable(
  "group_model_quotas",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    maxTokensPerDay: bigint("max_tokens_per_day", { mode: "number" }),
    maxRequestsPerDay: integer("max_requests_per_day"),
    maxRequestsPerMin: integer("max_requests_per_min"),
    allowedTimeStart: time("allowed_time_start"),
    allowedTimeEnd: time("allowed_time_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [unique().on(table.groupId, table.modelId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Soft references (no FK) so records survive deletion of the target and
    // stay human-readable. adminId/resourceId are nullable (e.g. failed login).
    adminId: uuid("admin_id"),
    adminEmail: varchar("admin_email", { length: 255 }),
    action: varchar("action", { length: 50 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: varchar("resource_id", { length: 64 }),
    resourceLabel: varchar("resource_label", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull(),
    changes: jsonb("changes"),
    metadata: jsonb("metadata"),
    clientIp: varchar("client_ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(
      sql`now()`
    ),
  },
  (table) => [
    index("idx_audit_logs_created_at").on(table.createdAt),
    index("idx_audit_logs_admin_created").on(table.adminId, table.createdAt),
    index("idx_audit_logs_resource").on(table.resourceType, table.resourceId),
    index("idx_audit_logs_action").on(table.action),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupModel = typeof groupModels.$inferSelect;
export type GroupModelQuota = typeof groupModelQuotas.$inferSelect;
export type NewGroupModelQuota = typeof groupModelQuotas.$inferInsert;
export type Model = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;
export type UserModel = typeof userModels.$inferSelect;
export type UserModelQuota = typeof userModelQuotas.$inferSelect;
export type NewUserModelQuota = typeof userModelQuotas.$inferInsert;
export type UsageLog = typeof usageLogs.$inferSelect;
export type DailyUsage = typeof dailyUsage.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
