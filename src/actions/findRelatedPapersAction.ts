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
  lookupPaper,
  getRelatedPapers,
  getCitations,
  getReferences,
  buildPaperId,
  type S2Paper,
} from "../services/SemanticScholarService";
import { extractDoiFromUrl } from "../services/UnpaywallResolver";
import { safeSerialize } from "../utils/safeSerialize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALIDATE_RE =
  /\b(find|show|get|list|suggest|recommend|discover)\b.*\b(related|similar|citing|cited|citation|reference)\b.*\b(paper|article|work|publication)/i;

const VALIDATE_RE_ALT =
  /\b(what|which|who)\b.*\b(cite|cites|cited|reference|references|related)/i;

type DiscoveryMode = "related" | "citations" | "references";

function inferMode(text: string): DiscoveryMode {
  const lower = text.toLowerCase();
  if (/\b(cit(?:e[sd]?|ation|ing)|who\s+cite)/i.test(lower)) return "citations";
  if (/\breference/i.test(lower)) return "references";
  return "related";
}

/** Extract a paper identifier from message text. */
function extractIdentifier(text: string): string | null {
  // DOI from URL
  const doi = extractDoiFromUrl(text);
  if (doi) return doi;

  // arXiv URL or ID
  const arxivUrl = text.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (arxivUrl) return arxivUrl[1];

  // Bare arXiv ID in text
  const arxivBare = text.match(/\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/);
  if (arxivBare) return arxivBare[1];

  // Semantic Scholar URL
  const s2Match = text.match(/semanticscholar\.org\/paper\/[^/]*\/([a-f0-9]{40})/i);
  if (s2Match) return s2Match[1];

  // Bare DOI in text: 10.xxxx/...
  const doiBare = text.match(/\b(10\.\d{4,}\/[^\s"'<>]+)/);
  if (doiBare) return doiBare[1].replace(/[.,;:)\]}>]+$/, "");

  // Full URL (might be a publisher URL with DOI in path)
  const urlMatch = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  if (urlMatch) {
    const urlDoi = extractDoiFromUrl(urlMatch[0]);
    if (urlDoi) return urlDoi;
  }

  return null;
}

