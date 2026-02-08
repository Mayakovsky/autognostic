# Claude Code CLI - Pre-Release Testing Instructions

> **Purpose:** Automated verification tasks for Claude Code CLI before field testing
> **Plugin Version:** 0.1.0
> **Last Updated:** 2025-02-04

---

## Autonomous Permissions

You have permission to execute all commands and modify files in:
- `src/**/*`
- `tests/**/*`
- `docs/**/*`
- `scripts/**/*`
- `migrations/**/*`

Proceed with verification tasks without asking for individual confirmations.

**Stop and confirm before:**
- Pushing to remote repositories
- Modifying `package.json` dependencies
- Running database migrations on non-local databases

---

## Pre-Flight Checklist

Execute these tasks in order. Stop and report if any step fails.

### Phase 1: Environment Verification

```bash
# 1. Verify working directory
cd C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic
pwd

# 2. Check Node/Bun versions
bun --version
node --version

# 3. Verify no stale nested folders
ls -la | grep -i datamirror
# Expected: No output (folder should not exist)

# 4. Check git status
git status
# Note any uncommitted changes
```

### Phase 2: Dependency Verification

```bash
# 1. Clean install
rm -rf node_modules
rm -f bun.lock
bun install

# 2. Verify peer dependencies are resolvable
bun pm ls @elizaos/core
bun pm ls @elizaos/plugin-knowledge

# 3. Check for security vulnerabilities
bun audit
```

### Phase 3: Build Verification

```bash
# 1. Clean previous builds
rm -rf dist

# 2. Type check only (no emit)
bunx tsc --noEmit

# 3. Full build
bun run build

# 4. Verify output structure
ls -la dist/
# Expected: index.js, index.d.ts, and subdirectories matching src/

# 5. Check for any TypeScript errors in build output
cat dist/index.d.ts | head -50
```

### Phase 4: Lint Verification

```bash
# 1. Run linter
bun run lint

# 2. If errors, attempt auto-fix
bun run lint:fix

# 3. Re-run to verify fixes
bun run lint
# Expected: No errors
```

### Phase 5: Unit Test Execution

```bash
# 1. Run all tests
bun run test

# 2. Run with coverage
bun run test:coverage

# 3. Generate coverage report
# Check coverage meets minimum threshold (aim for >70%)
```

### Phase 6: Individual Test File Verification

Run each test file independently to isolate failures:

```bash
# Discovery tests
bunx vitest run tests/discovery.test.ts

# Policy tests  
bunx vitest run tests/policy.test.ts

# Version hash tests
bunx vitest run tests/versionHash.test.ts

# Auth tests
bunx vitest run tests/auth.test.ts
```

### Phase 7: Import/Export Verification

Create and run a verification script:

```bash
# Create test script
cat > scripts/verify-exports.ts << 'EOF'
/**
 * Verify all public exports are accessible
 */
import {
  autognosticPlugin,
  removeFromKnowledge,
  removeDocumentByUrl,
  getScheduledSyncService,
  getExactQuote,
  getLineContent,
  getFullDocument,
  ScientificPaperDetector,
  getScientificPaperDetector,
  ScientificPaperHandler,
  createScientificPaperHandler,
  DatabaseSeeder,
} from "../src/index";

console.log("✅ Plugin name:", autognosticPlugin.name);
console.log("✅ Plugin actions:", autognosticPlugin.actions?.length);
console.log("✅ Plugin services:", autognosticPlugin.services?.length);
console.log("✅ Plugin providers:", autognosticPlugin.providers?.length);
console.log("✅ All exports verified");
EOF

# Run verification
bunx ts-node scripts/verify-exports.ts
```

### Phase 8: Schema Verification

```bash
# Verify Drizzle schema compiles
cat > scripts/verify-schema.ts << 'EOF'
import { autognosticSchema } from "../src/schema";

console.log("Schema tables:");
for (const [name, table] of Object.entries(autognosticSchema)) {
  console.log(`  - ${name}`);
}
console.log("✅ Schema verified");
EOF

bunx ts-node scripts/verify-schema.ts
```

### Phase 9: Action Registration Verification

```bash
# List all registered actions
cat > scripts/verify-actions.ts << 'EOF'
import { autognosticPlugin } from "../src/index";

console.log("Registered Actions:");
autognosticPlugin.actions?.forEach((action, i) => {
  console.log(`  ${i + 1}. ${action.name}`);
  console.log(`     Description: ${action.description?.slice(0, 60)}...`);
});

const expectedActions = [
  "ADD_URL_TO_KNOWLEDGE",
  "MIRROR_SOURCE_TO_KNOWLEDGE", 
  "LIST_SOURCES",
  "LIST_DOCUMENTS",
  "GET_QUOTE",
  "REMOVE_SOURCE",
  "REMOVE_DOCUMENT",
  "SET_AUTOGNOSTIC_SIZE_POLICY",
  "SET_VERSION_TRACKING",
  "REFRESH_SOURCE",
];

const registeredNames = autognosticPlugin.actions?.map(a => a.name) || [];
const missing = expectedActions.filter(e => !registeredNames.includes(e));

if (missing.length > 0) {
  console.error("❌ Missing actions:", missing);
  process.exit(1);
}

console.log("✅ All expected actions registered");
EOF

bunx ts-node scripts/verify-actions.ts
```

