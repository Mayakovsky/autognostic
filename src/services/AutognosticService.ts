import { Service, type IAgentRuntime } from "@elizaos/core";

import { StartupBootstrapService } from "../orchestrator/StartupBootstrapService";
import type { SourceConfig } from "../orchestrator/SourceConfig";

import { AutognosticSettingsRepository } from "../db/autognosticSettingsRepository";
import { AutognosticRefreshSettingsRepository } from "../db/autognosticRefreshSettingsRepository";

import {
  DEFAULT_SIZE_POLICY,
  type AutognosticSizePolicy,
} from "../config/SizePolicy";

import {
  DEFAULT_REFRESH_POLICY,
  type AutognosticRefreshPolicy,
} from "../config/RefreshPolicy";

/**
 * AutognosticService
 * - Owns “startup wiring” for autognostic:
 *   - loads character settings
 *   - normalizes policy inputs (MB/min/seconds → bytes/ms)
 *   - persists to SQL via repos
 *   - triggers startup bootstrap (reconcile/ingest orchestration)
 *
 * NOTE: ElizaOS core 1.6+ requires:
 *   - static start(runtime) factory
 *   - capabilityDescription
 *   - stop()
 */
export class AutognosticService extends Service {
  static readonly serviceType = "autognostic";

  override capabilityDescription =
    "Mirrors external sources into Knowledge with persisted size/refresh policies and startup reconciliation.";

  private settingsRepo: AutognosticSettingsRepository;
  private refreshRepo: AutognosticRefreshSettingsRepository;

  /** Required by ElizaOS core (service registration). */
  static async start(runtime: IAgentRuntime): Promise<AutognosticService> {
    const svc = new AutognosticService(runtime);
    // Run initialization during service start so the plugin is operational on boot.
    await svc.initialize(runtime);
    return svc;
  }

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.settingsRepo = new AutognosticSettingsRepository(runtime);
    this.refreshRepo = new AutognosticRefreshSettingsRepository(runtime);
  }

  override async stop(): Promise<void> {
    // Stop the scheduled sync service if running
    const { getScheduledSyncService } = await import("./ScheduledSyncService");
    const syncService = getScheduledSyncService(this.runtime);
    await syncService.stop();
  }

  /**
   * initialize()
   * Runs on service registration; safe to call multiple times.
   */
  async initialize(runtime: IAgentRuntime): Promise<void> {
    const charSettings = runtime.character?.settings ?? {};
    const dmSettings = (charSettings as Record<string, unknown>).autognostic as Record<string, unknown> ?? {};

    // ----- Sources (what to mirror)
    const sources: SourceConfig[] =
      (dmSettings.sources as SourceConfig[] | undefined) ??
      ([] as SourceConfig[]); // default empty; you can set a default if desired

    // ----- Normalize + persist size policy
    const mergedSizePolicy = this.mergeSizePolicy(dmSettings.sizePolicy as Partial<AutognosticSizePolicy> & Record<string, unknown> | undefined);
    await this.settingsRepo.upsertPolicy(runtime.agentId, mergedSizePolicy);

    // ----- Normalize + persist refresh policy
    const mergedRefreshPolicy = this.mergeRefreshPolicy(dmSettings.refreshPolicy as Partial<AutognosticRefreshPolicy> & Record<string, unknown> | undefined);
    await this.refreshRepo.upsertPolicy(runtime.agentId, mergedRefreshPolicy);

    // ----- Startup orchestration (kickoff)
    // Keep it behind a flag so smoke tests can control behavior.
    const autoStart =
      typeof dmSettings.autoStart === "boolean" ? dmSettings.autoStart : true;

    if (autoStart) {
      const bootstrap = new StartupBootstrapService(runtime);
      await bootstrap.run(sources);
    }
  }

  /**
   * mergeSizePolicy()
   * Accepts either:
   *  - preferred: bytes fields (autoIngestBelowBytes, maxBytesHardLimit)
   *  - back-compat/human: MB fields (autoIngestBelowMB, maxMBHardLimit)
   */
  mergeSizePolicy(input?: Partial<AutognosticSizePolicy> & Record<string, unknown>): AutognosticSizePolicy {
    const user = (input ?? {}) as Record<string, unknown>;

    // Start from defaults, then overlay.
    const merged: AutognosticSizePolicy = {
      ...DEFAULT_SIZE_POLICY,
      ...(user ?? {}),
    };

    // Back-compat: MB fields → bytes
    if (typeof user.autoIngestBelowMB === "number") {
      merged.autoIngestBelowBytes = user.autoIngestBelowMB * 1024 * 1024;
    }
    if (typeof user.maxMBHardLimit === "number") {
      merged.maxBytesHardLimit = user.maxMBHardLimit * 1024 * 1024;
    }

    // Ensure required numeric fields are sane if user passed nonsense.
    if (!Number.isFinite(merged.autoIngestBelowBytes) || merged.autoIngestBelowBytes < 0) {
      merged.autoIngestBelowBytes = DEFAULT_SIZE_POLICY.autoIngestBelowBytes;
    }
    if (!Number.isFinite(merged.maxBytesHardLimit) || merged.maxBytesHardLimit <= 0) {
      merged.maxBytesHardLimit = DEFAULT_SIZE_POLICY.maxBytesHardLimit;
    }

    return merged;
  }

  /**
   * mergeRefreshPolicy()
   * Accepts either:
   *  - preferred: ms fields (previewCacheTtlMs, reconcileCooldownMs, startupReconcileTimeoutMs)
   *  - back-compat/human: minutes/seconds fields (previewCacheTtlMinutes, reconcileCooldownMinutes, startupTimeoutSeconds)
   */
  mergeRefreshPolicy(
    input?: Partial<AutognosticRefreshPolicy> & Record<string, unknown>
  ): AutognosticRefreshPolicy {
    const user = (input ?? {}) as Record<string, unknown>;

    const merged: AutognosticRefreshPolicy = {
      ...DEFAULT_REFRESH_POLICY,
      ...(user ?? {}),
    };

    // Back-compat: minutes → ms
    if (typeof user.previewCacheTtlMinutes === "number") {
      merged.previewCacheTtlMs = user.previewCacheTtlMinutes * 60 * 1000;
    }
    if (typeof user.reconcileCooldownMinutes === "number") {
      merged.reconcileCooldownMs = user.reconcileCooldownMinutes * 60 * 1000;
    }
    // Back-compat: seconds → ms
    if (typeof user.startupTimeoutSeconds === "number") {
      merged.startupReconcileTimeoutMs = user.startupTimeoutSeconds * 1000;
    }

    // Sanity checks
    if (!Number.isFinite(merged.previewCacheTtlMs) || merged.previewCacheTtlMs < 0) {
      merged.previewCacheTtlMs = DEFAULT_REFRESH_POLICY.previewCacheTtlMs;
    }
    if (!Number.isFinite(merged.reconcileCooldownMs) || merged.reconcileCooldownMs < 0) {
      merged.reconcileCooldownMs = DEFAULT_REFRESH_POLICY.reconcileCooldownMs;
    }
    if (
      merged.startupReconcileTimeoutMs != null &&
      (!Number.isFinite(merged.startupReconcileTimeoutMs) || merged.startupReconcileTimeoutMs < 0)
    ) {
      merged.startupReconcileTimeoutMs = DEFAULT_REFRESH_POLICY.startupReconcileTimeoutMs;
    }

    return merged;
  }
}
