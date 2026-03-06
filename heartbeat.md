# HEARTBEAT — plugin-autognostic
> Last updated: 2026-03-06 14:48 (local)
> Updated by: Claude Opus 4.6 — Phase 4 WS-3 OpenAlex search
> Session label: Phase 4 WS-3 implementation — SEARCH_PAPERS action
> Staleness gate: 2026-03-06 — if today is >3 days past this,
>   verify state before acting (see Section 3 of SeshMem schema).

## Focus (1-3 goals, testable)
- [x] Phase 2 WS1-WS4: GrammarEngine, WebPageProcessor, PdfExtractor, ScientificSectionDetector, inferMode hardening
- [x] Audit entire ingestion pipeline (URL→fetch→parse→store→retrieve) — root cause analysis complete
- [x] **Phase 3: Execute PHASE3_PLAN.md** — ContentResolver, simplified mirrorDoc, build canary, WebPageProcessor hardening
- [ ] **Phase 4: Discovery layer** — Unpaywall OA resolver, Semantic Scholar search, OpenAlex metadata (see research below)

## What Works (verified)
- ✅ Build (`bun run build`) — 0 errors — verified 2026-03-06
- ✅ Tests (`npx vitest run`) — 449/449 pass across 22 test files — verified 2026-03-06
- ✅ Unpaywall OA resolver: DOI → free PDF URL via api.unpaywall.org — verified 2026-02-19
- ✅ Unpaywall wired into ADD_URL_TO_KNOWLEDGE: DOI URLs auto-resolve to OA PDF before ingestion — verified 2026-02-19
- ✅ Unpaywall wired into ContentResolver: fallback for unstructured HTML pages with DOIs — verified 2026-02-19
- ✅ Semantic Scholar service: lookupPaper, getRelatedPapers, getCitations, getReferences — verified 2026-02-19
- ✅ FIND_RELATED_PAPERS action: mode inference (related/citations/references), identifier extraction (DOI/arXiv/S2 URL) — verified 2026-02-19
- ✅ OpenAlex service: searchWorks (topic search + filters), getWork (single lookup), abstract reconstruction from inverted index — verified 2026-03-06
- ✅ SEARCH_PAPERS action: topic-based search, OA/year/sort filter inference from text, numbered results with OA emoji, NO auto-ingestion — verified 2026-03-06
- ✅ Build canary: plugin logs `Phase 3, built <timestamp>` on startup — verified 2026-02-17
- ✅ ContentResolver: unified URL→text pipeline, routes on response content-type — verified 2026-02-17
- ✅ PDF magic byte verification: dual gate (content-type + %PDF header) — verified 2026-02-17
- ✅ HTML quality gate: prefer structured HTML (≥3 headings, >5K chars) over PDF — verified 2026-02-18
- ✅ normalizePdfText: section headers placed on own lines (Patterns 1-5: colon, post-punct, Abstract, numbered+punct, numbered+word ALL CAPS) — verified 2026-02-18
- ✅ ScientificSectionDetector: singular→plural CANONICAL mappings + summary/overview→abstract aliases — verified 2026-02-18
- ✅ ScientificSectionDetector: post-references heading filter (prevents false matches in reference text) — verified 2026-02-18
- ✅ ScientificSectionDetector: long-preamble abstract inference (searches for "Abstract" keyword in >3000-char preambles) — verified 2026-02-18
- ✅ Section fallback: "summary"/"overview" → abstract, with first-paragraph fallback when no abstract detected — verified 2026-02-18
- ✅ arXiv PDF e2e: 39,976 chars, 6 sections detected (abstract inferred, 1 INTRODUCTION, 3 RELATED WORK, 6 METHODS, 7 RESULTS, REFERENCES) — verified 2026-02-18
- ✅ Accept header strategy: PDF-first for academic publisher URLs — verified 2026-02-17
- ✅ mirrorDocToKnowledge simplified: uses ContentResolver, ~180 lines deleted — verified 2026-02-17
- ✅ WebPageProcessor hardening: publisher selectors, reference whitelist, 500K length guard — verified 2026-02-17
- ✅ WebPageProcessor: JUNK_CLASS_PATTERN uses token-aware matching (layout modifiers like `l-with-sidebar` no longer false-positive) — verified 2026-02-18
- ✅ Springer URL e2e: 43,857 chars extracted, 29 markdown headings, section queries work (abstract, conclusion) — verified 2026-02-18
- ✅ Diagnostic logging: logger.child() in mirrorDocToKnowledge, diagnostics array in ContentResolver — verified 2026-02-17
- ✅ GrammarEngine: phrase/clause detection on-demand from sentences — verified 2026-02-16
- ✅ WebPageProcessor: HTML→text extraction via linkedom, PDF link discovery — verified 2026-02-16
- ✅ PdfExtractor: PDF→text via unpdf@0.11.0 (Bun-safe) — verified 2026-02-16
- ✅ ScientificSectionDetector: section detection (markdown, numbered, ALL CAPS, inferred abstract) — verified 2026-02-16
- ✅ Section routing: "the conclusion" → section(conclusion), "show me the abstract" → section(abstract) — verified 2026-02-16
- ✅ Compound requests: "first and third sentences" → combined response — verified 2026-02-16
- ✅ Keyword counting: "how many times does X appear" → search_all with countOnly — verified 2026-02-16
- ✅ Nth mode fix: every branch returns immediately, no fallthrough to full-doc — verified 2026-02-16
- ✅ Direct Ollama embedding (768 dims via REST API bypass) — verified 2026-02-12
- ✅ Real agent (autognostic-agent/) loads plugin via `file:` dependency — verified 2026-02-12
- ✅ Atlas character routes ADD_URL_TO_KNOWLEDGE correctly — verified 2026-02-12
- ✅ GET_EXACT_QUOTE fires and returns document content — verified 2026-02-12
- ✅ GET_EXACT_QUOTE section isolation: 8/8 e2e tests pass (abstract, conclusion, introduction, nonexistent section, nth, range, search, compound) — verified 2026-02-19
- ✅ Validate regex: British spelling "acknowledgements" now matched via `acknowledg\w+` — verified 2026-02-19
- ✅ Session API: messaging routes at `/api/messaging/sessions` — verified 2026-02-19
- ✅ DocumentAnalyzer service: sentence/paragraph/line profiling — verified 2026-02-13
- ✅ Profile stored at ingest via mirrorDocToKnowledge — verified 2026-02-13
- ✅ Provider inventory shows word/sentence/paragraph counts + section capabilities — verified 2026-02-16

