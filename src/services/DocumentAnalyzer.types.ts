/**
 * Document structural profile — computed once at ingest, queried at retrieval.
 * Stored as JSONB in the autognostic_documents table.
 */

export interface SentenceBoundary {
  index: number;        // 0-based sentence number
  start: number;        // char offset in document
  end: number;          // char offset end (exclusive)
  lineNumber: number;   // 1-based line number where sentence starts
  wordCount: number;    // words in this sentence
  text: string;         // the actual sentence text (trimmed)
}

export interface ParagraphBoundary {
  index: number;          // 0-based paragraph number
  start: number;          // char offset
  end: number;            // char offset end (exclusive)
  lineStart: number;      // 1-based first line
  lineEnd: number;        // 1-based last line
  sentenceStart: number;  // index of first sentence in this paragraph
  sentenceEnd: number;    // index of last sentence in this paragraph
  wordCount: number;
}

export interface LineBoundary {
  index: number;   // 0-based
  start: number;   // char offset
  end: number;     // char offset end (before newline)
}

export interface DocumentProfile {
  // Structural counts
  charCount: number;
  wordCount: number;
  lineCount: number;           // total lines including blank
  nonBlankLineCount: number;   // lines with content
  sentenceCount: number;
  paragraphCount: number;

  // Structural boundaries (character offsets for O(1) extraction)
  sentences: SentenceBoundary[];
  paragraphs: ParagraphBoundary[];
  lines: LineBoundary[];

  // Content summary (for provider inventory)
  firstSentence: string;
  lastSentence: string;
  avgWordsPerSentence: number;
  avgSentencesPerParagraph: number;

  // Computed at analysis time
  analyzedAt: string;       // ISO timestamp
  analyzerVersion: string;  // "1.0" — for future migration
}
