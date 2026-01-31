# Plugin Design Refinement Report
## Conversational Automated Knowledge Control (CAKC)

**Date:** January 29, 2026  
**Status:** Gap Analysis & Implementation Plan  
**Target Rename:** `plugin-learnbase` (recommended)

---

## Executive Summary

This report analyzes the current `plugin-datamirror` codebase against the refined design vision of **Conversational Automated Knowledge Control** — a system that gives AI agents the ability to conversationally manage their own knowledge base at runtime.

### Core Design Vision

> **The agent can take orders to build and shape its own Knowledge. It will seek data, ingest data, track (version) data, update data, and sync data with new agent instances, automatically maintaining the database.**

### Three Feature Pillars

| Pillar | Description | Current Status |
|--------|-------------|----------------|
| **Semantic + Verbatim** | Dual-storage enabling direct quotation and hallucination reduction | ✅ 85% Complete |
| **Agent Self-Knowledge** | Agent awareness of what it knows, agentic interaction with internal KB | ⚠️ 60% Complete |
| **Version Tracking & Background Sync** | Automated updating, seamless startup integration | ✅ 90% Complete |

---

## Detailed Gap Analysis

### Pillar 1: Semantic + Verbatim Storage

**Goal:** Store documents in both semantic (embeddings via plugin-knowledge) and verbatim (full text) formats, enabling both RAG search and exact quotation.

#### What Exists ✅

| Component | File | Status |
|-----------|------|--------|
| Dual storage on ingest | `mirrorDocToKnowledge.ts` | ✅ Working |
| Full document table | `db/schema.ts` → `datamirrorDocuments` | ✅ Complete |
| Document repository | `datamirrorDocumentsRepository.ts` | ✅ Complete |
| Exact quote retrieval | `integration/getExactQuote.ts` | ✅ Working |
| Quote action | `actions/getQuoteAction.ts` | ✅ Working |
| Full document provider | `providers/fullDocumentProvider.ts` | ✅ Working |

#### Gaps Identified ⚠️

| Gap | Description | Priority |
|-----|-------------|----------|
| **G1.1** | No `removeKnowledge` integration | 🔴 HIGH |
| **G1.2** | Provider doesn't expose document count/stats to agent | 🟡 MEDIUM |
| **G1.3** | No search within verbatim store (only exact match) | 🟢 LOW |

**G1.1 Detail:** When a source is removed via `RemoveSourceAction`, the code deletes from `datamirrorDocuments` and `datamirrorSources`, but does NOT remove the corresponding entries from plugin-knowledge's semantic store. This creates orphaned embeddings.

```typescript
// Current removeSourceAction.ts - INCOMPLETE
await db.delete(datamirrorDocuments).where(eq(datamirrorDocuments.sourceId, sourceId));
await db.delete(datamirrorSources).where(eq(datamirrorSources.id, sourceId));
// MISSING: knowledge.removeKnowledge(knowledgeDocumentIds)
```

---

### Pillar 2: Agent Self-Knowledge

**Goal:** Agent can introspect its knowledge base — knowing what sources it has, their status, when they were updated, and what content is available.

#### What Exists ✅

| Component | File | Status |
|-----------|------|--------|
| List sources action | `actions/listSourcesAction.ts` | ✅ Working |
| Sources repository | `db/datamirrorSourcesRepository.ts` | ✅ Working |
| Document inventory in provider | `fullDocumentProvider.ts` | ⚠️ Partial |

#### Gaps Identified ⚠️

| Gap | Description | Priority |
|-----|-------------|----------|
| **G2.1** | No action to list individual documents (only sources) | 🔴 HIGH |
| **G2.2** | No action to remove a single document (only entire sources) | 🔴 HIGH |
| **G2.3** | No "knowledge summary" provider for agent context | 🟡 MEDIUM |
| **G2.4** | No action to search/query within knowledge | 🟡 MEDIUM |
| **G2.5** | No action to get document details/metadata | 🟢 LOW |

**G2.1/G2.2 Detail:** Currently the agent can only operate at the "source" level (e.g., "remove the ElizaOS docs"). It cannot operate at the document level (e.g., "remove just the README.md from ElizaOS docs").

