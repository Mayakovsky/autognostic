import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { DatamirrorRefreshSettingsRepository } from "../db/datamirrorRefreshSettingsRepository";
import { DEFAULT_REFRESH_POLICY } from "../config/RefreshPolicy";

export const SetDatamirrorRefreshPolicyAction: Action = {
  name: "SET_DATAMIRROR_REFRESH_POLICY",
  description:
    "Configure Datamirror refresh policy (accepts minutes/seconds; stores ms). Requires Datamirror token.",
  parameters: {
    type: "object",
    properties: {
      previewCacheTtlMinutes: { type: "number", description: "Preview cache TTL (minutes)." },
      reconcileCooldownMinutes: { type: "number", description: "Cooldown between reconciles (minutes)." },
      maxConcurrentReconciles: { type: "number", description: "Max concurrent reconciles." },
      startupTimeoutSeconds: { type: "number", description: "Startup reconcile timeout (seconds)." },
      authToken: { type: "string", description: "Datamirror auth token for write permissions." },
    },
    required: ["authToken"],
  },

  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<void | ActionResult | undefined> {
    const repo = new DatamirrorRefreshSettingsRepository(runtime);
    const current =
      (await repo.getPolicy(runtime.agentId)) ?? DEFAULT_REFRESH_POLICY;

    const previewCacheTtlMinutes =
      args.previewCacheTtlMinutes ?? current.previewCacheTtlMs / 60000;
    const reconcileCooldownMinutes =
      args.reconcileCooldownMinutes ?? current.reconcileCooldownMs / 60000;
    const maxConcurrentReconciles =
      args.maxConcurrentReconciles ?? current.maxConcurrentReconciles;

    const startupTimeoutSeconds =
      args.startupTimeoutSeconds ??
      (current.startupReconcileTimeoutMs ?? 0) / 1000;

    const newPolicy = {
      previewCacheTtlMs: previewCacheTtlMinutes * 60 * 1000,
      reconcileCooldownMs: reconcileCooldownMinutes * 60 * 1000,
      maxConcurrentReconciles,
      startupReconcileTimeoutMs: startupTimeoutSeconds * 1000,
    };

    await repo.upsertPolicy(runtime.agentId, newPolicy);

    return {
      success: true,
      text:
        `Updated refresh policy: previewCacheTtlMinutes=${previewCacheTtlMinutes}, ` +
        `reconcileCooldownMinutes=${reconcileCooldownMinutes}, ` +
        `maxConcurrentReconciles=${maxConcurrentReconciles}, ` +
        `startupTimeoutSeconds=${startupTimeoutSeconds}.`,
      data: newPolicy,
    };
  },
};
