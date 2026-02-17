# PHASE 2 IMPLEMENTATION PLAN — plugin-autognostic
## IRL Testing Feedback Integration + Feature Expansion
> Generated: 2026-02-15
> Status: READY FOR CLI EXECUTION
> Target: Claude Code CLI (Mayakovsky)

---

## TESTING FEEDBACK SUMMARY

### What's Working
- Stats queries now singular (stat_specific vs stats) — confirmed
- Error loops eliminated — agent no longer hangs
- Basic functionality (add URL, query stats, search) — stable

### What Failed
- "First and third sentence" query → returned first sentence + entire document instead of third
- Root cause: `nth` mode correctly parses ordinals but the fallback path dumps full doc when the LLM sends two sequential queries and the second one doesn't match a mode pattern cleanly

### What's Missing
1. **Grammar-aware text unit distinction** — agent conflates lines, phrases, sentences, clauses
2. **Verbatim keyword/phrase search with counting** — "how many times does X appear?"
3. **Webpage → PDF link discovery → auto-download** — fully autonomous document acquisition
4. **Scientific document section awareness** — abstract, introduction, methods, results, conclusion, references, citations

---

## ARCHITECTURE OVERVIEW

Six workstreams, each independently buildable and testable:

```
WS1: GrammarEngine         — line vs sentence vs phrase vs clause distinction
WS2: KeywordCounter        — verbatim occurrence counting, phrase frequency
WS3: WebPageProcessor      — HTML→text, link extraction, PDF auto-download
WS4: ScientificSections    — section detection, named section retrieval
WS5: InferMode Hardening   — fix ordinal multi-unit queries, compound requests
WS6: Integration + Tests   — wire everything, E2E tests, heartbeat update
```

---

## WS1: GRAMMAR ENGINE — Text Unit Disambiguation

### Problem
The agent doesn't distinguish between lines (newline-delimited), sentences (grammar-delimited), phrases (sub-sentence clauses), and clauses. When a user says "the third sentence" vs "the third line," these should return different content.

### Solution
Extend DocumentAnalyzer with explicit unit definitions and add a `GrammarEngine` utility.

### Definitions (to embed in agent character context)
| Unit       | Delimiter                                    | Example                              |
|------------|----------------------------------------------|--------------------------------------|
| **Line**   | `\n` (newline character)                     | Physical line in the file            |
| **Sentence** | `.` `!` `?` followed by whitespace (with abbreviation exceptions) | Grammatical sentence |
| **Phrase** | Comma-separated clause within a sentence     | "After the rain, the sun came out"   |
| **Clause** | Independent or dependent clause (subject+verb) | "although it was late" |
| **Word**   | Whitespace-delimited token                   | Single word                          |
| **Paragraph** | Double newline `\n\n`                     | Block of consecutive lines           |

### New Files
```
src/services/GrammarEngine.ts        — phrase/clause detection
src/services/GrammarEngine.types.ts  — PhraseBoundary, ClauseBoundary types
tests/GrammarEngine.test.ts          — unit tests
```

### GrammarEngine.ts Design
```typescript
interface PhraseBoundary {
  index: number;
  sentenceIndex: number;   // which sentence this phrase belongs to
  start: number;           // char offset in document
  end: number;
  text: string;
  wordCount: number;
}

interface ClauseBoundary {
  index: number;
  sentenceIndex: number;
  start: number;
  end: number;
  text: string;
  type: 'independent' | 'dependent';
  wordCount: number;
}

// Detection approach:
// Phrases: split sentences on commas, semicolons, colons, em-dashes
//          but NOT commas inside quotes or parentheses
// Clauses: detect subject+verb groups using simple heuristic:
//          split on subordinating conjunctions (although, because, while,
//          when, if, since, unless, after, before, until, that, which, who)
//          and coordinating conjunctions (and, but, or, yet, so, for, nor)
//          Each split must contain a verb-like word (regex for common patterns)

export function detectPhrases(sentence: string, sentenceIndex: number): PhraseBoundary[];
export function detectClauses(sentence: string, sentenceIndex: number): ClauseBoundary[];
```

### DocumentProfile Extension
Add to existing profile:
```typescript
// Optional — computed on demand, not at ingest (too expensive for large docs)
phrases?: PhraseBoundary[];
clauses?: ClauseBoundary[];
phraseCount?: number;
clauseCount?: number;
```

