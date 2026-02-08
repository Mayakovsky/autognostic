import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  autognosticSources,
  type AutognosticSourceRow,
  type StaticDetectionMetadata,
} from "./schema";
import { getDb } from "./getDb";

export class AutognosticSourcesRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getById(id: string): Promise<AutognosticSourceRow | null> {
    const db = await getDb(this.runtime);
    const rows: AutognosticSourceRow[] = await db
      .select()
      .from(autognosticSources)
      .where(eq(autognosticSources.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getOrCreate(id: string, sourceUrl: string, description?: string) {
    const existing = await this.getById(id);
    if (existing) return existing;

    const db = await getDb(this.runtime);
    await db.insert(autognosticSources).values({
      id,
      sourceUrl,
      description,
    });
    return (await this.getById(id))!;
  }

  async listEnabled(): Promise<AutognosticSourceRow[]> {
    const db = await getDb(this.runtime);
    const rows: AutognosticSourceRow[] = await db
      .select()
      .from(autognosticSources)
      .where(eq(autognosticSources.enabled, true));
    return rows;
  }

  async listAll(): Promise<AutognosticSourceRow[]> {
    const db = await getDb(this.runtime);
    const rows: AutognosticSourceRow[] = await db
      .select()
      .from(autognosticSources);
    return rows;
  }

  async updateVersionTracking(
    id: string,
    versionTrackingEnabled: boolean
  ): Promise<void> {
    const db = await getDb(this.runtime);
    await db
      .update(autognosticSources)
      .set({ versionTrackingEnabled, updatedAt: new Date() })
      .where(eq(autognosticSources.id, id));
  }

  async markStaticContent(
    id: string,
    isStatic: boolean,
    metadata: StaticDetectionMetadata | null
  ): Promise<void> {
    const db = await getDb(this.runtime);
    await db
      .update(autognosticSources)
      .set({
        isStaticContent: isStatic,
        versionTrackingEnabled: !isStatic,
        staticDetectionMetadata: metadata,
        updatedAt: new Date(),
      })
      .where(eq(autognosticSources.id, id));
  }

  async updateSyncTimestamps(
    id: string,
    lastSyncAt: Date,
    nextSyncAt?: Date
  ): Promise<void> {
    const db = await getDb(this.runtime);
    await db
      .update(autognosticSources)
      .set({ lastSyncAt, nextSyncAt, updatedAt: new Date() })
      .where(eq(autognosticSources.id, id));
  }
}
