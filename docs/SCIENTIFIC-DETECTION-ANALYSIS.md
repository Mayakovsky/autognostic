# Scientific Article Detection Analysis Report
## Plugin Autognostic - Code Review

**Date:** February 1, 2026  
**Reviewer:** Claude Opus 4.5  
**Codebase:** `C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic`

---

## Executive Summary

I've completed a thorough review of the plugin-autognostic codebase. The scientific article detection apparatus is **implemented but not integrated** into the ingestion pipeline. The lakehouse pattern for medical science specificity would require moderate additional work.

### Key Findings

| Finding | Severity | Status |
|---------|----------|--------|
| `ScientificPaperDetector` exists but is **never called** | 🔴 CRITICAL | Not wired |
| Schema supports static detection metadata | ✅ GOOD | Complete |
| `ScheduledSyncService` correctly skips static content | ✅ GOOD | Working |
| No medical-specific classification | 🟡 GAP | Not implemented |
| STATUS.md still references old `datamirror` naming | 🟠 STALE | Needs update |

---

## Part 1: Scientific Paper Detector Analysis

### 1.1 Implementation Quality: ✅ GOOD

The `ScientificPaperDetector` class at `src/services/ScientificPaperDetector.ts` is well-implemented:

```typescript
// Detection pipeline (4 steps)
1. URL Pattern Analysis → 15 patterns covering major publishers
2. DOI Extraction from URL → handles doi.org and embedded DOIs
3. Crossref DOI Verification → validates via API
4. ISSN Verification (fallback) → validates journals
```

**Strengths:**
- Covers major preprint servers (arxiv, biorxiv, medrxiv)
- Covers major publishers (Nature, Science, Springer, Wiley, IEEE, ACM)
- Includes PubMed/PMC patterns
- Proper Crossref API integration with timeout handling
- Confidence levels (high/medium) based on verification method

**URL Patterns Covered:**
```
arxiv.org, biorxiv.org, medrxiv.org
sciencedirect.com, springer.com, nature.com
science.org, acs.org, wiley.com
ieeexplore.ieee.org, dl.acm.org
doi.org, ncbi.nlm.nih.gov (pubmed/pmc)
jstor.org, semanticscholar.org
```

### 1.2 Critical Gap: NOT WIRED INTO PIPELINE 🔴

**Problem:** The `ScientificPaperDetector` is defined but **never instantiated or called** during document ingestion.

**Evidence:**
- Searching the codebase for `ScientificPaperDetector` or `getScientificPaperDetector` yields only the definition file
- `addUrlToKnowledgeAction.ts` does NOT call the detector
- `mirrorDocToKnowledge.ts` does NOT call the detector
- `ReconciliationService.ts` does NOT call the detector

**Impact:** All documents are ingested without static content detection. The `isStaticContent` and `staticDetectionMetadata` fields in the schema are never populated.

### 1.3 Schema Support: ✅ COMPLETE

The `autognosticSources` table correctly includes:

```typescript
versionTrackingEnabled: boolean  // defaults to true
isStaticContent: boolean         // defaults to false
staticDetectionMetadata: jsonb   // StaticDetectionMetadata type
lastSyncAt: timestamp
nextSyncAt: timestamp
```

The `StaticDetectionMetadata` interface is well-defined:
```typescript
interface StaticDetectionMetadata {
  detectedAt: string;
  reason: 'doi_verified' | 'issn_verified' | 'url_pattern' | 'content_analysis' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  doi?: string;
  issn?: string;
  crossrefData?: {
    type?: string;
    title?: string;
    journal?: string;
    publisher?: string;
    publishedDate?: string;
  };
}
```

### 1.4 Sync Service Integration: ✅ CORRECT

The `ScheduledSyncService` at `src/services/ScheduledSyncService.ts` correctly handles static content:

```typescript
// Skip sources with version tracking disabled
if (!source.versionTrackingEnabled) {
  stats.sourcesSkipped++;
  console.log(`[autognostic] Skipping ${source.id}: version tracking disabled`);
  continue;
}

// Skip static content
if (source.isStaticContent) {
  stats.sourcesSkipped++;
  console.log(`[autognostic] Skipping ${source.id}: static content`);
  continue;
}
```

**This is correct** — once a document is marked as static, it won't be re-synced.

---

## Part 2: Required Fix - Wire Up Detection

### 2.1 Fix Location

The detector should be called in `addUrlToKnowledgeAction.ts` after URL extraction but before ingestion:

```typescript
// In addUrlToKnowledgeAction.ts handler(), after URL extraction:

import { getScientificPaperDetector } from "../services/ScientificPaperDetector";

// ... inside handler ...

const detector = getScientificPaperDetector();
const detection = await detector.detect(url);

// Store detection result with the source
const sourceMetadata = {
  addedVia: "ADD_URL_TO_KNOWLEDGE",
  sourceId,
  versionId,
  isStaticContent: detection.isStatic,
  staticDetectionMetadata: detection.metadata,
};
```

### 2.2 Full Fix Implementation

**File:** `src/actions/addUrlToKnowledgeAction.ts`

Add after line ~85 (after URL extraction, before mirrorDocToKnowledge):

