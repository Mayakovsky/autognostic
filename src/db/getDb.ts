import type { IAgentRuntime } from "@elizaos/core";

/**
 * Minimal shape we need from the Drizzle DB object.
 * Keep loose because adapter wrappers differ between builds.
 */
export type DrizzleDbLike = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
  delete?: (...args: any[]) => any;
};

function isDrizzleDb(value: any): value is DrizzleDbLike {
  return (
    !!value &&
    typeof value.select === "function" &&
    typeof value.insert === "function" &&
    typeof value.update === "function"
  );
}

/**
 * Extract DB from various adapter shapes.
 */
function extractDb(obj: any): DrizzleDbLike | null {
  if (!obj) return null;

  // object itself is db-like
  if (isDrizzleDb(obj)) return obj;

  // common wrapper: { db }
  if (obj.db && isDrizzleDb(obj.db)) return obj.db;

  // nested wrapper: { adapter: { db } } / { databaseAdapter: { db } }
  const nested = obj.adapter || obj.databaseAdapter;
  if (nested?.db && isDrizzleDb(nested.db)) return nested.db;
  if (isDrizzleDb(nested)) return nested;

  // sometimes adapter exposes a getter function
  for (const fnName of ["getDb", "getDB", "getDrizzle", "drizzle", "getClient"]) {
    const fn = obj?.[fnName];
    if (typeof fn === "function") {
      try {
        const maybe = fn.call(obj);
        if (maybe && !maybe.then) {
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
  const rt = runtime as any;

  // 1) runtime.adapter (common in current Eliza builds)
  {
    const db = extractDb(rt.adapter);
    if (db) return db;
  }

  // 2) runtime.databaseAdapter (older expectation)
  {
    const db = extractDb(rt.databaseAdapter);
    if (db) return db;
  }

  // 3) runtime.services Map-like
  {
    const services = rt.services;
    if (services?.get && typeof services.get === "function") {
      for (const key of ["sql", "db", "database", "adapter", "plugin-sql", "@elizaos/plugin-sql"]) {
        try {
          const svc = await services.get(key);
          const db = extractDb(svc);
          if (db) return db;
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
          const maybe = rt.getService(key);
          const svc = maybe?.then ? await maybe : maybe;
          const db = extractDb(svc);
          if (db) return db;
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

  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const pollMs = opts?.pollMs ?? 250;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const db = await tryResolveDb(runtime);
    if (db) {
      dbCache.set(runtime, db);
      return db;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    "No database adapter/db found. " +
      "Ensure plugin-sql is registered and the runtime exposes a Drizzle db handle."
  );
}
