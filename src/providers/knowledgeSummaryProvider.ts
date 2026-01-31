import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { AutognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";

/**
 * KnowledgeSummaryProvider
 *
 * Injects awareness of the agent's knowledge base into every conversation.
 * This enables the agent to know what it knows.
 */
export const knowledgeSummaryProvider: Provider = {
  name: "KNOWLEDGE_SUMMARY",
  description:
    "Provides a summary of what the agent knows - source count, document count, sync status.",
  position: -5,

  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> {
    const sourcesRepo = new AutognosticSourcesRepository(runtime);
    const docsRepo = new AutognosticDocumentsRepository(runtime);

    let sources: any[] = [];
    let docCount = 0;

    try {
      sources = await sourcesRepo.listEnabled();
      docCount = await docsRepo.count();
    } catch {
      // Tables may not exist yet
      return {
        text: "",
        data: { sourcesCount: 0, documentCount: 0 },
      };
    }

    if (sources.length === 0 && docCount === 0) {
      return {
        text: "",
        data: { sourcesCount: 0, documentCount: 0 },
      };
    }

    const staticCount = sources.filter((s) => s.isStaticContent).length;

    const sourceLines = await Promise.all(
      sources.map(async (src) => {
        const docs = await docsRepo.listBySourceId(src.id);
        const staticBadge = src.isStaticContent ? " \u{1F4CC}" : "";
        const syncStatus = src.lastSyncAt
          ? `synced ${src.lastSyncAt.toISOString().split("T")[0]}`
          : "never synced";
        const trackingStatus = src.versionTrackingEnabled ? "" : " (tracking off)";

        let metaInfo = "";
        if (src.staticDetectionMetadata?.doi) {
          metaInfo = ` (DOI: ${src.staticDetectionMetadata.doi})`;
        }

        return `- ${src.id}${staticBadge}: ${docs.length} doc(s), ${syncStatus}${trackingStatus}${metaInfo}`;
      })
    );

    const staticNote = staticCount > 0
      ? `\n(${staticCount} source(s) marked as static)`
      : "";

    const text = `# YOUR KNOWLEDGE BASE
You have access to ${sources.length} knowledge source(s) containing ${docCount} document(s).${staticNote}

## Sources
${sourceLines.join("\n")}`;

    return {
      text,
      data: {
        sourcesCount: sources.length,
        documentCount: docCount,
        staticCount,
        sources: sources.map((s) => ({
          id: s.id,
          url: s.sourceUrl,
          isStatic: s.isStaticContent,
          versionTracking: s.versionTrackingEnabled,
          lastSync: s.lastSyncAt?.toISOString(),
        })),
      },
    };
  },
};
