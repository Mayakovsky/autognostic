/**
 * WebPageProcessor — HTML→text extraction + PDF link discovery.
 * Uses linkedom for lightweight DOM parsing.
 *
 * Text extraction walks the DOM tree and converts elements to structured
 * plain text with paragraph breaks, heading markers, and list prefixes.
 * This preserves document structure for downstream sentence/paragraph profiling.
 */

import { parseHTML } from "linkedom";

export interface PageLink {
  href: string;
  text: string;
  type: "pdf" | "doc" | "html" | "unknown";
}

export interface ExtractedPage {
  title: string;
  text: string;
  links: PageLink[];
  pdfLinks: PageLink[];
  metadata: {
    description?: string;
    author?: string;
    doi?: string;
    citationPdfUrl?: string;
  };
}

/** Tags to remove entirely before text extraction */
const REMOVE_TAGS = new Set([
  "script", "style", "nav", "footer", "aside", "header",
  "noscript", "iframe", "svg", "form",
]);

/** Tags whose class/id patterns indicate non-content (ads, nav, social, etc.) */
const JUNK_CLASS_PATTERN = /\b(nav|menu|sidebar|footer|cookie|banner|ad-|ads-|advert|popup|modal|social|share|comment|related|recommended|newsletter|signup|promo)\b/i;

/** Pattern matching reference/bibliography sections — should NOT be removed by junk filter */
const REFERENCE_SECTION_PATTERN = /\breferences?\b|\bbibliography\b|\bcitations?\b/i;

/** Max extracted text length (chars) before truncation */
const MAX_EXTRACTED_CHARS = 500_000;

/** Block-level elements that produce paragraph breaks */
const BLOCK_ELEMENTS = new Set([
  "p", "div", "section", "article", "main", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "tr", "thead", "tbody", "tfoot",
  "figure", "figcaption", "details", "summary",
  "pre", "address",
]);

/** Heading elements mapped to markdown-style prefixes */
const HEADING_PREFIX: Record<string, string> = {
  h1: "# ", h2: "## ", h3: "### ", h4: "#### ", h5: "##### ", h6: "###### ",
};

function classifyLink(href: string, text: string): PageLink["type"] {
  const lower = href.toLowerCase();
  if (lower.endsWith(".pdf") || lower.includes("/pdf/")) return "pdf";
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) return "doc";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (/\bpdf\b/i.test(text)) return "pdf";
  return "unknown";
}

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * Walk the DOM tree and convert to structured plain text.
 * Preserves paragraph breaks, headings, list items, blockquotes, and table rows.
 */
function domToText(node: any): string {
  if (!node) return "";

  // Text node — return content, collapsing internal whitespace runs
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return (node.textContent || "").replace(/[ \t]+/g, " ");
  }

  // Not an element — skip
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return "";

  const tag = (node.tagName || "").toLowerCase();

  // Skip removed tags (shouldn't exist after removal pass, but defensive)
  if (REMOVE_TAGS.has(tag)) return "";

  // Skip elements with junk class/id patterns (but preserve reference sections)
  const className = node.getAttribute?.("class") || "";
  const id = node.getAttribute?.("id") || "";
  if (JUNK_CLASS_PATTERN.test(className) || JUNK_CLASS_PATTERN.test(id)) {
    if (!REFERENCE_SECTION_PATTERN.test(className) && !REFERENCE_SECTION_PATTERN.test(id)) {
      return "";
    }
  }

  // Recurse into children
  const childText = Array.from(node.childNodes || [])
    .map((child: any) => domToText(child))
    .join("");

  // Apply element-specific formatting
  switch (tag) {
    // Headings → markdown prefix + double newline
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const trimmed = childText.trim();
      if (!trimmed) return "";
      return `\n\n${HEADING_PREFIX[tag]}${trimmed}\n\n`;
    }

    // Paragraphs → double newline separation
    case "p": {
      const trimmed = childText.trim();
      if (!trimmed) return "";
      return `\n\n${trimmed}\n\n`;
    }

    // Line breaks
    case "br":
      return "\n";

    // Blockquotes → "> " prefix per line
    case "blockquote": {
      const trimmed = childText.trim();
      if (!trimmed) return "";
      const quoted = trimmed
        .split("\n")
        .map((line: string) => `> ${line}`)
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }

    // List items → "- " prefix
    case "li": {
      const trimmed = childText.trim();
      if (!trimmed) return "";
      return `\n- ${trimmed}`;
    }

    // Lists → wrap with newlines
    case "ul": case "ol":
      return `\n${childText}\n`;

    // Table cells → tab-separated
    case "td": case "th":
      return `${childText.trim()}\t`;

    // Table rows → newline-separated, strip trailing tab
    case "tr":
      return `\n${childText.replace(/\t$/, "")}`;

    // Tables → wrap with newlines
    case "table":
      return `\n${childText}\n`;

    // Pre → preserve whitespace as-is
    case "pre":
      return `\n\n${node.textContent || ""}\n\n`;

    // Div and section → add paragraph breaks if they contain block content
    case "div": case "section": case "article": case "main": {
      // Only add breaks if this div likely wraps paragraph-level content
      const trimmed = childText.trim();
      if (!trimmed) return "";
      // If the child text already starts/ends with newlines, don't double up
      if (trimmed.startsWith("\n") || trimmed.endsWith("\n")) {
        return childText;
      }
      return `\n\n${trimmed}\n\n`;
    }

    // Figure caption
    case "figcaption": {
      const trimmed = childText.trim();
      if (!trimmed) return "";
      return `\n[${trimmed}]\n`;
    }

    // Inline elements — pass through
    default:
      return childText;
  }
}

