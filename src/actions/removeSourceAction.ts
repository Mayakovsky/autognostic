import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";
import { getDb } from "../db/getDb";
import { datamirrorSources, datamirrorDocuments } from "../db/schema";
import { eq } from "drizzle-orm";

export const RemoveSourceAction: Action = {
  name: "REMOVE_DATAMIRROR_SOURCE",
  description: "Remove a mirrored source and its documents. Requires auth token.",
  similes: ["DELETE_SOURCE", "REMOVE_MIRROR", "UNMIRROR"],
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "ID of the source to remove" },
      authToken: { type: "string", description: "Datamirror auth token" },
    },
    required: ["sourceId", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(remove|delete|unmirror).*(source|mirror)/i.test(text);
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
      if (err instanceof DatamirrorAuthError) {
        const text = err.message;
        if (callback) {
          await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
        }
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    if (!sourceId) {
      const text = "sourceId is required";
      if (callback) {
        await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
      }
      return { success: false, text, data: { error: "missing_source_id" } };
    }

    const db = await getDb(runtime);

    // Delete documents first (cascade should handle this, but be explicit)
    if (db.delete) {
      await db.delete(datamirrorDocuments).where(eq(datamirrorDocuments.sourceId, sourceId));
    }

    // Note: versions and knowledge_link will cascade delete from sources
    if (db.delete) {
      await db.delete(datamirrorSources).where(eq(datamirrorSources.id, sourceId));
    }

    const text = `Removed source ${sourceId} and all associated documents.`;
    if (callback) {
      await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
    }
    return {
      success: true,
      text,
      data: { sourceId, removed: true },
    };
  },
};
