import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorPreviewCache,
  type DatamirrorPreviewCacheRow,
} from "./schema";
import type { SourcePreview } from "../orchestrator/previewSource";

export class DatamirrorPreviewCacheRepository {
  constructor(private runtime: IAgentRuntime) {}

  private get db() {
    const adapter: any = (this.runtime as any).databaseAdapter;
    if (!adapter?.db) {
      throw new Error("No database adapter for DatamirrorPreviewCacheRepository");
    }
    return adapter.db;
  }

  async get(sourceId: string): Promise<{
    sourceId: string;
    preview: SourcePreview;
    checkedAt: Date;
  } | null> {
    const rows: DatamirrorPreviewCacheRow[] = await this.db
      .select()
      .from(datamirrorPreviewCache)
      .where(eq(datamirrorPreviewCache.sourceId, sourceId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      sourceId: row.sourceId,
      preview: row.previewJson as SourcePreview,
      checkedAt: row.checkedAt,
    };
  }

  async set(sourceId: string, preview: SourcePreview, checkedAt: Date): Promise<void> {
    const existingRows: DatamirrorPreviewCacheRow[] = await this.db
      .select()
      .from(datamirrorPreviewCache)
      .where(eq(datamirrorPreviewCache.sourceId, sourceId))
      .limit(1);

    if (!existingRows[0]) {
      await this.db.insert(datamirrorPreviewCache).values({
        sourceId,
        previewJson: preview,
        checkedAt,
      });
    } else {
      await this.db
        .update(datamirrorPreviewCache)
        .set({ previewJson: preview, checkedAt })
        .where(eq(datamirrorPreviewCache.sourceId, sourceId));
    }
  }
}
