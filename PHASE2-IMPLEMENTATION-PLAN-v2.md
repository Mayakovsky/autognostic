# PHASE 2 IMPLEMENTATION PLAN v2 — plugin-autognostic
## IRL Testing Feedback Integration + Feature Expansion
> Generated: 2026-02-15
> Revision: v2 (audit pass — redundancies, conflicts, logic errors resolved)
> Target: Claude Code CLI (Mayakovsky)

---

## V1 → V2 AUDIT FINDINGS

### CONFLICTS IDENTIFIED AND RESOLVED

**C1: "the conclusion" regex collision (CRITICAL)**
Existing inferMode P7 catches `/\bconclusion\b/` → `last_paragraph`. WS4 wants "the conclusion" → `section(conclusion)`. Direct conflict. In a scientific paper, "the conclusion" means the Conclusion *section*, not the last paragraph.
→ **Fix:** Section keywords take priority. Insert section detection at P5.5, before P7. Remove `conclusion` from the P7 pattern. P7 only catches `last/final paragraph` and `end of`.

**C2: `sectionProfile` doesn't belong in DocumentProfile (DESIGN)**
v1 stored SectionProfile in the JSONB profile column. Bloats the column — section data can be >10KB. Only relevant for scientific papers.
→ **Fix:** Compute sections lazily in-memory during handler calls. Never persist to DB.

**C3: GrammarEngine phrase/clause storage in DocumentProfile (PERF)**
v1 stored `phrases?: PhraseBoundary[]` in profile. For 20K sentences × 3 phrases = 60K entries = multi-MB JSONB.
→ **Fix:** Compute on-demand from existing `profile.sentences`. Zero DB impact.

**C4: `addUrlToKnowledgeAction` handler modification (RISKY)**
v1 modified the action handler for HTML/PDF. But this handler already has complex auth + paper detection + error handling.
→ **Fix:** HTML→PDF pipeline goes in `mirrorDocToKnowledge` — the single content-fetch layer. Action handler untouched.

**C5: `linkedom` vs existing HTML detection (REDUNDANT)**
`getRawText()` already returns `isHtml: boolean`. Adding linkedom creates dual detection.
→ **Fix:** Use existing `isHtml` flag as trigger. Only invoke linkedom *after* HTML already detected.

**C6: `unpdf` Bun compatibility (RISK)**
`unpdf` latest uses PDF.js v5.x requiring `Promise.withResolvers` (Node ≥22). Bun support unclear.
→ **Fix:** Pin `unpdf@0.11.5` (PDF.js v4.x). No `Promise.withResolvers`. Bun-safe.

**C7: Compound request → multiple ActionResults (ARCHITECTURE)**
ElizaOS handlers return a single ActionResult. v1 implied multiple returns.
→ **Fix:** Compound returns ONE ActionResult with combined text and multi-item data.

**C8: `count_occurrences` duplicates `search_all` (REDUNDANT)**
`search_all` already returns `totalCount`. Only difference is response format.
→ **Fix:** Add `countOnly` flag to `InferredMode`. Reuse `search_all` code path with compact formatting.

**C9: Test breakage: "the conclusion → last_paragraph"**
Existing test expects this mapping. Section routing changes it.
→ **Fix:** Update test to expect `section(conclusion)`.

**C10: New modes missing from `parameters.mode.enum`**
The LLM reads the enum to know valid modes. New modes must be listed.
→ **Fix:** Add `section`, `section_list`, `section_search`, `compound` to enum, similes, and description.

### REDUNDANCIES REMOVED

**R1:** Eliminated 4 separate `.types.ts` files → types inline in service files. Only existing `DocumentAnalyzer.types.ts` kept.
**R2:** Merged WS2 (KeywordCounter) into WS4 — it's just a regex pattern + response format change.
**R3:** Dropped `PdfExtractor.extractStructured` — unreliable font-size heuristics. Use `ScientificSectionDetector` on plain text instead.

### LOGIC ERRORS FIXED

**L1:** "first paragraph" won't collide with sections — "paragraph" is not a section name. Documented.
**L2:** "what's the conclusion" hit `implicit_end` (P9) before sections. Fixed: section detection at P5.5 catches it first. P9 reduced to only `what's the ending` pattern.
**L3:** Provider inventory doesn't mention section retrieval capability. Fixed: added to instructions.
**L4:** `nth` mode mutates `inferred.mode` and falls through instead of returning. Fixed: every branch returns immediately.

---

## REVISED ARCHITECTURE — 4 Workstreams

```
WS1: GrammarEngine         — phrase/clause detection (on-demand, no DB)
WS2: WebPageProcessor      — HTML→text, PDF link discovery, PDF extraction
WS3: ScientificSections    — section detection (on-demand, no DB)
WS4: InferMode Hardening   — section routing, compound, counting, nth fix, validate refactor
```

---

## WS1: GRAMMAR ENGINE

Distinguish phrases/clauses within sentences. Computed on-demand from existing profile.sentences. Never stored.

