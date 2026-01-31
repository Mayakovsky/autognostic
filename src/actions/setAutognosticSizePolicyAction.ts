import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { AutognosticSettingsRepository } from "../db/autognosticSettingsRepository";
import { MIN_AUTO_INGEST_BYTES, DEFAULT_SIZE_POLICY } from "../config/SizePolicy";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";

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
    args: any
  ): Promise<void | ActionResult | undefined> {
    const authToken = args.authToken as string | undefined;

    // Validate auth token before proceeding
    try {
      requireValidToken(runtime, authToken);
    } catch (err) {
      if (err instanceof AutognosticAuthError) {
        return {
          success: false,
          text: err.message,
          data: { error: "auth_failed" },
        };
      }
      throw err;
    }

    const repo = new AutognosticSettingsRepository(runtime);
    const current =
      (await repo.getPolicy(runtime.agentId)) ?? DEFAULT_SIZE_POLICY;

    const autoIngestBelowMB =
      args.autoIngestBelowMB ?? current.autoIngestBelowBytes / 1024 / 1024;
    const maxMBHardLimit =
      args.maxMBHardLimit ?? current.maxBytesHardLimit / 1024 / 1024;

    const previewAlways =
      typeof args.previewAlways === "boolean"
        ? (args.previewAlways as boolean)
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

    return {
      success: true,
      text:
        `Updated size policy: previewAlways=${previewAlways}, ` +
        `autoIngestBelowMB=${autoIngestBelowMB}, maxMBHardLimit=${maxMBHardLimit}.`,
      data: newPolicy,
    };
  },
};
