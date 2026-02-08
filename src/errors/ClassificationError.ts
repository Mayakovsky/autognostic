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
