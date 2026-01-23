import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorSources,
  type DatamirrorSourceRow,
} from "./schema";
import { getDb } from "./getDb";

export class DatamirrorSourcesRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getById(id: string): Promise<DatamirrorSourceRow | null> {
    const db = await getDb(this.runtime);
    const rows: DatamirrorSourceRow[] = await db
      .select()
      .from(datamirrorSources)
      .where(eq(datamirrorSources.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getOrCreate(id: string, sourceUrl: string, description?: string) {
    const existing = await this.getById(id);
    if (existing) return existing;

    const db = await getDb(this.runtime);
    await db.insert(datamirrorSources).values({
      id,
      sourceUrl,
      description,
    });
    return (await this.getById(id))!;
  }

  async listEnabled(): Promise<DatamirrorSourceRow[]> {
    const db = await getDb(this.runtime);
    const rows: DatamirrorSourceRow[] = await db
      .select()
      .from(datamirrorSources)
      .where(eq(datamirrorSources.enabled, true));
    return rows;
  }
}