### New Files
```
src/services/GrammarEngine.ts    — detection + types (no separate types file)
tests/GrammarEngine.test.ts
```

### Design
```typescript
export interface PhraseBoundary {
  index: number;
  sentenceIndex: number;
  start: number;           // char offset relative to sentence start
  end: number;
  text: string;
  wordCount: number;
}

export interface ClauseBoundary {
  index: number;
  sentenceIndex: number;
  start: number;
  end: number;
  text: string;
  type: 'independent' | 'dependent';
  wordCount: number;
}

// Phrases: split on commas, semicolons, colons, em-dashes
// Exceptions: commas inside quotes, parentheses, between digits
export function detectPhrases(sentenceText: string, sentenceIndex: number): PhraseBoundary[];

// Clauses: split on subordinating conjunctions (although, because, while, when, if,
// since, unless, after, before, until) and coordinating conjunctions preceded by comma
// Each clause must contain ≥2 words.
export function detectClauses(sentenceText: string, sentenceIndex: number): ClauseBoundary[];

// Aggregate counts across all sentences
export function countPhrases(sentences: SentenceBoundary[]): number;
export function countClauses(sentences: SentenceBoundary[]): number;
```

No changes to DocumentProfile. No changes to schema.

---

## WS2: WEB PAGE PROCESSOR + PDF EXTRACTOR

### New Files
```
src/services/WebPageProcessor.ts   — HTML→text + link discovery (types inline)
src/services/PdfExtractor.ts       — PDF→text via unpdf
tests/WebPageProcessor.test.ts
tests/PdfExtractor.test.ts
```

### Dependencies
```bash
bun add linkedom unpdf@0.11.5
```

### WebPageProcessor.ts
```typescript
import { parseHTML } from 'linkedom';

export interface PageLink {
  href: string; text: string; type: 'pdf' | 'doc' | 'html' | 'unknown';
}

export interface ExtractedPage {
  title: string; text: string; links: PageLink[]; pdfLinks: PageLink[];
  metadata: { description?: string; author?: string; doi?: string; citationPdfUrl?: string; };
}

export class WebPageProcessor {
  extractFromHtml(html: string, baseUrl: string): ExtractedPage;
  findBestPdfLink(page: ExtractedPage): PageLink | null;
}
```

Content extraction: remove script/style/nav/footer/aside → prefer article/main → convert to text.
PDF link priority: citation_pdf_url meta > .pdf hrefs > anchor text patterns > arXiv abs→pdf construction.

### PdfExtractor.ts
```typescript
import { extractText, getDocumentProxy } from 'unpdf';

export interface PdfExtractionResult {
  text: string; pageCount: number;
  metadata: { title?: string; author?: string; subject?: string; };
}

export class PdfExtractor {
  async extract(buffer: Buffer | Uint8Array): Promise<PdfExtractionResult>;
}
```

### Integration: mirrorDocToKnowledge.ts (NOT addUrlToKnowledgeAction)
After existing `getRawText()` call:
```typescript
if (result.isHtml && !rawUrl.endsWith(".html")) {
  const processor = new WebPageProcessor();
  const extracted = processor.extractFromHtml(result.content, rawUrl);
  const pdfLink = processor.findBestPdfLink(extracted);
  if (pdfLink) {
    const pdfRes = await http.get(pdfLink.href);
    if (pdfRes.ok) {
      const extractor = new PdfExtractor();
      const pdfResult = await extractor.extract(Buffer.from(await pdfRes.arrayBuffer()));
      content = pdfResult.text;
      contentType = "text/plain";
    }
  } else {
    content = extracted.text;
    contentType = "text/plain";
  }
}
```

---

## WS3: SCIENTIFIC SECTION DETECTOR

### New Files
```
src/services/ScientificSectionDetector.ts   — detection + types
tests/ScientificSectionDetector.test.ts
```

### Design
```typescript
export interface DocumentSection {
  name: string;           // canonical: "abstract", "introduction", etc.
  displayName: string;    // as found: "1. Introduction", "## Methods"
  startLine: number;      // 1-based
  endLine: number;
  text: string;
  wordCount: number;
}

export interface SectionProfile {
  isScientificFormat: boolean;  // true if ≥3 recognized sections
  sections: DocumentSection[];
  sectionNames: string[];       // ordered list
}

export const SECTION_NAMES = new Set([
  'abstract', 'introduction', 'background', 'literature',
  'methods', 'methodology', 'results', 'discussion',
  'conclusion', 'conclusions', 'acknowledgments', 'acknowledgements',
  'references', 'bibliography', 'appendix', 'supplementary', 'keywords',
]);

export function detectSections(text: string): SectionProfile;
export function normalizeSectionName(heading: string): string | null;
```

