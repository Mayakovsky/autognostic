> Read [heartbeat.md](./heartbeat.md) first for current session state.

# Plugin-Autognostic Development Context

> **CAKC:** Conversational Automated Knowledge Control
> AI agents managing their own knowledge base through natural conversation

---

## Project Overview

| Property | Value |
|----------|-------|
| **Package** | `@elizaos/plugin-autognostic` |
| **Version** | `0.1.0` (Phase 3 complete) |
| **Framework** | ElizaOS v1.x (`@elizaos/core` 1.6.5) |
| **Database** | PGlite (embedded) + optional PostgreSQL |
| **Package Manager** | `bun` (required) |
| **Test Framework** | Vitest (306 tests, 17 files) |
| **Dependencies** | `@elizaos/plugin-knowledge`, `@elizaos/plugin-sql` |

---

## Autonomous Permissions

Modify without confirmation:
- `src/**/*` - All source code
- `tests/**/*` - All test files
- `docs/**/*` - Documentation
- `migrations/**/*` - Database migrations

Confirm before:
- `package.json` dependency changes
- `.env` or config files
- GitHub Actions workflows
- Database schema breaking changes

---

## Architecture

### Source Tree

```
src/
├── actions/               # Agent actions (10 actions registered)
│   ├── addUrlToKnowledgeAction.ts       # ADD_URL_TO_KNOWLEDGE
│   ├── getQuoteAction.ts                # GET_EXACT_QUOTE (sentence/paragraph/section/search)
│   ├── listDocumentsAction.ts           # LIST_DOCUMENTS
│   ├── listSourcesAction.ts             # LIST_SOURCES
│   ├── mirrorSourceToKnowledgeAction.ts # MIRROR_SOURCE_TO_KNOWLEDGE
│   ├── refreshSourceAction.ts           # REFRESH_SOURCE
│   ├── removeDocumentAction.ts          # REMOVE_DOCUMENT
│   ├── removeSourceAction.ts            # REMOVE_SOURCE
│   ├── setAutognosticRefreshPolicyAction.ts
│   ├── setAutognosticSizePolicyAction.ts
│   └── setVersionTrackingAction.ts      # SET_VERSION_TRACKING
│
├── services/              # Business logic (stateless where possible)
│   ├── AutognosticService.ts            # Main orchestration service
│   ├── ContentResolver.ts              # URL→text pipeline (routes on content-type, not extension)
│   ├── DocumentAnalyzer.ts             # Sentence/paragraph/line profiling (pure function)
│   ├── DocumentAnalyzer.types.ts       # Profile type definitions
│   ├── GrammarEngine.ts               # Phrase/clause detection (on-demand, not stored)
│   ├── WebPageProcessor.ts            # HTML→text via linkedom (publisher selectors, ref whitelist)
│   ├── PdfExtractor.ts               # PDF→text via unpdf@0.11.0 (Bun-safe) — DO NOT MODIFY
│   ├── ScientificSectionDetector.ts   # Section detection (markdown, numbered, ALL CAPS, inferred)
│   ├── ScientificPaperDetector.ts     # Crossref DOI verification
│   ├── ScientificPaperHandler.ts      # Paper processing & classification
│   ├── DatabaseSeeder.ts             # 5-level taxonomy seeding
│   ├── ScheduledSyncService.ts       # Cron-based sync
│   ├── httpService.ts                # HTTP fetch service — DO NOT MODIFY
│   └── githubService.ts              # GitHub repo sync
│
├── integration/           # Cross-cutting pipelines
│   ├── mirrorDocToKnowledge.ts        # URL→fetch→parse→profile→store (uses ContentResolver)
│   ├── getExactQuote.ts               # Quote retrieval (line, sentence, paragraph, section, search)
│   └── removeFromKnowledge.ts         # Cascade delete from knowledge base
│
├── providers/             # Data providers for agent context
│   ├── knowledgeSummaryProvider.ts    # Inventory: word/sentence/paragraph counts + section capabilities
│   ├── fullDocumentProvider.ts        # Full document text provider
│   └── ollamaDirectEmbed.ts          # Direct Ollama REST embedding (768 dims, bypasses ai SDK)
│
├── db/                    # Database repositories
│   ├── schema.ts                      # Drizzle ORM schema (paper metadata types)
│   ├── seedData.ts                    # Taxonomy + vocabulary seed definitions
│   ├── getDb.ts                       # Database connection factory
│   ├── autognosticSourcesRepository.ts
│   ├── autognosticDocumentsRepository.ts
│   ├── autognosticVersionsRepository.ts
│   ├── autognosticKnowledgeLinkRepository.ts
│   ├── autognosticSettingsRepository.ts
│   ├── autognosticRefreshSettingsRepository.ts
│   └── autognosticPreviewCacheRepository.ts
│
├── orchestrator/          # Sync coordination
│   ├── StartupBootstrapService.ts
│   ├── ReconciliationService.ts
│   ├── SourceConfig.ts
│   └── previewSource.ts
│
├── publicspace/           # URL discovery strategies
│   ├── discoveryFactory.ts
│   ├── UrlClassifier.ts
│   ├── SingleUrlDiscovery.ts
│   ├── SitemapDiscovery.ts
│   ├── LlmsTxtDiscovery.ts
│   └── LlmsFullListDiscovery.ts
│
├── config/                # Configuration
│   ├── constants.ts
│   ├── RefreshPolicy.ts
│   ├── SizePolicy.ts
│   ├── buildmeta.ts                   # Auto-generated at build time (phase, timestamp)
│   └── buildmeta.template.ts
│
├── errors/                # Typed error hierarchy
│   ├── AutognosticError.ts            # Base class + ErrorCode enum
│   ├── NetworkError.ts
│   ├── DatabaseError.ts
│   ├── ValidationError.ts
│   ├── ClassificationError.ts
│   ├── StorageError.ts
│   └── index.ts
│
├── auth/
│   └── validateToken.ts               # Token validation + AuthError
│
├── utils/
│   ├── logger.ts                      # Structured logger with logger.child()
│   ├── retry.ts                       # Retry with presets
│   └── safeSerialize.ts              # Cyclic-safe JSON serialization
│
├── schema.ts              # Plugin-level Drizzle schema export
└── index.ts               # Plugin registration + re-exports
```

