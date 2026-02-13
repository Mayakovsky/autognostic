# Document Analysis Service — Implementation Plan
# ================================================
#
# PROBLEM: GET_EXACT_QUOTE can only operate on raw text with primitive regex
# mode detection. When a user says "give me the last two sentences" or "what's 
# in paragraph 3" or "how many words are in the document", the handler has no
# structural understanding of the document and falls back to full-doc dump.
#
# SOLUTION: Analyze document structure at ingest time and store a compact
# structural profile alongside the raw content. The handler can then use this
# profile to service arbitrary retrieval requests without re-parsing.
#
# DESIGN PRINCIPLES:
# - Compute once at ingest, query many times at retrieval
# - Profile is a small JSON blob (~1-2KB) stored in the existing documents table
# - No new tables needed — extends existing schema with one JSONB column
# - Handler mode detection becomes a lookup, not a regex guessing game
# - Profile data also feeds the provider (inventory shows word count, paragraphs, etc.)

## ARCHITECTURE

### 1. DocumentAnalyzer (new service)
# Location: src/services/DocumentAnalyzer.ts
#
# Pure function — takes raw text, returns a DocumentProfile.
# No database, no runtime dependency. Fully unit-testable.
#
# ```typescript
# interface DocumentProfile {
#   // Structural counts
#   charCount: number;
#   wordCount: number;
#   lineCount: number;           // total lines including blank
#   nonBlankLineCount: number;   // lines with content
#   sentenceCount: number;
#   paragraphCount: number;
#
#   // Structural boundaries (character offsets for O(1) extraction)
#   sentences: SentenceBoundary[];   // [{start, end, text}] — full sentence list
#   paragraphs: ParagraphBoundary[]; // [{start, end, lineStart, lineEnd, sentenceStart, sentenceEnd}]
#   lines: LineBoundary[];           // [{start, end}] — character offsets per line
#
#   // Content summary (for provider inventory)
#   firstSentence: string;         // Opening sentence (preview)
#   lastSentence: string;          // Closing sentence
#   avgWordsPerSentence: number;
#   avgSentencesPerParagraph: number;
#
#   // Computed at analysis time
#   analyzedAt: string;            // ISO timestamp
#   analyzerVersion: string;       // "1.0" — for future migration
# }
#
# interface SentenceBoundary {
#   index: number;        // 0-based sentence number
#   start: number;        // char offset in document
#   end: number;          // char offset end
#   lineNumber: number;   // 1-based line number where sentence starts
#   wordCount: number;    // words in this sentence
#   text: string;         // the actual sentence text (trimmed)
# }
#
# interface ParagraphBoundary {
#   index: number;          // 0-based paragraph number
#   start: number;          // char offset
#   end: number;            // char offset end
#   lineStart: number;      // 1-based first line
#   lineEnd: number;        // 1-based last line
#   sentenceStart: number;  // index of first sentence in this paragraph
#   sentenceEnd: number;    // index of last sentence in this paragraph
#   wordCount: number;
# }
#
# interface LineBoundary {
#   index: number;   // 0-based
#   start: number;   // char offset
#   end: number;     // char offset end (before newline)
# }
# ```
#
# Sentence detection: Split on `.!?` followed by whitespace or end-of-string,
# but NOT after common abbreviations (Mr., Dr., etc., e.g., i.e., vs., Fig., 
# No., Vol., approx.). Handle quoted speech. Handle ellipsis "...".
#
# Paragraph detection: Split on double newline (\n\n) or blank line patterns.
# Consecutive non-blank lines belong to the same paragraph.
#
# Performance: Documents up to 2MB (HTTP_DEFAULTS.MAX_CONTENT_BYTES).
# At 5 chars/word average, that's ~400K words. Sentence/paragraph detection
# is single-pass O(n). Storing boundaries for 400K-word docs could be large,
# so cap sentences[] at 10,000 entries and lines[] at 50,000.
# For docs exceeding caps, store only first/last 100 + total counts.

### 2. Schema Extension
# Location: src/db/schema.ts
#
# Add one column to autognosticDocuments:
#   profile: jsonb("profile").$type<DocumentProfile | null>()
#
# This requires a migration. The column is nullable so existing docs
# still work — profile gets computed lazily on first access or at ingest.
#
# Also add to mirrorDocToKnowledge: after storing content, run DocumentAnalyzer
# and update the row with the profile.

### 3. Enhanced getQuoteAction Handler  
# Location: src/actions/getQuoteAction.ts
#
# Replace the regex-based mode detection with profile-aware extraction.
# The handler loads the profile and uses boundary arrays for O(1) lookups.
#
# NEW MODES (in addition to existing):
#   - "last_n_sentences": last N sentences (e.g., "last two sentences")
#   - "first_n_sentences": first N sentences
#   - "last_n_words": last N words
#   - "first_n_words": first N words
#   - "paragraph": specific paragraph by number
#   - "last_paragraph": last paragraph
#   - "first_paragraph": first paragraph
#   - "range": line range (e.g., "lines 5 through 10")
#   - "stats": document statistics (word count, etc.)
#
# NEW MODE DETECTION PATTERNS:
#   /last\s+(\d+)\s+(?:sentences?|lines?|words?|paragraphs?)/
#   /first\s+(\d+)\s+(?:sentences?|lines?|words?|paragraphs?)/
#   /paragraph\s+(\d+)/
#   /lines?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)/
#   /how\s+many\s+(?:words?|lines?|sentences?|paragraphs?)/
#   /word\s+count/
#   /summary|stats|statistics|overview/
#
# When the user says "last two sentences":
#   1. Load profile (or compute lazily if missing)
#   2. profile.sentences.slice(-2)
#   3. Return the text of those sentences with their line numbers
#
# When the user says "how many words":
#   1. Load profile
#   2. Return profile.wordCount

