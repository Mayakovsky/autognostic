import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateToken,
  requireValidToken,
  DatamirrorAuthError,
} from "../src/auth/validateToken";
import { createMockRuntime } from "./setup";

describe("validateToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when no token is configured", () => {
    it("should reject with error when DATAMIRROR_AUTH_TOKEN is not set", () => {
      delete process.env.DATAMIRROR_AUTH_TOKEN;
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "any-token");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("DATAMIRROR_AUTH_TOKEN is not configured");
    });
  });

  describe("when token is configured", () => {
    beforeEach(() => {
      process.env.DATAMIRROR_AUTH_TOKEN = "secret-token-123";
    });

    it("should reject when no token is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Auth token is required");
    });

    it("should reject when empty string is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Auth token is required");
    });

    it("should reject when whitespace-only string is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "   ");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Auth token is required");
    });

    it("should reject when wrong token is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "wrong-token");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid auth token.");
    });

    it("should accept when correct token is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "secret-token-123");

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("runtime settings override", () => {
    it("should use runtime setting over environment variable", () => {
      process.env.DATAMIRROR_AUTH_TOKEN = "env-token";
      const runtime = createMockRuntime({
        getSetting: vi.fn().mockReturnValue("runtime-token"),
      });

      // Should fail with env token
      const result1 = validateToken(runtime as any, "env-token");
      expect(result1.valid).toBe(false);

      // Should succeed with runtime token
      const result2 = validateToken(runtime as any, "runtime-token");
      expect(result2.valid).toBe(true);
    });
  });
});

describe("requireValidToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATAMIRROR_AUTH_TOKEN = "valid-token";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should not throw when token is valid", () => {
    const runtime = createMockRuntime();

    expect(() => {
      requireValidToken(runtime as any, "valid-token");
    }).not.toThrow();
  });

  it("should throw DatamirrorAuthError when token is invalid", () => {
    const runtime = createMockRuntime();

    expect(() => {
      requireValidToken(runtime as any, "invalid-token");
    }).toThrow(DatamirrorAuthError);
  });

  it("should throw DatamirrorAuthError when token is missing", () => {
    const runtime = createMockRuntime();

    expect(() => {
      requireValidToken(runtime as any, undefined);
    }).toThrow(DatamirrorAuthError);
  });

  it("should include error message in thrown error", () => {
    const runtime = createMockRuntime();

    try {
      requireValidToken(runtime as any, "wrong");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DatamirrorAuthError);
      expect((err as DatamirrorAuthError).message).toBe("Invalid auth token.");
    }
  });
});

describe("DatamirrorAuthError", () => {
  it("should have correct name", () => {
    const error = new DatamirrorAuthError("test message");
    expect(error.name).toBe("DatamirrorAuthError");
  });

  it("should have correct message", () => {
    const error = new DatamirrorAuthError("test message");
    expect(error.message).toBe("test message");
  });

  it("should be instance of Error", () => {
    const error = new DatamirrorAuthError("test");
    expect(error).toBeInstanceOf(Error);
  });
});
