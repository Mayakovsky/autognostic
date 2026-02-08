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
