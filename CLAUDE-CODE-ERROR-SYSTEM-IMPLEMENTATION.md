# Claude Code CLI - Error Reporting System Implementation

> **Purpose:** Implement comprehensive error handling across plugin-autognostic
> **Priority:** P0-P1 improvements for production readiness
> **Estimated Effort:** 3-4 hours total
> **Date:** 2025-02-04

---

## Autonomous Permissions

You have permission to:
- Create new files in `src/errors/`
- Modify all files in `src/` to integrate new error system
- Modify files in `tests/` to add error handling tests
- Run all build, lint, and test commands

Confirm before:
- Modifying `package.json` dependencies
- Pushing to remote repositories

---

## Task 1: Create Error Class Hierarchy

### Objective
Create a centralized error system with typed errors, error codes, and operation context.

### Step 1.1: Create Error Directory and Base Class

```bash
mkdir -p src/errors
```

Create `src/errors/AutognosticError.ts`:

```typescript
/**
 * Base error class for all Autognostic plugin errors.
 * Provides error codes, operation context, and structured metadata.
 */

export enum ErrorCode {
  // Auth errors (1xxx)
  AUTH_REQUIRED = 1001,
  AUTH_INVALID_TOKEN = 1002,
  AUTH_MISCONFIGURED = 1003,

  // Network errors (2xxx)
  NETWORK_TIMEOUT = 2001,
  NETWORK_CONNECTION_FAILED = 2002,
  NETWORK_RATE_LIMITED = 2003,
  CROSSREF_API_ERROR = 2010,
  CROSSREF_NOT_FOUND = 2011,
  HTTP_FETCH_FAILED = 2020,

  // Database errors (3xxx)
  DB_CONNECTION_FAILED = 3001,
  DB_QUERY_FAILED = 3002,
  DB_TRANSACTION_FAILED = 3003,
  DB_NOT_INITIALIZED = 3004,
  DB_ADAPTER_MISSING = 3005,

  // Validation errors (4xxx)
  VALIDATION_MISSING_URL = 4001,
  VALIDATION_INVALID_URL = 4002,
  VALIDATION_MISSING_PARAM = 4003,
  VALIDATION_INVALID_FORMAT = 4004,

  // Classification errors (5xxx)
  CLASSIFICATION_FAILED = 5001,
  CLASSIFICATION_INSUFFICIENT_CONTENT = 5002,
  PAPER_DETECTION_FAILED = 5003,

  // Storage errors (6xxx)
  STORAGE_WRITE_FAILED = 6001,
  STORAGE_READ_FAILED = 6002,
  STORAGE_DELETE_FAILED = 6003,
  KNOWLEDGE_LINK_FAILED = 6004,

  // General errors (9xxx)
  UNKNOWN = 9999,
  INTERNAL = 9998,
}

export interface ErrorContext {
  operation: string;
  url?: string;
  documentId?: string;
  sourceId?: string;
  doi?: string;
  correlationId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface SerializedError {
  name: string;
  code: ErrorCode;
  message: string;
  context: ErrorContext;
  cause?: string;
  stack?: string;
}

/**
 * Base error class for Autognostic plugin.
 * All plugin-specific errors should extend this class.
 */
export class AutognosticError extends Error {
  public readonly code: ErrorCode;
  public readonly context: ErrorContext;
  public readonly isRetryable: boolean;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    context: Partial<ErrorContext> = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, { cause: options?.cause });
    this.name = "AutognosticError";
    this.code = code;
    this.timestamp = new Date().toISOString();
    this.isRetryable = options?.isRetryable ?? false;
    this.context = {
      operation: context.operation || "unknown",
      timestamp: this.timestamp,
      ...context,
    };

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Serialize error for logging or transmission.
   */
  toJSON(): SerializedError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
      stack: this.stack,
    };
  }

  /**
   * Create user-friendly error message.
   */
  toUserMessage(): string {
    return this.message;
  }

  /**
   * Create detailed error message for logging.
   */
  toLogMessage(): string {
    const parts = [
      `[${this.name}]`,
      `Code: ${this.code}`,
      `Op: ${this.context.operation}`,
      this.message,
    ];
    if (this.context.url) parts.push(`URL: ${this.context.url}`);
    if (this.context.documentId) parts.push(`DocID: ${this.context.documentId}`);
    if (this.cause instanceof Error) parts.push(`Cause: ${this.cause.message}`);
    return parts.join(" | ");
  }
}

/**
 * Helper to wrap unknown errors in AutognosticError.
 */
export function wrapError(
  error: unknown,
  code: ErrorCode = ErrorCode.UNKNOWN,
  context: Partial<ErrorContext> = {}
): AutognosticError {
  if (error instanceof AutognosticError) {
    // Merge context if needed
    return new AutognosticError(error.message, error.code, {
      ...error.context,
      ...context,
    }, { cause: error.cause as Error, isRetryable: error.isRetryable });
  }

  if (error instanceof Error) {
    return new AutognosticError(error.message, code, context, { cause: error });
  }

  return new AutognosticError(
    typeof error === "string" ? error : "An unknown error occurred",
    code,
    context
  );
}

/**
 * Type guard for AutognosticError.
 */
export function isAutognosticError(error: unknown): error is AutognosticError {
  return error instanceof AutognosticError;
}

/**
 * Get error code from any error type.
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (isAutognosticError(error)) return error.code;
  return ErrorCode.UNKNOWN;
}
```

