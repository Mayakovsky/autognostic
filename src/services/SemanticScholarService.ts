/**
 * SemanticScholarService — Paper discovery via Semantic Scholar Academic Graph API.
 *
 * Thin discovery layer UPSTREAM of ContentResolver.
 * Finds related papers, citations, and references; returns metadata + OA URLs.
 * Does NOT ingest papers — user feeds discovered URLs to ADD_URL_TO_KNOWLEDGE.
 *
 * PURE service: no database, no IAgentRuntime.
 */

import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface S2Paper {
  paperId: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  venue: string | null;
  citationCount: number;
  openAccessPdfUrl: string | null;
  externalIds: { DOI?: string; ArXivId?: string };
  url: string;
}

export interface S2RelatedResult {
  sourcePaper: S2Paper;
  relatedPapers: S2Paper[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const S2_API_BASE = "https://api.semanticscholar.org/graph/v1";
const S2_RECOMMEND_BASE = "https://api.semanticscholar.org/recommendations/v1/papers/forpaper";
const TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const PAPER_FIELDS = "paperId,title,authors,year,abstract,venue,citationCount,openAccessPdf,externalIds,url";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return process.env.SEMANTIC_SCHOLAR_API_KEY || null;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = getApiKey();
  if (key) headers["x-api-key"] = key;
  return headers;
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(n, MAX_LIMIT));
}

