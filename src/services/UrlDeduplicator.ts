/**
 * UrlDeduplicator — prevents parallel fetches of the same URL.
 *
 * If URL A is being fetched and another request for URL A comes in,
 * the second request waits for the first to complete and reuses the result.
 */

import type { ResolvedContent } from "./ContentResolver";

/** Normalize URL for dedup key: lowercase hostname, strip trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export class UrlDeduplicator {
  private inflight = new Map<string, Promise<ResolvedContent>>();

  /**
   * Execute fn() for this URL, but if another call for the same URL is already
   * in flight, return the existing promise instead of starting a new one.
   */
  async deduplicate(
    url: string,
    fn: () => Promise<ResolvedContent>
  ): Promise<ResolvedContent> {
    const key = normalizeUrl(url);
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Number of in-flight requests (for diagnostics). */
  get inflightCount(): number {
    return this.inflight.size;
  }
}

// Singleton
let instance: UrlDeduplicator | null = null;

export function getUrlDeduplicator(): UrlDeduplicator {
  if (!instance) instance = new UrlDeduplicator();
  return instance;
}

/** Reset singleton (for testing). */
export function resetUrlDeduplicator(): void {
  instance = null;
}
