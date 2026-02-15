import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { getExactQuote, getExactQuoteAll, getLineContent, getFullDocument } from "../integration/getExactQuote";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
import { analyzeDocument } from "../services/DocumentAnalyzer";
import type { DocumentProfile } from "../services/DocumentAnalyzer.types";
import { safeSerialize } from "../utils/safeSerialize";

/** Helper: get or lazily compute a profile for a URL */
async function getOrComputeProfile(
  runtime: IAgentRuntime,
  url: string
): Promise<{ profile: DocumentProfile; content: string } | null> {
  const row = await autognosticDocumentsRepository.getWithProfile(runtime, url);
  if (!row) return null;

  if (row.profile) return { profile: row.profile, content: row.content };

  // Lazy computation for documents stored before profiling existed
  const profile = analyzeDocument(row.content);
  try {
    await autognosticDocumentsRepository.updateProfile(runtime, url, profile);
  } catch { /* non-fatal */ }
  return { profile, content: row.content };
}

/** Sentinel for open-ended ranges */
const MAX_RANGE = 999999;

/** Parse a number from cardinal words, ordinal words, ordinal suffixes, or digit strings */
export function parseNumber(s: string): number {
  const cardinals: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  };
  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
    sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
    twentieth: 20, thirtieth: 30,
  };
  const lower = s.toLowerCase().trim();
  if (cardinals[lower] !== undefined) return cardinals[lower];
  if (ordinals[lower] !== undefined) return ordinals[lower];
  // Ordinal suffixes: 1st, 2nd, 3rd, 4th, ...
  const suffixMatch = lower.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (suffixMatch) return parseInt(suffixMatch[1], 10);
  // Bare digits
  const parsed = parseInt(lower, 10);
  return isNaN(parsed) ? 1 : parsed;
}

type InferredMode = {
  mode: string;
  count?: number;
  lineNumber?: number;
  lineEnd?: number;
  searchText?: string;
  unit?: string;
};

// Number word pattern for regex (cardinals)
const NUM_WORDS = "\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred";
// Ordinal word pattern
const ORD_WORDS = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|\\d+(?:st|nd|rd|th)";
// Unit pattern (singular, captures without trailing s)
const UNIT_PAT = "sentences?|paragraphs?|words?|lines?";
const UNIT_SINGULAR = "sentence|paragraph|line|word";

/** Clean searchText extracted from natural language */
function cleanSearchText(raw: string): string {
  return raw
    .replace(/\s+(?:in\s+)?(?:the\s+)?(?:document|doc|file|paper|it)\s*[.?!]*$/i, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/[.?!]+$/, "")
    .trim();
}

