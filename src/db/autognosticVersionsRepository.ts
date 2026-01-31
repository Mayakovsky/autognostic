import type { IAgentRuntime } from "@elizaos/core";
import { and, desc, eq } from "drizzle-orm";
import {
  autognosticVersions,
  type AutognosticVersionRow,
} from "./schema";
import { getDb } from "./getDb";

export class AutognosticVersionsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getLatestActive(sourceId: string): Promise<AutognosticVersionRow | null> {
    const db = await getDb(this.runtime);
    const rows: AutognosticVersionRow[] = await db
      .select()
      .from(autognosticVersions)
      .where(
        and(
          eq(autognosticVersions.sourceId, sourceId),
          eq(autognosticVersions.status, "active")
        )
      )
      .orderBy(desc(autognosticVersions.activatedAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async createStaging(sourceId: string, versionId: string): Promise<string> {
    const db = await getDb(this.runtime);
    const id = `${sourceId}:${versionId}`;
    const rows: AutognosticVersionRow[] = await db
      .select()
      .from(autognosticVersions)
      .where(eq(autognosticVersions.id, id))
      .limit(1);

    if (!rows[0]) {
      await db.insert(autognosticVersions).values({
        id,
        sourceId,
        versionId,
        status: "staging",
      });
    }
    return id;
  }

  async markActive(sourceId: string, versionId: string): Promise<void> {
    const db = await getDb(this.runtime);
    const now = new Date();
    await db
      .update(autognosticVersions)
      .set({ status: "archived" })
      .where(
        and(
          eq(autognosticVersions.sourceId, sourceId),
          eq(autognosticVersions.status, "active")
        )
      );

    await db
      .update(autognosticVersions)
      .set({ status: "active", activatedAt: now })
      .where(
        and(
          eq(autognosticVersions.sourceId, sourceId),
          eq(autognosticVersions.versionId, versionId)
        )
      );
  }

  async markFailed(sourceId: string, versionId: string, reason: string): Promise<void> {
    const db = await getDb(this.runtime);
    const now = new Date();
    await db
      .update(autognosticVersions)
      .set({
        status: "failed",
        failedAt: now,
        failureReason: reason,
      })
      .where(
        and(
          eq(autognosticVersions.sourceId, sourceId),
          eq(autognosticVersions.versionId, versionId)
        )
      );
  }

  async deleteArchivedBySource(sourceId: string): Promise<void> {
    const db = await getDb(this.runtime);
    if (!db.delete) return;
    await db
      .delete(autognosticVersions)
      .where(
        and(
          eq(autognosticVersions.sourceId, sourceId),
          eq(autognosticVersions.status, "archived")
        )
      );
  }
}
