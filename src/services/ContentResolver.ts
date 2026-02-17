/**
 * ContentResolver — unified URL→text pipeline.
 * Routes on response content-type (never URL extension).
 * PDF verification requires BOTH content-type header AND %PDF magic bytes.
 *
 * PURE service: no database, no IAgentRuntime.
 * Depends only on HttpService, WebPageProcessor, PdfExtractor,
 * and ScientificPaperDetector (all stateless).
 */

import { HttpService } from "./httpService";
import { WebPageProcessor, type ExtractedPage } from "./WebPageProcessor";
import { PdfExtractor } from "./PdfExtractor";
import { getScientificPaperDetector } from "./ScientificPaperDetector";

export interface ResolvedContent {
  text: string;
  contentType: string;
  source: "pdf" | "html" | "raw";
  title: string;
  resolvedUrl: string;
  metadata: {
    doi?: string;
    authors?: string[];
    citationPdfUrl?: string;
    description?: string;
  };
  diagnostics: string[];
}

const MAX_TEXT_LENGTH = 500_000;

export class ContentResolver {
  private http: HttpService;
  private webProcessor: WebPageProcessor;
  private pdfExtractor: PdfExtractor;

  constructor(http: HttpService) {
    this.http = http;
    this.webProcessor = new WebPageProcessor();
    this.pdfExtractor = new PdfExtractor();
  }

  /**
   * Resolve a URL to clean, structured text content.
   */
  async resolve(url: string): Promise<ResolvedContent> {
    const diagnostics: string[] = [];
    const resolvedUrl = normalizeToRawUrl(url);

    if (resolvedUrl !== url) {
      diagnostics.push(`URL normalized: ${url} → ${resolvedUrl}`);
    }

    // Build Accept header — prefer PDF for academic publishers
    const acceptHeader = this.getAcceptHeader(resolvedUrl);
    diagnostics.push(`Accept header: ${acceptHeader}`);

    // Fetch the URL
    const res = await this.http.get(resolvedUrl, {
      headers: { Accept: acceptHeader },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText}) for ${resolvedUrl}`);
    }

    const responseContentType = res.headers.get("content-type") || "";
    diagnostics.push(`Response content-type: ${responseContentType}`);

    // Route on response content-type
    if (responseContentType.includes("application/pdf")) {
      return this.handlePdfResponse(res, resolvedUrl, responseContentType, diagnostics);
    }

    if (
      responseContentType.includes("text/html") ||
      responseContentType.includes("application/xhtml")
    ) {
      return this.handleHtmlResponse(res, resolvedUrl, diagnostics);
    }

    if (
      responseContentType.includes("text/plain") ||
      responseContentType.includes("text/markdown")
    ) {
      return this.handleTextResponse(res, resolvedUrl, responseContentType, diagnostics);
    }

    // Fallback — try to decode as text, sniff HTML
    return this.handleUnknownResponse(res, resolvedUrl, responseContentType, diagnostics);
  }

  // ---------------------------------------------------------------------------
  // Response handlers
  // ---------------------------------------------------------------------------

  private async handlePdfResponse(
    res: Response,
    resolvedUrl: string,
    contentType: string,
    diagnostics: string[]
  ): Promise<ResolvedContent> {
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (!isPdfBytes(bytes)) {
      diagnostics.push("Content-type claims PDF but magic bytes missing — falling back to text decode");
      const text = new TextDecoder().decode(bytes);
      return this.tryHtmlFallback(text, resolvedUrl, contentType, diagnostics);
    }

    diagnostics.push("Direct PDF response — extracting text");
    const result = await this.pdfExtractor.extract(bytes);
    const text = this.truncateText(result.text, diagnostics);

    return {
      text,
      contentType: "text/plain",
      source: "pdf",
      title: result.metadata.title || "",
      resolvedUrl,
      metadata: {},
      diagnostics,
    };
  }

  private async handleHtmlResponse(
    res: Response,
    resolvedUrl: string,
    diagnostics: string[]
  ): Promise<ResolvedContent> {
    const html = await res.text();
    diagnostics.push(`HTML response received (${html.length} chars)`);

    const extracted = this.webProcessor.extractFromHtml(html, resolvedUrl);
    diagnostics.push(`HTML extracted: ${extracted.text.length} chars, title="${extracted.title}"`);

    // Try PDF link from HTML page
    const pdfLink = this.webProcessor.findBestPdfLink(extracted);
    if (pdfLink) {
      diagnostics.push(`PDF link found: ${pdfLink.text} → ${pdfLink.href}`);
      const pdfResult = await this.tryPdfDownload(pdfLink.href, diagnostics);
      if (pdfResult) {
        const text = this.truncateText(pdfResult.text, diagnostics);
        return {
          text,
          contentType: "text/plain",
          source: "pdf",
          title: extracted.title || pdfResult.metadata.title || "",
          resolvedUrl,
          metadata: {
            doi: extracted.metadata.doi || undefined,
            citationPdfUrl: extracted.metadata.citationPdfUrl || undefined,
            description: extracted.metadata.description || undefined,
          },
          diagnostics,
        };
      }
    }

    // Fall back to HTML extracted text
    diagnostics.push(`Falling back to HTML extracted text (${extracted.text.length} chars)`);
    const text = this.truncateText(extracted.text, diagnostics);

    return {
      text,
      contentType: "text/plain",
      source: "html",
      title: extracted.title,
      resolvedUrl,
      metadata: {
        doi: extracted.metadata.doi || undefined,
        citationPdfUrl: extracted.metadata.citationPdfUrl || undefined,
        description: extracted.metadata.description || undefined,
      },
      diagnostics,
    };
  }

  private async handleTextResponse(
    res: Response,
    resolvedUrl: string,
    contentType: string,
    diagnostics: string[]
  ): Promise<ResolvedContent> {
    const rawText = await res.text();
    diagnostics.push(`Text response (${contentType}): ${rawText.length} chars`);
    const text = this.truncateText(rawText, diagnostics);

    return {
      text,
      contentType,
      source: "raw",
      title: "",
      resolvedUrl,
      metadata: {},
      diagnostics,
    };
  }

  private async handleUnknownResponse(
    res: Response,
    resolvedUrl: string,
    contentType: string,
    diagnostics: string[]
  ): Promise<ResolvedContent> {
    diagnostics.push(`Unknown content-type: ${contentType} — attempting text decode`);
    const rawText = await res.text();

    // Sniff for HTML
    const trimmed = rawText.trimStart().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      diagnostics.push("Body looks like HTML — applying HTML pipeline");
      // Re-create a pseudo-response is overkill; just extract directly
      const extracted = this.webProcessor.extractFromHtml(rawText, resolvedUrl);
      const text = this.truncateText(extracted.text, diagnostics);
      return {
        text,
        contentType: "text/plain",
        source: "html",
        title: extracted.title,
        resolvedUrl,
        metadata: {
          doi: extracted.metadata.doi || undefined,
          description: extracted.metadata.description || undefined,
        },
        diagnostics,
      };
    }

    const text = this.truncateText(rawText, diagnostics);
    return {
      text,
      contentType: contentType || "text/plain",
      source: "raw",
      title: "",
      resolvedUrl,
      metadata: {},
      diagnostics,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async tryPdfDownload(
    pdfUrl: string,
    diagnostics: string[]
  ): Promise<{ text: string; metadata: { title?: string } } | null> {
    try {
      const pdfRes = await this.http.get(pdfUrl);
      if (!pdfRes.ok) {
        diagnostics.push(`PDF download failed: HTTP ${pdfRes.status}`);
        return null;
      }

      const pdfContentType = pdfRes.headers.get("content-type") || "";
      if (!pdfContentType.includes("application/pdf")) {
        diagnostics.push(`PDF link returned non-PDF content-type: ${pdfContentType}`);
        return null;
      }

      const bytes = new Uint8Array(await pdfRes.arrayBuffer());
      if (!isPdfBytes(bytes)) {
        diagnostics.push("PDF link response has application/pdf header but missing %PDF magic bytes");
        return null;
      }

      const result = await this.pdfExtractor.extract(bytes);
      diagnostics.push(`PDF extracted: ${result.pageCount} pages, ${result.text.length} chars`);
      return { text: result.text, metadata: result.metadata };
    } catch (err) {
      diagnostics.push(`PDF download error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private tryHtmlFallback(
    text: string,
    resolvedUrl: string,
    contentType: string,
    diagnostics: string[]
  ): ResolvedContent {
    const trimmed = text.trimStart().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      diagnostics.push("Fake PDF is actually HTML — extracting");
      const extracted = this.webProcessor.extractFromHtml(text, resolvedUrl);
      return {
        text: this.truncateText(extracted.text, diagnostics),
        contentType: "text/plain",
        source: "html",
        title: extracted.title,
        resolvedUrl,
        metadata: {
          doi: extracted.metadata.doi || undefined,
          description: extracted.metadata.description || undefined,
        },
        diagnostics,
      };
    }
    return {
      text: this.truncateText(text, diagnostics),
      contentType,
      source: "raw",
      title: "",
      resolvedUrl,
      metadata: {},
      diagnostics,
    };
  }

