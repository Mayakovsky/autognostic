import type {
  Action,
  ActionResult,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  Content,
} from "@elizaos/core";
import {
  searchWorks,
  type OpenAlexResult,
  type SearchOptions,
} from "../services/OpenAlexService";
import { safeSerialize } from "../utils/safeSerialize";
import { fromError, forCondition, formatForCallback } from "../services/ErrorMessageFactory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALIDATE_RE =
  /\b(search|find|look\s*up|discover|explore)\b.*\b(papers?|articles?|research|publications?|literature|stud(?:y|ies))\b/i;

const VALIDATE_RE_ALT =
  /\b(papers?|articles?|research|publications?|literature)\b.*\b(about|on|regarding|related\s+to)\b/i;

/** Strip trigger phrases to extract the raw topic query. */
function extractQuery(text: string): string {
  let q = text
    // Remove common trigger phrases
    .replace(/\b(search\s+for|find|look\s*up|discover|explore|show\s+me|get)\b\s*/gi, "")
    .replace(/\b(papers?|articles?|research|publications?|literature|studies)\b\s*/gi, "")
    .replace(/\b(about|on|regarding|related\s+to|dealing\s+with|concerning)\b\s*/gi, "")
    // Remove filler words at start
    .replace(/^(the|some|any|recent|latest|new)\s+/gi, "")
    .trim();

  // If stripping removed everything, fall back to original text
  if (q.length < 3) q = text.trim();

  return q;
}

/** Parse filter options from message text or explicit args. */
function parseOptions(text: string, args: Record<string, unknown>): SearchOptions {
  const options: SearchOptions = {};

  // Explicit args override
  if (typeof args.limit === "number") options.limit = args.limit;
  if (typeof args.filterOA === "boolean") options.filterOA = args.filterOA;
  if (typeof args.yearFrom === "number") options.yearFrom = args.yearFrom;
  if (typeof args.yearTo === "number") options.yearTo = args.yearTo;
  if (typeof args.sortBy === "string") options.sortBy = args.sortBy as SearchOptions["sortBy"];

  // Infer OA filter from text
  if (options.filterOA === undefined) {
    if (/\b(open\s*access|free|oa\b)/i.test(text)) {
      options.filterOA = true;
    }
  }

  // Infer sort from text
  if (!options.sortBy) {
    if (/\b(most\s+cited|highest\s+citations?|top\s+cited)\b/i.test(text)) {
      options.sortBy = "cited_by_count";
    } else if (/\b(recent|latest|newest)\b/i.test(text)) {
      options.sortBy = "publication_date";
    }
  }

  // Infer year range from text: "from 2020" or "since 2020"
  const yearFromMatch = text.match(/\b(?:from|since|after)\s+(\d{4})\b/i);
  if (yearFromMatch && options.yearFrom === undefined) {
    options.yearFrom = parseInt(yearFromMatch[1], 10);
  }

  // "before 2024" or "until 2024"
  const yearToMatch = text.match(/\b(?:before|until|through|up\s+to)\s+(\d{4})\b/i);
  if (yearToMatch && options.yearTo === undefined) {
    options.yearTo = parseInt(yearToMatch[1], 10);
  }

  return options;
}

