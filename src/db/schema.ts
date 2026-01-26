import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  integer,
} from "drizzle-orm/pg-core";

export const datamirrorSettings = pgTable("datamirror_settings", {
  agentId: text("agent_id").primaryKey(),
  sizePolicyJson: jsonb("size_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorSettingsRow = typeof datamirrorSettings.$inferSelect;

export const datamirrorRefreshSettings = pgTable("datamirror_refresh_settings", {
  agentId: text("agent_id").primaryKey(),
  refreshPolicyJson: jsonb("refresh_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorRefreshSettingsRow =
  typeof datamirrorRefreshSettings.$inferSelect;

export const datamirrorPreviewCache = pgTable("datamirror_preview_cache", {
  sourceId: text("source_id").primaryKey(),
  previewJson: jsonb("preview_json").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});
export type DatamirrorPreviewCacheRow =
  typeof datamirrorPreviewCache.$inferSelect;

export const datamirrorSources = pgTable("datamirror_sources", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DatamirrorSourceRow = typeof datamirrorSources.$inferSelect;

export const datamirrorVersions = pgTable("datamirror_versions", {
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

export const datamirrorKnowledgeLink = pgTable("datamirror_knowledge_link", {
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

export const datamirrorDocuments = pgTable("datamirror_documents", {
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