  private getAcceptHeader(url: string): string {
    const detector = getScientificPaperDetector();
    if (detector.isLikelyScientificPaper(url)) {
      return "application/pdf, text/html;q=0.9, */*;q=0.1";
    }
    return "text/html, application/xhtml+xml, */*;q=0.1";
  }

  private truncateText(text: string, diagnostics: string[]): string {
    if (text.length > MAX_TEXT_LENGTH) {
      diagnostics.push(`Text exceeds ${MAX_TEXT_LENGTH} chars (${text.length}), truncating`);
      return text.slice(0, MAX_TEXT_LENGTH);
    }
    return text;
  }
}

// ---------------------------------------------------------------------------
// Pure functions (no instance state)
// ---------------------------------------------------------------------------

/**
 * Check if binary data starts with %PDF- magic bytes.
 */
export function isPdfBytes(data: Uint8Array): boolean {
  return (
    data.length >= 5 &&
    data[0] === 0x25 && // %
    data[1] === 0x50 && // P
    data[2] === 0x44 && // D
    data[3] === 0x46 && // F
    data[4] === 0x2d    // -
  );
}

/**
 * Convert URLs to their raw content equivalents.
 * - GitHub blob URLs → raw.githubusercontent.com
 * - GitLab blob URLs → raw URLs
 * - Gist URLs → raw URLs
 */
export function normalizeToRawUrl(url: string): string {
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

  return url;
}
