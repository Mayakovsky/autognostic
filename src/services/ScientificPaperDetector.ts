import type { StaticDetectionMetadata, PaperMetadata } from "../db/schema";

/**
 * URL patterns for known scientific paper repositories and publishers
 */
const KNOWN_PAPER_PATTERNS: RegExp[] = [
  // Preprint servers
  /^https?:\/\/(www\.)?arxiv\.org\//i,
  /^https?:\/\/(www\.)?biorxiv\.org\//i,
  /^https?:\/\/(www\.)?medrxiv\.org\//i,
  /^https?:\/\/(www\.)?ssrn\.com\//i,
  /^https?:\/\/(www\.)?researchgate\.net\/publication\//i,
  /^https?:\/\/(www\.)?osf\.io\/preprints\//i,
  /^https?:\/\/(www\.)?philpapers\.org\//i,
  /^https?:\/\/(www\.)?chemrxiv\.org\//i,
  /^https?:\/\/(www\.)?eartharxiv\.org\//i,
  /^https?:\/\/(www\.)?engrxiv\.org\//i,
  /^https?:\/\/(www\.)?psyarxiv\.com\//i,
  /^https?:\/\/(www\.)?socarxiv\.org\//i,

  // Major publishers
  /^https?:\/\/(www\.)?sciencedirect\.com\/science\/article\//i,
  /^https?:\/\/link\.springer\.com\/article\//i,
  /^https?:\/\/(www\.)?nature\.com\/articles\//i,
  /^https?:\/\/(www\.)?science\.org\/doi\//i,
  /^https?:\/\/pubs\.acs\.org\/doi\//i,
  /^https?:\/\/onlinelibrary\.wiley\.com\/doi\//i,
  /^https?:\/\/ieeexplore\.ieee\.org\/document\//i,
  /^https?:\/\/dl\.acm\.org\/doi\//i,
  /^https?:\/\/(www\.)?tandfonline\.com\/doi\//i,
  /^https?:\/\/(www\.)?mdpi\.com\//i,
  /^https?:\/\/(www\.)?frontiersin\.org\/articles\//i,
  /^https?:\/\/(www\.)?plos\.org\//i,
  /^https?:\/\/journals\.plos\.org\//i,
  /^https?:\/\/(www\.)?cell\.com\//i,
  /^https?:\/\/(www\.)?bmj\.com\//i,
  /^https?:\/\/(www\.)?thelancet\.com\//i,
  /^https?:\/\/(www\.)?nejm\.org\//i,
  /^https?:\/\/(www\.)?jama.*\.com\//i,
  /^https?:\/\/academic\.oup\.com\//i,
  /^https?:\/\/journals\.sagepub\.com\//i,
  /^https?:\/\/(www\.)?cambridge\.org\/core\//i,
  /^https?:\/\/(www\.)?royalsocietypublishing\.org\//i,
  /^https?:\/\/iopscience\.iop\.org\//i,
  /^https?:\/\/aip\.scitation\.org\//i,
  /^https?:\/\/journals\.aps\.org\//i,
  /^https?:\/\/(www\.)?pnas\.org\//i,

  // DOI resolvers
  /^https?:\/\/(dx\.)?doi\.org\//i,

  // Repositories and databases
  /^https?:\/\/(www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//i,
  /^https?:\/\/(www\.)?ncbi\.nlm\.nih\.gov\/pubmed\//i,
  /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i,
  /^https?:\/\/(www\.)?jstor\.org\/stable\//i,
  /^https?:\/\/(www\.)?semanticscholar\.org\/paper\//i,
  /^https?:\/\/europepmc\.org\/article\//i,
  /^https?:\/\/scholar\.google\.com\/scholar/i,
  /^https?:\/\/citeseerx\.ist\.psu\.edu\//i,
  /^https?:\/\/(www\.)?scielo\.br\//i,
  /^https?:\/\/(www\.)?doaj\.org\//i,
];

/**
 * arXiv category mappings to L1 domains
 */
const ARXIV_CATEGORY_TO_DOMAIN: Record<string, string> = {
  // Physics
  'astro-ph': 'L1.NATSCI',
  'cond-mat': 'L1.NATSCI',
  'gr-qc': 'L1.NATSCI',
  'hep-ex': 'L1.NATSCI',
  'hep-lat': 'L1.NATSCI',
  'hep-ph': 'L1.NATSCI',
  'hep-th': 'L1.NATSCI',
  'math-ph': 'L1.NATSCI',
  'nlin': 'L1.NATSCI',
  'nucl-ex': 'L1.NATSCI',
  'nucl-th': 'L1.NATSCI',
  'physics': 'L1.NATSCI',
  'quant-ph': 'L1.NATSCI',
  
  // Math
  'math': 'L1.FORMAL',
  'stat': 'L1.FORMAL',
  
  // Computer Science
  'cs': 'L1.ENGTECH',
  
  // Biology
  'q-bio': 'L1.LIFESCI',
  
  // Economics/Finance
  'econ': 'L1.SOCSCI',
  'q-fin': 'L1.SOCSCI',
  
  // Electrical Engineering
  'eess': 'L1.ENGTECH',
};

const DOI_REGEX = /\b10\.\d{4,}\/[^\s\]>"']+/g;
const ISSN_REGEX = /\b\d{4}-\d{3}[\dX]\b/gi;
const ARXIV_ID_REGEX = /arxiv[:\s]*(\d{4}\.\d{4,5}(?:v\d+)?)/i;
const PUBMED_ID_REGEX = /PMID[:\s]*(\d+)/i;

export interface DetectionResult {
  isScientificPaper: boolean;
  isStatic: boolean;
  metadata: StaticDetectionMetadata | null;
  paperMetadata: PaperMetadata | null;
  suggestedDomain?: string; // L1 hint based on source
}

/**
 * ScientificPaperDetector
 * 
 * Detects whether a URL or content represents a scientific paper.
 * Extracts metadata from Crossref API for classification.
 * 
 * Detection Pipeline:
 * 1. URL pattern analysis (preprints, publishers, repositories)
 * 2. DOI extraction and Crossref verification
 * 3. ISSN verification for journal content
 * 4. arXiv/PubMed ID extraction
 * 5. Content analysis for DOI/ISSN in text
 */
export class ScientificPaperDetector {
  private crossrefMailto: string | undefined;

  constructor() {
    this.crossrefMailto = process.env.CROSSREF_MAILTO;
  }

  /**
   * Main detection pipeline.
   * Returns detailed metadata for scientific papers.
   */
  async detect(url: string, content?: string): Promise<DetectionResult> {
    // Step 1: URL pattern analysis
    const urlMatch = this.checkUrlPatterns(url);
    const suggestedDomain = this.inferDomainFromUrl(url);
    
    if (urlMatch) {
      // Try to extract identifiers from URL
      const doiFromUrl = this.extractDoiFromUrl(url);
      const arxivId = this.extractArxivIdFromUrl(url);
      const pubmedId = this.extractPubmedIdFromUrl(url);
      
      // If DOI found, verify via Crossref
      if (doiFromUrl) {
        const crossrefResult = await this.fetchCrossrefMetadata(doiFromUrl);
        if (crossrefResult) {
          return {
            isScientificPaper: true,
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "doi_verified",
              confidence: "high",
              doi: doiFromUrl,
              crossrefData: crossrefResult,
            },
            paperMetadata: this.crossrefToPaperMetadata(crossrefResult, doiFromUrl),
            suggestedDomain,
          };
        }
      }

      // arXiv paper (doesn't need DOI verification)
      if (arxivId) {
        return {
          isScientificPaper: true,
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "url_pattern",
            confidence: "high",
          },
          paperMetadata: {
            arxivCategories: this.extractArxivCategories(url),
          },
          suggestedDomain: suggestedDomain || 'L1.NATSCI', // arXiv is primarily physics/CS
        };
      }

      // PubMed paper
      if (pubmedId) {
        return {
          isScientificPaper: true,
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "url_pattern",
            confidence: "high",
          },
          paperMetadata: {
            pubmedId,
          },
          suggestedDomain: 'L1.MEDHLT', // PubMed is primarily medical/health
        };
      }

      // URL pattern match without specific identifier
      return {
        isScientificPaper: true,
        isStatic: true,
        metadata: {
          detectedAt: new Date().toISOString(),
          reason: "url_pattern",
          confidence: "medium",
        },
        paperMetadata: null,
        suggestedDomain,
      };
    }

    // Step 2: Content analysis (if content provided)
    if (content) {
      // Try DOI extraction from content
      const dois = content.match(DOI_REGEX);
      if (dois && dois.length > 0) {
        const doi = this.cleanDoi(dois[0]);
        const crossrefResult = await this.fetchCrossrefMetadata(doi);
        if (crossrefResult) {
          return {
            isScientificPaper: true,
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "doi_verified",
              confidence: "high",
              doi,
              crossrefData: crossrefResult,
            },
            paperMetadata: this.crossrefToPaperMetadata(crossrefResult, doi),
            suggestedDomain: this.inferDomainFromSubjects(crossrefResult.subjects),
          };
        }

        // DOI found but Crossref verification failed
        return {
          isScientificPaper: true,
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "content_analysis",
            confidence: "medium",
            doi,
          },
          paperMetadata: { doi },
          suggestedDomain,
        };
      }

      // Try ISSN extraction
      const issns = content.match(ISSN_REGEX);
      if (issns && issns.length > 0) {
        const issn = issns[0];
        const journalResult = await this.verifyCrossrefIssn(issn);
        if (journalResult) {
          return {
            isScientificPaper: true,
            isStatic: true,
            metadata: {
              detectedAt: new Date().toISOString(),
              reason: "issn_verified",
              confidence: "high",
              issn,
              crossrefData: journalResult,
            },
            paperMetadata: {
              journal: journalResult.title,
              publisher: journalResult.publisher,
            },
            suggestedDomain,
          };
        }
      }

      // Check for arXiv ID in content
      const arxivMatch = content.match(ARXIV_ID_REGEX);
      if (arxivMatch) {
        return {
          isScientificPaper: true,
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "content_analysis",
            confidence: "medium",
          },
          paperMetadata: {},
          suggestedDomain: 'L1.NATSCI',
        };
      }

      // Check for PubMed ID in content
      const pubmedMatch = content.match(PUBMED_ID_REGEX);
      if (pubmedMatch) {
        return {
          isScientificPaper: true,
          isStatic: true,
          metadata: {
            detectedAt: new Date().toISOString(),
            reason: "content_analysis",
            confidence: "medium",
          },
          paperMetadata: {
            pubmedId: pubmedMatch[1],
          },
          suggestedDomain: 'L1.MEDHLT',
        };
      }
    }

    // Not detected as scientific paper
    return {
      isScientificPaper: false,
      isStatic: false,
      metadata: null,
      paperMetadata: null,
    };
  }

  /**
   * Quick check if URL looks like a scientific paper (no API calls)
   */
  isLikelyScientificPaper(url: string): boolean {
    return this.checkUrlPatterns(url) || this.extractDoiFromUrl(url) !== null;
  }

  private checkUrlPatterns(url: string): boolean {
    return KNOWN_PAPER_PATTERNS.some((pattern) => pattern.test(url));
  }

  private extractDoiFromUrl(url: string): string | null {
    // Handle doi.org URLs
    const doiOrgMatch = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
    if (doiOrgMatch) return this.cleanDoi(doiOrgMatch[1]);

    // Handle URLs that contain DOIs in paths
    const doiMatch = url.match(/\/(10\.\d{4,}\/[^\s?#]+)/);
    if (doiMatch) return this.cleanDoi(doiMatch[1]);

    return null;
  }

  private extractArxivIdFromUrl(url: string): string | null {
    // arxiv.org/abs/2301.12345 or arxiv.org/pdf/2301.12345
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    return match ? match[1] : null;
  }

  private extractPubmedIdFromUrl(url: string): string | null {
    // pubmed.ncbi.nlm.nih.gov/12345678 or ncbi.nlm.nih.gov/pubmed/12345678
    const match = url.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|ncbi\.nlm\.nih\.gov\/pubmed\/)(\d+)/i);
    return match ? match[1] : null;
  }

  private extractArxivCategories(_url: string): string[] {
    // This would require fetching arXiv metadata; return empty for now
    return [];
  }

  private cleanDoi(doi: string): string {
    // Remove trailing punctuation and HTML entities
    return doi.replace(/[.,;:)\]}>]+$/, '').replace(/&amp;/g, '&');
  }

  private inferDomainFromUrl(url: string): string | undefined {
    const lowerUrl = url.toLowerCase();
    
    // arXiv categories in URL
    for (const [category, domain] of Object.entries(ARXIV_CATEGORY_TO_DOMAIN)) {
      if (lowerUrl.includes(`arxiv.org/abs/${category}`) || 
          lowerUrl.includes(`/list/${category}/`)) {
        return domain;
      }
    }
    
    // Publisher-based hints
    if (lowerUrl.includes('ncbi.nlm.nih.gov') || lowerUrl.includes('pubmed')) {
      return 'L1.MEDHLT';
    }
    if (lowerUrl.includes('ieee') || lowerUrl.includes('acm.org')) {
      return 'L1.ENGTECH';
    }
    if (lowerUrl.includes('aps.org') || lowerUrl.includes('aip.scitation')) {
      return 'L1.NATSCI';
    }
    if (lowerUrl.includes('acs.org')) {
      return 'L1.NATSCI'; // Chemistry
    }
    if (lowerUrl.includes('nature.com') || lowerUrl.includes('science.org')) {
      return undefined; // Multidisciplinary
    }
    
    return undefined;
  }

  private inferDomainFromSubjects(subjects?: string[]): string | undefined {
    if (!subjects || subjects.length === 0) return undefined;
    
    const subjectStr = subjects.join(' ').toLowerCase();
    
    if (subjectStr.includes('medicine') || subjectStr.includes('health') || 
        subjectStr.includes('clinical') || subjectStr.includes('medical')) {
      return 'L1.MEDHLT';
    }
    if (subjectStr.includes('physics') || subjectStr.includes('chemistry') ||
        subjectStr.includes('astronomy')) {
      return 'L1.NATSCI';
    }
    if (subjectStr.includes('biology') || subjectStr.includes('ecology') ||
        subjectStr.includes('genetics')) {
      return 'L1.LIFESCI';
    }
    if (subjectStr.includes('engineering') || subjectStr.includes('computer')) {
      return 'L1.ENGTECH';
    }
    if (subjectStr.includes('psychology') || subjectStr.includes('economics') ||
        subjectStr.includes('sociology')) {
      return 'L1.SOCSCI';
    }
    
    return undefined;
  }

  /**
   * Fetch full metadata from Crossref API
   */
  async fetchCrossrefMetadata(doi: string): Promise<StaticDetectionMetadata["crossrefData"] | null> {
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

      if (!res.ok) return null;

      const data = await res.json();
      const work = data.message;

      return {
        type: work.type,
        title: work.title?.[0],
        journal: work["container-title"]?.[0],
        publisher: work.publisher,
        publishedDate: work.published?.["date-parts"]?.[0]?.join("-"),
        subjects: work.subject,
        authors: work.author?.map((a: any) => 
          `${a.given || ''} ${a.family || ''}`.trim()
        ),
        abstract: work.abstract,
      };
    } catch (err) {
      console.warn(`[autognostic] Crossref metadata fetch failed for ${doi}:`, err);
      return null;
    }
  }

  /**
   * Verify ISSN via Crossref API
   */
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
        subjects: journal.subjects,
      };
    } catch (err) {
      console.warn(`[autognostic] Crossref ISSN verification failed for ${issn}:`, err);
      return null;
    }
  }

  /**
   * Convert Crossref data to PaperMetadata format
   */
  private crossrefToPaperMetadata(
    crossrefData: NonNullable<StaticDetectionMetadata["crossrefData"]>,
    doi: string
  ): PaperMetadata {
    return {
      doi,
      title: crossrefData.title,
      authors: crossrefData.authors,
      journal: crossrefData.journal,
      publisher: crossrefData.publisher,
      publishedDate: crossrefData.publishedDate,
      abstract: crossrefData.abstract,
      subjects: crossrefData.subjects,
    };
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
