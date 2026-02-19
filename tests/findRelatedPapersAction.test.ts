import { describe, it, expect, vi, beforeEach } from "vitest";
import { FindRelatedPapersAction } from "../src/actions/findRelatedPapersAction";
import type { IAgentRuntime, Memory, Content } from "@elizaos/core";

// ---------------------------------------------------------------------------
// Mock SemanticScholarService
// ---------------------------------------------------------------------------

const mockLookupPaper = vi.fn();
const mockGetRelatedPapers = vi.fn();
const mockGetCitations = vi.fn();
const mockGetReferences = vi.fn();

vi.mock("../src/services/SemanticScholarService", () => ({
  lookupPaper: (...args: unknown[]) => mockLookupPaper(...args),
  getRelatedPapers: (...args: unknown[]) => mockGetRelatedPapers(...args),
  getCitations: (...args: unknown[]) => mockGetCitations(...args),
  getReferences: (...args: unknown[]) => mockGetReferences(...args),
  buildPaperId: (id: string) => id,
}));

vi.mock("../src/services/UnpaywallResolver", () => ({
  extractDoiFromUrl: (url: string) => {
    const m = url.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
    return m ? m[1] : null;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRuntime = {} as IAgentRuntime;

function makeMessage(text: string, overrides: Record<string, unknown> = {}): Memory {
  return {
    content: { text, ...overrides } as Content,
  } as unknown as Memory;
}

function makeS2Paper(index: number) {
  return {
    paperId: `paper${index}`,
    title: `Paper ${index}`,
    authors: [`Author ${index}`],
    year: 2020 + index,
    abstract: null,
    venue: "NeurIPS",
    citationCount: index * 50,
    openAccessPdfUrl: index % 2 === 0 ? `https://example.com/${index}.pdf` : null,
    externalIds: { DOI: `10.1234/paper.${index}` },
    url: `https://www.semanticscholar.org/paper/paper${index}`,
  };
}

const sourcePaper = {
  paperId: "source123",
  title: "Source Paper",
  authors: ["Alice"],
  year: 2023,
  abstract: "Abstract here",
  venue: "ICML",
  citationCount: 200,
  openAccessPdfUrl: "https://example.com/source.pdf",
  externalIds: { DOI: "10.1234/source" },
  url: "https://www.semanticscholar.org/paper/source123",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindRelatedPapersAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // =========================================================================
  // validate
  // =========================================================================

  describe("validate", () => {
    it("should match 'find related papers'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("find related papers for this article"),
      );
      expect(result).toBe(true);
    });

    it("should match 'show similar papers'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("show similar papers to this work"),
      );
      expect(result).toBe(true);
    });

    it("should match 'what cites this paper'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("what cites this paper?"),
      );
      expect(result).toBe(true);
    });

    it("should match 'list citations for'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("list citing papers for 10.1234/test"),
      );
      expect(result).toBe(true);
    });

    it("should match 'get references from this paper'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("get reference papers from this work"),
      );
      expect(result).toBe(true);
    });

    it("should NOT match 'add this URL'", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("add this URL to knowledge"),
      );
      expect(result).toBe(false);
    });

    it("should NOT match generic text", async () => {
      const result = await FindRelatedPapersAction.validate!(
        mockRuntime,
        makeMessage("hello, how are you today?"),
      );
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // handler
  // =========================================================================

  describe("handler", () => {
    it("should return related papers for DOI URL", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetRelatedPapers.mockResolvedValue([makeS2Paper(1), makeS2Paper(2)]);

      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers for https://doi.org/10.1234/source"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      const ar = result as { success: boolean; text: string; data: unknown };
      expect(ar.success).toBe(true);
      expect(ar.text).toContain("Source Paper");
      expect(ar.text).toContain("Paper 1");
      expect(ar.text).toContain("Paper 2");

      // Verify lookupPaper was called with extracted DOI
      expect(mockLookupPaper).toHaveBeenCalledWith("10.1234/source");
      expect(mockGetRelatedPapers).toHaveBeenCalledWith("source123", 10);
    });

    it("should return citations when mode is inferred from text", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetCitations.mockResolvedValue([makeS2Paper(1)]);

      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("what papers cite https://doi.org/10.1234/source?"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(true);
      expect(ar.text).toContain("Citing");
      expect(mockGetCitations).toHaveBeenCalledWith("source123", 10);
      expect(mockGetRelatedPapers).not.toHaveBeenCalled();
    });

    it("should return references when mode is explicit", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetReferences.mockResolvedValue([makeS2Paper(1), makeS2Paper(2), makeS2Paper(3)]);

      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("show references", { mode: "references", doi: "10.1234/source" }),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(true);
      expect(ar.text).toContain("Referenced");
      expect(mockGetReferences).toHaveBeenCalledWith("source123", 10);
    });

    it("should fail gracefully when no identifier provided", async () => {
      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(false);
      expect(ar.text).toContain("identifier");
      expect(mockLookupPaper).not.toHaveBeenCalled();
    });

    it("should fail gracefully when paper not found on S2", async () => {
      mockLookupPaper.mockResolvedValue(null);

      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers for https://doi.org/10.1234/unknown"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(false);
      expect(ar.text).toContain("Could not find");
    });

    it("should handle empty results gracefully", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetRelatedPapers.mockResolvedValue([]);

      const callback = vi.fn();
      const result = await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers for https://doi.org/10.1234/source"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(true);
      expect(ar.text).toContain("No related papers found");
    });

    it("should respect explicit limit parameter", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetRelatedPapers.mockResolvedValue([]);

      const callback = vi.fn();
      await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related", { doi: "10.1234/source", limit: 25 }),
        undefined,
        undefined,
        callback,
      );

      expect(mockGetRelatedPapers).toHaveBeenCalledWith("source123", 25);
    });

    it("should extract arXiv ID from message text", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetRelatedPapers.mockResolvedValue([]);

      const callback = vi.fn();
      await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers for 2301.12345"),
        undefined,
        undefined,
        callback,
      );

      expect(mockLookupPaper).toHaveBeenCalledWith("2301.12345");
    });

    it("should call callback even when callback is provided", async () => {
      mockLookupPaper.mockResolvedValue(sourcePaper);
      mockGetRelatedPapers.mockResolvedValue([makeS2Paper(1)]);

      const callback = vi.fn();
      await FindRelatedPapersAction.handler!(
        mockRuntime,
        makeMessage("find related papers for https://doi.org/10.1234/source"),
        undefined,
        undefined,
        callback,
      );

      // Verify callback was called with correct action name
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ action: "FIND_RELATED_PAPERS" }),
      );
    });
  });
});
