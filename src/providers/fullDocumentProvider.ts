import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { datamirrorDocumentsRepository } from "../db/datamirrorDocumentsRepository";

/**
 * FullDocumentProvider
 *
 * Provides access to full, unembedded document content for direct quotes.
 * This provider is triggered when the agent needs to quote specific text
 * from documents that have been added to knowledge.
 *
 * The provider searches for URLs mentioned in the conversation and retrieves
 * the full document content, enabling accurate word-for-word quotations.
 */
export const fullDocumentProvider: Provider = {
  name: "FULL_DOCUMENT_CONTENT",
  description:
    "Provides full document text for exact quotes. Use when user asks for specific lines, words, or direct quotes from a document.",

  async get(
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> {
    // Extract URLs from recent messages to find relevant documents
    const urlsToCheck: string[] = [];

    // Check current message
    const messageText = (message.content as any)?.text || "";
    const urlMatches = messageText.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi);
    if (urlMatches) {
      urlsToCheck.push(...urlMatches);
    }

    // Check recent conversation for document URLs
    if (state?.recentMessages) {
      const recentText = typeof state.recentMessages === "string"
        ? state.recentMessages
        : JSON.stringify(state.recentMessages);
      const recentUrlMatches = recentText.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi);
      if (recentUrlMatches) {
        urlsToCheck.push(...recentUrlMatches);
      }
    }

    // Also check for document references in knowledge metadata
    // Look for sourceUrl patterns in state
    if (state?.knowledge) {
      const knowledgeText = typeof state.knowledge === "string"
        ? state.knowledge
        : JSON.stringify(state.knowledge);
      const knowledgeUrlMatches = knowledgeText.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi);
      if (knowledgeUrlMatches) {
        urlsToCheck.push(...knowledgeUrlMatches);
      }
    }

    // Deduplicate URLs
    const uniqueUrls = [...new Set(urlsToCheck)];

    if (uniqueUrls.length === 0) {
      return { text: "" };
    }

    // Try to retrieve full content for each URL
    const documentContents: string[] = [];
    const documentsFound: Array<{ url: string; charCount: number }> = [];

    for (const url of uniqueUrls.slice(0, 5)) { // Limit to 5 documents to avoid context overflow
      try {
        const content = await datamirrorDocumentsRepository.getFullContent(runtime, url);
        if (content) {
          // Truncate very large documents but keep enough for quotes
          const maxChars = 50000; // ~12k tokens
          const truncatedContent = content.length > maxChars
            ? content.slice(0, maxChars) + "\n\n[... document truncated for context limit ...]"
            : content;

          documentsFound.push({ url, charCount: content.length });

          documentContents.push(
            `=== FULL DOCUMENT: ${url} ===\n` +
            `(Use this for exact quotes and line references)\n\n` +
            truncatedContent +
            `\n=== END DOCUMENT ===\n`
          );
        }
      } catch (error) {
        // Silently skip documents that can't be retrieved
        console.debug(`[datamirror] Could not retrieve full document for ${url}:`, error);
      }
    }

    if (documentContents.length === 0) {
      return { text: "" };
    }

    const text = (
      "# Full Document Content (for direct quotes)\n\n" +
      "The following are complete document texts. Use these for accurate quotations.\n\n" +
      documentContents.join("\n\n")
    );

    return {
      text,
      data: {
        documentsFound,
        documentCount: documentsFound.length,
      },
    };
  },
};
