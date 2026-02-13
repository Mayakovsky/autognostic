/**
 * DocumentAnalyzer — pure function that computes structural profiles.
 *
 * Takes raw text, returns a DocumentProfile with sentence/paragraph/line
 * boundaries for O(1) extraction at retrieval time.
 *
 * No database, no runtime dependency. Fully unit-testable.
 */

import type {
  DocumentProfile,
  SentenceBoundary,
  ParagraphBoundary,
  LineBoundary,
} from "./DocumentAnalyzer.types";

// Re-export types for convenience
export type { DocumentProfile, SentenceBoundary, ParagraphBoundary, LineBoundary };

/** Limits to prevent unbounded profile sizes on huge documents */
const MAX_SENTENCES = 10_000;
const MAX_LINES = 50_000;
const MAX_PARAGRAPHS = 5_000;
const CAP_KEEP = 100; // keep first/last N when capping

/**
 * Known abbreviations that should NOT trigger sentence boundaries.
 * Case-insensitive matching. The trailing period is NOT included here.
 */
const ABBREVIATIONS = new Set([
  // Titles
  "mr", "mrs", "ms", "dr", "prof", "rev", "gen", "gov", "sgt", "cpl",
  "jr", "sr", "lt", "col", "maj", "capt",
  // Address
  "st", "ave", "blvd", "rd", "apt",
  // Latin / academic
  "etc", "e.g", "i.e", "vs", "viz", "al", "approx", "dept", "est",
  "fig", "no", "vol", "ch", "sec", "ed",
  // Months
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec",
]);

/** Count words in a string (split on whitespace, filter empties) */
function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Detect line boundaries. Lines are separated by \n.
 * Returns array of LineBoundary and total/non-blank counts.
 */
function detectLines(text: string): {
  lines: LineBoundary[];
  lineCount: number;
  nonBlankLineCount: number;
} {
  const lines: LineBoundary[] = [];
  let pos = 0;
  let nonBlank = 0;

  // Handle empty string
  if (text.length === 0) {
    return { lines: [], lineCount: 0, nonBlankLineCount: 0 };
  }

  let lineIdx = 0;
  while (pos <= text.length) {
    const newlinePos = text.indexOf("\n", pos);
    const end = newlinePos === -1 ? text.length : newlinePos;

    lines.push({ index: lineIdx, start: pos, end });

    const lineContent = text.substring(pos, end);
    if (lineContent.trim().length > 0) nonBlank++;

    lineIdx++;
    if (newlinePos === -1) break;
    pos = newlinePos + 1;
  }

  return { lines, lineCount: lines.length, nonBlankLineCount: nonBlank };
}

/**
 * Detect paragraph boundaries.
 * Paragraphs are groups of consecutive non-blank lines separated by blank lines.
 */
function detectParagraphs(
  text: string,
  lines: LineBoundary[]
): ParagraphBoundary[] {
  if (lines.length === 0) return [];

  const paragraphs: ParagraphBoundary[] = [];
  let paraStart: number | null = null;
  let paraLineStart = 0;
  let paraIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineText = text.substring(line.start, line.end).trim();
    const isBlank = lineText.length === 0;

    if (!isBlank && paraStart === null) {
      // Start of a new paragraph
      paraStart = line.start;
      paraLineStart = i;
    } else if (isBlank && paraStart !== null) {
      // End of current paragraph (the line before this blank one)
      const prevLine = lines[i - 1];
      paragraphs.push({
        index: paraIdx,
        start: paraStart,
        end: prevLine.end,
        lineStart: paraLineStart + 1, // 1-based
        lineEnd: i, // 1-based (previous line index + 1, but i-1 is 0-based so i is 1-based equivalent)
        sentenceStart: -1, // filled in later
        sentenceEnd: -1,
        wordCount: countWords(text.substring(paraStart, prevLine.end)),
      });
      paraIdx++;
      paraStart = null;
    }
  }

  // Close final paragraph if text doesn't end with blank line
  if (paraStart !== null) {
    const lastLine = lines[lines.length - 1];
    paragraphs.push({
      index: paraIdx,
      start: paraStart,
      end: lastLine.end,
      lineStart: paraLineStart + 1,
      lineEnd: lines.length,
      sentenceStart: -1,
      sentenceEnd: -1,
      wordCount: countWords(text.substring(paraStart, lastLine.end)),
    });
  }

  return paragraphs;
}

