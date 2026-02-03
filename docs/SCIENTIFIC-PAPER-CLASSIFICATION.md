# Scientific Paper Classification System
## Plugin Autognostic - Implementation Guide

**Version:** 1.0.0  
**Date:** February 2, 2026  
**Based on:** `scientific_paper_classification_schema.md`

---

## Overview

This document describes the implementation of a 5-level scientific paper classification system integrated into the Autognostic plugin. The system automatically detects scientific papers, extracts metadata, and classifies them according to a hierarchical taxonomy.

### Key Features

1. **Automatic Detection** - Identifies scientific papers from URL patterns, DOIs, ISSNs, and content analysis
2. **Metadata Extraction** - Pulls title, authors, journal, abstract from Crossref API
3. **5-Level Classification** - Hierarchical taxonomy from Domain (L1) to Research Focus (L5)
4. **Lakehouse Zones** - Bronze/Silver/Gold quality tiers for knowledge curation
5. **Enriched Storage** - Classification metadata prepended to document content

---

## Architecture

### Lakehouse Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SCIENTIFIC PAPER LAKEHOUSE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐                       │
│  │  BRONZE   │ →  │  SILVER   │ →  │   GOLD    │                       │
│  │   Zone    │    │   Zone    │    │   Zone    │                       │
│  └───────────┘    └───────────┘    └───────────┘                       │
│       ↑                                                                 │
│   Any document       DOI/ISSN         Classified                       │
│                     verified          with L1-L4                        │
│                                       + L5 focus                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| Zone | Criteria | Confidence |
|------|----------|------------|
| **Bronze** | Any ingested document | N/A |
| **Silver** | DOI/ISSN verified via Crossref | ≥ Medium |
| **Gold** | Classified with primary path + focus facets | ≥ 50% |

### Component Flow

```
User: "Add https://arxiv.org/abs/2301.12345 to knowledge"
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ AddUrlToKnowledgeAction                                                 │
│   ├── Extract URL                                                       │
│   ├── Validate auth                                                     │
│   └── Call mirrorDocToKnowledge() → stores raw content                  │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ScientificPaperDetector                                                 │
│   ├── URL pattern matching (50+ patterns)                               │
│   ├── DOI extraction and Crossref verification                          │
│   ├── ISSN verification                                                 │
│   ├── arXiv/PubMed ID detection                                         │
│   └── Returns: isScientificPaper, metadata, suggestedDomain             │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ScientificPaperHandler                                                  │
│   ├── Determine lakehouse zone (Bronze/Silver/Gold)                     │
│   ├── Run classification (L1-L4 path + L5 focus)                        │
│   ├── Store classification record                                       │
│   ├── Build enriched content with metadata header                       │
│   └── Update source as static content (disable version tracking)        │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Response to User                                                        │
│   "Added scientific paper to Knowledge.                                 │
│    📄 "Attention Is All You Need"                                       │
│    🥇 Lakehouse Zone: GOLD | Domain: L1.ENGTECH"                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5-Level Taxonomy

### Level 1: Domain (~8 categories)

| ID | Name | Keywords |
|----|------|----------|
| `L1.NATSCI` | Natural Sciences | physics, chemistry, astronomy, earth science |
| `L1.LIFESCI` | Life Sciences | biology, ecology, genetics, neuroscience |
| `L1.MEDHLT` | Medical & Health Sciences | medicine, clinical, health, pharmaceutical |
| `L1.ENGTECH` | Engineering & Technology | engineering, computer science, robotics |
| `L1.SOCSCI` | Social Sciences | economics, psychology, sociology |
| `L1.HUMARTS` | Humanities & Arts | history, philosophy, linguistics |
| `L1.INTERDIS` | Interdisciplinary & Applied | environmental, data science, policy |
| `L1.FORMAL` | Formal & Computational | mathematics, statistics, optimization |

### Levels 2-4: Discipline → Subdiscipline → Specialty

Example path:
```
L1.NATSCI (Natural Sciences)
  └── L2.NATSCI.PHYS (Physics)
        └── L3.NATSCI.PHYS.COND_MAT (Condensed Matter)
              └── L4.NATSCI.PHYS.COND_MAT.SUPERCONDUCT (Superconductivity)
```

### Level 5: Research Focus (Structured Facets)

| Facet | Description | Example Values |
|-------|-------------|----------------|
| `taskStudyType` | What kind of study | theory, experiment_in_vivo, simulation, meta_analysis |
| `methodApproach` | How it was done | deep_learning, spectroscopy, bayesian_modeling |
| `phenomenonTopic` | What was studied | (extracted from content) |
| `entitySystem` | What system/entity | (extracted from content) |
| `freeTextFocus` | Summary (≤160 chars) | "Flux pinning effects on vortex motion..." |

---

## Database Schema

### Tables

```sql
-- Paper classification records
autognostic.paper_classification
  ├── id (UUID, PK)
  ├── document_id (UUID, FK)
  ├── zone ('bronze' | 'silver' | 'gold')
  ├── primary_path (JSONB: {l1, l2, l3?, l4?})
  ├── secondary_paths (JSONB[])
  ├── focus (JSONB: ResearchFocus)
  ├── confidence (REAL: 0.0-1.0)
  ├── evidence (JSONB[])
  ├── paper_metadata (JSONB)
  └── classifier_version (TEXT)

