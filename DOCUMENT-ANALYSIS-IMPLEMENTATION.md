# Document Analysis Service — Implementation Plan

## Problem Statement

When users ask questions about stored documents — "give me the last two sentences", "what's the word count", "read me paragraph 3" — the `GET_EXACT_QUOTE` action falls through to a full-document dump because:

1. **No structural understanding**: The plugin stores raw text but never analyzes its structure. It has no concept of paragraphs, sentences, word count, or sections.

2. **Brittle mode detection**: The action handler uses regex to infer user intent ("last line" → last mode), but misses natural variations ("last two sentences", "third paragraph", "how many words").

3. **No metadata at ingest time**: When a document is stored, we record URL, content hash, byte size, MIME type — but nothing about the text itself. The agent can't answer "how long is this document?" without re-parsing the full text every time.

4. **The LLM can't help**: The provider tells the LLM what documents exist but gives zero structural metadata. The LLM has no way to know a document has 3 paragraphs and 247 words without reading it — and we deliberately prevent it from reading content (to avoid confabulation).

## Design: Document Profile

When a document is stored, we analyze it once and persist a **DocumentProfile** — a structural summary that:

- Lives in the `autognostic.documents` table as a new JSONB column `profile`
- Gets computed at ingest time (inside `mirrorDocToKnowledge`)
- Gets injected into the provider context so the LLM can answer structural questions without seeing content
- Enables the action handler to resolve complex queries ("last 2 sentences") without regex guessing

### DocumentProfile Schema

```typescript
interface DocumentProfile {
  // Structural counts
  charCount: number;
  wordCount: number;
  lineCount: number;           // Total lines including blanks
  nonEmptyLineCount: number;   // Lines with content
  paragraphCount: number;      // Blocks separated by blank lines
  sentenceCount: number;       // Approximate sentence count

  // Structural boundaries (line numbers, 1-indexed)
  paragraphs: ParagraphInfo[];
  
  // Content fingerprints (for quick structural queries)
  firstLine: string;           // First non-empty line, truncated to 120 chars
  lastLine: string;            // Last non-empty line, truncated to 120 chars
  firstSentence: string;       // First sentence, truncated to 200 chars
  lastSentence: string;        // Last sentence, truncated to 200 chars

  // Document type hints
  hasHeadings: boolean;        // Contains markdown # headings
  hasCodeBlocks: boolean;      // Contains ``` fenced blocks
  hasList: boolean;            // Contains - or * or numbered lists
  hasBlockQuotes: boolean;     // Contains > block quotes
  language: string;            // "en" (future: detect language)

  // Analysis metadata
  profileVersion: number;      // Schema version for future migrations
  analyzedAt: string;          // ISO timestamp
}

interface ParagraphInfo {
  index: number;               // 1-indexed paragraph number
  startLine: number;           // 1-indexed line number where paragraph starts
  endLine: number;             // 1-indexed line number where paragraph ends
  sentenceCount: number;       // Number of sentences in this paragraph
  wordCount: number;           // Word count for this paragraph
  preview: string;             // First 80 chars of the paragraph
}
```

## Architecture: Where Each Piece Lives

```
mirrorDocToKnowledge()
  ├── fetch content
  ├── store in autognostic.documents
  ├── NEW: analyzeDocument(content) → DocumentProfile
  ├── NEW: store profile in documents table
  └── call knowledge.addKnowledge() for embeddings

fullDocumentProvider
  ├── reads document inventory
  ├── NEW: reads profiles from documents table
  └── injects structural metadata into LLM context

GET_EXACT_QUOTE handler
  ├── NEW: reads DocumentProfile for the target document
  ├── NEW: uses profile to resolve complex queries
  │   ├── "last 2 sentences" → extract from profile.paragraphs
  │   ├── "paragraph 3" → use paragraph boundaries
  │   ├── "how many words" → return profile.wordCount
  │   └── "first sentence" → return profile.firstSentence
  └── existing: line/search/full modes still work
