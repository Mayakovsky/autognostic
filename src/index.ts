import type { Plugin } from "@elizaos/core";

import { HttpService } from "./services/httpService";
import { GithubService } from "./services/githubService";
import { DatamirrorService } from "./services/datamirrorService";

import { AddUrlToKnowledgeAction } from "./actions/addUrlToKnowledgeAction";
import { MirrorSourceToKnowledgeAction } from "./actions/mirrorSourceToKnowledgeAction";
import { SetDatamirrorSizePolicyAction } from "./actions/setDatamirrorSizePolicyAction";
import { SetDatamirrorRefreshPolicyAction } from "./actions/setDatamirrorRefreshPolicyAction";
import { ListSourcesAction } from "./actions/listSourcesAction";
import { RemoveSourceAction } from "./actions/removeSourceAction";
import { GetQuoteAction } from "./actions/getQuoteAction";

import { fullDocumentProvider } from "./providers/fullDocumentProvider";

import { datamirrorSchema } from "./schema";

export const datamirrorPlugin: Plugin = {
  name: "@elizaos/plugin-datamirror",
  description:
    "Mirrors external sources into Knowledge with versioning and policy controls (size limits, refresh rules, and reconciliation).",
  services: [HttpService, GithubService, DatamirrorService],
  actions: [
    AddUrlToKnowledgeAction,
    MirrorSourceToKnowledgeAction,
    SetDatamirrorSizePolicyAction,
    SetDatamirrorRefreshPolicyAction,
    ListSourcesAction,
    RemoveSourceAction,
    GetQuoteAction,
  ],
  providers: [fullDocumentProvider],
  schema: datamirrorSchema,
};

export default datamirrorPlugin;

export {
  getExactQuote,
  getLineContent,
  getFullDocument,
} from "./integration/getExactQuote";
