import type { IAgentRuntime } from "@elizaos/core";
import * as cron from "node-cron";
import { randomUUID } from "crypto";

import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { AutognosticVersionsRepository } from "../db/autognosticVersionsRepository";
import { ReconciliationService } from "../orchestrator/ReconciliationService";
import { getDb } from "../db/getDb";
import { autognosticSyncConfig, autognosticSyncLog } from "../db/schema";
import { eq } from "drizzle-orm";
import type { SourceConfig } from "../orchestrator/SourceConfig";

export interface SyncConfig {
  cronExpression: string;
  timezone: string;
  stalenessThresholdHours: number;
  enabled: boolean;
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  cronExpression: process.env.AUTOGNOSTIC_SYNC_CRON || "0 3 * * *",
  timezone: process.env.AUTOGNOSTIC_SYNC_TIMEZONE || "UTC",
  stalenessThresholdHours: parseInt(process.env.AUTOGNOSTIC_STALENESS_HOURS || "24", 10),
  enabled: process.env.AUTOGNOSTIC_SYNC_ENABLED !== "false",
};

export class ScheduledSyncService {
  private task: cron.ScheduledTask | null = null;
  private sourcesRepo: AutognosticSourcesRepository;
  private versionsRepo: AutognosticVersionsRepository;
  private reconciler: ReconciliationService;
  private config: SyncConfig;

  constructor(private runtime: IAgentRuntime) {
    this.sourcesRepo = new AutognosticSourcesRepository(runtime);
    this.versionsRepo = new AutognosticVersionsRepository(runtime);
    this.reconciler = new ReconciliationService(runtime);
    this.config = { ...DEFAULT_SYNC_CONFIG };
  }

  async start(): Promise<void> {
    // Load config from database (if exists)
    await this.loadConfig();

    if (!this.config.enabled) {
      console.log("[autognostic] Scheduled sync is disabled");
      return;
    }

    if (!cron.validate(this.config.cronExpression)) {
      console.error(
        `[autognostic] Invalid cron expression: ${this.config.cronExpression}. Sync disabled.`
      );
      return;
    }

    this.task = cron.schedule(
      this.config.cronExpression,
      () => {
        this.runSync().catch((err) => {
          console.error("[autognostic] Scheduled sync failed:", err);
        });
      },
      {
        timezone: this.config.timezone,
      }
    );

    console.log(
      `[autognostic] Scheduled sync service started: ${this.config.cronExpression} (${this.config.timezone})`
    );
  }

