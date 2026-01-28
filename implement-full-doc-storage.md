# Implement Full Document Storage for Exact Quotes

## Priority: P1 (Core Functionality)

## Problem
Documents are chunked for RAG embeddings, but original full text is discarded. Cannot provide exact quotes or positional references.

## Solution
Store full document content in new table. Retrieve from there when exact quotes needed.

---

## Step 1: Create New Table Schema

Add to `src/db/schema.ts`:

```typescript
export const datamirrorDocuments = pgTable('datamirror_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id').notNull(),
  versionId: text('version_id').notNull(),
  url: text('url').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  mimeType: text('mime_type'),
  byteSize: integer('byte_size'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## Step 2: Create Repository

Create `src/db/datamirrorDocumentsRepository.ts`:

```typescript
import { eq, and } from 'drizzle-orm';
import { datamirrorDocuments } from './schema';
import { getDb } from './getDb';

export const datamirrorDocumentsRepository = {
  async store(
    runtime: any,
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

  async getByUrl(runtime: any, url: string) {
    const db = await getDb(runtime);
    return db.select().from(datamirrorDocuments).where(eq(datamirrorDocuments.url, url)).limit(1);
  },

  async getBySourceAndVersion(runtime: any, sourceId: string, versionId: string) {
    const db = await getDb(runtime);
    return db
      .select()
      .from(datamirrorDocuments)
      .where(and(eq(datamirrorDocuments.sourceId, sourceId), eq(datamirrorDocuments.versionId, versionId)));
  },

  async getFullContent(runtime: any, url: string): Promise<string | null> {
    const docs = await this.getByUrl(runtime, url);
    return docs.length > 0 ? docs[0].content : null;
  },

  async deleteByVersion(runtime: any, sourceId: string, versionId: string) {
    const db = await getDb(runtime);
    return db
      .delete(datamirrorDocuments)
      .where(and(eq(datamirrorDocuments.sourceId, sourceId), eq(datamirrorDocuments.versionId, versionId)));
  },
};
```

---

## Step 3: Update Schema Export

In `src/db/schema.ts`, add to exports:
```typescript
export { datamirrorDocuments };
```

In `src/schema.ts` (plugin schema export), add the new table to the schema object.

---

## Step 4: Modify Ingestion to Store Full Content

Update `src/integration/mirrorDocToKnowledge.ts`:

Add import:
```typescript
import { datamirrorDocumentsRepository } from '../db/datamirrorDocumentsRepository';
import { createHash } from 'crypto';
```

After fetching document content, before chunking/embedding, add:
```typescript
// Store full document
const contentHash = createHash('sha256').update(content).digest('hex');
await datamirrorDocumentsRepository.store(runtime, {
  sourceId,
  versionId,
  url,
  content,
  contentHash,
  mimeType: 'text/plain', // or detected type
  byteSize: Buffer.byteLength(content, 'utf8'),
});
```

---

## Step 5: Create Quote Retrieval Utility

Create `src/integration/getExactQuote.ts`:

```typescript
import { datamirrorDocumentsRepository } from '../db/datamirrorDocumentsRepository';

export interface QuoteResult {
  found: boolean;
  quote?: string;
  lineNumber?: number;
  charPosition?: number;
  context?: string;
}

export async function getExactQuote(
  runtime: any,
  url: string,
  searchText: string
): Promise<QuoteResult> {
  const content = await datamirrorDocumentsRepository.getFullContent(runtime, url);
  
  if (!content) {
    return { found: false };
  }

  const position = content.indexOf(searchText);
  if (position === -1) {
    return { found: false };
  }

  const lines = content.substring(0, position).split('\n');
  const lineNumber = lines.length;
  
  // Get surrounding context (100 chars before/after)
  const contextStart = Math.max(0, position - 100);
  const contextEnd = Math.min(content.length, position + searchText.length + 100);
  const context = content.substring(contextStart, contextEnd);

  return {
    found: true,
    quote: searchText,
    lineNumber,
    charPosition: position,
    context,
  };
}

export async function getLineContent(
  runtime: any,
  url: string,
  lineNumber: number
): Promise<string | null> {
  const content = await datamirrorDocumentsRepository.getFullContent(runtime, url);
  
  if (!content) {
    return null;
  }

  const lines = content.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) {
    return null;
  }

  return lines[lineNumber - 1];
}

export async function getFullDocument(
  runtime: any,
  url: string
): Promise<string | null> {
  return datamirrorDocumentsRepository.getFullContent(runtime, url);
}
```

---

## Step 6: Add Quote Action (Optional Enhancement)

Create `src/actions/getExactQuoteAction.ts` if you want a dedicated action for quote retrieval. Otherwise, the utility can be called from existing actions.

---

## Step 7: Update Exports

In `src/index.ts`, add:
```typescript
export { getExactQuote, getLineContent, getFullDocument } from './integration/getExactQuote';
```

---

## Step 8: Run Migration

```powershell
cd C:\Users\kidco\dev\eliza\datamirror-agent
bun run build
bun run dev
```

The plugin-sql migration system should auto-create the new table.

---

## Step 9: Test

1. Add a URL to knowledge
2. Verify `datamirror_documents` table has full content
3. Test exact quote retrieval

```sql
-- Check stored documents
SELECT url, byte_size, created_at FROM datamirror_documents;

-- Verify content stored
SELECT LENGTH(content) as content_length, url FROM datamirror_documents;
```

---

## Files Changed

| File | Action |
|------|--------|
| `src/db/schema.ts` | Add datamirrorDocuments table |
| `src/db/datamirrorDocumentsRepository.ts` | Create (new file) |
| `src/schema.ts` | Export new table |
| `src/integration/mirrorDocToKnowledge.ts` | Store full content on ingest |
| `src/integration/getExactQuote.ts` | Create (new file) |
| `src/index.ts` | Export new utilities |

---

## Storage Impact

~50KB per average document. 1000 docs ≈ 50MB. Negligible.

---

## Success Criteria

- [ ] New table created via migration
- [ ] Full document content stored on ingest
- [ ] `getExactQuote()` returns correct line numbers
- [ ] `getLineContent()` returns exact line text
- [ ] `getFullDocument()` returns complete original
