# Architecture — plugin-autognostic

> For project identity, package info, and permissions, see [CLAUDE.md](../CLAUDE.md).

## Overview

Plugin-autognostic is an ElizaOS v1.x plugin that gives AI agents autonomous knowledge management capabilities. Agents ingest external sources (URLs, GitHub repos), store versioned documents in an embedded PGlite database, and surface them as provider context for conversational retrieval.

## Components

```
src/
├── actions/           # 11 ElizaOS actions (agent-callable operations)
├── auth/              # Authentication middleware
├── config/            # Configuration management
├── db/                # Drizzle ORM schema + repositories
├── errors/            # Typed error system with safeSerialize
├── integration/       # ElizaOS knowledge bridge (mirrorDocToKnowledge)
├── orchestrator/      # Sync coordination (ReconciliationService)
├── providers/         # Data providers for agent context injection
├── publicspace/       # Public API surface
├── services/          # Core business logic (7 services)
└── utils/             # Shared utilities (retry, hashing)
```

### Entry Point

`src/index.ts` — Registers all actions, providers, and services with the ElizaOS runtime as a plugin.

### Service Layer

| Service | Responsibility |
|---------|---------------|
| `AutognosticService` | Main orchestrator — coordinates all CRUD and sync operations |
| `DatabaseSeeder` | Seeds 5-level scientific taxonomy into taxonomy_nodes + controlled_vocab |
| `ScientificPaperDetector` | Crossref API integration — verifies DOIs, fetches metadata |
| `ScientificPaperHandler` | Processes detected papers through Bronze → Silver → Gold pipeline |
| `ScheduledSyncService` | Cron-based source refresh (node-cron) |
| `githubService` | GitHub API client (@octokit/rest) for repo source sync |
| `httpService` | Generic HTTP fetcher for URL-based sources |

### Action Layer

All actions follow the ElizaOS Action interface. **Critical pattern:** every handler must call `callback()` before returning (see [Known Issues](./known-issues.md#issue-001)).

| Action | Trigger |
|--------|---------|
| `addUrlToKnowledge` | User shares a URL to ingest |
| `getQuote` | User requests a direct quote from stored docs |
| `listDocuments` | User asks what's in the knowledge base |
| `listSources` | User asks about registered sources |
| `mirrorSourceToKnowledge` | User wants to sync a source into ElizaOS knowledge |
| `refreshSource` | User triggers manual source re-sync |
| `removeDocument` | User removes a specific document |
| `removeSource` | User removes a source and its documents |
| `setAutognosticRefreshPolicy` | User configures refresh schedule |
| `setAutognosticSizePolicy` | User configures storage limits |
| `setVersionTracking` | User toggles version history for a source |

## Data Flow

```
User message → ElizaOS runtime → Action.validate() → Action.handler()
                                                         ↓
                                              AutognosticService
                                                   ↓         ↓
                                            PGlite DB    External APIs
                                          (Drizzle ORM)  (Crossref, GitHub, HTTP)
                                                   ↓
                                          callback({ text, action })
                                                   ↓
                                          ElizaOS sends response to user
```

### Dual Storage Strategy

1. **PGlite (primary)** — Embedded PostgreSQL for standalone, zero-config operation
2. **Remote PostgreSQL (optional)** — For multi-agent sync via `$POSTGRES_URL`

Both use the same Drizzle ORM schema in the `autognostic` PostgreSQL schema namespace.

## External Dependencies

| Dependency | Purpose | Connection |
|------------|---------|------------|
| Crossref API | Paper DOI verification + metadata | HTTPS, rate-limited 50 req/s |
| GitHub API | Repo content sync | HTTPS via `$GITHUB_TOKEN` |
| ElizaOS Knowledge | Bridge plugin docs into agent memory | In-process via `@elizaos/plugin-knowledge` |

## Key Files

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Plugin entry point, registration |
| `src/schema.ts` | Re-exports DB schema for plugin consumers |
| `src/db/schema.ts` | Drizzle ORM table definitions (12 tables) |
| `src/services/AutognosticService.ts` | Main orchestration service |
| `src/orchestrator/ReconciliationService.ts` | Source ↔ document sync reconciliation |
| `src/integration/mirrorDocToKnowledge.ts` | ElizaOS knowledge bridge |
| `src/errors/` | Typed error classes + `safeSerialize` |