/**
 * Clean up the raw extracted text:
 * - Collapse 3+ newlines to 2 (paragraph breaks)
 * - Trim leading/trailing whitespace per line
 * - Remove blank lines that are just spaces
 */
function cleanExtractedText(raw: string): string {
  let text = raw;

  // Truncate oversized text before expensive regex passes
  if (text.length > MAX_EXTRACTED_CHARS) {
    console.warn(
      `[autognostic] Extracted text exceeds ${MAX_EXTRACTED_CHARS} chars (${text.length}), truncating`
    );
    text = text.slice(0, MAX_EXTRACTED_CHARS);
  }

  return text
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    // Trim trailing whitespace per line
    .replace(/[ \t]+$/gm, "")
    // Collapse 3+ consecutive newlines to exactly 2
    .replace(/\n{3,}/g, "\n\n")
    // Remove lines that are only whitespace
    .replace(/^\s+$/gm, "")
    // Final trim
    .trim();
}

export class WebPageProcessor {
  extractFromHtml(html: string, baseUrl: string): ExtractedPage {
    const { document } = parseHTML(html);

    // Extract metadata from <meta> tags
    const getMeta = (name: string): string | undefined => {
      const el =
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="${name}"]`);
      return (el as Element | null)?.getAttribute("content") || undefined;
    };

    const metadata: ExtractedPage["metadata"] = {
      description: getMeta("description") || getMeta("og:description"),
      author: getMeta("author") || getMeta("citation_author"),
      doi: getMeta("citation_doi"),
      citationPdfUrl: getMeta("citation_pdf_url"),
    };

    const title =
      document.querySelector("title")?.textContent?.trim() ||
      getMeta("og:title") ||
      "";

    // Remove unwanted tags
    for (const tag of REMOVE_TAGS) {
      const elements = document.querySelectorAll(tag);
      for (const el of elements) {
        (el as Element).remove();
      }
    }

    // Remove elements with junk class/id patterns (ads, nav, sidebars, etc.)
    // Exception: preserve reference/bibliography sections
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      const cn = (el as Element).getAttribute?.("class") || "";
      const elId = (el as Element).getAttribute?.("id") || "";
      if (JUNK_CLASS_PATTERN.test(cn) || JUNK_CLASS_PATTERN.test(elId)) {
        // Don't remove reference sections
        if (REFERENCE_SECTION_PATTERN.test(cn) || REFERENCE_SECTION_PATTERN.test(elId)) {
          continue;
        }
        (el as Element).remove();
      }
    }

    // Prefer <article> or known publisher content selectors
    const contentRoot =
      document.querySelector("article") ||
      document.querySelector("[class*='article-body']") ||
      document.querySelector("[class*='article-content']") ||
      document.querySelector("[class*='fulltext']") ||
      document.querySelector("[class*='paper-content']") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.body;

    // Walk DOM tree and convert to structured text
    const rawText = domToText(contentRoot);
    const text = cleanExtractedText(rawText);

    // Extract links (re-parse since we may have removed elements)
    // Use the full document for link extraction, not just content root
    const anchors = document.querySelectorAll("a[href]");
    const links: PageLink[] = [];
    const pdfLinks: PageLink[] = [];

    for (const a of anchors) {
      const href = (a as Element).getAttribute("href");
      if (!href) continue;
      const resolved = resolveUrl(href, baseUrl);
      const linkText = (a as Element).textContent?.trim() || "";
      const type = classifyLink(resolved, linkText);
      const link: PageLink = { href: resolved, text: linkText, type };
      links.push(link);
      if (type === "pdf") pdfLinks.push(link);
    }

    return { title, text, links, pdfLinks, metadata };
  }

  /**
   * Find the best PDF link from an extracted page.
   * Priority: citation_pdf_url meta > .pdf hrefs > anchor text patterns > arXiv abs→pdf.
   */
  findBestPdfLink(page: ExtractedPage): PageLink | null {
    // 1. citation_pdf_url meta tag (used by academic publishers)
    if (page.metadata.citationPdfUrl) {
      return {
        href: page.metadata.citationPdfUrl,
        text: "citation_pdf_url",
        type: "pdf",
      };
    }

    // 2. Direct .pdf links
    if (page.pdfLinks.length > 0) {
      // Prefer links with "download" or "full" in text
      const preferred = page.pdfLinks.find(
        (l) => /download|full\s*text|pdf/i.test(l.text)
      );
      return preferred || page.pdfLinks[0];
    }

    // 3. arXiv abs → pdf construction
    const arxivAbsMatch = page.links.find((l) =>
      /arxiv\.org\/abs\//.test(l.href)
    );
    if (arxivAbsMatch) {
      return {
        href: arxivAbsMatch.href.replace("/abs/", "/pdf/") + ".pdf",
        text: "arXiv PDF",
        type: "pdf",
      };
    }

    return null;
  }
}