## What's Broken
- 🟢 ~~Springer URL ingestion produces garbage text~~ — FIXED: JUNK_CLASS_PATTERN false positive on `l-with-sidebar` stripped 54K-char content div; replaced regex `\b` with token-aware segment matching
- 🟢 ~~mirrorDocToKnowledge has duplicated pipeline~~ — FIXED: rewritten to use ContentResolver (~180 lines deleted)
- 🟢 ~~URL routing uses file extension instead of response content-type~~ — FIXED: ContentResolver routes on response content-type exclusively
- 🟢 ~~PDF paywall detection relies only on content-type header~~ — FIXED: dual gate requires both content-type AND %PDF magic bytes
- 🟢 ~~Validate regex missed British "acknowledgements" spelling~~ — FIXED: `acknowledgments?` → `acknowledg\w+` in validate regex

## Phase 3 Execution Summary
All 6 workstreams completed in order. 309 tests pass (272 original + 37 new). Zero regressions.

| WS | Commit | Description |
|----|--------|-------------|
| WS-1 | 683f6a4 | Build canary: auto-generated buildmeta.ts + startup log |
| WS-2 | bae9945 | ContentResolver + PDF magic bytes (16 tests) |
| WS-3 | 7a4dfc2 | Simplified mirrorDocToKnowledge (deleted ~180 lines) |
| WS-4 | bd3fd3e | WebPageProcessor hardening (publisher selectors, ref whitelist, 500K guard) |
| WS-5 | (folded into WS-3) | Diagnostic logging via logger.child() |
| WS-6 | e8533fe | Academic publisher Accept header test |

## Phase 4 Research: Scientific Clearinghouse APIs (2026-02-18)

### Key Finding
The generic URL pipeline (ContentResolver → WebPageProcessor/PdfExtractor) is already the correct
architecture for **content ingestion**. Every clearinghouse ultimately serves HTML or PDF at a URL.
Building parallel API-specific extraction would duplicate work and add 10 maintenance surfaces.

The APIs are most valuable as a **thin discovery/resolution layer upstream** that produces URLs
the existing pipeline handles. Architecture:

