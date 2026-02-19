import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookupPaper,
  getRelatedPapers,
  getCitations,
  getReferences,
  buildPaperId,
} from "../src/services/SemanticScholarService";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePaperResponse(overrides: Record<string, unknown> = {}) {
  return {
    paperId: "abc123def456",
    title: "Attention Is All You Need",
    authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
    year: 2017,
    abstract: "The dominant sequence transduction models...",
    venue: "NeurIPS",
    citationCount: 87654,
    openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762.pdf" },
    externalIds: { DOI: "10.5555/3295222.3295349", ArXivId: "1706.03762" },
    url: "https://www.semanticscholar.org/paper/abc123def456",
    ...overrides,
  };
}

function makeRelatedPaper(index: number) {
  return {
    paperId: `related${index}`,
    title: `Related Paper ${index}`,
    authors: [{ name: `Author ${index}` }],
    year: 2020 + index,
    abstract: null,
    venue: "ICML",
    citationCount: index * 100,
    openAccessPdf: index % 2 === 0 ? { url: `https://example.com/paper${index}.pdf` } : null,
    externalIds: { DOI: `10.1234/related.${index}` },
    url: `https://www.semanticscholar.org/paper/related${index}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SemanticScholarService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // buildPaperId
  // =========================================================================

  describe("buildPaperId", () => {
    it("should prefix bare DOI with DOI:", () => {
      expect(buildPaperId("10.1234/test.5678")).toBe("DOI:10.1234/test.5678");
    });

    it("should extract DOI from doi.org URL", () => {
      expect(buildPaperId("https://doi.org/10.1234/test.5678")).toBe("DOI:10.1234/test.5678");
    });

    it("should prefix arXiv ID with ArXiv:", () => {
      expect(buildPaperId("2301.12345")).toBe("ArXiv:2301.12345");
    });

    it("should handle arXiv ID with version", () => {
      expect(buildPaperId("2301.12345v2")).toBe("ArXiv:2301.12345v2");
    });

    it("should extract arXiv ID from URL", () => {
      expect(buildPaperId("https://arxiv.org/abs/2301.12345")).toBe("ArXiv:2301.12345");
    });

    it("should extract arXiv ID from PDF URL", () => {
      expect(buildPaperId("https://arxiv.org/pdf/2301.12345v2")).toBe("ArXiv:2301.12345v2");
    });

    it("should extract S2 paper ID from semanticscholar.org URL", () => {
      expect(
        buildPaperId("https://www.semanticscholar.org/paper/Attention-Is-All/abc123def456abc123def456abc123def456abcd")
      ).toBe("abc123def456abc123def456abc123def456abcd");
    });

    it("should extract DOI from publisher URL", () => {
      expect(buildPaperId("https://link.springer.com/article/10.1007/s00521-020-05678-4")).toBe(
        "DOI:10.1007/s00521-020-05678-4"
      );
    });

    it("should pass through raw S2 paper ID", () => {
      expect(buildPaperId("649def34f8be52c8")).toBe("649def34f8be52c8");
    });

    it("should trim whitespace", () => {
      expect(buildPaperId("  10.1234/test  ")).toBe("DOI:10.1234/test");
    });
  });

  // =========================================================================
  // lookupPaper
  // =========================================================================

  describe("lookupPaper", () => {
    it("should return paper data for valid DOI", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makePaperResponse(),
      });

      const result = await lookupPaper("10.5555/3295222.3295349");

      expect(result).not.toBeNull();
      expect(result!.paperId).toBe("abc123def456");
      expect(result!.title).toBe("Attention Is All You Need");
      expect(result!.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
      expect(result!.year).toBe(2017);
      expect(result!.citationCount).toBe(87654);
      expect(result!.openAccessPdfUrl).toBe("https://arxiv.org/pdf/1706.03762.pdf");
      expect(result!.externalIds.DOI).toBe("10.5555/3295222.3295349");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("DOI%3A10.5555%2F3295222.3295349");
      expect(callUrl).toContain("fields=");
    });

    it("should return paper data for arXiv ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makePaperResponse(),
      });

      await lookupPaper("2301.12345");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("ArXiv%3A2301.12345");
    });

    it("should return null when paper not found (404)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await lookupPaper("10.1234/nonexistent");
      expect(result).toBeNull();
    });

    it("should return null on rate limit (429)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await lookupPaper("10.1234/ratelimit");
      expect(result).toBeNull();
    });

    it("should return null on server error (500)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await lookupPaper("10.1234/error");
      expect(result).toBeNull();
    });

    it("should return null on network timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const result = await lookupPaper("10.1234/timeout");
      expect(result).toBeNull();
    });

    it("should handle missing optional fields gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          paperId: "abc123",
          title: "Minimal Paper",
          authors: [],
          year: null,
          abstract: null,
          venue: "",
          citationCount: 0,
          openAccessPdf: null,
          externalIds: {},
          url: "",
        }),
      });

      const result = await lookupPaper("abc123");
      expect(result).not.toBeNull();
      expect(result!.authors).toEqual([]);
      expect(result!.year).toBeNull();
      expect(result!.abstract).toBeNull();
      expect(result!.venue).toBeNull();
      expect(result!.openAccessPdfUrl).toBeNull();
    });

    it("should include API key header when env var is set", async () => {
      vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "test-key-123");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makePaperResponse(),
      });

      await lookupPaper("10.1234/test");

      const callHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders["x-api-key"]).toBe("test-key-123");
    });

    it("should not include API key header when env var is empty", async () => {
      vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makePaperResponse(),
      });

      await lookupPaper("10.1234/test");

      const callHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders["x-api-key"]).toBeUndefined();
    });
  });

  // =========================================================================
  // getRelatedPapers
  // =========================================================================

  describe("getRelatedPapers", () => {
    it("should return related papers for valid paper ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          recommendedPapers: [makeRelatedPaper(1), makeRelatedPaper(2), makeRelatedPaper(3)],
        }),
      });

      const result = await getRelatedPapers("abc123def456", 10);

      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("Related Paper 1");
      expect(result[1].paperId).toBe("related2");
      expect(result[2].openAccessPdfUrl).toBeNull(); // odd index

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/recommendations/");
      expect(callUrl).toContain("limit=10");
    });

    it("should return empty array when no recommendations found (404)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await getRelatedPapers("abc123");
      expect(result).toEqual([]);
    });

    it("should return empty array on rate limit", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await getRelatedPapers("abc123");
      expect(result).toEqual([]);
    });

    it("should return empty array on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await getRelatedPapers("abc123");
      expect(result).toEqual([]);
    });

    it("should clamp limit to MAX_LIMIT", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ recommendedPapers: [] }),
      });

      await getRelatedPapers("abc123", 999);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("limit=50");
    });

    it("should use default limit when not specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ recommendedPapers: [] }),
      });

      await getRelatedPapers("abc123");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("limit=10");
    });
  });

  // =========================================================================
  // getCitations
  // =========================================================================

  describe("getCitations", () => {
    it("should return citing papers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { citingPaper: makeRelatedPaper(1) },
            { citingPaper: makeRelatedPaper(2) },
          ],
        }),
      });

      const result = await getCitations("abc123", 5);

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("Related Paper 1");
      expect(result[1].title).toBe("Related Paper 2");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/citations");
      expect(callUrl).toContain("limit=5");
    });

    it("should skip entries with null citingPaper", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { citingPaper: makeRelatedPaper(1) },
            { citingPaper: null },
            { citingPaper: makeRelatedPaper(3) },
          ],
        }),
      });

      const result = await getCitations("abc123");
      expect(result).toHaveLength(2);
    });

    it("should return empty array on 404", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await getCitations("nonexistent");
      expect(result).toEqual([]);
    });

    it("should return empty array on network timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const result = await getCitations("abc123");
      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getReferences
  // =========================================================================

  describe("getReferences", () => {
    it("should return referenced papers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { citedPaper: makeRelatedPaper(1) },
            { citedPaper: makeRelatedPaper(2) },
          ],
        }),
      });

      const result = await getReferences("abc123", 5);

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("Related Paper 1");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/references");
      expect(callUrl).toContain("limit=5");
    });

    it("should skip entries with null citedPaper", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { citedPaper: makeRelatedPaper(1) },
            { citedPaper: null },
          ],
        }),
      });

      const result = await getReferences("abc123");
      expect(result).toHaveLength(1);
    });

    it("should return empty array on server error", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await getReferences("abc123");
      expect(result).toEqual([]);
    });
  });
});
