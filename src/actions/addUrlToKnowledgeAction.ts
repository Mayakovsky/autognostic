import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";

export const AddUrlToKnowledgeAction: Action = {
  name: "ADD_URL_TO_KNOWLEDGE",
  description:
    "Add a single document from a URL into the agent's Knowledge (requires Datamirror token).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public URL of the document to add." },
      filename: { type: "string", description: "Optional filename hint." },
      roomId: { type: "string", description: "Room/context ID for this knowledge." },
      authToken: { type: "string", description: "Datamirror auth token for write permissions." },
    },
    required: ["url", "authToken"],
  },

  // Required by @elizaos/core@1.6.5 Action type
  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<void | ActionResult | undefined> {
    // Use provided token or fall back to env var (dev convenience)
    const authToken = (args.authToken as string | undefined) || process.env.DATAMIRROR_AUTH_TOKEN;

    // Validate auth token before proceeding
    try {
      requireValidToken(runtime, authToken);
    } catch (err) {
      if (err instanceof DatamirrorAuthError) {
        return {
          success: false,
          text: err.message,
          data: { error: "auth_failed" },
        };
      }
      throw err;
    }

    const url = args.url as string | undefined;
    if (!url) {
      return {
        success: false,
        text: "Missing required parameter: url",
        data: { error: "missing_url" },
      };
    }
    const filename =
      (args.filename as string) || url.split("/").pop() || "document";
    const roomId: any =
      args.roomId || (runtime as any).defaultRoomId || runtime.agentId;

    await mirrorDocToKnowledge(runtime, {
      url,
      filename,
      roomId,
      entityId: runtime.agentId,
      worldId: runtime.agentId,
      metadata: { addedVia: "ADD_URL_TO_KNOWLEDGE" },
    });

    return {
      success: true,
      text: `Added ${url} to Knowledge.`,
      data: { url, filename, roomId },
    };
  },
};
