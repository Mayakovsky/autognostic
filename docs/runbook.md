# Runbook — plugin-autognostic

> For architecture details, see [architecture.md](./architecture.md).
> For schema details, see [schema.md](./schema.md).

## First-Time Setup

1. Clone the repo and navigate to the plugin directory
2. Install dependencies:
   ```bash
   bun install
   ```
3. Copy environment template (if needed):
   ```bash
   cp .env.example .env  # edit as needed
   ```
4. Build the plugin:
   ```bash
   bun run build
   ```
5. Run tests to verify:
   ```bash
   npx vitest run
   ```

## Daily Development

```bash
# Start dev server (ElizaOS with plugin loaded)
bun run dev

# Run tests in watch mode
bun run test:watch

# Lint
bun run lint
bun run lint:fix

# Build
bun run build
```

## Database Operations

```bash
# Apply migrations
bun run db:migrate

# Seed taxonomy data (L1 nodes + controlled vocabulary)
bun run db:seed

# Full reset (delete + recreate)
rm -rf ./data/autognostic.db
bun run db:migrate
bun run db:seed
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `cyclic structures` error | Action handler not calling `callback()` | Add `callback()` call before every `return` — see [ISSUE-001](./known-issues.md#issue-001) |
| `Action not found` in logs | LLM hallucinating action names | Improve action descriptions; this is inherent to LLM routing |
| Build fails with type errors | Stale cache or missing deps | `rm -rf node_modules/.cache dist/ && bun install && bun run build` |
| PGlite corruption | Unclean shutdown | `rm -rf ./data/autognostic.db && bun run db:migrate && bun run db:seed` |
| Tests hang | vitest in watch mode | Use `npx vitest run` for single-run mode |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PGlite connection string (e.g., `pglite://./data/autognostic.db`) |
| `POSTGRES_URL` | No | Remote PostgreSQL for multi-agent sync |
| `GITHUB_TOKEN` | No | GitHub PAT for repo source sync |
| `CROSSREF_EMAIL` | No | Email for Crossref API polite pool (50 req/s) |
