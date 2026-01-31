import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { removeDocumentByUrl } from "../integration/removeFromKnowledge";

export const RemoveDocumentAction: Action = {
  name: "REMOVE_KNOWLEDGE_DOCUMENT",
  description:
    "Remove a single document from the knowledge base (both semantic and verbatim stores). Requires auth token.",
  similes: [
    "DELETE_DOCUMENT",
    "REMOVE_DOCUMENT",
    "FORGET_DOCUMENT",
    "REMOVE_FROM_KNOWLEDGE",
  ],
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL of the document to remove" },
      authToken: {
        type: "string",
        description: "Autognostic auth token for write permissions",
      },
    },
    required: ["url", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(remove|delete|forget).*(document|url|page)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (_message.content as any) || {};

    try {
      requireValidToken(runtime, args.authToken);
    } catch (err) {
      if (err instanceof AutognosticAuthError) {
        const text = err.message;
        if (callback) {
          await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
        }
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const url = args.url as string;
    if (!url) {
      const text = "URL is required to identify the document to remove.";
      if (callback) {
        await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      }
      return { success: false, text, data: { error: "missing_url" } };
    }

    const result = await removeDocumentByUrl(runtime, url);

    if (!result.success) {
      const text = result.error || `Failed to remove document: ${url}`;
      if (callback) {
        await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      }
      return { success: false, text, data: { error: "not_found", url } };
    }

    const text = `Removed document ${url} from both semantic and verbatim stores.`;
    if (callback) {
      await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
    }
    return {
      success: true,
      text,
      data: { url, removed: true },
    };
  },
};