/** Map a raw identifier to S2 paper_id format. */
export function buildPaperId(identifier: string): string {
  const trimmed = identifier.trim();

  // DOI pattern: 10.xxxx/...
  if (/^10\.\d{4,}\//.test(trimmed)) return `DOI:${trimmed}`;

  // doi.org URL
  const doiUrlMatch = trimmed.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
  if (doiUrlMatch) return `DOI:${doiUrlMatch[1].replace(/[.,;:)\]}>]+$/, "")}`;

  // arXiv ID: 4-digit year + dot + digits (with optional version)
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) return `ArXiv:${trimmed}`;

  // arXiv URL
  const arxivMatch = trimmed.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (arxivMatch) return `ArXiv:${arxivMatch[1]}`;

  // Semantic Scholar URL
  const s2Match = trimmed.match(/semanticscholar\.org\/paper\/[^/]*\/([a-f0-9]{40})/i);
  if (s2Match) return s2Match[1];

  // Publisher URL with DOI in path
  const doiPathMatch = trimmed.match(/\/(10\.\d{4,}\/[^\s?#]+)/);
  if (doiPathMatch) return `DOI:${doiPathMatch[1].replace(/[.,;:)\]}>]+$/, "")}`;

  // Passthrough (assume S2 paper ID or corpus ID)
  return trimmed;
}

/** Normalize raw S2 API paper object to S2Paper. */
function normalizePaper(raw: Record<string, unknown>): S2Paper {
  const authors = Array.isArray(raw.authors)
    ? (raw.authors as Array<{ name?: string }>).map(a => a.name || "Unknown")
    : [];
  const externalIds = (raw.externalIds ?? {}) as { DOI?: string; ArXivId?: string };
  const oaPdf = raw.openAccessPdf as { url?: string } | null;
  return {
    paperId: (raw.paperId as string) || "",
    title: (raw.title as string) || "Untitled",
    authors,
    year: typeof raw.year === "number" ? raw.year : null,
    abstract: typeof raw.abstract === "string" ? raw.abstract : null,
    venue: typeof raw.venue === "string" && raw.venue ? raw.venue : null,
    citationCount: typeof raw.citationCount === "number" ? raw.citationCount : 0,
    openAccessPdfUrl: oaPdf?.url || null,
    externalIds: { DOI: externalIds.DOI, ArXivId: externalIds.ArXivId },
    url: (raw.url as string) || "",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a single paper by identifier (DOI, arXiv ID, S2 ID, or URL).
 * Returns null on any failure.
 */
export async function lookupPaper(identifier: string): Promise<S2Paper | null> {
  const paperId = buildPaperId(identifier);
  const opLogger = logger.child({ operation: "lookupPaper", paperId });

  const url = `${S2_API_BASE}/paper/${encodeURIComponent(paperId)}?fields=${PAPER_FIELDS}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("Paper not found in Semantic Scholar");
      return null;
    }
    if (res.status === 429) {
      opLogger.warn("Semantic Scholar rate limited");
      return null;
    }
    if (!res.ok) {
      opLogger.warn("Semantic Scholar API error", { status: res.status });
      return null;
    }

    const data = await res.json();
    return normalizePaper(data as Record<string, unknown>);
  } catch (err) {
    opLogger.warn("Semantic Scholar lookup failed", { paperId }, err);
    return null;
  }
}

/**
 * Get recommended/related papers for a given S2 paper ID.
 * Returns empty array on failure.
 */
export async function getRelatedPapers(paperId: string, limit?: number): Promise<S2Paper[]> {
  const n = clampLimit(limit);
  const opLogger = logger.child({ operation: "getRelatedPapers", paperId, limit: n });

  const url = `${S2_RECOMMEND_BASE}/${encodeURIComponent(paperId)}?fields=${PAPER_FIELDS}&limit=${n}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("No recommendations found");
      return [];
    }
    if (res.status === 429) {
      opLogger.warn("Semantic Scholar rate limited (recommendations)");
      return [];
    }
    if (!res.ok) {
      opLogger.warn("Recommendations API error", { status: res.status });
      return [];
    }

    const data = await res.json();
    const papers = (data as { recommendedPapers?: unknown[] }).recommendedPapers;
    if (!Array.isArray(papers)) return [];
    return papers.map(p => normalizePaper(p as Record<string, unknown>));
  } catch (err) {
    opLogger.warn("Semantic Scholar recommendations failed", { paperId }, err);
    return [];
  }
}

/**
 * Get papers that cite a given paper.
 * Returns empty array on failure.
 */
export async function getCitations(paperId: string, limit?: number): Promise<S2Paper[]> {
  const n = clampLimit(limit);
  const opLogger = logger.child({ operation: "getCitations", paperId, limit: n });

  const url = `${S2_API_BASE}/paper/${encodeURIComponent(paperId)}/citations?fields=${PAPER_FIELDS}&limit=${n}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("Paper not found (citations)");
      return [];
    }
    if (res.status === 429) {
      opLogger.warn("Semantic Scholar rate limited (citations)");
      return [];
    }
    if (!res.ok) {
      opLogger.warn("Citations API error", { status: res.status });
      return [];
    }

    const data = await res.json();
    const entries = (data as { data?: unknown[] }).data;
    if (!Array.isArray(entries)) return [];
    return entries
      .map(e => (e as { citingPaper?: Record<string, unknown> }).citingPaper)
      .filter((p): p is Record<string, unknown> => p != null && typeof p.paperId === "string")
      .map(normalizePaper);
  } catch (err) {
    opLogger.warn("Semantic Scholar citations failed", { paperId }, err);
    return [];
  }
}

/**
 * Get papers referenced by a given paper.
 * Returns empty array on failure.
 */
export async function getReferences(paperId: string, limit?: number): Promise<S2Paper[]> {
  const n = clampLimit(limit);
  const opLogger = logger.child({ operation: "getReferences", paperId, limit: n });

  const url = `${S2_API_BASE}/paper/${encodeURIComponent(paperId)}/references?fields=${PAPER_FIELDS}&limit=${n}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("Paper not found (references)");
      return [];
    }
    if (res.status === 429) {
      opLogger.warn("Semantic Scholar rate limited (references)");
      return [];
    }
    if (!res.ok) {
      opLogger.warn("References API error", { status: res.status });
      return [];
    }

    const data = await res.json();
    const entries = (data as { data?: unknown[] }).data;
    if (!Array.isArray(entries)) return [];
    return entries
      .map(e => (e as { citedPaper?: Record<string, unknown> }).citedPaper)
      .filter((p): p is Record<string, unknown> => p != null && typeof p.paperId === "string")
      .map(normalizePaper);
  } catch (err) {
    opLogger.warn("Semantic Scholar references failed", { paperId }, err);
    return [];
  }
}
