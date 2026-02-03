import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
import { autognosticDocuments } from "../db/schema";
import { getDb } from "../db/getDb";
import { desc } from "drizzle-orm";
import { PROVIDER_DEFAULTS } from "../config/constants";

/**
 * FullDocumentProvider
 *
 * Provides access to full, unembedded document content for direct quotes.
 *
 * ANTI-HALLUCINATION DESIGN:
 * 1. Always provides document inventory so agent knows what's available
 * 2. Strong instructions to ONLY quote from provided content
 * 3. Falls back to listing all recent documents if no URL match
 * 4. Stores both original and raw URLs for flexible matching
 */
export const fullDocumentProvider: Provider = {
  name: "FULL_DOCUMENT_CONTENT",
  description:
    "Provides full document text for exact quotes. ALWAYS use this content for quotations - never fabricate.",
  // High priority to ensure document content is available before agent responds
  position: -10,

  async get(
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> {
    const messageText = (message.content as any)?.text || "";

    // Detect if user is asking for quotes/content from documents
    const quotePatterns = [
      /quote/i, /first\s+\d+\s+words?/i, /last\s+\d+\s+words?/i,
      /line\s+\d+/i, /what\s+does.*say/i, /read.*from/i,
      /content\s+of/i, /text\s+of/i, /words?\s+in/i,
      /document/i, /file/i, /from\s+the/i
    ];
    const isAskingForQuote = quotePatterns.some(p => p.test(messageText));

    // Get document inventory (metadata only - no full content loaded)
    let documentInventory: Array<{ url: string; byteSize: number | null; createdAt: Date | null }> = [];
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

    // Extract URLs from conversation for targeted lookup
    const urlsToCheck: string[] = [];

    // Check current message
    const urlMatches = messageText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
    if (urlMatches) {
      urlsToCheck.push(...urlMatches);
    }

    // Check recent conversation for document URLs
    if (state?.recentMessages) {
      const recentText = typeof state.recentMessages === "string"
        ? state.recentMessages
        : JSON.stringify(state.recentMessages);
      const recentUrlMatches = recentText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
      if (recentUrlMatches) {
        urlsToCheck.push(...recentUrlMatches);
      }
    }

    // Check knowledge metadata for sourceUrl
    if (state?.knowledge) {
      const knowledgeText = typeof state.knowledge === "string"
        ? state.knowledge
        : JSON.stringify(state.knowledge);
      const knowledgeUrlMatches = knowledgeText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
      if (knowledgeUrlMatches) {
        urlsToCheck.push(...knowledgeUrlMatches);
      }
    }

    // Deduplicate and normalize URLs for matching
    const uniqueUrls = [...new Set(urlsToCheck)];

    // Try to find matching documents - only fetch full content when needed
    const matchedDocuments: Array<{ url: string; content: string }> = [];

    for (const url of uniqueUrls.slice(0, 5)) {
      // Try exact match first
      let content = await autognosticDocumentsRepository.getFullContent(runtime, url);

      // If no match, try to find by partial URL match (filename) in inventory
      if (!content && documentInventory.length > 0) {
        const filename = url.split('/').pop()?.toLowerCase();
        if (filename) {
          const partialMatch = documentInventory.find(doc =>
            doc.url.toLowerCase().includes(filename)
          );
          if (partialMatch) {
            content = await autognosticDocumentsRepository.getFullContent(runtime, partialMatch.url);
          }
        }
      }

      if (content) {
        matchedDocuments.push({ url, content });
      }
    }

    // FALLBACK: If asking for quotes but no URL match, fetch most recent documents' content
    if (isAskingForQuote && matchedDocuments.length === 0 && documentInventory.length > 0) {
      for (const doc of documentInventory.slice(0, PROVIDER_DEFAULTS.MAX_DOCUMENTS_IN_CONTEXT)) {
        const content = await autognosticDocumentsRepository.getFullContent(runtime, doc.url);
        if (content) {
          matchedDocuments.push({ url: doc.url, content });
        }
      }
    }

    // Build response
    const documentContents: string[] = [];
    const documentsFound: Array<{ url: string; charCount: number }> = [];

    for (const { url, content } of matchedDocuments) {
      const maxChars = PROVIDER_DEFAULTS.MAX_CHARS_PER_DOCUMENT;
      const truncatedContent = content.length > maxChars
        ? content.slice(0, maxChars) + "\n\n[... document truncated for context limit ...]"
        : content;

      documentsFound.push({ url, charCount: content.length });

      documentContents.push(
        `=== FULL DOCUMENT: ${url} ===\n` +
        truncatedContent +
        `\n=== END DOCUMENT ===`
      );
    }

    // Build document inventory from metadata
    const inventoryLines = documentInventory.map(doc => {
      const filename = doc.url.split('/').pop() || doc.url;
      const size = doc.byteSize ? Math.round(doc.byteSize / 1024) : "?";
      return `- ${filename} (${size}KB) - ${doc.url}`;
    });

    // Construct final output with STRONG anti-hallucination instructions
    let text = "";

    if (documentContents.length > 0) {
      text = `# DOCUMENT CONTENT FOR QUOTATION

## IMPORTANT INSTRUCTIONS
- You MUST quote ONLY from the document text provided below
- Do NOT fabricate, guess, or hallucinate any content
- If the requested content is not in the documents below, say "I don't have access to that specific content"
- Count words/lines carefully using the actual text provided

## AVAILABLE DOCUMENTS IN KNOWLEDGE BASE
${inventoryLines.length > 0 ? inventoryLines.join('\n') : '(No documents stored)'}

## FULL DOCUMENT CONTENT
${documentContents.join('\n\n')}

## REMINDER
Only quote from the above content. If you cannot find specific text, admit it rather than making something up.`;
    } else if (documentInventory.length > 0) {
      // No matched documents but some exist
      text = `# DOCUMENT INVENTORY

## IMPORTANT
You have documents in your knowledge base but none matched the current conversation.
If the user is asking about a document, ask them to clarify which one.

## AVAILABLE DOCUMENTS
${inventoryLines.join('\n')}

## NOTE
To access document content for quotation, the document URL should be mentioned in the conversation.
Do NOT fabricate document content - only quote from content explicitly provided to you.`;
    } else {
      // No documents at all
      text = `# NO DOCUMENTS AVAILABLE

There are no documents stored in the knowledge base.
If the user asks for quotes from a document, inform them that the document needs to be added first.
Do NOT fabricate or hallucinate document content.`;
    }

    return {
      text,
      data: {
        documentsFound,
        documentCount: documentsFound.length,
        totalDocumentsAvailable: documentInventory.length,
        isAskingForQuote,
      },
    };
  },
};
