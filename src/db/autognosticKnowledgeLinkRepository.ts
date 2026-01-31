import type { IAgentRuntime } from "@elizaos/core";
import { and, eq } from "drizzle-orm";
import {
  autognosticKnowledgeLink,
  type AutognosticKnowledgeLinkRow,
} from "./schema";
import { getDb } from "./getDb";

export class AutognosticKnowledgeLinkRepository {
  constructor(private runtime: IAgentRuntime) {}

  async addLink(params: {
    sourceId: string;
    versionId: string;
    knowledgeDocumentId: string;
  }): Promise<void> {
    const db = await getDb(this.runtime);
    const id = `${params.sourceId}:${params.versionId}:${params.knowledgeDocumentId}`;
    const existing: AutognosticKnowledgeLinkRow[] = await db
      .select()
      .from(autognosticKnowledgeLink)
      .where(eq(autognosticKnowledgeLink.id, id))
      .limit(1);

    if (!existing[0]) {
      await db.insert(autognosticKnowledgeLink).values({
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
  ): Promise<AutognosticKnowledgeLinkRow[]> {
    const db = await getDb(this.runtime);
    const rows: AutognosticKnowledgeLinkRow[] = await db
      .select()
      .from(autognosticKnowledgeLink)
      .where(
        and(
          eq(autognosticKnowledgeLink.sourceId, sourceId),
          eq(autognosticKnowledgeLink.versionId, versionId)
        )
      );

    return rows;
  }

  async listBySource(sourceId: string): Promise<AutognosticKnowledgeLinkRow[]> {
    const db = await getDb(this.runtime);
    const rows: AutognosticKnowledgeLinkRow[] = await db
      .select()
      .from(autognosticKnowledgeLink)
      .where(eq(autognosticKnowledgeLink.sourceId, sourceId));
    return rows;
  }

  async deleteByKnowledgeId(knowledgeDocumentId: string): Promise<void> {
    const db = await getDb(this.runtime);
    if (!db.delete) return;
    await db
      .delete(autognosticKnowledgeLink)
      .where(eq(autognosticKnowledgeLink.knowledgeDocumentId, knowledgeDocumentId));
  }
}
