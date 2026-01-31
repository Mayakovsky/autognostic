# Claude Code Implementation Plan
## Conversational Automated Knowledge Control - Plugin Learnbase

**Purpose:** Step-by-step instructions for Claude Code to implement the design refinements.

---

## Pre-Implementation Context

Read these files first to understand the codebase:
- `src/index.ts` - Plugin registration
- `src/db/schema.ts` - Database schema
- `src/integration/mirrorDocToKnowledge.ts` - How documents are added
- `src/actions/removeSourceAction.ts` - Current removal (incomplete)
- `src/db/datamirrorKnowledgeLinkRepository.ts` - Knowledge linking

---

## Phase 1: Critical Fixes

### Task 1.1: Create Knowledge Removal Integration

**Create file:** `src/integration/removeFromKnowledge.ts`

```typescript
import type { IAgentRuntime } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";

/**
 * Remove documents from plugin-knowledge semantic store.
 * This is the counterpart to mirrorDocToKnowledge - handles cleanup.
 * 
 * NOTE: plugin-knowledge may not expose a public removeKnowledge API yet.
 * If not available, we log a warning but continue (verbatim store is still cleaned).
 */
export async function removeFromKnowledge(
  runtime: IAgentRuntime,
  knowledgeDocumentIds: string[]
): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = [];
  const failed: string[] = [];

  if (!knowledgeDocumentIds.length) {
    return { removed, failed };
  }

  const knowledge = runtime.getService<KnowledgeService>("knowledge" as any);
  
  if (!knowledge) {
    console.warn(
      "[learnbase] KnowledgeService not available - cannot remove from semantic store. " +
      "Documents will remain in plugin-knowledge until manually cleaned."
    );
    return { removed: [], failed: knowledgeDocumentIds };
  }

  // Check if removeKnowledge method exists
  const knowledgeAny = knowledge as any;
  if (typeof knowledgeAny.removeKnowledge !== "function") {
    console.warn(
      "[learnbase] KnowledgeService does not expose removeKnowledge method. " +
      "Documents will remain in semantic store."
    );
    return { removed: [], failed: knowledgeDocumentIds };
  }

  for (const docId of knowledgeDocumentIds) {
    try {
      await knowledgeAny.removeKnowledge(docId);
      removed.push(docId);
      console.log(`[learnbase] Removed knowledge document: ${docId}`);
    } catch (err) {
      console.warn(`[learnbase] Failed to remove knowledge ${docId}:`, err);
      failed.push(docId);
    }
  }

  return { removed, failed };
}

/**
 * Remove a single document by its URL from both stores.
 */
export async function removeDocumentByUrl(
  runtime: IAgentRuntime,
  url: string
): Promise<{ success: boolean; error?: string }> {
  const { datamirrorDocumentsRepository } = await import("../db/datamirrorDocumentsRepository");
  const { DatamirrorKnowledgeLinkRepository } = await import("../db/datamirrorKnowledgeLinkRepository");
  
  // Find the document in our verbatim store
  const docs = await datamirrorDocumentsRepository.getByUrl(runtime, url);
  if (!docs.length) {
    return { success: false, error: `Document not found: ${url}` };
  }

  const doc = docs[0];
  const linkRepo = new DatamirrorKnowledgeLinkRepository(runtime);
  
  // Find associated knowledge links
  const links = await linkRepo.listBySourceVersion(doc.sourceId, doc.versionId);
  const knowledgeIds = links.map(l => l.knowledgeDocumentId);

  // Remove from plugin-knowledge
  if (knowledgeIds.length > 0) {
    await removeFromKnowledge(runtime, knowledgeIds);
  }

  // Remove from our verbatim store
  await datamirrorDocumentsRepository.deleteByUrl(runtime, url);

  return { success: true };
}
```

---

### Task 1.2: Update Remove Source Action

**Modify file:** `src/actions/removeSourceAction.ts`

Replace the entire file with:

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";
import { getDb } from "../db/getDb";
import { datamirrorSources, datamirrorDocuments, datamirrorKnowledgeLink } from "../db/schema";
import { eq } from "drizzle-orm";
import { removeFromKnowledge } from "../integration/removeFromKnowledge";

