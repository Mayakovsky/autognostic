/**
 * Pure search functions operating on document content strings.
 * No DB access — caller provides content.
 */

export interface QuoteResult {
  found: boolean;
  quote?: string;
  lineNumber?: number;
  charPosition?: number;
  context?: string;
}

export interface QuoteAllResult {
  matches: Array<{
    quote: string;
    lineNumber: number;
    charPosition: number;
    context: string;
  }>;
  totalCount: number;
}

/** Find first occurrence of searchText in content (case-insensitive). */
export function getExactQuote(
  content: string,
  searchText: string
): QuoteResult {
  const contentLower = content.toLowerCase();
  const searchLower = searchText.toLowerCase();
  const position = contentLower.indexOf(searchLower);
  if (position === -1) {
    return { found: false };
  }

  const lines = content.substring(0, position).split("\n");
  const lineNumber = lines.length;

  // Get surrounding context (100 chars before/after)
  const contextStart = Math.max(0, position - 100);
  const contextEnd = Math.min(
    content.length,
    position + searchText.length + 100
  );
  const context = content.substring(contextStart, contextEnd);

  return {
    found: true,
    quote: content.substring(position, position + searchText.length),
    lineNumber,
    charPosition: position,
    context,
  };
}

/** Find all occurrences of searchText in content (case-insensitive).
 *  Uses pre-computed newline offsets + binary search for O(n + m*log(L)) line lookup. */
export function getExactQuoteAll(
  content: string,
  searchText: string
): QuoteAllResult {
  const contentLower = content.toLowerCase();
  const searchLower = searchText.toLowerCase();
  const matches: QuoteAllResult["matches"] = [];

  // Pre-compute newline offsets for O(n+m) line lookup instead of O(n*m)
  const newlineOffsets: number[] = [-1]; // sentinel: "line 1 starts after index -1"
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") newlineOffsets.push(i);
  }

  let pos = 0;
  while (pos < contentLower.length) {
    const idx = contentLower.indexOf(searchLower, pos);
    if (idx === -1) break;

    // Binary search for line number
    let lo = 0, hi = newlineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (newlineOffsets[mid] < idx) lo = mid;
      else hi = mid - 1;
    }
    const lineNumber = lo + 1;

    const actualQuote = content.substring(idx, idx + searchText.length);
    const contextStart = Math.max(0, idx - 50);
    const contextEnd = Math.min(content.length, idx + searchText.length + 50);

    matches.push({
      quote: actualQuote,
      lineNumber,
      charPosition: idx,
      context: content.substring(contextStart, contextEnd),
    });
    pos = idx + 1;
  }

  return { matches, totalCount: matches.length };
}