/**
 * Check if a word before a period is a known abbreviation.
 * Looks backward from the period position to find the preceding word.
 */
function isAbbreviation(text: string, periodPos: number): boolean {
  // Walk backward to find the start of the word containing this period
  let wordStart = periodPos - 1;
  while (wordStart >= 0 && /[a-zA-Z.]/.test(text[wordStart])) {
    wordStart--;
  }
  wordStart++;

  const word = text.substring(wordStart, periodPos).toLowerCase();

  // Check if the word (without trailing period) is a known abbreviation
  if (ABBREVIATIONS.has(word)) return true;

  // Handle multi-period abbreviations like "e.g" "i.e" "U.S.A"
  const stripped = word.replace(/\./g, "");
  if (ABBREVIATIONS.has(stripped)) return true;

  // Single letter followed by period (likely initial): "A." "J." "U."
  if (word.length === 1 && /[A-Za-z]/.test(word)) return true;

  // Multi-letter all-caps with dots: U.S.A, U.K, etc.
  if (/^[A-Z](\.[A-Z])+$/i.test(word + ".")) return true;

  return false;
}

/**
 * Detect sentence boundaries using character-by-character scanning.
 *
 * A sentence boundary is detected when:
 * 1. Character is . ! or ?
 * 2. Next non-quote character is whitespace, newline, or end-of-string
 * 3. Not inside a known abbreviation
 * 4. Not inside a decimal number (3.14)
 * 5. Not inside an ellipsis (...)
 */
function detectSentences(
  text: string,
  lines: LineBoundary[]
): SentenceBoundary[] {
  if (!text.trim()) return [];

  const sentences: SentenceBoundary[] = [];
  let sentenceStart = -1;
  let i = 0;

  // Skip leading whitespace to find first sentence start
  while (i < text.length && /\s/.test(text[i])) i++;
  sentenceStart = i;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "." || ch === "!" || ch === "?") {
      // Check for ellipsis: ...
      if (ch === "." && i + 1 < text.length && text[i + 1] === ".") {
        // Skip all consecutive dots (ellipsis)
        while (i < text.length && text[i] === ".") i++;
        // After ellipsis, if followed by whitespace + uppercase or end, it's a boundary
        // But ellipsis mid-sentence continues: "Wait... what?"
        // We'll treat ellipsis as boundary only if followed by space + uppercase
        let afterDots = i;
        // Skip trailing closing quotes/parens after dots
        while (afterDots < text.length && /[)"'\u201D\u2019]/.test(text[afterDots])) afterDots++;
        if (afterDots >= text.length) {
          // End of text after ellipsis — close sentence
          pushSentence(sentences, text, lines, sentenceStart, afterDots);
          break;
        }
        if (/\s/.test(text[afterDots])) {
          // Look ahead past whitespace for uppercase
          let peek = afterDots;
          while (peek < text.length && /\s/.test(text[peek])) peek++;
          if (peek < text.length && /[A-Z\u201C"(]/.test(text[peek])) {
            // Boundary after ellipsis
            pushSentence(sentences, text, lines, sentenceStart, afterDots);
            sentenceStart = peek;
            i = peek;
            continue;
          }
        }
        // Not a boundary — continue scanning
        continue;
      }

      // Check for decimal number: digit.digit
      if (ch === "." && i > 0 && /\d/.test(text[i - 1]) && i + 1 < text.length && /\d/.test(text[i + 1])) {
        i++;
        continue;
      }

      // Check for abbreviation
      if (ch === "." && isAbbreviation(text, i)) {
        i++;
        continue;
      }

      // Advance past the sentence-ending punctuation
      i++;

      // Skip any additional closing punctuation: )" ' etc.
      while (i < text.length && /[)"'\u201D\u2019]/.test(text[i])) i++;

      // Check what follows
      if (i >= text.length) {
        // End of text — close sentence
        pushSentence(sentences, text, lines, sentenceStart, i);
        break;
      }

      if (/\s/.test(text[i]) || text[i] === "\n") {
        // Whitespace after punctuation — sentence boundary
        pushSentence(sentences, text, lines, sentenceStart, i);
        // Skip whitespace to find next sentence start
        while (i < text.length && /\s/.test(text[i])) i++;
        sentenceStart = i;
        continue;
      }

      // No whitespace after punctuation — not a boundary (e.g., ".com")
      continue;
    }

    i++;
  }

  // If there's trailing text that wasn't closed by punctuation, capture it
  if (sentenceStart >= 0 && sentenceStart < text.length) {
    const remaining = text.substring(sentenceStart).trim();
    if (remaining.length > 0 && sentences.length === 0 || (sentences.length > 0 && sentences[sentences.length - 1].end <= sentenceStart)) {
      pushSentence(sentences, text, lines, sentenceStart, text.length);
    }
  }

  return sentences;
}

/** Helper to push a sentence boundary, computing line number and word count */
function pushSentence(
  sentences: SentenceBoundary[],
  text: string,
  lines: LineBoundary[],
  start: number,
  end: number
): void {
  const sentenceText = text.substring(start, end).trim();
  if (sentenceText.length === 0) return;

  // Find line number (1-based) using binary search on line boundaries
  let lineNumber = 1;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].start <= start && start <= lines[j].end) {
      lineNumber = j + 1;
      break;
    }
  }

  sentences.push({
    index: sentences.length,
    start,
    end,
    lineNumber,
    wordCount: countWords(sentenceText),
    text: sentenceText,
  });
}