---

## Test Creation Tasks

### Task 1: Create ScientificPaperHandler Tests

```bash
cat > tests/scientificPaperHandler.test.ts << 'EOF'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRuntime } from "./setup";

// Mock the database
vi.mock("../src/db/getDb", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }),
}));

describe("ScientificPaperHandler", () => {
  let mockRuntime: ReturnType<typeof createMockRuntime>;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    vi.clearAllMocks();
  });

  describe("classifyPaper", () => {
    it("should assign BRONZE zone when no DOI present", async () => {
      // TODO: Implement test
      expect(true).toBe(true);
    });

    it("should assign SILVER zone when DOI verified but no classification", async () => {
      // TODO: Implement test
      expect(true).toBe(true);
    });

    it("should assign GOLD zone when fully classified", async () => {
      // TODO: Implement test  
      expect(true).toBe(true);
    });
  });

  describe("enrichContent", () => {
    it("should prepend classification metadata to content", async () => {
      // TODO: Implement test
      expect(true).toBe(true);
    });
  });
});
EOF

# Run the new test file
bunx vitest run tests/scientificPaperHandler.test.ts
```

### Task 2: Create Integration Test Stubs

```bash
cat > tests/integration.test.ts << 'EOF'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRuntime, createMockHttpService } from "./setup";

describe("Integration Tests", () => {
  describe("AddUrlToKnowledgeAction", () => {
    it("should detect and classify arxiv papers", async () => {
      // TODO: Integration test with mocked Crossref API
      expect(true).toBe(true);
    });

    it("should handle non-paper URLs as BRONZE zone", async () => {
      // TODO: Integration test for regular documents
      expect(true).toBe(true);
    });
  });

  describe("Database Seeder", () => {
    it("should seed taxonomy nodes on first run", async () => {
      // TODO: Test seeder with mock database
      expect(true).toBe(true);
    });

    it("should skip seeding if data exists", async () => {
      // TODO: Test idempotency
      expect(true).toBe(true);
    });
  });

  describe("Scheduled Sync Service", () => {
    it("should initialize cron job correctly", async () => {
      // TODO: Test cron scheduling
      expect(true).toBe(true);
    });
  });
});
EOF

bunx vitest run tests/integration.test.ts
```

---

## Database Migration Verification (Local Only)

### PGlite Mode (Default)

```bash
# Verify PGlite can be initialized
cat > scripts/verify-pglite.ts << 'EOF'
import { PGlite } from "@electric-sql/pglite";

async function testPGlite() {
  const db = new PGlite("./test-data/verify.db");
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS test_table (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  
  await db.exec(`INSERT INTO test_table (name) VALUES ('test');`);
  
  const result = await db.query(`SELECT * FROM test_table;`);
  console.log("PGlite test result:", result.rows);
  
  // Cleanup
  await db.close();
  console.log("✅ PGlite verification passed");
}

testPGlite().catch(console.error);
EOF

bunx ts-node scripts/verify-pglite.ts
rm -rf test-data
```

### PostgreSQL Mode (Optional - Requires Running Instance)

```bash
# Only run if PostgreSQL is available
pg_isready -h localhost -p 5432 && {
  echo "PostgreSQL is available, running migration verification..."
  
  # Verify migrations are syntactically valid
  for f in migrations/*.sql; do
    echo "Checking $f..."
    psql -U postgres -d postgres -f "$f" --dry-run 2>&1 | head -5
  done
}
```

---

## Final Verification Report

After completing all phases, generate a summary:

```bash
cat > scripts/generate-report.ts << 'EOF'
const report = {
  timestamp: new Date().toISOString(),
  plugin: "@elizaos/plugin-autognostic",
  version: "0.1.0",
  checks: {
    build: "PENDING",
    lint: "PENDING", 
    tests: "PENDING",
    exports: "PENDING",
    actions: "PENDING",
  },
  notes: [],
};

// This would be populated by actual test results
console.log("=== PRE-RELEASE VERIFICATION REPORT ===");
console.log(JSON.stringify(report, null, 2));
EOF
```

---

## Troubleshooting Commands

### If Build Fails
```bash
# Check for circular dependencies
bunx madge --circular src/index.ts

# Check import graph
bunx madge --image graph.png src/index.ts
```

### If Tests Fail
```bash
# Run single test with verbose output
bunx vitest run tests/discovery.test.ts --reporter=verbose

# Debug mode
bunx vitest run tests/discovery.test.ts --inspect-brk
```

### If Lint Fails
```bash
# Check specific file
bunx eslint src/services/AutognosticService.ts --fix

# Check with debug
DEBUG=eslint:* bunx eslint src/
```

---

## Success Criteria

All phases must pass before field testing:

- [ ] Build completes without errors
- [ ] All lint checks pass
- [ ] All unit tests pass (>70% coverage)
- [ ] All exports are verified accessible
- [ ] All 10 actions are registered
- [ ] Schema compiles correctly
- [ ] PGlite initialization works

---

*This document is designed for Claude Code CLI automated execution*
