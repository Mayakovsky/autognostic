import type { IAgentRuntime } from "@elizaos/core";
import { createHash } from "crypto";

import { createDiscoveryForRawUrl } from "../publicspace/discoveryFactory";
import {
  previewSourceFiles,
  type SourcePreview,
} from "./previewSource";
import type { SourceConfig } from "./SourceConfig";

import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { AutognosticVersionsRepository } from "../db/autognosticVersionsRepository";
import { AutognosticPreviewCacheRepository } from "../db/autognosticPreviewCacheRepository";
import { AutognosticRefreshSettingsRepository } from "../db/autognosticRefreshSettingsRepository";
import { AutognosticKnowledgeLinkRepository } from "../db/autognosticKnowledgeLinkRepository";
import { AutognosticSettingsRepository } from "../db/autognosticSettingsRepository";
import { DEFAULT_SIZE_POLICY } from "../config/SizePolicy";

import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import type { HttpService } from "../services/httpService";

class VersionResolver {
  computeRemoteVersionFromPreview(preview: SourcePreview): string {
    const h = createHash("sha256");
    const files = [...preview.files].sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    for (const f of files) {
      h.update(f.url);
      h.update("|");
      h.update(f.path);
      h.update("|");
      h.update(String(f.estBytes));
      h.update("|");
      if (f.etag) h.update(f.etag);
      h.update("|");
      if (f.lastModified) h.update(f.lastModified);
      h.update("||");
    }
    h.update(`count:${files.length}`);
    return h.digest("hex");
  }

  needsUpdate(localVersionId: string | null, remoteVersionId: string): boolean {
    if (!localVersionId) return true;
    return localVersionId !== remoteVersionId;
  }
}

export interface ReconciliationResult {
  sourceId: string;
  status: "up_to_date" | "reconciled" | "skipped_size_limit" | "failed";
  versionId?: string;
  totalBytes?: number;
  fileCount?: number;
  error?: string;
}

export class ReconciliationService {
  private versionResolver = new VersionResolver();
  private sourcesRepo: AutognosticSourcesRepository;
  private versionsRepo: AutognosticVersionsRepository;
  private previewCacheRepo: AutognosticPreviewCacheRepository;
  private refreshRepo: AutognosticRefreshSettingsRepository;
  private knowledgeLinkRepo: AutognosticKnowledgeLinkRepository;
  private settingsRepo: AutognosticSettingsRepository;

  constructor(private runtime: IAgentRuntime) {
    this.sourcesRepo = new AutognosticSourcesRepository(runtime);
    this.versionsRepo = new AutognosticVersionsRepository(runtime);
    this.previewCacheRepo = new AutognosticPreviewCacheRepository(runtime);
    this.refreshRepo = new AutognosticRefreshSettingsRepository(runtime);
    this.knowledgeLinkRepo = new AutognosticKnowledgeLinkRepository(runtime);
    this.settingsRepo = new AutognosticSettingsRepository(runtime);
  }

  async verifyAndReconcileAll(sources: SourceConfig[]): Promise<ReconciliationResult[]> {
    const results: ReconciliationResult[] = [];
    for (const src of sources) {
      if (!src.enabled) continue;
      const result = await this.verifyAndReconcileOne(src);
      results.push(result);
    }
    return results;
  }

