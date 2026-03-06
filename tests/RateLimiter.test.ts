import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "../src/services/RateLimiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("should grant token when bucket has capacity", () => {
    expect(limiter.tryAcquire("general")).toBe(true);
  });

  it("should respect burst capacity (maxTokens)", () => {
    // General bucket has maxTokens: 5
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire("general")).toBe(true);
    }
    // 6th should fail
    expect(limiter.tryAcquire("general")).toBe(false);
  });

  it("should keep different domains independent", () => {
    // Exhaust crossref tokens (maxTokens: 20)
    for (let i = 0; i < 20; i++) {
      limiter.tryAcquire("crossref");
    }
    expect(limiter.tryAcquire("crossref")).toBe(false);
    // OpenAlex should still have tokens
    expect(limiter.tryAcquire("openAlex")).toBe(true);
  });

  it("tryAcquire should return false when bucket empty", () => {
    // Exhaust general (5 tokens)
    for (let i = 0; i < 5; i++) limiter.tryAcquire("general");
    expect(limiter.tryAcquire("general")).toBe(false);
  });

  it("acquire should resolve immediately when tokens available", async () => {
    const start = Date.now();
    await limiter.acquire("general");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // should be nearly instant
  });

  it("acquire should wait when bucket empty then succeed after refill", async () => {
    // Exhaust unpaywall (maxTokens: 5, refillRate: 1, refillInterval: 1000ms)
    for (let i = 0; i < 5; i++) limiter.tryAcquire("unpaywall");

    // Use general bucket (smaller) for a faster test
    // general: maxTokens: 5, refillRate: 2, refillInterval: 1000ms
    const fastLimiter = new RateLimiter();
    for (let i = 0; i < 5; i++) fastLimiter.tryAcquire("general");

    // acquire should wait until refill (polling at 100ms intervals)
    const start = Date.now();
    await fastLimiter.acquire("general");
    const elapsed = Date.now() - start;
    // Should have waited ~1000ms for refill
    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(elapsed).toBeLessThan(5000);
  }, 10_000);

  it("getStats should return available tokens", () => {
    limiter.tryAcquire("crossref");
    const stats = limiter.getStats("crossref");
    expect(stats.available).toBe(19); // 20 - 1
    expect(stats.maxTokens).toBe(20);
  });

  it("should use general config for unknown domains", () => {
    const stats = limiter.getStats("unknowndomain");
    expect(stats.maxTokens).toBe(5); // general maxTokens
  });
});