/** Infer mode from natural language, returning structured mode info */
export function inferMode(messageText: string, args: Record<string, unknown> = {}): InferredMode {
  const explicitMode = args.mode as string | undefined;
  const lineNumber = args.lineNumber as number | undefined;
  const searchText = args.searchText as string | undefined;

  if (explicitMode) {
    return { mode: explicitMode, lineNumber, searchText };
  }

  const text = messageText;

  // --- Priority 1: Stats ---
  if (/how\s+many\s+(words?|lines?|sentences?|paragraphs?)/i.test(text) ||
      /word\s+count/i.test(text) ||
      /\bstatistics?\b|\bstats\b/i.test(text) ||
      /count\s+the\s+(words?|lines?|sentences?|paragraphs?)/i.test(text) ||
      /how\s+long\s+is/i.test(text) ||
      /\blength\b.*\b(?:document|doc|file|paper|it)\b/i.test(text)) {
    return { mode: "stats" };
  }

  // --- Priority 2: Last N units ---
  const lastNRe = new RegExp(`\\blast\\s+(${NUM_WORDS})\\s+(${UNIT_PAT})\\b`, "i");
  const lastNMatch = text.match(lastNRe);
  if (lastNMatch) {
    return { mode: "last_n", count: parseNumber(lastNMatch[1]), unit: lastNMatch[2].replace(/s$/, "") };
  }

  // --- Priority 3: First N units ---
  const firstNRe = new RegExp(`\\bfirst\\s+(${NUM_WORDS})\\s+(${UNIT_PAT})\\b`, "i");
  const firstNMatch = text.match(firstNRe);
  if (firstNMatch) {
    return { mode: "first_n", count: parseNumber(firstNMatch[1]), unit: firstNMatch[2].replace(/s$/, "") };
  }

  // --- Priority 4: Ordinal + unit -> nth (e.g., "third paragraph", "5th sentence") ---
  // Exclude first/last — they have dedicated first_paragraph/last_paragraph modes
  const ordUnitRe = new RegExp(`\\b(${ORD_WORDS})\\s+(${UNIT_SINGULAR})\\b`, "i");
  const ordUnitMatch = text.match(ordUnitRe);
  if (ordUnitMatch) {
    const ordLower = ordUnitMatch[1].toLowerCase();
    const unitLower = ordUnitMatch[2].toLowerCase();
    // "first paragraph" / "last paragraph" handled by dedicated modes below
    if (!(ordLower === "first" && unitLower === "paragraph") &&
        !(ordLower === "first" && (unitLower === "line" || unitLower === "sentence" || unitLower === "word"))) {
      return { mode: "nth", count: parseNumber(ordUnitMatch[1]), unit: unitLower };
    }
  }

  // --- Priority 5: Unit + number -> nth (e.g., "paragraph three", "sentence 5") ---
  // Skip "paragraph \d+" and "line \d+" — they have dedicated modes (P6, P16)
  const unitNumRe = new RegExp(`\\b(${UNIT_SINGULAR})\\s+(${NUM_WORDS}|${ORD_WORDS})\\b`, "i");
  const unitNumMatch = text.match(unitNumRe);
  if (unitNumMatch) {
    const unit = unitNumMatch[1].toLowerCase();
    const numStr = unitNumMatch[2];
    const isDigit = /^\d+$/.test(numStr);
    // "paragraph 3" → paragraph mode, "line 5" → line mode (not nth)
    if (!((unit === "paragraph" || unit === "line") && isDigit)) {
      return { mode: "nth", count: parseNumber(numStr), unit };
    }
  }

  // --- Priority 14a: "everything after paragraph N" (must come before paragraph N) ---
  const everythingAfterPara = text.match(/\beverything\s+after\s+paragraph\s+(\d+)\b/i);
  if (everythingAfterPara) {
    return { mode: "paragraph_range", lineNumber: parseInt(everythingAfterPara[1], 10) + 1, lineEnd: MAX_RANGE };
  }

  // --- Priority 6: Paragraph N / para N ---
  const paraMatch = text.match(/\bparagraph\s+(\d+)\b/i) || text.match(/\bpara\s+(\d+)\b/i);
  if (paraMatch) {
    return { mode: "paragraph", count: parseInt(paraMatch[1], 10) };
  }

  // --- Priority 9: How does it end / what's the ending/conclusion ---
  // (Moved before P7/P8 so "what's the conclusion" → implicit_end, not last_paragraph)
  if (/how\s+does\s+it\s+end/i.test(text) ||
      /what(?:'s|\s+is)\s+(?:the\s+)?(?:ending|conclusion)/i.test(text)) {
    return { mode: "implicit_end" };
  }

  // --- Priority 10: How does it start / what's the opening/beginning ---
  if (/how\s+does\s+it\s+(?:start|begin)/i.test(text) ||
      /what(?:'s|\s+is)\s+(?:the\s+)?(?:opening|beginning)/i.test(text)) {
    return { mode: "implicit_start" };
  }

  // --- Priority 7: Last/final/ending paragraph, conclusion ---
  if (/\b(?:last|final|ending)\s+paragraph\b/i.test(text) ||
      /\b(?:conclusion|ending|end\s+of)\b/i.test(text)) {
    return { mode: "last_paragraph" };
  }

  // --- Priority 8: First/opening/beginning paragraph ---
  if (/\b(?:first|opening|beginning|starting)\s+paragraph\b/i.test(text) ||
      /\bopening\b/i.test(text) ||
      /\bbeginning\s+of\b/i.test(text)) {
    return { mode: "first_paragraph" };
  }

  // --- Priority 11: Sentence range ---
  const sentRangeMatch = text.match(/\bsentences?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)\b/i);
  if (sentRangeMatch) {
    return { mode: "sentence_range", lineNumber: parseInt(sentRangeMatch[1], 10), lineEnd: parseInt(sentRangeMatch[2], 10) };
  }

  // --- Priority 12: Paragraph range ---
  const paraRangeMatch = text.match(/\bparagraphs?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)\b/i);
  if (paraRangeMatch) {
    return { mode: "paragraph_range", lineNumber: parseInt(paraRangeMatch[1], 10), lineEnd: parseInt(paraRangeMatch[2], 10) };
  }

  // --- Priority 13: Line range ---
  const lineRangeMatch = text.match(/\blines?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)\b/i);
  if (lineRangeMatch) {
    return { mode: "range", lineNumber: parseInt(lineRangeMatch[1], 10), lineEnd: parseInt(lineRangeMatch[2], 10) };
  }

  // --- Priority 14: Open-ended ranges ---
  const fromLineEnd = text.match(/\bfrom\s+line\s+(\d+)\s+to\s+(?:the\s+)?end\b/i);
  if (fromLineEnd) {
    return { mode: "range", lineNumber: parseInt(fromLineEnd[1], 10), lineEnd: MAX_RANGE };
  }
  const linesAfter = text.match(/\blines?\s+(?:after|from)\s+(\d+)\b/i);
  if (linesAfter) {
    return { mode: "range", lineNumber: parseInt(linesAfter[1], 10) + 1, lineEnd: MAX_RANGE };
  }
  const everythingAfterLine = text.match(/\beverything\s+after\s+(?:line\s+)?(\d+)\b/i);
  if (everythingAfterLine) {
    return { mode: "range", lineNumber: parseInt(everythingAfterLine[1], 10) + 1, lineEnd: MAX_RANGE };
  }

  // --- Priority 15: Full document (no bare "all" — too ambiguous) ---
  if (/\b(?:full|entire|whole)\b/i.test(text) || /\bread\s+it\s+all\b/i.test(text)) {
    return { mode: "full" };
  }

  // --- Priority 16: Specific line ---
  const lineMatch = text.match(/\bline\s+(\d+)\b/i) ||
                    text.match(/what(?:'s|\s+is)\s+on\s+line\s+(\d+)/i) ||
                    text.match(/(?:go|skip)\s+to\s+line\s+(\d+)/i);
  if (lineMatch) {
    return { mode: "line", lineNumber: parseInt(lineMatch[1], 10) };
  }
  if (lineNumber) {
    return { mode: "line", lineNumber };
  }

  // --- Priority 17: Last/final/ending single unit, penultimate, next-to-last ---
  // Check penultimate / next-to-last BEFORE "last single" to avoid "last sentence" matching first
  const penultimateMatch = text.match(/\bpenultimate\s+(line|sentence|paragraph|word)\b/i);
  if (penultimateMatch) {
    return { mode: "last_n", count: 2, unit: penultimateMatch[1].toLowerCase() };
  }
  const nextToLastMatch = text.match(/\b(?:next|second)\s+to\s+last\s+(line|sentence|paragraph|word)\b/i);
  if (nextToLastMatch) {
    return { mode: "last_n", count: 2, unit: nextToLastMatch[1].toLowerCase() };
  }
  const lastSingleMatch = text.match(/\b(?:last|final|ending)\s+(line|sentence|word)\b/i);
  if (lastSingleMatch) {
    return { mode: "last_n", count: 1, unit: lastSingleMatch[1].toLowerCase() };
  }

  // --- Priority 18: First/opening/beginning single unit ---
  const firstSingleMatch = text.match(/\b(?:first|opening|beginning|starting)\s+(line|sentence|word)\b/i);
  if (firstSingleMatch) {
    return { mode: "first_n", count: 1, unit: firstSingleMatch[1].toLowerCase() };
  }

  // --- Priority 19: Search phrasings ---
  let searchMatch: RegExpMatchArray | null;
  searchMatch = text.match(/(?:what\s+does\s+it|what\s+do\s+they)\s+say\s+about\s+(.+)/i);
  if (!searchMatch) searchMatch = text.match(/(?:find|locate)\s+(?:the\s+)?(?:part|section)\s+about\s+(.+)/i);
  if (!searchMatch) searchMatch = text.match(/where\s+(?:does\s+it|is)\s+(?:mention|discuss|talk\s+about)\s+(.+)/i);
  if (!searchMatch) searchMatch = text.match(/(?:is|does)\s+(?:it\s+)?(?:mention(?:ed|s)?|discuss(?:ed)?|reference[ds]?|include[ds]?)\s+(.+)/i);
  if (!searchMatch) searchMatch = text.match(/\bis\s+(.+?)\s+mentioned\b/i);
  if (!searchMatch) searchMatch = text.match(/(?:does\s+it\s+)?talk\s+about\s+(.+)/i);
  if (!searchMatch) searchMatch = text.match(/(?:find|search\s+for|look\s+for)\s+['"]?(.+?)['"]?$/i);
  if (searchMatch) {
    return { mode: "search", searchText: cleanSearchText(searchMatch[1]) };
  }

  // --- Priority 20: Multi-match search ---
  let searchAllMatch: RegExpMatchArray | null;
  searchAllMatch = text.match(/\bevery\s+(?:mention|occurrence|instance)\s+of\s+(.+)/i);
  if (!searchAllMatch) searchAllMatch = text.match(/\ball\s+(?:mentions?|occurrences?|instances?)\s+of\s+(.+)/i);
  if (searchAllMatch) {
    return { mode: "search_all", searchText: cleanSearchText(searchAllMatch[1]) };
  }

  // --- Priority 21: Explicit searchText in args ---
  if (searchText) {
    return { mode: "search", searchText };
  }

  // --- Priority 22: Quoted text search ---
  const quotedMatch = text.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) {
    return { mode: "search", searchText: quotedMatch[1] || quotedMatch[2] };
  }

  // --- Priority 23: Read it / tell me about the document ---
  if (/\bread\s+it(?:\s+to\s+me|\s+back)?\b/i.test(text)) {
    return { mode: "full" };
  }
  if (/\btell\s+me\s+(?:about\s+)?(?:the\s+)?(?:document|doc|file|paper)\b/i.test(text)) {
    return { mode: "stats" };
  }

  // --- Priority 24: No match -> fallback ---
  return { mode: "" };
}

/** Respond helper — always calls callback before returning */
function respond(
  callback: HandlerCallback | undefined,
  success: boolean,
  text: string,
  data: Record<string, unknown>
): ActionResult {
  if (callback) callback({ text, action: "GET_EXACT_QUOTE" });
  return { success, text, data: safeSerialize(data) };
}

export const GetQuoteAction: Action = {
  name: "GET_EXACT_QUOTE",
  description:
    "Retrieve exact quotes, lines, sentences, paragraphs, stats, or search results from a stored knowledge document. " +
    "ALWAYS use this action instead of REPLY or SEND_MESSAGE when the user asks about document content. " +
    "Triggers include: quote, read, print, show, retrieve, give me, tell me about the document, " +
    "'what does it say about X', 'find X', 'is X mentioned', 'every mention of X', " +
    "'last two sentences', 'first paragraph', 'the third paragraph', 'paragraph 3', 'sentence five', " +
    "'how many words', 'word count', 'how long is it', 'count the words', " +
    "'lines 5 to 10', 'sentences 3 through 7', 'from line 5 to the end', " +
    "'how does it start', 'how does it end', 'the opening', 'the conclusion', " +
    "'full document', 'read it all', 'the second line', '5th sentence', " +
    "'penultimate sentence', 'next to last paragraph'. " +
    "Do NOT attempt to recall document content from conversation context — only this action retrieves it. " +
    "This is the ONLY way to access stored document content. REPLY cannot access documents.",
  similes: [
    "QUOTE_FROM", "GET_LINE", "EXACT_QUOTE", "READ_LINE", "READ_DOCUMENT",
    "REPEAT_LINE", "REPEAT_TEXT", "SHOW_LINE", "RETRIEVE_TEXT", "GET_CONTENT",
    "LAST_LINE", "FIRST_LINE", "DOCUMENT_STATS", "WORD_COUNT", "GET_PARAGRAPH",
    "GET_SENTENCES", "FIND_IN_DOCUMENT", "SEARCH_DOCUMENT", "DOCUMENT_LENGTH",
    "READ_PARAGRAPH", "NTH_SENTENCE", "NTH_PARAGRAPH", "LINE_RANGE",
    "SENTENCE_RANGE", "PARAGRAPH_RANGE", "DOCUMENT_OPENING", "DOCUMENT_ENDING",
    "COUNT_WORDS", "SHOW_STATS", "FIND_MENTION",
  ],
  examples: [
    // 1. Last line
    [
      { name: "{{name1}}", content: { text: "Repeat the last line of that document" } },
      { name: "{{name2}}", content: { text: 'Last line (line 42): "The results confirm our initial hypothesis."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 2. Specific line
    [
      { name: "{{name1}}", content: { text: "Read me line 5" } },
      { name: "{{name2}}", content: { text: 'Line 5: "We propose a novel architecture."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 3. Search with "about"
    [
      { name: "{{name1}}", content: { text: "What does it say about neural networks?" } },
      { name: "{{name2}}", content: { text: 'Found at line 17: "...neural networks enable representation learning..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 4. Last N sentences
    [
      { name: "{{name1}}", content: { text: "Give me the last two sentences" } },
      { name: "{{name2}}", content: { text: 'Last 2 sentences:\n1. "The framework achieves state-of-the-art results." (line 40)\n2. "Future work will explore scalability." (line 41)', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 5. Stats
    [
      { name: "{{name1}}", content: { text: "How many words are in the document?" } },
      { name: "{{name2}}", content: { text: "Document stats: 1,247 words, 52 sentences, 8 paragraphs, 73 lines.", actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 6. Paragraph by number
    [
      { name: "{{name1}}", content: { text: "Show me paragraph 3" } },
      { name: "{{name2}}", content: { text: 'Paragraph 3 (lines 12-18, 4 sentences):\n"We employed a mixed-methods approach..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 7. Full document
    [
      { name: "{{name1}}", content: { text: "Read me what it says verbatim" } },
      { name: "{{name2}}", content: { text: 'Full document (2341 chars):\n\nAbstract: This paper introduces...', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 8. Line range
    [
      { name: "{{name1}}", content: { text: "Give me lines 5 through 10" } },
      { name: "{{name2}}", content: { text: 'Lines 5-10:\n5: "The methodology section..."\n6: "We collected data from..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 9. Ordinal paragraph
    [
      { name: "{{name1}}", content: { text: "Read me the third paragraph" } },
      { name: "{{name2}}", content: { text: 'Paragraph 3 (lines 15-21, 87 words):\n"The experimental results demonstrate..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 10. How does it end
    [
      { name: "{{name1}}", content: { text: "How does the document end?" } },
      { name: "{{name2}}", content: { text: 'Last 3 sentences:\n1. "These findings have broad implications." (line 68)\n2. "Further research is warranted." (line 69)\n3. "We release our code publicly." (line 70)', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 11. How does it start
    [
      { name: "{{name1}}", content: { text: "How does it start?" } },
      { name: "{{name2}}", content: { text: 'First 3 sentences:\n1. "Abstract: We present a novel framework." (line 1)\n2. "Recent advances in AI have enabled..." (line 1)\n3. "Our approach differs fundamentally." (line 2)', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 12. First N paragraphs
    [
      { name: "{{name1}}", content: { text: "Show me the first two paragraphs" } },
      { name: "{{name2}}", content: { text: 'First 2 paragraphs:\n\nParagraph 1 (lines 1-5, 62 words):\n"Abstract: We present..."\n\nParagraph 2 (lines 7-12, 88 words):\n"Introduction: The field of..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 13. Find / search
    [
      { name: "{{name1}}", content: { text: "Find the part about methodology" } },
      { name: "{{name2}}", content: { text: 'Found at line 24: "...Our methodology combines reinforcement learning with symbolic reasoning..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 14. Is X mentioned
    [
      { name: "{{name1}}", content: { text: "Does it mention transformers?" } },
      { name: "{{name2}}", content: { text: 'Found at line 8: "...transformer architectures have shown remarkable scaling..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 15. How long / length
    [
      { name: "{{name1}}", content: { text: "How long is this document?" } },
      { name: "{{name2}}", content: { text: "Document stats: 2,450 words, 98 sentences, 14 paragraphs, 127 lines, 14,200 characters.", actions: ["GET_EXACT_QUOTE"] } },
    ],
    // 16. Every mention / multi-match
    [
      { name: "{{name1}}", content: { text: "Find every mention of 'data'" } },
      { name: "{{name2}}", content: { text: 'Found 5 mentions of "data":\n1. Line 3: "...collected data from..."\n2. Line 12: "...data processing pipeline..."\n3. Line 28: "...data quality metrics..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
  ],

  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL of the document" },
      searchText: { type: "string", description: "Text to find for exact quote" },
      lineNumber: { type: "number", description: "Line number to retrieve" },
      mode: {
        type: "string",
        enum: ["search", "search_all", "line", "full", "last", "stats", "last_n", "first_n", "nth", "paragraph", "first_paragraph", "last_paragraph", "range", "sentence_range", "paragraph_range", "implicit_start", "implicit_end"],
        description: "Retrieval mode",
      },
    },
    required: ["url"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(quote|line\s+\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\s+(?:me\s+)?(?:the\s+)?(?:line|back|from|what|document|doc|file|paper|it)|(?:first|last|next|previous)\s+(?:line|sentence|paragraph|word|\d+\s+(?:words?|sentences?|paragraphs?|lines?))|what\s+does\s+(?:it|the\s+\w+)\s+say|recite|word\s+for\s+word|copy\s+(?:the\s+)?(?:text|line|content)|print\s+(?:the\s+)?(?:document|doc|file|contents?|text|it|full)|show\s+(?:me\s+)?(?:the\s+)?(?:document|doc|file|contents?|text|full|paragraph)|(?:give|get)\s+(?:me\s+)?(?:the\s+)?(?:text|contents?|full|document|last|first)|contents?\s+of|full\s+(?:document|text|contents?)|what(?:'s|\s+is)\s+in\s+(?:the\s+)?(?:document|doc|file|paper)|how\s+many\s+(?:words?|lines?|sentences?|paragraphs?)|word\s+count|statistics?|stats|paragraph\s+\d+|lines?\s+\d+\s+(?:to|through|thru)|(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|\d+(?:st|nd|rd|th))\s+(?:sentence|paragraph|line|word)|(?:sentence|paragraph|line)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)|how\s+long\s+is|count\s+the\s+(?:words?|lines?|sentences?)|length|(?:find|locate|search|look\s+for)|(?:is|does)\s+(?:it\s+)?(?:mention|discuss|reference|include)|(?:does\s+it\s+)?talk\s+about|every\s+(?:mention|occurrence|instance)\s+of|how\s+does\s+it\s+(?:start|begin|end)|(?:the\s+)?(?:opening|beginning|ending|conclusion)\s+of|penultimate|next\s+to\s+last|(?:go|skip)\s+to\s+(?:line|paragraph)|read\s+it|tell\s+me\s+about\s+(?:the\s+)?(?:document|doc)|sentences?\s+\d+\s+(?:to|through|thru)|paragraphs?\s+\d+\s+(?:to|through|thru)|from\s+line|everything\s+after|para\s+\d+)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<ActionResult> {
    const args = (_message.content as Record<string, unknown>) || {};
    const messageText = ((_message.content as Content)?.text || "").toLowerCase();

    // --- URL resolution: structured args first, then extract from text ---
    let url = args.url as string | undefined;
    if (!url) {
      const urlMatch = messageText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
      if (urlMatch) url = urlMatch[0];
    }

    // --- Mode inference from natural language ---
    const inferred = inferMode(messageText, args);

    // --- If still no URL, try most recent document ---
    if (!url) {
      try {
        const { getDb } = await import("../db/getDb");
        const { autognosticDocuments } = await import("../db/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb(runtime);
        const recent = await db
          .select({ url: autognosticDocuments.url })
          .from(autognosticDocuments)
          .orderBy(desc(autognosticDocuments.createdAt))
          .limit(1);
        if (recent.length > 0) url = recent[0].url;
      } catch {
        // Fall through
      }
    }

    if (!url) {
      return respond(callback, false,
        "No document URL found. Specify which document to quote from, or add a document first.",
        { error: "no_url" });
    }

    // --- STATS mode ---
    if (inferred.mode === "stats") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const p = data.profile;
      const text = `Document stats for ${url.split("/").pop()}:\n` +
        `- ${p.wordCount.toLocaleString()} words\n` +
        `- ${p.sentenceCount.toLocaleString()} sentences\n` +
        `- ${p.paragraphCount.toLocaleString()} paragraphs\n` +
        `- ${p.lineCount.toLocaleString()} lines (${p.nonBlankLineCount} non-blank)\n` +
        `- ${p.charCount.toLocaleString()} characters\n` +
        `- Avg ${p.avgWordsPerSentence} words/sentence, ${p.avgSentencesPerParagraph} sentences/paragraph`;
      return respond(callback, true, text, {
        url, wordCount: p.wordCount, sentenceCount: p.sentenceCount,
        paragraphCount: p.paragraphCount, lineCount: p.lineCount,
      });
    }

    // --- IMPLICIT START/END: rewrite to first_n/last_n with count=3 ---
    if (inferred.mode === "implicit_start") {
      inferred.mode = "first_n";
      inferred.count = 3;
      inferred.unit = "sentence";
    }
    if (inferred.mode === "implicit_end") {
      inferred.mode = "last_n";
      inferred.count = 3;
      inferred.unit = "sentence";
    }

    // --- LAST_N / FIRST_N mode (sentences, paragraphs, words, lines) ---
    if (inferred.mode === "last_n" || inferred.mode === "first_n") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const { profile, content } = data;
      const count = inferred.count ?? 1;
      const unit = inferred.unit ?? "sentence";
      const isLast = inferred.mode === "last_n";
      const direction = isLast ? "Last" : "First";

      if (unit === "sentence") {
        const items = isLast
          ? profile.sentences.slice(-count)
          : profile.sentences.slice(0, count);
        if (items.length === 0) {
          return respond(callback, false, "No sentences found in this document.", { error: "no_sentences" });
        }
        const formatted = items.map((s, i) => `${i + 1}. "${s.text}" (line ${s.lineNumber})`).join("\n");
        const text = `${direction} ${count} sentence${count > 1 ? "s" : ""}:\n${formatted}`;
        return respond(callback, true, text, { url, mode: inferred.mode, count, unit, items: items.map(s => s.text) });
      }

      if (unit === "paragraph") {
        const items = isLast
          ? profile.paragraphs.slice(-count)
          : profile.paragraphs.slice(0, count);
        if (items.length === 0) {
          return respond(callback, false, "No paragraphs found in this document.", { error: "no_paragraphs" });
        }
        const formatted = items.map((p, i) => {
          const paraText = content.substring(p.start, p.end);
          return `Paragraph ${p.index + 1} (lines ${p.lineStart}-${p.lineEnd}, ${p.wordCount} words):\n"${paraText}"`;
        }).join("\n\n");
        const text = `${direction} ${count} paragraph${count > 1 ? "s" : ""}:\n\n${formatted}`;
        return respond(callback, true, text, { url, mode: inferred.mode, count, unit });
      }

      if (unit === "word") {
        const allWords = content.trim().split(/\s+/);
        const items = isLast
          ? allWords.slice(-count)
          : allWords.slice(0, count);
        const text = `${direction} ${count} word${count > 1 ? "s" : ""}: ${items.join(" ")}`;
        return respond(callback, true, text, { url, mode: inferred.mode, count, unit, words: items });
      }

      if (unit === "line") {
        const items = isLast
          ? profile.lines.slice(-count)
          : profile.lines.slice(0, count);
        const formatted = items.map(l => {
          const lineText = content.substring(l.start, l.end);
          return `${l.index + 1}: "${lineText}"`;
        }).join("\n");
        const text = `${direction} ${count} line${count > 1 ? "s" : ""}:\n${formatted}`;
        return respond(callback, true, text, { url, mode: inferred.mode, count, unit });
      }
    }

    // --- PARAGRAPH mode ---
    if (inferred.mode === "paragraph") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const paraNum = (inferred.count ?? 1) - 1; // Convert 1-based to 0-based
      const para = data.profile.paragraphs[paraNum];
      if (!para) {
        return respond(callback, false,
          `Paragraph ${paraNum + 1} not found. Document has ${data.profile.paragraphCount} paragraphs.`,
          { error: "out_of_range", paragraphCount: data.profile.paragraphCount });
      }
      const paraText = data.content.substring(para.start, para.end);
      const text = `Paragraph ${paraNum + 1} (lines ${para.lineStart}-${para.lineEnd}, ${para.wordCount} words):\n"${paraText}"`;
      return respond(callback, true, text, { url, paragraph: paraNum + 1, wordCount: para.wordCount });
    }

    // --- FIRST/LAST PARAGRAPH mode ---
    if (inferred.mode === "first_paragraph" || inferred.mode === "last_paragraph") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const isFirst = inferred.mode === "first_paragraph";
      const para = isFirst
        ? data.profile.paragraphs[0]
        : data.profile.paragraphs[data.profile.paragraphs.length - 1];
      if (!para) {
        return respond(callback, false, "No paragraphs found in this document.", { error: "no_paragraphs" });
      }
      const label = isFirst ? "First" : "Last";
      const paraText = data.content.substring(para.start, para.end);
      const text = `${label} paragraph (lines ${para.lineStart}-${para.lineEnd}, ${para.wordCount} words):\n"${paraText}"`;
      return respond(callback, true, text, { url, paragraph: para.index + 1, wordCount: para.wordCount });
    }

    // --- NTH mode: specific Nth unit ---
    if (inferred.mode === "nth") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const n = inferred.count ?? 1;
      const unit = inferred.unit ?? "sentence";

      if (unit === "sentence") {
        const sentence = data.profile.sentences[n - 1];
        if (!sentence) {
          return respond(callback, false,
            `Sentence ${n} not found. Document has ${data.profile.sentenceCount} sentences.`,
            { error: "out_of_range", sentenceCount: data.profile.sentenceCount });
        }
        const text = `Sentence ${n} (line ${sentence.lineNumber}): "${sentence.text}"`;
        return respond(callback, true, text, { url, sentenceNumber: n, lineNumber: sentence.lineNumber });
      }
      if (unit === "paragraph") {
        // Delegate to paragraph mode
        inferred.mode = "paragraph";
        inferred.count = n;
        // Fall through to paragraph handler below
      } else if (unit === "line") {
        // Delegate to line mode
        inferred.mode = "line";
        inferred.lineNumber = n;
        // Fall through to line handler below
      } else if (unit === "word") {
        const allWords = data.content.trim().split(/\s+/);
        const word = allWords[n - 1];
        if (!word) {
          return respond(callback, false,
            `Word ${n} not found. Document has ${allWords.length} words.`,
            { error: "out_of_range", wordCount: allWords.length });
        }
        const text = `Word ${n}: "${word}"`;
        return respond(callback, true, text, { url, wordNumber: n, word });
      }
    }

    // --- SENTENCE_RANGE mode ---
    if (inferred.mode === "sentence_range") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const start = (inferred.lineNumber ?? 1) - 1;
      const end = (inferred.lineEnd ?? start + 1) - 1;
      const items = data.profile.sentences.slice(start, end + 1);
      if (items.length === 0) {
        return respond(callback, false,
          `Sentences ${start + 1}-${end + 1} not found. Document has ${data.profile.sentenceCount} sentences.`,
          { error: "out_of_range", sentenceCount: data.profile.sentenceCount });
      }
      const formatted = items.map((s) =>
        `${s.index + 1}. "${s.text}" (line ${s.lineNumber})`
      ).join("\n");
      const text = `Sentences ${start + 1}-${end + 1}:\n${formatted}`;
      return respond(callback, true, text, { url, sentenceStart: start + 1, sentenceEnd: end + 1 });
    }

    // --- PARAGRAPH_RANGE mode ---
    if (inferred.mode === "paragraph_range") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const start = (inferred.lineNumber ?? 1) - 1;
      const actualEnd = Math.min(
        (inferred.lineEnd ?? data.profile.paragraphCount) - 1,
        data.profile.paragraphCount - 1
      );
      const items = data.profile.paragraphs.slice(start, actualEnd + 1);
      if (items.length === 0) {
        return respond(callback, false,
          `Paragraphs ${start + 1}-${actualEnd + 1} not found. Document has ${data.profile.paragraphCount} paragraphs.`,
          { error: "out_of_range", paragraphCount: data.profile.paragraphCount });
      }
      const formatted = items.map(p => {
        const paraText = data.content.substring(p.start, p.end);
        return `Paragraph ${p.index + 1} (lines ${p.lineStart}-${p.lineEnd}, ${p.wordCount} words):\n"${paraText}"`;
      }).join("\n\n");
      const text = `Paragraphs ${start + 1}-${actualEnd + 1}:\n\n${formatted}`;
      return respond(callback, true, text, { url, paragraphStart: start + 1, paragraphEnd: actualEnd + 1 });
    }

    // --- SEARCH_ALL mode ---
    if (inferred.mode === "search_all") {
      const result = await getExactQuoteAll(runtime, url, inferred.searchText!);
      if (result.totalCount === 0) {
        return respond(callback, false,
          `No mentions of "${inferred.searchText}" found.`,
          { error: "not_found", searchText: inferred.searchText });
      }
      const formatted = result.matches.map((m, i) =>
        `${i + 1}. Line ${m.lineNumber}: "...${m.context}..."`
      ).join("\n");
      const text = `Found ${result.totalCount} mention(s) of "${inferred.searchText}":\n${formatted}`;
      return respond(callback, true, text, { url, searchText: inferred.searchText, totalCount: result.totalCount });
    }

    // --- RANGE mode: lines N to M ---
    if (inferred.mode === "range") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const start = (inferred.lineNumber ?? 1) - 1; // 0-based
      const actualEnd = Math.min(
        (inferred.lineEnd ?? start + 1) - 1,
        data.profile.lineCount - 1
      ); // Clamp to actual doc size
      const lines = data.profile.lines.slice(start, actualEnd + 1);
      if (lines.length === 0) {
        return respond(callback, false,
          `Lines ${start + 1}-${actualEnd + 1} not found. Document has ${data.profile.lineCount} lines.`,
          { error: "out_of_range", lineCount: data.profile.lineCount });
      }
      const formatted = lines.map(l => {
        const lineText = data.content.substring(l.start, l.end);
        return `${l.index + 1}: "${lineText}"`;
      }).join("\n");
      const text = `Lines ${start + 1}-${actualEnd + 1}:\n${formatted}`;
      return respond(callback, true, text, { url, lineStart: start + 1, lineEnd: actualEnd + 1 });
    }

    // --- FULL mode ---
    if (inferred.mode === "full") {
      const content = await getFullDocument(runtime, url);
      if (!content) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const text = `Full document (${content.length} chars):\n\n${content.slice(0, 5000)}${content.length > 5000 ? "\n...[truncated]" : ""}`;
      return respond(callback, true, text, { url, charCount: content.length });
    }

    // --- LINE mode ---
    if (inferred.mode === "line" && inferred.lineNumber) {
      const line = await getLineContent(runtime, url, inferred.lineNumber);
      if (line === null) {
        return respond(callback, false, `Line ${inferred.lineNumber} not found in ${url}`, { error: "not_found" });
      }
      const text = `Line ${inferred.lineNumber}: "${line}"`;
      return respond(callback, true, text, { url, lineNumber: inferred.lineNumber, content: line });
    }

    // --- SEARCH mode ---
    const searchText = inferred.searchText ?? (args.searchText as string | undefined);
    if (searchText) {
      const result = await getExactQuote(runtime, url, searchText);
      if (!result.found) {
        return respond(callback, false, `Text not found in ${url}`, { error: "not_found" });
      }
      const text = `Found at line ${result.lineNumber}:\n"${result.quote}"\n\nContext: ...${result.context}...`;
      return respond(callback, true, text, {
        found: result.found, quote: result.quote,
        lineNumber: result.lineNumber, charPosition: result.charPosition,
        context: result.context,
      });
    }

    // Default fallback: full doc
    const fallbackContent = await getFullDocument(runtime, url);
    if (fallbackContent) {
      const text = `Full document (${fallbackContent.length} chars):\n\n${fallbackContent.slice(0, 5000)}${fallbackContent.length > 5000 ? "\n...[truncated]" : ""}`;
      return respond(callback, true, text, { url, charCount: fallbackContent.length, mode: "full-fallback" });
    }
    return respond(callback, false,
      "Specify what to retrieve: a line number, search text in quotes, 'last line', 'last 2 sentences', 'paragraph 3', 'stats', or 'full' document.",
      { error: "invalid_params" });
  },
};