```
User: URL or DOI or search query
         |
         v
  [Discovery Layer] (NEW — Phase 4)
  |  Unpaywall: DOI → free PDF URL
  |  Semantic Scholar: topic → paper URLs + citation graph
  |  OpenAlex: topic → paper URLs + OA locations + metadata
         |
         v
  [Existing Pipeline] (NO CHANGES)
  ContentResolver → WebPageProcessor / PdfExtractor
         |
         v
  ScientificSectionDetector → Knowledge Store
```

### API Comparison (top 10 free sources)

| Source | Papers | Full Text? | PDF Direct? | Key? | Rate Limit | Best Use |
|--------|--------|-----------|-------------|------|-----------|----------|
| **arXiv** | 2.96M | No (API) | Yes (URL pattern) | No | 1 req/3s | Already handled — PDF-first Accept headers |
| **PubMed/PMC** | 39M/10M | Yes (PMC OA XML) | Yes (OA) | Optional | 3-10 req/s | PMC HTML already works via WebPageProcessor |
| **Semantic Scholar** | 215M | No | OA PDF URLs | Optional | 5K/5min | **Discovery**: related papers, citation graph |
| **OpenAlex** | 278-470M | TEI XML (43M) | Yes (60M) | Free key | 100K credits/day | **Search**: broadest catalog, OA locations |
| **CORE** | 431M/40M FT | Yes (in response) | Yes | Yes | 5-10 req/10s | Fallback only (low free-tier limits) |
| **Crossref** | 176M | No | No | No | 50 req/s | **Already integrated** for DOI verification |
| **Unpaywall** | 176M/27M OA | No | OA PDF URLs | No (email) | 100K/day | **Highest ROI**: DOI → free PDF, ~20 lines |
| **DOAJ** | 11M | No | Publisher links | No | 2 req/s | OA journal verification only |
| **Europe PMC** | 46M | Yes (OA XML) | Yes (OA) | No | ~10 req/s | Superset of PubMed, better API ergonomics |
| **bioRxiv/medRxiv** | 335K | No (API) | Yes (URL pattern) | No | ~1 req/s | Already handled — predictable PDF URLs |

### What NOT to build (generic pipeline already handles these)
- arXiv API integration (PDF URLs are predictable, Accept headers already PDF-first)
- bioRxiv/medRxiv API integration (same — predictable PDF URLs)
- Crossref expansion (already integrated for DOI verification)
- CORE API (free tier too limited)
- DOAJ API (low incremental value)

### Phase 4 Workstreams (proposed, ordered by ROI)

**WS-1: Unpaywall OA Resolver** (highest ROI, simplest)
- New service: `UnpaywallResolver.ts`
- Single function: `getOpenAccessUrl(doi: string): Promise<string | null>`
- Calls `https://api.unpaywall.org/v2/{doi}?email={email}` → returns `best_oa_location.url_for_pdf`
- Integration point: when user provides a DOI or paywalled URL, auto-resolve to free PDF
- Already extract DOIs in `ScientificPaperDetector` — wire it up
- ~20-30 lines of core code + tests
- Env var: `UNPAYWALL_EMAIL` (no API key needed, just email)

**WS-2: Semantic Scholar Discovery** (new capability: "find related papers")
- New service: `SemanticScholarService.ts`
- Endpoints: paper lookup by DOI/URL, related papers, citation graph
- New action: `FIND_RELATED_PAPERS` — given ingested paper, suggest related work
- API: `https://api.semanticscholar.org/graph/v1/paper/{id}` (free, optional key for higher limits)
- Returns `openAccessPdf.url` → feed to existing ContentResolver

**WS-3: OpenAlex Search** (new capability: "search for papers by topic")
- New service: `OpenAlexService.ts`
- Endpoints: search works by query, filter by OA status/date/field
- New action: `SEARCH_PAPERS` — find papers matching a topic query
- API: `https://api.openalex.org/works?search={query}` (free key via email)
- Returns OA location URLs → feed to existing ContentResolver
- TEI XML endpoint (`/works/{id}.grobid-xml`) as optional section-structured fast path

**WS-4 (stretch): Europe PMC Full Text** (life sciences fast path)
- Only if WS-1/2/3 prove insufficient for biomedical content
- Full-text XML API bypasses HTML/PDF parsing entirely
- Low priority — PMC HTML pages already work via WebPageProcessor

### Non-API Next Steps (general hardening)
- ~~Verify GET_EXACT_QUOTE returns correct individual sections (not merged)~~ — DONE: 8/8 e2e pass
- Test more diverse PDFs: double-column layouts, supplementary materials, non-English
- Error UX: better messages when URL is paywalled or PDF extraction fails
- Rate limiting / caching for repeated URL fetches

