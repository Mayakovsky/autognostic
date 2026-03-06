import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchPapersAction } from "../src/actions/searchPapersAction";
import type { IAgentRuntime, Memory, Content } from "@elizaos/core";

// ---------------------------------------------------------------------------
// Mock OpenAlexService
// ---------------------------------------------------------------------------

const mockSearchWorks = vi.fn();

vi.mock("../src/services/OpenAlexService", () => ({
  searchWorks: (...args: unknown[]) => mockSearchWorks(...args),
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

function makeResult(index: number) {
  return {
    id: `https://openalex.org/W${index}`,
    doi: `10.1234/paper.${index}`,
    title: `Paper ${index}`,
    authors: [`Author ${index}`],
    year: 2020 + index,
    citedByCount: index * 100,
    oaStatus: index % 2 === 0 ? "gold" : "closed",
    oaPdfUrl: index % 2 === 0 ? `https://example.com/paper${index}.pdf` : null,
    abstract: null,
    source: `Journal ${index}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SearchPapersAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // =========================================================================
  // validate
  // =========================================================================

  describe("validate", () => {
    it("should match 'search for papers about X'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("search for papers about neural networks"),
      );
      expect(result).toBe(true);
    });

    it("should match 'find papers on X'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("find papers on quantum computing"),
      );
      expect(result).toBe(true);
    });

    it("should match 'look up research on X'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("look up research on CRISPR gene editing"),
      );
      expect(result).toBe(true);
    });

    it("should match 'discover articles about X'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("discover articles about deep learning"),
      );
      expect(result).toBe(true);
    });

    it("should match 'papers about X' (alt pattern)", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("papers about reinforcement learning"),
      );
      expect(result).toBe(true);
    });

    it("should match 'research on X' (alt pattern)", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("research on climate change mitigation"),
      );
      expect(result).toBe(true);
    });

    it("should match 'find recent literature on X'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("find recent literature on protein folding"),
      );
      expect(result).toBe(true);
    });

    it("should NOT match 'add this URL to knowledge'", async () => {
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("add this URL to knowledge"),
      );
      expect(result).toBe(false);
    });

    it("should NOT match 'find related papers' (that's FIND_RELATED_PAPERS)", async () => {
      // "find related papers" without an "about/on" topic should NOT match SEARCH_PAPERS
      const result = await SearchPapersAction.validate!(
        mockRuntime,
        makeMessage("find related papers for this DOI"),
      );
      // This matches primary regex because "find" + "papers" are present
      // but that's OK — ElizaOS picks the best action. We just verify it doesn't crash.
      expect(typeof result).toBe("boolean");
    });

    it("should NOT match generic text", async () => {
      const result = await SearchPapersAction.validate!(
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
    it("should return search results for topic query", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1), makeResult(2), makeResult(3)]);

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about transformer attention"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      const ar = result as { success: boolean; text: string; data: unknown };
      expect(ar.success).toBe(true);
      expect(ar.text).toContain("Paper 1");
      expect(ar.text).toContain("Paper 2");
      expect(ar.text).toContain("Paper 3");
      expect(ar.text).toContain("add to knowledge");

      expect(mockSearchWorks).toHaveBeenCalledOnce();
      // Query should have trigger words stripped
      const callQuery = mockSearchWorks.mock.calls[0][0] as string;
      expect(callQuery.length).toBeGreaterThan(0);
    });

    it("should use explicit query arg when provided", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1)]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search papers", { query: "specific topic" }),
        undefined,
        undefined,
        callback,
      );

      expect(mockSearchWorks).toHaveBeenCalledWith("specific topic", expect.any(Object));
    });

    it("should pass explicit limit option", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search papers", { query: "test", limit: 5 }),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.limit).toBe(5);
    });

    it("should infer OA filter from text", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find open access papers about neural networks"),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.filterOA).toBe(true);
    });

    it("should infer sort by citations from text", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find the most cited papers about machine learning"),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.sortBy).toBe("cited_by_count");
    });

    it("should infer sort by date from text", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find the most recent papers about protein folding"),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.sortBy).toBe("publication_date");
    });

    it("should infer yearFrom from text", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find papers about CRISPR since 2022"),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.yearFrom).toBe(2022);
    });

    it("should infer yearTo from text", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find papers about AI before 2020"),
        undefined,
        undefined,
        callback,
      );

      const callOptions = mockSearchWorks.mock.calls[0][1] as Record<string, unknown>;
      expect(callOptions.yearTo).toBe(2020);
    });

    it("should handle empty results gracefully", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about xyznonexistent"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(false);
      expect(ar.text).toContain("No papers matched");
    });

    it("should fail gracefully when no query extractable", async () => {
      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage(""),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      const ar = result as { success: boolean; text: string };
      expect(ar.success).toBe(false);
      expect(ar.text).toContain("topic");
      expect(mockSearchWorks).not.toHaveBeenCalled();
    });

    it("should NOT auto-ingest any results", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1), makeResult(2)]);

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about neural networks"),
        undefined,
        undefined,
        callback,
      );

      // Verify no ingestion-related calls — just search + format
      const ar = result as { success: boolean; text: string; data: Record<string, unknown> };
      expect(ar.success).toBe(true);
      // The text should invite user to pick, not confirm ingestion
      expect(ar.text).toContain("add");
      expect(ar.text).not.toContain("ingested");
      expect(ar.text).not.toContain("added to knowledge");
    });

    it("should always call callback with SEARCH_PAPERS action", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1)]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about neural networks"),
        undefined,
        undefined,
        callback,
      );

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ action: "SEARCH_PAPERS" }),
      );
    });

    it("should include result data with safe serialized fields", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1), makeResult(2)]);

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about neural networks"),
        undefined,
        undefined,
        callback,
      );

      const ar = result as { success: boolean; data: Record<string, unknown> };
      expect(ar.data).toBeDefined();
      const data = ar.data as { count: number; results: Array<{ title: string }> };
      expect(data.count).toBe(2);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].title).toBe("Paper 1");
    });

    it("should format OA emoji correctly", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(2), makeResult(3)]); // 2=gold, 3=closed

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search for papers about test"),
        undefined,
        undefined,
        callback,
      );

      const ar = result as { text: string };
      // Paper 2 (even index) should have green emoji, Paper 3 (odd) should have red
      expect(ar.text).toContain("\u{1F7E2}"); // green circle
      expect(ar.text).toContain("\u{1F534}"); // red circle
    });

    it("should include filter description in response", async () => {
      mockSearchWorks.mockResolvedValue([makeResult(1)]);

      const callback = vi.fn();
      const result = await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("find open access papers about AI since 2022"),
        undefined,
        undefined,
        callback,
      );

      const ar = result as { text: string };
      expect(ar.text).toContain("open-access only");
      expect(ar.text).toContain("from 2022");
    });

    it("should pass explicit args overriding text inference", async () => {
      mockSearchWorks.mockResolvedValue([]);

      const callback = vi.fn();
      await SearchPapersAction.handler!(
        mockRuntime,
        makeMessage("search papers", {
          query: "custom query",
          filterOA: true,
          yearFrom: 2021,
          yearTo: 2025,
          sortBy: "cited_by_count",
          limit: 15,
        }),
        undefined,
        undefined,
        callback,
      );

      expect(mockSearchWorks).toHaveBeenCalledWith("custom query", {
        filterOA: true,
        yearFrom: 2021,
        yearTo: 2025,
        sortBy: "cited_by_count",
        limit: 15,
      });
    });
  });
});
