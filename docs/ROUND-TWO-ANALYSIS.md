# Plugin-Datamirror: Round Two Analysis Report

## Executive Summary

What began as "datamirror" - a simple document mirroring tool - has evolved into something fundamentally different: **a complete document ground-truth system for AI agents**. The plugin doesn't just mirror documents; it solves a critical problem in AI systems: **hallucination prevention through verifiable source material**.

---

## Complete Functionality Inventory

### Core Capabilities

| Capability | Description | Anti-Hallucination Role |
|------------|-------------|-------------------------|
| **URL Ingestion** | Fetch any public document by URL | Creates verifiable source |
| **Full Document Storage** | Stores complete unembedded text | Enables exact quote retrieval |
| **Source Discovery** | Auto-discovers docs via llms.txt, sitemap | Builds comprehensive corpus |
| **Version Tracking** | Content-hash based change detection | Ensures freshness |
| **Background Sync** | Automatic reconciliation worker | Keeps sources current |
| **Exact Quote Retrieval** | Line-by-line, search, full-document access | Prevents fabrication |
| **Document Inventory** | Lists all available sources | Agent knows its limits |

### Actions (7 Total)

| Action | Purpose | Auth Required |
|--------|---------|---------------|
| `ADD_URL_TO_KNOWLEDGE` | Single document ingestion | ✓ |
| `MIRROR_SOURCE_TO_KNOWLEDGE` | Bulk site discovery + ingestion | ✓ |
| `SET_DATAMIRROR_SIZE_POLICY` | Configure ingestion limits | ✓ |
| `SET_DATAMIRROR_REFRESH_POLICY` | Configure sync intervals | ✓ |
| `LIST_DATAMIRROR_SOURCES` | View mirrored sources | ✗ (read-only) |
| `REMOVE_DATAMIRROR_SOURCE` | Delete source + documents | ✓ |
| `GET_EXACT_QUOTE` | Programmatic text extraction | ✗ (read-only) |

### Provider

**`FULL_DOCUMENT_CONTENT`** - A high-priority provider that:
- Injects full document text into agent context when quotes are requested
- Provides document inventory so agent knows what's available
- Includes explicit anti-hallucination instructions
- Only loads full content when actually needed (performance optimized)

### Services

| Service | Role |
|---------|------|
| `HttpService` | Centralized HTTP with retry, timeout, raw text fetching |
| `GithubService` | GitHub API integration for repo mirroring |
| `DatamirrorService` | Startup orchestration, policy management |

---

## The Larger Scope: What This Plugin Actually Does

### Original Vision vs. Evolved Reality

**Original "datamirror" concept:**
> "Mirror documents from external sources into ElizaOS Knowledge"

**What it actually became:**
> "A verifiable ground-truth system that enables AI agents to quote accurately from source material, preventing hallucination by maintaining a parallel corpus of complete, unembedded documents alongside the vector-embedded Knowledge"

### The Key Innovation: Dual-Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENT INGESTION                        │
│                                                              │
│   URL → fetch → content                                      │
│                    │                                         │
│         ┌─────────┴─────────┐                               │
│         ▼                   ▼                                │
│   ┌───────────┐      ┌────────────────┐                     │
│   │ plugin-   │      │ datamirror     │                     │
│   │ knowledge │      │ documents      │                     │
│   │ (vectors) │      │ (full text)    │                     │
│   └───────────┘      └────────────────┘                     │
│         │                   │                                │
│         ▼                   ▼                                │
│   Semantic Search     Exact Quotes                          │
│   "What topics..."    "Quote line 5..."                     │
└─────────────────────────────────────────────────────────────┘
```

**plugin-knowledge** provides semantic search via embeddings.
**This plugin** provides the original text for accurate quotation.

Together, they form a complete RAG system where the agent can:
1. Find relevant documents via semantic search
2. Quote from them accurately via full-text retrieval

### Anti-Hallucination by Design

The provider's behavior is explicitly designed to prevent fabrication:

```
## IMPORTANT INSTRUCTIONS
- You MUST quote ONLY from the document text provided below
- Do NOT fabricate, guess, or hallucinate any content
- If the requested content is not in the documents below, 
  say "I don't have access to that specific content"