-- Taxonomy nodes (L1-L4)
autognostic.taxonomy_nodes
  ├── id (TEXT, PK) -- e.g., "L1.NATSCI"
  ├── level (INTEGER: 1-4)
  ├── name (TEXT)
  ├── parent_id (TEXT, FK)
  ├── keywords (JSONB[])
  └── status ('active' | 'deprecated')

-- Controlled vocabulary (L5 facets)
autognostic.controlled_vocab
  ├── id (TEXT, PK)
  ├── facet_type (TEXT) -- 'task_study_type', 'method_approach', etc.
  ├── term (TEXT)
  └── usage_count (INTEGER)
```

### Migration

Run migration `003_add_paper_classification_tables.sql` to create tables and seed starter taxonomy.

---

## Usage

### Automatic Processing

When a user adds a URL, the system automatically:

1. Detects if it's a scientific paper
2. Extracts metadata from Crossref
3. Classifies according to 5-level taxonomy
4. Stores enriched content with classification header

```
User: Add https://doi.org/10.1038/nature12373 to knowledge

Agent: Added scientific paper to Knowledge.
       📄 "Crystal structure of the calcium pump..."
       🥇 Lakehouse Zone: GOLD | Domain: L1.LIFESCI
       Full document archived with classification metadata.
```

### Enriched Content Format

Stored documents include a metadata header:

```markdown
---
# AUTOGNOSTIC SCIENTIFIC PAPER METADATA
# Zone: GOLD
# Classifier: cls_v0.1
# Classified: 2026-02-02T12:00:00.000Z
---

**DOI:** 10.1038/nature12373
**Title:** Crystal structure of the calcium pump
**Authors:** T. Shinoda, H. Ogawa, F. Cornelius, C. Toyoshima
**Journal:** Nature
**Published:** 2009-3-4

## Classification
**Domain (L1):** L1.LIFESCI
**Discipline (L2):** L2.LIFESCI.BIOCHEM
**Confidence:** 78.5%

## Research Focus
**Study Type:** experiment_in_vitro
**Methods:** xray_diffraction, cryo_em
**Focus:** Crystal structure of Na+,K+-ATPase in E2P state

---
# ORIGINAL CONTENT
---

[Original paper content here...]
```

---

## API Reference

### ScientificPaperDetector

```typescript
import { getScientificPaperDetector } from "@elizaos/plugin-autognostic";

const detector = getScientificPaperDetector();
const result = await detector.detect(url, content);

// result: {
//   isScientificPaper: boolean,
//   isStatic: boolean,
//   metadata: StaticDetectionMetadata | null,
//   paperMetadata: PaperMetadata | null,
//   suggestedDomain?: string
// }
```

### ScientificPaperHandler

```typescript
import { createScientificPaperHandler } from "@elizaos/plugin-autognostic";

const handler = createScientificPaperHandler(runtime);
const result = await handler.process(url, content, documentId);

// result: {
//   documentId: string,
//   classificationId: string,
//   zone: "bronze" | "silver" | "gold",
//   isScientificPaper: boolean,
//   classification: ClassificationResult | null,
//   paperMetadata: PaperMetadata | null,
//   enrichedContent: string
// }

// List Gold-zone papers
const goldPapers = await handler.listGoldPapers();
```

---

## Configuration

### Environment Variables

```env
# Crossref API (optional, improves rate limits)
CROSSREF_MAILTO=your@email.com
```

### Extending the Taxonomy

To add new taxonomy nodes:

```sql
INSERT INTO autognostic.taxonomy_nodes (id, level, name, parent_id, keywords)
VALUES (
  'L3.ENGTECH.CS.ML',
  3,
  'Machine Learning',
  'L2.ENGTECH.CS',
  '["machine learning", "neural network", "deep learning", "ai"]'
);
```

To add new controlled vocabulary:

```sql
INSERT INTO autognostic.controlled_vocab (id, facet_type, term, definition)
VALUES (
  'method.transformers',
  'method_approach',
  'transformer_architecture',
  'Transformer neural network architecture'
);
```

---

## Future Enhancements

1. **LLM-based Classification** - Use Claude for more accurate L3-L4 assignment
2. **Embedding Similarity** - Match papers to taxonomy nodes via embeddings
3. **Citation Graph** - Build co-classification edges for discovery
4. **Novelty Detection** - Extract novelty claims from abstracts
5. **Interdisciplinary Scoring** - Entropy-based measure of cross-domain bridging

---

## Files Modified/Created

| File | Change |
|------|--------|
| `src/db/schema.ts` | Added paper_classification, taxonomy_nodes, controlled_vocab tables |
| `src/services/ScientificPaperDetector.ts` | Enhanced with 50+ URL patterns, extended metadata extraction |
| `src/services/ScientificPaperHandler.ts` | **NEW** - Classification and enrichment logic |
| `src/actions/addUrlToKnowledgeAction.ts` | Integrated paper detection and classification |
| `src/index.ts` | Export new services and types |
| `migrations/003_add_paper_classification_tables.sql` | **NEW** - Database migration |
| `docs/SCIENTIFIC-PAPER-CLASSIFICATION.md` | **NEW** - This documentation |

---

## Testing

```bash
# Build
pnpm build

# Run tests
pnpm test

# Test with a real paper
# In agent conversation:
# "Add https://arxiv.org/abs/2301.12345 to knowledge"
```
