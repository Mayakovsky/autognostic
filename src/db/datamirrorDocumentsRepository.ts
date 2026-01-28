import { eq, and } from "drizzle-orm";
import { datamirrorDocuments } from "./schema";
import { getDb } from "./getDb";
import type { IAgentRuntime } from "@elizaos/core";

export class DatamirrorDocumentsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async store(doc: {
    sourceId: string;
    versionId: string;
    url: string;
    content: string;
    contentHash: string;
    mimeType?: string;
    byteSize?: number;
  }) {
    const db = await getDb(this.runtime);
    return db.insert(datamirrorDocuments).values(doc).returning();
  }

  async getByUrl(url: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(datamirrorDocuments)
      .where(eq(datamirrorDocuments.url, url))
      .limit(1);
  }

  async getBySourceAndVersion(sourceId: string, versionId: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(datamirrorDocuments)
      .where(
        and(
          eq(datamirrorDocuments.sourceId, sourceId),
          eq(datamirrorDocuments.versionId, versionId)
        )
      );
  }

  async getFullContent(url: string): Promise<string | null> {
    const docs = await this.getByUrl(url);
    return docs.length > 0 ? docs[0].content : null;
  }

  async deleteByVersion(sourceId: string, versionId: string) {
    const db = await getDb(this.runtime);
    if (!db.delete) {
      throw new Error("Database adapter does not support delete operations");
    }
    return db
      .delete(datamirrorDocuments)
      .where(
        and(
          eq(datamirrorDocuments.sourceId, sourceId),
          eq(datamirrorDocuments.versionId, versionId)
        )
      );
  }
}

// Backward-compatible object literal export
export const datamirrorDocumentsRepository = {
  async store(
    runtime: IAgentRuntime,
    doc: Parameters<DatamirrorDocumentsRepository["store"]>[0]
  ) {
    return new DatamirrorDocumentsRepository(runtime).store(doc);
  },

  async getByUrl(runtime: IAgentRuntime, url: string) {
    return new DatamirrorDocumentsRepository(runtime).getByUrl(url);
  },

  async getBySourceAndVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    return new DatamirrorDocumentsRepository(runtime).getBySourceAndVersion(
      sourceId,
      versionId
    );
  },

  async getFullContent(runtime: IAgentRuntime, url: string): Promise<string | null> {
    return new DatamirrorDocumentsRepository(runtime).getFullContent(url);
  },

  async deleteByVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    return new DatamirrorDocumentsRepository(runtime).deleteByVersion(
      sourceId,
      versionId
    );
  },
};
