# Plugin Status: @elizaos/plugin-datamirror

## Current Status: Ready for Integration

**Version:** 0.1.0

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

### P1 - Required for Full Functionality
- [x] Sitemap XML parsing implemented
- [ ] GitHub repo discovery implemented (optional)
- [x] Drizzle syntax verified (unified getDb utility)
- [x] roomId/entityId usage confirmed

### P2 - Quality Hardening
- [ ] Retention policy for old versions
- [ ] Better error messaging
- [x] Unit tests for VersionResolver
- [x] Unit tests for preview (policy tests)
- [x] Unit tests for policy gating

### Testing
- [x] Unit tests pass
- [ ] Integration tested in Eliza monorepo
- [ ] Functional tests pass

## Test Coverage

- `tests/discovery.test.ts` - SingleUrlDiscovery, LlmsTxtDiscovery, SitemapDiscovery, URL classifier
- `tests/policy.test.ts` - SizePolicy and RefreshPolicy logic
- `tests/versionHash.test.ts` - Version hash computation and needsUpdate logic
- `tests/auth.test.ts` - Token validation and DatamirrorAuthError

## Database Access

All repositories now use a shared `getDb()` utility (`src/db/getDb.ts`) that:
- Handles async DB initialization with polling
- Caches DB handle per runtime
- Supports multiple adapter patterns (adapter, databaseAdapter, services, getService)

---

## Integration Guide

### Step 1: Copy to Eliza Monorepo

```bash
# From eliza root
cp -r /path/to/plugin-datamirror packages/plugin-datamirror
```

### Step 2: Register in Monorepo

Add to `packages/plugin-datamirror/package.json`:
```json
{
  "name": "@elizaos/plugin-datamirror"
}
```

Ensure peer dependencies are available:
- `@elizaos/core`
- `@elizaos/plugin-knowledge`
- `@elizaos/plugin-sql` (for database access)

### Step 3: Build in Monorepo

```bash
pnpm install
pnpm build
```

### Step 4: Configure Agent

Add to your agent configuration:

```typescript
import { datamirrorPlugin } from "@elizaos/plugin-datamirror";

const agent = new Agent({
  plugins: [
    sqlPlugin,           // Required for database
    knowledgePlugin,     // Required for Knowledge storage
    datamirrorPlugin,    // This plugin
  ],
});
```

### Step 5: Set Environment Variables

```env
DATAMIRROR_AUTH_TOKEN=your-secure-token
```

### Step 6: Run Database Migrations

The plugin will create these tables on first use:
- `datamirror_settings`
- `datamirror_refresh_settings`
- `datamirror_preview_cache`
- `datamirror_sources`
- `datamirror_versions`
- `datamirror_knowledge_link`

### Step 7: Test Actions

```
User: Add https://docs.example.com/guide.html to knowledge
Agent: (requires authToken parameter)

User: Mirror https://docs.example.com/ to knowledge
Agent: (discovers via llms.txt, shows preview if large, requires confirmation)
```

---

## Commits

1. `chore: align to standard workflow structure`
2. `feat: implement auth token validation and size policy gate`
3. `test: add unit tests for core functionality`
4. `feat: implement sitemap discovery and unify Drizzle DB access`
