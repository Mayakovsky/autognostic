import type { IAgentRuntime } from "@elizaos/core";
import { DB_DEFAULTS } from "../config/constants";
import { AutognosticDatabaseError } from "../errors";

/**
 * Minimal shape we need from the Drizzle DB object.
 * Keep loose because adapter wrappers differ between builds.
 * Drizzle's query-builder chaining requires flexible return types.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type DrizzleDbLike = {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  delete?: (...args: unknown[]) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function isDrizzleDb(value: unknown): value is DrizzleDbLike {
  return (
    !!value &&
    typeof (value as Record<string, unknown>).select === "function" &&
    typeof (value as Record<string, unknown>).insert === "function" &&
    typeof (value as Record<string, unknown>).update === "function"
  );
}

/**
 * Extract DB from various adapter shapes.
 */
function extractDb(obj: Record<string, unknown>): DrizzleDbLike | null {
  if (!obj) return null;

  // object itself is db-like
  if (isDrizzleDb(obj)) return obj;

  // common wrapper: { db }
  if (obj.db && isDrizzleDb(obj.db)) return obj.db;

  // nested wrapper: { adapter: { db } } / { databaseAdapter: { db } }
  const nested = (obj.adapter || obj.databaseAdapter) as Record<string, unknown> | undefined;
  if (nested?.db && isDrizzleDb(nested.db)) return nested.db;
  if (isDrizzleDb(nested)) return nested;

  // sometimes adapter exposes a getter function
  for (const fnName of ["getDb", "getDB", "getDrizzle", "drizzle", "getClient"]) {
    const fn = obj?.[fnName];
    if (typeof fn === "function") {
      try {
        const maybe = (fn as (...a: unknown[]) => unknown).call(obj) as Record<string, unknown> | null;
        if (maybe && !(maybe as Record<string, unknown>).then) {
          if (isDrizzleDb(maybe)) return maybe;
          if (maybe.db && isDrizzleDb(maybe.db)) return maybe.db;
        }
      } catch {
        // ignore getter errors
      }
    }
  }

  return null;
}

/**
 * Try to resolve DB from runtime using various known patterns.
 */
async function tryResolveDb(runtime: IAgentRuntime): Promise<DrizzleDbLike | null> {
  const rt = runtime as unknown as Record<string, unknown>;

  // 1) runtime.adapter (common in current Eliza builds)
  {
    if (rt.adapter) {
      const db = extractDb(rt.adapter as Record<string, unknown>);
      if (db) return db;
    }
  }

  // 2) runtime.databaseAdapter (older expectation)
  {
    if (rt.databaseAdapter) {
      const db = extractDb(rt.databaseAdapter as Record<string, unknown>);
      if (db) return db;
    }
  }

  // 3) runtime.services Map-like
  {
    const services = rt.services as { get?: (key: string) => Promise<unknown> } | undefined;
    if (services?.get && typeof services.get === "function") {
      for (const key of ["sql", "db", "database", "adapter", "plugin-sql", "@elizaos/plugin-sql"]) {
        try {
          const svc = await services.get(key);
          if (svc) {
            const db = extractDb(svc as Record<string, unknown>);
            if (db) return db;
          }
        } catch {
          // ignore missing key
        }
      }
    }
  }

  // 4) runtime.getService
  {
    if (typeof rt.getService === "function") {
      for (const key of ["sql", "db", "database", "adapter", "plugin-sql", "@elizaos/plugin-sql"]) {
        try {
          const maybe = (rt.getService as (k: string) => unknown)(key);
          const svc = (maybe && typeof (maybe as Promise<unknown>).then === "function") ? await (maybe as Promise<unknown>) : maybe;
          if (svc) {
            const db = extractDb(svc as Record<string, unknown>);
            if (db) return db;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return null;
}

/**
 * Get database handle from runtime with retry/polling for async initialization.
 * Caches the result per runtime for subsequent calls.
 */
const dbCache = new WeakMap<IAgentRuntime, DrizzleDbLike>();

export async function getDb(
  runtime: IAgentRuntime,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<DrizzleDbLike> {
  // Check cache first
  const cached = dbCache.get(runtime);
  if (cached) return cached;

  const timeoutMs = opts?.timeoutMs ?? DB_DEFAULTS.CONNECTION_TIMEOUT_MS;
  const pollMs = opts?.pollMs ?? DB_DEFAULTS.POLL_INTERVAL_MS;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const db = await tryResolveDb(runtime);
    if (db) {
      dbCache.set(runtime, db);
      return db;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw AutognosticDatabaseError.adapterMissing({ operation: "getDb" });
}
