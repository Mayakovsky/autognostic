import type { IAgentRuntime } from "@elizaos/core";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";

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

export async function getExactQuote(
  runtime: IAgentRuntime,
  url: string,
  searchText: string
): Promise<QuoteResult> {
  const content = await autognosticDocumentsRepository.getFullContent(
    runtime,
    url
  );

  if (!content) {
    return { found: false };
  }

  // Case-insensitive search
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

export async function getExactQuoteAll(
  runtime: IAgentRuntime,
  url: string,
  searchText: string
): Promise<QuoteAllResult> {
  const content = await autognosticDocumentsRepository.getFullContent(
    runtime,
    url
  );
  if (!content) return { matches: [], totalCount: 0 };

  const contentLower = content.toLowerCase();
  const searchLower = searchText.toLowerCase();
  const matches: QuoteAllResult["matches"] = [];
  let pos = 0;

  while (pos < contentLower.length) {
    const idx = contentLower.indexOf(searchLower, pos);
    if (idx === -1) break;

    const lineNumber = content.substring(0, idx).split("\n").length;
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

export async function getLineContent(
  runtime: IAgentRuntime,
  url: string,
  lineNumber: number
): Promise<string | null> {
  const content = await autognosticDocumentsRepository.getFullContent(
    runtime,
    url
  );

  if (!content) {
    return null;
  }

  const lines = content.split("\n");
  if (lineNumber < 1 || lineNumber > lines.length) {
    return null;
  }

  return lines[lineNumber - 1];
}

export async function getFullDocument(
  runtime: IAgentRuntime,
  url: string
): Promise<string | null> {
  return autognosticDocumentsRepository.getFullContent(runtime, url);
}