### Mode Detection Additions
```
"the third phrase"          → nth, unit=phrase
"last two clauses"          → last_n, unit=clause
"how many phrases"          → stat_specific, unit=phrase
"first clause"              → first_n, count=1, unit=clause
"phrases 2 through 5"      → phrase_range
```

---

## WS2: KEYWORD COUNTER — Verbatim Search & Counting

### Problem
User asks "how many times does 'neural network' appear?" or "count occurrences of 'data'" — the agent can search but can't count or return all positions in a structured way.

### Current State
`getExactQuoteAll` already does multi-match search but:
- No dedicated mode for "count occurrences"
- No case-sensitivity toggle
- No regex search support
- No word-boundary awareness ("data" shouldn't match "database")

### Solution
New modes in inferMode + enhanced getExactQuoteAll.

### New Modes
```
"how many times"    + searchText  → count_occurrences
"count occurrences" + searchText  → count_occurrences
"frequency of"      + searchText  → count_occurrences
"how often"         + searchText  → count_occurrences
```

### Enhanced getExactQuoteAll Options
```typescript
interface SearchOptions {
  caseSensitive?: boolean;     // default false
  wholeWord?: boolean;         // default false (match word boundaries)
  maxResults?: number;         // cap results (default 100)
  includeContext?: boolean;    // include surrounding text (default true)
  contextChars?: number;       // chars of context (default 50)
}
```

### InferMode Patterns
```typescript
// "how many times does X appear" / "how often is X mentioned"
const countMatch = text.match(
  /(?:how\s+many\s+times?|how\s+often|count\s+(?:the\s+)?(?:occurrences?|instances?|mentions?)\s+of|frequency\s+of)\s+['"]?(.+?)['"]?\s*(?:in\s+(?:the\s+)?(?:document|doc|file|paper|it))?\s*[?.]?$/i
);
if (countMatch) {
  return { mode: "count_occurrences", searchText: cleanSearchText(countMatch[1]) };
}
```

### Handler Response Format
```
Found 7 occurrences of "neural network":
1. Line 3, sentence 2: "...the neural network architecture..."
2. Line 8, sentence 5: "...training the neural network on..."
3. Line 15, sentence 12: "...a recurrent neural network model..."
[...]
Total: 7 occurrences across 5 sentences, 4 paragraphs.
```

---

## WS3: WEB PAGE PROCESSOR — HTML Extraction + PDF Link Discovery + Auto-Download

### Problem
When a user gives a webpage URL (e.g., an arXiv abstract page), the agent:
1. Gets HTML instead of the paper content
2. Can't find PDF links on the page
3. Can't auto-download the PDF
4. Can't extract text from PDFs

### Solution
Three-stage pipeline: `WebPageProcessor` service.

### New Files
```
src/services/WebPageProcessor.ts       — HTML→text, link extraction, PDF download
src/services/WebPageProcessor.types.ts — types
src/services/PdfExtractor.ts           — PDF→text extraction
tests/WebPageProcessor.test.ts         — unit tests
tests/PdfExtractor.test.ts             — unit tests
```

### Dependencies (to add to package.json)
```json
{
  "linkedom": "^0.16.x",       // Lightweight DOM parser (no native deps, unlike jsdom)
  "unpdf": "^0.12.x"           // Serverless PDF.js wrapper — text + link extraction
}
```

**Why these choices:**
- `linkedom` over `jsdom`: ~10x faster, no native compilation, works in Bun
- `unpdf` over `pdf-parse`: modern, pure TS, serverless-compatible, extracts links too
- Both are zero-native-dependency which matches ElizaOS deployment model

### WebPageProcessor.ts Design

```typescript
import { parseHTML } from 'linkedom';

interface ExtractedPage {
  title: string;
  text: string;              // Clean article text (nav/footer stripped)
  links: PageLink[];         // All links found
  pdfLinks: PageLink[];      // Filtered: only PDF links
  documentLinks: PageLink[]; // PDFs + DOCs + other downloadable docs
  metadata: {
    description?: string;
    author?: string;
    publishedDate?: string;
    doi?: string;
  };
}

interface PageLink {
  href: string;
  text: string;             // Anchor text
  type: 'pdf' | 'doc' | 'html' | 'unknown';
  context: string;          // Surrounding text for disambiguation
}

export class WebPageProcessor {
  async extractFromHtml(html: string, baseUrl: string): Promise<ExtractedPage>;
  findDocumentLinks(page: ExtractedPage, baseUrl: string): PageLink[];
  async downloadAndExtractPdf(pdfUrl: string, httpService: HttpService): Promise<{text: string; pageCount: number; metadata: PdfMetadata}>;
  async processUrl(url: string, httpService: HttpService): Promise<ProcessedDocument>;
}
```

### Content Extraction Algorithm (HTML → Clean Text)
```
1. Parse HTML with linkedom
2. Remove: <script>, <style>, <nav>, <footer>, <header>, <aside>, <iframe>
3. Remove: elements with class/id matching: nav, menu, sidebar, footer,
   cookie, banner, ad, popup, modal, social, share, comment
4. Extract: <article> or <main> content (if exists)
5. Fallback: largest <div> by text content length
6. Convert remaining to text:
   - <h1>-<h6> → "# " prefix with level markers
   - <p> → paragraph break (\n\n)
   - <br> → newline
   - <li> → "- " prefix
   - <a> → preserve text, collect href
   - <table> → basic text table format
   - <blockquote> → "> " prefix
7. Collapse excessive whitespace
8. Extract metadata from <meta> tags (og:title, description, author, citation_doi)
```

### PDF Link Discovery Patterns
```typescript
const PDF_LINK_PATTERNS = [
  /\.pdf(\?.*)?$/i,
  /arxiv\.org\/pdf\//i,
  /arxiv\.org\/e-print\//i,
  /\/download\b.*pdf/i,
  /\/fulltext\b.*pdf/i,
  /doi\.org\/.*\/pdf/i,
  /pmc\.ncbi.*\.pdf/i,
  /sciencedirect.*\/pdf/i,
];

const PDF_TEXT_PATTERNS = [
  /download\s*(as\s*)?pdf/i,
  /full\s*text\s*\(pdf\)/i,
  /pdf\s*version/i,
  /view\s*pdf/i,
  /get\s*pdf/i,
];
```

### PdfExtractor.ts Design
```typescript
import { extractText, getDocumentProxy, extractLinks } from 'unpdf';

export class PdfExtractor {
  async extractText(buffer: Buffer): Promise<{
    text: string;
    pages: string[];
    pageCount: number;
    metadata: PdfMetadata;
    links: string[];
  }>;
}
```

---

## WS4: SCIENTIFIC SECTIONS — Named Section Retrieval

### Problem
User says "show me the abstract" or "what's in the conclusion" — agent has no concept of scientific document sections.

### Solution
`ScientificSectionDetector` that identifies standard sections in extracted text.

### New Files
```
src/services/ScientificSectionDetector.ts  — section detection
tests/ScientificSectionDetector.test.ts    — unit tests
```

### Standard Sections (ordered)
```typescript
const SECTION_PATTERNS: Record<string, RegExp[]> = {
  title:          [/^(.{10,300})$/m],
  abstract:       [/^#+?\s*abstract\b/im, /\babstract[:\s]*\n/im],
  keywords:       [/^#+?\s*keywords?\b/im],
  introduction:   [/^#+?\s*(?:\d+\.?\s*)?introduction\b/im],
  background:     [/^#+?\s*(?:\d+\.?\s*)?(?:background|related\s+work)\b/im],
  methods:        [/^#+?\s*(?:\d+\.?\s*)?(?:methods?|methodology|materials?\s+and\s+methods?)\b/im],
  results:        [/^#+?\s*(?:\d+\.?\s*)?results?\b/im],
  discussion:     [/^#+?\s*(?:\d+\.?\s*)?discussion\b/im],
  conclusion:     [/^#+?\s*(?:\d+\.?\s*)?conclusions?\b/im],
  acknowledgments: [/^#+?\s*acknowledg(?:e)?ments?\b/im],
  references:     [/^#+?\s*(?:references?|bibliography|works?\s+cited)\b/im],
  appendix:       [/^#+?\s*appendi(?:x|ces)\b/im],
};
```

### New InferMode Patterns
```
"show me the abstract"              → section, sectionName="abstract"
"what's in the conclusion"          → section, sectionName="conclusion"
"read the methods section"          → section, sectionName="methods"
"what sections does it have"        → section_list
"what does the abstract say about X"→ section_search
```

---

## WS5: INFERMODE HARDENING — Compound Requests & Edge Cases

### Problem
"Give me the first and third sentences" fails because inferMode only extracts ONE pattern per message.

### Fix: Compound Request Detection
```typescript
function detectCompound(text: string): CompoundRequest {
  // "first and third sentences" → [nth(1,sentence), nth(3,sentence)]
  // "sentences 1, 3, and 5"    → [nth(1,sentence), nth(3,sentence), nth(5,sentence)]
}
```

### Fix: Refactored Validate
Replace single massive regex with categorized pattern checks for maintainability.

---

## WS6: INTEGRATION + TESTS + HEARTBEAT

### Test Matrix (12 critical tests)
| Input | Expected |
|-------|----------|
| "first sentence" | Sentence 1 only |
| "third sentence" | Sentence 3 only |
| "first and third sentences" | Sentences 1 and 3 |
| "how many times does 'data' appear" | Count + positions |
| "show me the abstract" | Abstract text |
| "what sections does it have" | List of sections |
| "how many phrases" | Phrase count |

---

## CLI EXECUTION COMMAND

```powershell
cd C:\Users\kidco\dev\eliza\plugin-autognostic
claude --dangerously-skip-permissions -p "Read PHASE2-IMPLEMENTATION-PLAN.md and DOCUMENT-ANALYZER-PLAN.md and heartbeat.md for full context. Read CLAUDE.md for identity. Implement all 6 workstreams in order (WS1→WS6). For each workstream: 1) Create new files, 2) Modify existing files, 3) Write tests, 4) Run tests to verify. After all workstreams: run 'bun run build' to verify zero errors, run 'npx vitest run' to verify all tests pass, update heartbeat.md with new verified items. Dependencies to install first: 'bun add linkedom unpdf'. Key files to read before starting: src/services/DocumentAnalyzer.ts, src/actions/getQuoteAction.ts, src/services/ScientificPaperDetector.ts, src/integration/mirrorDocToKnowledge.ts, src/services/httpService.ts. CRITICAL: the 'nth' mode for ordinals like 'third sentence' must return ONLY that sentence, never fall through to full-document dump. Test this explicitly."
```

---

## FILE CHANGE MANIFEST

### New Files (10)
| File | Workstream | Purpose |
|------|------------|---------|
| `src/services/GrammarEngine.ts` | WS1 | Phrase/clause detection |
| `src/services/GrammarEngine.types.ts` | WS1 | Types |
| `src/services/WebPageProcessor.ts` | WS3 | HTML→text, link extraction |
| `src/services/WebPageProcessor.types.ts` | WS3 | Types |
| `src/services/PdfExtractor.ts` | WS3 | PDF→text extraction |
| `src/services/ScientificSectionDetector.ts` | WS4 | Section detection |
| `tests/GrammarEngine.test.ts` | WS1 | Unit tests |
| `tests/WebPageProcessor.test.ts` | WS3 | Unit tests |
| `tests/PdfExtractor.test.ts` | WS3 | Unit tests |
| `tests/ScientificSectionDetector.test.ts` | WS4 | Unit tests |

### Modified Files (8)
| File | Workstream | Changes |
|------|------------|---------|
| `src/actions/getQuoteAction.ts` | WS2,WS4,WS5 | New modes, hardened nth, refactored validate |
| `src/services/DocumentAnalyzer.ts` | WS1 | Import GrammarEngine |
| `src/services/DocumentAnalyzer.types.ts` | WS1,WS4 | New types |
| `src/integration/getExactQuote.ts` | WS2 | Enhanced search options |
| `src/integration/mirrorDocToKnowledge.ts` | WS3,WS4 | HTML/PDF pipeline |
| `src/actions/addUrlToKnowledgeAction.ts` | WS3 | HTML handling |
| `src/config/constants.ts` | WS3 | PDF/webpage defaults |
| `package.json` | WS3 | Dependencies |

---

## SUCCESS CRITERIA

1. `bun run build` — 0 errors
2. `npx vitest run` — all tests pass (existing 147 + new ~40)
3. "give me the first and third sentences" → returns exactly those two sentences
4. "how many times does 'data' appear" → returns count with positions
5. arXiv URL → agent finds PDF, downloads, extracts, stores
6. "show me the abstract" → returns abstract section only
7. heartbeat.md updated
