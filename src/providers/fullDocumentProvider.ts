import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { autognosticDocuments } from "../db/schema";
import { getDb } from "../db/getDb";
import { desc } from "drizzle-orm";
import { PROVIDER_DEFAULTS } from "../config/constants";

/**
 * FullDocumentProvider — ROUTING ONLY
 *
 * Injects document AWARENESS into the LLM context so it knows what's available.
 * Does NOT inject actual document content — that's GET_EXACT_QUOTE's job.
 *
 * This separation prevents the LLM from confabulating document content
 * and forces it to use the structured retrieval action.
 */
export const fullDocumentProvider: Provider = {
  name: "FULL_DOCUMENT_CONTENT",
  description:
    "Lists available documents and routes the agent to use GET_EXACT_QUOTE for retrieval.",
  position: -10,

  async get(
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> {
    // Get document inventory (metadata only — never load content here)
    let documentInventory: Array<{
      url: string;
      byteSize: number | null;
      createdAt: Date | null;
    }> = [];

    try {
      const db = await getDb(runtime);
      documentInventory = await db
        .select({
          url: autognosticDocuments.url,
          byteSize: autognosticDocuments.byteSize,
          createdAt: autognosticDocuments.createdAt,
        })
        .from(autognosticDocuments)
        .orderBy(desc(autognosticDocuments.createdAt))
        .limit(PROVIDER_DEFAULTS.MAX_INVENTORY_SIZE);
    } catch (error) {
      console.error(`[autognostic] Failed to fetch document inventory:`, error);
    }

    if (documentInventory.length === 0) {
      return {
        text: "",
        data: { documentCount: 0 },
      };
    }

    // Deduplicate by filename (raw URL and blob URL are the same doc)
    const seen = new Set<string>();
    const uniqueDocs = documentInventory.filter(doc => {
      const filename = doc.url.split("/").pop() || doc.url;
      if (seen.has(filename)) return false;
      seen.add(filename);
      return true;
    });

    const inventoryLines = uniqueDocs.map(doc => {
      const filename = doc.url.split("/").pop() || doc.url;
      const size = doc.byteSize ? Math.round(doc.byteSize / 1024) : "?";
      const date = doc.createdAt
        ? doc.createdAt.toISOString().split("T")[0]
        : "unknown";
      return `- ${filename} (${size}KB, added ${date})`;
    });

    const text = `# STORED DOCUMENTS

${inventoryLines.join("\n")}

## RETRIEVAL INSTRUCTIONS
- To quote, read, or retrieve ANY content from these documents: use the GET_EXACT_QUOTE action.
- Do NOT attempt to recall or reproduce document content from memory.
- Do NOT use REPLY to answer questions about document content.
- If the user asks "what does it say", "read me", "quote", "print", "show contents", "last line", etc. → GET_EXACT_QUOTE.
- You do NOT have document content in this context. Only GET_EXACT_QUOTE can retrieve it.`;

    return {
      text,
      data: {
        documentCount: uniqueDocs.length,
        totalDocumentsAvailable: documentInventory.length,
        documents: uniqueDocs.map(d => ({
          filename: d.url.split("/").pop(),
          url: d.url,
          byteSize: d.byteSize,
        })),
      },
    };
  },
};