  async stop(): Promise<void> {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("[autognostic] Scheduled sync service stopped");
    }
  }

  async runSync(): Promise<void> {
    const syncId = `sync-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date();

    console.log(`[autognostic] Starting scheduled sync ${syncId}`);

    // Write initial sync log entry
    await this.writeSyncLog(syncId, {
      startedAt,
      status: "running",
    });

    const stats = {
      sourcesChecked: 0,
      sourcesUpdated: 0,
      sourcesSkipped: 0,
      documentsAdded: 0,
      documentsRemoved: 0,
      errors: [] as any[],
    };

    try {
      const sources = await this.sourcesRepo.listEnabled();

      for (const source of sources) {
        stats.sourcesChecked++;

        // Skip sources with version tracking disabled
        if (!source.versionTrackingEnabled) {
          stats.sourcesSkipped++;
          console.log(
            `[autognostic] Skipping ${source.id}: version tracking disabled`
          );
          continue;
        }

        // Skip static content
        if (source.isStaticContent) {
          stats.sourcesSkipped++;
          console.log(
            `[autognostic] Skipping ${source.id}: static content`
          );
          continue;
        }

        try {
          const sourceConfig: SourceConfig = {
            id: source.id,
            sourceUrl: source.sourceUrl,
            enabled: source.enabled,
          };

          const result = await this.reconciler.verifyAndReconcileOne(sourceConfig);

          if (result.status === "reconciled") {
            stats.sourcesUpdated++;
            stats.documentsAdded += result.fileCount ?? 0;
          }

          // Clean up old archived versions
          await this.versionsRepo.deleteArchivedBySource(source.id);

          // Update sync timestamps
          const now = new Date();
          const nextSync = this.calculateNextSync(now);
          await this.sourcesRepo.updateSyncTimestamps(source.id, now, nextSync);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[autognostic] Sync failed for source ${source.id}:`,
            err
          );
          stats.errors.push({
            sourceId: source.id,
            error: errMsg,
          });
        }
      }

      // Write completed sync log
      await this.writeSyncLog(syncId, {
        startedAt,
        completedAt: new Date(),
        status: "completed",
        ...stats,
      });

      console.log(
        `[autognostic] Sync ${syncId} completed: ` +
        `checked=${stats.sourcesChecked}, updated=${stats.sourcesUpdated}, ` +
        `skipped=${stats.sourcesSkipped}, errors=${stats.errors.length}`
      );
    } catch (err) {
      await this.writeSyncLog(syncId, {
        startedAt,
        completedAt: new Date(),
        status: "failed",
        ...stats,
        errors: [
          ...stats.errors,
          { error: err instanceof Error ? err.message : String(err) },
        ],
      });
      throw err;
    }
  }

  /**
   * Check if any sources are stale and need immediate sync on startup.
   */
  async syncStaleOnStartup(): Promise<void> {
    const sources = await this.sourcesRepo.listEnabled();
    const now = new Date();
    const stalenessMs = this.config.stalenessThresholdHours * 60 * 60 * 1000;

    for (const source of sources) {
      if (!source.versionTrackingEnabled || source.isStaticContent) continue;

      const lastSync = source.lastSyncAt;
      if (!lastSync || now.getTime() - lastSync.getTime() > stalenessMs) {
        console.log(
          `[autognostic] Source ${source.id} is stale (last sync: ${lastSync?.toISOString() ?? "never"}), triggering sync`
        );

        try {
          const sourceConfig: SourceConfig = {
            id: source.id,
            sourceUrl: source.sourceUrl,
            enabled: source.enabled,
          };
          await this.reconciler.verifyAndReconcileOne(sourceConfig);
          await this.sourcesRepo.updateSyncTimestamps(source.id, now);
        } catch (err) {
          console.error(
            `[autognostic] Startup sync failed for ${source.id}:`,
            err
          );
        }
      }
    }
  }

  private calculateNextSync(from: Date): Date {
    // Simple: add 24 hours as approximate next sync
    return new Date(from.getTime() + this.config.stalenessThresholdHours * 60 * 60 * 1000);
  }

  private async loadConfig(): Promise<void> {
    try {
      const db = await getDb(this.runtime);
      const rows = await db
        .select()
        .from(autognosticSyncConfig)
        .where(eq(autognosticSyncConfig.id, "default"))
        .limit(1);

      if (rows[0]) {
        this.config = {
          cronExpression: rows[0].cronExpression || DEFAULT_SYNC_CONFIG.cronExpression,
          timezone: rows[0].timezone || DEFAULT_SYNC_CONFIG.timezone,
          stalenessThresholdHours:
            rows[0].stalenessThresholdHours ?? DEFAULT_SYNC_CONFIG.stalenessThresholdHours,
          enabled: rows[0].enabled ?? DEFAULT_SYNC_CONFIG.enabled,
        };
      }
    } catch {
      // Use defaults if table doesn't exist yet
    }
  }

  private async writeSyncLog(
    id: string,
    data: {
      startedAt: Date;
      completedAt?: Date;
      status: string;
      sourcesChecked?: number;
      sourcesUpdated?: number;
      sourcesSkipped?: number;
      documentsAdded?: number;
      documentsRemoved?: number;
      errors?: any[];
    }
  ): Promise<void> {
    try {
      const db = await getDb(this.runtime);
      const existing = await db
        .select()
        .from(autognosticSyncLog)
        .where(eq(autognosticSyncLog.id, id))
        .limit(1);

      if (existing[0]) {
        await db
          .update(autognosticSyncLog)
          .set({
            completedAt: data.completedAt,
            status: data.status,
            sourcesChecked: data.sourcesChecked ?? 0,
            sourcesUpdated: data.sourcesUpdated ?? 0,
            sourcesSkipped: data.sourcesSkipped ?? 0,
            documentsAdded: data.documentsAdded ?? 0,
            documentsRemoved: data.documentsRemoved ?? 0,
            errors: data.errors?.length ? data.errors : null,
          })
          .where(eq(autognosticSyncLog.id, id));
      } else {
        await db.insert(autognosticSyncLog).values({
          id,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          status: data.status,
          sourcesChecked: data.sourcesChecked ?? 0,
          sourcesUpdated: data.sourcesUpdated ?? 0,
          sourcesSkipped: data.sourcesSkipped ?? 0,
          documentsAdded: data.documentsAdded ?? 0,
          documentsRemoved: data.documentsRemoved ?? 0,
          errors: data.errors?.length ? data.errors : null,
        });
      }
    } catch (err) {
      console.warn("[autognostic] Failed to write sync log:", err);
    }
  }
}

// Singleton getter
let instance: ScheduledSyncService | null = null;

export function getScheduledSyncService(runtime: IAgentRuntime): ScheduledSyncService {
  if (!instance) {
    instance = new ScheduledSyncService(runtime);
  }
  return instance;
}
