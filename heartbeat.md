# HEARTBEAT — plugin-autognostic
> Last updated: 2026-02-17 16:21 (local)
> Updated by: claude-pro (opus 4.6) — Phase 3 v2 planning
> Session label: Phase 3 v2 — ingestion pipeline overhaul plan
> Staleness gate: 2026-02-17 — if today is >3 days past this,
>   verify state before acting (see Section 3 of SeshMem schema).

## Focus (1-3 goals, testable)
- [x] Phase 2 WS1-WS4: GrammarEngine, WebPageProcessor, PdfExtractor, ScientificSectionDetector, inferMode hardening
- [x] Audit entire ingestion pipeline (URL→fetch→parse→store→retrieve) — root cause analysis complete
- [ ] **Phase 3: Execute PHASE3_PLAN.md** — ContentResolver, simplified mirrorDoc, build canary, WebPageProcessor hardening

## What Works (verified)
- ✅ Build (`bun run build`) — 0 errors — verified 2026-02-16
- ✅ Tests (`npx vitest run`) — 272/272 pass across 15 test files — verified 2026-02-16
- ✅ GrammarEngine: phrase/clause detection on-demand from sentences — verified 2026-02-16
- ✅ WebPageProcessor: HTML→text extraction via linkedom, PDF link discovery — verified 2026-02-16
- ✅ PdfExtractor: PDF→text via unpdf@0.11.0 (Bun-safe) — verified 2026-02-16
- ✅ ScientificSectionDetector: section detection (markdown, numbered, ALL CAPS, inferred abstract) — verified 2026-02-16
- ✅ Section routing: "the conclusion" → section(conclusion), "show me the abstract" → section(abstract) — verified 2026-02-16
- ✅ Compound requests: "first and third sentences" → combined response — verified 2026-02-16
- ✅ Keyword counting: "how many times does X appear" → search_all with countOnly — verified 2026-02-16
- ✅ Nth mode fix: every branch returns immediately, no fallthrough to full-doc — verified 2026-02-16
- ✅ HTML→PDF pipeline in mirrorDocToKnowledge.ts (addUrlToKnowledgeAction untouched) — verified 2026-02-16
- ✅ Direct Ollama embedding (768 dims via REST API bypass) — verified 2026-02-12
- ✅ Real agent (autognostic-agent/) loads plugin via `file:` dependency — verified 2026-02-12
- ✅ Atlas character routes ADD_URL_TO_KNOWLEDGE correctly — verified 2026-02-12
- ✅ GET_EXACT_QUOTE fires and returns document content — verified 2026-02-12
- ✅ DocumentAnalyzer service: sentence/paragraph/line profiling — verified 2026-02-13
- ✅ Profile stored at ingest via mirrorDocToKnowledge — verified 2026-02-13
- ✅ Provider inventory shows word/sentence/paragraph counts + section capabilities — verified 2026-02-16

## What's Broken
- 🔴 **Springer URL ingestion produces garbage text** — WebPageProcessor domToText() fix may not be compiled into dist/ (stale build problem). No way to verify at runtime which plugin version is loaded.
- 🔴 **mirrorDocToKnowledge has duplicated pipeline** — identical ~40-line PDF fallback blocks in two branches (isLikelyText vs else). Bug fixes must be applied twice.
- 🔴 **URL routing uses file extension instead of response content-type** — Springer/academic URLs with no extension fall through to fragile secondary path.
- 🟡 **PDF paywall detection relies only on content-type header** — no magic byte verification. Servers that lie about content-type could poison the knowledge base.

## Phase 3 Plan (PHASE3_PLAN.md — v2)
### Root Causes Identified (2026-02-17 audit)
1. Agent loads stale plugin dist/ — no build timestamp verification
2. mirrorDocToKnowledge routes on URL extension, not response content-type
3. PDF fallback logic duplicated in two branches (~40 lines each)
4. No %PDF magic byte verification — only content-type header check
5. Two callers (addUrlToKnowledgeAction vs ReconciliationService) have different metadata contracts — must preserve

### Workstreams (6 total, execute in order via `/phase3` command)
| WS | Description | Creates/Modifies |
|----|------------|-----------------|
| WS-1 | Build canary (generated buildmeta.ts, gitignored) | buildmeta.ts, buildmeta.template.ts, index.ts, package.json, .gitignore |
| WS-2 | ContentResolver + PDF magic bytes | NEW: ContentResolver.ts, ContentResolver.test.ts |
| WS-3 | Simplify mirrorDocToKnowledge (delete ~120 lines) | REWRITE: mirrorDocToKnowledge.ts |
| WS-4 | WebPageProcessor hardening (publisher selectors, ref whitelist) | EDIT: WebPageProcessor.ts, WebPageProcessor.test.ts |
| WS-5 | Diagnostic logging via logger.child() | EDIT: mirrorDocToKnowledge.ts |
| WS-6 | Integration tests (8 tests, synthetic fixtures) | NEW: ContentResolver.test.ts additions |

### Key Guardrails
- DO NOT modify: DocumentAnalyzer, ScientificPaperDetector, ScientificPaperHandler, getQuoteAction, GrammarEngine, ScientificSectionDetector, httpService, PdfExtractor
- ContentResolver is PURE — no DB, no IAgentRuntime
- mirrorDocToKnowledge return type FROZEN: `{ knowledgeDocumentId, clientDocumentId, worldId }`
- metadata contract FROZEN: `sourceId`+`versionId` triggers verbatim store; ReconciliationService's different keys intentionally skip it
- Accept headers for academic publishers in ContentResolver, NOT httpService

## Next Actions (ordered)
1. **Run `/phase3` in Kovsky** → executes WS-1 through WS-6 per PHASE3_PLAN.md
2. After WS-1: verify build canary prints in agent terminal before proceeding
3. After all WS: test Springer URL end-to-end in live agent
4. After all WS: test arXiv URL → PDF extraction in live agent
5. After all WS: verify GET_EXACT_QUOTE returns real sentences from Springer paper

## Session Log (last 5 entries, newest first)
| Date | Agent | What changed | Outcome |
|------|-------|-------------|---------|
| 2026-02-17 | Mayakovsky | phase3: WS-1 build verification canary | 683f6a4 |
| 2026-02-17 | claude-pro | Phase 3 v2 plan: full pipeline audit, PHASE3_PLAN.md, /phase3 command | plan deployed |
| 2026-02-16 | Mayakovsky | feat: Phase 2 — grammar engine, HTML/PDF pipeline, section | 5d433f6 |
| 2026-02-16 | Mayakovsky | feat: Phase 2 — grammar, web/PDF, sections, inferMode hardening — 272/272 | pending commit |
| 2026-02-15 | Mayakovsky | feat: split stats into stat_specific and stats modes — 214 | ae2a4e8 |

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
- Modify httpService.ts or PdfExtractor.ts during Phase 3

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