**G2.3 Detail:** The agent should always have context about what it knows. A dedicated provider should inject a knowledge summary into every conversation:
```
You have access to 3 knowledge sources:
- ElizaOS Docs (47 documents, last synced 2 hours ago)
- API Reference (12 documents, last synced yesterday)
- Custom Notes (3 documents, manually added)
```

---

### Pillar 3: Version Tracking & Background Sync

**Goal:** Automated background reconciliation, version history, seamless startup sync.

#### What Exists ✅

| Component | File | Status |
|-----------|------|--------|
| Version tracking schema | `db/schema.ts` → `datamirrorVersions` | ✅ Complete |
| Version repository | `datamirrorVersionsRepository.ts` | ✅ Complete |
| Reconciliation service | `orchestrator/ReconciliationService.ts` | ✅ Working |
| Reconciliation worker | `orchestrator/ReconciliationWorker.ts` | ✅ Working |
| Startup bootstrap | `orchestrator/StartupBootstrapService.ts` | ✅ Working |
| Knowledge link tracking | `datamirrorKnowledgeLinkRepository.ts` | ✅ Working |
| Refresh policy | `config/RefreshPolicy.ts` | ✅ Working |
| Size policy | `config/SizePolicy.ts` | ✅ Working |

#### Gaps Identified ⚠️

| Gap | Description | Priority |
|-----|-------------|----------|
| **G3.1** | No action to view version history | 🟡 MEDIUM |
| **G3.2** | No action to rollback to previous version | 🟢 LOW |
| **G3.3** | No action to force-refresh a source | 🟡 MEDIUM |
| **G3.4** | Old versions not cleaned up (storage growth) | 🟢 LOW |

---

### Cross-Cutting Gaps

| Gap | Description | Priority |
|-----|-------------|----------|
| **G4.1** | Remove action doesn't cascade to plugin-knowledge | 🔴 CRITICAL |
| **G4.2** | No bulk operations (add/remove multiple docs) | 🟢 LOW |
| **G4.3** | Error handling inconsistent across actions | 🟡 MEDIUM |
| **G4.4** | Plugin name doesn't reflect new vision | 🟡 MEDIUM |

---

## Implementation Plan

### Phase 1: Critical Fixes (Must Have)
**Estimated Effort:** 4-6 hours

#### Task 1.1: Fix Knowledge Removal Cascade
**File:** `src/integration/removeFromKnowledge.ts` (NEW)

Create a new integration module that properly removes documents from both stores:

```typescript
// removeFromKnowledge.ts
export async function removeFromKnowledge(
  runtime: IAgentRuntime,
  knowledgeDocumentIds: string[]
): Promise<void> {
  const knowledge = runtime.getService<KnowledgeService>("knowledge");
  if (!knowledge) {
    console.warn("[learnbase] KnowledgeService not available for removal");
    return;
  }
  
  for (const id of knowledgeDocumentIds) {
    try {
      // Note: plugin-knowledge may not expose removeKnowledge yet
      // We'll need to verify the API or work around it
      await (knowledge as any).removeKnowledge?.(id);
    } catch (err) {
      console.warn(`[learnbase] Failed to remove knowledge ${id}:`, err);
    }
  }
}
```

**File:** `src/actions/removeSourceAction.ts` (UPDATE)

```typescript
// Add knowledge removal before datamirror cleanup
const knowledgeLinkRepo = new DatamirrorKnowledgeLinkRepository(runtime);
const links = await knowledgeLinkRepo.listBySource(sourceId);
const knowledgeIds = links.map(l => l.knowledgeDocumentId);

// Remove from plugin-knowledge semantic store
await removeFromKnowledge(runtime, knowledgeIds);

// Then remove from datamirror tables (existing code)
```

#### Task 1.2: Add Document List Action
**File:** `src/actions/listDocumentsAction.ts` (NEW)

```typescript
export const ListDocumentsAction: Action = {
  name: "LIST_KNOWLEDGE_DOCUMENTS",
  description: "List all documents in the knowledge base, optionally filtered by source.",
  similes: ["LIST_DOCUMENTS", "SHOW_DOCUMENTS", "WHAT_DOCUMENTS", "MY_DOCUMENTS"],
  // ...
};
```

