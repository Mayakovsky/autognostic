import { AutognosticError, ErrorCode, type ErrorContext } from "./AutognosticError";

export type ContentFailureType =
  | "paywall"
  | "rate_limited"
  | "timeout"
  | "dns_failure"
  | "pdf_extraction"
  | "empty_content"
  | "html_stub"
  | "unknown";

/**
 * Error for content resolution failures.
 * Carries a `failureType` classification so ErrorMessageFactory
 * can produce the right user-facing message.
 */
export class ContentResolverError extends AutognosticError {
  public readonly failureType: ContentFailureType;
  public readonly statusCode?: number;
  public readonly hostname?: string;

  constructor(
    message: string,
    failureType: ContentFailureType,
    code: ErrorCode = ErrorCode.CONTENT_EMPTY,
    context: Partial<ErrorContext> & { statusCode?: number; hostname?: string } = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message, code, context, options);
    this.name = "ContentResolverError";
    this.failureType = failureType;
    this.statusCode = context.statusCode;
    this.hostname = context.hostname;
  }

  static paywall(url: string, statusCode: number, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `HTTP ${statusCode} for ${url}`,
      "paywall",
      ErrorCode.CONTENT_PAYWALL,
      { ...context, url, statusCode, hostname: new URL(url).hostname },
      { isRetryable: false }
    );
  }

  static htmlStub(url: string, charCount: number, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `Publisher returned ${charCount}-char HTML stub for ${url}`,
      "html_stub",
      ErrorCode.CONTENT_HTML_STUB,
      { ...context, url, hostname: new URL(url).hostname },
      { isRetryable: false }
    );
  }

  static rateLimited(url: string, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `Rate limited (429) for ${url}`,
      "rate_limited",
      ErrorCode.CONTENT_RATE_LIMITED,
      { ...context, url, statusCode: 429 },
      { isRetryable: true }
    );
  }

  static timeout(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `Request to ${url} timed out`,
      "timeout",
      ErrorCode.CONTENT_TIMEOUT,
      { ...context, url },
      { cause, isRetryable: true }
    );
  }

  static dnsFailure(url: string, hostname: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `Could not resolve ${hostname}`,
      "dns_failure",
      ErrorCode.CONTENT_DNS_FAILURE,
      { ...context, url, hostname },
      { cause, isRetryable: false }
    );
  }

  static pdfExtraction(url: string, cause?: Error, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `PDF extraction failed for ${url}`,
      "pdf_extraction",
      ErrorCode.CONTENT_PDF_FAILED,
      { ...context, url },
      { cause, isRetryable: false }
    );
  }

  static emptyContent(url: string, charCount: number, context: Partial<ErrorContext> = {}) {
    return new ContentResolverError(
      `Resolved content is only ${charCount} chars for ${url}`,
      "empty_content",
      ErrorCode.CONTENT_EMPTY,
      { ...context, url },
      { isRetryable: false }
    );
  }
}
