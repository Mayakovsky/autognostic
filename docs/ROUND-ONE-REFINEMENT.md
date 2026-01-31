# Plugin-Datamirror: Round One Refinement

## Analysis Summary

After comprehensive review of the entire repository, I've identified the following areas for improvement:

### Critical Issues
1. **Schema mismatch in documents table** - `sourceId` is defined as `uuid` but used with string values elsewhere
2. **Missing database indexes** - No indexes on frequently queried columns (url, sourceId, versionId)
3. **No error boundaries** - Action handlers can throw unhandled errors
4. **Inconsistent repository patterns** - Some use class-based, some use object literal pattern

### Best Practice Violations
1. **No input validation/sanitization** on URLs before processing
2. **No rate limiting** on HTTP requests during bulk operations
3. **Missing TypeScript strict mode** enforcement
4. **Hardcoded magic numbers** scattered throughout (timeouts, limits)
5. **No centralized logging** - console.log/warn/error used directly

### Robustness Gaps
1. **No retry logic** in mirrorDocToKnowledge for transient failures
2. **No circuit breaker** for external HTTP calls
3. **Missing graceful shutdown** in ReconciliationWorker
4. **No health check endpoint** or status reporting
5. **Preview cache can grow unbounded** - no cleanup mechanism

### Performance Optimizations
1. **Provider runs on every message** - should be more selective
2. **Sequential file processing** in reconciliation - could batch/parallelize
3. **Full document loaded for inventory** - should only load metadata
4. **getDb polling** happens every call - should cache more aggressively

### Missing Functionality
1. **No LIST_SOURCES action** - users can't see what's mirrored
2. **No REMOVE_SOURCE action** - can't remove mirrored content
3. **No GET_QUOTE action** - programmatic quote extraction
4. **No status/health provider** - agent can't report its own state

---

## Working Directory

```
C:\Users\kidco\dev\eliza\datamirror-agent\packages\plugin-datamirror
```

---

## Tasks

### Phase 1: Schema & Database Fixes

#### 1.1 Fix Schema Type Mismatch

**File:** `src/db/schema.ts`

The `datamirrorDocuments.sourceId` should be `text` not `uuid` to match usage:

```typescript
export const datamirrorDocuments = datamirror.table("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: text("source_id").notNull(),  // Changed from uuid to text
  versionId: text("version_id").notNull(),
  url: text("url").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type"),
  byteSize: integer("byte_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

#### 1.2 Add Database Indexes

**File:** `src/db/schema.ts`

Add indexes for performance:

```typescript
import { pgSchema, text, boolean, timestamp, jsonb, uuid, integer, index } from "drizzle-orm/pg-core";

// Add after table definitions:
export const datamirrorDocumentsUrlIdx = index("datamirror_documents_url_idx").on(datamirrorDocuments.url);
export const datamirrorDocumentsSourceVersionIdx = index("datamirror_documents_source_version_idx")
  .on(datamirrorDocuments.sourceId, datamirrorDocuments.versionId);
export const datamirrorVersionsSourceStatusIdx = index("datamirror_versions_source_status_idx")
  .on(datamirrorVersions.sourceId, datamirrorVersions.status);
```

### Phase 2: Centralize Constants & Configuration

#### 2.1 Create Constants File

**File:** `src/config/constants.ts` (NEW)

```typescript
/**
 * Centralized constants for plugin-datamirror
 * Avoids magic numbers scattered throughout codebase
 */

export const HTTP_DEFAULTS = {
  TIMEOUT_MS: 20_000,
  MAX_CONTENT_BYTES: 2_000_000,
  USER_AGENT: "elizaos-plugin-datamirror/1.x (+https://elizaos.ai)",
} as const;