#### Task 1.3: Add Single Document Remove Action
**File:** `src/actions/removeDocumentAction.ts` (NEW)

```typescript
export const RemoveDocumentAction: Action = {
  name: "REMOVE_KNOWLEDGE_DOCUMENT",
  description: "Remove a single document from the knowledge base by URL or ID.",
  similes: ["DELETE_DOCUMENT", "REMOVE_DOC", "FORGET_DOCUMENT"],
  // ...
};
```

---

### Phase 2: Agent Self-Knowledge Enhancement
**Estimated Effort:** 3-4 hours

#### Task 2.1: Knowledge Summary Provider
**File:** `src/providers/knowledgeSummaryProvider.ts` (NEW)

A lightweight provider that injects knowledge awareness into every response:

```typescript
export const knowledgeSummaryProvider: Provider = {
  name: "KNOWLEDGE_SUMMARY",
  description: "Provides agent with awareness of its knowledge base contents.",
  position: -5, // Run before fullDocumentProvider
  
  async get(runtime, message, state): Promise<ProviderResult> {
    // Query sources and document counts
    // Return concise summary for agent context
    return {
      text: `# YOUR KNOWLEDGE BASE
You currently have access to ${sourceCount} knowledge sources containing ${totalDocs} documents.
${sourceList}
Use LIST_KNOWLEDGE_DOCUMENTS for details or GET_EXACT_QUOTE to cite specific content.`,
      data: { sourceCount, totalDocs, sources }
    };
  }
};
```

#### Task 2.2: Search Knowledge Action
**File:** `src/actions/searchKnowledgeAction.ts` (NEW)

```typescript
export const SearchKnowledgeAction: Action = {
  name: "SEARCH_MY_KNOWLEDGE",
  description: "Search within your knowledge base for specific content or topics.",
  similes: ["FIND_IN_KNOWLEDGE", "SEARCH_DOCS", "LOOK_UP"],
  // Uses fulltext search on datamirrorDocuments.content
};
```

---

### Phase 3: Version Management Enhancement
**Estimated Effort:** 2-3 hours

#### Task 3.1: Force Refresh Action
**File:** `src/actions/refreshSourceAction.ts` (NEW)

```typescript
export const RefreshSourceAction: Action = {
  name: "REFRESH_KNOWLEDGE_SOURCE",
  description: "Force refresh a knowledge source to get the latest content.",
  similes: ["UPDATE_SOURCE", "SYNC_SOURCE", "REFRESH_DOCS"],
  // Triggers immediate reconciliation for specified source
};
```

#### Task 3.2: Version History Action
**File:** `src/actions/sourceHistoryAction.ts` (NEW)

```typescript
export const SourceHistoryAction: Action = {
  name: "SOURCE_VERSION_HISTORY",
  description: "View the version history of a knowledge source.",
  similes: ["VERSION_HISTORY", "SYNC_HISTORY"],
  // Lists all versions with timestamps and status
};
```

---

### Phase 4: Repository Updates
**Estimated Effort:** 1-2 hours

#### Task 4.1: Add Missing Repository Methods
**File:** `src/db/datamirrorKnowledgeLinkRepository.ts` (UPDATE)

```typescript
// Add method to list all links for a source (across all versions)
async listBySource(sourceId: string): Promise<DatamirrorKnowledgeLinkRow[]>

// Add method to delete links
async deleteByKnowledgeId(knowledgeDocumentId: string): Promise<void>
```

**File:** `src/db/datamirrorDocumentsRepository.ts` (UPDATE)

```typescript
// Add method to delete by URL
async deleteByUrl(url: string): Promise<void>

// Add method to list all documents with pagination
async listAll(limit?: number, offset?: number): Promise<DatamirrorDocumentsRow[]>

// Add method to count documents
async count(): Promise<number>

// Add fulltext search
async search(query: string, limit?: number): Promise<DatamirrorDocumentsRow[]>
```

---

### Phase 5: Plugin Identity Update
**Estimated Effort:** 1 hour

#### Task 5.1: Rename Plugin
- Update `package.json`: `@elizaos/plugin-datamirror` → `@elizaos/plugin-learnbase`
- Update `index.ts` exports
- Update all internal references
- Update log prefixes: `[datamirror]` → `[learnbase]`
- Update action names for clarity (optional)

