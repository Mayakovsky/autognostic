/**
 * Centralized constants for plugin-autognostic
 * Avoids magic numbers scattered throughout codebase
 */

export const HTTP_DEFAULTS = {
  TIMEOUT_MS: 20_000,
  MAX_CONTENT_BYTES: 2_000_000,
  USER_AGENT: "elizaos-plugin-autognostic/1.x (+https://elizaos.ai)",
} as const;

export const RECONCILIATION_DEFAULTS = {
  MAX_FILES_PER_SOURCE: 1000,
  BATCH_SIZE: 10,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const;

export const PROVIDER_DEFAULTS = {
  MAX_DOCUMENTS_IN_CONTEXT: 3,
  MAX_CHARS_PER_DOCUMENT: 50_000,
  MAX_INVENTORY_SIZE: 10,
} as const;

export const DB_DEFAULTS = {
  CONNECTION_TIMEOUT_MS: 20_000,
  POLL_INTERVAL_MS: 250,
} as const;

export const FETCH_CACHE_DEFAULTS = {
  MAX_ENTRIES: 50,
  TTL_MS: 1_800_000,          // 30 minutes
  MAX_TOTAL_BYTES: 50_000_000, // 50MB
} as const;

export const RATE_LIMITS = {
  crossref: { maxTokens: 20, refillRate: 10, refillIntervalMs: 1000 },
  unpaywall: { maxTokens: 5, refillRate: 1, refillIntervalMs: 1000 },
  semanticScholar: { maxTokens: 10, refillRate: 3, refillIntervalMs: 1000 },
  openAlex: { maxTokens: 10, refillRate: 5, refillIntervalMs: 1000 },
  general: { maxTokens: 5, refillRate: 2, refillIntervalMs: 1000 },
} as const;

export const ANALYZER_DEFAULTS = {
  /** Max sentence boundaries stored in profile (first/last 100 kept when exceeded) */
  MAX_SENTENCES: 10_000,
  /** Max line boundaries stored in profile */
  MAX_LINES: 50_000,
  /** Max paragraph boundaries stored in profile */
  MAX_PARAGRAPHS: 5_000,
  /** Entries kept at each end when capping */
  CAP_KEEP: 100,
  /** Current analyzer version for migration tracking */
  VERSION: "1.0",
} as const;
