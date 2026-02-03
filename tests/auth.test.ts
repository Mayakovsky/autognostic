import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateToken,
  requireValidToken,
  AutognosticAuthError,
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

  describe("when auth is disabled (default)", () => {
    it("should allow all operations when auth is not enabled", () => {
      delete process.env.AUTOGNOSTIC_AUTH_ENABLED;
      delete process.env.AUTOGNOSTIC_AUTH_TOKEN;
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, undefined);

      expect(result.valid).toBe(true);
      expect(result.authEnabled).toBe(false);
    });

    it("should allow operations even with a token when auth is off", () => {
      delete process.env.AUTOGNOSTIC_AUTH_ENABLED;
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "any-token");

      expect(result.valid).toBe(true);
      expect(result.authEnabled).toBe(false);
    });
  });

  describe("when auth is enabled but token not configured", () => {
    beforeEach(() => {
      process.env.AUTOGNOSTIC_AUTH_ENABLED = "true";
      delete process.env.AUTOGNOSTIC_AUTH_TOKEN;
    });

    it("should reject with misconfiguration error", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "any-token");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("AUTOGNOSTIC_AUTH_TOKEN is not set");
    });
  });

  describe("when auth is enabled and token is configured", () => {
    beforeEach(() => {
      process.env.AUTOGNOSTIC_AUTH_ENABLED = "true";
      process.env.AUTOGNOSTIC_AUTH_TOKEN = "secret-token-123";
    });

    it("should reject when no token is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, undefined);

      expect(result.valid).toBe(false);
      expect(result.needsToken).toBe(true);
      expect(result.error).toContain("requires authentication");
    });

    it("should reject when empty string is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "");

      expect(result.valid).toBe(false);
      expect(result.needsToken).toBe(true);
    });

    it("should reject when whitespace-only string is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "   ");

      expect(result.valid).toBe(false);
      expect(result.needsToken).toBe(true);
    });

    it("should reject when wrong token is provided", () => {
      const runtime = createMockRuntime();

      const result = validateToken(runtime as any, "wrong-token");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid auth token");
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
      process.env.AUTOGNOSTIC_AUTH_ENABLED = "true";
      process.env.AUTOGNOSTIC_AUTH_TOKEN = "env-token";
      const runtime = createMockRuntime({
        getSetting: vi.fn((key: string) => {
          if (key === "AUTOGNOSTIC_AUTH_ENABLED") return "true";
          if (key === "AUTOGNOSTIC_AUTH_TOKEN") return "runtime-token";
          return undefined;
        }),
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
    process.env.AUTOGNOSTIC_AUTH_ENABLED = "true";
    process.env.AUTOGNOSTIC_AUTH_TOKEN = "valid-token";
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

  it("should throw AutognosticAuthError when token is invalid", () => {
    const runtime = createMockRuntime();

    expect(() => {
      requireValidToken(runtime as any, "invalid-token");
    }).toThrow(AutognosticAuthError);
  });

  it("should throw AutognosticAuthError when token is missing", () => {
    const runtime = createMockRuntime();

    expect(() => {
      requireValidToken(runtime as any, undefined);
    }).toThrow(AutognosticAuthError);
  });

  it("should include error message in thrown error", () => {
    const runtime = createMockRuntime();

    try {
      requireValidToken(runtime as any, "wrong");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AutognosticAuthError);
      expect((err as AutognosticAuthError).message).toContain("Invalid auth token");
    }
  });
});

describe("AutognosticAuthError", () => {
  it("should have correct name", () => {
    const error = new AutognosticAuthError("test message");
    expect(error.name).toBe("AutognosticAuthError");
  });

  it("should have correct message", () => {
    const error = new AutognosticAuthError("test message");
    expect(error.message).toBe("test message");
  });

  it("should be instance of Error", () => {
    const error = new AutognosticAuthError("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("should track needsToken flag", () => {
    const error = new AutognosticAuthError("needs token", true);
    expect(error.needsToken).toBe(true);

    const error2 = new AutognosticAuthError("no need");
    expect(error2.needsToken).toBe(false);
  });
});
