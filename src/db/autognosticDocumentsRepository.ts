import { eq, and, like } from "drizzle-orm";
import { autognosticDocuments } from "./schema";
import { getDb } from "./getDb";
import type { IAgentRuntime } from "@elizaos/core";

export class AutognosticDocumentsRepository {
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
    return db.insert(autognosticDocuments).values(doc).returning();
  }

  async getByUrl(url: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(autognosticDocuments)
      .where(eq(autognosticDocuments.url, url))
      .limit(1);
  }

  async getBySourceAndVersion(sourceId: string, versionId: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(autognosticDocuments)
      .where(
        and(
          eq(autognosticDocuments.sourceId, sourceId),
          eq(autognosticDocuments.versionId, versionId)
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
      .delete(autognosticDocuments)
      .where(
        and(
          eq(autognosticDocuments.sourceId, sourceId),
          eq(autognosticDocuments.versionId, versionId)
        )
      );
  }

  async deleteByUrl(url: string) {
    const db = await getDb(this.runtime);
    if (!db.delete) {
      throw new Error("Database adapter does not support delete operations");
    }
    return db
      .delete(autognosticDocuments)
      .where(eq(autognosticDocuments.url, url));
  }

  async deleteBySourceId(sourceId: string) {
    const db = await getDb(this.runtime);
    if (!db.delete) {
      throw new Error("Database adapter does not support delete operations");
    }
    return db
      .delete(autognosticDocuments)
      .where(eq(autognosticDocuments.sourceId, sourceId));
  }

  async listAll() {
    const db = await getDb(this.runtime);
    return db.select().from(autognosticDocuments);
  }

  async listBySourceId(sourceId: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(autognosticDocuments)
      .where(eq(autognosticDocuments.sourceId, sourceId));
  }

  async count(): Promise<number> {
    const db = await getDb(this.runtime);
    const rows = await db.select().from(autognosticDocuments);
    return rows.length;
  }

  async search(query: string) {
    const db = await getDb(this.runtime);
    return db
      .select()
      .from(autognosticDocuments)
      .where(like(autognosticDocuments.url, `%${query}%`));
  }
}

// Backward-compatible object literal export
export const autognosticDocumentsRepository = {
  async store(
    runtime: IAgentRuntime,
    doc: Parameters<AutognosticDocumentsRepository["store"]>[0]
  ) {
    return new AutognosticDocumentsRepository(runtime).store(doc);
  },

  async getByUrl(runtime: IAgentRuntime, url: string) {
    return new AutognosticDocumentsRepository(runtime).getByUrl(url);
  },

  async getBySourceAndVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    return new AutognosticDocumentsRepository(runtime).getBySourceAndVersion(
      sourceId,
      versionId
    );
  },

  async getFullContent(runtime: IAgentRuntime, url: string): Promise<string | null> {
    return new AutognosticDocumentsRepository(runtime).getFullContent(url);
  },

  async deleteByVersion(
    runtime: IAgentRuntime,
    sourceId: string,
    versionId: string
  ) {
    return new AutognosticDocumentsRepository(runtime).deleteByVersion(
      sourceId,
      versionId
    );
  },
};
