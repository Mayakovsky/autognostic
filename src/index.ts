import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { ModelType } from "@elizaos/core";
import { BUILD_META } from "./config/buildmeta";
import { ollamaDirectEmbed } from "./providers/ollamaDirectEmbed";

import { HttpService } from "./services/httpService";
import { GithubService } from "./services/githubService";
import { AutognosticService } from "./services/AutognosticService";

import { AddUrlToKnowledgeAction } from "./actions/addUrlToKnowledgeAction";
import { MirrorSourceToKnowledgeAction } from "./actions/mirrorSourceToKnowledgeAction";
import { SetAutognosticSizePolicyAction } from "./actions/setAutognosticSizePolicyAction";
import { ListSourcesAction } from "./actions/listSourcesAction";
import { RemoveSourceAction } from "./actions/removeSourceAction";
import { GetQuoteAction } from "./actions/getQuoteAction";
import { ListDocumentsAction } from "./actions/listDocumentsAction";
import { RemoveDocumentAction } from "./actions/removeDocumentAction";
import { SetVersionTrackingAction } from "./actions/setVersionTrackingAction";
import { RefreshSourceAction } from "./actions/refreshSourceAction";
import { FindRelatedPapersAction } from "./actions/findRelatedPapersAction";

import { fullDocumentProvider } from "./providers/fullDocumentProvider";
import { knowledgeSummaryProvider } from "./providers/knowledgeSummaryProvider";

import { autognosticSchema } from "./schema";

/**
 * Plugin initialization - runs after ElizaOS creates tables from schema.
 * Seeds reference data (taxonomy nodes, controlled vocabulary).
 */
async function initPlugin(_config: Record<string, string>, runtime: IAgentRuntime): Promise<void> {
  console.log(`[autognostic] Plugin loaded — Phase ${BUILD_META.phase}, built ${BUILD_META.builtAt}`);
  console.log("[autognostic] Initializing plugin...");
  
  // Give database time to initialize (especially for PGlite)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    // Dynamic import to avoid circular dependency
    const { DatabaseSeeder } = await import("./services/DatabaseSeeder");
    const seeder = new DatabaseSeeder(runtime);
    const result = await seeder.seedIfEmpty();
    
    if (result.taxonomySeeded > 0 || result.vocabSeeded > 0) {
      console.log(
        `[autognostic] Seeded ${result.taxonomySeeded} taxonomy nodes, ` +
        `${result.vocabSeeded} vocabulary terms`
      );
    } else {
      const status = await seeder.checkSeedStatus();
      if (status.taxonomyCount > 0 || status.vocabCount > 0) {
        console.log(
          `[autognostic] Found ${status.taxonomyCount} taxonomy nodes, ` +
          `${status.vocabCount} vocabulary terms`
        );
      } else {
        console.log("[autognostic] Initialized (seed data created on first use)");
      }
    }
  } catch (err) {
    console.warn("[autognostic] Init note:", err instanceof Error ? err.message : err);
  }
}

export const autognosticPlugin: Plugin = {
  name: "@elizaos/plugin-autognostic",
  description:
    "Autognostic - Conversational Automated Knowledge Control. " +
    "Enables agents to build, manage, and query their own knowledge base through conversation. " +
    "Includes scientific paper detection, classification (5-level taxonomy), and lakehouse zones.",
  init: initPlugin,
  // Declare plugin dependencies - ElizaOS will load these before this plugin
  dependencies: ["@elizaos/plugin-knowledge", "@elizaos/plugin-sql"],
  services: [HttpService, GithubService, AutognosticService],
  actions: [
    AddUrlToKnowledgeAction,
    MirrorSourceToKnowledgeAction,
    ListSourcesAction,
    ListDocumentsAction,
    GetQuoteAction,
    RemoveSourceAction,
    RemoveDocumentAction,
    SetAutognosticSizePolicyAction,
    SetVersionTrackingAction,
    RefreshSourceAction,
    FindRelatedPapersAction,
  ],
  providers: [knowledgeSummaryProvider, fullDocumentProvider],
  // Override plugin-ollama's broken TEXT_EMBEDDING handler (ollama-ai-provider v1
  // is incompatible with ai SDK v5's spec v2 requirement).
  // This calls the Ollama REST API directly — proven working in test-embedding.ts.
  models: {
    [ModelType.TEXT_EMBEDDING]: ollamaDirectEmbed,
  },
  schema: autognosticSchema,
};

export default autognosticPlugin;

// ============================================================================
// RE-EXPORTS (for external consumers)
// ============================================================================

export { removeFromKnowledge, removeDocumentByUrl } from "./integration/removeFromKnowledge";
export { getScheduledSyncService } from "./services/ScheduledSyncService";
export { getExactQuote, getExactQuoteAll } from "./integration/getExactQuote";

// Scientific paper detection & classification
export { 
  ScientificPaperDetector,
  getScientificPaperDetector,
  type DetectionResult,
} from "./services/ScientificPaperDetector";

export {
  ScientificPaperHandler,
  createScientificPaperHandler,
  type ClassificationResult,
  type HandlerResult,
} from "./services/ScientificPaperHandler";

export { DatabaseSeeder } from "./services/DatabaseSeeder";

// Discovery layer (Phase 4)
export {
  resolveOpenAccess,
  extractDoiFromUrl,
  type UnpaywallResult,
} from "./services/UnpaywallResolver";

export {
  lookupPaper,
  getRelatedPapers,
  getCitations,
  getReferences,
  buildPaperId,
  type S2Paper,
  type S2RelatedResult,
} from "./services/SemanticScholarService";

// Schema types
export type {
  StaticDetectionMetadata,
  ClassificationPath,
  ResearchFocus,
  ClassificationEvidence,
  PaperMetadata,
} from "./db/schema";

export type {
  TaxonomyNodeSeed,
  ControlledVocabSeed,
} from "./db/seedData";

// Error types
export {
  AutognosticError,
  AutognosticNetworkError,
  AutognosticDatabaseError,
  AutognosticValidationError,
  AutognosticClassificationError,
  AutognosticStorageError,
  AutognosticAuthError,
  ErrorCode,
  wrapError,
  isAutognosticError,
  getErrorCode,
  type ErrorContext,
  type SerializedError,
} from "./errors";

// Utilities
export { logger, createLogger, type LogLevel, type LogEntry } from "./utils/logger";
export { withRetry, RetryPresets, type RetryConfig } from "./utils/retry";
