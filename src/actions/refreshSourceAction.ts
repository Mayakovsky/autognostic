import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { ReconciliationService } from "../orchestrator/ReconciliationService";
import type { SourceConfig } from "../orchestrator/SourceConfig";

export const RefreshSourceAction: Action = {
  name: "REFRESH_KNOWLEDGE_SOURCE",
  description:
    "Force an immediate sync/refresh of a knowledge source, bypassing the scheduled sync. Requires auth token.",
  similes: [
    "REFRESH_SOURCE",
    "FORCE_SYNC",
    "UPDATE_SOURCE",
    "SYNC_NOW",
    "RESYNC",
  ],
  parameters: {
    type: "object",
    properties: {
      sourceId: {
        type: "string",
        description: "ID of the source to refresh",
      },
      authToken: {
        type: "string",
        description: "Autognostic auth token for write permissions",
      },
    },
    required: ["sourceId", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(refresh|force|resync|update|sync\s+now).*(source|knowledge)/i.test(text);
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
          await callback({ text, action: "REFRESH_KNOWLEDGE_SOURCE" });
        }
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    if (!sourceId) {
      const text = "sourceId is required.";
      if (callback) {
        await callback({ text, action: "REFRESH_KNOWLEDGE_SOURCE" });
      }
      return { success: false, text, data: { error: "missing_source_id" } };
    }

    const sourcesRepo = new AutognosticSourcesRepository(runtime);
    const source = await sourcesRepo.getById(sourceId);

    if (!source) {
      const text = `Source ${sourceId} not found.`;
      if (callback) {
        await callback({ text, action: "REFRESH_KNOWLEDGE_SOURCE" });
      }
      return { success: false, text, data: { error: "source_not_found" } };
    }

    try {
      const reconciler = new ReconciliationService(runtime);
      const sourceConfig: SourceConfig = {
        id: source.id,
        sourceUrl: source.sourceUrl,
        enabled: source.enabled,
      };

      const result = await reconciler.verifyAndReconcileOne(sourceConfig);

      // Update sync timestamps
      const now = new Date();
      await sourcesRepo.updateSyncTimestamps(sourceId, now);

      const text =
        `Refreshed source ${sourceId}: ${result.status}. ` +
        `${result.fileCount ?? 0} files, ${((result.totalBytes ?? 0) / 1024 / 1024).toFixed(2)} MB.`;
      if (callback) {
        await callback({ text, action: "REFRESH_KNOWLEDGE_SOURCE" });
      }
      return {
        success: true,
        text,
        data: { sourceId, result },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const text = `Failed to refresh source ${sourceId}: ${errMsg}`;
      if (callback) {
        await callback({ text, action: "REFRESH_KNOWLEDGE_SOURCE" });
      }
      return {
        success: false,
        text,
        data: { error: "refresh_failed", details: errMsg },
      };
    }
  },
};