### Step 1.2: Create Specialized Error Classes

Create `src/errors/NetworkError.ts`:

```typescript
import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

/**
 * Error for network-related failures (HTTP, API calls, timeouts).
 */
export class AutognosticNetworkError extends AutognosticError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NETWORK_CONNECTION_FAILED,
    context: Partial<ErrorContext> & { statusCode?: number; endpoint?: string } = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, code, context, {
      cause: options?.cause,
      isRetryable: options?.isRetryable ?? true, // Network errors are usually retryable
    });
    this.name = "AutognosticNetworkError";
    this.statusCode = context.statusCode;
    this.endpoint = context.endpoint;
  }

  static timeout(endpoint: string, timeoutMs: number, context: Partial<ErrorContext> = {}) {
    return new AutognosticNetworkError(
      `Request to ${endpoint} timed out after ${timeoutMs}ms`,
      ErrorCode.NETWORK_TIMEOUT,
      { ...context, endpoint },
      { isRetryable: true }
    );
  }

  static connectionFailed(endpoint: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticNetworkError(
      `Failed to connect to ${endpoint}`,
      ErrorCode.NETWORK_CONNECTION_FAILED,
      { ...context, endpoint },
      { cause, isRetryable: true }
    );
  }

  static rateLimited(endpoint: string, retryAfter?: number, context: Partial<ErrorContext> = {}) {
    const message = retryAfter
      ? `Rate limited by ${endpoint}. Retry after ${retryAfter}s`
      : `Rate limited by ${endpoint}`;
    return new AutognosticNetworkError(
      message,
      ErrorCode.NETWORK_RATE_LIMITED,
      { ...context, endpoint },
      { isRetryable: true }
    );
  }

  static crossrefError(doi: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticNetworkError(
      `Crossref API error for DOI ${doi}`,
      ErrorCode.CROSSREF_API_ERROR,
      { ...context, doi, endpoint: "api.crossref.org" },
      { cause, isRetryable: true }
    );
  }

  static crossrefNotFound(doi: string, context: Partial<ErrorContext> = {}) {
    return new AutognosticNetworkError(
      `DOI ${doi} not found in Crossref`,
      ErrorCode.CROSSREF_NOT_FOUND,
      { ...context, doi, endpoint: "api.crossref.org" },
      { isRetryable: false }
    );
  }
}
```

Create `src/errors/DatabaseError.ts`:

