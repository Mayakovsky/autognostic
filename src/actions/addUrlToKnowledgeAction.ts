import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content, UUID } from "@elizaos/core";
import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import { validateToken, isAuthEnabled } from "../auth/validateToken";
import { randomUUID } from "crypto";
import { getScientificPaperDetector } from "../services/ScientificPaperDetector";
import { createScientificPaperHandler } from "../services/ScientificPaperHandler";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { wrapError, ErrorCode } from "../errors";
import { safeSerialize } from "../utils/safeSerialize";

// Extract URL from message text
// Supports both full URLs (https://example.com/...) and bare hostnames (example.com/...)
function extractUrlFromText(text: string): string | null {
  // First try full URLs with protocol
  const fullUrlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const fullMatch = text.match(fullUrlRegex);
  if (fullMatch?.[0]) return fullMatch[0];

  // Then try bare hostnames: word.tld/path (e.g. github.com/user/repo/file.md)
  const bareUrlRegex = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})+\/[^\s<>"{}|\\^`[\]]+/gi;
  const bareMatch = text.match(bareUrlRegex);
  if (bareMatch?.[0]) return `https://${bareMatch[0]}`;

  return null;
}

// Extract auth token from message text
// Looks for patterns like "token: xyz", "password: xyz", "auth: xyz", or just a standalone token-like string
function extractTokenFromText(text: string): string | null {
  // Pattern 1: Explicit token/password/auth prefix
  const explicitPatterns = [
    /(?:token|password|auth|key)[\s:=]+["']?([^\s"']+)["']?/i,
    /(?:with|using)\s+(?:token|password|auth)[\s:=]*["']?([^\s"']+)["']?/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

export const AddUrlToKnowledgeAction: Action = {
  name: "ADD_URL_TO_KNOWLEDGE",
  description:
    "Add a single document from a URL into the agent's Knowledge. Use when user shares a URL and wants to add it to knowledge base. " +
    "Scientific papers are automatically detected, classified, and enriched with metadata. " +
    "If authentication is enabled and no token is provided, ask the user for the auth token.",
  similes: [
    "ADD_URL",
    "SAVE_URL",
    "LEARN_URL",
    "REMEMBER_URL",
    "ADD_DOCUMENT",
    "SAVE_DOCUMENT",
    "ADD_TO_KNOWLEDGE",
    "ADD_PAPER",
    "SAVE_PAPER",
  ],
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public URL of the document to add.",
      },
      filename: {
        type: "string",
        description: "Optional filename hint.",
      },
      roomId: {
        type: "string",
        description: "Room/context ID for this knowledge.",
      },
      authToken: {
        type: "string",
        description:
          "Auth token for write permissions. Required only if authentication is enabled. " +
          "If auth is enabled and token is not provided, the agent should ask for it.",
      },
    },
    required: ["url"],
  },

  // Validate: only trigger if message contains a URL
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content as Content)?.text || "";
    return extractUrlFromText(text) !== null;
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<void | ActionResult | undefined> {
    const args = (message.content as Record<string, unknown>) || {};
    const messageText = (message.content as Content)?.text || "";

    // Try to get token from args, then from message text
    const providedToken =
      (args.authToken as string | undefined) ||
      extractTokenFromText(messageText);

    // Validate authentication
    const authResult = validateToken(runtime, providedToken ?? undefined);

    if (!authResult.valid) {
      // Auth is enabled but token missing or invalid
      if (authResult.needsToken) {
        // Ask the user for the token
        const text =
          "Authentication is required to add documents to knowledge. " +
          "Please provide the auth token. You can say something like: " +
          '"Add this URL with token: your-token-here" or just provide the token.';
        if (callback) await callback({ text, action: "ADD_URL_TO_KNOWLEDGE" });
        return {
          success: false,
          text,
          data: safeSerialize({
            error: "auth_required",
            authEnabled: true,
            needsToken: true,
          }),
        };
      }

      // Auth failed for other reason (invalid token, misconfiguration)
      const authText = authResult.error || "Authentication failed.";
      if (callback) await callback({ text: authText, action: "ADD_URL_TO_KNOWLEDGE" });
      return {
        success: false,
        text: authText,
        data: safeSerialize({
          error: "auth_failed",
          authEnabled: authResult.authEnabled,
        }),
      };
    }

    // Extract URL from args or message
    const url = (args.url as string | undefined) || extractUrlFromText(messageText);

    if (!url) {
      const text = "No URL found. Please provide a URL to add to knowledge.";
      if (callback) await callback({ text, action: "ADD_URL_TO_KNOWLEDGE" });
      return {
        success: false,
        text,
        data: safeSerialize({ error: "missing_url" }),
      };
    }

    // Generate sourceId and versionId for full document storage
    const sourceId = randomUUID();
    const versionId = `v1-${Date.now()}`;

    const filename =
      (args.filename as string) || url.split("/").pop() || "document";
    const roomId =
      (args.roomId as UUID | undefined) || (runtime as unknown as Record<string, UUID>).defaultRoomId || runtime.agentId;

    try {
      // Step 1: Quick pre-check if this looks like a scientific paper
      const detector = getScientificPaperDetector();
      const isLikelyPaper = detector.isLikelyScientificPaper(url);

      console.log(
        `[autognostic] Processing URL: ${url} (likely paper: ${isLikelyPaper})`
      );

      // Step 2: Mirror the document to get content
      const result = await mirrorDocToKnowledge(runtime, {
        url,
        filename,
        roomId,
        entityId: runtime.agentId,
        worldId: runtime.agentId,
        metadata: {
          addedVia: "ADD_URL_TO_KNOWLEDGE",
          sourceId,
          versionId,
        },
      });

      // Step 3: Run scientific paper detection and classification
      const paperHandler = createScientificPaperHandler(runtime);
      
      // Fetch the stored content to run classification
      // (mirrorDocToKnowledge already stored it, we need to retrieve it)
      const { AutognosticDocumentsRepository } = await import("../db/autognosticDocumentsRepository");
      const docsRepo = new AutognosticDocumentsRepository(runtime);
      const storedDocs = await docsRepo.getByUrl(url);
      const content = storedDocs[0]?.content || "";

      // Step 4: Process through scientific paper handler
      const handlerResult = await paperHandler.process(
        url,
        content,
        storedDocs[0]?.id || randomUUID()
      );

      // Step 5: Update source with static detection info
      const sourcesRepo = new AutognosticSourcesRepository(runtime);
      if (handlerResult.isScientificPaper) {
        // Scientific papers are static content - disable version tracking
        await sourcesRepo.markStaticContent(sourceId, true, {
          detectedAt: new Date().toISOString(),
          reason: handlerResult.classification?.confidence 
            ? (handlerResult.classification.confidence >= 0.7 ? "doi_verified" : "content_analysis")
            : "url_pattern",
          confidence: handlerResult.classification?.confidence 
            ? (handlerResult.classification.confidence >= 0.7 ? "high" : "medium")
            : "medium",
          doi: handlerResult.paperMetadata?.doi,
          crossrefData: handlerResult.paperMetadata ? {
            type: "journal-article",
            title: handlerResult.paperMetadata.title,
            journal: handlerResult.paperMetadata.journal,
            publisher: handlerResult.paperMetadata.publisher,
            publishedDate: handlerResult.paperMetadata.publishedDate,
          } : undefined,
        });

        // Update the stored document with enriched content
        if (handlerResult.enrichedContent !== content && storedDocs[0]) {
          // The enriched content includes classification metadata prepended
          // We could update the stored document, but for now we'll leave the original
          // and rely on the classification record for metadata
          console.log(
            `[autognostic] Paper classified as ${handlerResult.zone.toUpperCase()} zone ` +
            `(confidence: ${((handlerResult.classification?.confidence || 0) * 100).toFixed(1)}%)`
          );
        }
      }

      const authStatus = isAuthEnabled(runtime) ? " (authenticated)" : "";

      // Build response message based on paper detection
      let responseText: string;
      if (handlerResult.isScientificPaper) {
        const zoneEmoji = handlerResult.zone === "gold" ? "🥇" : handlerResult.zone === "silver" ? "🥈" : "🥉";
        const domainInfo = handlerResult.classification?.primaryPath?.l1 
          ? ` | Domain: ${handlerResult.classification.primaryPath.l1}`
          : "";
        const titleInfo = handlerResult.paperMetadata?.title
          ? `\n📄 "${handlerResult.paperMetadata.title}"`
          : "";
        
        responseText = 
          `Added scientific paper to Knowledge${authStatus}.${titleInfo}\n` +
          `${zoneEmoji} Lakehouse Zone: ${handlerResult.zone.toUpperCase()}${domainInfo}\n` +
          `Full document archived with classification metadata.`;
      } else {
        responseText = `Added ${url} to Knowledge${authStatus}. Full document archived for direct quotes.`;
      }

      if (callback) await callback({ text: responseText, action: "ADD_URL_TO_KNOWLEDGE" });
      return {
        success: true,
        text: responseText,
        data: safeSerialize({
          url,
          filename,
          roomId,
          sourceId,
          versionId,
          authEnabled: isAuthEnabled(runtime),
          isScientificPaper: handlerResult.isScientificPaper,
          lakehouseZone: handlerResult.zone,
          classification: handlerResult.classification ? {
            primaryPath: handlerResult.classification.primaryPath,
            confidence: handlerResult.classification.confidence,
            focus: handlerResult.classification.focus,
          } : undefined,
          paperMetadata: handlerResult.paperMetadata ? {
            doi: handlerResult.paperMetadata.doi,
            title: handlerResult.paperMetadata.title,
            journal: handlerResult.paperMetadata.journal,
            authors: handlerResult.paperMetadata.authors,
          } : undefined,
          knowledgeDocumentId: result.knowledgeDocumentId,
          clientDocumentId: result.clientDocumentId,
          worldId: result.worldId,
        }),
      };
    } catch (error) {
      const wrappedError = wrapError(error, ErrorCode.INTERNAL, {
        operation: "ADD_URL_TO_KNOWLEDGE",
        url,
      });
      const errorText = `Failed to add document: ${wrappedError.toUserMessage()}`;
      if (callback) await callback({ text: errorText, action: "ADD_URL_TO_KNOWLEDGE" });
      return {
        success: false,
        text: errorText,
        data: safeSerialize({
          error: "ingestion_failed",
          code: wrappedError.code,
          details: wrappedError.message,
          isRetryable: wrappedError.isRetryable,
        }),
      };
    }
  },
};
