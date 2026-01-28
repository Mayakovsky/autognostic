/**
 * Centralized constants for plugin-datamirror
 * Avoids magic numbers scattered throughout codebase
 */

export const HTTP_DEFAULTS = {
  TIMEOUT_MS: 20_000,
  MAX_CONTENT_BYTES: 2_000_000,
  USER_AGENT: "elizaos-plugin-datamirror/1.x (+https://elizaos.ai)",
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
