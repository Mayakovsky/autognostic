import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { removeDocumentByUrl } from "../integration/removeFromKnowledge";
import { safeSerialize } from "../utils/safeSerialize";

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
  examples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Remove https://example.com/old-doc.md from knowledge" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Document removed from knowledge base: old-doc.md",
          actions: ["REMOVE_KNOWLEDGE_DOCUMENT"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Delete that paper from the knowledge base" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Removed arxiv-2401.12345 from knowledge base (semantic and verbatim stores cleared).",
          actions: ["REMOVE_KNOWLEDGE_DOCUMENT"],
        },
      },
    ],
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
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(remove|delete|forget).*(document|url|page)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<ActionResult> {
    const args = (_message.content as Record<string, unknown>) || {};

    try {
      requireValidToken(runtime, args.authToken as string | undefined);
    } catch (err) {
      if (err instanceof AutognosticAuthError) {
        const text = err.message;
        if (callback) {
          await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
        }
        return { success: false, text, data: safeSerialize({ error: "auth_failed" }) };
      }
      throw err;
    }

    const url = args.url as string;
    if (!url) {
      const text = "URL is required to identify the document to remove.";
      if (callback) {
        await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      }
      return { success: false, text, data: safeSerialize({ error: "missing_url" }) };
    }

    const result = await removeDocumentByUrl(runtime, url);

    if (!result.success) {
      const text = result.error || `Failed to remove document: ${url}`;
      if (callback) {
        await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      }
      return { success: false, text, data: safeSerialize({ error: "not_found", url }) };
    }

    const text = `Removed document ${url} from both semantic and verbatim stores.`;
    if (callback) {
      await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
    }
    return {
      success: true,
      text,
      data: safeSerialize({ url, removed: true }),
    };
  },
};