```

This is not just document storage - it's **epistemological infrastructure** for AI agents.

---

## Relationship to Existing ElizaOS Plugins

### Comparison Matrix

| Plugin | Primary Function | Stores Full Text | Enables Exact Quotes | Auto-Sync |
|--------|------------------|------------------|----------------------|-----------|
| **plugin-knowledge** | Semantic RAG | No (chunks + embeddings) | No | No |
| **plugin-sql** | Database adapter | N/A | N/A | N/A |
| **plugin-bootstrap** | Core behaviors | N/A | N/A | N/A |
| **This Plugin** | Ground truth | **Yes** | **Yes** | **Yes** |

### How It Complements plugin-knowledge

**plugin-knowledge:**
- Handles document upload/processing
- Creates embeddings for semantic search
- Retrieves relevant chunks based on query
- **Limitation:** Cannot provide exact quotes (chunks may be altered)

**This plugin:**
- Subscribes to the same document flow
- Stores complete, unmodified text
- Enables precise quote extraction
- **Fills the gap:** Agent can now say "Line 47 says: '...'" with confidence

### The Combined System

```typescript
// plugin-knowledge gives semantic relevance
const relevantDocs = await knowledge.search("API authentication methods");
// Returns: [{ doc: "auth-guide.md", relevance: 0.92 }]

// This plugin gives exact text
const quote = await getExactQuote(runtime, "auth-guide.md", "Bearer token");
// Returns: { found: true, quote: "Bearer token", lineNumber: 23, context: "..." }
```

---

## Suggested New Names

The name "datamirror" undersells what this plugin does. Here are alternatives that better reflect its evolved purpose:

### Top Recommendations

| Name | Rationale |
|------|-----------|
| **`plugin-groundtruth`** | Emphasizes the verification/anti-hallucination purpose |
| **`plugin-verbatim`** | Highlights exact quote capability |
| **`plugin-sourcetext`** | Clear: stores and retrieves source text |
| **`plugin-docstore`** | Simple, descriptive (document store) |
| **`plugin-citation`** | Emphasizes the academic/verification angle |

### Name Analysis

**`plugin-groundtruth`** ⭐ RECOMMENDED
- Clearly communicates the anti-hallucination purpose
- Suggests reliability and verification
- Differentiates from plugin-knowledge (which is about retrieval, not truth)
- Pairs well: "knowledge" (what you know) vs "groundtruth" (what's verifiable)

**`plugin-verbatim`**
- Emphasizes exact reproduction capability
- Latin root = "word for word"
- Clear but might seem narrow (plugin does more than quotes)

**`plugin-sourcetext`**
- Descriptive and clear
- Emphasizes that this stores the *source* material
- Slightly generic

**`plugin-docstore`**
- Simple and familiar
- Might be confused with general document storage
- Doesn't convey the verification purpose

**`plugin-citation`**
- Academic connotation
- Suggests proper attribution
- May imply reference management (not quite right)

---

## Recommendation

**Rename to: `@elizaos/plugin-groundtruth`**

### Updated Plugin Description

```typescript
export const groundtruthPlugin: Plugin = {
  name: "@elizaos/plugin-groundtruth",
  description:
    "Maintains verifiable source documents for accurate quotation. " +
    "Complements plugin-knowledge by storing full, unembedded text for " +
    "exact quote retrieval, preventing AI hallucination through ground-truth verification.",
  // ...
};
```

### Updated Tagline

> **plugin-groundtruth**: The anti-hallucination layer for ElizaOS agents. Store source documents, retrieve exact quotes, verify before you speak.

---

## Summary

This plugin evolved from a simple "mirror documents" utility into a **critical infrastructure component** for trustworthy AI agents. It solves the fundamental problem of how an AI can quote source material accurately when the semantic retrieval system (plugin-knowledge) only stores processed chunks.

The name "datamirror" reflects the original implementation detail (mirroring), not the actual value proposition (ground truth for quotation). A rename to `plugin-groundtruth` would:

1. Better communicate the plugin's purpose to developers
2. Position it correctly alongside plugin-knowledge
3. Highlight its anti-hallucination design philosophy
4. Make the ElizaOS plugin ecosystem more intuitive

---

## Next Steps (Round Two Implementation)

If you approve the rename, the following changes would be needed:

1. Rename package: `@elizaos/plugin-datamirror` → `@elizaos/plugin-groundtruth`
2. Update all internal references (schema names, service names, etc.)
3. Update GitHub repository name
4. Update documentation and README
5. Ensure backward compatibility (export alias for old name)