export const RECONCILIATION_DEFAULTS = {
  MAX_FILES_PER_SOURCE: 1000,
  BATCH_SIZE: 10,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const;

export const PROVIDER_DEFAULTS = {
  MAX_DOCUMENTS_IN_CONTEXT: 3,
  MAX_CHARS_PER_DOCUMENT: 50_000,
  MAX_INVENTORY_SIZE: 10,
} as const;

export const DB_DEFAULTS = {
  CONNECTION_TIMEOUT_MS: 20_000,
  POLL_INTERVAL_MS: 250,
} as const;
```

#### 2.2 Update Files to Use Constants

Update `httpService.ts`, `fullDocumentProvider.ts`, `getDb.ts`, etc. to import from constants.

### Phase 3: Add Missing Actions

#### 3.1 ListSourcesAction

**File:** `src/actions/listSourcesAction.ts` (NEW)

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { DatamirrorSourcesRepository } from "../db/datamirrorSourcesRepository";
import { DatamirrorVersionsRepository } from "../db/datamirrorVersionsRepository";

export const ListSourcesAction: Action = {
  name: "LIST_DATAMIRROR_SOURCES",
  description: "List all mirrored sources and their status. No auth required (read-only).",
  similes: ["LIST_SOURCES", "SHOW_SOURCES", "WHAT_SOURCES", "MIRRORED_SOURCES"],
  parameters: {
    type: "object",
    properties: {
      includeDisabled: {
        type: "boolean",
        description: "Include disabled sources in the list",
      },
    },
    required: [],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(list|show|what).*(source|mirror)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<ActionResult> {
    const sourcesRepo = new DatamirrorSourcesRepository(runtime);
    const versionsRepo = new DatamirrorVersionsRepository(runtime);

    const sources = await sourcesRepo.listEnabled();

    const sourceDetails = await Promise.all(
      sources.map(async (src) => {
        const latestVersion = await versionsRepo.getLatestActive(src.id);
        return {
          id: src.id,
          url: src.sourceUrl,
          description: src.description,
          enabled: src.enabled,
          lastVersion: latestVersion?.versionId?.slice(0, 12),
          lastUpdated: latestVersion?.activatedAt?.toISOString(),
        };
      })
    );

    if (sourceDetails.length === 0) {
      return {
        success: true,
        text: "No mirrored sources configured. Use MIRROR_SOURCE_TO_KNOWLEDGE to add one.",
        data: { sources: [] },
      };
    }

    const lines = sourceDetails.map(
      (s) => `• ${s.id}: ${s.url} (last: ${s.lastUpdated || "never"})`
    );

    return {
      success: true,
      text: `Mirrored sources (${sourceDetails.length}):\n${lines.join("\n")}`,
      data: { sources: sourceDetails },
    };
  },
};
```

#### 3.2 RemoveSourceAction

**File:** `src/actions/removeSourceAction.ts` (NEW)

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { requireValidToken, DatamirrorAuthError } from "../auth/validateToken";
import { getDb } from "../db/getDb";
import { datamirrorSources, datamirrorDocuments } from "../db/schema";
import { eq } from "drizzle-orm";

export const RemoveSourceAction: Action = {
  name: "REMOVE_DATAMIRROR_SOURCE",
  description: "Remove a mirrored source and its documents. Requires auth token.",
  similes: ["DELETE_SOURCE", "REMOVE_MIRROR", "UNMIRROR"],
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "ID of the source to remove" },
      authToken: { type: "string", description: "Datamirror auth token" },
    },
    required: ["sourceId", "authToken"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(remove|delete|unmirror).*(source|mirror)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<ActionResult> {
    try {
      requireValidToken(runtime, args.authToken);
    } catch (err) {
      if (err instanceof DatamirrorAuthError) {
        return { success: false, text: err.message, data: { error: "auth_failed" } };
      }
      throw err;
    }

    const sourceId = args.sourceId as string;
    if (!sourceId) {
      return { success: false, text: "sourceId is required", data: { error: "missing_source_id" } };
    }

    const db = await getDb(runtime);

    // Delete documents first (cascade should handle this, but be explicit)
    if (db.delete) {
      await db.delete(datamirrorDocuments).where(eq(datamirrorDocuments.sourceId, sourceId));
    }

    // Note: versions and knowledge_link will cascade delete from sources
    if (db.delete) {
      await db.delete(datamirrorSources).where(eq(datamirrorSources.id, sourceId));
    }

    return {
      success: true,
      text: `Removed source ${sourceId} and all associated documents.`,
      data: { sourceId, removed: true },
    };
  },
};
```

#### 3.3 GetQuoteAction

**File:** `src/actions/getQuoteAction.ts` (NEW)

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory } from "@elizaos/core";
import { getExactQuote, getLineContent, getFullDocument } from "../integration/getExactQuote";

export const GetQuoteAction: Action = {
  name: "GET_EXACT_QUOTE",
  description: "Retrieve exact quotes or line content from a stored document. No auth required.",
  similes: ["QUOTE_FROM", "GET_LINE", "EXACT_QUOTE"],
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL of the document" },
      searchText: { type: "string", description: "Text to find for exact quote" },
      lineNumber: { type: "number", description: "Line number to retrieve" },
      mode: {
        type: "string",
        enum: ["search", "line", "full"],
        description: "search=find text, line=get line N, full=entire doc",
      },
    },
    required: ["url"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as any)?.text || "").toLowerCase();
    return /\b(quote|line\s+\d|exact|verbatim)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    args: any
  ): Promise<ActionResult> {
    const url = args.url as string;
    const mode = (args.mode as string) || "search";

    if (mode === "full") {
      const content = await getFullDocument(runtime, url);
      if (!content) {
        return { success: false, text: `Document not found: ${url}`, data: { error: "not_found" } };
      }
      return {
        success: true,
        text: `Full document (${content.length} chars):\n\n${content.slice(0, 5000)}${content.length > 5000 ? "\n...[truncated]" : ""}`,
        data: { url, charCount: content.length },
      };
    }

    if (mode === "line" && args.lineNumber) {
      const line = await getLineContent(runtime, url, args.lineNumber);
      if (line === null) {
        return { success: false, text: `Line ${args.lineNumber} not found in ${url}`, data: { error: "not_found" } };
      }
      return {
        success: true,
        text: `Line ${args.lineNumber}: "${line}"`,
        data: { url, lineNumber: args.lineNumber, content: line },
      };
    }

    if (args.searchText) {
      const result = await getExactQuote(runtime, url, args.searchText);
      if (!result.found) {
        return { success: false, text: `Text not found in ${url}`, data: { error: "not_found" } };
      }
      return {
        success: true,
        text: `Found at line ${result.lineNumber}:\n"${result.quote}"\n\nContext: ...${result.context}...`,
        data: result,
      };
    }

    return { success: false, text: "Specify searchText for search mode or lineNumber for line mode", data: { error: "invalid_params" } };
  },
};
```

