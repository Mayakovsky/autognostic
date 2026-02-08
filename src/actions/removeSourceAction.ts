import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { getDb } from "../db/getDb";
import { autognosticSources, autognosticDocuments } from "../db/schema";
import { eq } from "drizzle-orm";
import { removeSourceFromKnowledge } from "../integration/removeFromKnowledge";
import { safeSerialize } from "../utils/safeSerialize";

export const RemoveSourceAction: Action = {
  name: "REMOVE_AUTOGNOSTIC_SOURCE",
  description: "Remove a knowledge source and its documents from both stores. Requires auth token.",
  similes: ["DELETE_SOURCE", "REMOVE_MIRROR", "UNMIRROR", "REMOVE_SOURCE"],
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "ID of the source to remove" },
      authToken: { type: "string", description: "Autognostic auth token" },
    },
    required: ["sourceId", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(remove|delete|unmirror).*(source|mirror|knowledge)/i.test(text);
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
          await callback({ text, action: "REMOVE_AUTOGNOSTIC_SOURCE" });
        }
        return { success: false, text, data: safeSerialize({ error: "auth_failed" }) };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    if (!sourceId) {
      const text = "sourceId is required";
      if (callback) {
        await callback({ text, action: "REMOVE_AUTOGNOSTIC_SOURCE" });
      }
      return { success: false, text, data: safeSerialize({ error: "missing_source_id" }) };
    }

    // CASCADE: Remove from semantic store (plugin-knowledge) first
    const knowledgeResult = await removeSourceFromKnowledge(runtime, sourceId);

    const db = await getDb(runtime);

    // Delete documents from verbatim store
    if (db.delete) {
      await db.delete(autognosticDocuments).where(eq(autognosticDocuments.sourceId, sourceId));
    }

    // Delete source (versions and knowledge_link cascade from FK)
    if (db.delete) {
      await db.delete(autognosticSources).where(eq(autognosticSources.id, sourceId));
    }

    const text =
      `Removed source ${sourceId} and all associated documents from both stores. ` +
      `Semantic: ${knowledgeResult.removed} removed, ${knowledgeResult.failed} failed.`;
    if (callback) {
      await callback({ text, action: "REMOVE_AUTOGNOSTIC_SOURCE" });
    }
    return {
      success: true,
      text,
      data: safeSerialize({ sourceId, removed: true, knowledgeResult }),
    };
  },
};