```typescript
import { getScientificPaperDetector } from "../services/ScientificPaperDetector";
import { AutognosticSourcesRepository } from "../db/autognosticSourcesRepository";

// Inside handler, after URL validation:

// Detect if this is static content (scientific paper)
const detector = getScientificPaperDetector();
let detection: { isStatic: boolean; metadata: any } = { isStatic: false, metadata: null };

try {
  detection = await detector.detect(url);
  if (detection.isStatic) {
    console.log(
      `[autognostic] Detected static content: ${url} (${detection.metadata?.reason}, confidence: ${detection.metadata?.confidence})`
    );
  }
} catch (err) {
  console.warn(`[autognostic] Static detection failed for ${url}:`, err);
}

// Update source record with static detection results
const sourcesRepo = new AutognosticSourcesRepository(runtime);
await sourcesRepo.updateStaticDetection(sourceId, {
  isStaticContent: detection.isStatic,
  versionTrackingEnabled: !detection.isStatic, // Disable version tracking for static content
  staticDetectionMetadata: detection.metadata,
});
```

### 2.3 Repository Method Needed

**File:** `src/db/autognosticSourcesRepository.ts`

Add method:

```typescript
async updateStaticDetection(
  sourceId: string,
  data: {
    isStaticContent: boolean;
    versionTrackingEnabled: boolean;
    staticDetectionMetadata: StaticDetectionMetadata | null;
  }
): Promise<void> {
  const db = await getDb(this.runtime);
  await db
    .update(autognosticSources)
    .set({
      isStaticContent: data.isStaticContent,
      versionTrackingEnabled: data.versionTrackingEnabled,
      staticDetectionMetadata: data.staticDetectionMetadata,
      updatedAt: new Date(),
    })
    .where(eq(autognosticSources.id, sourceId));
}
```

---

## Part 3: Lakehouse Pattern for Medical Specificity

### 3.1 Current Gap

The current detector identifies **any** peer-reviewed content but cannot distinguish:
- Medical vs. physics vs. computer science papers
- Journal quality tiers
- Evidence levels (RCT vs. case study)
- Retraction status

### 3.2 Lakehouse Implementation Approach

**Bronze Zone (Raw):** Current implementation — accept all URLs
**Silver Zone (Validated):** Crossref-verified + non-predatory publisher
**Gold Zone (Medical-Curated):** Medical subject area + MeSH terms

### 3.3 Recommended Schema Addition

**New table:** `autognostic_document_quality`

```sql
CREATE TABLE autognostic.document_quality (
  id TEXT PRIMARY KEY,
  document_id UUID REFERENCES autognostic.documents(id) ON DELETE CASCADE,
  
  -- Lakehouse zone
  zone TEXT NOT NULL DEFAULT 'bronze',  -- 'bronze' | 'silver' | 'gold'
  promoted_at TIMESTAMPTZ,
  
  -- Silver-level enrichment
  is_peer_reviewed BOOLEAN,
  publisher_reputation TEXT,  -- 'reputable' | 'unknown' | 'predatory'
  subject_areas JSONB,
  
  -- Gold-level enrichment (medical)
  medical_specialty JSONB,
  mesh_terms JSONB,
  evidence_level TEXT,
  pubmed_id TEXT,
  is_retracted BOOLEAN DEFAULT FALSE,
  retraction_checked_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 Implementation Effort Estimate

| Component | Effort | Priority |
|-----------|--------|----------|
| Wire up existing detector | 2 hours | 🔴 P0 |
| Add `updateStaticDetection` repo method | 30 min | 🔴 P0 |
| Add `document_quality` table | 1 hour | 🟡 P1 |
| Implement Silver zone promotion | 4 hours | 🟡 P1 |
| Integrate PubMed API for Gold zone | 6 hours | 🟢 P2 |
| Add MeSH term extraction | 4 hours | 🟢 P2 |
| Retraction checking | 2 hours | 🟢 P2 |

**Total:** ~20 hours for full lakehouse

---

## Part 4: Other Observations

### 4.1 STATUS.md Is Stale

The file still references `datamirror` naming throughout. Should be updated to reflect `autognostic` rename.

### 4.2 Missing Integration Tests

The STATUS.md shows:
```
- [ ] Integration tested in Eliza monorepo
- [ ] Functional tests pass
```

### 4.3 GitHub Discovery Not Implemented

```
- [ ] GitHub repo discovery implemented (optional)
```

This would be valuable for ingesting entire repositories.

---

## Part 5: Recommended Action Plan

### Immediate (This Session)

1. **Wire up ScientificPaperDetector** in `addUrlToKnowledgeAction.ts`
2. **Add `updateStaticDetection`** method to sources repository
3. **Update STATUS.md** with autognostic naming

### Short-Term (Next Sprint)

4. Add `document_quality` table schema
5. Implement Silver zone promotion (predatory check)
6. Add `LIST_GOLD_ZONE_DOCUMENTS` action

### Medium-Term

7. Integrate PubMed API for Gold zone
8. Add MeSH term extraction
9. Implement retraction checking

---

## Conclusion

The scientific paper detection code is **well-written but disconnected**. The immediate priority is wiring the existing `ScientificPaperDetector` into the ingestion pipeline. The lakehouse pattern is a sound approach for medical specificity but requires additional schema and API integrations.

**Recommendation:** Fix the wiring issue first (2-3 hours), then evaluate if the full lakehouse pattern is needed based on your use case.