```typescript
import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

/**
 * Error for database-related failures.
 */
export class AutognosticDatabaseError extends AutognosticError {
  public readonly query?: string;
  public readonly table?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.DB_QUERY_FAILED,
    context: Partial<ErrorContext> & { query?: string; table?: string } = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, code, context, options);
    this.name = "AutognosticDatabaseError";
    this.query = context.query;
    this.table = context.table;
  }

  static connectionFailed(cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticDatabaseError(
      "Failed to connect to database",
      ErrorCode.DB_CONNECTION_FAILED,
      context,
      { cause, isRetryable: true }
    );
  }

  static notInitialized(context: Partial<ErrorContext> = {}) {
    return new AutognosticDatabaseError(
      "Database not initialized. Ensure plugin-sql is registered.",
      ErrorCode.DB_NOT_INITIALIZED,
      context,
      { isRetryable: true }
    );
  }

  static adapterMissing(context: Partial<ErrorContext> = {}) {
    return new AutognosticDatabaseError(
      "No database adapter found. Ensure plugin-sql is registered and runtime exposes a Drizzle db handle.",
      ErrorCode.DB_ADAPTER_MISSING,
      context,
      { isRetryable: false }
    );
  }

  static queryFailed(operation: string, table: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticDatabaseError(
      `Database ${operation} failed on ${table}`,
      ErrorCode.DB_QUERY_FAILED,
      { ...context, table, operation },
      { cause, isRetryable: false }
    );
  }

  static transactionFailed(cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticDatabaseError(
      "Database transaction failed",
      ErrorCode.DB_TRANSACTION_FAILED,
      context,
      { cause, isRetryable: true }
    );
  }
}
```

Create `src/errors/ValidationError.ts`:

```typescript
import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

/**
 * Error for input validation failures.
 */
export class AutognosticValidationError extends AutognosticError {
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.VALIDATION_INVALID_FORMAT,
    context: Partial<ErrorContext> & { field?: string; value?: unknown } = {},
    options?: { cause?: Error }
  ) {
    super(message, code, context, { ...options, isRetryable: false });
    this.name = "AutognosticValidationError";
    this.field = context.field;
    this.value = context.value;
  }

  static missingUrl(context: Partial<ErrorContext> = {}) {
    return new AutognosticValidationError(
      "No URL provided. Please provide a URL to add to knowledge.",
      ErrorCode.VALIDATION_MISSING_URL,
      { ...context, field: "url" }
    );
  }

  static invalidUrl(url: string, context: Partial<ErrorContext> = {}) {
    return new AutognosticValidationError(
      `Invalid URL format: ${url}`,
      ErrorCode.VALIDATION_INVALID_URL,
      { ...context, field: "url", value: url, url }
    );
  }

  static missingParam(paramName: string, context: Partial<ErrorContext> = {}) {
    return new AutognosticValidationError(
      `Missing required parameter: ${paramName}`,
      ErrorCode.VALIDATION_MISSING_PARAM,
      { ...context, field: paramName }
    );
  }

  static invalidFormat(field: string, expected: string, actual: unknown, context: Partial<ErrorContext> = {}) {
    return new AutognosticValidationError(
      `Invalid format for ${field}: expected ${expected}`,
      ErrorCode.VALIDATION_INVALID_FORMAT,
      { ...context, field, value: actual }
    );
  }
}
```

Create `src/errors/ClassificationError.ts`:

```typescript
import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

/**
 * Error for paper detection and classification failures.
 */
export class AutognosticClassificationError extends AutognosticError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CLASSIFICATION_FAILED,
    context: Partial<ErrorContext> = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, code, context, options);
    this.name = "AutognosticClassificationError";
  }

  static insufficientContent(url: string, context: Partial<ErrorContext> = {}) {
    return new AutognosticClassificationError(
      "Insufficient content for classification. Document too short or missing abstract.",
      ErrorCode.CLASSIFICATION_INSUFFICIENT_CONTENT,
      { ...context, url },
      { isRetryable: false }
    );
  }

  static detectionFailed(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticClassificationError(
      `Failed to detect paper type for ${url}`,
      ErrorCode.PAPER_DETECTION_FAILED,
      { ...context, url },
      { cause, isRetryable: true }
    );
  }

  static classificationFailed(documentId: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticClassificationError(
      `Failed to classify document ${documentId}`,
      ErrorCode.CLASSIFICATION_FAILED,
      { ...context, documentId },
      { cause, isRetryable: true }
    );
  }
}
```

Create `src/errors/StorageError.ts`:

