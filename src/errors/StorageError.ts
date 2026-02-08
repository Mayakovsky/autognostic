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
