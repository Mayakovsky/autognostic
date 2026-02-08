import { isAutognosticError } from "../errors";
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
