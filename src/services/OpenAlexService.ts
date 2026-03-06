/**
 * OpenAlexService — Topic-based paper search via OpenAlex API.
 *
 * Thin discovery layer UPSTREAM of ContentResolver.
 * Searches the broadest open catalog (278-470M works) by topic query.
 * Returns ranked results with metadata + OA URLs.
 * Does NOT ingest papers — user selects which to feed to ADD_URL_TO_KNOWLEDGE.
 *
 * PURE service: no database, no IAgentRuntime.
 */

import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAlexResult {
  id: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  citedByCount: number;
  oaStatus: string;
  oaPdfUrl: string | null;
  abstract: string | null;
  source: string | null;
}

export interface SearchOptions {
  limit?: number;
  filterOA?: boolean;
  yearFrom?: number;
  yearTo?: number;
  sortBy?: "relevance" | "cited_by_count" | "publication_date";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENALEX_BASE = "https://api.openalex.org";
const TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getEmail(): string {
  return (
    process.env.UNPAYWALL_EMAIL ||
    process.env.CROSSREF_MAILTO ||
    "autognostic-plugin@users.noreply.github.com"
  );
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(n, MAX_LIMIT));
}

/**
 * OpenAlex stores abstracts as "inverted index" maps: { word: [positions] }.
 * Reconstruct to plain text.
 */
function reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string | null {
  if (!invertedIndex || typeof invertedIndex !== "object") return null;

  const entries = Object.entries(invertedIndex);
  if (entries.length === 0) return null;

  // Flatten to [position, word] pairs, sort by position, join
  const words: Array<[number, string]> = [];
  for (const [word, positions] of entries) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number") words.push([pos, word]);
    }
  }

  if (words.length === 0) return null;
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ");
}

/** Normalize a raw OpenAlex work object to OpenAlexResult. */
function normalizeWork(raw: Record<string, unknown>): OpenAlexResult {
  // Authors: raw.authorships[].author.display_name
  const authorships = Array.isArray(raw.authorships)
    ? (raw.authorships as Array<{ author?: { display_name?: string } }>)
        .map(a => a.author?.display_name || "Unknown")
    : [];

  // OA info
  const oa = (raw.open_access ?? {}) as { is_oa?: boolean; oa_status?: string };
  const oaStatus = oa.oa_status || (oa.is_oa ? "open" : "closed");

  // Best OA PDF URL: primary_location.pdf_url or best_oa_location.pdf_url
  const primaryLoc = raw.primary_location as { pdf_url?: string } | null;
  const bestOaLoc = raw.best_oa_location as { pdf_url?: string } | null;
  const oaPdfUrl = primaryLoc?.pdf_url || bestOaLoc?.pdf_url || null;

  // Source (journal/venue name)
  const primarySource = (raw.primary_location as { source?: { display_name?: string } } | null)
    ?.source?.display_name || null;

  // DOI: strip https://doi.org/ prefix if present
  let doi: string | null = typeof raw.doi === "string" ? raw.doi : null;
  if (doi?.startsWith("https://doi.org/")) doi = doi.slice("https://doi.org/".length);

  // Abstract from inverted index
  const abstract = reconstructAbstract(
    raw.abstract_inverted_index as Record<string, number[]> | null,
  );

  return {
    id: (raw.id as string) || "",
    doi,
    title: (raw.title as string) || "Untitled",
    authors: authorships,
    year: typeof raw.publication_year === "number" ? raw.publication_year : null,
    citedByCount: typeof raw.cited_by_count === "number" ? raw.cited_by_count : 0,
    oaStatus,
    oaPdfUrl,
    abstract,
    source: primarySource,
  };
}

/** Build the filter query string from options. */
function buildFilters(options: SearchOptions): string {
  const parts: string[] = [];

  if (options.filterOA) {
    parts.push("is_oa:true");
  }

  if (options.yearFrom != null && options.yearTo != null) {
    parts.push(`publication_year:${options.yearFrom}-${options.yearTo}`);
  } else if (options.yearFrom != null) {
    parts.push(`publication_year:${options.yearFrom}-`);
  } else if (options.yearTo != null) {
    parts.push(`publication_year:-${options.yearTo}`);
  }

  return parts.join(",");
}

/** Build the sort parameter. */
function buildSort(sortBy?: string): string | null {
  switch (sortBy) {
    case "cited_by_count":
      return "cited_by_count:desc";
    case "publication_date":
      return "publication_date:desc";
    default:
      return null; // relevance is the default, no sort param needed
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search OpenAlex for works matching a topic query.
 * Returns empty array on any failure.
 */
export async function searchWorks(
  query: string,
  options: SearchOptions = {},
): Promise<OpenAlexResult[]> {
  const limit = clampLimit(options.limit);
  const opLogger = logger.child({ operation: "openAlexSearch", query, limit });

  if (!query.trim()) {
    opLogger.debug("Empty search query");
    return [];
  }

  const email = getEmail();
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    mailto: email,
  });

  const filter = buildFilters(options);
  if (filter) params.set("filter", filter);

  const sort = buildSort(options.sortBy);
  if (sort) params.set("sort", sort);

  const url = `${OPENALEX_BASE}/works?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `autognostic-plugin (mailto:${email})`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) {
      opLogger.warn("OpenAlex rate limited");
      return [];
    }

    if (!res.ok) {
      opLogger.warn("OpenAlex API error", { status: res.status });
      return [];
    }

    const data = await res.json();
    const results = (data as { results?: unknown[] }).results;
    if (!Array.isArray(results)) return [];

    const works = results.map(r => normalizeWork(r as Record<string, unknown>));
    opLogger.debug("OpenAlex search complete", { resultCount: works.length });
    return works;
  } catch (err) {
    opLogger.warn("OpenAlex search failed", { query }, err);
    return [];
  }
}

/**
 * Look up a single work by OpenAlex ID.
 * Returns null on any failure.
 */
export async function getWork(openalexId: string): Promise<OpenAlexResult | null> {
  const opLogger = logger.child({ operation: "openAlexGetWork", openalexId });

  const email = getEmail();
  const url = `${OPENALEX_BASE}/works/${encodeURIComponent(openalexId)}?mailto=${encodeURIComponent(email)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `autognostic-plugin (mailto:${email})`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("Work not found in OpenAlex");
      return null;
    }

    if (res.status === 429) {
      opLogger.warn("OpenAlex rate limited");
      return null;
    }

    if (!res.ok) {
      opLogger.warn("OpenAlex API error", { status: res.status });
      return null;
    }

    const data = await res.json();
    return normalizeWork(data as Record<string, unknown>);
  } catch (err) {
    opLogger.warn("OpenAlex getWork failed", { openalexId }, err);
    return null;
  }
}
