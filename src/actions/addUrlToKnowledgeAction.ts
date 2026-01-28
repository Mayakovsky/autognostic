import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";
import { randomUUID } from "crypto";

// Extract URL from message text
function extractUrlFromText(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex);
  return matches?.[0] || null;
}

export const AddUrlToKnowledgeAction: Action = {
  name: "ADD_URL_TO_KNOWLEDGE",
  description:
    "Add a single document from a URL into the agent's Knowledge. Use when user shares a URL and wants to add it to knowledge base.",
  similes: [
    "ADD_URL",
    "SAVE_URL",
    "LEARN_URL",
    "REMEMBER_URL",
    "ADD_DOCUMENT",
    "SAVE_DOCUMENT",
  ],
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public URL of the document to add." },
      filename: { type: "string", description: "Optional filename hint." },
      roomId: { type: "string", description: "Room/context ID for this knowledge." },
      authToken: { type: "string", description: "Datamirror auth token for write permissions." },
    },
    required: ["url"],
  },

  // Validate: only trigger if message contains a URL
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content as any)?.text || "";
    return extractUrlFromText(text) !== null;
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
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

    // Try args.url first, then extract from message text
    const messageText = (message.content as any)?.text || "";
    const url = (args.url as string | undefined) || extractUrlFromText(messageText);

    if (!url) {
      return {
        success: false,
        text: "No URL found. Please provide a URL to add to knowledge.",
        data: { error: "missing_url" },
      };
    }
    const filename =
      (args.filename as string) || url.split("/").pop() || "document";
    const roomId: any =
      args.roomId || (runtime as any).defaultRoomId || runtime.agentId;

    // Generate sourceId and versionId for full document storage
    const sourceId = randomUUID();
    const versionId = `v1-${Date.now()}`;

    const result = await mirrorDocToKnowledge(runtime, {
      url,
      filename,
      roomId,
      entityId: runtime.agentId,
      worldId: runtime.agentId,
      metadata: {
        addedVia: "ADD_URL_TO_KNOWLEDGE",
        sourceId,
        versionId,
      },
    });

    return {
      success: true,
      text: `Added ${url} to Knowledge. Full document archived for direct quotes.`,
      data: { url, filename, roomId, sourceId, versionId, ...result },
    };
  },
};
