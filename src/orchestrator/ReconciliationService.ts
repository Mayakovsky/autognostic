import type { IAgentRuntime } from "@elizaos/core";
import { createHash } from "crypto";

import { createDiscoveryForRawUrl } from "../publicspace/discoveryFactory";
import {
  previewSourceFiles,
  type SourcePreview,
} from "./previewSource";
import type { SourceConfig } from "./SourceConfig";

import { DatamirrorSourcesRepository } from "../db/datamirrorSourcesRepository";
import { DatamirrorVersionsRepository } from "../db/datamirrorVersionsRepository";
import { DatamirrorPreviewCacheRepository } from "../db/datamirrorPreviewCacheRepository";
import { DatamirrorRefreshSettingsRepository } from "../db/datamirrorRefreshSettingsRepository";
import { DatamirrorKnowledgeLinkRepository } from "../db/datamirrorKnowledgeLinkRepository";
import { DatamirrorSettingsRepository } from "../db/datamirrorSettingsRepository";
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
  private sourcesRepo: DatamirrorSourcesRepository;
  private versionsRepo: DatamirrorVersionsRepository;
  private previewCacheRepo: DatamirrorPreviewCacheRepository;
  private refreshRepo: DatamirrorRefreshSettingsRepository;
  private knowledgeLinkRepo: DatamirrorKnowledgeLinkRepository;
  private settingsRepo: DatamirrorSettingsRepository;

  constructor(private runtime: IAgentRuntime) {
    this.sourcesRepo = new DatamirrorSourcesRepository(runtime);
    this.versionsRepo = new DatamirrorVersionsRepository(runtime);
    this.previewCacheRepo = new DatamirrorPreviewCacheRepository(runtime);
    this.refreshRepo = new DatamirrorRefreshSettingsRepository(runtime);
    this.knowledgeLinkRepo = new DatamirrorKnowledgeLinkRepository(runtime);
    this.settingsRepo = new DatamirrorSettingsRepository(runtime);
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
      `[datamirror] Checking source ${source.id} (${source.sourceUrl}), kind=${classified.kind}`
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
        `[datamirror] Using cached preview for ${source.id} (age ${
          (now.getTime() - cached.checkedAt.getTime()) / 1000
        }s)`
      );
    } else {
      preview = await previewSourceFiles(this.runtime, source.id, discovery);
      await this.previewCacheRepo.set(source.id, preview, now);
      console.log(`[datamirror] Refreshed preview for ${source.id}`);
    }

    // Enforce size policy during background reconciliation
    // Hard limit is always enforced - skip sources that exceed it
    if (preview.totalBytes > sizePolicy.maxBytesHardLimit) {
      const totalMB = (preview.totalBytes / 1024 / 1024).toFixed(2);
      const hardLimitMB = (sizePolicy.maxBytesHardLimit / 1024 / 1024).toFixed(2);
      console.warn(
        `[datamirror] Source ${source.id} exceeds hard size limit (${totalMB} MB > ${hardLimitMB} MB), skipping reconciliation`
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
          `[datamirror] Source ${source.id} exceeds auto-ingest threshold (${totalMB} MB > ${autoIngestMB} MB) ` +
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
        `[datamirror] Source ${source.id} exceeds auto-ingest threshold but has prior version, proceeding with update`
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
        `[datamirror] ${source.id} up-to-date @ ${remoteVersionId}`
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
      `[datamirror] ${source.id} outdated → reconciling to ${remoteVersionId}`
    );

    await this.versionsRepo.createStaging(source.id, remoteVersionId);

    try {
      await this.reconcileSourceVersion(source, preview, remoteVersionId);
      await this.versionsRepo.markActive(source.id, remoteVersionId);
      console.log(
        `[datamirror] ${source.id} reconciled to ${remoteVersionId}`
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
        `[datamirror] Reconciliation failed for ${source.id} @ ${remoteVersionId}`,
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
        `[datamirror] No files discovered for ${source.id} during reconcile`
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
            datamirrorSourceId: source.id,
            datamirrorVersionId: versionId,
          },
        });

        await this.knowledgeLinkRepo.addLink({
          sourceId: source.id,
          versionId,
          knowledgeDocumentId: res.knowledgeDocumentId,
        });
      } catch (err) {
        console.warn(
          `[datamirror] Failed to ingest ${f.url} for ${source.id} @ ${versionId}, skipping`,
          err
        );
      }
    }
  }
}
