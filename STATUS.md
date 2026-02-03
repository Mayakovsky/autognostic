# Plugin Status: @elizaos/plugin-autognostic

## Current Status: Ready for Integration

**Version:** 0.1.0

---

## Checklist

### Structure Alignment
- [x] tests/ directory
- [x] scripts/ directory
- [x] .github/workflows/ directory
- [x] .eslintrc.js
- [x] .prettierrc
- [x] .gitignore
- [x] .env.example
- [x] README.md
- [x] STATUS.md
- [x] package.json scripts and devDependencies

### Build & Lint
- [x] Builds without errors
- [x] Lint passes

### P0 - Must Fix Before Testing
- [x] Auth token validation implemented
- [x] Size policy preview gate implemented
- [x] Scientific paper detection wired into ingestion pipeline
- [x] Classification system implemented

### P1 - Required for Full Functionality
- [x] Sitemap XML parsing implemented
- [ ] GitHub repo discovery implemented (optional)
- [x] Drizzle syntax verified (unified getDb utility)
- [x] roomId/entityId usage confirmed
- [x] Scientific paper lakehouse zones (Bronze/Silver/Gold)
- [x] 5-level taxonomy classification

### P2 - Quality Hardening
- [ ] Retention policy for old versions
- [ ] Better error messaging
- [x] Unit tests for VersionResolver
- [x] Unit tests for preview (policy tests)
- [x] Unit tests for policy gating
- [ ] Unit tests for ScientificPaperHandler

### Testing
- [x] Unit tests pass
- [ ] Integration tested in Eliza monorepo
- [ ] Functional tests pass

---

## Test Coverage

- `tests/discovery.test.ts` - SingleUrlDiscovery, LlmsTxtDiscovery, SitemapDiscovery, URL classifier
- `tests/policy.test.ts` - SizePolicy and RefreshPolicy logic
- `tests/versionHash.test.ts` - Version hash computation and needsUpdate logic
- `tests/auth.test.ts` - Token validation and AutognosticAuthError

---

## Database Access

All repositories use a shared `getDb()` utility (`src/db/getDb.ts`) that:
- Handles async DB initialization with polling
- Caches DB handle per runtime
- Supports multiple adapter patterns (adapter, databaseAdapter, services, getService)

---

## Scientific Paper Classification

Implemented in this version:
- **ScientificPaperDetector** - 50+ URL patterns, Crossref API integration
- **ScientificPaperHandler** - 5-level taxonomy classification
- **Lakehouse Zones** - Bronze (raw) → Silver (verified) → Gold (classified)
- **Enriched Content** - Classification metadata prepended to stored documents

See `docs/SCIENTIFIC-PAPER-CLASSIFICATION.md` for full documentation.

---

## Integration Guide

### Step 1: Copy to Eliza Monorepo

```bash
# From eliza root
cp -r /path/to/plugin-autognostic packages/plugin-autognostic
```

### Step 2: Register in Monorepo

Ensure `packages/plugin-autognostic/package.json` has:
```json
{
  "name": "@elizaos/plugin-autognostic"
}
```

Peer dependencies required:
- `@elizaos/core`
- `@elizaos/plugin-knowledge`
- `@elizaos/plugin-sql` (for database access)

### Step 3: Build in Monorepo

```bash
pnpm install
pnpm build
```

### Step 4: Configure Agent

```typescript
import { autognosticPlugin } from "@elizaos/plugin-autognostic";

const agent = new Agent({
  plugins: [
    sqlPlugin,           // Required for database
    knowledgePlugin,     // Required for Knowledge storage
    autognosticPlugin,   // This plugin
  ],
});
```

### Step 5: Set Environment Variables

```env
AUTOGNOSTIC_AUTH_TOKEN=your-secure-token
CROSSREF_MAILTO=your@email.com  # Optional, improves Crossref rate limits
```

### Step 6: Run Database Migrations

Run migrations in order:
1. `001_rename_to_autognostic.sql`
2. `002_add_sync_tables.sql`
3. `003_add_paper_classification_tables.sql`

Tables created:
- `autognostic.settings`
- `autognostic.refresh_settings`
- `autognostic.preview_cache`
- `autognostic.sources`
- `autognostic.versions`
- `autognostic.knowledge_link`
- `autognostic.documents`
- `autognostic.sync_config`
- `autognostic.sync_log`
- `autognostic.paper_classification`
- `autognostic.taxonomy_nodes`
- `autognostic.controlled_vocab`

### Step 7: Test Actions

```
User: Add https://arxiv.org/abs/1706.03762 to knowledge
Agent: Added scientific paper to Knowledge.
       📄 "Attention Is All You Need"
       🥇 Lakehouse Zone: GOLD | Domain: L1.ENGTECH

User: Add https://docs.example.com/guide.html to knowledge
Agent: Added https://docs.example.com/guide.html to Knowledge.
       Full document archived for direct quotes.
```

---

## Commits History

1. `chore: align to standard workflow structure`
2. `feat: implement auth token validation and size policy gate`
3. `test: add unit tests for core functionality`
4. `feat: implement sitemap discovery and unify Drizzle DB access`
5. `refactor: rename plugin-datamirror to plugin-autognostic`
6. `feat: implement scientific paper classification system`
