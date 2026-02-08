import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions } from "@elizaos/core";
import { AutognosticRefreshSettingsRepository } from "../db/autognosticRefreshSettingsRepository";
import { DEFAULT_REFRESH_POLICY } from "../config/RefreshPolicy";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { safeSerialize } from "../utils/safeSerialize";

export const SetAutognosticRefreshPolicyAction: Action = {
  name: "SET_AUTOGNOSTIC_REFRESH_POLICY",
  description:
    "Configure Autognostic refresh policy (accepts minutes/seconds; stores ms). Requires Autognostic token.",
  parameters: {
    type: "object",
    properties: {
      previewCacheTtlMinutes: { type: "number", description: "Preview cache TTL (minutes)." },
      reconcileCooldownMinutes: { type: "number", description: "Cooldown between reconciles (minutes)." },
      maxConcurrentReconciles: { type: "number", description: "Max concurrent reconciles." },
      startupTimeoutSeconds: { type: "number", description: "Startup reconcile timeout (seconds)." },
      authToken: { type: "string", description: "Autognostic auth token for write permissions." },
    },
    required: ["authToken"],
  },

  validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

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
        if (callback) await callback({ text: err.message, action: "SET_AUTOGNOSTIC_REFRESH_POLICY" });
        return {
          success: false,
          text: err.message,
          data: safeSerialize({ error: "auth_failed" }),
        };
      }
      throw err;
    }

    const repo = new AutognosticRefreshSettingsRepository(runtime);
    const current =
      (await repo.getPolicy(runtime.agentId)) ?? DEFAULT_REFRESH_POLICY;

    const previewCacheTtlMinutes =
      (args.previewCacheTtlMinutes as number | undefined) ?? current.previewCacheTtlMs / 60000;
    const reconcileCooldownMinutes =
      (args.reconcileCooldownMinutes as number | undefined) ?? current.reconcileCooldownMs / 60000;
    const maxConcurrentReconciles =
      (args.maxConcurrentReconciles as number | undefined) ?? current.maxConcurrentReconciles;

    const startupTimeoutSeconds =
      (args.startupTimeoutSeconds as number | undefined) ??
      (current.startupReconcileTimeoutMs ?? 0) / 1000;

    const newPolicy = {
      previewCacheTtlMs: previewCacheTtlMinutes * 60 * 1000,
      reconcileCooldownMs: reconcileCooldownMinutes * 60 * 1000,
      maxConcurrentReconciles,
      startupReconcileTimeoutMs: startupTimeoutSeconds * 1000,
    };

    await repo.upsertPolicy(runtime.agentId, newPolicy);

    const text =
      `Updated refresh policy: previewCacheTtlMinutes=${previewCacheTtlMinutes}, ` +
      `reconcileCooldownMinutes=${reconcileCooldownMinutes}, ` +
      `maxConcurrentReconciles=${maxConcurrentReconciles}, ` +
      `startupTimeoutSeconds=${startupTimeoutSeconds}.`;
    if (callback) await callback({ text, action: "SET_AUTOGNOSTIC_REFRESH_POLICY" });
    return {
      success: true,
      text,
      data: safeSerialize(newPolicy),
    };
  },
};
