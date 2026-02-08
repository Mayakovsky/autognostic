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
  public readonly cause?: Error;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    context: Partial<ErrorContext> = {},
    options?: { cause?: Error; isRetryable?: boolean }
  ) {
    super(message);
    this.name = "AutognosticError";
    this.code = code;
    this.cause = options?.cause;
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
