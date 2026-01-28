import type { IAgentRuntime } from "@elizaos/core";

export interface TokenValidationResult {
  valid: boolean;
  authEnabled: boolean;
  needsToken: boolean;
  error?: string;
}

export interface AuthConfig {
  enabled: boolean;
  token?: string;
}

/**
 * DATAMIRROR AUTH SCHEMA
 * ======================
 *
 * Design Philosophy:
 * - Auth is OFF by default (open access to knowledge management)
 * - Auth can be ENABLED by admin when access control is needed
 * - When enabled, token is REQUIRED for write operations
 * - Agent will ASK for token when auth is enabled but token not provided
 *
 * Configuration:
 * - DATAMIRROR_AUTH_ENABLED: "true" | "false" (default: false)
 * - DATAMIRROR_AUTH_TOKEN: string (the password, only checked when enabled)
 *
 * Use Cases:
 * 1. Personal agent (single admin): Auth OFF - no token needed
 * 2. Shared agent (multiple admins): Auth ON - token required
 * 3. Public agent (restricted writes): Auth ON - only admins can add knowledge
 */

/**
 * Gets the current auth configuration from runtime settings or environment.
 */
export function getAuthConfig(runtime: IAgentRuntime): AuthConfig {
  // Check runtime settings first (allows per-agent configuration)
  const runtimeEnabled = (runtime as any).getSetting?.("DATAMIRROR_AUTH_ENABLED");
  const runtimeToken = (runtime as any).getSetting?.("DATAMIRROR_AUTH_TOKEN");

  // Determine if auth is enabled
  let enabled = false;
  if (runtimeEnabled === true || runtimeEnabled === "true") {
    enabled = true;
  } else if (runtimeEnabled === false || runtimeEnabled === "false") {
    enabled = false;
  } else {
    // Fall back to environment variable
    const envEnabled = process.env.DATAMIRROR_AUTH_ENABLED;
    enabled = envEnabled === "true" || envEnabled === "1";
  }

  // Get token
  let token: string | undefined;
  if (typeof runtimeToken === "string" && runtimeToken.trim()) {
    token = runtimeToken;
  } else {
    token = process.env.DATAMIRROR_AUTH_TOKEN || undefined;
  }

  return { enabled, token };
}

/**
 * Validates the auth token for write operations.
 *
 * Returns:
 * - valid: true if operation should proceed
 * - authEnabled: true if auth is turned on
 * - needsToken: true if auth is on but no token was provided (agent should ask)
 * - error: error message if validation failed
 */
export function validateToken(
  runtime: IAgentRuntime,
  providedToken: string | undefined
): TokenValidationResult {
  const config = getAuthConfig(runtime);

  // Auth is OFF - allow all operations
  if (!config.enabled) {
    return {
      valid: true,
      authEnabled: false,
      needsToken: false,
    };
  }

  // Auth is ON - check configuration
  if (!config.token) {
    // Auth enabled but no server token configured - this is a misconfiguration
    return {
      valid: false,
      authEnabled: true,
      needsToken: false,
      error:
        "Auth is enabled but DATAMIRROR_AUTH_TOKEN is not set. " +
        "Please configure the token or disable auth.",
    };
  }

  // Auth is ON and configured - check if user provided a token
  if (!providedToken || typeof providedToken !== "string" || providedToken.trim() === "") {
    // No token provided - agent should ask for it
    return {
      valid: false,
      authEnabled: true,
      needsToken: true,
      error: "This operation requires authentication. Please provide the auth token.",
    };
  }

  // Validate the provided token
  if (!constantTimeCompare(providedToken.trim(), config.token)) {
    return {
      valid: false,
      authEnabled: true,
      needsToken: false,
      error: "Invalid auth token. Access denied.",
    };
  }

  // Token is valid
  return {
    valid: true,
    authEnabled: true,
    needsToken: false,
  };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Helper to validate token and throw a structured error if invalid.
 * Use this in action handlers for consistent error handling.
 */
export function requireValidToken(
  runtime: IAgentRuntime,
  providedToken: string | undefined
): void {
  const result = validateToken(runtime, providedToken);
  if (!result.valid) {
    throw new DatamirrorAuthError(
      result.error || "Authentication failed.",
      result.needsToken
    );
  }
}

/**
 * Custom error class for auth failures.
 */
export class DatamirrorAuthError extends Error {
  public readonly needsToken: boolean;

  constructor(message: string, needsToken: boolean = false) {
    super(message);
    this.name = "DatamirrorAuthError";
    this.needsToken = needsToken;
  }
}

/**
 * Check if auth is currently enabled (for informational purposes).
 */
export function isAuthEnabled(runtime: IAgentRuntime): boolean {
  return getAuthConfig(runtime).enabled;
}
