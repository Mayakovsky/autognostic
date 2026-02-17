---
description: Execute Phase 3 ingestion pipeline overhaul (6 workstreams)
allowed-tools: Bash(bun:*), Bash(npx:*), Bash(git:*), Bash(node:*), Read, Write, Edit
---

# Phase 3 v2: Ingestion Pipeline Overhaul

Read the plan document at `C:\Users\kidco\dev\eliza\plugin-autognostic\PHASE3_PLAN.md` before doing anything.

## Execution Protocol

1. Read `PHASE3_PLAN.md` completely — pay special attention to GUARDRAILS and the caller contract table in WS-3
2. Execute workstreams IN ORDER (WS-1 through WS-6)
3. After EACH workstream: `cd C:\Users\kidco\dev\eliza\plugin-autognostic && bun run build && npx vitest run` — stop if anything fails
4. Git commit after each green workstream: `git add -A && git commit -m "phase3: WS-N description"`

## Key Rules

- All 272 existing tests MUST stay green — zero regressions
- Do NOT modify: DocumentAnalyzer.ts, ScientificPaperDetector.ts, ScientificPaperHandler.ts, getQuoteAction.ts, GrammarEngine.ts, ScientificSectionDetector.ts, httpService.ts, PdfExtractor.ts
- ContentResolver is PURE — no database access, no IAgentRuntime. Only depends on HttpService, WebPageProcessor, PdfExtractor, ScientificPaperDetector (all stateless)
- mirrorDocToKnowledge return type is FROZEN: `{ knowledgeDocumentId, clientDocumentId, worldId }`
- mirrorDocToKnowledge metadata contract is FROZEN: `sourceId` + `versionId` keys control verbatim storage. ReconciliationService intentionally uses different keys — preserve this
- Route on RESPONSE content-type, never URL extension
- PDF verification requires BOTH content-type header AND %PDF magic bytes
- Accept headers for academic publishers belong in ContentResolver, NOT httpService
- Test fixtures are synthetic inline HTML (20-50 lines each), NOT real scraped pages
- Diagnostics array is always populated; log-level visibility requires LOG_LEVEL=debug

## Start with WS-1

The build canary is BLOCKING. Create buildmeta.template.ts, prebuild script, index.ts import. Build, verify canary prints in agent terminal. If it doesn't print, diagnose before proceeding.

Begin now.
