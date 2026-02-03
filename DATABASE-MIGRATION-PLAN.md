# Autognostic Plugin - Database Migration Plan
## Claude Code Implementation Guide

**Date:** February 3, 2026

---

## Problem

Migration can't run via `psql` because PGlite is embedded (no external DB connection).

## Solution

ElizaOS auto-creates tables from plugin `schema` export. We add seed data via plugin `init()`.

---

## Changes Already Made

| File | Status | Purpose |
|------|--------|---------|
| `src/db/seedData.ts` | ✅ CREATED | L1 taxonomy + vocab constants |
| `src/services/DatabaseSeeder.ts` | ✅ CREATED | Idempotent seeding |
| `src/index.ts` | ✅ MODIFIED | Added `init()` function |
| `migrations/README.md` | ✅ CREATED | Migration docs |
| `.env.example` | ✅ MODIFIED | Both deployment modes |

---

## Verification Steps

```bash
cd C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic
bun run build
bun run test
bun run lint
```

---

## Expected Console Output

**First run:**
```
[autognostic] Seeded 8 taxonomy nodes, 39 vocabulary terms
```

**Subsequent runs:**
```
[autognostic] Found 8 taxonomy nodes, 39 vocabulary terms
```

---

## Commit & Push

```bash
git add .
git commit -m "feat(autognostic): add database seeding for dual-mode deployment"
git push origin main
```

---

## Architecture

```
PGlite (local) or PostgreSQL (cloud)
        │
ElizaOS reads plugin.schema → Drizzle creates tables → init() seeds data
```

Both backends use identical code path.
