import type { Plugin, IAgentRuntime } from "@elizaos/core";

import { HttpService } from "./services/httpService";
import { GithubService } from "./services/githubService";
import { AutognosticService } from "./services/AutognosticService";
import { DatabaseSeeder } from "./services/DatabaseSeeder";

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

import { fullDocumentProvider } from "./providers/fullDocumentProvider";
import { knowledgeSummaryProvider } from "./providers/knowledgeSummaryProvider";

import { autognosticSchema } from "./schema";

export const autognosticPlugin: Plugin = {
  name: "@elizaos/plugin-autognostic",
  description:
    "Autognostic - Conversational Automated Knowledge Control. " +
    "Enables agents to build, manage, and query their own knowledge base through conversation. " +
    "Includes scientific paper detection, classification (5-level taxonomy), and lakehouse zones.",
  
  /**
   * Initialize plugin - seed reference data on startup.
   * Works with both PGlite (local) and PostgreSQL (cloud) backends.
   */
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    console.log("[autognostic] Initializing plugin...");
    
    // Give database time to initialize (especially for PGlite)
    // ElizaOS creates tables from schema export before init runs
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const seeder = new DatabaseSeeder(runtime);
      const result = await seeder.seedIfEmpty();
      
      if (result.taxonomySeeded > 0 || result.vocabSeeded > 0) {
        console.log(
          `[autognostic] Initialized: seeded ${result.taxonomySeeded} taxonomy nodes, ` +
          `${result.vocabSeeded} vocabulary terms`
        );
      } else {
        // Check if data already exists
        const status = await seeder.checkSeedStatus();
        if (status.taxonomyCount > 0 || status.vocabCount > 0) {
          console.log(
            `[autognostic] Initialized: found ${status.taxonomyCount} taxonomy nodes, ` +
            `${status.vocabCount} vocabulary terms`
          );
        } else {
          console.log("[autognostic] Initialized (seed data will be created on first classification)");
        }
      }
    } catch (err) {
      // Non-fatal - plugin can still function, classification will work without seed data
      console.warn("[autognostic] Initialization note:", err instanceof Error ? err.message : err);
      console.log("[autognostic] Plugin initialized (seed data may be created later)");
    }
  },
  
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
  ],
  providers: [knowledgeSummaryProvider, fullDocumentProvider],
  schema: autognosticSchema,
};

export default autognosticPlugin;

// Re-exports for external use
export { removeFromKnowledge, removeDocumentByUrl } from "./integration/removeFromKnowledge";

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

// Database seeding
export { DatabaseSeeder } from "./services/DatabaseSeeder";

// Scheduled sync
export { getScheduledSyncService } from "./services/ScheduledSyncService";

// Quote retrieval
export {
  getExactQuote,
  getLineContent,
  getFullDocument,
} from "./integration/getExactQuote";

// Schema types
export type {
  StaticDetectionMetadata,
  ClassificationPath,
  ResearchFocus,
  ClassificationEvidence,
  PaperMetadata,
} from "./db/schema";

// Seed data types
export type {
  TaxonomyNodeSeed,
  ControlledVocabSeed,
} from "./db/seedData";
