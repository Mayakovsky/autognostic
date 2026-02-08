# HEARTBEAT — plugin-autognostic
> Last updated: 2026-02-08 14:05 (PST)
> Updated by: claude-code
> Session label: seshmem v3.1 schema implementation
> Staleness gate: 2026-02-08 — if today is >3 days past this,
>   verify state before acting (see Section 3 of SeshMem schema).

## Focus (1-3 goals, testable)
- [x] Implement SeshMem v3.1 continuity schema into project
- [ ] Verify all supporting docs link correctly from heartbeat
- [ ] Confirm validation script passes clean

## What Works (verified)
- ✅ Build (`bun run build`) — passes clean, 0 errors — verified 2026-02-08
- ✅ Tests (`npx vitest run`) — 91/91 pass across 8 test files — verified 2026-02-08
- ✅ 11 actions registered — verified via `ls src/actions/` on 2026-02-08
- ✅ 7 services implemented — verified via `ls src/services/` on 2026-02-08
- ✅ Drizzle ORM schema with 12 tables in `autognostic` PG schema — verified 2026-02-08
- ✅ safeSerialize + error system — added in commit 37bb493

## What's Broken
- ❌ No known build/test failures at this time

## Next Actions (ordered)
1. Add scientific paper detection integration tests → `tests/scientificPaperHandler.test.ts`
2. Implement remaining taxonomy seeding for all 5 levels → `src/services/DatabaseSeeder.ts`
3. Add E2E test for source sync lifecycle → `tests/integration.test.ts`
4. Wire up ScheduledSyncService cron jobs to runtime → `src/services/ScheduledSyncService.ts`
5. Add Crossref polite-pool email header → `src/services/ScientificPaperDetector.ts`

## Session Log (last 5 entries, newest first)
| Date | Agent | What changed | Outcome |
|------|-------|-------------|---------|
| 2026-02-08 | claude-code | Implemented SeshMem v3.1 schema | heartbeat.md + docs/ + hooks created |

## Guardrails (DO / DON'T)
DO:
- Always call `callback()` before returning from action handlers
- Destructure results to primitive fields in `ActionResult.data`

DON'T:
- Spread opaque objects into ActionResult.data (causes cyclic serialization)
- Skip callback in handlers (ElizaOS falls back to sendMessage → infinite loop)

## Quick Commands
```bash
# Build
bun run build

# Test (non-watch)
npx vitest run

# Test (watch mode)
bun run test:watch

# Lint
bun run lint

# Dev server
bun run dev

# Reset database
rm -rf ./data/autognostic.db && bun run db:migrate && bun run db:seed
```

## Links
- [CLAUDE.md](./CLAUDE.md) — Agent identity + permissions
- [Architecture](./docs/architecture.md)
- [Schema](./docs/schema.md)
- [Decisions](./docs/decisions.md)
- [Known Issues](./docs/known-issues.md)
- [Runbook](./docs/runbook.md)
