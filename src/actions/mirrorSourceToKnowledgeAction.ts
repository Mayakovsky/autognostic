import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { ReconciliationService } from "../orchestrator/ReconciliationService";
import { previewSourceFiles } from "../orchestrator/previewSource";
import { createDiscoveryForRawUrl } from "../publicspace/discoveryFactory";
import { AutognosticSettingsRepository } from "../db/autognosticSettingsRepository";
import { DEFAULT_SIZE_POLICY } from "../config/SizePolicy";
import type { SourceConfig } from "../orchestrator/SourceConfig";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { safeSerialize } from "../utils/safeSerialize";

export const MirrorSourceToKnowledgeAction: Action = {
  name: "MIRROR_SOURCE_TO_KNOWLEDGE",
  description:
    "Discover and mirror a docs source (site or repo) into Knowledge (requires Autognostic token).",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "Optional ID for the source." },
      sourceUrl: { type: "string", description: "Root URL of the source to mirror." },
      authToken: { type: "string", description: "Autognostic auth token for write permissions." },
      skipPreview: {
        type: "boolean",
        description: "Skip size preview check (only allowed if under auto-ingest threshold).",
      },
      confirmLargeIngest: {
        type: "boolean",
        description: "Confirm ingestion of source exceeding auto-ingest threshold.",
      },
    },
    required: ["sourceUrl", "authToken"],
  },

  // Only validate when the message explicitly mentions mirroring/syncing a source — not simple URL adds
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    const mirrorKeywords = /\b(mirror|sync|crawl|discover|ingest\s+source|mirror\s+source|site\s+to\s+knowledge)\b/i;
    return mirrorKeywords.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<void | ActionResult | undefined> {
    const args = (_message.content as Record<string, unknown>) || {};
    const authToken = args.authToken as string | undefined;

    // Validate auth token before proceeding
    try {
      requireValidToken(runtime, authToken);
    } catch (err) {
      if (err instanceof AutognosticAuthError) {
        if (callback) await callback({ text: err.message, action: "MIRROR_SOURCE_TO_KNOWLEDGE" });
        return {
          success: false,
          text: err.message,
          data: safeSerialize({ error: "auth_failed" }),
        };
      }
      throw err;
    }

    const sourceId = (args.sourceId as string) || `source-${Date.now()}`;
    const sourceUrl = args.sourceUrl as string;
    const skipPreview = args.skipPreview === true;
    const confirmLargeIngest = args.confirmLargeIngest === true;

    // Get size policy
    const settingsRepo = new AutognosticSettingsRepository(runtime);
    const sizePolicy = (await settingsRepo.getPolicy(runtime.agentId)) ?? DEFAULT_SIZE_POLICY;

    // Create discovery to get preview
    const { discovery } = createDiscoveryForRawUrl(runtime, sourceUrl);
    const preview = await previewSourceFiles(runtime, sourceId, discovery);

    const totalMB = (preview.totalBytes / 1024 / 1024).toFixed(2);
    const autoIngestMB = (sizePolicy.autoIngestBelowBytes / 1024 / 1024).toFixed(2);
    const hardLimitMB = (sizePolicy.maxBytesHardLimit / 1024 / 1024).toFixed(2);

    // Check hard limit - always enforced
    if (preview.totalBytes > sizePolicy.maxBytesHardLimit) {
      const text =
        `Source ${sourceId} exceeds hard size limit. ` +
        `Total: ${totalMB} MB, Hard limit: ${hardLimitMB} MB. ` +
        `Increase the hard limit using SET_AUTOGNOSTIC_SIZE_POLICY if needed.`;
      if (callback) await callback({ text, action: "MIRROR_SOURCE_TO_KNOWLEDGE" });
      return {
        success: false,
        text,
        data: safeSerialize({
          error: "exceeds_hard_limit",
          sourceId,
          sourceUrl,
          totalBytes: preview.totalBytes,
          fileCount: preview.files.length,
          hardLimitBytes: sizePolicy.maxBytesHardLimit,
        }),
      };
    }

    // Check if preview/confirmation is required
    const exceedsAutoIngest = preview.totalBytes > sizePolicy.autoIngestBelowBytes;
    const requiresPreview = sizePolicy.previewAlways || exceedsAutoIngest;

    if (requiresPreview && !skipPreview && !confirmLargeIngest) {
      // Return preview info and require confirmation
      const text =
        `Source ${sourceId} requires confirmation before ingestion. ` +
        `Total: ${totalMB} MB (${preview.files.length} files). ` +
        `Auto-ingest threshold: ${autoIngestMB} MB. ` +
        `To proceed, call again with confirmLargeIngest: true.`;
      if (callback) await callback({ text, action: "MIRROR_SOURCE_TO_KNOWLEDGE" });
      return {
        success: false,
        text,
        data: safeSerialize({
          error: "requires_confirmation",
          sourceId,
          sourceUrl,
          totalBytes: preview.totalBytes,
          fileCount: preview.files.length,
          autoIngestThresholdBytes: sizePolicy.autoIngestBelowBytes,
          preview: {
            files: preview.files.slice(0, 20).map((f) => ({
              path: f.path,
              estBytes: f.estBytes,
            })),
            truncated: preview.files.length > 20,
          },
        }),
      };
    }

    // Proceed with reconciliation
    const reconciler = new ReconciliationService(runtime);
    const src: SourceConfig = { id: sourceId, sourceUrl, enabled: true };

    await reconciler.verifyAndReconcileOne(src);

    const text =
      `Mirrored source ${sourceId} from ${sourceUrl} into Knowledge. ` +
      `Total: ${totalMB} MB (${preview.files.length} files).`;
    if (callback) await callback({ text, action: "MIRROR_SOURCE_TO_KNOWLEDGE" });
    return {
      success: true,
      text,
      data: safeSerialize({ sourceId, sourceUrl, totalBytes: preview.totalBytes, fileCount: preview.files.length }),
    };
  },
};