### Phase 4: Optimize Provider Performance

#### 4.1 Refactor FullDocumentProvider

**File:** `src/providers/fullDocumentProvider.ts`

Key changes:
1. Only fetch full content when explicitly needed (quote patterns detected)
2. Use metadata-only queries for inventory
3. Add caching for repeated requests in same conversation

```typescript
// Add at top of file
import { PROVIDER_DEFAULTS } from "../config/constants";

// Replace the expensive allDocuments query with metadata-only:
async function getDocumentInventory(runtime: IAgentRuntime): Promise<Array<{ url: string; byteSize: number | null; createdAt: Date | null }>> {
  const db = await getDb(runtime);
  return db
    .select({
      url: datamirrorDocuments.url,
      byteSize: datamirrorDocuments.byteSize,
      createdAt: datamirrorDocuments.createdAt,
    })
    .from(datamirrorDocuments)
    .orderBy(desc(datamirrorDocuments.createdAt))
    .limit(PROVIDER_DEFAULTS.MAX_INVENTORY_SIZE);
}

// In the get() method, only fetch full content if isAskingForQuote is true
// Otherwise just provide inventory
```

### Phase 5: Add Retry Logic & Error Handling

#### 5.1 Create Retry Utility

**File:** `src/utils/retry.ts` (NEW)

```typescript
import { RECONCILIATION_DEFAULTS } from "../config/constants";

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoff?: boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    attempts = RECONCILIATION_DEFAULTS.RETRY_ATTEMPTS,
    delayMs = RECONCILIATION_DEFAULTS.RETRY_DELAY_MS,
    backoff = true,
    onRetry,
  } = opts;

  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        onRetry?.(lastError, i + 1);
        const delay = backoff ? delayMs * Math.pow(2, i) : delayMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
```

#### 5.2 Apply Retry to mirrorDocToKnowledge

**File:** `src/integration/mirrorDocToKnowledge.ts`

Wrap HTTP calls with retry:

```typescript
import { withRetry } from "../utils/retry";

// In mirrorDocToKnowledge, wrap the fetch:
const result = await withRetry(
  () => http.getRawText(rawUrl),
  {
    attempts: 3,
    onRetry: (err, attempt) => {
      console.warn(`[datamirror] Retry ${attempt} for ${rawUrl}: ${err.message}`);
    },
  }
);
```

