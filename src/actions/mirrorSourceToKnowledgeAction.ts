import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { ReconciliationService } from "../orchestrator/ReconciliationService";
import { previewSourceFiles } from "../orchestrator/previewSource";
import { createDiscoveryForRawUrl } from "../publicspace/discoveryFactory";
import { DatamirrorSettingsRepository } from "../db/datamirrorSettingsRepository";
import { DEFAULT_SIZE_POLICY } from "../config/SizePolicy";
import type { SourceConfig } from "../orchestrator/SourceConfig";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";

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
    const text = ((message.content as any)?.text || "").toLowerCase();
    const mirrorKeywords = /\b(mirror|sync|crawl|discover|ingest\s+source|mirror\s+source|site\s+to\s+knowledge)\b/i;
    return mirrorKeywords.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<void | ActionResult | undefined> {
    const authToken = args.authToken as string | undefined;

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

    const sourceId = (args.sourceId as string) || `source-${Date.now()}`;
    const sourceUrl = args.sourceUrl as string;
    const skipPreview = args.skipPreview === true;
    const confirmLargeIngest = args.confirmLargeIngest === true;

    // Get size policy
    const settingsRepo = new DatamirrorSettingsRepository(runtime);
    const sizePolicy = (await settingsRepo.getPolicy(runtime.agentId)) ?? DEFAULT_SIZE_POLICY;

    // Create discovery to get preview
    const { discovery } = createDiscoveryForRawUrl(runtime, sourceUrl);
    const preview = await previewSourceFiles(runtime, sourceId, discovery);

    const totalMB = (preview.totalBytes / 1024 / 1024).toFixed(2);
    const autoIngestMB = (sizePolicy.autoIngestBelowBytes / 1024 / 1024).toFixed(2);
    const hardLimitMB = (sizePolicy.maxBytesHardLimit / 1024 / 1024).toFixed(2);

    // Check hard limit - always enforced
    if (preview.totalBytes > sizePolicy.maxBytesHardLimit) {
      return {
        success: false,
        text:
          `Source ${sourceId} exceeds hard size limit. ` +
          `Total: ${totalMB} MB, Hard limit: ${hardLimitMB} MB. ` +
          `Increase the hard limit using SET_DATAMIRROR_SIZE_POLICY if needed.`,
        data: {
          error: "exceeds_hard_limit",
          sourceId,
          sourceUrl,
          totalBytes: preview.totalBytes,
          fileCount: preview.files.length,
          hardLimitBytes: sizePolicy.maxBytesHardLimit,
        },
      };
    }

    // Check if preview/confirmation is required
    const exceedsAutoIngest = preview.totalBytes > sizePolicy.autoIngestBelowBytes;
    const requiresPreview = sizePolicy.previewAlways || exceedsAutoIngest;

    if (requiresPreview && !skipPreview && !confirmLargeIngest) {
      // Return preview info and require confirmation
      return {
        success: false,
        text:
          `Source ${sourceId} requires confirmation before ingestion. ` +
          `Total: ${totalMB} MB (${preview.files.length} files). ` +
          `Auto-ingest threshold: ${autoIngestMB} MB. ` +
          `To proceed, call again with confirmLargeIngest: true.`,
        data: {
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
        },
      };
    }

    // Proceed with reconciliation
    const reconciler = new ReconciliationService(runtime);
    const src: SourceConfig = { id: sourceId, sourceUrl, enabled: true };

    await reconciler.verifyAndReconcileOne(src);

    return {
      success: true,
      text:
        `Mirrored source ${sourceId} from ${sourceUrl} into Knowledge. ` +
        `Total: ${totalMB} MB (${preview.files.length} files).`,
      data: { sourceId, sourceUrl, totalBytes: preview.totalBytes, fileCount: preview.files.length },
    };
  },
};