Detection: scan lines for heading patterns (markdown #, numbered "1.", ALL CAPS, standalone short lines matching SECTION_NAMES). Each section runs from its heading to the line before the next. Special case: infer unlabeled abstract from first short block before first heading.

Computed lazily in handler. Never stored in DB.

---

## WS4: INFERMODE HARDENING

All mode detection changes consolidated here.

### 4A. Section routing — insert at Priority 5.5
```typescript
const SECTION_KW = /(abstract|introduction|background|methods?|methodology|results?|discussion|conclusions?|references?|bibliography|acknowledg\w*|appendix|supplementary|keywords?|literature)/i;

// "show me the abstract", "read the methods", "the conclusion"
const sectionMatch = text.match(
  new RegExp(`(?:show\\s+(?:me\\s+)?(?:the\\s+)?|read\\s+(?:the\\s+)?|what(?:'s|\\s+is)\\s+(?:in\\s+)?(?:the\\s+)?|the\\s+)(${SECTION_KW.source})(?:\\s+(?:section|part))?`, 'i')
);
if (sectionMatch) {
  const name = normalizeSectionName(sectionMatch[1]);
  if (name) return { mode: "section", sectionName: name };
}
```

Modify P7: remove `conclusion` from last_paragraph trigger.
Modify P9: remove `conclusion` from implicit_end trigger.

### 4B. Compound request detection
```typescript
// "first and third sentences" → compound [nth(1), nth(3)]
// Handler assembles one combined response.
```

### 4C. Keyword counting — reuse search_all with countOnly flag
```typescript
// "how many times does X appear" → search_all + countOnly=true
// Compact response: count + line summary
```

### 4D. Nth mode — fix fallthrough, every branch returns immediately

### 4E. Update mode enum, similes, description, validate regex

### 4F. Provider inventory — add section and frequency capabilities

---

## FILE CHANGE MANIFEST

### New Files (6)
| File | WS |
|------|-----|
| `src/services/GrammarEngine.ts` | 1 |
| `src/services/WebPageProcessor.ts` | 2 |
| `src/services/PdfExtractor.ts` | 2 |
| `src/services/ScientificSectionDetector.ts` | 3 |
| `tests/GrammarEngine.test.ts` | 1 |
| `tests/ScientificSectionDetector.test.ts` | 3 |

### Modified Files (6)
| File | WS | Changes |
|------|-----|---------|
| `src/actions/getQuoteAction.ts` | 4 | Section routing, compound, counting, nth fix, validate, enum |
| `src/integration/mirrorDocToKnowledge.ts` | 2 | HTML→PDF pipeline |
| `src/providers/fullDocumentProvider.ts` | 4 | Updated instructions |
| `src/config/constants.ts` | 2 | PDF/webpage defaults |
| `package.json` | 2 | linkedom, unpdf@0.11.5 |
| `tests/inferMode.test.ts` | 4 | Updated expectations, new tests |

### Untouched (v1 mistakes corrected)
- `src/services/DocumentAnalyzer.ts` — no changes needed
- `src/services/DocumentAnalyzer.types.ts` — no schema changes
- `src/integration/getExactQuote.ts` — search_all unchanged
- `src/actions/addUrlToKnowledgeAction.ts` — untouched

---

## CLI COMMAND

```powershell
cd C:\Users\kidco\dev\eliza\plugin-autognostic
claude --dangerously-skip-permissions -p "Read PHASE2-IMPLEMENTATION-PLAN-v2.md for the complete spec. Read heartbeat.md and CLAUDE.md for context and identity. Implement 4 workstreams in order (WS1→WS4). CRITICAL RULES: 1) GrammarEngine computes on-demand, NOTHING stored in DocumentProfile or DB. 2) HTML/PDF pipeline goes in mirrorDocToKnowledge.ts, NOT addUrlToKnowledgeAction.ts. 3) Section detection computed lazily in handler, NOT stored in DB. 4) No new 'count_occurrences' mode — use search_all with countOnly flag on InferredMode. 5) Compound requests return ONE ActionResult with combined text. 6) Pin unpdf@0.11.5 for Bun compat. 7) Fix nth mode paragraph/line — every branch must return respond() immediately, no mode mutation fallthrough. 8) Section routing at Priority 5.5 BEFORE last_paragraph at P7. Remove 'conclusion' from P7 and P9 patterns. 9) Update existing test 'the conclusion → last_paragraph' to expect 'section'. Install deps first: 'bun add linkedom unpdf@0.11.5'. After all WS: bun run build (0 errors), npx vitest run (all pass), update heartbeat.md."
```

---

## SUCCESS CRITERIA

1. `bun run build` — 0 errors
2. `npx vitest run` — all pass (existing ~147 + new ~25)
3. "first and third sentences" → exactly those two sentences
4. "how many times does 'data' appear" → count with line summary
5. arXiv abstract URL → resolves PDF, downloads, extracts, stores
6. "show me the abstract" → abstract section only
7. "the conclusion" → conclusion section (not last paragraph)
8. "third sentence" → exactly sentence 3 (never full doc)
9. `addUrlToKnowledgeAction.ts` — zero modifications
10. Database schema — zero new columns
11. heartbeat.md updated
