import { eq, and, like } from "drizzle-orm";
import { autognosticDocuments } from "./schema";
import { getDb } from "./getDb";
import type { IAgentRuntime } from "@elizaos/core";
import type { DocumentProfile } from "../services/DocumentAnalyzer.types";

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

  async getProfile(url: string): Promise<DocumentProfile | null> {
    const db = await getDb(this.runtime);
    const rows = await db
      .select({ profile: autognosticDocuments.profile })
      .from(autognosticDocuments)
      .where(eq(autognosticDocuments.url, url))
      .limit(1);
    return rows.length > 0 ? (rows[0].profile as DocumentProfile | null) : null;
  }

  async updateProfile(url: string, profile: DocumentProfile) {
    const db = await getDb(this.runtime);
    return db
      .update(autognosticDocuments)
      .set({ profile })
      .where(eq(autognosticDocuments.url, url));
  }

  async getWithProfile(url: string): Promise<{ content: string; profile: DocumentProfile | null } | null> {
    const db = await getDb(this.runtime);
    const rows = await db
      .select({
        content: autognosticDocuments.content,
        profile: autognosticDocuments.profile,
      })
      .from(autognosticDocuments)
      .where(eq(autognosticDocuments.url, url))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      content: rows[0].content,
      profile: rows[0].profile as DocumentProfile | null,
    };
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

  async getProfile(runtime: IAgentRuntime, url: string): Promise<DocumentProfile | null> {
    return new AutognosticDocumentsRepository(runtime).getProfile(url);
  },

  async updateProfile(runtime: IAgentRuntime, url: string, profile: DocumentProfile) {
    return new AutognosticDocumentsRepository(runtime).updateProfile(url, profile);
  },

  async getWithProfile(runtime: IAgentRuntime, url: string) {
    return new AutognosticDocumentsRepository(runtime).getWithProfile(url);
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