```typescript
import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

/**
 * Error for knowledge storage operations.
 */
export class AutognosticStorageError extends AutognosticError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.STORAGE_WRITE_FAILED,
    context: Partial<ErrorContext> = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, code, context, options);
    this.name = "AutognosticStorageError";
  }

  static writeFailed(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticStorageError(
      `Failed to store document: ${url}`,
      ErrorCode.STORAGE_WRITE_FAILED,
      { ...context, url },
      { cause, isRetryable: true }
    );
  }

  static readFailed(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticStorageError(
      `Failed to read document: ${url}`,
      ErrorCode.STORAGE_READ_FAILED,
      { ...context, url },
      { cause, isRetryable: true }
    );
  }

  static deleteFailed(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticStorageError(
      `Failed to delete document: ${url}`,
      ErrorCode.STORAGE_DELETE_FAILED,
      { ...context, url },
      { cause, isRetryable: false }
    );
  }

  static knowledgeLinkFailed(documentId: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new AutognosticStorageError(
      `Failed to link document ${documentId} to ElizaOS knowledge`,
      ErrorCode.KNOWLEDGE_LINK_FAILED,
      { ...context, documentId },
      { cause, isRetryable: true }
    );
  }
}
```

### Step 1.3: Create Barrel Export

Create `src/errors/index.ts`:

```typescript
export {
  AutognosticError,
  ErrorCode,
  wrapError,
  isAutognosticError,
  getErrorCode,
  type ErrorContext,
  type SerializedError,
} from "./AutognosticError";

export { AutognosticNetworkError } from "./NetworkError";
export { AutognosticDatabaseError } from "./DatabaseError";
export { AutognosticValidationError } from "./ValidationError";
export { AutognosticClassificationError } from "./ClassificationError";
export { AutognosticStorageError } from "./StorageError";

// Re-export existing auth error for consistency
export { AutognosticAuthError } from "../auth/validateToken";
```

---

## Task 2: Create Logger Utility

### Objective
Replace scattered `console.*` calls with structured logging.

Create `src/utils/logger.ts`:

```typescript
import { type ErrorContext, isAutognosticError } from "../errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    code?: number;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  prefix: string;
  minLevel: LogLevel;
  includeTimestamp: boolean;
  structuredOutput: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  prefix: "[autognostic]",
  minLevel: "info",
  includeTimestamp: false,
  structuredOutput: false,
};

/**
 * Structured logger for Autognostic plugin.
 */
class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const parts: string[] = [];
    
    if (this.config.includeTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    parts.push(this.config.prefix);
    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    if (context && Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      parts.push(`| ${contextStr}`);
    }

    return parts.join(" ");
  }

  private createEntry(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    if (context) {
      entry.context = context;
    }

    if (error) {
      if (isAutognosticError(error)) {
        entry.error = {
          name: error.name,
          code: error.code,
          message: error.message,
          stack: error.stack,
        };
      } else if (error instanceof Error) {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      }
    }

    return entry;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
    if (!this.shouldLog(level)) return;

    if (this.config.structuredOutput) {
      const entry = this.createEntry(level, message, context, error);
      const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      consoleFn(JSON.stringify(entry));
    } else {
      const formatted = this.formatMessage(level, message, context);
      switch (level) {
        case "error":
          console.error(formatted);
          if (error) console.error(error);
          break;
        case "warn":
          console.warn(formatted);
          break;
        case "debug":
          console.debug(formatted);
          break;
        default:
          console.log(formatted);
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.log("warn", message, context, error);
  }

  error(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.log("error", message, context, error);
  }

  /**
   * Create a child logger with additional context.
   */
  child(additionalContext: Record<string, unknown>): ContextualLogger {
    return new ContextualLogger(this, additionalContext);
  }

  /**
   * Update logger configuration.
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Logger with persistent context (for request/operation tracking).
 */
class ContextualLogger {
  constructor(
    private parent: Logger,
    private context: Record<string, unknown>
  ) {}

  debug(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.debug(message, { ...this.context, ...additionalContext });
  }

  info(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.info(message, { ...this.context, ...additionalContext });
  }

  warn(message: string, additionalContext?: Record<string, unknown>, error?: unknown): void {
    this.parent.warn(message, { ...this.context, ...additionalContext }, error);
  }

  error(message: string, additionalContext?: Record<string, unknown>, error?: unknown): void {
    this.parent.error(message, { ...this.context, ...additionalContext }, error);
  }
}

// Singleton instance
export const logger = new Logger();

// Factory for child loggers
export function createLogger(context: Record<string, unknown>): ContextualLogger {
  return logger.child(context);
}

// Configure based on environment
if (process.env.LOG_LEVEL) {
  logger.configure({ minLevel: process.env.LOG_LEVEL as LogLevel });
}
if (process.env.AUTOGNOSTIC_STRUCTURED_LOGS === "true") {
  logger.configure({ structuredOutput: true });
}
```

