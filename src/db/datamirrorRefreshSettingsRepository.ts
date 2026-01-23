import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorRefreshSettings,
  type DatamirrorRefreshSettingsRow,
} from "./schema";
import {
  DEFAULT_REFRESH_POLICY,
  type DatamirrorRefreshPolicy,
} from "../config/RefreshPolicy";

/**
 * Minimal shape we need from the Drizzle DB object. We keep this loose
 * because Eliza + plugin-sql may wrap/compose adapters differently across builds.
 */
type DrizzleDbLike = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export class DatamirrorRefreshSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  /**
   * Best-effort detection: if it looks like a Drizzle db, treat it as one.
   * This prevents hard coupling to a specific plugin-sql adapter shape.
   */
  private isDrizzleDb(value: any): value is DrizzleDbLike {
    return (
      !!value &&
      typeof value.select === "function" &&
      typeof value.insert === "function" &&
      typeof value.update === "function"
    );
  }

  /**
   * Extract a drizzle db handle from a variety of likely containers:
   * - db itself
   * - { db }
   * - { adapter: { db } }
   * - { databaseAdapter: { db } }
   * - adapter/databaseAdapter that is itself a db-like object
   */
  private extractDb(obj: any): DrizzleDbLike | null {
    if (!obj) return null;

    // db might be the object itself
    if (this.isDrizzleDb(obj)) return obj;

    // common: { db }
    if (obj.db && this.isDrizzleDb(obj.db)) return obj.db;

    // sometimes wrapped
    const nested = obj.adapter || obj.databaseAdapter;
    if (nested?.db && this.isDrizzleDb(nested.db)) return nested.db;
    if (this.isDrizzleDb(nested)) return nested;

    return null;
  }

  /**
   * In ElizaOS 1.6.x, plugin-sql commonly registers onto runtime.adapter
   * (not runtime.databaseAdapter).
   *
   * We probe multiple surfaces:
   * - runtime.adapter
   * - runtime.databaseAdapter (legacy)
   * - runtime.services (Map-like) (some builds keep services there)
   * - runtime.getService() if available
   */
  private async tryResolveDb(): Promise<DrizzleDbLike | null> {
    const rt: any = this.runtime as any;

    // TEMP DIAGNOSTIC (requested): show what runtime exposes at DB resolution time
    // Keep this log until DB resolution is stable, then you can downgrade to debug or remove.
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

        runtimeKeyCount: rt ? Object.keys(rt).length : 0,
      },
      "[DatamirrorRefreshSettingsRepository] tryResolveDb() probe"
    );

    // ✅ PRIMARY: runtime.adapter (this is what your runtimeKeys show)
    const dbFromAdapter = this.extractDb(rt.adapter);
    if (dbFromAdapter) return dbFromAdapter;

    // fallback: legacy/other shapes
    const dbFromDatabaseAdapter = this.extractDb(rt.databaseAdapter);
    if (dbFromDatabaseAdapter) return dbFromDatabaseAdapter;

    // fallback: some builds keep services in a Map-like object
    const services = rt.services;
    if (services?.get && typeof services.get === "function") {
      for (const key of ["sql", "db", "database", "adapter"]) {
        try {
          const svc = await services.get(key);
          const db = this.extractDb(svc);
          if (db) return db;
        } catch {
          // ignore missing key / errors
        }
      }
    }

    // fallback: if getService exists and is async/sync, try it
    if (typeof rt.getService === "function") {
      for (const key of ["sql", "db", "database", "adapter"]) {
        try {
          const maybe = rt.getService(key);
          const svc = maybe?.then ? await maybe : maybe;
          const db = this.extractDb(svc);
          if (db) return db;
        } catch {
          // ignore missing key / errors
        }
      }
    }

    return null;
  }

  /**
   * Wait for plugin-sql to register its adapter (or db) onto runtime.
   * On some boots, plugin init ordering means the db isn't ready on the first tick.
   */
  private async getDb(opts?: {
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<DrizzleDbLike> {
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
        hasGetService: typeof rt.getService === "function",
        hasRuntimeDatabaseAdapter: !!rt.databaseAdapter,
        databaseAdapterKeys: rt.databaseAdapter ? Object.keys(rt.databaseAdapter) : null,
        hasServices: !!rt.services,
        servicesType: typeof rt.services,
        servicesHasGet: !!rt.services?.get && typeof rt.services.get === "function",
        runtimeKeys: rt ? Object.keys(rt) : null,
      },
      "[DatamirrorRefreshSettingsRepository] DB not found after waiting"
    );

    throw new Error(
      "No database adapter/db found for DatamirrorRefreshSettingsRepository. " +
        "(plugin-sql may be running, but the runtime did not expose a drizzle db handle where this plugin expects. " +
        "Inspect logs from tryResolveDb() probe to see where plugin-sql attached its adapter.)"
    );
  }

  async getPolicy(agentId: string): Promise<DatamirrorRefreshPolicy> {
    const db = await this.getDb();

    const rows: DatamirrorRefreshSettingsRow[] = await db
      .select()
      .from(datamirrorRefreshSettings)
      .where(eq(datamirrorRefreshSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_REFRESH_POLICY;

    return {
      ...DEFAULT_REFRESH_POLICY,
      ...(row.refreshPolicyJson as DatamirrorRefreshPolicy),
    };
  }

  async upsertPolicy(
    agentId: string,
    policy: DatamirrorRefreshPolicy
  ): Promise<void> {
    const db = await this.getDb();

    const existingRows: DatamirrorRefreshSettingsRow[] = await db
      .select()
      .from(datamirrorRefreshSettings)
      .where(eq(datamirrorRefreshSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(datamirrorRefreshSettings).values({
        agentId,
        refreshPolicyJson: policy,
      });
    } else {
      await db
        .update(datamirrorRefreshSettings)
        .set({ refreshPolicyJson: policy })
        .where(eq(datamirrorRefreshSettings.agentId, agentId));
    }
  }
}
