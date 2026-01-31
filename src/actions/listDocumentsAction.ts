import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { AutognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";

export const ListDocumentsAction: Action = {
  name: "LIST_KNOWLEDGE_DOCUMENTS",
  description:
    "List individual documents in the knowledge base. No auth required (read-only). " +
    "Optionally filter by source ID.",
  similes: [
    "LIST_DOCUMENTS",
    "SHOW_DOCUMENTS",
    "WHAT_DOCUMENTS",
    "MY_DOCUMENTS",
    "KNOWLEDGE_DOCUMENTS",
  ],
  parameters: {
    type: "object",
    properties: {
      sourceId: {
        type: "string",
        description: "Optional source ID to filter documents by",
      },
    },
    required: [],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(list|show|what).*(document|knowledge|stored|file)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (_message.content as any) || {};
    const docsRepo = new AutognosticDocumentsRepository(runtime);

    const sourceId = args.sourceId as string | undefined;

    const docs = sourceId
      ? await docsRepo.listBySourceId(sourceId)
      : await docsRepo.listAll();

    if (docs.length === 0) {
      const text = sourceId
        ? `No documents found for source ${sourceId}.`
        : "No documents in the knowledge base. Use ADD_URL_TO_KNOWLEDGE to add one.";
      if (callback) {
        await callback({ text, action: "LIST_KNOWLEDGE_DOCUMENTS" });
      }
      return { success: true, text, data: { documents: [] } };
    }

    const docSummaries = docs.map((d: any) => ({
      url: d.url,
      sourceId: d.sourceId,
      mimeType: d.mimeType,
      byteSize: d.byteSize,
      createdAt: d.createdAt?.toISOString(),
    }));

    const lines = docSummaries.map((d: any) => {
      const size = d.byteSize ? `${Math.round(d.byteSize / 1024)}KB` : "?KB";
      return `- ${d.url} (${size}, source: ${d.sourceId})`;
    });

    const filterNote = sourceId ? ` for source ${sourceId}` : "";
    const text = `Knowledge documents${filterNote} (${docs.length}):\n${lines.join("\n")}`;
    if (callback) {
      await callback({ text, action: "LIST_KNOWLEDGE_DOCUMENTS" });
    }
    return {
      success: true,
      text,
      data: { documents: docSummaries, count: docs.length },
    };
  },
};