```

## Implementation Steps

### Step 1: Create `DocumentAnalyzer` service

**File**: `src/services/DocumentAnalyzer.ts`

A pure function (no runtime dependency) that takes raw text and returns a `DocumentProfile`. No database, no I/O — just text analysis.

Key algorithms:
- **Paragraph detection**: Split on `\n\n+` (two or more consecutive newlines). Handle edge cases: leading/trailing whitespace, documents with only single newlines, indented text blocks where the raw content uses extra whitespace (as seen in the test documents from test_tube repo).
- **Sentence detection**: Split on `.!?` followed by whitespace or end-of-string. Handle abbreviations (Mr., Dr., etc.), URLs, decimal numbers, ellipsis. Handle sentences ending with closing quotes (e.g., `"Vatueil? Captain Vatueil?"`).
- **Word count**: Split on `\s+`, filter empty strings. Count per-paragraph and total.
- **Heading detection**: Check for markdown `#` at line start.
- **Code block detection**: Check for ``` fences.
- **Line mapping**: Build a line-number-to-paragraph index for fast lookups.

The sentence splitter should be conservative — better to undercount than to split mid-abbreviation. Use a deny-list of common abbreviations.

**Abbreviation deny-list**: Mr., Mrs., Ms., Dr., Prof., Sr., Jr., St., Ave., Blvd., Dept., Div., Est., Fig., Gen., Gov., Inc., Ltd., No., Rev., Sgt., Vol., vs., etc., i.e., e.g., U.S., U.K., U.N.

**Sentence boundary rules**:
1. Split on `.` `!` `?` followed by `\s` or end-of-string
2. Do NOT split if `.` is preceded by a deny-listed abbreviation
3. Do NOT split if `.` is inside a URL pattern (`http`, `www`, `.com`, `.org`, etc.)
4. Do NOT split if `.` is between digits (`3.14`, `v2.1`)
5. Do NOT split if `.` is inside quotes and followed by more text in the same quote
6. Treat `...` (ellipsis) as non-splitting
7. Treat `\n\n` as an implicit sentence boundary

### Step 2: Add `profile` column to `autognostic.documents`

**File**: `src/db/schema.ts`

Add to the existing `autognosticDocuments` table definition:

```typescript
profile: jsonb("profile").$type<DocumentProfile | null>(),
```

Import the `DocumentProfile` type from the analyzer:

```typescript
import type { DocumentProfile } from "../services/DocumentAnalyzer";
```

This is a nullable column so existing rows aren't affected. PGlite's hash-based migration will detect the schema change and apply it automatically on next startup.

### Step 3: Add repository methods

**File**: `src/db/autognosticDocumentsRepository.ts`

Add to the class:

```typescript
async updateProfile(url: string, profile: DocumentProfile) {
  const db = await getDb(this.runtime);
  return db
    .update(autognosticDocuments)
    .set({ profile })
    .where(eq(autognosticDocuments.url, url));
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

async getWithProfile(url: string): Promise<{ content: string; profile: DocumentProfile | null } | null> {
  const db = await getDb(this.runtime);
  const rows = await db
    .select({ 
      content: autognosticDocuments.content,
      profile: autognosticDocuments.profile 
    })
    .from(autognosticDocuments)
    .where(eq(autognosticDocuments.url, url))
    .limit(1);
  return rows.length > 0 ? { content: rows[0].content, profile: rows[0].profile as DocumentProfile | null } : null;
}
```

Add corresponding static methods to the backward-compatible object literal export at the bottom of the file.

### Step 4: Compute profile at ingest time

**File**: `src/integration/mirrorDocToKnowledge.ts`

After the existing `autognosticDocumentsRepository.store(...)` call, add:

```typescript
import { analyzeDocument } from "../services/DocumentAnalyzer";

// After storing content...
try {
  const profile = analyzeDocument(content);
  await autognosticDocumentsRepository.updateProfile(runtime, params.url, profile);
  if (rawUrl !== params.url) {
    await autognosticDocumentsRepository.updateProfile(runtime, rawUrl, profile);
  }
  console.log(
    `[autognostic] Document profiled: ${profile.wordCount} words, ` +
    `${profile.paragraphCount} paragraphs, ${profile.sentenceCount} sentences`
  );
} catch (err) {
  console.warn("[autognostic] Profile generation failed (non-fatal):", err);
}
```

Profile generation is non-fatal — if it fails, the document is still stored and retrievable, just without structural metadata.

### Step 5: Add content extraction functions

**File**: `src/integration/getExactQuote.ts`

Add new exported functions that work on content + profile:

```typescript
import type { DocumentProfile } from "../services/DocumentAnalyzer";
import { splitSentences } from "../services/DocumentAnalyzer";

export function getLastNSentences(content: string, count: number): string[] {
  const sentences = splitSentences(content);
  return sentences.slice(-count);
}

export function getFirstNSentences(content: string, count: number): string[] {
  const sentences = splitSentences(content);
  return sentences.slice(0, count);
}

export function getLastNLines(content: string, count: number): string[] {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  return lines.slice(-count);
}

export function getFirstNLines(content: string, count: number): string[] {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  return lines.slice(0, count);
}

export function getParagraph(content: string, profile: DocumentProfile, paragraphNumber: number): string | null {
  const para = profile.paragraphs.find(p => p.index === paragraphNumber);
  if (!para) return null;
  const lines = content.split("\n");
  return lines.slice(para.startLine - 1, para.endLine).join("\n").trim();
}

export function getDocumentStats(profile: DocumentProfile): string {
  return [
    `Words: ${profile.wordCount}`,
    `Lines: ${profile.nonEmptyLineCount} (${profile.lineCount} total)`,
    `Paragraphs: ${profile.paragraphCount}`,
    `Sentences: ${profile.sentenceCount}`,
    `Characters: ${profile.charCount}`,
    profile.hasHeadings ? "Contains headings" : null,
    profile.hasCodeBlocks ? "Contains code blocks" : null,
    profile.hasList ? "Contains lists" : null,
  ].filter(Boolean).join("\n");
}
```

Export `splitSentences` from `DocumentAnalyzer.ts` so it can be reused here.

### Step 6: Rewrite GET_EXACT_QUOTE mode detection + handlers

**File**: `src/actions/getQuoteAction.ts`

Replace the brittle regex chain with a structured mode resolver. The resolver should:

1. Check for **stats queries** first: "how many words", "word count", "describe the document"
2. Check for **N-unit queries**: "last 2 sentences", "first 3 lines", "paragraph 4"
3. Check for **positional queries**: "last line", "first sentence"
4. Check for **search queries**: quoted text, "what does it say about X"
5. Check for **line queries**: "line 5"
6. Check for **full document**: "print", "full", "entire"
7. Fallback: full document with profile stats

New mode enum:
```typescript
type QueryMode = 
  | { type: "stats" }
  | { type: "full" }
  | { type: "line"; lineNumber: number }
  | { type: "search"; searchText: string }
  | { type: "last-lines"; count: number }
  | { type: "first-lines"; count: number }
  | { type: "last-sentences"; count: number }
  | { type: "first-sentences"; count: number }
  | { type: "paragraph"; number: number }
  | { type: "last-words"; count: number }
  | { type: "first-words"; count: number }
```

Mode detection patterns (ordered by specificity):

```
/how\s+(?:many|long)\s+(?:words?|lines?|paragraphs?|sentences?|characters?)/  → stats
/word\s*count|line\s*count|describe.*(?:document|structure)/  → stats
/(?:last|final)\s+(\d+)\s+(sentences?|lines?|paragraphs?|words?)/  → last-N
/(?:first|opening|initial)\s+(\d+)\s+(sentences?|lines?|paragraphs?|words?)/  → first-N
/paragraph\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+paragraph/  → paragraph
/(?:last|final)\s+(?:line|sentence|paragraph|word)/  → last-1
/(?:first|opening)\s+(?:line|sentence|paragraph|word)/  → first-1
/line\s+(\d+)/  → line
/"([^"]+)"/  → search
/(?:full|entire|whole|all|print|show|read.*all)/  → full
```

### Step 7: Enrich provider with profile metadata

**File**: `src/providers/fullDocumentProvider.ts`

Modify the database query to also fetch the profile column. Change inventory lines to:

```typescript
const inventoryLines = uniqueDocs.map(doc => {
  const filename = doc.url.split("/").pop() || doc.url;
  const profile = doc.profile as DocumentProfile | null;
  
  if (profile) {
    return [
      `- ${filename} | ${profile.wordCount} words, ${profile.paragraphCount} paragraphs, ${profile.sentenceCount} sentences, ${profile.nonEmptyLineCount} lines`,
      `  First: "${profile.firstLine}"`,
      `  Last: "${profile.lastLine}"`,
    ].join("\n");
  }
  
  const size = doc.byteSize ? Math.round(doc.byteSize / 1024) : "?";
  return `- ${filename} (${size}KB, no profile available)`;
});
```

Also update the retrieval instructions to mention the new capabilities:

```
## RETRIEVAL INSTRUCTIONS
- To retrieve content, quotes, sentences, paragraphs, or word counts: use GET_EXACT_QUOTE.
- Supported queries: "last 2 sentences", "paragraph 3", "word count", "first line", "search for X", "full document".
- The document profile above shows structure. Use it to understand what the user is asking for.
- Do NOT attempt to recall document content from memory. Only GET_EXACT_QUOTE can retrieve it.
```

### Step 8: Create backfill script

**File**: `scripts/backfill-profiles.ts`

```typescript
import { PGlite } from "@electric-sql/pglite";
import { analyzeDocument } from "../src/services/DocumentAnalyzer";

