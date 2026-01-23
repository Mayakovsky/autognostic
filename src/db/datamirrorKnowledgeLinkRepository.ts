import type { IAgentRuntime } from "@elizaos/core";
import { and, eq } from "drizzle-orm";
import {
  datamirrorKnowledgeLink,
  type DatamirrorKnowledgeLinkRow,
} from "./schema";

export class DatamirrorKnowledgeLinkRepository {
  constructor(private runtime: IAgentRuntime) {}

  private get db() {
    const adapter: any = (this.runtime as any).databaseAdapter;
    if (!adapter?.db) {
      throw new Error("No database adapter for DatamirrorKnowledgeLinkRepository");
    }
    return adapter.db;
  }

  async addLink(params: {
    sourceId: string;
    versionId: string;
    knowledgeDocumentId: string;
  }): Promise<void> {
    const id = `${params.sourceId}:${params.versionId}:${params.knowledgeDocumentId}`;
    const existing: DatamirrorKnowledgeLinkRow[] = await this.db
      .select()
      .from(datamirrorKnowledgeLink)
      .where(eq(datamirrorKnowledgeLink.id, id))
      .limit(1);

    if (!existing[0]) {
      await this.db.insert(datamirrorKnowledgeLink).values({
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
    const rows: DatamirrorKnowledgeLinkRow[] = await this.db
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
