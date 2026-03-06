/**
 * FetchCache — in-memory TTL cache for resolved URL content.
 *
 * NOT persistent — lives only for the agent process lifetime.
 * Goal: avoid re-fetching the same URL within a single session.
 *
 * Eviction: LRU by last-access time. Byte limit prevents memory bloat.
 */

import { FETCH_CACHE_DEFAULTS } from "../config/constants";

export interface CacheEntry {
  text: string;
  contentType: string;
  source: "pdf" | "html" | "raw";
  title: string;
  resolvedUrl: string;
  metadata: Record<string, unknown>;
  cachedAt: number;
  lastAccessedAt: number;
  byteSize: number;
}

export interface FetchCacheConfig {
  maxEntries: number;
  ttlMs: number;
  maxTotalBytes: number;
}

export interface CacheStats {
  entries: number;
  totalBytes: number;
  hits: number;
  misses: number;
  hitRate: number;
}

/** Normalize URL for cache key: lowercase hostname, strip trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip trailing slash from pathname (but not root /)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export class FetchCache {
  private cache = new Map<string, CacheEntry>();
  private config: FetchCacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<FetchCacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? FETCH_CACHE_DEFAULTS.MAX_ENTRIES,
      ttlMs: config?.ttlMs ?? FETCH_CACHE_DEFAULTS.TTL_MS,
      maxTotalBytes: config?.maxTotalBytes ?? FETCH_CACHE_DEFAULTS.MAX_TOTAL_BYTES,
    };
  }

  get(url: string): CacheEntry | null {
    const key = normalizeUrl(url);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL (>= so ttlMs=0 means expire immediately)
    if (this.config.ttlMs === 0 || Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update LRU access time
    entry.lastAccessedAt = Date.now();
    this.hits++;
    return entry;
  }

  set(
    url: string,
    data: Omit<CacheEntry, "cachedAt" | "lastAccessedAt" | "byteSize">
  ): void {
    const key = normalizeUrl(url);
    const byteSize = data.text.length * 2; // rough UTF-16 estimate
    const now = Date.now();

    const entry: CacheEntry = {
      ...data,
      cachedAt: now,
      lastAccessedAt: now,
      byteSize,
    };

    // Evict if at capacity
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, entry);

    // Evict until under byte limit
    while (this.totalBytes() > this.config.maxTotalBytes && this.cache.size > 1) {
      this.evictOldest();
    }
  }

  has(url: string): boolean {
    const key = normalizeUrl(url);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.config.ttlMs === 0 || Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  invalidate(url: string): void {
    this.cache.delete(normalizeUrl(url));
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      totalBytes: this.totalBytes(),
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  private totalBytes(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.byteSize;
    }
    return total;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

// Singleton
let instance: FetchCache | null = null;

export function getFetchCache(): FetchCache {
  if (!instance) instance = new FetchCache();
  return instance;
}

/** Reset singleton (for testing). */
export function resetFetchCache(): void {
  instance = null;
}