  async verifyAndReconcileOne(source: SourceConfig): Promise<ReconciliationResult> {
    await this.sourcesRepo.getOrCreate(source.id, source.sourceUrl);

    const refreshPolicy = await this.refreshRepo.getPolicy(this.runtime.agentId);
    const sizePolicy = (await this.settingsRepo.getPolicy(this.runtime.agentId)) ?? DEFAULT_SIZE_POLICY;

    const { classified, discovery } = createDiscoveryForRawUrl(
      this.runtime,
      source.sourceUrl
    );

    console.log(
      `[autognostic] Checking source ${source.id} (${source.sourceUrl}), kind=${classified.kind}`
    );

    const now = new Date();
    const cached = await this.previewCacheRepo.get(source.id);
    let preview: SourcePreview;

    if (
      cached &&
      now.getTime() - cached.checkedAt.getTime() <=
        refreshPolicy.previewCacheTtlMs
    ) {
      preview = cached.preview;
      console.log(
        `[autognostic] Using cached preview for ${source.id} (age ${
          (now.getTime() - cached.checkedAt.getTime()) / 1000
        }s)`
      );
    } else {
      preview = await previewSourceFiles(this.runtime, source.id, discovery);
      await this.previewCacheRepo.set(source.id, preview, now);
      console.log(`[autognostic] Refreshed preview for ${source.id}`);
    }

    // Enforce size policy during background reconciliation
    // Hard limit is always enforced - skip sources that exceed it
    if (preview.totalBytes > sizePolicy.maxBytesHardLimit) {
      const totalMB = (preview.totalBytes / 1024 / 1024).toFixed(2);
      const hardLimitMB = (sizePolicy.maxBytesHardLimit / 1024 / 1024).toFixed(2);
      console.warn(
        `[autognostic] Source ${source.id} exceeds hard size limit (${totalMB} MB > ${hardLimitMB} MB), skipping reconciliation`
      );
      return {
        sourceId: source.id,
        status: "skipped_size_limit",
        totalBytes: preview.totalBytes,
        fileCount: preview.files.length,
        error: `Exceeds hard size limit: ${totalMB} MB > ${hardLimitMB} MB`,
      };
    }

    // For background reconciliation, also respect auto-ingest threshold
    // Sources above the auto-ingest threshold should have been explicitly confirmed via action
    // Background worker only auto-updates sources within the auto-ingest threshold
    if (preview.totalBytes > sizePolicy.autoIngestBelowBytes) {
      const totalMB = (preview.totalBytes / 1024 / 1024).toFixed(2);
      const autoIngestMB = (sizePolicy.autoIngestBelowBytes / 1024 / 1024).toFixed(2);

      // Check if this source was previously reconciled (i.e., user confirmed it before)
      const existingVersion = await this.versionsRepo.getLatestActive(source.id);
      if (!existingVersion) {
        // Never reconciled before and above auto-ingest threshold - skip
        console.warn(
          `[autognostic] Source ${source.id} exceeds auto-ingest threshold (${totalMB} MB > ${autoIngestMB} MB) ` +
            `and has no prior version. Use MIRROR_SOURCE_TO_KNOWLEDGE action with confirmLargeIngest to initialize.`
        );
        return {
          sourceId: source.id,
          status: "skipped_size_limit",
          totalBytes: preview.totalBytes,
          fileCount: preview.files.length,
          error: `Exceeds auto-ingest threshold (${totalMB} MB > ${autoIngestMB} MB). Use action with confirmLargeIngest to initialize.`,
        };
      }
      // Has prior version - allow update even if above threshold (user confirmed previously)
      console.log(
        `[autognostic] Source ${source.id} exceeds auto-ingest threshold but has prior version, proceeding with update`
      );
    }

    const remoteVersionId =
      this.versionResolver.computeRemoteVersionFromPreview(preview);
    const local = await this.versionsRepo.getLatestActive(source.id);
    const needsUpdate = this.versionResolver.needsUpdate(
      local?.versionId ?? null,
      remoteVersionId
    );

    if (!needsUpdate) {
      console.log(
        `[autognostic] ${source.id} up-to-date @ ${remoteVersionId}`
      );
      return {
        sourceId: source.id,
        status: "up_to_date",
        versionId: remoteVersionId,
        totalBytes: preview.totalBytes,
        fileCount: preview.files.length,
      };
    }

    console.log(
      `[autognostic] ${source.id} outdated → reconciling to ${remoteVersionId}`
    );

    await this.versionsRepo.createStaging(source.id, remoteVersionId);

    try {
      await this.reconcileSourceVersion(source, preview, remoteVersionId);
      await this.versionsRepo.markActive(source.id, remoteVersionId);
      console.log(
        `[autognostic] ${source.id} reconciled to ${remoteVersionId}`
      );
      return {
        sourceId: source.id,
        status: "reconciled",
        versionId: remoteVersionId,
        totalBytes: preview.totalBytes,
        fileCount: preview.files.length,
      };
    } catch (err) {
      console.error(
        `[autognostic] Reconciliation failed for ${source.id} @ ${remoteVersionId}`,
        err
      );
      await this.versionsRepo.markFailed(
        source.id,
        remoteVersionId,
        (err as any)?.message ?? "Unknown error"
      );
      return {
        sourceId: source.id,
        status: "failed",
        versionId: remoteVersionId,
        totalBytes: preview.totalBytes,
        fileCount: preview.files.length,
        error: (err as any)?.message ?? "Unknown error",
      };
    }
  }

  private async reconcileSourceVersion(
    source: SourceConfig,
    preview: SourcePreview,
    versionId: string
  ) {
    const { discovery } = createDiscoveryForRawUrl(
      this.runtime,
      source.sourceUrl
    );

    const http = this.runtime.getService<HttpService>("http");
    if (!http) {
      throw new Error("HttpService is required for reconciliation");
    }

    const files = await discovery.list();
    if (!files.length) {
      console.warn(
        `[autognostic] No files discovered for ${source.id} during reconcile`
      );
      return;
    }

    const roomId: any = (this.runtime as any).defaultRoomId ?? source.id;
    const entityId: any = this.runtime.agentId;

    for (const f of files) {
      try {
        const res = await mirrorDocToKnowledge(this.runtime, {
          url: f.url,
          filename: f.path.split("/").pop() || f.path,
          contentType: "text/markdown",
          roomId,
          entityId,
          worldId: this.runtime.agentId,
          metadata: {
            autognosticSourceId: source.id,
            autognosticVersionId: versionId,
          },
        });

        await this.knowledgeLinkRepo.addLink({
          sourceId: source.id,
          versionId,
          knowledgeDocumentId: res.knowledgeDocumentId,
        });
      } catch (err) {
        console.warn(
          `[autognostic] Failed to ingest ${f.url} for ${source.id} @ ${versionId}, skipping`,
          err
        );
      }
    }
  }
}