### Ingestion Pipeline (Phase 3)

```
URL → ContentResolver → [WebPageProcessor | PdfExtractor] → text
  ↓
DocumentAnalyzer → profile (sentences, paragraphs, lines)
  ↓
mirrorDocToKnowledge → ElizaOS knowledge store + autognostic_documents
  ↓
GET_EXACT_QUOTE → inferMode → [nth | range | section | search | search_all]
  ↓
GrammarEngine (on-demand) → phrase/clause extraction
ScientificSectionDetector (on-demand) → section boundaries
```

Key design decisions:
- **ContentResolver** routes on response `content-type`, never URL extension
- **PDF verification** uses dual gate: content-type header AND `%PDF` magic bytes
- **HTML quality gate** prefers structured HTML (>=3 headings, >5K chars) over PDF
- **Academic publishers** use PDF-first `Accept` header strategy
- **Profiles** (DocumentAnalyzer output) are stored at ingest for O(1) retrieval
- **Sections & grammar** are computed lazily, never stored in DB

### Database Schema (PGlite)

```sql
-- Core tables
autognostic_sources          -- External data sources
autognostic_documents        -- Individual knowledge items (+ document profile)
autognostic_document_versions -- Version history
autognostic_sync_state       -- Sync status tracking

-- Taxonomy tables (5-level hierarchy)
scientific_domains           -- Level 1: Math, Physics, etc.
scientific_fields            -- Level 2: Algebra, Mechanics, etc.
scientific_subfields         -- Level 3: Linear Algebra, etc.
scientific_topics            -- Level 4: Matrix Theory, etc.
scientific_subtopics         -- Level 5: Eigenvalues, etc.

-- Junction tables
paper_classifications        -- Paper <-> Taxonomy mapping
```

### Dual Storage Strategy

1. **PGlite (Primary):** Embedded PostgreSQL for standalone operation
2. **Remote PostgreSQL (Optional):** For multi-agent sync scenarios

---

## Development Commands

