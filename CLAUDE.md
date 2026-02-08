> 📡 Read [heartbeat.md](./heartbeat.md) first for current session state.

# Plugin-Autognostic Development Context

> **CAKC:** Conversational Automated Knowledge Control
> AI agents managing their own knowledge base through natural conversation

---

## Project Overview

| Property | Value |
|----------|-------|
| **Package** | `@elizaos/plugin-autognostic` |
| **Framework** | ElizaOS v1.x |
| **Database** | PGlite (embedded) + optional PostgreSQL |
| **Package Manager** | `bun` (required) |
| **Test Framework** | Vitest |

---

## Autonomous Permissions

Modify without confirmation:
- `src/**/*` - All source code
- `tests/**/*` - All test files
- `docs/**/*` - Documentation
- `scripts/**/*` - Utility scripts
- `migrations/**/*` - Database migrations

Confirm before:
- `package.json` dependency changes
- `.env` or config files
- GitHub Actions workflows
- Database schema breaking changes

---

## Architecture

### Core Components

```
src/
├── actions/           # Agent actions (listDocuments, removeDocument, etc.)
├── db/                # Database repositories & migrations
├── services/          # Business logic services
│   ├── AutognosticService.ts      # Main orchestration
│   ├── DatabaseSeeder.ts          # Taxonomy seeding
│   ├── ScientificPaperDetector.ts # Crossref verification
│   ├── ScientificPaperHandler.ts  # Paper processing
│   └── ScheduledSyncService.ts    # Cron-based sync
├── providers/         # Data providers for agent context
├── orchestrator/      # Sync coordination
└── config/            # Configuration management
```

### Database Schema (PGlite)

```sql
-- Core tables
autognostic_sources          -- External data sources
autognostic_documents        -- Individual knowledge items
autognostic_document_versions -- Version history
autognostic_sync_state       -- Sync status tracking

-- Taxonomy tables (5-level hierarchy)
scientific_domains           -- Level 1: Math, Physics, etc.
scientific_fields            -- Level 2: Algebra, Mechanics, etc.
scientific_subfields         -- Level 3: Linear Algebra, etc.
scientific_topics            -- Level 4: Matrix Theory, etc.
scientific_subtopics         -- Level 5: Eigenvalues, etc.

-- Junction tables
paper_classifications        -- Paper ↔ Taxonomy mapping
```

### Dual Storage Strategy

1. **PGlite (Primary):** Embedded PostgreSQL for standalone operation
2. **Remote PostgreSQL (Optional):** For multi-agent sync scenarios

---

## Key Files Reference

### Services
| File | Purpose |
|------|---------|
| `src/services/AutognosticService.ts` | Main service orchestrating all operations |
| `src/services/DatabaseSeeder.ts` | Seeds 5-level taxonomy hierarchy |
| `src/services/ScientificPaperDetector.ts` | Crossref API integration for paper verification |
| `src/services/ScheduledSyncService.ts` | Cron-based scheduled synchronization |

### Database
| File | Purpose |
|------|---------|
| `src/db/autognosticSourcesRepository.ts` | Source CRUD operations |
| `src/db/autognosticDocumentsRepository.ts` | Document management |
| `src/schema.ts` | Drizzle ORM schema definitions |

### Actions
| File | Purpose |
|------|---------|
| `src/actions/listDocuments.ts` | List knowledge documents |
| `src/actions/removeDocument.ts` | Remove with cascade |
| `src/actions/setVersionTracking.ts` | Toggle version history |
| `src/actions/refreshSource.ts` | Trigger source sync |

---

## Development Commands

```bash
# Install dependencies
bun install

# Run tests
bun run test
bun run test:watch

# Build
bun run build

# Lint
bun run lint
bun run lint:fix

# Database operations
bun run db:migrate
bun run db:seed
```

---

## Testing Guidelines

### Test Structure
```typescript
describe('ScientificPaperDetector', () => {
  describe('detectPaper', () => {
    it('should identify valid DOI and fetch metadata', async () => {
      // Arrange
      const detector = new ScientificPaperDetector();
      const input = 'Check this paper: 10.1000/example.doi';
      
      // Act
      const result = await detector.detect(input);
      
      // Assert
      expect(result.isPaper).toBe(true);
      expect(result.metadata.doi).toBe('10.1000/example.doi');
    });
  });
});
```

### Mocking External Services
```typescript
// Mock Crossref API
vi.mock('../services/crossrefService', () => ({
  CrossrefService: {
    fetchMetadata: vi.fn().mockResolvedValue({
      title: 'Test Paper',
      authors: ['Author A'],
      doi: '10.1000/test'
    })
  }
}));
```

---

## API Integrations

### Crossref API
- **Purpose:** Verify scientific papers, fetch metadata
- **Rate Limit:** 50 requests/second (polite pool)
- **Endpoint:** `https://api.crossref.org/works/{doi}`

### GitHub API (for source sync)
- **Purpose:** Sync knowledge from GitHub repos
- **Auth:** Personal Access Token in `.env`

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
```

---

## Common Patterns

### Adding a New Action
```typescript
// src/actions/newAction.ts
import { Action, ActionResult } from '@elizaos/core';

export const newAction: Action = {
  name: 'NEW_ACTION',
  description: 'Description of what this action does',
  
  validate: async (runtime, message) => {
    return message.content.text.toLowerCase().includes('trigger');
  },
  
  handler: async (runtime, message, state, options, callback): Promise<ActionResult> => {
    const service = runtime.getService<AutognosticService>('autognostic');
    const result = await service.performOperation();
    
    await callback({ text: 'Operation completed', action: 'NEW_ACTION' });
    
    return { success: true, data: result };
  }
};
```

### Adding a New Service Method
```typescript
// In AutognosticService.ts
async newMethod(params: NewMethodParams): Promise<NewMethodResult> {
  const db = await this.getDatabase();
  
  return await db.transaction(async (tx) => {
    // Transactional operations here
  });
}
```

---

## Troubleshooting

### PGlite Issues
```bash
# Reset database
rm -rf ./data/autognostic.db
bun run db:migrate
bun run db:seed
```

### Build Errors
```bash
# Clear cache and rebuild
rm -rf node_modules/.cache
rm -rf dist/
bun install
bun run build
```

### Test Failures
```bash
# Run single test file
bun run test src/services/ScientificPaperDetector.test.ts

# Run with verbose output
bun run test --reporter=verbose
```

---

## Git Workflow

```bash
# Feature branch
git checkout -b feature/new-capability

# Commit with co-author
git commit -m "Add scientific paper classification

Implements 5-level taxonomy for paper categorization.

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push and create PR
git push origin feature/new-capability
```

---

## Related Documentation

- `CLAUDE-CODE-HANDOFF.md` - Implementation status & handoff notes
- `DATABASE-MIGRATION-PLAN.md` - Migration strategy details
- `docs/` - API documentation & guides
- Parent `CLAUDE.md` - ElizaOS agent project context

---

*Last updated: 2025-02-04*