---

## Task 3: Create Retry Utility

### Objective
Add retry logic for transient failures (network, rate limits).

Create `src/utils/retry.ts`:

```typescript
import { AutognosticError, AutognosticNetworkError, isAutognosticError } from "../errors";
import { logger } from "./logger";

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: number[]; // Error codes to retry
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Execute a function with exponential backoff retry.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  operationName: string = "operation"
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let delay = cfg.initialDelayMs;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const isRetryable = shouldRetry(error, cfg.retryableErrors);
      
      if (!isRetryable || attempt === cfg.maxAttempts) {
        logger.error(`${operationName} failed after ${attempt} attempts`, {
          attempt,
          maxAttempts: cfg.maxAttempts,
        }, error);
        throw error;
      }

      logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
        attempt,
        maxAttempts: cfg.maxAttempts,
        delay,
      }, error);

      await sleep(delay);
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError || new Error(`${operationName} failed`);
}

/**
 * Determine if an error should be retried.
 */
function shouldRetry(error: unknown, retryableCodes?: number[]): boolean {
  if (isAutognosticError(error)) {
    // Check explicit retryable flag
    if (error.isRetryable) return true;
    
    // Check specific error codes
    if (retryableCodes && retryableCodes.includes(error.code)) return true;
    
    return false;
  }

  // Generic error - retry on common transient patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      message.includes("temporarily unavailable")
    );
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry configuration presets.
 */
export const RetryPresets = {
  /** Quick retry for fast operations */
  quick: {
    maxAttempts: 2,
    initialDelayMs: 500,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
  } as RetryConfig,

  /** Standard retry for API calls */
  standard: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  } as RetryConfig,

  /** Aggressive retry for critical operations */
  aggressive: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  } as RetryConfig,

  /** Gentle retry for rate-limited APIs */
  rateLimited: {
    maxAttempts: 3,
    initialDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 3,
  } as RetryConfig,
};
```

---

## Task 4: Update Existing Code to Use New Error System

### Step 4.1: Update `getDb.ts`

Edit `src/db/getDb.ts` - replace the final throw:

```typescript
// Add import at top
import { AutognosticDatabaseError } from "../errors";

// Replace the final throw in getDb():
throw AutognosticDatabaseError.adapterMissing({ operation: "getDb" });
```

### Step 4.2: Update `ScientificPaperDetector.ts`

Edit `src/services/ScientificPaperDetector.ts`:

```typescript
// Add imports at top
import { AutognosticNetworkError } from "../errors";
import { logger } from "../utils/logger";
import { withRetry, RetryPresets } from "../utils/retry";

// Replace fetchCrossrefMetadata method:
async fetchCrossrefMetadata(doi: string): Promise<StaticDetectionMetadata["crossrefData"] | null> {
  const opLogger = logger.child({ operation: "fetchCrossrefMetadata", doi });
  
  try {
    return await withRetry(async () => {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.crossrefMailto) {
        headers["User-Agent"] = `autognostic/1.0 (mailto:${this.crossrefMailto})`;
      }

      const res = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        {
          headers,
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (res.status === 404) {
        opLogger.debug("DOI not found in Crossref");
        return null; // Not found is not an error
      }

      if (res.status === 429) {
        throw AutognosticNetworkError.rateLimited("api.crossref.org", undefined, { 
          operation: "fetchCrossrefMetadata", 
          doi 
        });
      }

      if (!res.ok) {
        throw AutognosticNetworkError.crossrefError(doi, undefined, {
          operation: "fetchCrossrefMetadata",
        });
      }

      const data = await res.json();
      const work = data.message;

      opLogger.debug("Crossref metadata fetched successfully");

      return {
        type: work.type,
        title: work.title?.[0],
        journal: work["container-title"]?.[0],
        publisher: work.publisher,
        publishedDate: work.published?.["date-parts"]?.[0]?.join("-"),
        subjects: work.subject,
        authors: work.author?.map((a: any) =>
          `${a.given || ""} ${a.family || ""}`.trim()
        ),
        abstract: work.abstract,
      };
    }, RetryPresets.rateLimited, "Crossref API");
  } catch (err) {
    opLogger.warn("Crossref metadata fetch failed", { doi }, err);
    return null; // Graceful degradation
  }
}
```