function formatPaperList(papers: S2Paper[], mode: DiscoveryMode): string {
  if (papers.length === 0) return `No ${mode} papers found.`;

  const modeLabel = mode === "citations" ? "Citing" : mode === "references" ? "Referenced" : "Related";
  const lines = papers.map((p, i) => {
    const authorStr = p.authors.length > 0
      ? p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : "")
      : "Unknown authors";
    const yearStr = p.year ? ` (${p.year})` : "";
    const venueStr = p.venue ? ` — ${p.venue}` : "";
    const citStr = p.citationCount > 0 ? ` [${p.citationCount} citations]` : "";
    const oaStr = p.openAccessPdfUrl ? `\n   PDF: ${p.openAccessPdfUrl}` : "";
    const doiStr = p.externalIds.DOI ? `\n   DOI: ${p.externalIds.DOI}` : "";

    return `${i + 1}. **${p.title}**${yearStr}\n   ${authorStr}${venueStr}${citStr}${oaStr}${doiStr}`;
  });

  return `${modeLabel} papers (${papers.length}):\n\n${lines.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const FindRelatedPapersAction: Action = {
  name: "FIND_RELATED_PAPERS",
  description:
    "Find papers related to, citing, or cited by a given paper. " +
    "Accepts a DOI, arXiv ID, Semantic Scholar URL, or paper URL. " +
    "Returns a list with metadata and open-access PDF links. " +
    "Use ADD_URL_TO_KNOWLEDGE to ingest any discovered papers.",
  similes: [
    "RELATED_PAPERS",
    "FIND_SIMILAR_PAPERS",
    "FIND_CITATIONS",
    "CITATION_GRAPH",
    "PAPER_RECOMMENDATIONS",
    "SIMILAR_PAPERS",
  ],
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Find papers related to https://arxiv.org/abs/2301.12345",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Related papers (5):\n\n1. **Paper A** (2023)\n   Author One, Author Two — NeurIPS [150 citations]",
          actions: ["FIND_RELATED_PAPERS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "What papers cite 10.1145/3597066?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Citing papers (3):\n\n1. **Follow-up Study** (2024)\n   Jane Doe et al. — ICML [42 citations]",
          actions: ["FIND_RELATED_PAPERS"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show me the references from this paper: https://doi.org/10.1038/nature12373",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Referenced papers (10):\n\n1. **Foundational Work** (2010)\n   Smith, Johnson — Nature [5000 citations]",
          actions: ["FIND_RELATED_PAPERS"],
        },
      },
    ],
  ],

  parameters: {
    type: "object",
    properties: {
      paperUrl: {
        type: "string",
        description: "URL of the paper (arXiv, DOI, Semantic Scholar, or publisher URL)",
      },
      doi: {
        type: "string",
        description: "DOI of the paper (e.g. 10.1145/3597066)",
      },
      mode: {
        type: "string",
        enum: ["related", "citations", "references"],
        description: "Discovery mode: related (default), citations, or references",
      },
      limit: {
        type: "number",
        description: "Max number of papers to return (default: 10, max: 50)",
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

    // 1. Extract identifier
    const identifier =
      (args.doi as string | undefined) ||
      (args.paperUrl as string | undefined) ||
      extractIdentifier(messageText);

    if (!identifier) {
      const text =
        "Please provide a paper identifier — a DOI, arXiv ID, Semantic Scholar URL, or publisher URL.";
      if (callback) await callback({ text, action: "FIND_RELATED_PAPERS" });
      return { success: false, text, data: safeSerialize({ error: "missing_identifier" }) };
    }

    // 2. Determine mode
    const mode: DiscoveryMode =
      (args.mode as DiscoveryMode | undefined) || inferMode(messageText);

    const limit = Math.max(1, Math.min((args.limit as number | undefined) ?? 10, 50));

    // 3. Look up source paper
    const sourcePaper = await lookupPaper(identifier);

    if (!sourcePaper) {
      const text = `Could not find paper "${identifier}" on Semantic Scholar. Check the identifier and try again.`;
      if (callback) await callback({ text, action: "FIND_RELATED_PAPERS" });
      return { success: false, text, data: safeSerialize({ error: "paper_not_found", identifier }) };
    }

    // 4. Fetch related/citing/referenced papers
    let papers: S2Paper[];
    switch (mode) {
      case "citations":
        papers = await getCitations(sourcePaper.paperId, limit);
        break;
      case "references":
        papers = await getReferences(sourcePaper.paperId, limit);
        break;
      default:
        papers = await getRelatedPapers(sourcePaper.paperId, limit);
    }

    // 5. Format response
    const sourceInfo = `Source: **${sourcePaper.title}**${sourcePaper.year ? ` (${sourcePaper.year})` : ""} [${sourcePaper.citationCount} citations]\n\n`;
    const listText = formatPaperList(papers, mode);
    const responseText = sourceInfo + listText;

    if (callback) await callback({ text: responseText, action: "FIND_RELATED_PAPERS" });
    return {
      success: true,
      text: responseText,
      data: safeSerialize({
        sourcePaper: {
          paperId: sourcePaper.paperId,
          title: sourcePaper.title,
          doi: sourcePaper.externalIds.DOI || null,
          year: sourcePaper.year,
          citationCount: sourcePaper.citationCount,
        },
        mode,
        count: papers.length,
        papers: papers.map(p => ({
          paperId: p.paperId,
          title: p.title,
          year: p.year,
          doi: p.externalIds.DOI || null,
          openAccessPdfUrl: p.openAccessPdfUrl,
          citationCount: p.citationCount,
        })),
      }),
    };
  },
};
