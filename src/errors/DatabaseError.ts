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