### Step 4.3: Update `addUrlToKnowledgeAction.ts`

Edit `src/actions/addUrlToKnowledgeAction.ts`:

```typescript
// Add imports at top
import { 
  AutognosticError, 
  AutognosticValidationError, 
  wrapError, 
  ErrorCode 
} from "../errors";
import { logger } from "../utils/logger";

// Update the catch block in handler:
} catch (error) {
  const wrappedError = wrapError(error, ErrorCode.INTERNAL, {
    operation: "ADD_URL_TO_KNOWLEDGE",
    url,
  });
  
  logger.error("Failed to add document", { url }, wrappedError);
  
  return {
    success: false,
    text: `Failed to add document: ${wrappedError.toUserMessage()}`,
    data: { 
      error: "ingestion_failed", 
      code: wrappedError.code,
      details: wrappedError.message,
      isRetryable: wrappedError.isRetryable,
    },
  };
}
```

### Step 4.4: Update Auth Error Integration

Edit `src/auth/validateToken.ts` - update `AutognosticAuthError` to extend base:

```typescript
// Add import at top
import { AutognosticError, ErrorCode, type ErrorContext } from "../errors/AutognosticError";

// Replace AutognosticAuthError class:
export class AutognosticAuthError extends AutognosticError {
  public readonly needsToken: boolean;

  constructor(message: string, needsToken: boolean = false, context: Partial<ErrorContext> = {}) {
    const code = needsToken 
      ? ErrorCode.AUTH_REQUIRED 
      : ErrorCode.AUTH_INVALID_TOKEN;
    
    super(message, code, { ...context, operation: "auth" }, { isRetryable: false });
    this.name = "AutognosticAuthError";
    this.needsToken = needsToken;
  }

  static required(context: Partial<ErrorContext> = {}) {
    return new AutognosticAuthError(
      "This operation requires authentication. Please provide the auth token.",
      true,
      context
    );
  }

  static invalidToken(context: Partial<ErrorContext> = {}) {
    return new AutognosticAuthError(
      "Invalid auth token. Access denied.",
      false,
      context
    );
  }

  static misconfigured(context: Partial<ErrorContext> = {}) {
    return new AutognosticAuthError(
      "Auth is enabled but AUTOGNOSTIC_AUTH_TOKEN is not set. Please configure the token or disable auth.",
      false,
      context
    );
  }
}
```

---

## Task 5: Add Index Export

Update `src/index.ts` to export error types:

```typescript
// Add to exports section:

// Error types
export {
  AutognosticError,
  AutognosticNetworkError,
  AutognosticDatabaseError,
  AutognosticValidationError,
  AutognosticClassificationError,
  AutognosticStorageError,
  AutognosticAuthError,
  ErrorCode,
  wrapError,
  isAutognosticError,
  getErrorCode,
  type ErrorContext,
  type SerializedError,
} from "./errors";

// Utilities
export { logger, createLogger, type LogLevel, type LogEntry } from "./utils/logger";
export { withRetry, RetryPresets, type RetryConfig } from "./utils/retry";
```

---

## Task 6: Create Error Tests

