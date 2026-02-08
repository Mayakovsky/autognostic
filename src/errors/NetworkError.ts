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