// Connect to PGlite, query all docs where profile IS NULL,
// run analyzeDocument on each, update the row.
```

### Step 9: Create unit tests

**File**: `tests/services/DocumentAnalyzer.test.ts`

Test cases:
- Empty string → zero counts
- Single line, no period → 1 sentence, 1 paragraph, 1 line
- Multiple paragraphs separated by blank lines
- Sentences with abbreviations (Mr. Smith went to D.C.)
- URLs in text (https://example.com/page.html should not split)
- Decimal numbers (version 3.14 should not split)
- Markdown headings, code blocks, lists
- The actual test_tube documents (skunk-marshmallow, potato-chimpanzee, etc.)
- Indented text (the space-factory document has heavy indentation)
- Quoted dialogue ("Vatueil? Captain Vatueil?")
- Ellipsis handling

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/services/DocumentAnalyzer.ts` | **CREATE** | Pure text analysis → DocumentProfile |
| `src/db/schema.ts` | **MODIFY** | Add `profile` JSONB column to documents table |
| `src/db/autognosticDocumentsRepository.ts` | **MODIFY** | Add `updateProfile()`, `getProfile()`, `getWithProfile()` |
| `src/integration/mirrorDocToKnowledge.ts` | **MODIFY** | Call analyzer after store |
| `src/integration/getExactQuote.ts` | **MODIFY** | Add sentence/paragraph/stats extraction functions |
| `src/providers/fullDocumentProvider.ts` | **MODIFY** | Include profile metadata in inventory |
| `src/actions/getQuoteAction.ts` | **MODIFY** | New QueryMode resolver + profile-based handlers |
| `scripts/backfill-profiles.ts` | **CREATE** | One-time migration for existing docs |
| `tests/services/DocumentAnalyzer.test.ts` | **CREATE** | Unit tests for analyzer |

