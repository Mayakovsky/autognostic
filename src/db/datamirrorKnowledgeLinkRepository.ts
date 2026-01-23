import type { IAgentRuntime } from "@elizaos/core";
import { and, eq } from "drizzle-orm";
import {
  datamirrorKnowledgeLink,
  type DatamirrorKnowledgeLinkRow,
} from "./schema";
import { getDb } from "./getDb";

export class DatamirrorKnowledgeLinkRepository {
  constructor(private runtime: IAgentRuntime) {}

  async addLink(params: {
    sourceId: string;
    versionId: string;
    knowledgeDocumentId: string;
  }): Promise<void> {
    const db = await getDb(this.runtime);
    const id = `${params.sourceId}:${params.versionId}:${params.knowledgeDocumentId}`;
    const existing: DatamirrorKnowledgeLinkRow[] = await db
      .select()
      .from(datamirrorKnowledgeLink)
      .where(eq(datamirrorKnowledgeLink.id, id))
      .limit(1);

    if (!existing[0]) {
      await db.insert(datamirrorKnowledgeLink).values({
        id,
        sourceId: params.sourceId,
        versionId: params.versionId,
        knowledgeDocumentId: params.knowledgeDocumentId,
      });
    }
  }

  async listBySourceVersion(
    sourceId: string,
    versionId: string
  ): Promise<DatamirrorKnowledgeLinkRow[]> {
    const db = await getDb(this.runtime);
    const rows: DatamirrorKnowledgeLinkRow[] = await db
      .select()
      .from(datamirrorKnowledgeLink)
      .where(
        and(
          eq(datamirrorKnowledgeLink.sourceId, sourceId),
          eq(datamirrorKnowledgeLink.versionId, versionId)
        )
      );

    return rows;
  }
}
