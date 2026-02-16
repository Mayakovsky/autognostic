/**
 * GrammarEngine — phrase/clause detection within sentences.
 *
 * Computed ON-DEMAND from existing profile.sentences.
 * NOTHING stored in DocumentProfile or DB.
 */

import type { SentenceBoundary } from "./DocumentAnalyzer.types";

export interface PhraseBoundary {
  index: number;
  sentenceIndex: number;
  start: number; // char offset relative to sentence start
  end: number;
  text: string;
  wordCount: number;
}

export interface ClauseBoundary {
  index: number;
  sentenceIndex: number;
  start: number; // char offset relative to sentence start
  end: number;
  text: string;
  type: "independent" | "dependent";
  wordCount: number;
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * Split a sentence into phrases on commas, semicolons, colons, em-dashes.
 * Exceptions: commas inside quotes, parentheses, between digits.
 */
export function detectPhrases(
  sentenceText: string,
  sentenceIndex: number
): PhraseBoundary[] {
  if (!sentenceText.trim()) return [];

  const phrases: PhraseBoundary[] = [];
  let depth = 0; // track paren/quote nesting
  let inQuote = false;
  let phraseStart = 0;
  let idx = 0;

  for (let i = 0; i < sentenceText.length; i++) {
    const ch = sentenceText[i];

    if (ch === '"' || ch === "\u201C" || ch === "\u201D") {
      inQuote = !inQuote;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth++;
      continue;
    }
    if ((ch === ")" || ch === "]") && depth > 0) {
      depth--;
      continue;
    }

    if (depth > 0 || inQuote) continue;

    const isSplitter =
      ch === ";" ||
      ch === ":" ||
      ch === "\u2014" || // em-dash
      (ch === "," &&
        // Not between digits: "1,000"
        !(i > 0 && /\d/.test(sentenceText[i - 1]) && i + 1 < sentenceText.length && /\d/.test(sentenceText[i + 1])));

    if (isSplitter) {
      const phraseText = sentenceText.substring(phraseStart, i).trim();
      if (phraseText.length > 0) {
        phrases.push({
          index: idx++,
          sentenceIndex,
          start: phraseStart,
          end: i,
          text: phraseText,
          wordCount: countWords(phraseText),
        });
      }
      phraseStart = i + 1;
    }
  }

  // Final phrase
  const lastPhrase = sentenceText.substring(phraseStart).trim();
  if (lastPhrase.length > 0) {
    phrases.push({
      index: idx,
      sentenceIndex,
      start: phraseStart,
      end: sentenceText.length,
      text: lastPhrase,
      wordCount: countWords(lastPhrase),
    });
  }

  // If no splitters found, the whole sentence is one phrase
  if (phrases.length === 0) {
    phrases.push({
      index: 0,
      sentenceIndex,
      start: 0,
      end: sentenceText.length,
      text: sentenceText.trim(),
      wordCount: countWords(sentenceText),
    });
  }

  return phrases;
}

/** Subordinating conjunctions that start dependent clauses */
const SUBORDINATING = /^(?:although|because|while|when|if|since|unless|after|before|until|whereas|wherever|whenever|whether|though|even\s+(?:if|though)|so\s+that|in\s+order\s+that|provided\s+that|as\s+(?:long|soon)\s+as)\b/i;

/** Coordinating conjunctions preceded by comma → clause boundary */
const COORD_AFTER_COMMA = /^,\s*(?:and|but|or|nor|yet|so|for)\b/i;

/**
 * Split a sentence into clauses.
 * Strategy: split on commas that separate clauses (subordinating/coordinating).
 * Each clause must contain >= 2 words.
 */
export function detectClauses(
  sentenceText: string,
  sentenceIndex: number
): ClauseBoundary[] {
  if (!sentenceText.trim()) return [];

  // Split on commas first, then check each fragment for clause type
  const commaPositions: number[] = [];
  for (let i = 0; i < sentenceText.length; i++) {
    if (sentenceText[i] === ",") commaPositions.push(i);
  }

  // Also find subordinating conjunction positions (mid-sentence, not at start of fragment)
  const subPositions: number[] = [];
  for (let i = 1; i < sentenceText.length; i++) {
    if (/\s/.test(sentenceText[i - 1])) {
      const rest = sentenceText.substring(i);
      if (SUBORDINATING.test(rest)) {
        subPositions.push(i);
      }
    }
  }

  // Merge split points: commas + subordinating conjunction positions
  const splitPoints = new Set<number>();
  for (const cp of commaPositions) splitPoints.add(cp);
  for (const sp of subPositions) splitPoints.add(sp);

  if (splitPoints.size === 0) {
    // Check if sentence starts with subordinating conjunction
    const isDep = SUBORDINATING.test(sentenceText.trim());
    return [
      {
        index: 0,
        sentenceIndex,
        start: 0,
        end: sentenceText.length,
        text: sentenceText.trim(),
        type: isDep ? "dependent" : "independent",
        wordCount: countWords(sentenceText),
      },
    ];
  }

  // Build segments by splitting at commas and subordinating conjunctions
  const sortedSplits = [...splitPoints].sort((a, b) => a - b);
  const segments: Array<{ start: number; end: number; text: string }> = [];
  let prevEnd = 0;

  for (const sp of sortedSplits) {
    if (sp > prevEnd) {
      const seg = sentenceText.substring(prevEnd, sp).trim();
      if (seg.length > 0) {
        segments.push({ start: prevEnd, end: sp, text: seg });
      }
    }
    // Skip past comma + whitespace
    if (sentenceText[sp] === ",") {
      prevEnd = sp + 1;
      while (prevEnd < sentenceText.length && sentenceText[prevEnd] === " ") prevEnd++;
    } else {
      // Subordinating conjunction — don't skip, it's part of the next clause
      prevEnd = sp;
    }
  }

  // Final segment
  if (prevEnd < sentenceText.length) {
    const seg = sentenceText.substring(prevEnd).trim();
    if (seg.length > 0) {
      segments.push({ start: prevEnd, end: sentenceText.length, text: seg });
    }
  }

  // Classify each segment and filter to >= 2 words
  const clauses: ClauseBoundary[] = [];
  let idx = 0;
  for (const seg of segments) {
    if (countWords(seg.text) < 2) continue;
    const isDep = SUBORDINATING.test(seg.text);
    clauses.push({
      index: idx++,
      sentenceIndex,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      type: isDep ? "dependent" : "independent",
      wordCount: countWords(seg.text),
    });
  }

  // If filtering left nothing, return whole sentence
  if (clauses.length === 0) {
    const isDep = SUBORDINATING.test(sentenceText.trim());
    return [
      {
        index: 0,
        sentenceIndex,
        start: 0,
        end: sentenceText.length,
        text: sentenceText.trim(),
        type: isDep ? "dependent" : "independent",
        wordCount: countWords(sentenceText),
      },
    ];
  }

  return clauses;
}

/** Count total phrases across all sentences */
export function countPhrases(sentences: SentenceBoundary[]): number {
  let total = 0;
  for (const s of sentences) {
    total += detectPhrases(s.text, s.index).length;
  }
  return total;
}

/** Count total clauses across all sentences */
export function countClauses(sentences: SentenceBoundary[]): number {
  let total = 0;
  for (const s of sentences) {
    total += detectClauses(s.text, s.index).length;
  }
  return total;
}