---

## File Change Summary

### New Files (8)

| File | Purpose |
|------|---------|
| `src/integration/removeFromKnowledge.ts` | Knowledge removal integration |
| `src/actions/listDocumentsAction.ts` | List documents action |
| `src/actions/removeDocumentAction.ts` | Remove single document |
| `src/actions/searchKnowledgeAction.ts` | Search within knowledge |
| `src/actions/refreshSourceAction.ts` | Force refresh source |
| `src/actions/sourceHistoryAction.ts` | View version history |
| `src/providers/knowledgeSummaryProvider.ts` | Knowledge awareness |
| `docs/CLAUDE-CODE-IMPLEMENTATION-PLAN.md` | Implementation instructions |

### Modified Files (5)

| File | Changes |
|------|---------|
| `src/actions/removeSourceAction.ts` | Add knowledge cascade removal |
| `src/db/datamirrorKnowledgeLinkRepository.ts` | Add `listBySource`, `deleteByKnowledgeId` |
| `src/db/datamirrorDocumentsRepository.ts` | Add `deleteByUrl`, `listAll`, `count`, `search` |
| `src/index.ts` | Register new actions and providers |
| `package.json` | (Optional) Rename to plugin-learnbase |

---

## Priority Implementation Order

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION ROADMAP                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PHASE 1: CRITICAL (Do First)                                   │
│  ├── 1.1 Fix knowledge removal cascade (BLOCKER)                │
│  ├── 1.2 Add listDocumentsAction                                │
│  └── 1.3 Add removeDocumentAction                               │
│                                                                  │
│  PHASE 2: AGENT AWARENESS                                       │
│  ├── 2.1 Add knowledgeSummaryProvider                           │
│  └── 2.2 Add searchKnowledgeAction                              │
│                                                                  │
│  PHASE 3: VERSION MANAGEMENT                                    │
│  ├── 3.1 Add refreshSourceAction                                │
│  └── 3.2 Add sourceHistoryAction                                │
│                                                                  │
│  PHASE 4: REPOSITORY ENHANCEMENTS                               │
│  └── 4.1 Add missing repository methods                         │
│                                                                  │
│  PHASE 5: IDENTITY (Optional)                                   │
│  └── 5.1 Rename to plugin-learnbase                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Verification Checklist

After implementation, verify:

- [ ] Adding a document stores in both datamirror AND plugin-knowledge
- [ ] Removing a source removes from BOTH stores
- [ ] Removing a single document removes from BOTH stores
- [ ] Agent can list all its sources
- [ ] Agent can list all documents in a source
- [ ] Agent can list all documents across all sources
- [ ] Agent can search within its knowledge
- [ ] Agent can quote exactly from documents
- [ ] Agent has knowledge awareness in every response
- [ ] Background sync works on startup
- [ ] Background sync detects and updates changed sources
- [ ] Version history is tracked and queryable

---

## Appendix: Current Action Inventory

| Action | Purpose | Auth Required |
|--------|---------|---------------|
| `ADD_URL_TO_KNOWLEDGE` | Add single URL | Yes |
| `MIRROR_SOURCE_TO_KNOWLEDGE` | Mirror entire site/repo | Yes |
| `LIST_DATAMIRROR_SOURCES` | List sources | No |
| `REMOVE_DATAMIRROR_SOURCE` | Remove source | Yes |
| `GET_EXACT_QUOTE` | Quote from document | No |
| `SET_DATAMIRROR_SIZE_POLICY` | Configure size limits | Yes |
| `SET_DATAMIRROR_REFRESH_POLICY` | Configure refresh timing | Yes |

### Proposed New Actions

| Action | Purpose | Auth Required |
|--------|---------|---------------|
| `LIST_KNOWLEDGE_DOCUMENTS` | List individual documents | No |
| `REMOVE_KNOWLEDGE_DOCUMENT` | Remove single document | Yes |
| `SEARCH_MY_KNOWLEDGE` | Search within knowledge | No |
| `REFRESH_KNOWLEDGE_SOURCE` | Force refresh | Yes |
| `SOURCE_VERSION_HISTORY` | View version history | No |
