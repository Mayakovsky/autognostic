import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { AutognosticVersionsRepository } from "../db/autognosticVersionsRepository";
import { safeSerialize } from "../utils/safeSerialize";

export const ListSourcesAction: Action = {
  name: "LIST_AUTOGNOSTIC_SOURCES",
  description: "List all mirrored sources and their status. No auth required (read-only).",
  similes: ["LIST_SOURCES", "SHOW_SOURCES", "WHAT_SOURCES", "MIRRORED_SOURCES"],
  parameters: {
    type: "object",
    properties: {
      includeDisabled: {
        type: "boolean",
        description: "Include disabled sources in the list",
      },
    },
    required: [],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(list|show|what).*(source|mirror)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<ActionResult> {
    const sourcesRepo = new AutognosticSourcesRepository(runtime);
    const versionsRepo = new AutognosticVersionsRepository(runtime);

    const sources = await sourcesRepo.listEnabled();

    const sourceDetails = await Promise.all(
      sources.map(async (src) => {
        const latestVersion = await versionsRepo.getLatestActive(src.id);
        return {
          id: src.id,
          url: src.sourceUrl,
          description: src.description,
          enabled: src.enabled,
          lastVersion: latestVersion?.versionId?.slice(0, 12),
          lastUpdated: latestVersion?.activatedAt?.toISOString(),
        };
      })
    );

    if (sourceDetails.length === 0) {
      const text = "No mirrored sources configured. Use MIRROR_SOURCE_TO_KNOWLEDGE to add one.";
      if (callback) {
        await callback({ text, action: "LIST_AUTOGNOSTIC_SOURCES" });
      }
      return {
        success: true,
        text,
        data: safeSerialize({ sources: [] }),
      };
    }

    const lines = sourceDetails.map(
      (s) => `- ${s.id}: ${s.url} (last: ${s.lastUpdated || "never"})`
    );

    const text = `Mirrored sources (${sourceDetails.length}):\n${lines.join("\n")}`;
    if (callback) {
      await callback({ text, action: "LIST_AUTOGNOSTIC_SOURCES" });
    }
    return {
      success: true,
      text,
      data: safeSerialize({ sources: sourceDetails }),
    };
  },
};
