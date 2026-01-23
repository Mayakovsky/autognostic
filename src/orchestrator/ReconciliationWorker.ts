import type { IAgentRuntime } from "@elizaos/core";
import { ReconciliationService } from "./ReconciliationService";
import { DatamirrorRefreshSettingsRepository } from "../db/datamirrorRefreshSettingsRepository";
import type { SourceConfig } from "./SourceConfig";

interface SourceState {
  lastAttemptAt?: number;
  retryAttempts: number;
}

export class ReconciliationWorker {
  private reconciler: ReconciliationService;
  private refreshRepo: DatamirrorRefreshSettingsRepository;
  private queue: SourceConfig[] = [];
  private running = false;
  private sourceState: Map<string, SourceState> = new Map();

  constructor(private runtime: IAgentRuntime) {
    this.reconciler = new ReconciliationService(runtime);
    this.refreshRepo = new DatamirrorRefreshSettingsRepository(runtime);
  }

  enqueueSources(sources: SourceConfig[]) {
    this.queue.push(...sources);
    if (!this.running) {
      this.running = true;
      this.processLoop();
    }
  }

  private async processLoop(): Promise<void> {
    const refreshPolicy = await this.refreshRepo.getPolicy(this.runtime.agentId);
    const now = Date.now();

    const maxConcurrent = refreshPolicy.maxConcurrentReconciles;
    let active = 0;

    while (this.queue.length && active < maxConcurrent) {
      const source = this.queue.shift()!;
      const state = this.sourceState.get(source.id) ?? { retryAttempts: 0 };

      const sinceLastAttempt = state.lastAttemptAt
        ? now - state.lastAttemptAt
        : Infinity;

      const baseCooldown = refreshPolicy.reconcileCooldownMs;
      const backoffFactor = Math.pow(2, state.retryAttempts);
      const requiredCooldown = baseCooldown * backoffFactor;

      if (sinceLastAttempt < requiredCooldown) {
        this.queue.push(source);
        continue;
      }

      active++;
      state.lastAttemptAt = now;
      this.sourceState.set(source.id, state);

      this.handleOneSource(source, state)
        .catch((err) => {
          console.error(
            `[datamirror] Worker error on source ${source.id}`,
            err
          );
        })
        .finally(() => {
          active--;
          if (!this.queue.length && active === 0) {
            this.running = false;
          } else if (!this.running) {
            this.running = true;
            this.processLoop();
          }
        });
    }

    if (this.queue.length) {
      setTimeout(() => this.processLoop(), 1000);
    } else {
      this.running = false;
    }
  }

  private async handleOneSource(
    source: SourceConfig,
    state: SourceState
  ): Promise<void> {
    try {
      await this.reconciler.verifyAndReconcileOne(source);
      state.retryAttempts = 0;
      this.sourceState.set(source.id, state);
    } catch (err) {
      console.error(
        `[datamirror] Reconciliation failed for ${source.id}, keeping last known good version.`,
        err
      );
      state.retryAttempts = (state.retryAttempts ?? 0) + 1;
      this.sourceState.set(source.id, state);
    }
  }
}
