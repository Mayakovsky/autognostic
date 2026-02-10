import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { AutognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
import type { AutognosticDocumentsRow } from "../db/schema";
import { safeSerialize } from "../utils/safeSerialize";

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
  examples: [
    [
      {
        name: "{{name1}}",
        content: { text: "What documents do you have in your knowledge base?" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I have 3 documents stored:\n1. api-reference.md (1247 lines)\n2. arxiv-2401.12345 (342 lines)\n3. README.md (89 lines)",
          actions: ["LIST_KNOWLEDGE_DOCUMENTS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Show me all stored documents" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are the documents in knowledge:\n1. design-spec.md\n2. meeting-notes.txt",
          actions: ["LIST_KNOWLEDGE_DOCUMENTS"],
        },
      },
    ],
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
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(list|show|what).*(document|knowledge|stored|file)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<ActionResult> {
    const args = (_message.content as Record<string, unknown>) || {};
    const docsRepo = new AutognosticDocumentsRepository(runtime);

    const sourceId = args.sourceId as string | undefined;

    const docs: AutognosticDocumentsRow[] = sourceId
      ? await docsRepo.listBySourceId(sourceId)
      : await docsRepo.listAll();

    if (docs.length === 0) {
      const text = sourceId
        ? `No documents found for source ${sourceId}.`
        : "No documents in the knowledge base. Use ADD_URL_TO_KNOWLEDGE to add one.";
      if (callback) {
        await callback({ text, action: "LIST_KNOWLEDGE_DOCUMENTS" });
      }
      return { success: true, text, data: safeSerialize({ documents: [] }) };
    }

    const docSummaries = docs.map((d) => ({
      url: d.url,
      sourceId: d.sourceId,
      mimeType: d.mimeType,
      byteSize: d.byteSize,
      createdAt: d.createdAt?.toISOString(),
    }));

    const lines = docSummaries.map((d) => {
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
      data: safeSerialize({ documents: docSummaries, count: docs.length }),
    };
  },
};
