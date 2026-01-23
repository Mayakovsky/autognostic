import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { DatamirrorSettingsRepository } from "../db/datamirrorSettingsRepository";
import { MIN_AUTO_INGEST_BYTES, DEFAULT_SIZE_POLICY } from "../config/SizePolicy";

export const SetDatamirrorSizePolicyAction: Action = {
  name: "SET_DATAMIRROR_SIZE_POLICY",
  description:
    "Configure Datamirror size policy (accepts MB; stores bytes). Requires Datamirror token.",
  parameters: {
    type: "object",
    properties: {
      autoIngestBelowMB: { type: "number", description: "Auto-ingest below size (MB)." },
      maxMBHardLimit: { type: "number", description: "Hard max ingest size (MB)." },
      previewAlways: { type: "boolean", description: "Always show preview before ingest." },
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
    const repo = new DatamirrorSettingsRepository(runtime);
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