function formatResultList(results: OpenAlexResult[]): string {
  if (results.length === 0) return "No papers found matching your query.";

  const lines = results.map((r, i) => {
    const authorStr = r.authors.length > 0
      ? r.authors.slice(0, 3).join(", ") + (r.authors.length > 3 ? " et al." : "")
      : "Unknown authors";
    const yearStr = r.year ? ` (${r.year})` : "";
    const sourceStr = r.source ? ` — ${r.source}` : "";
    const citStr = r.citedByCount > 0 ? ` [${r.citedByCount} citations]` : "";
    const oaEmoji = r.oaStatus !== "closed" && r.oaPdfUrl ? "\u{1F7E2}" : "\u{1F534}";
    const doiStr = r.doi ? `\n   DOI: ${r.doi}` : "";
    const pdfStr = r.oaPdfUrl ? `\n   PDF: ${r.oaPdfUrl}` : "";

    return `${i + 1}. ${oaEmoji} **${r.title}**${yearStr}\n   ${authorStr}${sourceStr}${citStr}${doiStr}${pdfStr}`;
  });

  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const SearchPapersAction: Action = {
  name: "SEARCH_PAPERS",
  description:
    "Search for academic papers by topic using OpenAlex. " +
    "Returns a ranked list with titles, authors, year, citation count, and open-access status. " +
    "Does NOT auto-ingest — user picks which papers to add via ADD_URL_TO_KNOWLEDGE.",
  similes: [
    "FIND_PAPERS",
    "SEARCH_RESEARCH",
    "SEARCH_LITERATURE",
    "PAPER_SEARCH",
    "FIND_ARTICLES",
    "SEARCH_ACADEMIC",
  ],
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Search for papers about transformer attention mechanisms",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Found 10 papers on transformer attention mechanisms:\n\n1. \u{1F7E2} **Attention Is All You Need** (2017)\n   Vaswani et al. — NeurIPS [87000 citations]",
          actions: ["SEARCH_PAPERS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Find recent open access papers on CRISPR gene editing since 2022",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Found 10 open-access papers on CRISPR gene editing (2022+):\n\n1. \u{1F7E2} **CRISPR-Cas9 Advances** (2023)\n   Zhang et al. — Nature [500 citations]",
          actions: ["SEARCH_PAPERS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Look up the most cited articles on quantum computing",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Found 10 papers on quantum computing (sorted by citations):\n\n1. \u{1F7E2} **Quantum Supremacy** (2019)\n   Arute et al. — Nature [3000 citations]",
          actions: ["SEARCH_PAPERS"],
        },
      },
    ],
  ],

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search topic or query string",
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 10, max: 25)",
      },
      filterOA: {
        type: "boolean",
        description: "Only show open-access papers",
      },
      yearFrom: {
        type: "number",
        description: "Filter papers published from this year onwards",
      },
      yearTo: {
        type: "number",
        description: "Filter papers published up to this year",
      },
      sortBy: {
        type: "string",
        enum: ["relevance", "cited_by_count", "publication_date"],
        description: "Sort order (default: relevance)",
      },
    },
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "");
    if (VALIDATE_RE.test(text)) return true;
    if (VALIDATE_RE_ALT.test(text)) return true;
    return false;
  },

  async handler(
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined,
  ): Promise<ActionResult> {
    const args = (message.content as Record<string, unknown>) || {};
    const messageText = ((message.content as Content)?.text || "");

    // 1. Extract search query
    const query = (args.query as string | undefined) || extractQuery(messageText);

    if (!query || query.trim().length < 2) {
      const text = "Please provide a topic to search for — e.g., \"search for papers about neural networks\".";
      if (callback) await callback({ text, action: "SEARCH_PAPERS" });
      return { success: false, text, data: safeSerialize({ error: "missing_query" }) };
    }

    // 2. Parse filter/sort options
    const options = parseOptions(messageText, args);

    try {
      // 3. Search OpenAlex
      const results = await searchWorks(query, options);

      // 4. Format response
      const listText = formatResultList(results);
      const filterDesc: string[] = [];
      if (options.filterOA) filterDesc.push("open-access only");
      if (options.yearFrom) filterDesc.push(`from ${options.yearFrom}`);
      if (options.yearTo) filterDesc.push(`until ${options.yearTo}`);
      if (options.sortBy === "cited_by_count") filterDesc.push("sorted by citations");
      if (options.sortBy === "publication_date") filterDesc.push("sorted by date");

      const filterStr = filterDesc.length > 0 ? ` (${filterDesc.join(", ")})` : "";

      let responseText: string;
      if (results.length === 0) {
        const userMsg = forCondition("openalex_empty", { query });
        responseText = formatForCallback(userMsg);
      } else {
        responseText =
          `Found ${results.length} papers on "${query}"${filterStr}:\n\n${listText}` +
          `\n\nReply with the numbers you'd like to add to knowledge (e.g., "add 1, 3, 5") or say "add all".`;
      }

      if (callback) await callback({ text: responseText, action: "SEARCH_PAPERS" });
      return {
        success: results.length > 0,
        text: responseText,
        data: safeSerialize({
          query,
          options: {
            limit: options.limit ?? 10,
            filterOA: options.filterOA ?? false,
            yearFrom: options.yearFrom ?? null,
            yearTo: options.yearTo ?? null,
            sortBy: options.sortBy ?? "relevance",
          },
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            doi: r.doi,
            title: r.title,
            year: r.year,
            citedByCount: r.citedByCount,
            oaStatus: r.oaStatus,
            oaPdfUrl: r.oaPdfUrl,
          })),
        }),
      };
    } catch (error) {
      const userMsg = fromError(error, { query });
      const text = formatForCallback(userMsg);
      if (callback) await callback({ text, action: "SEARCH_PAPERS" });
      return {
        success: false,
        text,
        data: safeSerialize({
          error: "search_failed",
          query,
          isRetryable: userMsg.isRetryable,
          debugInfo: userMsg.debugInfo,
        }),
      };
    }
  },
};
