import type { IAgentRuntime } from "@elizaos/core";

export interface TokenValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates the Datamirror auth token for write operations.
 *
 * Token validation strategy:
 * 1. Check if auth is disabled (dev mode)
 * 2. Check if token is provided and non-empty
 * 3. Compare against DATAMIRROR_AUTH_TOKEN environment variable
 * 4. If no env token is configured, allow in dev mode, reject in prod
 */
export function validateToken(
  runtime: IAgentRuntime,
  providedToken: string | undefined
): TokenValidationResult {
  // Get configured token from environment/settings
  const configuredToken = getConfiguredToken(runtime);
  const authDisabled = getAuthDisabled(runtime);

  // If auth is explicitly disabled, allow all requests
  if (authDisabled) {
    console.debug("[datamirror] Auth disabled via DATAMIRROR_AUTH_DISABLED=true");
    return { valid: true };
  }

  // If no token is configured on server side, allow requests in dev mode
  // This enables easy local development without auth setup
  if (!configuredToken) {
    const isDev = process.env.NODE_ENV !== "production";
    if (isDev) {
      console.debug("[datamirror] No auth token configured, allowing in dev mode");
      return { valid: true };
    }
    return {
      valid: false,
      error:
        "DATAMIRROR_AUTH_TOKEN is not configured. " +
        "Set this environment variable to enable Datamirror write operations.",
    };
  }

  // Token must be provided if server has a configured token
  if (!providedToken || typeof providedToken !== "string" || providedToken.trim() === "") {
    // But allow if provided token matches env token (dev convenience)
    return {
      valid: false,
      error: "Auth token is required for Datamirror write operations.",
    };
  }

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeCompare(providedToken, configuredToken)) {
    return {
      valid: false,
      error: "Invalid auth token.",
    };
  }

  return { valid: true };
}

/**
 * Retrieves the configured auth token from runtime settings or environment.
 */
function getConfiguredToken(runtime: IAgentRuntime): string | undefined {
  // Check runtime settings first (allows per-agent configuration)
  const runtimeSettings = (runtime as any).getSetting?.("DATAMIRROR_AUTH_TOKEN");
  if (runtimeSettings && typeof runtimeSettings === "string") {
    return runtimeSettings;
  }

  // Fall back to environment variable
  return process.env.DATAMIRROR_AUTH_TOKEN;
}

/**
 * Checks if auth is disabled via environment variable or settings.
 */
function getAuthDisabled(runtime: IAgentRuntime): boolean {
  // Check runtime settings first
  const runtimeSetting = (runtime as any).getSetting?.("DATAMIRROR_AUTH_DISABLED");
  if (runtimeSetting === true || runtimeSetting === "true") {
    return true;
  }

  // Fall back to environment variable
  const envSetting = process.env.DATAMIRROR_AUTH_DISABLED;
  return envSetting === "true" || envSetting === "1";
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time even on length mismatch
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
    throw new DatamirrorAuthError(result.error || "Authentication failed.");
  }
}

/**
 * Custom error class for auth failures.
 */
export class DatamirrorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatamirrorAuthError";
  }
}
