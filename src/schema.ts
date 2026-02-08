import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import {
  autognosticSettings,
  autognosticRefreshSettings,
  autognosticPreviewCache,
  autognosticSources,
  autognosticVersions,
  autognosticKnowledgeLink,
  autognosticDocuments,
  autognosticSyncConfig,
  autognosticSyncLog,
  autognosticPaperClassification,
  autognosticTaxonomyNodes,
  autognosticControlledVocab,
} from "./db/schema";

export const autognosticSchema: Record<string, PgTable<TableConfig>> = {
  autognosticSettings,
  autognosticRefreshSettings,
  autognosticPreviewCache,
  autognosticSources,
  autognosticVersions,
  autognosticKnowledgeLink,
  autognosticDocuments,
  autognosticSyncConfig,
  autognosticSyncLog,
  // Scientific paper classification tables
  autognosticPaperClassification,
  autognosticTaxonomyNodes,
  autognosticControlledVocab,
};
