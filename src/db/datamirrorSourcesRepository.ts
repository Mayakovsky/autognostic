import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorSources,
  type DatamirrorSourceRow,
} from "./schema";

export class DatamirrorSourcesRepository {
  constructor(private runtime: IAgentRuntime) {}

  private get db() {
    const adapter: any = (this.runtime as any).databaseAdapter;
    if (!adapter?.db) {
      throw new Error("No database adapter for DatamirrorSourcesRepository");
    }
    return adapter.db;
  }

  async getById(id: string): Promise<DatamirrorSourceRow | null> {
    const rows: DatamirrorSourceRow[] = await this.db
      .select()
      .from(datamirrorSources)
      .where(eq(datamirrorSources.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getOrCreate(id: string, sourceUrl: string, description?: string) {
    const existing = await this.getById(id);
    if (existing) return existing;
    await this.db.insert(datamirrorSources).values({
      id,
      sourceUrl,
      description,
    });
    return (await this.getById(id))!;
  }

  async listEnabled(): Promise<DatamirrorSourceRow[]> {
    const rows: DatamirrorSourceRow[] = await this.db
      .select()
      .from(datamirrorSources)
      .where(eq(datamirrorSources.enabled, true));
    return rows;
  }
}
