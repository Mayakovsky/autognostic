import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { ReconciliationService } from "../orchestrator/ReconciliationService";
import type { SourceConfig } from "../orchestrator/SourceConfig";

export const MirrorSourceToKnowledgeAction: Action = {
  name: "MIRROR_SOURCE_TO_KNOWLEDGE",
  description:
    "Discover and mirror a docs source (site or repo) into Knowledge (requires Datamirror token).",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "Optional ID for the source." },
      sourceUrl: { type: "string", description: "Root URL of the source to mirror." },
      authToken: { type: "string", description: "Datamirror auth token for write permissions." },
    },
    required: ["sourceUrl", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<void | ActionResult | undefined> {
    const sourceId = (args.sourceId as string) || `source-${Date.now()}`;
    const sourceUrl = args.sourceUrl as string;

    const reconciler = new ReconciliationService(runtime);
    const src: SourceConfig = { id: sourceId, sourceUrl, enabled: true };

    await reconciler.verifyAndReconcileOne(src);

    return {
      success: true,
      text: `Mirrored source ${sourceId} from ${sourceUrl} into Knowledge (or verified as up-to-date).`,
      data: { sourceId, sourceUrl },
    };
  },
};
