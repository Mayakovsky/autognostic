import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions } from "@elizaos/core";
import { AutognosticSettingsRepository } from "../db/autognosticSettingsRepository";
import { MIN_AUTO_INGEST_BYTES, DEFAULT_SIZE_POLICY } from "../config/SizePolicy";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { safeSerialize } from "../utils/safeSerialize";

export const SetAutognosticSizePolicyAction: Action = {
  name: "SET_AUTOGNOSTIC_SIZE_POLICY",
  description:
    "Configure Autognostic size policy (accepts MB; stores bytes). Requires Autognostic token.",
  parameters: {
    type: "object",
    properties: {
      autoIngestBelowMB: { type: "number", description: "Auto-ingest below size (MB)." },
      maxMBHardLimit: { type: "number", description: "Hard max ingest size (MB)." },
      previewAlways: { type: "boolean", description: "Always show preview before ingest." },
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
        if (callback) await callback({ text: err.message, action: "SET_AUTOGNOSTIC_SIZE_POLICY" });
        return {
          success: false,
          text: err.message,
          data: safeSerialize({ error: "auth_failed" }),
        };
      }
      throw err;
    }

    const repo = new AutognosticSettingsRepository(runtime);
    const current =
      (await repo.getPolicy(runtime.agentId)) ?? DEFAULT_SIZE_POLICY;

    const autoIngestBelowMB =
      (args.autoIngestBelowMB as number | undefined) ?? current.autoIngestBelowBytes / 1024 / 1024;
    const maxMBHardLimit =
      (args.maxMBHardLimit as number | undefined) ?? current.maxBytesHardLimit / 1024 / 1024;

    const previewAlways: boolean =
      typeof args.previewAlways === "boolean"
        ? args.previewAlways
        : current.previewAlways;

    const newPolicy = {
      previewAlways,
      autoIngestBelowBytes: Math.max(
        MIN_AUTO_INGEST_BYTES,
        autoIngestBelowMB * 1024 * 1024
      ),
      maxBytesHardLimit: maxMBHardLimit * 1024 * 1024,
    };

    await repo.upsertPolicy(runtime.agentId, newPolicy);

    const text =
      `Updated size policy: previewAlways=${previewAlways}, ` +
      `autoIngestBelowMB=${autoIngestBelowMB}, maxMBHardLimit=${maxMBHardLimit}.`;
    if (callback) await callback({ text, action: "SET_AUTOGNOSTIC_SIZE_POLICY" });
    return {
      success: true,
      text,
      data: safeSerialize(newPolicy),
    };
  },
};