### 4. Enhanced Provider (inventory with stats)
# Location: src/providers/fullDocumentProvider.ts
#
# The provider currently shows filename + size. With profiles, it can show:
#   - potato_chimpanzee_falafel_garb.md (3KB, 247 words, 12 sentences, 4 paragraphs)
#
# This gives the LLM context about what's available without dumping content.
# Also helps the LLM formulate better GET_EXACT_QUOTE calls.

### 5. Lazy Profile Computation
# For documents stored before the profile column exists, compute on first
# retrieval and cache back to the database. This means:
#   - getQuoteAction handler checks if profile exists
#   - If not, loads content, runs DocumentAnalyzer, stores profile
#   - Subsequent calls use cached profile
#
# This avoids a backfill migration while ensuring all documents get profiles.

## FILE CHANGES

### New files:
# 1. src/services/DocumentAnalyzer.ts          — Pure analysis function
# 2. src/services/DocumentAnalyzer.types.ts     — Type definitions
# 3. tests/DocumentAnalyzer.test.ts             — Unit tests

### Modified files:
# 4. src/db/schema.ts                           — Add profile column
# 5. src/db/autognosticDocumentsRepository.ts   — Add getProfile/updateProfile methods
# 6. src/integration/mirrorDocToKnowledge.ts    — Run analyzer at ingest
# 7. src/actions/getQuoteAction.ts              — Profile-aware handler with new modes
# 8. src/providers/fullDocumentProvider.ts       — Show stats in inventory
# 9. src/config/constants.ts                    — Analyzer limits

## IMPLEMENTATION ORDER

# Phase 1: Core analyzer + types (files 1-3)
#   - Implement DocumentAnalyzer with sentence/paragraph/line detection
#   - Write comprehensive tests with edge cases
#   - This is the foundation — get it right
#
# Phase 2: Schema + repository (files 4-5)
#   - Add profile column (nullable JSONB)
#   - Add repository methods for profile CRUD
#   - Migration will auto-run on next elizaos dev
#
# Phase 3: Ingest integration (file 6)
#   - After storing content in mirrorDocToKnowledge, run analyzer
#   - Store profile in the same transaction
#
# Phase 4: Handler rewrite (file 7)
#   - Replace regex mode detection with structured pattern matching
#   - Use profile boundaries for extraction
#   - Add lazy computation fallback for existing docs
#   - Add all new modes (last_n_sentences, paragraph, range, stats)
#
# Phase 5: Provider enhancement (file 8)
#   - Show document stats in inventory
#   - Include sentence/word counts
#
# Phase 6: Constants + cleanup (file 9)
#   - Add ANALYZER_DEFAULTS to constants
#   - Cap boundary arrays for large documents

## SENTENCE DETECTION ALGORITHM

# The core challenge. Here's the algorithm:
#
# 1. Normalize whitespace within paragraphs (collapse multiple spaces)
# 2. Walk the text character by character, tracking:
#    - Current position
#    - Whether we're inside quotes
#    - Whether we just saw an abbreviation
# 3. A sentence boundary is detected when:
#    a. Character is . ! or ?
#    b. AND next character is whitespace, newline, or end-of-string
#    c. AND we're not inside a known abbreviation pattern
#    d. AND we're not inside a decimal number (3.14)
#    e. AND we're not inside an ellipsis (...)
# 4. Known abbreviations (case-insensitive):
#    Mr., Mrs., Ms., Dr., Prof., Rev., Gen., Gov., Sgt., Cpl.,
#    Jr., Sr., St., Ave., Blvd., etc., e.g., i.e., vs., viz.,
#    Fig., No., Vol., Ch., Sec., Ed., al., approx., dept.,
#    Jan., Feb., Mar., Apr., Aug., Sept., Oct., Nov., Dec.
# 5. Handle edge cases:
#    - "Hello." he said. → 1 sentence (quote-final period)
#    - U.S.A. → not 3 sentences
#    - Dr. Smith went home. → 1 sentence
#    - "Really?" she asked. → 1 sentence
#    - End of sentence... New sentence. → 2 sentences
#
# This is ~100 lines of code. Handles 95%+ of English text correctly.

## TESTING STRATEGY

# Unit tests for DocumentAnalyzer:
# 1. Simple text: "Hello world. Goodbye." → 2 sentences
# 2. Abbreviations: "Dr. Smith went home." → 1 sentence
# 3. Ellipsis: "Wait... What?" → 2 sentences (or 1, design choice)
# 4. Multi-paragraph: "Para one.\n\nPara two." → 2 paragraphs
# 5. Empty lines: Multiple blank lines between paragraphs
# 6. Single line document
# 7. All-whitespace document
# 8. Very long document (performance test)
# 9. Markdown headers (# Title) → separate from paragraphs
# 10. Code blocks (``` ... ```) → preserve as-is within paragraph
# 11. The test documents from test_tube repo (real-world cases)

## CLI IMPLEMENTATION COMMAND

# The Claude Code CLI should:
# 1. Read this document
# 2. Implement Phase 1-6 in order
# 3. Run tests after Phase 1
# 4. Build and verify after each phase
# 5. Test end-to-end with elizaos dev after Phase 6