Create `tests/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  AutognosticError,
  AutognosticNetworkError,
  AutognosticDatabaseError,
  AutognosticValidationError,
  ErrorCode,
  wrapError,
  isAutognosticError,
  getErrorCode,
} from "../src/errors";

describe("AutognosticError", () => {
  it("should create error with code and context", () => {
    const error = new AutognosticError(
      "Test error",
      ErrorCode.INTERNAL,
      { operation: "test", url: "https://example.com" }
    );

    expect(error.message).toBe("Test error");
    expect(error.code).toBe(ErrorCode.INTERNAL);
    expect(error.context.operation).toBe("test");
    expect(error.context.url).toBe("https://example.com");
    expect(error.isRetryable).toBe(false);
  });

  it("should serialize to JSON", () => {
    const error = new AutognosticError("Test", ErrorCode.UNKNOWN, { operation: "test" });
    const json = error.toJSON();

    expect(json.name).toBe("AutognosticError");
    expect(json.code).toBe(ErrorCode.UNKNOWN);
    expect(json.message).toBe("Test");
  });

  it("should create user-friendly message", () => {
    const error = new AutognosticError("User visible message", ErrorCode.UNKNOWN);
    expect(error.toUserMessage()).toBe("User visible message");
  });
});

describe("AutognosticNetworkError", () => {
  it("should create timeout error", () => {
    const error = AutognosticNetworkError.timeout("api.example.com", 5000);
    
    expect(error.code).toBe(ErrorCode.NETWORK_TIMEOUT);
    expect(error.isRetryable).toBe(true);
    expect(error.endpoint).toBe("api.example.com");
  });

  it("should create rate limited error", () => {
    const error = AutognosticNetworkError.rateLimited("api.crossref.org", 60);
    
    expect(error.code).toBe(ErrorCode.NETWORK_RATE_LIMITED);
    expect(error.isRetryable).toBe(true);
  });

  it("should create crossref error", () => {
    const error = AutognosticNetworkError.crossrefError("10.1000/test");
    
    expect(error.code).toBe(ErrorCode.CROSSREF_API_ERROR);
    expect(error.context.doi).toBe("10.1000/test");
  });
});

describe("AutognosticValidationError", () => {
  it("should create missing URL error", () => {
    const error = AutognosticValidationError.missingUrl();
    
    expect(error.code).toBe(ErrorCode.VALIDATION_MISSING_URL);
    expect(error.isRetryable).toBe(false);
  });

  it("should create invalid URL error", () => {
    const error = AutognosticValidationError.invalidUrl("not-a-url");
    
    expect(error.code).toBe(ErrorCode.VALIDATION_INVALID_URL);
    expect(error.field).toBe("url");
    expect(error.value).toBe("not-a-url");
  });
});

describe("AutognosticDatabaseError", () => {
  it("should create adapter missing error", () => {
    const error = AutognosticDatabaseError.adapterMissing();
    
    expect(error.code).toBe(ErrorCode.DB_ADAPTER_MISSING);
    expect(error.isRetryable).toBe(false);
  });

  it("should create query failed error", () => {
    const cause = new Error("SQL syntax error");
    const error = AutognosticDatabaseError.queryFailed("INSERT", "documents", cause);
    
    expect(error.code).toBe(ErrorCode.DB_QUERY_FAILED);
    expect(error.table).toBe("documents");
    expect(error.cause).toBe(cause);
  });
});

describe("wrapError", () => {
  it("should wrap plain Error", () => {
    const original = new Error("Something went wrong");
    const wrapped = wrapError(original, ErrorCode.INTERNAL, { operation: "test" });

    expect(wrapped).toBeInstanceOf(AutognosticError);
    expect(wrapped.message).toBe("Something went wrong");
    expect(wrapped.code).toBe(ErrorCode.INTERNAL);
    expect(wrapped.cause).toBe(original);
  });

  it("should wrap string error", () => {
    const wrapped = wrapError("String error", ErrorCode.UNKNOWN);

    expect(wrapped).toBeInstanceOf(AutognosticError);
    expect(wrapped.message).toBe("String error");
  });

  it("should pass through AutognosticError", () => {
    const original = new AutognosticError("Original", ErrorCode.NETWORK_TIMEOUT);
    const wrapped = wrapError(original, ErrorCode.INTERNAL);

    expect(wrapped.code).toBe(ErrorCode.NETWORK_TIMEOUT); // Original code preserved
  });
});

describe("isAutognosticError", () => {
  it("should return true for AutognosticError", () => {
    const error = new AutognosticError("Test", ErrorCode.UNKNOWN);
    expect(isAutognosticError(error)).toBe(true);
  });

  it("should return true for subclasses", () => {
    const error = AutognosticNetworkError.timeout("example.com", 1000);
    expect(isAutognosticError(error)).toBe(true);
  });

  it("should return false for plain Error", () => {
    const error = new Error("Plain");
    expect(isAutognosticError(error)).toBe(false);
  });
});

describe("getErrorCode", () => {
  it("should return code from AutognosticError", () => {
    const error = new AutognosticError("Test", ErrorCode.DB_QUERY_FAILED);
    expect(getErrorCode(error)).toBe(ErrorCode.DB_QUERY_FAILED);
  });

  it("should return UNKNOWN for plain Error", () => {
    const error = new Error("Plain");
    expect(getErrorCode(error)).toBe(ErrorCode.UNKNOWN);
  });
});
```

