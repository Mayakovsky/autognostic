import type { IAgentRuntime, UUID } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";
import { HttpService } from "../services/httpService";
import { randomUUID, createHash } from "crypto";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
import { withRetry } from "../utils/retry";
import { analyzeDocument } from "../services/DocumentAnalyzer";
import { WebPageProcessor } from "../services/WebPageProcessor";
import { PdfExtractor } from "../services/PdfExtractor";

/**
 * Convert URLs to their raw content equivalents.
 * - GitHub blob URLs → raw.githubusercontent.com
 * - GitLab blob URLs → raw URLs
 * - Gist URLs → raw URLs
 */
function normalizeToRawUrl(url: string): string {
  const parsed = new URL(url);

  // GitHub: github.com/:owner/:repo/blob/:branch/:path
  // → raw.githubusercontent.com/:owner/:repo/:branch/:path
  if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (match) {
      const [, owner, repo, rest] = match;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
    }
  }

  // GitHub Gist: gist.github.com/:user/:gistId → raw URL
  if (parsed.hostname === "gist.github.com") {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (match) {
      const [, user, gistId] = match;
      return `https://gist.githubusercontent.com/${user}/${gistId}/raw`;
    }
  }

  // GitLab: gitlab.com/:owner/:repo/-/blob/:branch/:path
  // → gitlab.com/:owner/:repo/-/raw/:branch/:path
  if (parsed.hostname === "gitlab.com" || parsed.hostname.includes("gitlab")) {
    const blobMatch = parsed.pathname.match(/^(.+)\/-\/blob\/(.+)$/);
    if (blobMatch) {
      const [, projectPath, rest] = blobMatch;
      return `https://${parsed.hostname}${projectPath}/-/raw/${rest}`;
    }
  }

  // Return original URL if no transformation needed
  return url;
}

export interface MirrorDocParams {
  url: string;
  filename: string;
  contentType?: string;
  roomId: UUID;
  entityId: UUID;
  worldId?: UUID;
  metadata?: Record<string, unknown>;
}

