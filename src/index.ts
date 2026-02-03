import type { Plugin } from "@elizaos/core";

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

import { fullDocumentProvider } from "./providers/fullDocumentProvider";
import { knowledgeSummaryProvider } from "./providers/knowledgeSummaryProvider";

import { autognosticSchema } from "./schema";

export const autognosticPlugin: Plugin = {
  name: "@elizaos/plugin-autognostic",
  description:
    "Autognostic - Conversational Automated Knowledge Control. " +
    "Enables agents to build, manage, and query their own knowledge base through conversation. " +
    "Includes scientific paper detection, classification (5-level taxonomy), and lakehouse zones.",
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
