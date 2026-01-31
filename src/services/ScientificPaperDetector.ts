import type { StaticDetectionMetadata } from "../db/schema";

const KNOWN_PAPER_PATTERNS: RegExp[] = [
  // Preprint servers
  /^https?:\/\/(www\.)?arxiv\.org\//,
  /^https?:\/\/(www\.)?biorxiv\.org\//,
  /^https?:\/\/(www\.)?medrxiv\.org\//,

  // Major publishers
  /^https?:\/\/(www\.)?sciencedirect\.com\/science\/article\//,
  /^https?:\/\/link\.springer\.com\/article\//,
  /^https?:\/\/(www\.)?nature\.com\/articles\//,
  /^https?:\/\/(www\.)?science\.org\/doi\//,
  /^https?:\/\/pubs\.acs\.org\/doi\//,
  /^https?:\/\/onlinelibrary\.wiley\.com\/doi\//,
  /^https?:\/\/ieeexplore\.ieee\.org\/document\//,
  /^https?:\/\/dl\.acm\.org\/doi\//,

  // DOI resolvers
  /^https?:\/\/(dx\.)?doi\.org\//,

  // Repositories
  /^https?:\/\/(www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//,
  /^https?:\/\/(www\.)?ncbi\.nlm\.nih\.gov\/pubmed\//,
  /^https?:\/\/(www\.)?jstor\.org\/stable\//,
  /^https?:\/\/(www\.)?semanticscholar\.org\/paper\//,
];

const DOI_REGEX = /\b10\.\d{4,}\/[^\s]+/g;
const ISSN_REGEX = /\b\d{4}-\d{3}[\dX]\b/gi;

export interface DetectionResult {
  isStatic: boolean;
  metadata: StaticDetectionMetadata | null;
}

/**
 * Detects whether a URL or content represents a scientific paper / static document.
 */
export class ScientificPaperDetector {
  private crossrefMailto: string | undefined;

  constructor() {
    this.crossrefMailto = process.env.CROSSREF_MAILTO;
  }

  /**
   * Main detection pipeline.
   */
  async detect(url: string, content?: string): Promise<DetectionResult> {
    // Step 1: URL pattern analysis
    const urlMatch = this.checkUrlPatterns(url);
    if (urlMatch) {
      // Extract DOI from URL if possible for verification
      const doiFromUrl = this.extractDoiFromUrl(url);
      if (doiFromUrl) {
        const crossrefResult = await this.verifyCrossrefDoi(doiFromUrl);
        if (crossrefResult) {
          return {
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "doi_verified",
              confidence: "high",
              doi: doiFromUrl,
              crossrefData: crossrefResult,
            },
          };
        }
      }

      return {
        isStatic: true,
        metadata: {
          detectedAt: new Date().toISOString(),
          reason: "url_pattern",
          confidence: "medium",
        },
      };
    }

    // Step 2: Content analysis (if content provided)
    if (content) {
      const dois = content.match(DOI_REGEX);
      if (dois && dois.length > 0) {
        const doi = dois[0];
        const crossrefResult = await this.verifyCrossrefDoi(doi);
        if (crossrefResult) {
          return {
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "doi_verified",
              confidence: "high",
              doi,
              crossrefData: crossrefResult,
            },
          };
        }

        return {
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "content_analysis",
            confidence: "medium",
            doi,
          },
        };
      }

      const issns = content.match(ISSN_REGEX);
      if (issns && issns.length > 0) {
        const issn = issns[0];
        const journalResult = await this.verifyCrossrefIssn(issn);
        if (journalResult) {
          return {
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "issn_verified",
              confidence: "high",
              issn,
              crossrefData: journalResult,
            },
          };
        }
      }
    }

    return { isStatic: false, metadata: null };
  }

  private checkUrlPatterns(url: string): boolean {
    return KNOWN_PAPER_PATTERNS.some((pattern) => pattern.test(url));
  }

  private extractDoiFromUrl(url: string): string | null {
    // Handle doi.org URLs
    const doiOrgMatch = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/);
    if (doiOrgMatch) return doiOrgMatch[1];

    // Handle URLs that contain DOIs in paths
    const doiMatch = url.match(/\/(10\.\d{4,}\/[^\s?#]+)/);
    if (doiMatch) return doiMatch[1];

    return null;
  }

  async verifyCrossrefDoi(
    doi: string
  ): Promise<StaticDetectionMetadata["crossrefData"] | null> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.crossrefMailto) {
        headers["User-Agent"] = `autognostic/1.0 (mailto:${this.crossrefMailto})`;
      }

      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return null;

      const data = await res.json();
      const work = data.message;

      return {
        type: work.type,
        title: work.title?.[0],
        journal: work["container-title"]?.[0],
        publisher: work.publisher,
        publishedDate: work.published?.["date-parts"]?.[0]?.join("-"),
      };
    } catch (err) {
      console.warn(`[autognostic] Crossref DOI verification failed for ${doi}:`, err);
      return null;
    }
  }

  async verifyCrossrefIssn(
    issn: string
  ): Promise<StaticDetectionMetadata["crossrefData"] | null> {
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

      if (!res.ok) return null;

      const data = await res.json();
      const journal = data.message;

      return {
        title: journal.title,
        publisher: journal.publisher,
      };
    } catch (err) {
      console.warn(`[autognostic] Crossref ISSN verification failed for ${issn}:`, err);
      return null;
    }
  }
}

// Singleton getter
let instance: ScientificPaperDetector | null = null;

export function getScientificPaperDetector(): ScientificPaperDetector {
  if (!instance) {
    instance = new ScientificPaperDetector();
  }
  return instance;
}
