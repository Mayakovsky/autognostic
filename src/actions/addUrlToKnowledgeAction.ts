import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content, UUID } from "@elizaos/core";
import { mirrorDocToKnowledge } from "../integration/mirrorDocToKnowledge";
import { validateToken, isAuthEnabled } from "../auth/validateToken";
import { randomUUID, createHash } from "crypto";
import { getScientificPaperDetector } from "../services/ScientificPaperDetector";
import { resolveOpenAccess, extractDoiFromUrl } from "../services/UnpaywallResolver";
import { createScientificPaperHandler } from "../services/ScientificPaperHandler";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
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
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Add this to knowledge: https://arxiv.org/abs/2401.12345",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Added to knowledge base. Detected as a scientific paper — classified under Machine Learning > Reinforcement Learning.",
          actions: ["ADD_URL_TO_KNOWLEDGE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Save https://example.com/docs/api-reference.md to the knowledge base",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Document added to knowledge base: api-reference.md (1247 lines)",
          actions: ["ADD_URL_TO_KNOWLEDGE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Learn this paper https://arxiv.org/abs/2305.99999",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Scientific paper added and classified. Title: \"Scaling Laws for Neural Networks\". Category: Deep Learning > Optimization.",
          actions: ["ADD_URL_TO_KNOWLEDGE"],
        },
      },
    ],
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

      // Step 1b: Try Unpaywall OA resolution if we have a DOI
      let ingestUrl = url;
      const doi = extractDoiFromUrl(url);
      let oaStatus: string | undefined;
      if (doi) {
        const oaResult = await resolveOpenAccess(doi);
        if (oaResult) {
          oaStatus = oaResult.oaStatus;
          if (oaResult.pdfUrl) {
            console.log(
              `[autognostic] Unpaywall: resolved DOI ${doi} → ${oaResult.pdfUrl} (${oaResult.oaStatus}, ${oaResult.host})`
            );
            ingestUrl = oaResult.pdfUrl;
          } else {
            console.log(
              `[autognostic] Unpaywall: DOI ${doi} status=${oaResult.oaStatus} (no OA PDF available)`
            );
          }
        }
      }

      // Step 1c: License gate — block full-text ingestion of closed-access papers
      if (doi && oaStatus === "closed") {
        console.log(`[autognostic] License gate: DOI ${doi} is closed-access — storing metadata only`);

        // Store a metadata-only record (no content)
        const contentHash = createHash("sha256").update("").digest("hex");
        await autognosticDocumentsRepository.store(runtime, {
          sourceId,
          versionId,
          url,
          content: "",
          contentHash,
          mimeType: "text/plain",
          byteSize: 0,
          oaStatus: "closed",
        });

        // Still run scientific paper detection for classification
        const paperHandler = createScientificPaperHandler(runtime);
        const handlerResult = await paperHandler.process(url, "", randomUUID());

        const responseText =
          `[METADATA ONLY] This paper is closed-access (paywalled). ` +
          `Stored metadata only (DOI: ${doi}). ` +
          `Full-text ingestion is blocked to respect copyright. ` +
          `Use Unpaywall or your institution's access for the full text.`;

        if (callback) await callback({ text: responseText, action: "ADD_URL_TO_KNOWLEDGE" });
        return {
          success: true,
          text: responseText,
          data: safeSerialize({
            url,
            doi,
            oaStatus: "closed",
            accessRestriction: "metadata_only",
            sourceId,
            versionId,
            isScientificPaper: handlerResult.isScientificPaper,
            lakehouseZone: handlerResult.zone,
            paperMetadata: handlerResult.paperMetadata ? {
              doi: handlerResult.paperMetadata.doi,
              title: handlerResult.paperMetadata.title,
              journal: handlerResult.paperMetadata.journal,
              authors: handlerResult.paperMetadata.authors,
            } : undefined,
          }),
        };
      }

      console.log(
        `[autognostic] Processing URL: ${ingestUrl} (likely paper: ${isLikelyPaper}${ingestUrl !== url ? `, OA resolved from ${url}` : ""})`
      );

      // Step 2: Mirror the document to get content
      const result = await mirrorDocToKnowledge(runtime, {
        url: ingestUrl,
        filename,
        roomId,
        entityId: runtime.agentId,
        worldId: runtime.agentId,
        oaStatus,
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
      const storedDocs = await docsRepo.getByUrl(ingestUrl);
      const content = storedDocs[0]?.content || "";

      // Step 4: Process through scientific paper handler
      const handlerResult = await paperHandler.process(
        ingestUrl,
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
          `[STORED] Scientific paper added to knowledge base${authStatus}.${titleInfo}\n` +
          `${zoneEmoji} Lakehouse Zone: ${handlerResult.zone.toUpperCase()}${domainInfo}\n` +
          `Use GET_EXACT_QUOTE to retrieve content.`;
      } else {
        responseText = `[STORED] ${url.split("/").pop() || url} — added to knowledge base${authStatus}. Use GET_EXACT_QUOTE to retrieve content.`;
      }

      if (callback) await callback({ text: responseText, action: "ADD_URL_TO_KNOWLEDGE" });
      return {
        success: true,
        text: responseText,
        data: safeSerialize({
          url: ingestUrl,
          originalUrl: url !== ingestUrl ? url : undefined,
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
