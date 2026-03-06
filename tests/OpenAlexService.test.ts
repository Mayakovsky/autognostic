import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchWorks, getWork } from "../src/services/OpenAlexService";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "https://openalex.org/W2741809807",
    doi: "https://doi.org/10.5555/3295222.3295349",
    title: "Attention Is All You Need",
    authorships: [
      { author: { display_name: "Ashish Vaswani" } },
      { author: { display_name: "Noam Shazeer" } },
    ],
    publication_year: 2017,
    cited_by_count: 87654,
    open_access: { is_oa: true, oa_status: "gold" },
    primary_location: {
      pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
      source: { display_name: "NeurIPS" },
    },
    best_oa_location: {
      pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
    },
    abstract_inverted_index: {
      The: [0],
      dominant: [1],
      sequence: [2],
      models: [3],
    },
    ...overrides,
  };
}

function makeWorkResult(index: number) {
  return {
    id: `https://openalex.org/W${index}`,
    doi: `https://doi.org/10.1234/paper.${index}`,
    title: `Paper ${index}`,
    authorships: [{ author: { display_name: `Author ${index}` } }],
    publication_year: 2020 + index,
    cited_by_count: index * 100,
    open_access: { is_oa: index % 2 === 0, oa_status: index % 2 === 0 ? "gold" : "closed" },
    primary_location: {
      pdf_url: index % 2 === 0 ? `https://example.com/paper${index}.pdf` : null,
      source: { display_name: `Journal ${index}` },
    },
    best_oa_location: index % 2 === 0 ? { pdf_url: `https://example.com/paper${index}.pdf` } : null,
    abstract_inverted_index: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAlexService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // searchWorks
  // =========================================================================

  describe("searchWorks", () => {
    it("should return parsed results for valid search query", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [makeWorkResponse(), makeWorkResult(1), makeWorkResult(2)],
        }),
      });

      const results = await searchWorks("transformer attention");

      expect(results).toHaveLength(3);
      expect(results[0].title).toBe("Attention Is All You Need");
      expect(results[0].doi).toBe("10.5555/3295222.3295349");
      expect(results[0].authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
      expect(results[0].year).toBe(2017);
      expect(results[0].citedByCount).toBe(87654);
      expect(results[0].oaStatus).toBe("gold");
      expect(results[0].oaPdfUrl).toBe("https://arxiv.org/pdf/1706.03762.pdf");
      expect(results[0].source).toBe("NeurIPS");

      // Abstract reconstructed from inverted index
      expect(results[0].abstract).toBe("The dominant sequence models");

      // Verify URL construction
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("search=transformer+attention");
      expect(callUrl).toContain("per_page=10");
      expect(callUrl).toContain("mailto=");
    });

    it("should return empty array when no results found", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const results = await searchWorks("xyznonexistenttopic12345");
      expect(results).toEqual([]);
    });

    it("should return empty array for empty query", async () => {
      const results = await searchWorks("");
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return empty array for whitespace-only query", async () => {
      const results = await searchWorks("   ");
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return empty array on rate limit (429)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const results = await searchWorks("test query");
      expect(results).toEqual([]);
    });

    it("should return empty array on server error (500)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const results = await searchWorks("test query");
      expect(results).toEqual([]);
    });

    it("should return empty array on network timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const results = await searchWorks("test query");
      expect(results).toEqual([]);
    });

    it("should return empty array on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const results = await searchWorks("test query");
      expect(results).toEqual([]);
    });

    it("should apply OA filter when filterOA is true", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { filterOA: true });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("filter=is_oa%3Atrue");
    });

    it("should apply year range filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { yearFrom: 2020, yearTo: 2024 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("filter=publication_year%3A2020-2024");
    });

    it("should apply yearFrom-only filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { yearFrom: 2022 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("filter=publication_year%3A2022-");
    });

    it("should apply yearTo-only filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { yearTo: 2023 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("filter=publication_year%3A-2023");
    });

    it("should sort by citations when specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { sortBy: "cited_by_count" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("sort=cited_by_count%3Adesc");
    });

    it("should sort by publication date when specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { sortBy: "publication_date" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("sort=publication_date%3Adesc");
    });

    it("should not add sort param for relevance (default)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { sortBy: "relevance" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).not.toContain("sort=");
    });

    it("should clamp limit to MAX_LIMIT (25)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { limit: 999 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("per_page=25");
    });

    it("should use default limit when not specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("per_page=10");
    });

    it("should combine OA filter and year filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test", { filterOA: true, yearFrom: 2020, yearTo: 2024 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("filter=is_oa%3Atrue%2Cpublication_year%3A2020-2024");
    });

    it("should handle malformed API response (missing results field)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ meta: {}, group_by: [] }),
      });

      const results = await searchWorks("test");
      expect(results).toEqual([]);
    });

    it("should handle work with missing optional fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            id: "https://openalex.org/W999",
            doi: null,
            title: null,
            authorships: [],
            publication_year: null,
            cited_by_count: null,
            open_access: null,
            primary_location: null,
            best_oa_location: null,
            abstract_inverted_index: null,
          }],
        }),
      });

      const results = await searchWorks("test");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Untitled");
      expect(results[0].doi).toBeNull();
      expect(results[0].authors).toEqual([]);
      expect(results[0].year).toBeNull();
      expect(results[0].citedByCount).toBe(0);
      expect(results[0].oaPdfUrl).toBeNull();
      expect(results[0].abstract).toBeNull();
      expect(results[0].source).toBeNull();
    });

    it("should use UNPAYWALL_EMAIL for polite pool", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "test@example.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("mailto=test%40example.com");

      const callHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders["User-Agent"]).toContain("test@example.com");
    });

    it("should fall back to CROSSREF_MAILTO when UNPAYWALL_EMAIL not set", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "");
      vi.stubEnv("CROSSREF_MAILTO", "crossref@example.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("mailto=crossref%40example.com");
    });

    it("should fall back to default email when no env vars set", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "");
      vi.stubEnv("CROSSREF_MAILTO", "");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchWorks("test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("mailto=autognostic-plugin");
    });

    it("should strip DOI prefix from doi.org URLs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [makeWorkResponse({ doi: "https://doi.org/10.1234/test" })],
        }),
      });

      const results = await searchWorks("test");
      expect(results[0].doi).toBe("10.1234/test");
    });

    it("should reconstruct abstract from inverted index", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [makeWorkResponse({
            abstract_inverted_index: {
              Hello: [0],
              world: [1],
              this: [2],
              is: [3],
              a: [4],
              test: [5],
            },
          })],
        }),
      });

      const results = await searchWorks("test");
      expect(results[0].abstract).toBe("Hello world this is a test");
    });

    it("should handle empty abstract inverted index", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [makeWorkResponse({ abstract_inverted_index: {} })],
        }),
      });

      const results = await searchWorks("test");
      expect(results[0].abstract).toBeNull();
    });
  });

  // =========================================================================
  // getWork
  // =========================================================================

  describe("getWork", () => {
    it("should return work data for valid ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeWorkResponse(),
      });

      const result = await getWork("W2741809807");

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Attention Is All You Need");
      expect(result!.year).toBe(2017);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("/works/W2741809807");
      expect(callUrl).toContain("mailto=");
    });

    it("should return null when work not found (404)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await getWork("W9999999999");
      expect(result).toBeNull();
    });

    it("should return null on rate limit (429)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await getWork("W123");
      expect(result).toBeNull();
    });

    it("should return null on server error (500)", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await getWork("W123");
      expect(result).toBeNull();
    });

    it("should return null on network timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const result = await getWork("W123");
      expect(result).toBeNull();
    });
  });
});
