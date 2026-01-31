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
    "Enables agents to build, manage, and query their own knowledge base through conversation.",
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

// Re-exports
export { removeFromKnowledge, removeDocumentByUrl } from "./integration/removeFromKnowledge";
export { getScientificPaperDetector } from "./services/ScientificPaperDetector";
export { getScheduledSyncService } from "./services/ScheduledSyncService";
export {
  getExactQuote,
  getLineContent,
  getFullDocument,
} from "./integration/getExactQuote";
