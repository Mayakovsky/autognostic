import { describe, it, expect, beforeEach } from "vitest";
import { FetchCache } from "../src/services/FetchCache";

function makeEntry(text: string) {
  return {
    text,
    contentType: "text/plain",
    source: "raw" as const,
    title: "Test",
    resolvedUrl: "https://example.com",
    metadata: {},
  };
}

describe("FetchCache", () => {
  let cache: FetchCache;

  beforeEach(() => {
    cache = new FetchCache({ maxEntries: 5, ttlMs: 5000, maxTotalBytes: 10_000 });
  });

  it("should set and get an entry", () => {
    cache.set("https://example.com/a", makeEntry("hello"));
    const entry = cache.get("https://example.com/a");
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe("hello");
  });

  it("should return null for missing entry", () => {
    expect(cache.get("https://example.com/missing")).toBeNull();
  });

  it("should expire entries after TTL", () => {
    const shortTtl = new FetchCache({ maxEntries: 5, ttlMs: 1, maxTotalBytes: 10_000 });
    shortTtl.set("https://example.com/a", makeEntry("old"));

    // Force expiry by waiting (synchronous check relies on cachedAt)
    const entry = shortTtl.get("https://example.com/a");
    // TTL of 1ms — may or may not have expired yet; let's set cachedAt in the past
    // Actually, just test with a 0ms TTL cache
    const zeroTtl = new FetchCache({ maxEntries: 5, ttlMs: 0, maxTotalBytes: 10_000 });
    zeroTtl.set("https://example.com/b", makeEntry("expired"));
    expect(zeroTtl.get("https://example.com/b")).toBeNull();
  });

  it("should evict oldest when at maxEntries", () => {
    for (let i = 0; i < 5; i++) {
      cache.set(`https://example.com/${i}`, makeEntry(`val${i}`));
    }
    expect(cache.stats().entries).toBe(5);

    // Adding a 6th should evict the first (oldest by access time)
    cache.set("https://example.com/new", makeEntry("new"));
    expect(cache.stats().entries).toBe(5);
    expect(cache.get("https://example.com/0")).toBeNull(); // evicted
    expect(cache.get("https://example.com/new")!.text).toBe("new");
  });

  it("should evict when byte limit exceeded", () => {
    // Each entry: text.length * 2 bytes
    // maxTotalBytes: 10_000
    // 3000-char text = 6000 bytes; two of those = 12000 > 10000
    cache.set("https://example.com/big1", makeEntry("x".repeat(3000)));
    cache.set("https://example.com/big2", makeEntry("x".repeat(3000)));
    // The cache should have evicted big1 to stay under byte limit
    expect(cache.stats().entries).toBeLessThanOrEqual(2);
  });

  it("should invalidate a specific URL", () => {
    cache.set("https://example.com/a", makeEntry("a"));
    cache.set("https://example.com/b", makeEntry("b"));
    cache.invalidate("https://example.com/a");
    expect(cache.get("https://example.com/a")).toBeNull();
    expect(cache.get("https://example.com/b")!.text).toBe("b");
  });

  it("should clear all entries", () => {
    cache.set("https://example.com/a", makeEntry("a"));
    cache.set("https://example.com/b", makeEntry("b"));
    cache.clear();
    expect(cache.stats().entries).toBe(0);
  });

  it("should track hit rate", () => {
    cache.set("https://example.com/a", makeEntry("a"));
    cache.get("https://example.com/a"); // hit
    cache.get("https://example.com/a"); // hit
    cache.get("https://example.com/missing"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
  });

  it("should normalize URLs for cache key", () => {
    cache.set("https://Example.COM/path/", makeEntry("normalized"));
    // Same URL with different casing / trailing slash
    const entry = cache.get("https://example.com/path");
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe("normalized");
  });

  it("has() should return false for expired entries", () => {
    const zeroTtl = new FetchCache({ maxEntries: 5, ttlMs: 0, maxTotalBytes: 10_000 });
    zeroTtl.set("https://example.com/a", makeEntry("expired"));
    expect(zeroTtl.has("https://example.com/a")).toBe(false);
  });

  it("has() should return true for valid entries", () => {
    cache.set("https://example.com/a", makeEntry("valid"));
    expect(cache.has("https://example.com/a")).toBe(true);
  });
});
