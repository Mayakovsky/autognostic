/**
 * WebPageProcessor — HTML→text extraction + PDF link discovery.
 * Uses linkedom for lightweight DOM parsing.
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

    // Prefer <article> or <main> if present
    const contentRoot =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body;

    // Extract text
    const text = contentRoot?.textContent
      ?.replace(/\s+/g, " ")
      .trim() || "";

    // Extract links
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
