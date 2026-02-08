# Decisions — plugin-autognostic

> Append-only. Never delete — mark superseded.

## DEC-001: PGlite as primary database (2025-01-15)
**Status:** Active
**Context:** Plugin needs an embedded database for standalone operation without external dependencies.
**Options:** 1) SQLite via better-sqlite3 — mature but no PostgreSQL compatibility 2) PGlite — embedded PostgreSQL, same SQL dialect as production
**Decision:** PGlite
**Rationale:** Using PGlite means the same Drizzle ORM schema and queries work for both embedded (dev/standalone) and remote PostgreSQL (multi-agent sync). No dialect translation needed.
**Revisit if:** PGlite proves unstable or ElizaOS drops PGlite support.

## DEC-002: Drizzle ORM for schema management (2025-01-15)
**Status:** Active
**Context:** Need a type-safe ORM that works with both PGlite and PostgreSQL.
**Options:** 1) Raw SQL — simple but no type safety 2) Prisma — heavy, poor PGlite support 3) Drizzle — lightweight, PG-native, type-safe
**Decision:** Drizzle ORM
**Rationale:** Drizzle generates TypeScript types from schema definitions, works natively with PostgreSQL (and PGlite), and has minimal overhead. ElizaOS ecosystem also uses Drizzle.
**Revisit if:** Drizzle drops PGlite adapter or a better alternative emerges.

## DEC-003: Dedicated PostgreSQL schema namespace (2025-01-20)
**Status:** Active
**Context:** Plugin tables must not collide with ElizaOS core tables or other plugins.
**Options:** 1) Prefix all table names (e.g., `autognostic_sources`) 2) Use a dedicated PG schema (`autognostic.sources`)
**Decision:** Dedicated PG schema: `CREATE SCHEMA autognostic`
**Rationale:** Cleaner isolation, easier to drop all plugin data, and conventional in multi-tenant PostgreSQL systems. Schema-level isolation also prevents accidental cross-plugin joins.
**Revisit if:** ElizaOS enforces a single schema policy.

## DEC-004: Callback-first action handler pattern (2025-02-01)
**Status:** Active
**Context:** ElizaOS action handlers that only return `ActionResult` without calling `callback()` cause the core to fall back to `sendMessage` on the message bus, which can introduce cyclic structures during serialization → infinite loop.
**Options:** 1) Return-only pattern 2) Callback-first pattern
**Decision:** Always call `callback({ text, action })` before every `return` in action handlers.
**Rationale:** Discovered through debugging cyclic serialization crashes. The callback pattern is the only reliable way to ensure the agent responds correctly.
**Revisit if:** ElizaOS core fixes the sendMessage fallback serialization.

## DEC-005: safeSerialize for ActionResult.data (2025-02-04)
**Status:** Active
**Context:** Spreading opaque service results into `ActionResult.data` can include Drizzle query objects with cyclic references, crashing JSON serialization.
**Options:** 1) Spread service results directly 2) Destructure to explicit primitive fields 3) Use safeSerialize utility
**Decision:** Both: destructure to primitives AND use `safeSerialize` as a safety net.
**Rationale:** Belt-and-suspenders approach. Destructuring prevents most issues; safeSerialize catches edge cases.
**Revisit if:** ElizaOS adds built-in serialization safety.

## DEC-006: 5-level scientific taxonomy with lakehouse zones (2025-02-03)
**Status:** Active
**Context:** Scientific papers need hierarchical classification to enable browsing and filtering.
**Options:** 1) Flat tags 2) 3-level hierarchy 3) 5-level taxonomy (L1-L4 hierarchy + L5 structured facets)
**Decision:** 5-level taxonomy with Bronze/Silver/Gold lakehouse zones.
**Rationale:** L1-L4 provides navigable hierarchy. L5 facets (phenomenon, task, method, entity) capture research specifics. Lakehouse zones (Bronze=raw, Silver=DOI-verified, Gold=fully-classified) allow incremental enrichment.
**Revisit if:** Taxonomy proves too granular for practical use.

## DEC-007: Rename from datamirror to autognostic (2025-01-25)
**Status:** Active
**Context:** Original name "datamirror" was too generic and didn't convey the autonomous knowledge management concept.
**Options:** 1) Keep datamirror 2) Rename to autognostic (auto + gnostic = self-knowing)
**Decision:** Rename to autognostic with migration script.
**Rationale:** "Autognostic" captures the plugin's purpose: agents that autonomously manage their own knowledge. Migration 001 handles the rename for existing installations.
**Revisit if:** N/A — rename is complete.
