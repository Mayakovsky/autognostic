# plugin-datamirror: Development Roadmap

## Project Status
- **Name**: @elizaos/plugin-datamirror
- **Version**: 0.1.0
- **Status**: Pre-integration (code written, needs testing + remaining work)
- **Location**: D:\projects\plugin-datamirror

---

## Quick Summary

ElizaOS plugin that lets an agent conversationally add public documents into Knowledge and keep them current via background reconciliation.

**Core Features:**
- Add single URL to Knowledge
- Mirror entire docs site (via llms.txt, llms-full.txt, sitemap)
- Version tracking with change detection (HEAD metadata + hash)
- Configurable size/refresh policies
- Background reconciliation worker

---

## Current Structure

```
plugin-datamirror\
├── src\
│   ├── index.ts              # Plugin entry
│   ├── schema.ts             # Schema export
│   ├── actions\              # 4 actions (add URL, mirror source, set policies)
│   ├── config\               # SizePolicy, RefreshPolicy
│   ├── db\                   # Drizzle schema + 6 repositories
│   ├── integration\          # mirrorDocToKnowledge
│   ├── orchestrator\         # Reconciliation worker/service, preview, bootstrap
│   ├── publicspace\          # URL discovery (llms.txt, sitemap stub, single URL)
│   └── services\             # HTTP, GitHub (stub), Datamirror service
├── dist\                     # Build output
├── package.json
├── tsconfig.json
└── bun.lock
```

---

## Alignment Tasks

### Missing from Standard Template

| Item | Status | Action |
|------|--------|--------|
| tests/ | Missing | Create directory + setup |
| scripts/ | Missing | Create for migrations |
| .github/workflows/ | Missing | Add CI workflow |
| jest.config.js | Missing | Add (or vitest.config.ts) |
| .eslintrc.js | Missing | Add |
| .prettierrc | Missing | Add |
| .env.example | Missing | Create |
| .gitignore | Missing | Create |
| README.md | Missing | Create |
| STATUS.md | Missing | Create |

### package.json Updates Needed

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "ts-node src/index.ts",
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write \"src/**/*.ts\""
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^20.10.0",
    "vitest": "^1.0.0",
    "eslint": "^8.55.0",
    "prettier": "^3.1.0",
    "@typescript-eslint/parser": "^6.13.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "eslint-config-prettier": "^9.1.0"
  }
}
```

---

## Remaining Code Work

### P0 - Must Fix Before Testing

| ID | Task | Files |
|----|------|-------|
| auth_token_validation | Implement real token validation for write actions | src/actions/*.ts, new: src/auth/validateToken.ts |
| size_policy_preview_gate | Enforce preview/threshold before ingestion | src/actions/mirrorSourceToKnowledgeAction.ts, src/orchestrator/ReconciliationService.ts |

### P1 - Required for Full Functionality

| ID | Task | Files |
|----|------|-------|
| sitemap_parsing | Implement XML sitemap parsing | src/publicspace/SitemapDiscovery.ts |
| github_discovery | Implement GitHub repo file discovery | src/services/githubService.ts, new: src/publicspace/GithubRepoDiscovery.ts |
| drizzle_where_helpers | Verify Drizzle syntax matches ElizaOS adapter | src/db/*.ts |
| room_id_entity_id | Confirm correct IDs for Knowledge calls | src/integration/mirrorDocToKnowledge.ts |

### P2 - Quality Hardening

- Retention policy for old versions
- Better error messaging
- Unit tests for VersionResolver, preview, policy gating

---

## Testing Plan

### Phase 1: Build Verification
```powershell
cd D:\projects\plugin-datamirror
npm install
npm run build
npm run lint
```

### Phase 2: Unit Tests
- Create tests/setup.ts
- Test discovery classes
- Test policy logic
- Test version hash computation

### Phase 3: Integration (in Eliza monorepo)
1. Copy to eliza/packages/plugin-datamirror
2. Build monorepo
3. Run agent with: sql + openai + knowledge + datamirror
4. Verify startup logs

### Phase 4: Functional Tests
| Test | Action | Expected |
|------|--------|----------|
| Add single URL | ADD_URL_TO_KNOWLEDGE | Doc in Knowledge with datamirror metadata |
| Mirror docs site | MIRROR_SOURCE_TO_KNOWLEDGE | Discovery runs, version created, links written |
| Update policy | SET_DATAMIRROR_* | DB updated, next reconcile uses new values |
| No-change reconcile | Run twice | Second run reports "up-to-date" |

---

## Environment Variables

```env
# Required
DATABASE_URL=postgresql://localhost:5432/elizaos_plugin_dev
OPENAI_API_KEY=your-key

# Recommended
DATAMIRROR_AUTH_TOKEN=your-auth-token

# Future (GitHub discovery)
GITHUB_TOKEN=your-github-token
```

---

## Execution Steps for Claude Code

### Step 1: Align to Workflow Structure
```
1. Create missing directories: tests/, scripts/, .github/workflows/
2. Create missing config files: .eslintrc.js, .prettierrc, .gitignore, .env.example
3. Update package.json with full scripts and devDependencies
4. Create README.md and STATUS.md
5. Run: npm install
6. Run: npm run build (fix any errors)
7. Run: npm run lint (fix any errors)
8. Commit: "chore: align to standard workflow structure"
```

### Step 2: P0 Code Fixes
```
1. Create src/auth/validateToken.ts
2. Update all actions to use validateToken
3. Implement size policy preview gate in mirrorSourceToKnowledgeAction
4. Update ReconciliationService to respect policy
5. Run: npm run build && npm run lint
6. Commit: "feat: implement auth token validation and size policy gate"
```

### Step 3: Create Unit Tests
```
1. Create tests/setup.ts
2. Create tests for:
   - discovery classes (LlmsTxt, SingleUrl)
   - SizePolicy/RefreshPolicy logic
   - version hash computation
3. Run: npm test
4. Commit: "test: add unit tests for core functionality"
```

### Step 4: P1 Code Fixes
```
1. Implement SitemapDiscovery XML parsing
2. Verify Drizzle syntax compatibility
3. Confirm roomId/entityId usage
4. Run: npm run build && npm run lint && npm test
5. Commit: "feat: implement sitemap discovery and fix Drizzle queries"
```

### Step 5: Push and Prepare for Integration
```
1. Final validation: npm run build && npm run lint && npm test
2. git push
3. Document integration steps for Eliza monorepo
```

---

## Success Criteria

- [ ] Builds without errors
- [ ] Lint passes
- [ ] Unit tests pass
- [ ] Auth token validation implemented
- [ ] Size policy gate implemented
- [ ] README complete
- [ ] Ready for Eliza monorepo integration
