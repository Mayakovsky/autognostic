import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { getExactQuote, getLineContent, getFullDocument } from "../integration/getExactQuote";
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

/** Parse a number word like "two" or digit string like "3" */
function parseCount(s: string): number {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    twenty: 20, thirty: 30, fifty: 50, hundred: 100,
  };
  const lower = s.toLowerCase().trim();
  return words[lower] ?? (parseInt(lower, 10) || 1);
}

type InferredMode = {
  mode: string;
  count?: number;
  lineNumber?: number;
  lineEnd?: number;
  searchText?: string;
  unit?: string;
};

/** Infer mode from natural language, returning structured mode info */
function inferMode(messageText: string, args: Record<string, unknown>): InferredMode {
  const explicitMode = args.mode as string | undefined;
  const lineNumber = args.lineNumber as number | undefined;
  const searchText = args.searchText as string | undefined;

  if (explicitMode) {
    return { mode: explicitMode, lineNumber, searchText };
  }

  // --- Stats / word count ---
  if (/\b(?:how\s+many\s+(?:words?|lines?|sentences?|paragraphs?))\b/i.test(messageText) ||
      /\b(?:word\s+count|statistics?|stats|overview)\b/i.test(messageText)) {
    return { mode: "stats" };
  }

  // --- Last N sentences/paragraphs/words/lines ---
  const lastNMatch = messageText.match(/\blast\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(sentences?|paragraphs?|words?|lines?)\b/i);
  if (lastNMatch) {
    return { mode: "last_n", count: parseCount(lastNMatch[1]), unit: lastNMatch[2].replace(/s$/, "") };
  }

  // --- First N sentences/paragraphs/words/lines ---
  const firstNMatch = messageText.match(/\bfirst\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(sentences?|paragraphs?|words?|lines?)\b/i);
  if (firstNMatch) {
    return { mode: "first_n", count: parseCount(firstNMatch[1]), unit: firstNMatch[2].replace(/s$/, "") };
  }

  // --- Paragraph N ---
  const paraMatch = messageText.match(/\bparagraph\s+(\d+)\b/i);
  if (paraMatch) {
    return { mode: "paragraph", count: parseInt(paraMatch[1], 10) };
  }

  // --- Last paragraph ---
  if (/\b(?:last|final|ending)\s+paragraph\b/i.test(messageText)) {
    return { mode: "last_paragraph" };
  }

  // --- First paragraph ---
  if (/\b(?:first|opening|beginning|starting)\s+paragraph\b/i.test(messageText)) {
    return { mode: "first_paragraph" };
  }

  // --- Line range: "lines 5 to 10" ---
  const rangeMatch = messageText.match(/\blines?\s+(\d+)\s+(?:to|through|thru|-)\s+(\d+)\b/i);
  if (rangeMatch) {
    return { mode: "range", lineNumber: parseInt(rangeMatch[1], 10), lineEnd: parseInt(rangeMatch[2], 10) };
  }

  // --- Full document ---
  if (/\b(?:full|entire|whole|all)\b/.test(messageText)) {
    return { mode: "full" };
  }

  // --- Specific line ---
  if (lineNumber || /\bline\s+\d+/i.test(messageText)) {
    let ln = lineNumber;
    if (!ln) {
      const lineMatch = messageText.match(/line\s+(\d+)/i);
      if (lineMatch) ln = parseInt(lineMatch[1], 10);
    }
    return { mode: "line", lineNumber: ln };
  }

  // --- Last line/sentence/word ---
  if (/\b(?:last|final|ending)\s+(?:line|sentence|word)\b/i.test(messageText)) {
    const unitMatch = messageText.match(/(?:last|final|ending)\s+(line|sentence|word)/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : "line";
    return { mode: "last_n", count: 1, unit };
  }

  // --- First line/sentence/word ---
  if (/\b(?:first|opening|beginning|starting)\s+(?:line|sentence|word)\b/i.test(messageText)) {
    const unitMatch = messageText.match(/(?:first|opening|beginning|starting)\s+(line|sentence|word)/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : "line";
    return { mode: "first_n", count: 1, unit };
  }

  // --- Search mode ---
  if (searchText) {
    return { mode: "search", searchText };
  }

  // --- Quoted text search ---
  const quotedMatch = messageText.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    return { mode: "search", searchText: quotedMatch[1] };
  }

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
    "Retrieve exact quotes, lines, sentences, paragraphs, or stats from a stored knowledge document. No auth required. " +
    "ALWAYS use this action instead of REPLY or SEND_MESSAGE when the user asks about document content. " +
    "Triggers: quote, read, repeat, print, show, retrieve, 'what does it say', 'last line', 'first line', " +
    "'last two sentences', 'paragraph 3', 'how many words', 'word count', 'lines 5 to 10', " +
    "'give me the text', 'contents of', 'full document'. " +
    "Do NOT attempt to recall document content from conversation context — only this action can retrieve it accurately. " +
    "This is the ONLY way to get stored document content. REPLY cannot access documents.",
  similes: [
    "QUOTE_FROM",
    "GET_LINE",
    "EXACT_QUOTE",
    "READ_LINE",
    "READ_DOCUMENT",
    "REPEAT_LINE",
    "REPEAT_TEXT",
    "SHOW_LINE",
    "RETRIEVE_TEXT",
    "GET_CONTENT",
    "LAST_LINE",
    "FIRST_LINE",
    "DOCUMENT_STATS",
    "WORD_COUNT",
    "GET_PARAGRAPH",
    "GET_SENTENCES",
  ],
  examples: [
    [
      { name: "{{name1}}", content: { text: "Repeat the last line of that document" } },
      { name: "{{name2}}", content: { text: 'Last line (line 42): "The results confirm our initial hypothesis."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "Read me line 5" } },
      { name: "{{name2}}", content: { text: 'Line 5: "We propose a novel architecture for distributed knowledge systems."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "What does that paper say about transformers?" } },
      { name: "{{name2}}", content: { text: 'Found at line 17: "Transformer architectures have shown remarkable scaling properties."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "Give me the last two sentences" } },
      { name: "{{name2}}", content: { text: 'Last 2 sentences:\n1. "The framework achieves state-of-the-art results."\n2. "Future work will explore scalability."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "How many words are in the document?" } },
      { name: "{{name2}}", content: { text: "Document stats: 1,247 words, 52 sentences, 8 paragraphs, 73 lines.", actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "Show me paragraph 3" } },
      { name: "{{name2}}", content: { text: 'Paragraph 3 (lines 12-18, 4 sentences):\n"We employed a mixed-methods approach..."', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "Read me what it says verbatim" } },
      { name: "{{name2}}", content: { text: 'Full document (2341 chars):\n\nAbstract: This paper introduces...', actions: ["GET_EXACT_QUOTE"] } },
    ],
    [
      { name: "{{name1}}", content: { text: "Give me lines 5 through 10" } },
      { name: "{{name2}}", content: { text: 'Lines 5-10:\n5: "The methodology section..."\n6: "We collected data from..."', actions: ["GET_EXACT_QUOTE"] } },
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
        enum: ["search", "line", "full", "last", "stats", "last_n", "first_n", "paragraph", "first_paragraph", "last_paragraph", "range"],
        description: "Retrieval mode",
      },
    },
    required: ["url"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(quote|line\s+\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\s+(?:me\s+)?(?:the\s+)?(?:line|back|from|what|document|doc|file|paper|it)|(?:first|last|next|previous)\s+(?:line|sentence|paragraph|word|\d+\s+(?:words?|sentences?|paragraphs?|lines?))|what\s+does\s+(?:it|the\s+\w+)\s+say|recite|word\s+for\s+word|copy\s+(?:the\s+)?(?:text|line|content)|print\s+(?:the\s+)?(?:document|doc|file|contents?|text|it|full)|show\s+(?:me\s+)?(?:the\s+)?(?:document|doc|file|contents?|text|full|paragraph)|(?:give|get)\s+(?:me\s+)?(?:the\s+)?(?:text|contents?|full|document|last|first)|contents?\s+of|full\s+(?:document|text|contents?)|what(?:'s|\s+is)\s+in\s+(?:the\s+)?(?:document|doc|file|paper)|how\s+many\s+(?:words?|lines?|sentences?|paragraphs?)|word\s+count|statistics?|stats|paragraph\s+\d+|lines?\s+\d+\s+(?:to|through|thru))/i.test(text);
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

    // --- RANGE mode: lines N to M ---
    if (inferred.mode === "range") {
      const data = await getOrComputeProfile(runtime, url);
      if (!data) {
        return respond(callback, false, `Document not found: ${url}`, { error: "not_found" });
      }
      const start = (inferred.lineNumber ?? 1) - 1; // 0-based
      const end = (inferred.lineEnd ?? start + 1) - 1; // 0-based
      const lines = data.profile.lines.slice(start, end + 1);
      if (lines.length === 0) {
        return respond(callback, false,
          `Lines ${start + 1}-${end + 1} not found. Document has ${data.profile.lineCount} lines.`,
          { error: "out_of_range", lineCount: data.profile.lineCount });
      }
      const formatted = lines.map(l => {
        const lineText = data.content.substring(l.start, l.end);
        return `${l.index + 1}: "${lineText}"`;
      }).join("\n");
      const text = `Lines ${start + 1}-${end + 1}:\n${formatted}`;
      return respond(callback, true, text, { url, lineStart: start + 1, lineEnd: end + 1 });
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
