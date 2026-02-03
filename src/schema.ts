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

export const autognosticSchema = {
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