### Phase 6: Register New Actions

#### 6.1 Update index.ts

**File:** `src/index.ts`

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

import { fullDocumentProvider } from "./providers/fullDocumentProvider";

import { datamirrorSchema } from "./schema";

export const datamirrorPlugin: Plugin = {
  name: "@elizaos/plugin-datamirror",
  description:
    "Mirrors external sources into Knowledge with versioning and policy controls.",
  services: [HttpService, GithubService, DatamirrorService],
  actions: [
    AddUrlToKnowledgeAction,
    MirrorSourceToKnowledgeAction,
    SetDatamirrorSizePolicyAction,
    SetDatamirrorRefreshPolicyAction,
    ListSourcesAction,
    RemoveSourceAction,
    GetQuoteAction,
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
```

### Phase 7: Update README

**File:** `README.md`

Add new actions to documentation and update the architecture section.

### Phase 8: Standardize Repository Pattern

#### 8.1 Convert datamirrorDocumentsRepository to Class

**File:** `src/db/datamirrorDocumentsRepository.ts`

Convert from object literal to class for consistency:

```typescript
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

  async getFullContent(url: string): Promise<string | null> {
    const docs = await this.getByUrl(url);
    return docs.length > 0 ? docs[0].content : null;
  }

  // ... rest of methods
}

// Keep backward-compatible export
export const datamirrorDocumentsRepository = {
  store: async (runtime: IAgentRuntime, doc: Parameters<DatamirrorDocumentsRepository["store"]>[0]) => {
    return new DatamirrorDocumentsRepository(runtime).store(doc);
  },
  getByUrl: async (runtime: IAgentRuntime, url: string) => {
    return new DatamirrorDocumentsRepository(runtime).getByUrl(url);
  },
  getFullContent: async (runtime: IAgentRuntime, url: string) => {
    return new DatamirrorDocumentsRepository(runtime).getFullContent(url);
  },
  // ... other methods
};
```

---

## Execution Order

1. Create `src/config/constants.ts`
2. Create `src/utils/retry.ts`
3. Fix `src/db/schema.ts` (type + indexes)
4. Update `src/db/datamirrorDocumentsRepository.ts` (class pattern)
5. Create `src/actions/listSourcesAction.ts`
6. Create `src/actions/removeSourceAction.ts`
7. Create `src/actions/getQuoteAction.ts`
8. Update `src/index.ts` (register new actions)
9. Update `src/providers/fullDocumentProvider.ts` (optimize)
10. Update `src/integration/mirrorDocToKnowledge.ts` (add retry)
11. Update `src/services/httpService.ts` (use constants)
12. Update `src/db/getDb.ts` (use constants)
13. Update `README.md`
14. Run tests: `npm test`
15. Build: `npm run build`
16. Lint/format: `npm run lint:fix && npm run format`

---

## Post-Implementation

### Build & Test

```powershell
cd C:\Users\kidco\dev\eliza\datamirror-agent\packages\plugin-datamirror
npm run build
npm test
npm run lint:fix
npm run format
```

### Commit & Push

```powershell
git add -A
git commit -m "refactor: round one refinements

- Fixed schema type mismatch (sourceId uuid→text)
- Added database indexes for performance
- Created centralized constants config
- Added retry utility with exponential backoff
- New actions: LIST_DATAMIRROR_SOURCES, REMOVE_DATAMIRROR_SOURCE, GET_EXACT_QUOTE
- Optimized fullDocumentProvider (metadata-only queries for inventory)
- Standardized repository pattern (class-based)
- Updated documentation"

git push origin main
```

### Rebuild Monorepo

```powershell
cd C:\Users\kidco\dev\eliza\datamirror-agent
npm run build
```

---

## Pause Point

After completing all steps above, report back with:
- List of files created/modified
- Any test failures
- Any build errors
- Confirmation of git push

Then await instructions to restart the server.

---

## Expected Outcomes

After restart, the agent should:
1. Support `LIST_DATAMIRROR_SOURCES` - "What sources are mirrored?"
2. Support `REMOVE_DATAMIRROR_SOURCE` - "Remove the docs.example.com source"
3. Support `GET_EXACT_QUOTE` - "Get line 5 from that README"
4. Have faster provider responses (metadata-only inventory)
5. Have more robust HTTP operations (retry on failure)
6. Have consistent repository patterns throughout