/**
 * Wire sentences into paragraphs — set sentenceStart/sentenceEnd on each paragraph.
 */
function wireSentencesToParagraphs(
  paragraphs: ParagraphBoundary[],
  sentences: SentenceBoundary[]
): void {
  if (paragraphs.length === 0 || sentences.length === 0) return;

  let sIdx = 0;
  for (const para of paragraphs) {
    para.sentenceStart = -1;
    para.sentenceEnd = -1;

    while (sIdx < sentences.length) {
      const s = sentences[sIdx];
      // Sentence starts within this paragraph's character range
      if (s.start >= para.start && s.start < para.end + 1) {
        if (para.sentenceStart === -1) para.sentenceStart = s.index;
        para.sentenceEnd = s.index;
        sIdx++;
      } else if (s.start >= para.end + 1) {
        break;
      } else {
        sIdx++;
      }
    }
    // Reset sIdx for next paragraph won't work because sentences are ordered.
    // Actually keep sIdx advancing since both are in order.
  }
}

/**
 * Cap boundary arrays for very large documents.
 * Keeps first CAP_KEEP + last CAP_KEEP entries.
 */
function capArray<T extends { index: number }>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  return [...arr.slice(0, CAP_KEEP), ...arr.slice(-CAP_KEEP)];
}

/**
 * Analyze a document and produce its structural profile.
 *
 * Pure function — no side effects, no database, no runtime.
 */
export function analyzeDocument(text: string): DocumentProfile {
  const charCount = text.length;
  const wordCount = countWords(text);

  // Detect structural boundaries
  const { lines, lineCount, nonBlankLineCount } = detectLines(text);
  const paragraphs = detectParagraphs(text, lines);
  const sentences = detectSentences(text, lines);

  // Wire sentences to paragraphs
  wireSentencesToParagraphs(paragraphs, sentences);

  const sentenceCount = sentences.length;
  const paragraphCount = paragraphs.length;

  const firstSentence = sentences.length > 0 ? sentences[0].text : "";
  const lastSentence = sentences.length > 0 ? sentences[sentences.length - 1].text : "";
  const avgWordsPerSentence = sentenceCount > 0
    ? Math.round((wordCount / sentenceCount) * 100) / 100
    : 0;
  const avgSentencesPerParagraph = paragraphCount > 0
    ? Math.round((sentenceCount / paragraphCount) * 100) / 100
    : 0;

  return {
    charCount,
    wordCount,
    lineCount,
    nonBlankLineCount,
    sentenceCount,
    paragraphCount,

    sentences: capArray(sentences, MAX_SENTENCES),
    paragraphs: capArray(paragraphs, MAX_PARAGRAPHS),
    lines: capArray(lines, MAX_LINES),

    firstSentence,
    lastSentence,
    avgWordsPerSentence,
    avgSentencesPerParagraph,

    analyzedAt: new Date().toISOString(),
    analyzerVersion: "1.0",
  };
}