## Next Actions (ordered)
1. ~~Rebuild agent and test live~~ — DONE
2. ~~Start agent, verify build canary~~ — DONE (2026-02-18T01:09:31Z)
3. ~~Test Springer URL end-to-end~~ — DONE: 43,857 chars, 29 headings, abstract + conclusion queries work
4. ~~Test arXiv URL → PDF extraction in live agent~~ — DONE: 39,976 chars, 6 sections detected
5. ~~Verify GET_EXACT_QUOTE returns correct individual sections (not merged)~~ — DONE: 8/8 pass
6. ~~Phase 4 WS-1: Unpaywall OA resolver~~ — DONE: resolveOpenAccess(), wired into action + ContentResolver
7. ~~Phase 4 WS-2: Semantic Scholar discovery~~ — DONE: SemanticScholarService + FIND_RELATED_PAPERS action
8. ~~Phase 4 WS-3: OpenAlex search~~ — DONE: OpenAlexService + SEARCH_PAPERS action
9. **Phase 4 WS-4 (stretch): Europe PMC Full Text** (if needed for biomedical content)

## Session Log (last 5 entries, newest first)
| Date | Agent | What changed | Outcome |
|------|-------|-------------|---------|
| 2026-03-06 | Mayakovsky | feat(phase4): WS-3 OpenAlex search — SEARCH_PAPERS action | 8a78a5a |
| 2026-03-06 | Claude Opus 4.6 | Phase 4 WS-3: OpenAlex search — SEARCH_PAPERS action (57 new tests) | — |
| 2026-02-19 | Mayakovsky | feat(phase4): WS-2 Semantic Scholar discovery — FIND_RELAT | 3e087a8 |
| 2026-02-19 | Claude Opus 4.6 | Phase 4 WS-2: Semantic Scholar discovery — FIND_RELATED_PAPERS action | — |
| 2026-02-19 | Mayakovsky | feat(phase4): WS-1 Unpaywall OA resolver — DOI→free PDF  | 327f3b8 |

## Guardrails (DO / DON'T)
DO:
- Always call `callback()` before returning from action handlers
- Destructure results to primitive fields in `ActionResult.data`
- Build plugin first (`bun run build` in plugin dir), then agent (`bun run build` in agent dir)
- Test in autognostic-agent/ (real agent), NOT plugin test mode (`elizaos dev` in plugin dir)
- Set LOG_LEVEL=debug in agent .env to see ContentResolver diagnostics

DON'T:
- Spread opaque objects into ActionResult.data (causes cyclic serialization)
- Skip callback in handlers (ElizaOS falls back to sendMessage → infinite loop)
- Test in plugin mode — it uses a crippled bundler that produces 5KB stubs
- Put API keys in scaffold scripts or any committed files
- Modify httpService.ts or PdfExtractor.ts

## Quick Commands
```bash
# Build plugin
cd C:\Users\kidco\dev\eliza\plugin-autognostic
bun run build

# Build agent (after plugin build)
cd C:\Users\kidco\dev\eliza\autognostic-agent
bun run build

# Run agent
cd C:\Users\kidco\dev\eliza\autognostic-agent
elizaos dev

# Run plugin tests
cd C:\Users\kidco\dev\eliza\plugin-autognostic
npx vitest run

# Test embeddings
cd C:\Users\kidco\dev\eliza\plugin-autognostic
npx tsx scripts/test-direct-embed.ts

# Reset agent database
cd C:\Users\kidco\dev\eliza\autognostic-agent
Remove-Item -Recurse -Force .\.eliza
```

## Links
- [CLAUDE.md](./CLAUDE.md) — Agent identity + permissions
- [PHASE3_PLAN.md](./PHASE3_PLAN.md) — **Phase 3 v2 ingestion pipeline overhaul spec**
- [PHASE2-IMPLEMENTATION-PLAN-v2.md](./PHASE2-IMPLEMENTATION-PLAN-v2.md) — Phase 2 spec (completed)
- [DOCUMENT-ANALYZER-PLAN.md](./DOCUMENT-ANALYZER-PLAN.md) — Analyzer implementation spec
- [Architecture](./docs/architecture.md)
- [Schema](./docs/schema.md)
- [Decisions](./docs/decisions.md)
- [Known Issues](./docs/known-issues.md)
- [Runbook](./docs/runbook.md)
