import {
  pgSchema,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  integer,
} from "drizzle-orm/pg-core";

// Create dedicated schema for plugin isolation
const datamirror = pgSchema("datamirror");

export const datamirrorSettings = datamirror.table("settings", {
  agentId: text("agent_id").primaryKey(),
  sizePolicyJson: jsonb("size_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorSettingsRow = typeof datamirrorSettings.$inferSelect;

export const datamirrorRefreshSettings = datamirror.table("refresh_settings", {
  agentId: text("agent_id").primaryKey(),
  refreshPolicyJson: jsonb("refresh_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorRefreshSettingsRow =
  typeof datamirrorRefreshSettings.$inferSelect;

export const datamirrorPreviewCache = datamirror.table("preview_cache", {
  sourceId: text("source_id").primaryKey(),
  previewJson: jsonb("preview_json").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});
export type DatamirrorPreviewCacheRow =
  typeof datamirrorPreviewCache.$inferSelect;

export const datamirrorSources = datamirror.table("sources", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorSourceRow = typeof datamirrorSources.$inferSelect;

export const datamirrorVersions = datamirror.table("versions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => datamirrorSources.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  status: text("status").notNull(), // 'staging' | 'active' | 'archived' | 'failed'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
});
export type DatamirrorVersionRow = typeof datamirrorVersions.$inferSelect;

export const datamirrorKnowledgeLink = datamirror.table("knowledge_link", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => datamirrorSources.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  knowledgeDocumentId: text("knowledge_document_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorKnowledgeLinkRow =
  typeof datamirrorKnowledgeLink.$inferSelect;

export const datamirrorDocuments = datamirror.table("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull(),
  versionId: text("version_id").notNull(),
  url: text("url").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type"),
  byteSize: integer("byte_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export type DatamirrorDocumentsRow = typeof datamirrorDocuments.$inferSelect;
