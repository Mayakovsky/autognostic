import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { eq } from "drizzle-orm";
import { datamirrorSettings, type DatamirrorSettingsRow } from "./schema";
import { DEFAULT_SIZE_POLICY, type DatamirrorSizePolicy } from "../config/SizePolicy";

/**
 * Minimal shape we need from the Drizzle DB object.
 * Keep loose because adapter wrappers differ between builds.
 */
type DrizzleDbLike = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export class DatamirrorSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  // ------------------------------------------------------------
  // DB resolution helpers
  // ------------------------------------------------------------

  private isDrizzleDb(value: any): value is DrizzleDbLike {
    return (
      !!value &&
      typeof value.select === "function" &&
      typeof value.insert === "function" &&
      typeof value.update === "function"
    );
  }

  /**
   * Some adapters expose `db`, others expose themselves as a db-like instance,
   * others expose a getter.
   */
  private extractDb(obj: any): DrizzleDbLike | null {
    if (!obj) return null;

    // object itself is db-like
    if (this.isDrizzleDb(obj)) return obj;

    // common wrapper: { db }
    if (obj.db && this.isDrizzleDb(obj.db)) return obj.db;

    // nested wrapper: { adapter: { db } } / { databaseAdapter: { db } }
    const nested = obj.adapter || obj.databaseAdapter;
    if (nested?.db && this.isDrizzleDb(nested.db)) return nested.db;
    if (this.isDrizzleDb(nested)) return nested;

    // sometimes adapter exposes a getter function
    for (const fnName of ["getDb", "getDB", "getDrizzle", "drizzle", "getClient"]) {
      const fn = obj?.[fnName];
      if (typeof fn === "function") {
        try {
          const maybe = fn.call(obj);
          // support async getter
          if (maybe?.then) {
            // we can't await here cleanly without changing signature,
            // so we ignore async getters in extractDb; handled elsewhere.
          } else if (this.isDrizzleDb(maybe)) {
            return maybe;
          } else if (maybe?.db && this.isDrizzleDb(maybe.db)) {
            return maybe.db;
          }
        } catch {
          // ignore getter errors
        }
      }
    }

    return null;
  }

  /**
   * Same as extractDb, but allows awaiting async getters.
   */
  private async extractDbAsync(obj: any): Promise<DrizzleDbLike | null> {
    if (!obj) return null;

    const sync = this.extractDb(obj);
    if (sync) return sync;

    for (const fnName of ["getDb", "getDB", "getDrizzle", "drizzle", "getClient"]) {
      const fn = obj?.[fnName];
      if (typeof fn === "function") {
        try {
          const maybe = fn.call(obj);
          const resolved = maybe?.then ? await maybe : maybe;

          if (this.isDrizzleDb(resolved)) return resolved;
          if (resolved?.db && this.isDrizzleDb(resolved.db)) return resolved.db;
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

  /**
   * Probe likely places where plugin-sql / core may attach the db/adapter:
   * - runtime.adapter (your runtimeKeys show "adapter" exists)
   * - runtime.databaseAdapter (legacy expectation)
   * - runtime.services (Map-like in some builds)
   * - runtime.getService("sql" | "db" | "database" | "adapter")
   */
  private async tryResolveDb(): Promise<DrizzleDbLike | null> {
    const rt: any = this.runtime as any;

    // TEMP diagnostic probe (keep until solved)
    logger.info(
      {
        hasAdapter: !!rt.adapter,
        adapterType: typeof rt.adapter,
        adapterKeys: rt.adapter ? Object.keys(rt.adapter) : null,

        hasRuntimeDatabaseAdapter: !!rt.databaseAdapter,
        databaseAdapterType: typeof rt.databaseAdapter,
        databaseAdapterKeys: rt.databaseAdapter ? Object.keys(rt.databaseAdapter) : null,

        hasServices: !!rt.services,
        servicesType: typeof rt.services,
        servicesHasGet: !!rt.services?.get && typeof rt.services.get === "function",

        hasGetService: typeof rt.getService === "function",

        // this is noisy but valuable once, then remove later
        runtimeKeyCount: rt ? Object.keys(rt).length : 0,
      },
      "[DatamirrorSettingsRepository] tryResolveDb() probe"
    );

    // 1) runtime.adapter (common in current Eliza builds)
    {
      const db = await this.extractDbAsync(rt.adapter);
      if (db) return db;
    }

    // 2) runtime.databaseAdapter (older expectation)
    {
      const db = await this.extractDbAsync(rt.databaseAdapter);
      if (db) return db;
    }

    // 3) runtime.services Map-like
    {
      const services = rt.services;
      if (services?.get && typeof services.get === "function") {
        for (const key of ["sql", "db", "database", "adapter", "plugin-sql", "@elizaos/plugin-sql"]) {
          try {
            const svc = await services.get(key);
            const db = await this.extractDbAsync(svc);
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
            const db = await this.extractDbAsync(svc);
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
   * Wait for plugin-sql to finish wiring up and exposing a db handle.
   */
  private async getDb(opts?: { timeoutMs?: number; pollMs?: number }): Promise<DrizzleDbLike> {
    const timeoutMs = opts?.timeoutMs ?? 20_000;
    const pollMs = opts?.pollMs ?? 250;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const db = await this.tryResolveDb();
      if (db) return db;
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const rt: any = this.runtime as any;
    logger.error(
      {
        hasAdapter: !!rt.adapter,
        adapterKeys: rt.adapter ? Object.keys(rt.adapter) : null,
        hasRuntimeDatabaseAdapter: !!rt.databaseAdapter,
        databaseAdapterKeys: rt.databaseAdapter ? Object.keys(rt.databaseAdapter) : null,
        hasGetService: typeof rt.getService === "function",
        hasServices: !!rt.services,
        servicesType: typeof rt.services,
        servicesHasGet: !!rt.services?.get && typeof rt.services.get === "function",
        runtimeKeys: rt ? Object.keys(rt) : null,
      },
      "[DatamirrorSettingsRepository] DB not found after waiting"
    );

    throw new Error(
      "No database adapter/db found for DatamirrorSettingsRepository. " +
        "plugin-sql may be running, but the runtime did not expose a drizzle db handle where this plugin is probing. " +
        "Check the '[DatamirrorSettingsRepository] tryResolveDb() probe' log to see where the adapter/db is attached."
    );
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------

  async getPolicy(agentId: string): Promise<DatamirrorSizePolicy> {
    const db = await this.getDb();

    const rows: DatamirrorSettingsRow[] = await db
      .select()
      .from(datamirrorSettings)
      .where(eq(datamirrorSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_SIZE_POLICY;

    return {
      ...DEFAULT_SIZE_POLICY,
      ...(row.sizePolicyJson as DatamirrorSizePolicy),
    };
  }

  async upsertPolicy(agentId: string, policy: DatamirrorSizePolicy): Promise<void> {
    const db = await this.getDb();

    const existingRows: DatamirrorSettingsRow[] = await db
      .select()
      .from(datamirrorSettings)
      .where(eq(datamirrorSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(datamirrorSettings).values({
        agentId,
        sizePolicyJson: policy,
      });
    } else {
      await db
        .update(datamirrorSettings)
        .set({ sizePolicyJson: policy })
        .where(eq(datamirrorSettings.agentId, agentId));
    }
  }
}
