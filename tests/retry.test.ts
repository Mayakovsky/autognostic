import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry";
import { AutognosticNetworkError, ErrorCode } from "../src/errors";

describe("withRetry", () => {
  it("should succeed on first attempt", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await withRetry(operation, { maxAttempts: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on transient failure", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("success");

    const result = await withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should retry retryable AutognosticError", async () => {
    const error = AutognosticNetworkError.timeout("example.com", 1000);
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const result = await withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-retryable error", async () => {
    const error = new AutognosticNetworkError(
      "Not retryable",
      ErrorCode.CROSSREF_NOT_FOUND,
      {},
      { isRetryable: false }
    );
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation, { maxAttempts: 3 })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should exhaust retries and throw", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("network timeout"));

    await expect(
      withRetry(operation, { maxAttempts: 2, initialDelayMs: 10 })
    ).rejects.toThrow("network timeout");

    expect(operation).toHaveBeenCalledTimes(2);
  });
});
