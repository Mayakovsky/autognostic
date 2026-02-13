import {
  pgSchema,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
  real,
} from "drizzle-orm/pg-core";

// Create dedicated schema for plugin isolation
const autognostic = pgSchema("autognostic");

// ============================================================================
// CORE TABLES
// ============================================================================

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
}, (table) => ({
  sourceStatusIdx: index("autognostic_versions_source_status_idx").on(table.sourceId, table.status),
}));
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
  profile: jsonb("profile").$type<import("../services/DocumentAnalyzer.types").DocumentProfile | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  urlIdx: index("autognostic_documents_url_idx").on(table.url),
  sourceVersionIdx: index("autognostic_documents_source_version_idx").on(table.sourceId, table.versionId),
}));
export type AutognosticDocumentsRow = typeof autognosticDocuments.$inferSelect;

// ============================================================================
// SCIENTIFIC PAPER CLASSIFICATION TABLES
// ============================================================================

/**
 * Scientific Paper Classification Record
 * Implements the 5-level taxonomy from scientific_paper_classification_schema.md
 * 
 * Lakehouse Zones:
 * - Bronze: Raw document (no classification)
 * - Silver: DOI/ISSN verified scientific paper
 * - Gold: Fully classified with L1-L4 path + L5 focus facets
 */
export const autognosticPaperClassification = autognostic.table("paper_classification", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull(),

  // Lakehouse zone tracking
  zone: text("zone").notNull().default("bronze"), // 'bronze' | 'silver' | 'gold'
  promotedToSilverAt: timestamp("promoted_to_silver_at", { withTimezone: true }),
  promotedToGoldAt: timestamp("promoted_to_gold_at", { withTimezone: true }),

  // Primary classification path (L1 → L4)
  primaryPath: jsonb("primary_path").$type<ClassificationPath | null>(),

  // Secondary classification paths (for interdisciplinary papers)
  secondaryPaths: jsonb("secondary_paths").$type<ClassificationPath[]>(),

  // Level 5: Research Focus (structured facets)
  focus: jsonb("focus").$type<ResearchFocus | null>(),

  // Classification metadata
  confidence: real("confidence"), // 0.0 - 1.0
  evidence: jsonb("evidence").$type<ClassificationEvidence[]>(),
  classifierVersion: text("classifier_version"),

  // Paper metadata extracted from Crossref/content
  paperMetadata: jsonb("paper_metadata").$type<PaperMetadata | null>(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  docIdx: index("autognostic_paper_class_doc_idx").on(table.documentId),
  zoneIdx: index("autognostic_paper_class_zone_idx").on(table.zone),
}));
export type AutognosticPaperClassificationRow = typeof autognosticPaperClassification.$inferSelect;

/**
 * Taxonomy nodes for L1-L4 hierarchy
 * Stores the controlled vocabulary for classification
 */
export const autognosticTaxonomyNodes = autognostic.table("taxonomy_nodes", {
  id: text("id").primaryKey(), // e.g., "L1.NATSCI", "L2.NATSCI.PHYS"
  level: integer("level").notNull(), // 1-4
  name: text("name").notNull(),
  parentId: text("parent_id"),
  aliases: jsonb("aliases").$type<string[]>(),
  definition: text("definition"),
  keywords: jsonb("keywords").$type<string[]>(),
  examples: jsonb("examples").$type<string[]>(),
  status: text("status").notNull().default("active"), // 'active' | 'deprecated'
  versionIntroduced: text("version_introduced").default("1.0"),
  versionDeprecated: text("version_deprecated"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  levelIdx: index("autognostic_taxonomy_level_idx").on(table.level),
}));
export type AutognosticTaxonomyNodeRow = typeof autognosticTaxonomyNodes.$inferSelect;

/**
 * Controlled vocabulary for Level 5 facets
 */
export const autognosticControlledVocab = autognostic.table("controlled_vocab", {
  id: text("id").primaryKey(),
  facetType: text("facet_type").notNull(), // 'task_study_type' | 'method_approach' | etc.
  term: text("term").notNull(),
  aliases: jsonb("aliases").$type<string[]>(),
  definition: text("definition"),
  status: text("status").notNull().default("active"),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  facetIdx: index("autognostic_vocab_facet_idx").on(table.facetType),
}));
export type AutognosticControlledVocabRow = typeof autognosticControlledVocab.$inferSelect;

// ============================================================================
// SYNC TABLES
// ============================================================================

export const autognosticSyncConfig = autognostic.table("sync_config", {
  id: text("id").primaryKey().default("default"),
  cronExpression: text("cron_expression").default("0 3 * * *"),
  timezone: text("timezone").default("UTC"),
  stalenessThresholdHours: integer("staleness_threshold_hours").default(24),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Static detection metadata (for version tracking decisions) */
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
    subjects?: string[];
    authors?: string[];
    abstract?: string;
  };
}

/** Classification path (L1 → L4) */
export interface ClassificationPath {
  l1: string; // e.g., "L1.NATSCI"
  l2: string; // e.g., "L2.NATSCI.PHYS"
  l3?: string; // e.g., "L3.NATSCI.PHYS.COND_MAT"
  l4?: string; // e.g., "L4.NATSCI.PHYS.COND_MAT.SUPERCONDUCT"
  confidence?: number;
}

/** Level 5: Research Focus (structured facets) */
export interface ResearchFocus {
  // Required facets
  phenomenonTopic: string[];
  taskStudyType: string[];
  methodApproach: string[];
  entitySystem: string[];
  
  // Optional facets
  measurementOutcome?: string[];
  contextSetting?: string[];
  applicationImpact?: string[];
  
  // Free-text summary (<=160 chars)
  freeTextFocus?: string;
  
  // Additional metadata
  noveltyClaims?: string[];
  keyTerms?: string[];
  citationsGraphHooks?: string[]; // dataset IDs, gene IDs, arXiv categories, etc.
}

/** Evidence supporting classification */
export interface ClassificationEvidence {
  field: 'title' | 'abstract' | 'keywords' | 'methods' | 'conclusions' | 'full_text';
  snippet: string;
  relevance?: number;
}

/** Paper metadata extracted from Crossref or content */
export interface PaperMetadata {
  doi?: string;
  title?: string;
  authors?: string[];
  journal?: string;
  publisher?: string;
  publishedDate?: string;
  abstract?: string;
  keywords?: string[];
  subjects?: string[]; // Crossref subject areas
  references?: number;
  citedBy?: number;
  license?: string;
  arxivCategories?: string[];
  pubmedId?: string;
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
  errors?: Array<{ sourceId?: string; error: string }>;
}