export async function mirrorDocToKnowledge(
  runtime: IAgentRuntime,
  params: MirrorDocParams
) {
  const http =
    runtime.getService<HttpService>("http") ?? new HttpService(runtime);

  const knowledge = runtime.getService<KnowledgeService>("knowledge");
  if (!knowledge) {
    throw new Error(
      "KnowledgeService not available. Make sure @elizaos/plugin-knowledge is registered."
    );
  }

  // Convert GitHub/GitLab blob URLs to raw content URLs
  const rawUrl = normalizeToRawUrl(params.url);

  // Determine if this is likely a text file based on extension
  const textExtensions = [".md", ".txt", ".json", ".xml", ".yaml", ".yml", ".csv", ".html", ".htm", ".js", ".ts", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".css", ".scss", ".less"];
  const isLikelyText = textExtensions.some(ext => rawUrl.toLowerCase().endsWith(ext)) ||
                       params.contentType?.startsWith("text/");

  let content: string;
  let contentType: string;

  if (isLikelyText) {
    // Use getRawText for text content - includes HTML detection
    const result = await withRetry(
      () => http.getRawText(rawUrl),
      { maxAttempts: 3, initialDelayMs: 1000 },
      `fetch ${rawUrl}`
    );
    content = result.content;
    contentType = params.contentType || result.contentType;

    // HTML received when expecting text — extract clean text or follow PDF link
    if (result.isHtml && !rawUrl.toLowerCase().endsWith(".html") && !rawUrl.toLowerCase().endsWith(".htm")) {
      console.warn(
        `[autognostic] WARNING: Received HTML content from ${rawUrl} - ` +
        `the URL may be a webpage wrapper instead of raw content. ` +
        `Original URL: ${params.url}`
      );
      try {
        const processor = new WebPageProcessor();
        const extracted = processor.extractFromHtml(result.content, rawUrl);
        const pdfLink = processor.findBestPdfLink(extracted);
        if (pdfLink) {
          // Try to download and extract PDF
          try {
            const pdfRes = await http.get(pdfLink.href);
            if (pdfRes.ok) {
              const extractor = new PdfExtractor();
              const pdfResult = await extractor.extract(
                Buffer.from(await pdfRes.arrayBuffer())
              );
              content = pdfResult.text;
              contentType = "text/plain";
              console.debug(
                `[autognostic] Extracted ${pdfResult.pageCount} pages from PDF: ${pdfLink.href}`
              );
            } else {
              // PDF fetch failed — fall back to extracted HTML text
              content = extracted.text;
              contentType = "text/plain";
            }
          } catch (pdfErr) {
            console.debug(`[autognostic] PDF extraction failed, using HTML text:`, pdfErr);
            content = extracted.text;
            contentType = "text/plain";
          }
        } else {
          // No PDF link — use extracted clean text
          content = extracted.text;
          contentType = "text/plain";
        }
      } catch (htmlErr) {
        console.debug(`[autognostic] HTML processing failed, using raw content:`, htmlErr);
        // Fall through with original content
      }
    }
  } else {
    // For binary or unknown content types, fetch normally
    const res = await withRetry(
      () => http.get(rawUrl),
      { maxAttempts: 3, initialDelayMs: 1000 },
      `fetch ${rawUrl}`
    );
    contentType = params.contentType || res.headers.get("content-type") || "application/octet-stream";

    if (contentType.startsWith("application/") && !contentType.includes("json")) {
      const buf = Buffer.from(await res.arrayBuffer());
      content = buf.toString("base64");
    } else {
      content = await res.text();
    }

    // HTML received from extensionless URL (academic publishers, etc.) — extract clean text or follow PDF link
    const isHtmlResponse = contentType.includes("text/html") ||
      content.trimStart().toLowerCase().startsWith("<!doctype") ||
      content.trimStart().toLowerCase().startsWith("<html");
    if (isHtmlResponse) {
      console.warn(
        `[autognostic] HTML response from extensionless URL ${rawUrl} — applying WebPageProcessor pipeline`
      );
      try {
        const processor = new WebPageProcessor();
        const extracted = processor.extractFromHtml(content, rawUrl);
        const pdfLink = processor.findBestPdfLink(extracted);
        if (pdfLink) {
          try {
            const pdfRes = await http.get(pdfLink.href);
            if (pdfRes.ok) {
              const extractor = new PdfExtractor();
              const pdfResult = await extractor.extract(
                Buffer.from(await pdfRes.arrayBuffer())
              );
              content = pdfResult.text;
              contentType = "text/plain";
              console.debug(
                `[autognostic] Extracted ${pdfResult.pageCount} pages from PDF: ${pdfLink.href}`
              );
            } else {
              content = extracted.text;
              contentType = "text/plain";
            }
          } catch (pdfErr) {
            console.debug(`[autognostic] PDF extraction failed, using HTML text:`, pdfErr);
            content = extracted.text;
            contentType = "text/plain";
          }
        } else {
          content = extracted.text;
          contentType = "text/plain";
        }
      } catch (htmlErr) {
        console.debug(`[autognostic] HTML processing failed, using raw content:`, htmlErr);
      }
    }
  }

  // Store full document for exact quote retrieval
  const sourceId = params.metadata?.sourceId as string | undefined;
  const versionId = params.metadata?.versionId as string | undefined;
  if (sourceId && versionId) {
    const contentHash = createHash("sha256").update(content).digest("hex");

    // Store with original URL (what user likely mentions in conversation)
    await autognosticDocumentsRepository.store(runtime, {
      sourceId,
      versionId,
      url: params.url,
      content,
      contentHash,
      mimeType: contentType,
      byteSize: Buffer.byteLength(content, "utf8"),
    });

    // Compute and store structural profile for retrieval
    try {
      const profile = analyzeDocument(content);
      await autognosticDocumentsRepository.updateProfile(runtime, params.url, profile);
    } catch (err) {
      console.debug(`[autognostic] Profile analysis failed (non-fatal):`, err);
    }

    // Also store with raw URL if different (for flexible lookup)
    if (rawUrl !== params.url) {
      try {
        await autognosticDocumentsRepository.store(runtime, {
          sourceId: randomUUID(),
          versionId,
          url: rawUrl,
          content,
          contentHash,
          mimeType: contentType,
          byteSize: Buffer.byteLength(content, "utf8"),
        });
        // Also store profile for raw URL variant
        try {
          const profile = analyzeDocument(content);
          await autognosticDocumentsRepository.updateProfile(runtime, rawUrl, profile);
        } catch { /* non-fatal */ }
      } catch (err) {
        // Ignore duplicate key errors - rawUrl might already exist
        console.debug(`[autognostic] Could not store raw URL entry:`, err);
      }
    }
  }

  const clientDocumentId = randomUUID();
  const worldId = params.worldId ?? runtime.agentId;

  const result = await knowledge.addKnowledge({
    worldId,
    roomId: params.roomId,
    entityId: params.entityId,
    clientDocumentId,
    originalFilename: params.filename,
    contentType,
    content,
    metadata: {
      sourceUrl: params.url,
      rawUrl: rawUrl !== params.url ? rawUrl : undefined,
      autognostic: true,
      ...(params.metadata ?? {}),
    },
  });

  return {
    knowledgeDocumentId: result.storedDocumentMemoryId as string,
    clientDocumentId,
    worldId,
  };
}
