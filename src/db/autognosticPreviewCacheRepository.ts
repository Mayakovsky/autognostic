import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  autognosticPreviewCache,
  type AutognosticPreviewCacheRow,
} from "./schema";
import type { SourcePreview } from "../orchestrator/previewSource";
import { getDb } from "./getDb";

export class AutognosticPreviewCacheRepository {
  constructor(private runtime: IAgentRuntime) {}

  async get(sourceId: string): Promise<{
    sourceId: string;
    preview: SourcePreview;
    checkedAt: Date;
  } | null> {
    const db = await getDb(this.runtime);
    const rows: AutognosticPreviewCacheRow[] = await db
      .select()
      .from(autognosticPreviewCache)
      .where(eq(autognosticPreviewCache.sourceId, sourceId))
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
    const existingRows: AutognosticPreviewCacheRow[] = await db
      .select()
      .from(autognosticPreviewCache)
      .where(eq(autognosticPreviewCache.sourceId, sourceId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(autognosticPreviewCache).values({
        sourceId,
        previewJson: preview,
        checkedAt,
      });
    } else {
      await db
        .update(autognosticPreviewCache)
        .set({ previewJson: preview, checkedAt })
        .where(eq(autognosticPreviewCache.sourceId, sourceId));
    }
  }
}
