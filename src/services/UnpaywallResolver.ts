/**
 * UnpaywallResolver — DOI → open-access PDF URL via Unpaywall API.
 *
 * Thin discovery layer UPSTREAM of ContentResolver.
 * Produces better URLs; does NOT change ingestion.
 *
 * PURE service: no database, no IAgentRuntime.
 */

import { logger } from "../utils/logger";

export interface UnpaywallResult {
  pdfUrl: string;
  oaStatus: string;
  host: string;
  version: string;
}

const UNPAYWALL_BASE = "https://api.unpaywall.org/v2";
const TIMEOUT_MS = 15_000;

/**
 * Resolve a DOI to an open-access PDF URL via Unpaywall.
 * Returns null on any failure — never blocks ingestion.
 */
export async function resolveOpenAccess(doi: string): Promise<UnpaywallResult | null> {
  const opLogger = logger.child({ operation: "resolveOpenAccess", doi });

  const email = getUnpaywallEmail();
  const url = `${UNPAYWALL_BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      opLogger.debug("DOI not found in Unpaywall");
      return null;
    }

    if (res.status === 429) {
      opLogger.warn("Unpaywall rate limited");
      return null;
    }

    if (!res.ok) {
      opLogger.warn("Unpaywall API error", { status: res.status });
      return null;
    }

    const data = await res.json();
    const best = data.best_oa_location;

    if (!best || !best.url_for_pdf) {
      opLogger.debug("No OA PDF location found", {
        oaStatus: data.oa_status,
        locationCount: data.oa_locations?.length ?? 0,
      });
      return null;
    }

    const result: UnpaywallResult = {
      pdfUrl: best.url_for_pdf,
      oaStatus: data.oa_status || "unknown",
      host: best.host_type || "unknown",
      version: best.version || "unknown",
    };

    opLogger.debug("OA PDF resolved", { pdfUrl: result.pdfUrl, oaStatus: result.oaStatus });
    return result;
  } catch (err) {
    opLogger.warn("Unpaywall resolution failed", { doi }, err);
    return null;
  }
}

/**
 * Extract a DOI from a URL string.
 * Handles doi.org URLs and publisher URLs containing DOIs in paths.
 */
export function extractDoiFromUrl(url: string): string | null {
  // doi.org/10.xxxx/...
  const doiOrgMatch = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
  if (doiOrgMatch) return cleanDoi(doiOrgMatch[1]);

  // Publisher URLs with DOI in path: /10.xxxx/...
  const doiMatch = url.match(/\/(10\.\d{4,}\/[^\s?#]+)/);
  if (doiMatch) return cleanDoi(doiMatch[1]);

  return null;
}

function cleanDoi(doi: string): string {
  return doi.replace(/[.,;:)\]}>]+$/, "").replace(/&amp;/g, "&");
}

function getUnpaywallEmail(): string {
  return (
    process.env.UNPAYWALL_EMAIL ||
    process.env.CROSSREF_MAILTO ||
    "autognostic-plugin@users.noreply.github.com"
  );
}
