import type { IAgentRuntime } from "@elizaos/core";
import { ReconciliationWorker } from "./ReconciliationWorker";
import type { SourceConfig } from "./SourceConfig";
import { DatamirrorRefreshSettingsRepository } from "../db/datamirrorRefreshSettingsRepository";

export class StartupBootstrapService {
  private worker: ReconciliationWorker;
  private refreshRepo: DatamirrorRefreshSettingsRepository;

  constructor(private runtime: IAgentRuntime) {
    this.worker = new ReconciliationWorker(runtime);
    this.refreshRepo = new DatamirrorRefreshSettingsRepository(runtime);
  }

  async run(sources: SourceConfig[]): Promise<void> {
    if (!sources.length) {
      console.log(
        "[datamirror] Startup: no sources configured for this agent."
      );
      return;
    }

    console.log(
      `[datamirror] Startup: Datamirror active for agent ${this.runtime.agentId}. Sources: ${sources
        .map((s) => s.id)
        .join(", ")}`
    );

    const policy = await this.refreshRepo.getPolicy(this.runtime.agentId);
    const timeoutMs = policy.startupReconcileTimeoutMs;
    const kickoff = Date.now();

    console.log(
      `[datamirror] Startup: scheduling background reconciliation (timeout ${timeoutMs}ms).`
    );

    setTimeout(() => {
      const now = Date.now();
      if (now - kickoff > timeoutMs) {
        console.warn(
          `[datamirror] Startup: skipping reconciliation kickoff (startup timeout exceeded).`
        );
        return;
      }

      this.worker.enqueueSources(sources);
      console.log(
        "[datamirror] Startup: background reconciliation started."
      );
    }, 2000);
  }
}
