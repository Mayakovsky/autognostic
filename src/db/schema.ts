import {
  pgSchema,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
} from "drizzle-orm/pg-core";

// Create dedicated schema for plugin isolation
const autognostic = pgSchema("autognostic");

export const autognosticSettings = autognostic.table("settings", {
  agentId: text("agent_id").primaryKey(),
  sizePolicyJson: jsonb("size_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type AutognosticSettingsRow = typeof autognosticSettings.$inferSelect;

export const autognosticRefreshSettings = autognostic.table("refresh_settings", {
  agentId: text("agent_id").primaryKey(),
  refreshPolicyJson: jsonb("refresh_policy_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type AutognosticRefreshSettingsRow =
  typeof autognosticRefreshSettings.$inferSelect;

export const autognosticPreviewCache = autognostic.table("preview_cache", {
  sourceId: text("source_id").primaryKey(),
  previewJson: jsonb("preview_json").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});
export type AutognosticPreviewCacheRow =
  typeof autognosticPreviewCache.$inferSelect;

export const autognosticSources = autognostic.table("sources", {
  id: text("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Version tracking control
  versionTrackingEnabled: boolean("version_tracking_enabled").notNull().default(true),
  isStaticContent: boolean("is_static_content").notNull().default(false),
  staticDetectionMetadata: jsonb("static_detection_metadata").$type<StaticDetectionMetadata | null>(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
});
export type AutognosticSourceRow = typeof autognosticSources.$inferSelect;

export const autognosticVersions = autognostic.table("versions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => autognosticSources.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  status: text("status").notNull(), // 'staging' | 'active' | 'archived' | 'failed'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
});
export type AutognosticVersionRow = typeof autognosticVersions.$inferSelect;

export const autognosticKnowledgeLink = autognostic.table("knowledge_link", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => autognosticSources.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  knowledgeDocumentId: text("knowledge_document_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type AutognosticKnowledgeLinkRow =
  typeof autognosticKnowledgeLink.$inferSelect;

export const autognosticDocuments = autognostic.table("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: text("source_id").notNull(),
  versionId: text("version_id").notNull(),
  url: text("url").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type"),
  byteSize: integer("byte_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export type AutognosticDocumentsRow = typeof autognosticDocuments.$inferSelect;

// Sync configuration
export const autognosticSyncConfig = autognostic.table("sync_config", {
  id: text("id").primaryKey().default("default"),
  cronExpression: text("cron_expression").default("0 3 * * *"),
  timezone: text("timezone").default("UTC"),
  stalenessThresholdHours: integer("staleness_threshold_hours").default(24),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Sync log
export const autognosticSyncLog = autognostic.table("sync_log", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull(), // 'running' | 'completed' | 'failed'
  sourcesChecked: integer("sources_checked").default(0),
  sourcesUpdated: integer("sources_updated").default(0),
  sourcesSkipped: integer("sources_skipped").default(0),
  documentsAdded: integer("documents_added").default(0),
  documentsRemoved: integer("documents_removed").default(0),
  errors: jsonb("errors"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Type for static detection metadata
export interface StaticDetectionMetadata {
  detectedAt: string;
  reason: 'doi_verified' | 'issn_verified' | 'url_pattern' | 'content_analysis' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  doi?: string;
  issn?: string;
  crossrefData?: {
    type?: string;
    title?: string;
    journal?: string;
    publisher?: string;
    publishedDate?: string;
  };
}

export interface SyncLogEntry {
  id: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  sourcesChecked: number;
  sourcesUpdated: number;
  sourcesSkipped: number;
  documentsAdded: number;
  documentsRemoved: number;
  errors?: any[];
}

// Database indexes for performance
export const autognosticDocumentsUrlIdx = index("autognostic_documents_url_idx").on(autognosticDocuments.url);
export const autognosticDocumentsSourceVersionIdx = index("autognostic_documents_source_version_idx")
  .on(autognosticDocuments.sourceId, autognosticDocuments.versionId);
export const autognosticVersionsSourceStatusIdx = index("autognostic_versions_source_status_idx")
  .on(autognosticVersions.sourceId, autognosticVersions.status);
