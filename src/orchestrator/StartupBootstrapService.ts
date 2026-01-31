import type { IAgentRuntime } from "@elizaos/core";
import type { SourceConfig } from "./SourceConfig";
import { getScheduledSyncService } from "../services/ScheduledSyncService";
import { ReconciliationService } from "./ReconciliationService";

export class StartupBootstrapService {
  constructor(private runtime: IAgentRuntime) {}

  async run(sources: SourceConfig[]): Promise<void> {
    if (!sources.length) {
      console.log(
        "[autognostic] Startup: no sources configured for this agent."
      );
    }

    console.log(
      `[autognostic] Startup: Autognostic active for agent ${this.runtime.agentId}. ` +
      `Sources: ${sources.map((s) => s.id).join(", ") || "(none)"}`
    );

    // Start the scheduled sync service (cron-based)
    const syncService = getScheduledSyncService(this.runtime);
    await syncService.start();

    // Check for stale sources and sync immediately if needed
    await syncService.syncStaleOnStartup();

    // Initial reconciliation for any explicitly configured sources
    if (sources.length > 0) {
      const reconciler = new ReconciliationService(this.runtime);
      setTimeout(async () => {
        try {
          await reconciler.verifyAndReconcileAll(sources);
          console.log("[autognostic] Startup: initial reconciliation completed.");
        } catch (err) {
          console.error("[autognostic] Startup reconciliation failed:", err);
        }
      }, 2000);
    }
  }
}
