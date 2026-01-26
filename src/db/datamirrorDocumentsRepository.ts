import { eq, and } from "drizzle-orm";
import { datamirrorDocuments } from "./schema";
import { getDb } from "./getDb";
import type { IAgentRuntime } from "@elizaos/core";

export const datamirrorDocumentsRepository = {
  async store(
    runtime: IAgentRuntime,
    doc: {
      sourceId: string;
      versionId: string;
      url: string;
      content: string;
      contentHash: string;
      mimeType?: string;
      byteSize?: number;
    }
  ) {
    const db = await getDb(runtime);
    return db.insert(datamirrorDocuments).values(doc).returning();
  },

  async getByUrl(runtime: IAgentRuntime, url: string) {
    const db = await getDb(runtime);
    return db
      .select()
      .from(datamirrorDocuments)
      .where(eq(datamirrorDocuments.url, url))
      .limit(1);
  },

  async getBySourceAndVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    const db = await getDb(runtime);
    return db
      .select()
      .from(datamirrorDocuments)
      .where(
        and(
          eq(datamirrorDocuments.sourceId, sourceId),
          eq(datamirrorDocuments.versionId, versionId)
        )
      );
  },

  async getFullContent(
    runtime: IAgentRuntime,
    url: string
  ): Promise<string | null> {
    const docs = await this.getByUrl(runtime, url);
    return docs.length > 0 ? docs[0].content : null;
  },

  async deleteByVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    const db = await getDb(runtime);
    return db
      .delete(datamirrorDocuments)
      .where(
        and(
          eq(datamirrorDocuments.sourceId, sourceId),
          eq(datamirrorDocuments.versionId, versionId)
        )
      );
  },
};
