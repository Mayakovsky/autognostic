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
import { resolveOpenAccess, extractDoiFromUrl } from "./UnpaywallResolver";

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

/**
 * Section name alternation for regex matching.
 * Order matters: longer names first to avoid partial matches.
 */
const SECTION_NAMES_RE =
  "Supporting Information|Materials and Methods|Results and Discussion|Literature Review|Related Works?" +
  "|Supplementary Materials?|Acknowledgements?|Acknowledgments?" +
  "|Introduction|Background|Methodology|Bibliography|Conclusions?" +
  "|Discussion|References|Appendix|Methods?|Results?|Abstract|Keywords";

/** Regex to detect figure/table caption references (e.g., "Figure 1.", "Fig. 2", "Table 3.") */
const FIG_TABLE_RE = /(?:Fig(?:ure)?|Tab(?:le)?)\s+\d+$/i;

/**
 * Find the character offset where real content starts, past any metadata preamble.
 * Detects journal metadata (copyright, ISSN, Vol/No/pp) that should not
 * interfere with section header detection.
 * Does NOT delete preamble — just identifies the boundary.
 */
export function findContentStart(text: string): number {
  const lines = text.split("\n");
  let lastPreambleLine = -1;

  // Only scan the first 50 lines (preamble is at the top)
  const scanLimit = Math.min(lines.length, 50);
  for (let i = 0; i < scanLimit; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (
      line.includes("\u00A9") || // © (unicode)
      line.includes("©") ||
      /\bCopyright\b/i.test(line) ||
      /\bLicensed under\b/i.test(line) ||
      /\bAll rights reserved\b/i.test(line) ||
      /\bVol\.\s*\d+/i.test(line) ||
      /\bNo\.\s*\d+,?\s*pp\b/i.test(line) ||
      /\bpp\.\s*\d+\s*[-–]\s*\d+/i.test(line) ||
      /\bISSN\b/i.test(line) ||
      /\bISBN\b/i.test(line)
    ) {
      lastPreambleLine = i;
    }
  }

  if (lastPreambleLine < 0) return 0;

  // Return char offset of the line after the last preamble line
  let offset = 0;
  for (let i = 0; i <= lastPreambleLine; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset;
}

/**
 * Detect possible double-column layout from line length distribution.
 * Returns true if median non-empty line length is < 40 chars,
 * which suggests interleaved columns from PDF extraction.
 */
export function detectDoubleColumnLayout(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 10) return false;

  const lengths = lines.map(l => l.trim().length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  return median < 40;
}

/**
 * Check if text around a given offset looks like table data.
 * Table data has >70% non-alpha characters (digits, pipes, tabs, dashes).
 */
function isTableDataContext(text: string, offset: number): boolean {
  const start = Math.max(0, offset - 40);
  const end = Math.min(text.length, offset + 40);
  const context = text.substring(start, end);
  if (context.length < 10) return false;
  const alphaCount = (context.match(/[a-zA-Z]/g) || []).length;
  return alphaCount / context.length < 0.3;
}

/**
 * Normalize flat PDF text by re-inserting line breaks.
 * unpdf with mergePages:true often produces a single line of text.
 * This detects that case and inserts paragraph breaks before known section headers.
 */
export function normalizePdfText(text: string): string {
  if (!text || text.length < 100) return text;

  const lineCount = text.split("\n").length;
  // If text already has reasonable line structure (at least 1 line per 500 chars), leave it
  if (text.length > 500 && lineCount > text.length / 500) return text;

  // Find content start (past copyright/journal metadata preamble)
  const contentStart = findContentStart(text);
  const preamble = text.substring(0, contentStart);
  let content = text.substring(contentStart);

  // Apply section header patterns only to content (not preamble)

  // Pattern 1: Section name followed by colon (e.g., "Background: text...")
  const colonRe = new RegExp(
    `(\\s)(${SECTION_NAMES_RE})(\\s*:)`,
    "gi"
  );
  content = content.replace(colonRe, "$1\n\n$2$3\n");

  // Pattern 2: Section name after sentence-ending punctuation (e.g., "...results. Methods We...")
  const afterPuncRe = new RegExp(
    `([.!?])\\s+(${SECTION_NAMES_RE})\\s`,
    "gi"
  );
  content = content.replace(afterPuncRe, "$1\n\n$2\n");

  // Pattern 3: Standalone "Abstract" often appears without punctuation before it
  content = content.replace(/(\S)\s+(Abstract)\s(?=[A-Z])/gi, "$1\n\n$2\n");

  // Pattern 4: Numbered section headers after punctuation
  const numberedRe = new RegExp(
    `([.!?])\\s+(\\d{1,2}(?:\\.\\d{1,2})?)\\s+(${SECTION_NAMES_RE})\\s`,
    "gi"
  );
  content = content.replace(numberedRe, "$1\n\n$2 $3\n");

  // Pattern 5: Numbered section headers after word characters (no punctuation)
  // Only matches when section name is ALL CAPS to reduce false positives
  const numberedAfterWordRe = new RegExp(
    `(\\w)\\s+(\\d{1,2}(?:\\.\\d{1,2})?)\\s+((?:${SECTION_NAMES_RE})(?=\\s))(?=[A-Z\\s]*[A-Z]{2})`,
    "gi"
  );
  content = content.replace(numberedAfterWordRe, (match, pre, num, name) => {
    if (name === name.toUpperCase()) {
      return `${pre}\n\n${num} ${name}\n`;
    }
    return match;
  });

  let result = preamble + content;

  // Step 2: If text is still very flat (>2000 chars per line average),
  // break on sentence-ending period followed by capital letter.
  // Guards: skip figure/table captions and table data contexts.
  const newLineCount = result.split("\n").length;
  if (newLineCount < result.length / 2000) {
    result = result.replace(/(\.) ([A-Z][a-z])/g, (match, dot, cap, offset) => {
      // Guard: don't break after figure/table references (e.g., "Figure 1. Caption")
      const preceding = result.substring(Math.max(0, offset - 30), offset);
      if (FIG_TABLE_RE.test(preceding)) return match;

      // Guard: don't break in table data contexts (mostly numbers/delimiters)
      if (isTableDataContext(result, offset)) return match;

      return `.\n${cap}`;
    });
  }

  return result;
}

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
    const normalized = normalizePdfText(result.text);
    if (normalized !== result.text) {
      diagnostics.push(`PDF text normalized: ${result.text.split("\n").length} → ${normalized.split("\n").length} lines`);
    }
    if (detectDoubleColumnLayout(normalized)) {
      diagnostics.push("Possible double-column layout detected — extraction quality may be lower");
    }
    const text = this.truncateText(normalized, diagnostics);

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

    // Quality gate: if HTML has proper heading structure, prefer it over PDF.
    // HTML heading tags (h1-h6) become markdown prefixes (## Section) which
    // preserve hierarchy that flat PDF text loses. This naturally distinguishes
    // structured-abstract inline headers from full paper section headings.
    const mdHeadingCount = (extracted.text.match(/^#{1,3}\s+.+$/gm) || []).length;
    const htmlHasStructure = mdHeadingCount >= 3 && extracted.text.length > 5000;
    diagnostics.push(`HTML heading structure: ${mdHeadingCount} markdown headings, structured=${htmlHasStructure}`);

    if (htmlHasStructure) {
      diagnostics.push(`Using structured HTML (${mdHeadingCount} headings) — skipping PDF download`);
    }

    // Try PDF link from HTML page only if HTML lacks heading structure
    if (!htmlHasStructure) {
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
    }

    // Unpaywall fallback: if HTML lacks structure and no PDF link succeeded, try OA resolution
    if (!htmlHasStructure) {
      const doi = extracted.metadata.doi || extractDoiFromUrl(resolvedUrl);
      if (doi) {
        diagnostics.push(`Trying Unpaywall OA resolution for DOI: ${doi}`);
        const oaResult = await resolveOpenAccess(doi);
        if (oaResult?.pdfUrl) {
          diagnostics.push(`Unpaywall resolved: ${oaResult.pdfUrl} (${oaResult.oaStatus})`);
          const pdfResult = await this.tryPdfDownload(oaResult.pdfUrl, diagnostics);
          if (pdfResult) {
            const text = this.truncateText(pdfResult.text, diagnostics);
            return {
              text,
              contentType: "text/plain",
              source: "pdf",
              title: extracted.title || pdfResult.metadata.title || "",
              resolvedUrl,
              metadata: {
                doi,
                citationPdfUrl: oaResult.pdfUrl,
                description: extracted.metadata.description || undefined,
              },
              diagnostics,
            };
          }
        }
      }
    }

    // Use HTML extracted text (either preferred or fallback)
    diagnostics.push(`Using HTML extracted text (${extracted.text.length} chars)`);
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
      const normalized = normalizePdfText(result.text);
      if (normalized !== result.text) {
        diagnostics.push(`PDF text normalized: ${result.text.split("\n").length} → ${normalized.split("\n").length} lines`);
      }
      if (detectDoubleColumnLayout(normalized)) {
        diagnostics.push("Possible double-column layout detected — extraction quality may be lower");
      }
      diagnostics.push(`PDF extracted: ${result.pageCount} pages, ${normalized.length} chars`);
      return { text: normalized, metadata: result.metadata };
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