Create `tests/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { withRetry, RetryPresets } from "../src/utils/retry";
import { AutognosticNetworkError, ErrorCode } from "../src/errors";

describe("withRetry", () => {
  it("should succeed on first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    
    const result = await withRetry(operation, { maxAttempts: 3 });
    
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on transient failure", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("success");
    
    const result = await withRetry(operation, { 
      maxAttempts: 3, 
      initialDelayMs: 10 
    });
    
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should retry retryable AutognosticError", async () => {
    const error = AutognosticNetworkError.timeout("example.com", 1000);
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");
    
    const result = await withRetry(operation, { 
      maxAttempts: 3, 
      initialDelayMs: 10 
    });
    
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-retryable error", async () => {
    const error = new AutognosticNetworkError(
      "Not retryable",
      ErrorCode.CROSSREF_NOT_FOUND,
      {},
      { isRetryable: false }
    );
    const operation = vi.fn().mockRejectedValue(error);
    
    await expect(withRetry(operation, { maxAttempts: 3 })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should exhaust retries and throw", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("persistent failure"));
    
    await expect(
      withRetry(operation, { maxAttempts: 2, initialDelayMs: 10 })
    ).rejects.toThrow("persistent failure");
    
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
```

---

## Task 7: Verification

### Run Tests

```bash
# Run all tests including new error tests
bun run test

# Run only error tests
bunx vitest run tests/errors.test.ts tests/retry.test.ts
```

### Build Verification

```bash
# Clean and rebuild
rm -rf dist
bun run build

# Type check
bunx tsc --noEmit
```

### Lint

```bash
bun run lint
```

---

## Execution Checklist

- [ ] Create `src/errors/` directory
- [ ] Create `AutognosticError.ts` base class
- [ ] Create `NetworkError.ts`
- [ ] Create `DatabaseError.ts`
- [ ] Create `ValidationError.ts`
- [ ] Create `ClassificationError.ts`
- [ ] Create `StorageError.ts`
- [ ] Create `src/errors/index.ts` barrel export
- [ ] Create `src/utils/logger.ts`
- [ ] Create `src/utils/retry.ts`
- [ ] Update `src/db/getDb.ts` to use new errors
- [ ] Update `src/services/ScientificPaperDetector.ts` with retry logic
- [ ] Update `src/actions/addUrlToKnowledgeAction.ts` error handling
- [ ] Update `src/auth/validateToken.ts` to extend base error
- [ ] Update `src/index.ts` exports
- [ ] Create `tests/errors.test.ts`
- [ ] Create `tests/retry.test.ts`
- [ ] Run tests - all passing
- [ ] Run build - no errors
- [ ] Run lint - no new errors

---

## Git Commit

```bash
git add -A
git commit -m "feat(errors): implement comprehensive error handling system

- Add AutognosticError base class with error codes and context
- Add specialized errors: Network, Database, Validation, Classification, Storage
- Add structured logger utility with child loggers
- Add retry utility with exponential backoff
- Update ScientificPaperDetector with retry logic for Crossref API
- Update action handlers with wrapped errors
- Integrate auth errors with base error class
- Add comprehensive error and retry tests

Error codes provide programmatic error handling.
Retry logic improves resilience for transient failures.
Structured logging enables production debugging."
```

---

*End of Error Reporting System Implementation*
