/**
 * RateLimiter — per-domain token bucket rate limiter.
 *
 * Each external API gets its own bucket with configurable burst capacity
 * and refill rate. Pure TypeScript, no external dependencies.
 */

import { RATE_LIMITS } from "../config/constants";
import { logger } from "../utils/logger";

export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number;       // tokens per refill
  refillIntervalMs: number; // ms between refills
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  config: RateLimitConfig;
}

const MAX_WAIT_MS = 30_000; // Maximum time acquire() will wait before proceeding anyway
const POLL_INTERVAL_MS = 100;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /** Get or create a bucket for a domain. */
  private getBucket(domain: string): Bucket {
    let bucket = this.buckets.get(domain);
    if (bucket) return bucket;

    const config = (RATE_LIMITS as Record<string, RateLimitConfig>)[domain]
      ?? RATE_LIMITS.general;

    bucket = {
      tokens: config.maxTokens,
      lastRefill: Date.now(),
      config,
    };
    this.buckets.set(domain, bucket);
    return bucket;
  }

  /** Refill tokens based on elapsed time. */
  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const intervals = Math.floor(elapsed / bucket.config.refillIntervalMs);
    if (intervals > 0) {
      bucket.tokens = Math.min(
        bucket.config.maxTokens,
        bucket.tokens + intervals * bucket.config.refillRate
      );
      bucket.lastRefill = now;
    }
  }

  /**
   * Non-blocking: try to consume one token.
   * Returns true if a token was available, false otherwise.
   */
  tryAcquire(domain: string): boolean {
    const bucket = this.getBucket(domain);
    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Blocking: wait until a token is available (up to MAX_WAIT_MS).
   * Never throws — if max wait is exceeded, proceeds with a warning.
   */
  async acquire(domain: string): Promise<void> {
    if (this.tryAcquire(domain)) return;

    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (this.tryAcquire(domain)) return;
    }

    // Exceeded max wait — proceed anyway with warning
    logger.warn(`Rate limiter: max wait exceeded for ${domain}, proceeding`);
  }

  /** Diagnostics for a domain. */
  getStats(domain: string): { available: number; maxTokens: number } {
    const bucket = this.getBucket(domain);
    this.refill(bucket);
    return {
      available: Math.floor(bucket.tokens),
      maxTokens: bucket.config.maxTokens,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Singleton
let instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!instance) instance = new RateLimiter();
  return instance;
}

/** Reset singleton (for testing). */
export function resetRateLimiter(): void {
  instance = null;
}
