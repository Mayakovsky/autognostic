# Plugin-Autognostic: Testing Checklist & Integration Guide

> **Version:** 0.1.0  
> **Stage:** Pre-Field Testing  
> **Last Updated:** 2025-02-04

---

## Table of Contents

1. [Testing Checklist](#testing-checklist)
2. [Integration Guide](#integration-guide)
3. [Functional Test Scenarios](#functional-test-scenarios)
4. [Regression Test Suite](#regression-test-suite)
5. [Performance Benchmarks](#performance-benchmarks)
6. [Known Issues & Workarounds](#known-issues--workarounds)

---

## Testing Checklist

### Phase 1: Unit Tests ✅

| Test File | Coverage Area | Status |
|-----------|---------------|--------|
| `tests/discovery.test.ts` | SingleUrlDiscovery, LlmsTxtDiscovery, SitemapDiscovery, URL classifier | ✅ Exists |
| `tests/policy.test.ts` | SizePolicy, RefreshPolicy logic | ✅ Exists |
| `tests/versionHash.test.ts` | Version hash computation, needsUpdate logic | ✅ Exists |
| `tests/auth.test.ts` | Token validation, AutognosticAuthError | ✅ Exists |
| `tests/scientificPaperHandler.test.ts` | Paper classification, zone assignment | 🔲 To Create |
| `tests/databaseSeeder.test.ts` | Taxonomy seeding, idempotency | 🔲 To Create |
| `tests/scheduledSync.test.ts` | Cron job initialization, sync execution | 🔲 To Create |

### Phase 2: Integration Tests

| Scenario | Components Tested | Status |
|----------|-------------------|--------|
| Add URL → Knowledge storage | Action → Service → Repository → DB | 🔲 Pending |
| Scientific paper detection | Detector → Crossref API → Handler | 🔲 Pending |
| Taxonomy classification | Handler → Seeder → DB lookup | 🔲 Pending |
| Document removal cascade | Action → Repository → Knowledge link | 🔲 Pending |
| Version tracking toggle | Action → Settings update → Version creation | 🔲 Pending |
| Scheduled sync execution | Cron → Service → All sources refresh | 🔲 Pending |

### Phase 3: End-to-End Tests (Agent Context)

| Scenario | User Input | Expected Behavior | Status |
|----------|------------|-------------------|--------|
| Add regular URL | "Add https://docs.example.com to knowledge" | Document stored, BRONZE zone | 🔲 Pending |
| Add arxiv paper | "Add https://arxiv.org/abs/1706.03762" | Paper detected, classified, GOLD zone | 🔲 Pending |
| Add DOI directly | "Add 10.1038/nature12373 to knowledge" | Crossref lookup, metadata fetched | 🔲 Pending |
| List documents | "What documents do I have?" | Full list with zones/classifications | 🔲 Pending |
| Remove document | "Remove the attention paper" | Cascade delete, knowledge link removed | 🔲 Pending |
| Get exact quote | "Quote from the transformer paper about attention" | Verbatim quote with line reference | 🔲 Pending |
| Refresh source | "Refresh my arxiv papers" | Re-fetch, version check, update if changed | 🔲 Pending |

### Phase 4: Database Tests

| Test | Description | Status |
|------|-------------|--------|
| Migration 001 | Rename tables from datamirror to autognostic | 🔲 Verify |
| Migration 002 | Add sync_config and sync_log tables | 🔲 Verify |
| Migration 003 | Add paper_classification, taxonomy_nodes, controlled_vocab | 🔲 Verify |
| Seeding | L1 taxonomy (8 domains) populated | 🔲 Verify |
| Seeding | Controlled vocabulary (39 terms) populated | 🔲 Verify |
| PGlite mode | Embedded database initializes correctly | 🔲 Verify |
| PostgreSQL mode | Remote connection works (optional) | 🔲 Verify |

### Phase 5: Error Handling Tests

| Error Scenario | Expected Behavior | Status |
|----------------|-------------------|--------|
| Invalid URL format | Graceful rejection with helpful message | 🔲 Test |
| Network timeout | Retry logic, eventual failure message | 🔲 Test |
| Crossref API failure | Fallback to BRONZE zone, continue processing | 🔲 Test |
| Database connection lost | Reconnect attempt, error if persistent | 🔲 Test |
| Duplicate document add | Detect existing, offer update or skip | 🔲 Test |
| Auth token missing | Clear error message, reject request | 🔲 Test |
| Malformed DOI | Validation failure, helpful feedback | 🔲 Test |

---

## Integration Guide

### Prerequisites

1. **ElizaOS Agent** with these plugins:
   - `@elizaos/plugin-sql` (required for database)
   - `@elizaos/plugin-knowledge` (required for knowledge storage)
   - `@elizaos/plugin-bootstrap` (core functionality)

2. **Environment Variables:**
   ```env
   # Required
   DATABASE_URL=pglite://./data/autognostic.db
   
   # Optional but recommended
   CROSSREF_MAILTO=your@email.com
   AUTOGNOSTIC_AUTH_TOKEN=your-secure-token
   
   # Optional - Remote PostgreSQL
   POSTGRES_URL=postgresql://user:pass@host:5432/db
   ```

3. **Node.js 18+** or **Bun 1.0+**

### Step 1: Install Plugin

```bash
# From agent project root
cd packages/
git clone https://github.com/Mayakovsky/autognostic.git plugin-autognostic
cd plugin-autognostic
bun install
bun run build
```

Or if using npm workspace:
```bash
# Add to agent's package.json
{
  "dependencies": {
    "@elizaos/plugin-autognostic": "workspace:*"
  }
}
```

### Step 2: Register Plugin in Agent

```typescript
// src/character.ts or agent configuration
import { autognosticPlugin } from "@elizaos/plugin-autognostic";

export const character: Character = {
  name: "MyAgent",
  plugins: [
    "@elizaos/plugin-bootstrap",
    "@elizaos/plugin-sql",
    "@elizaos/plugin-knowledge",
    autognosticPlugin,  // Add here
  ],
  // ... rest of character config
};
```

### Step 3: Run Database Migrations

**Option A: Automatic (PGlite)**
- Migrations run automatically on first plugin initialization
- Taxonomy seeding happens on first use

**Option B: Manual (PostgreSQL)**
```bash
# Run migrations in order
psql -U postgres -d your_database -f migrations/001_rename_to_autognostic.sql
psql -U postgres -d your_database -f migrations/002_add_sync_tables.sql
psql -U postgres -d your_database -f migrations/003_add_paper_classification_tables.sql
```

### Step 4: Verify Installation

Start agent and check logs for:
```
[autognostic] Initializing plugin...
[autognostic] Seeded 8 taxonomy nodes, 39 vocabulary terms
```

Or if already seeded:
```
[autognostic] Found 8 taxonomy nodes, 39 vocabulary terms
```

### Step 5: Test Basic Functionality

Send test messages to agent:

```
User: Add https://example.com/test.html to my knowledge base
Agent: ✅ Added https://example.com/test.html to Knowledge.
       📁 Zone: BRONZE | Size: 15.2 KB

User: List my documents
Agent: 📚 Knowledge Documents (1 total):
       1. example.com/test.html [BRONZE]
```

---

## Functional Test Scenarios

### Scenario 1: Regular Document Ingestion

**Setup:** None required

**Steps:**
1. Send: "Add https://docs.anthropic.com/en/docs/overview to knowledge"
2. Wait for response
3. Send: "List my documents"

**Expected:**
- Document added successfully
- Zone assigned as BRONZE (no DOI)
- Full content stored for quote retrieval
- Appears in document list

**Verification SQL:**
```sql
SELECT url, zone, content_hash, created_at 
FROM autognostic.documents 
WHERE url LIKE '%anthropic%';
```

---

### Scenario 2: Scientific Paper Detection (arXiv)

**Setup:** Ensure Crossref API is accessible

**Steps:**
1. Send: "Add https://arxiv.org/abs/1706.03762 to my knowledge"
2. Wait for response
3. Send: "What classification does the transformer paper have?"

**Expected:**
- Paper detected as scientific
- Crossref metadata fetched (title, authors, abstract)
- Zone: SILVER or GOLD depending on classification confidence
- Domain assigned (likely L1.ENGTECH or L1.FORMAL)

**Verification SQL:**
```sql
SELECT d.url, pc.zone, pc.primary_path, pc.confidence,
       pc.paper_metadata->>'title' as title
FROM autognostic.documents d
JOIN autognostic.paper_classification pc ON d.id = pc.document_id
WHERE d.url LIKE '%arxiv%';
```

---

### Scenario 3: DOI Direct Input

**Setup:** None required

**Steps:**
1. Send: "Add the paper with DOI 10.1038/nature12373 to knowledge"
2. Wait for response

**Expected:**
- DOI extracted and normalized
- Crossref lookup performed
- Full metadata fetched
- Paper classified appropriately

---

### Scenario 4: Document Removal with Cascade

**Setup:** Have at least one document added

**Steps:**
1. Send: "List my documents"
2. Note a document URL
3. Send: "Remove [document URL] from my knowledge"
4. Send: "List my documents"

**Expected:**
- Document removed from `autognostic.documents`
- Associated `autognostic.document_versions` removed
- Associated `autognostic.knowledge_link` removed
- ElizaOS knowledge entry removed
- No orphaned records

**Verification SQL:**
```sql
-- Should return empty
SELECT * FROM autognostic.documents WHERE url = '[removed_url]';
SELECT * FROM autognostic.document_versions WHERE document_id = [removed_id];
SELECT * FROM autognostic.knowledge_link WHERE document_id = [removed_id];
```

---

### Scenario 5: Version Tracking

**Setup:** Add a document first

**Steps:**
1. Send: "Enable version tracking for [document URL]"
2. Send: "Refresh [document URL]"
3. (Optionally modify the source document)
4. Send: "Refresh [document URL]" again
5. Send: "Show version history for [document URL]"

**Expected:**
- Version tracking enabled in settings
- Each refresh creates version record if content changed
- Version history shows timestamps and content hashes

---

### Scenario 6: Exact Quote Retrieval

**Setup:** Add a document with known content

**Steps:**
1. Add a document: "Add https://en.wikipedia.org/wiki/Attention to knowledge"
2. Send: "Quote from the attention article about cognitive processes"

**Expected:**
- Exact verbatim quote returned
- Line number or section reference provided
- Quote is from stored document, not generated

---

### Scenario 7: Scheduled Sync

**Setup:** Configure sync schedule

**Steps:**
1. Send: "Set refresh schedule to every hour"
2. Wait for scheduled time (or manually trigger)
3. Check logs for sync activity

**Expected:**
- Cron job registered
- At scheduled time, all sources checked
- Updated documents re-fetched
- Unchanged documents skipped (hash comparison)

---

## Regression Test Suite

Run these tests after any code changes to ensure no regressions:

### Core Functionality
- [ ] Plugin loads without errors
- [ ] All 10 actions register correctly
- [ ] All 3 services initialize
- [ ] All 2 providers register
- [ ] Schema creates required tables

### URL Processing
- [ ] HTTP URLs accepted
- [ ] HTTPS URLs accepted
- [ ] URLs with query params handled
- [ ] URLs with fragments handled
- [ ] Invalid URLs rejected with clear error

### Scientific Paper Detection
- [ ] arXiv URLs detected
- [ ] PubMed URLs detected
- [ ] DOI URLs detected (doi.org)
- [ ] Nature URLs detected
- [ ] IEEE URLs detected
- [ ] Plain DOI strings extracted from text
- [ ] Non-paper URLs correctly identified as regular documents

### Database Operations
- [ ] Insert document works
- [ ] Update document works
- [ ] Delete document cascades correctly
- [ ] Version creation works
- [ ] Taxonomy lookup works
- [ ] Concurrent access handled (no race conditions)

### Error Recovery
- [ ] Network failure doesn't crash agent
- [ ] Invalid input doesn't crash agent
- [ ] Database errors logged and handled
- [ ] API rate limits respected

---

## Performance Benchmarks

### Target Metrics

| Operation | Target | Measurement Method |
|-----------|--------|-------------------|
| Add single URL | < 3s | Time from request to confirmation |
| Add paper with classification | < 5s | Includes Crossref API call |
| List documents (100 items) | < 500ms | Database query + formatting |
| Remove document | < 1s | Cascade delete |
| Exact quote search | < 2s | Full-text search in stored content |
| Scheduled sync (10 sources) | < 30s | Full cycle time |

### Load Testing

```bash
# Simulate 10 concurrent document additions
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/message \
    -d "{\"text\": \"Add https://example.com/doc$i.html to knowledge\"}" &
done
wait
```

---

## Known Issues & Workarounds

### Issue 1: PGlite Initialization Delay

**Symptom:** First request after startup times out

**Cause:** PGlite embedded database takes 2-3 seconds to initialize

**Workaround:** Plugin init includes 2-second delay; first operation may still be slow

**Future Fix:** Implement connection pooling with retry logic

---

### Issue 2: Crossref Rate Limiting

**Symptom:** Paper classification fails intermittently

**Cause:** Crossref API has rate limits (50 req/sec for polite pool)

**Workaround:** 
- Set `CROSSREF_MAILTO` for polite pool access
- Papers fall back to BRONZE zone if API fails

**Future Fix:** Implement request queuing with exponential backoff

---

### Issue 3: Large Document Memory Usage

**Symptom:** High memory usage when adding large PDFs or documents

**Cause:** Full document content stored in memory during processing

**Workaround:** Size policy limits documents to configured maximum

**Future Fix:** Stream processing for large documents

---

### Issue 4: Taxonomy Classification Confidence

**Symptom:** Papers classified with low confidence (<50%)

**Cause:** Limited L2-L5 taxonomy data; relies on keyword matching

**Workaround:** Papers still stored as SILVER zone; classification improves with more taxonomy data

**Future Fix:** Expand taxonomy seed data; implement LLM-assisted classification

---

## Sign-Off Checklist

Before releasing to field testing:

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Build completes without warnings
- [ ] Lint passes with no errors
- [ ] Documentation up to date
- [ ] CHANGELOG updated
- [ ] Version number incremented (if applicable)
- [ ] README reflects current functionality
- [ ] Environment variables documented
- [ ] Migration scripts tested on clean database
- [ ] Known issues documented with workarounds
- [ ] Performance benchmarks within targets

---

## Appendix: Quick Reference

### Action Names
1. `ADD_URL_TO_KNOWLEDGE`
2. `MIRROR_SOURCE_TO_KNOWLEDGE`
3. `LIST_SOURCES`
4. `LIST_DOCUMENTS`
5. `GET_QUOTE`
6. `REMOVE_SOURCE`
7. `REMOVE_DOCUMENT`
8. `SET_AUTOGNOSTIC_SIZE_POLICY`
9. `SET_VERSION_TRACKING`
10. `REFRESH_SOURCE`

### Lakehouse Zones
- **BRONZE:** Raw document, no verification
- **SILVER:** DOI verified via Crossref, minimal classification
- **GOLD:** Fully classified with L1-L4 path and ≥50% confidence

### Taxonomy Levels
- **L1:** Domain (8 categories)
- **L2:** Discipline
- **L3:** Subdiscipline
- **L4:** Specialty
- **L5:** Research Focus (faceted: task, method, phenomenon, entity)

---

*End of Testing Checklist & Integration Guide*
