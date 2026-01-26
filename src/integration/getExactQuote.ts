import type { IAgentRuntime } from "@elizaos/core";
import { datamirrorDocumentsRepository } from "../db/datamirrorDocumentsRepository";

export interface QuoteResult {
  found: boolean;
  quote?: string;
  lineNumber?: number;
  charPosition?: number;
  context?: string;
}

export async function getExactQuote(
  runtime: IAgentRuntime,
  url: string,
  searchText: string
): Promise<QuoteResult> {
  const content = await datamirrorDocumentsRepository.getFullContent(
    runtime,
    url
  );

  if (!content) {
    return { found: false };
  }

  const position = content.indexOf(searchText);
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
    quote: searchText,
    lineNumber,
    charPosition: position,
    context,
  };
}

export async function getLineContent(
  runtime: IAgentRuntime,
  url: string,
  lineNumber: number
): Promise<string | null> {
  const content = await datamirrorDocumentsRepository.getFullContent(
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
  return datamirrorDocumentsRepository.getFullContent(runtime, url);
}
