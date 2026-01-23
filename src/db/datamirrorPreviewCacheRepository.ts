import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorPreviewCache,
  type DatamirrorPreviewCacheRow,
} from "./schema";
import type { SourcePreview } from "../orchestrator/previewSource";
import { getDb } from "./getDb";

export class DatamirrorPreviewCacheRepository {
  constructor(private runtime: IAgentRuntime) {}

  async get(sourceId: string): Promise<{
    sourceId: string;
    preview: SourcePreview;
    checkedAt: Date;
  } | null> {
    const db = await getDb(this.runtime);
    const rows: DatamirrorPreviewCacheRow[] = await db
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
    const db = await getDb(this.runtime);
    const existingRows: DatamirrorPreviewCacheRow[] = await db
      .select()
      .from(datamirrorPreviewCache)
      .where(eq(datamirrorPreviewCache.sourceId, sourceId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(datamirrorPreviewCache).values({
        sourceId,
        previewJson: preview,
        checkedAt,
      });
    } else {
      await db
        .update(datamirrorPreviewCache)
        .set({ previewJson: preview, checkedAt })
        .where(eq(datamirrorPreviewCache.sourceId, sourceId));
    }
  }
}