## Design Decisions

**Why compute at ingest, not at query time?**
- Document content doesn't change after storage (immutable in autognostic)
- Profile computation involves sentence splitting which is O(n) — fine once, wasteful on every query
- The profile enables the provider to show metadata without loading content

**Why store in the same table, not a separate table?**
- 1:1 relationship with documents — no join needed
- Profile is small (~1KB JSON) relative to document content
- Simplifies the repository API

**Why a JSONB column, not separate columns?**
- Profile schema will evolve (paragraph boundaries, heading extraction, etc.)
- JSONB is flexible — no migration needed for new fields
- Single read to get full profile

**Why include `firstLine`/`lastLine` in profile?**
- The provider can show these without loading content
- Helps the LLM identify which document the user is referring to
- Provides "proof" the agent knows the document without revealing everything

**Sentence splitting approach**:
- Conservative regex-based splitter, no NLP library dependency
- Deny-list of common abbreviations
- Treat `\n\n` as sentence boundary
- Don't split on `.` inside URLs or numbers
- Good enough for knowledge management — not building a linguistics tool

**Integration with existing plugin**:
- DocumentAnalyzer has ZERO dependencies on ElizaOS runtime, database, or services
- Pure function: `analyzeDocument(text) → DocumentProfile`
- Unit testable without mocking
- No circular dependency risk
- Plugs into existing ingest → provider → action flow

## Execution Order

The CLI should implement in this exact order to maintain a compilable codebase at each step:

1. Step 1 (DocumentAnalyzer.ts) — standalone, no dependencies
2. Step 9 (tests) — validate the analyzer works
3. Step 2 (schema) — add column
4. Step 3 (repository) — add methods
5. Step 4 (mirrorDocToKnowledge) — wire up ingest
6. Step 5 (getExactQuote) — add extraction functions
7. Step 6 (getQuoteAction) — new mode resolver
8. Step 7 (fullDocumentProvider) — enrich provider
9. Step 8 (backfill script) — handle existing data
10. Build, test, deploy