export const RemoveSourceAction: Action = {
  name: "REMOVE_DATAMIRROR_SOURCE",
  description: 
    "Remove a mirrored source and ALL its documents from your knowledge base. " +
    "This removes from both semantic search and verbatim storage. Requires auth token.",
  similes: [
    "DELETE_SOURCE", "REMOVE_MIRROR", "UNMIRROR",
    "FORGET_SOURCE", "REMOVE_KNOWLEDGE_SOURCE"
  ],
  parameters: {
    type: "object",
    properties: {
      sourceId: { 
        type: "string", 
        description: "ID of the source to remove (use LIST_DATAMIRROR_SOURCES to see IDs)" 
      },
      authToken: { type: "string", description: "Learnbase auth token" },
    },
    required: ["sourceId", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(remove|delete|unmirror|forget).*(source|mirror|knowledge\s*source)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (message.content as any) || {};

    // Validate auth
    try {
      requireValidToken(runtime, args.authToken);
    } catch (err) {
      if (err instanceof DatamirrorAuthError) {
        const text = err.message;
        if (callback) await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    if (!sourceId) {
      const text = "sourceId is required. Use LIST_DATAMIRROR_SOURCES to see available sources.";
      if (callback) await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
      return { success: false, text, data: { error: "missing_source_id" } };
    }

    const db = await getDb(runtime);

    // Step 1: Get all knowledge links for this source (to remove from plugin-knowledge)
    const links = await db
      .select({ knowledgeDocumentId: datamirrorKnowledgeLink.knowledgeDocumentId })
      .from(datamirrorKnowledgeLink)
      .where(eq(datamirrorKnowledgeLink.sourceId, sourceId));

    const knowledgeIds = links.map(l => l.knowledgeDocumentId);
    
    // Step 2: Remove from plugin-knowledge semantic store
    let knowledgeRemovalResult = { removed: [] as string[], failed: [] as string[] };
    if (knowledgeIds.length > 0) {
      knowledgeRemovalResult = await removeFromKnowledge(runtime, knowledgeIds);
    }

    // Step 3: Count documents being removed (for reporting)
    const docCount = await db
      .select({ url: datamirrorDocuments.url })
      .from(datamirrorDocuments)
      .where(eq(datamirrorDocuments.sourceId, sourceId));

    // Step 4: Delete from verbatim store (documents table)
    if (db.delete) {
      await db.delete(datamirrorDocuments).where(eq(datamirrorDocuments.sourceId, sourceId));
    }

    // Step 5: Delete source (cascades to versions and knowledge_link via FK)
    if (db.delete) {
      await db.delete(datamirrorSources).where(eq(datamirrorSources.id, sourceId));
    }

    const text = 
      `Removed source "${sourceId}" and ${docCount.length} document(s) from knowledge base.\n` +
      `- Semantic store: ${knowledgeRemovalResult.removed.length} removed` +
      (knowledgeRemovalResult.failed.length > 0 
        ? `, ${knowledgeRemovalResult.failed.length} failed (may need manual cleanup)`
        : "") +
      `\n- Verbatim store: ${docCount.length} removed`;

    if (callback) await callback({ text, action: "REMOVE_DATAMIRROR_SOURCE" });
    
    return {
      success: true,
      text,
      data: {
        sourceId,
        documentsRemoved: docCount.length,
        knowledgeRemoved: knowledgeRemovalResult.removed.length,
        knowledgeFailed: knowledgeRemovalResult.failed.length,
      },
    };
  },
};
```

---

### Task 1.3: Add List Documents Action

**Create file:** `src/actions/listDocumentsAction.ts`

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { getDb } from "../db/getDb";
import { datamirrorDocuments, datamirrorSources } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const ListDocumentsAction: Action = {
  name: "LIST_KNOWLEDGE_DOCUMENTS",
  description: 
    "List all documents in your knowledge base. Optionally filter by source. " +
    "No auth required (read-only operation).",
  similes: [
    "LIST_DOCUMENTS", "SHOW_DOCUMENTS", "WHAT_DOCUMENTS", 
    "MY_DOCUMENTS", "KNOWLEDGE_DOCS", "SHOW_MY_KNOWLEDGE"
  ],
  parameters: {
    type: "object",
    properties: {
      sourceId: { 
        type: "string", 
        description: "Optional: filter to documents from a specific source" 
      },
      limit: {
        type: "number",
        description: "Maximum number of documents to return (default: 20)"
      }
    },
    required: [],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(list|show|what|my).*(document|doc|knowledge|file)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (message.content as any) || {};
    const sourceId = args.sourceId as string | undefined;
    const limit = Math.min(args.limit || 20, 100);

    const db = await getDb(runtime);

    // Build query
    let query = db
      .select({
        id: datamirrorDocuments.id,
        url: datamirrorDocuments.url,
        sourceId: datamirrorDocuments.sourceId,
        byteSize: datamirrorDocuments.byteSize,
        mimeType: datamirrorDocuments.mimeType,
        createdAt: datamirrorDocuments.createdAt,
      })
      .from(datamirrorDocuments)
      .orderBy(desc(datamirrorDocuments.createdAt))
      .limit(limit);

    if (sourceId) {
      query = query.where(eq(datamirrorDocuments.sourceId, sourceId)) as any;
    }

    const documents = await query;

    if (documents.length === 0) {
      const text = sourceId
        ? `No documents found for source "${sourceId}".`
        : "No documents in your knowledge base. Use ADD_URL_TO_KNOWLEDGE or MIRROR_SOURCE_TO_KNOWLEDGE to add some.";
      if (callback) await callback({ text, action: "LIST_KNOWLEDGE_DOCUMENTS" });
      return { success: true, text, data: { documents: [], count: 0 } };
    }

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(datamirrorDocuments);
    const totalCount = Number(countResult[0]?.count || 0);

    // Format output
    const lines = documents.map((doc, i) => {
      const filename = doc.url.split('/').pop() || doc.url;
      const size = doc.byteSize ? `${Math.round(doc.byteSize / 1024)}KB` : "?KB";
      const date = doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "unknown";
      return `${i + 1}. ${filename} (${size}, added ${date})\n   URL: ${doc.url}\n   Source: ${doc.sourceId}`;
    });

    const text = sourceId
      ? `Documents in source "${sourceId}" (showing ${documents.length}):\n\n${lines.join('\n\n')}`
      : `Knowledge base documents (${documents.length} of ${totalCount} total):\n\n${lines.join('\n\n')}`;

    if (callback) await callback({ text, action: "LIST_KNOWLEDGE_DOCUMENTS" });
    
    return {
      success: true,
      text,
      data: {
        documents: documents.map(d => ({
          id: d.id,
          url: d.url,
          sourceId: d.sourceId,
          byteSize: d.byteSize,
          mimeType: d.mimeType,
        })),
        count: documents.length,
        totalCount,
      },
    };
  },
};
```

---

### Task 1.4: Add Remove Document Action

**Create file:** `src/actions/removeDocumentAction.ts`

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";
import { removeDocumentByUrl } from "../integration/removeFromKnowledge";
import { getDb } from "../db/getDb";
import { datamirrorDocuments } from "../db/schema";
import { eq } from "drizzle-orm";

// Helper to extract URL from message text
function extractUrlFromText(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const match = text.match(urlRegex);
  return match?.[0] || null;
}

export const RemoveDocumentAction: Action = {
  name: "REMOVE_KNOWLEDGE_DOCUMENT",
  description: 
    "Remove a single document from your knowledge base by URL. " +
    "Removes from both semantic search and verbatim storage. Requires auth token.",
  similes: [
    "DELETE_DOCUMENT", "REMOVE_DOC", "FORGET_DOCUMENT",
    "REMOVE_URL", "DELETE_URL", "FORGET_URL"
  ],
  parameters: {
    type: "object",
    properties: {
      url: { 
        type: "string", 
        description: "URL of the document to remove" 
      },
      documentId: {
        type: "string",
        description: "Alternative: document ID (from LIST_KNOWLEDGE_DOCUMENTS)"
      },
      authToken: { type: "string", description: "Learnbase auth token" },
    },
    required: ["authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(remove|delete|forget).*(document|doc|url|file)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    _state: any,
    _options: any,
    callback: any
  ): Promise<ActionResult> {
    const args = (message.content as any) || {};
    const messageText = (message.content as any)?.text || "";

    // Validate auth
    try {
      requireValidToken(runtime, args.authToken);
    } catch (err) {
      if (err instanceof DatamirrorAuthError) {
        const text = err.message;
        if (callback) await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
        return { success: false, text, data: { error: "auth_failed" } };
      }
      throw err;
    }

    // Get URL from args or extract from message
    let url = args.url as string | undefined;
    const documentId = args.documentId as string | undefined;

    // If documentId provided, look up the URL
    if (!url && documentId) {
      const db = await getDb(runtime);
      const docs = await db
        .select({ url: datamirrorDocuments.url })
        .from(datamirrorDocuments)
        .where(eq(datamirrorDocuments.id, documentId))
        .limit(1);
      
      if (docs.length > 0) {
        url = docs[0].url;
      }
    }

    // Try to extract URL from message if not in args
    if (!url) {
      url = extractUrlFromText(messageText) || undefined;
    }

    if (!url) {
      const text = 
        "Please specify which document to remove. Provide either:\n" +
        "- The document URL\n" +
        "- The document ID (from LIST_KNOWLEDGE_DOCUMENTS)";
      if (callback) await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      return { success: false, text, data: { error: "missing_identifier" } };
    }

    // Remove the document
    const result = await removeDocumentByUrl(runtime, url);

    if (!result.success) {
      const text = result.error || `Failed to remove document: ${url}`;
      if (callback) await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
      return { success: false, text, data: { error: "removal_failed", url } };
    }

    const filename = url.split('/').pop() || url;
    const text = `Removed "${filename}" from your knowledge base.\nURL: ${url}`;
    
    if (callback) await callback({ text, action: "REMOVE_KNOWLEDGE_DOCUMENT" });
    
    return {
      success: true,
      text,
      data: { url, removed: true },
    };
  },
};
```

---

### Task 1.5: Update Repository Methods

**Modify file:** `src/db/datamirrorDocumentsRepository.ts`

Add these methods to the class:

```typescript
// Add to DatamirrorDocumentsRepository class:

async deleteByUrl(url: string): Promise<void> {
  const db = await getDb(this.runtime);
  if (!db.delete) {
    throw new Error("Database adapter does not support delete operations");
  }
  await db.delete(datamirrorDocuments).where(eq(datamirrorDocuments.url, url));
}

async listAll(limit: number = 100, offset: number = 0): Promise<DatamirrorDocumentsRow[]> {
  const db = await getDb(this.runtime);
  return db
    .select()
    .from(datamirrorDocuments)
    .orderBy(desc(datamirrorDocuments.createdAt))
    .limit(limit)
    .offset(offset);
}

async count(): Promise<number> {
  const db = await getDb(this.runtime);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(datamirrorDocuments);
  return Number(result[0]?.count || 0);
}

async search(query: string, limit: number = 10): Promise<DatamirrorDocumentsRow[]> {
  const db = await getDb(this.runtime);
  // Simple ILIKE search - can be enhanced with full-text search later
  return db
    .select()
    .from(datamirrorDocuments)
    .where(sql`${datamirrorDocuments.content} ILIKE ${'%' + query + '%'}`)
    .limit(limit);
}
```

Also add to the backward-compatible object literal:

```typescript
// Add to datamirrorDocumentsRepository object:

async deleteByUrl(runtime: IAgentRuntime, url: string) {
  return new DatamirrorDocumentsRepository(runtime).deleteByUrl(url);
},

async listAll(runtime: IAgentRuntime, limit?: number, offset?: number) {
  return new DatamirrorDocumentsRepository(runtime).listAll(limit, offset);
},

async count(runtime: IAgentRuntime) {
  return new DatamirrorDocumentsRepository(runtime).count();
},

async search(runtime: IAgentRuntime, query: string, limit?: number) {
  return new DatamirrorDocumentsRepository(runtime).search(query, limit);
},
```

**Modify file:** `src/db/datamirrorKnowledgeLinkRepository.ts`

Add these methods:

```typescript
// Add to DatamirrorKnowledgeLinkRepository class:

async listBySource(sourceId: string): Promise<DatamirrorKnowledgeLinkRow[]> {
  const db = await getDb(this.runtime);
  return db
    .select()
    .from(datamirrorKnowledgeLink)
    .where(eq(datamirrorKnowledgeLink.sourceId, sourceId));
}

async deleteByKnowledgeId(knowledgeDocumentId: string): Promise<void> {
  const db = await getDb(this.runtime);
  if (!db.delete) {
    throw new Error("Database adapter does not support delete operations");
  }
  await db
    .delete(datamirrorKnowledgeLink)
    .where(eq(datamirrorKnowledgeLink.knowledgeDocumentId, knowledgeDocumentId));
}
```

---

### Task 1.6: Update Plugin Index

**Modify file:** `src/index.ts`

```typescript
import type { Plugin } from "@elizaos/core";

import { HttpService } from "./services/httpService";
import { GithubService } from "./services/githubService";
import { DatamirrorService } from "./services/datamirrorService";

import { AddUrlToKnowledgeAction } from "./actions/addUrlToKnowledgeAction";
import { MirrorSourceToKnowledgeAction } from "./actions/mirrorSourceToKnowledgeAction";
import { SetDatamirrorSizePolicyAction } from "./actions/setDatamirrorSizePolicyAction";
import { SetDatamirrorRefreshPolicyAction } from "./actions/setDatamirrorRefreshPolicyAction";
import { ListSourcesAction } from "./actions/listSourcesAction";
import { RemoveSourceAction } from "./actions/removeSourceAction";
import { GetQuoteAction } from "./actions/getQuoteAction";
// NEW ACTIONS
import { ListDocumentsAction } from "./actions/listDocumentsAction";
import { RemoveDocumentAction } from "./actions/removeDocumentAction";

import { fullDocumentProvider } from "./providers/fullDocumentProvider";

import { datamirrorSchema } from "./schema";

export const datamirrorPlugin: Plugin = {
  name: "@elizaos/plugin-datamirror",
  description:
    "Conversational Automated Knowledge Control - enables agents to build, manage, and query their own knowledge base through conversation.",
  services: [HttpService, GithubService, DatamirrorService],
  actions: [
    // Add/Ingest
    AddUrlToKnowledgeAction,
    MirrorSourceToKnowledgeAction,
    // Query/List
    ListSourcesAction,
    ListDocumentsAction,  // NEW
    GetQuoteAction,
    // Remove
    RemoveSourceAction,
    RemoveDocumentAction,  // NEW
    // Configure
    SetDatamirrorSizePolicyAction,
    SetDatamirrorRefreshPolicyAction,
  ],
  providers: [fullDocumentProvider],
  schema: datamirrorSchema,
};

export default datamirrorPlugin;

export {
  getExactQuote,
  getLineContent,
  getFullDocument,
} from "./integration/getExactQuote";

// NEW exports for programmatic use
export { removeFromKnowledge, removeDocumentByUrl } from "./integration/removeFromKnowledge";
```

---

## Phase 2: Agent Self-Knowledge (Optional Enhancement)

### Task 2.1: Knowledge Summary Provider

**Create file:** `src/providers/knowledgeSummaryProvider.ts`

```typescript
import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { DatamirrorSourcesRepository } from "../db/datamirrorSourcesRepository";
import { DatamirrorVersionsRepository } from "../db/datamirrorVersionsRepository";
import { getDb } from "../db/getDb";
import { datamirrorDocuments } from "../db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * KnowledgeSummaryProvider
 * 
 * Injects a brief knowledge base summary into agent context.
 * This helps the agent "know what it knows" without loading full documents.
 */
export const knowledgeSummaryProvider: Provider = {
  name: "KNOWLEDGE_SUMMARY",
  description: "Provides agent with awareness of its knowledge base contents.",
  position: -5, // Run before fullDocumentProvider

  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> {
    const sourcesRepo = new DatamirrorSourcesRepository(runtime);
    const versionsRepo = new DatamirrorVersionsRepository(runtime);
    const db = await getDb(runtime);

    // Get sources
    const sources = await sourcesRepo.listEnabled();
    
    if (sources.length === 0) {
      return {
        text: `# YOUR KNOWLEDGE BASE
You currently have no knowledge sources configured.
To add knowledge, users can provide URLs or ask you to mirror documentation sites.`,
        data: { sourceCount: 0, documentCount: 0 },
      };
    }

    // Get document counts per source
    const sourceDetails = await Promise.all(
      sources.map(async (src) => {
        const version = await versionsRepo.getLatestActive(src.id);
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(datamirrorDocuments)
          .where(eq(datamirrorDocuments.sourceId, src.id));
        
        return {
          id: src.id,
          url: src.sourceUrl,
          docCount: Number(countResult[0]?.count || 0),
          lastSync: version?.activatedAt?.toISOString(),
        };
      })
    );

    const totalDocs = sourceDetails.reduce((sum, s) => sum + s.docCount, 0);

    const sourceLines = sourceDetails.map(s => {
      const syncInfo = s.lastSync 
        ? `synced ${new Date(s.lastSync).toLocaleDateString()}`
        : "never synced";
      return `- **${s.id}**: ${s.docCount} docs (${syncInfo})`;
    });

    const text = `# YOUR KNOWLEDGE BASE
You have access to **${sources.length} knowledge source(s)** containing **${totalDocs} document(s)**.

## Sources
${sourceLines.join('\n')}

## Available Actions
- **LIST_KNOWLEDGE_DOCUMENTS** - See all documents
- **GET_EXACT_QUOTE** - Quote directly from a document
- **SEARCH_MY_KNOWLEDGE** - Search within your knowledge

When citing information from your knowledge base, use GET_EXACT_QUOTE for accuracy.`;

    return {
      text,
      data: {
        sourceCount: sources.length,
        documentCount: totalDocs,
        sources: sourceDetails,
      },
    };
  },
};
```

Then add to `src/index.ts`:

```typescript
import { knowledgeSummaryProvider } from "./providers/knowledgeSummaryProvider";

// In providers array:
providers: [knowledgeSummaryProvider, fullDocumentProvider],
```

---

## Verification Tests

After implementing, test these scenarios:

### Test 1: Add and Remove Source
```
User: "Mirror the ElizaOS docs at https://eliza.how/llms-full.txt"
Agent: [adds source]
User: "What sources do I have?"
Agent: [lists ElizaOS source]
User: "Remove the ElizaOS source"
Agent: [removes from BOTH stores]
User: "What sources do I have?"
Agent: [shows empty or remaining sources]
```

### Test 2: Add and Remove Single Document
```
User: "Add https://example.com/readme.md to my knowledge"
Agent: [adds document]
User: "List my documents"
Agent: [shows readme.md]
User: "Remove the readme.md document"
Agent: [removes from BOTH stores]
User: "List my documents"
Agent: [no longer shows readme.md]
```

### Test 3: Quote After Addition
```
User: "Add https://raw.githubusercontent.com/user/repo/main/README.md"
Agent: [adds]
User: "Quote the first 10 words from the README"
Agent: [quotes exactly from stored content]
```

---

## Notes for Claude Code

1. **Import statements**: Make sure to add necessary imports (eq, desc, sql from drizzle-orm) to files that need them.

2. **Type safety**: The KnowledgeService type from plugin-knowledge may not have removeKnowledge - we handle this with runtime checks.

3. **Error handling**: All removal operations should be wrapped in try/catch and provide meaningful error messages.

4. **Backward compatibility**: Keep the object literal exports in repositories alongside the class methods.

5. **Testing**: After each phase, run `pnpm build` to check for TypeScript errors.
