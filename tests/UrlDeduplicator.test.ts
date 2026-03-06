import { describe, it, expect, beforeEach } from "vitest";
import { UrlDeduplicator } from "../src/services/UrlDeduplicator";
import type { ResolvedContent } from "../src/services/ContentResolver";

function makeResult(text: string): ResolvedContent {
  return {
    text,
    contentType: "text/plain",
    source: "raw",
    title: "Test",
    resolvedUrl: "https://example.com",
    metadata: {},
    diagnostics: [],
  };
}

describe("UrlDeduplicator", () => {
  let dedup: UrlDeduplicator;

  beforeEach(() => {
    dedup = new UrlDeduplicator();
  });

  it("should execute fn for a single request", async () => {
    let callCount = 0;
    const result = await dedup.deduplicate("https://example.com/a", async () => {
      callCount++;
      return makeResult("single");
    });
    expect(callCount).toBe(1);
    expect(result.text).toBe("single");
  });

  it("should call fn only once for two concurrent same-URL requests", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      // Simulate async work
      await new Promise(r => setTimeout(r, 50));
      return makeResult("shared");
    };

    const [r1, r2] = await Promise.all([
      dedup.deduplicate("https://example.com/a", fn),
      dedup.deduplicate("https://example.com/a", fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1.text).toBe("shared");
    expect(r2.text).toBe("shared");
  });

  it("should propagate failure to both callers", async () => {
    const fn = async (): Promise<ResolvedContent> => {
      await new Promise(r => setTimeout(r, 10));
      throw new Error("boom");
    };

    const results = await Promise.allSettled([
      dedup.deduplicate("https://example.com/fail", fn),
      dedup.deduplicate("https://example.com/fail", fn),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
  });

  it("should handle different URLs independently", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return makeResult(`result-${callCount}`);
    };

    const [r1, r2] = await Promise.all([
      dedup.deduplicate("https://example.com/a", fn),
      dedup.deduplicate("https://example.com/b", fn),
    ]);

    expect(callCount).toBe(2);
    expect(r1.text).not.toBe(r2.text);
  });

  it("should clean up inflight map after resolve", async () => {
    await dedup.deduplicate("https://example.com/a", async () => makeResult("done"));
    expect(dedup.inflightCount).toBe(0);
  });

  it("should clean up inflight map after rejection", async () => {
    try {
      await dedup.deduplicate("https://example.com/a", async () => {
        throw new Error("fail");
      });
    } catch { /* expected */ }
    expect(dedup.inflightCount).toBe(0);
  });

  it("should normalize URLs for dedup key", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return makeResult("shared");
    };

    const [r1, r2] = await Promise.all([
      dedup.deduplicate("https://Example.COM/path/", fn),
      dedup.deduplicate("https://example.com/path", fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1.text).toBe("shared");
    expect(r2.text).toBe("shared");
  });
});
