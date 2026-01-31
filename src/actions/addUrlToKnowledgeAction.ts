import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import { validateToken, isAuthEnabled, AutognosticAuthError } from "../auth/validateToken";
import { randomUUID } from "crypto";

// Extract URL from message text
// Supports both full URLs (https://example.com/...) and bare hostnames (example.com/...)
function extractUrlFromText(text: string): string | null {
  // First try full URLs with protocol
  const fullUrlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const fullMatch = text.match(fullUrlRegex);
  if (fullMatch?.[0]) return fullMatch[0];

  // Then try bare hostnames: word.tld/path (e.g. github.com/user/repo/file.md)
  const bareUrlRegex = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})+\/[^\s<>"{}|\\^`\[\]]+/gi;
  const bareMatch = text.match(bareUrlRegex);
  if (bareMatch?.[0]) return `https://${bareMatch[0]}`;

  return null;
}

// Extract auth token from message text
// Looks for patterns like "token: xyz", "password: xyz", "auth: xyz", or just a standalone token-like string
function extractTokenFromText(text: string): string | null {
  // Pattern 1: Explicit token/password/auth prefix
  const explicitPatterns = [
    /(?:token|password|auth|key)[\s:=]+["']?([^\s"']+)["']?/i,
    /(?:with|using)\s+(?:token|password|auth)[\s:=]*["']?([^\s"']+)["']?/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

export const AddUrlToKnowledgeAction: Action = {
  name: "ADD_URL_TO_KNOWLEDGE",
  description:
    "Add a single document from a URL into the agent's Knowledge. Use when user shares a URL and wants to add it to knowledge base. If authentication is enabled and no token is provided, ask the user for the auth token.",
  similes: [
    "ADD_URL",
    "SAVE_URL",
    "LEARN_URL",
    "REMEMBER_URL",
    "ADD_DOCUMENT",
    "SAVE_DOCUMENT",
    "ADD_TO_KNOWLEDGE",
  ],
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL of the document to add.",
      },
      filename: {
        type: "string",
        description: "Optional filename hint.",
      },
      roomId: {
        type: "string",
        description: "Room/context ID for this knowledge.",
      },
      authToken: {
        type: "string",
        description:
          "Auth token for write permissions. Required only if authentication is enabled. " +
          "If auth is enabled and token is not provided, the agent should ask for it.",
      },
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
    const messageText = (message.content as any)?.text || "";

    // Try to get token from args, then from message text
    const providedToken =
      (args.authToken as string | undefined) ||
      extractTokenFromText(messageText);

    // Validate authentication
    const authResult = validateToken(runtime, providedToken ?? undefined);

    if (!authResult.valid) {
      // Auth is enabled but token missing or invalid
      if (authResult.needsToken) {
        // Ask the user for the token
        return {
          success: false,
          text:
            "Authentication is required to add documents to knowledge. " +
            "Please provide the auth token. You can say something like: " +
            '"Add this URL with token: your-token-here" or just provide the token.',
          data: {
            error: "auth_required",
            authEnabled: true,
            needsToken: true,
          },
        };
      }

      // Auth failed for other reason (invalid token, misconfiguration)
      return {
        success: false,
        text: authResult.error || "Authentication failed.",
        data: {
          error: "auth_failed",
          authEnabled: authResult.authEnabled,
        },
      };
    }

    // Extract URL from args or message
    const url = (args.url as string | undefined) || extractUrlFromText(messageText);

    if (!url) {
      return {
        success: false,
        text: "No URL found. Please provide a URL to add to knowledge.",
        data: { error: "missing_url" },
      };
    }

    // Generate sourceId and versionId for full document storage
    const sourceId = randomUUID();
    const versionId = `v1-${Date.now()}`;

    const filename =
      (args.filename as string) || url.split("/").pop() || "document";
    const roomId: any =
      args.roomId || (runtime as any).defaultRoomId || runtime.agentId;

    try {
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

      const authStatus = isAuthEnabled(runtime)
        ? " (authenticated)"
        : "";

      return {
        success: true,
        text: `Added ${url} to Knowledge${authStatus}. Full document archived for direct quotes.`,
        data: {
          url,
          filename,
          roomId,
          sourceId,
          versionId,
          authEnabled: isAuthEnabled(runtime),
          ...result,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        success: false,
        text: `Failed to add document: ${errorMessage}`,
        data: { error: "ingestion_failed", details: errorMessage },
      };
    }
  },
};
