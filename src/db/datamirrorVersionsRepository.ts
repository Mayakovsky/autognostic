import type { IAgentRuntime } from "@elizaos/core";
import { and, desc, eq } from "drizzle-orm";
import {
  datamirrorVersions,
  type DatamirrorVersionRow,
} from "./schema";

export class DatamirrorVersionsRepository {
  constructor(private runtime: IAgentRuntime) {}

  private get db() {
    const adapter: any = (this.runtime as any).databaseAdapter;
    if (!adapter?.db) {
      throw new Error("No database adapter for DatamirrorVersionsRepository");
    }
    return adapter.db;
  }

  async getLatestActive(sourceId: string): Promise<DatamirrorVersionRow | null> {
    const rows: DatamirrorVersionRow[] = await this.db
      .select()
      .from(datamirrorVersions)
      .where(
        and(
          eq(datamirrorVersions.sourceId, sourceId),
          eq(datamirrorVersions.status, "active")
        )
      )
      .orderBy(desc(datamirrorVersions.activatedAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async createStaging(sourceId: string, versionId: string): Promise<string> {
    const id = `${sourceId}:${versionId}`;
    const rows: DatamirrorVersionRow[] = await this.db
      .select()
      .from(datamirrorVersions)
      .where(eq(datamirrorVersions.id, id))
      .limit(1);

    if (!rows[0]) {
      await this.db.insert(datamirrorVersions).values({
        id,
        sourceId,
        versionId,
        status: "staging",
      });
    }
    return id;
  }

  async markActive(sourceId: string, versionId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(datamirrorVersions)
      .set({ status: "archived" })
      .where(
        and(
          eq(datamirrorVersions.sourceId, sourceId),
          eq(datamirrorVersions.status, "active")
        )
      );

    await this.db
      .update(datamirrorVersions)
      .set({ status: "active", activatedAt: now })
      .where(
        and(
          eq(datamirrorVersions.sourceId, sourceId),
          eq(datamirrorVersions.versionId, versionId)
        )
      );
  }

  async markFailed(sourceId: string, versionId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(datamirrorVersions)
      .set({
        status: "failed",
        failedAt: now,
        failureReason: reason,
      })
      .where(
        and(
          eq(datamirrorVersions.sourceId, sourceId),
          eq(datamirrorVersions.versionId, versionId)
        )
      );
  }
}