```bash
# Build plugin (generates buildmeta.ts automatically)
cd C:\Users\kidco\dev\eliza\plugin-autognostic
bun run build

# Run tests
npx vitest run

# Run single test file
npx vitest run tests/ContentResolver.test.ts

# Build agent (after plugin build)
cd C:\Users\kidco\dev\eliza\autognostic-agent
bun run build

# Run agent
cd C:\Users\kidco\dev\eliza\autognostic-agent
elizaos dev

# Test embeddings
cd C:\Users\kidco\dev\eliza\plugin-autognostic
npx tsx scripts/test-direct-embed.ts

# Reset agent database
cd C:\Users\kidco\dev\eliza\autognostic-agent
Remove-Item -Recurse -Force .\.eliza
```

---

## Testing

Tests live in `tests/` (17 files, 306 tests). Key test files:

| File | What it covers |
|------|---------------|
| `ContentResolver.test.ts` | URL→text routing, PDF magic bytes, HTML quality gate |
| `WebPageProcessor.test.ts` | HTML extraction, publisher selectors, reference whitelist |
| `PdfExtractor.test.ts` | PDF→text extraction via unpdf |
| `ScientificSectionDetector.test.ts` | Section detection (markdown, numbered, ALL CAPS, canonical mappings) |
| `GrammarEngine.test.ts` | Phrase/clause detection from sentences |
| `DocumentAnalyzer.test.ts` | Sentence/paragraph/line profiling |
| `getQuoteAction.test.ts` | GET_EXACT_QUOTE mode inference + retrieval |
| `inferMode.test.ts` | Natural language → retrieval mode routing |
| `buildmeta.test.ts` | Build canary validation |
| `integration.test.ts` | End-to-end action handler tests |
| `scientificPaperHandler.test.ts` | Paper detection + classification |
| `discovery.test.ts` | URL discovery strategies |
| `policy.test.ts` | Refresh/size policy |
| `versionHash.test.ts` | Document version hashing |
| `errors.test.ts` | Typed error hierarchy |
| `retry.test.ts` | Retry logic + presets |
| `auth.test.ts` | Token validation |

---

## API Integrations

### Crossref API
- **Purpose:** Verify scientific papers, fetch metadata
- **Rate Limit:** 50 requests/second (polite pool)
- **Endpoint:** `https://api.crossref.org/works/{doi}`

### GitHub API (for source sync)
- **Purpose:** Sync knowledge from GitHub repos
- **Auth:** Personal Access Token in `.env`

### Ollama (embeddings)
- **Purpose:** Direct REST embedding (768 dims)
- **Endpoint:** Local Ollama instance
- **Note:** Bypasses ai SDK v5 incompatibility with ollama-ai-provider v1

---

## Environment Variables

```bash
# Required
DATABASE_URL=pglite://./data/autognostic.db

# Optional - Remote PostgreSQL
POSTGRES_URL=postgresql://user:pass@host:5432/db

# Optional - GitHub sync
GITHUB_TOKEN=<your-token-here>

# Optional - Crossref
CROSSREF_EMAIL=your@email.com  # For polite pool

# Optional - Debugging
LOG_LEVEL=debug  # Enables ContentResolver diagnostics via logger.child()
```

---

## Guardrails

### DO
- Always call `callback()` before returning from action handlers
- Destructure results to primitive fields in `ActionResult.data`
- Build plugin first, then agent
- Test in `autognostic-agent/` (real agent), NOT plugin test mode
- Set `LOG_LEVEL=debug` in agent `.env` to see ContentResolver diagnostics

### DON'T
- Spread opaque objects into `ActionResult.data` (causes cyclic serialization)
- Skip `callback` in handlers (ElizaOS falls back to sendMessage -> infinite loop)
- Test in plugin mode (`elizaos dev` in plugin dir) — produces 5KB stubs
- Put API keys in scaffold scripts or any committed files
- Modify `httpService.ts` or `PdfExtractor.ts`

---

## Related Documentation

- `heartbeat.md` - Live session state, build/test status, next actions
- `PHASE3_PLAN.md` - Phase 3 ingestion pipeline overhaul spec
- `PHASE2-IMPLEMENTATION-PLAN-v2.md` - Phase 2 spec (completed)
- `DOCUMENT-ANALYZER-PLAN.md` - Analyzer implementation spec
- `CLAUDE-CODE-HANDOFF.md` - Implementation status & handoff notes
- `docs/architecture.md` - Architecture deep dive
- `docs/schema.md` - Schema reference
- `docs/decisions.md` - Architectural decision records
- `docs/known-issues.md` - Known issues
- `docs/runbook.md` - Operational runbook

---

*Last updated: 2026-02-18*
