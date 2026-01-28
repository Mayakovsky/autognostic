import { RECONCILIATION_DEFAULTS } from "../config/constants";

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoff?: boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    attempts = RECONCILIATION_DEFAULTS.RETRY_ATTEMPTS,
    delayMs = RECONCILIATION_DEFAULTS.RETRY_DELAY_MS,
    backoff = true,
    onRetry,
  } = opts;

  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        onRetry?.(lastError, i + 1);
        const delay = backoff ? delayMs * Math.pow(2, i) : delayMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
