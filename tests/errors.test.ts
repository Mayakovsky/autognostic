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
