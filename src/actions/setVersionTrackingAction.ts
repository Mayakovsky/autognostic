import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, AutognosticAuthError } from "../auth/validateToken";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";

export const SetVersionTrackingAction: Action = {
  name: "SET_VERSION_TRACKING",
  description:
    "Enable or disable version tracking (auto-sync) for a knowledge source. " +
    "When disabled, the source will not be checked for updates during scheduled syncs. " +
    "Requires auth token.",
  similes: [
    "TOGGLE_SYNC",
    "DISABLE_SYNC",
    "ENABLE_SYNC",
    "TOGGLE_VERSION_TRACKING",
    "STOP_TRACKING",
    "START_TRACKING",
  ],
  parameters: {
    type: "object",
    properties: {
      sourceId: {
        type: "string",
        description: "ID of the source to configure",
      },
      enabled: {
        type: "boolean",
        description: "true to enable version tracking, false to disable",
      },
      authToken: {
        type: "string",
        description: "Autognostic auth token for write permissions",
      },
    },
    required: ["sourceId", "enabled", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(enable|disable|toggle|stop|start).*(version|tracking|sync|update)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (_message.content as any) || {};

    try {
      requireValidToken(runtime, args.authToken);
    } catch (err) {
      if (err instanceof AutognosticAuthError) {
        const text = err.message;
        if (callback) {
          await callback({ text, action: "SET_VERSION_TRACKING" });
        }
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    const enabled = args.enabled as boolean;

    if (!sourceId) {
      const text = "sourceId is required.";
      if (callback) {
        await callback({ text, action: "SET_VERSION_TRACKING" });
      }
      return { success: false, text, data: { error: "missing_source_id" } };
    }

    if (typeof enabled !== "boolean") {
      const text = "enabled must be true or false.";
      if (callback) {
        await callback({ text, action: "SET_VERSION_TRACKING" });
      }
      return { success: false, text, data: { error: "invalid_enabled" } };
    }

    const sourcesRepo = new AutognosticSourcesRepository(runtime);
    const source = await sourcesRepo.getById(sourceId);

    if (!source) {
      const text = `Source ${sourceId} not found.`;
      if (callback) {
        await callback({ text, action: "SET_VERSION_TRACKING" });
      }
      return { success: false, text, data: { error: "source_not_found" } };
    }

    await sourcesRepo.updateVersionTracking(sourceId, enabled);

    const status = enabled ? "enabled" : "disabled";
    const text = `Version tracking ${status} for source ${sourceId}.${
      source.isStaticContent && enabled
        ? " Note: This overrides the auto-detected static content flag."
        : ""
    }`;
    if (callback) {
      await callback({ text, action: "SET_VERSION_TRACKING" });
    }
    return {
      success: true,
      text,
      data: { sourceId, versionTrackingEnabled: enabled },
    };
  },
};
