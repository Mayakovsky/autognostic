Claude Code CLI - ScientificPaperDetector Consistency Fix
File: src/services/ScientificPaperDetector.ts
Objective: Update to use new error system and logger for consistency

Changes Required
1. Add imports at top of file:
typescriptimport { AutognosticNetworkError } from "../errors";
import { logger } from "../utils/logger";
2. Replace fetchCrossrefMetadata method (~line 180):
typescript/**
 * Fetch full metadata from Crossref API
 */
async fetchCrossrefMetadata(doi: string): Promise<StaticDetectionMetadata["crossrefData"] | null> {
  const opLogger = logger.child({ operation: "fetchCrossrefMetadata", doi });
  
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.crossrefMailto) {
      headers["User-Agent"] = `autognostic/1.0 (mailto:${this.crossrefMailto})`;
    }

    const res = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      {
        headers,
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (res.status === 404) {
      opLogger.debug("DOI not found in Crossref");
      return null;
    }

    if (res.status === 429) {
      opLogger.warn("Crossref rate limited", { doi });
      return null; // Graceful degradation
    }

    if (!res.ok) {
      opLogger.warn("Crossref API error", { doi, status: res.status });
      return null;
    }

    const data = await res.json();
    const work = data.message;

    opLogger.debug("Crossref metadata fetched successfully");

    return {
      type: work.type,
      title: work.title?.[0],
      journal: work["container-title"]?.[0],
      publisher: work.publisher,
      publishedDate: work.published?.["date-parts"]?.[0]?.join("-"),
      subjects: work.subject,
      authors: work.author?.map((a: { given?: string; family?: string }) =>
        `${a.given || ""} ${a.family || ""}`.trim()
      ),
      abstract: work.abstract,
    };
  } catch (err) {
    opLogger.warn("Crossref metadata fetch failed", { doi }, err);
    return null; // Graceful degradation - don't block ingestion
  }
}
3. Replace verifyCrossrefIssn method (~line 230):
typescript/**
 * Verify ISSN via Crossref API
 */
async verifyCrossrefIssn(
  issn: string
): Promise<StaticDetectionMetadata["crossrefData"] | null> {
  const opLogger = logger.child({ operation: "verifyCrossrefIssn", issn });
  
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.crossrefMailto) {
      headers["User-Agent"] = `autognostic/1.0 (mailto:${this.crossrefMailto})`;
    }

    const res = await fetch(`https://api.crossref.org/journals/${issn}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      opLogger.debug("ISSN not found or API error", { status: res.status });
      return null;
    }

    const data = await res.json();
    const journal = data.message;

    opLogger.debug("ISSN verified successfully");

    return {
      title: journal.title,
      publisher: journal.publisher,
      subjects: journal.subjects,
    };
  } catch (err) {
    opLogger.warn("Crossref ISSN verification failed", { issn }, err);
    return null;
  }
}

Verification
bash# Build
bun run build

# Test
bun run test

# Lint
bun run lint

Git Commit
bashgit add src/services/ScientificPaperDetector.ts
git commit -m "refactor(detector): use structured logger for Crossref API calls

Replace console.warn with logger.warn for consistency with error system.
Add child logger context for operation tracking."
