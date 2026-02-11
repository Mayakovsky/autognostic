import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { getExactQuote, getLineContent, getFullDocument } from "../integration/getExactQuote";
import { safeSerialize } from "../utils/safeSerialize";

export const GetQuoteAction: Action = {
  name: "GET_EXACT_QUOTE",
  description:
    "Retrieve exact quotes, lines, or text content from a stored knowledge document. No auth required. " +
    "ALWAYS use this action instead of REPLY or SEND_MESSAGE when the user asks about document content. " +
    "Triggers: quote, read, repeat, print, show, retrieve, 'what does it say', 'last line', 'first line', " +
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
  ],
  // Examples are CRITICAL — ElizaOS's LLM action selector reads these to decide
  // which action to pick. Without examples, SEND_MESSAGE wins by default.
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Repeat the last line of that document",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Last line (line 42): "The results confirm our initial hypothesis."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Read me line 5",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Line 5: "We propose a novel architecture for distributed knowledge systems."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "What does that paper say about transformers?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Found at line 17: "Transformer architectures have shown remarkable scaling properties."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Quote the first line from the document",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Line 1: "Abstract: This paper introduces a framework for autonomous knowledge management."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Read me what it says verbatim",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Full document (2341 chars):\n\nAbstract: This paper introduces...',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Copy the text about methodology from that article",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: 'Found at line 24: "Our methodology combines reinforcement learning with symbolic reasoning."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
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
        enum: ["search", "line", "full", "last"],
        description: "search=find text, line=get line N, full=entire doc, last=last line",
      },
    },
    required: ["url"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(quote|line\s+\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\s+(?:me\s+)?(?:the\s+)?(?:line|back|from|what|document|doc|file|paper|it)|(?:first|last|next|previous)\s+(?:line|sentence|paragraph|word|\d+\s+words?)|what\s+does\s+(?:it|the\s+\w+)\s+say|recite|word\s+for\s+word|copy\s+(?:the\s+)?(?:text|line|content)|print\s+(?:the\s+)?(?:document|doc|file|contents?|text|it|full)|show\s+(?:me\s+)?(?:the\s+)?(?:document|doc|file|contents?|text|full)|(?:give|get)\s+(?:me\s+)?(?:the\s+)?(?:text|contents?|full|document)|contents?\s+of|full\s+(?:document|text|contents?)|what(?:'s|\s+is)\s+in\s+(?:the\s+)?(?:document|doc|file|paper))/i.test(text);
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
    let mode = (args.mode as string) || "";
    let lineNumber = args.lineNumber as number | undefined;
    let searchText = args.searchText as string | undefined;

    if (!mode) {
      if (/\b(?:full|entire|whole|all)\b/.test(messageText)) {
        mode = "full";
      } else if (lineNumber || /\bline\s+\d+/i.test(messageText)) {
        mode = "line";
        if (!lineNumber) {
          const lineMatch = messageText.match(/line\s+(\d+)/i);
          if (lineMatch) lineNumber = parseInt(lineMatch[1], 10);
        }
      } else if (/\b(?:last|final|ending)\s+(?:line|sentence|word)/i.test(messageText)) {
        mode = "last";
      } else if (/\b(?:first|opening|beginning|starting)\s+(?:line|sentence|word)/i.test(messageText)) {
        mode = "line";
        lineNumber = 1;
      } else if (searchText) {
        mode = "search";
      } else {
        // Default: if no clear mode, try to find any quoted search text
        const quotedMatch = messageText.match(/["']([^"']+)["']/);
        if (quotedMatch) {
          searchText = quotedMatch[1];
          mode = "search";
        }
      }
    }

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
      const text = "No document URL found. Specify which document to quote from, or add a document first.";
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: false, text, data: safeSerialize({ error: "no_url" }) };
    }

    // --- FULL mode ---
    if (mode === "full") {
      const content = await getFullDocument(runtime, url);
      if (!content) {
        const text = `Document not found: ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Full document (${content.length} chars):\n\n${content.slice(0, 5000)}${content.length > 5000 ? "\n...[truncated]" : ""}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: true, text, data: safeSerialize({ url, charCount: content.length }) };
    }

    // --- LAST line/sentence mode ---
    if (mode === "last") {
      const content = await getFullDocument(runtime, url);
      if (!content) {
        const text = `Document not found: ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const lines = content.split("\n").filter(l => l.trim().length > 0);
      const lastLine = lines[lines.length - 1];
      const lastLineNumber = content.split("\n").length;
      const text = `Last line (line ${lastLineNumber}): "${lastLine}"`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return {
        success: true,
        text,
        data: safeSerialize({ url, lineNumber: lastLineNumber, content: lastLine }),
      };
    }

    // --- LINE mode ---
    if (mode === "line" && lineNumber) {
      const line = await getLineContent(runtime, url, lineNumber);
      if (line === null) {
        const text = `Line ${lineNumber} not found in ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Line ${lineNumber}: "${line}"`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: true, text, data: safeSerialize({ url, lineNumber, content: line }) };
    }

    // --- SEARCH mode ---
    if (searchText) {
      const result = await getExactQuote(runtime, url, searchText);
      if (!result.found) {
        const text = `Text not found in ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Found at line ${result.lineNumber}:\n"${result.quote}"\n\nContext: ...${result.context}...`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: true, text, data: safeSerialize(result as unknown as Record<string, unknown>) };
    }

    // Default fallback: if user asked generically ("print the document", "show me"), retrieve full doc
    const fallbackContent = await getFullDocument(runtime, url);
    if (fallbackContent) {
      const text = `Full document (${fallbackContent.length} chars):\n\n${fallbackContent.slice(0, 5000)}${fallbackContent.length > 5000 ? "\n...[truncated]" : ""}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: true, text, data: safeSerialize({ url, charCount: fallbackContent.length, mode: "full-fallback" }) };
    }
    const text = "Specify what to retrieve: a line number, search text in quotes, 'last line', or 'full' document.";
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: false, text, data: safeSerialize({ error: "invalid_params" }) };
  },
};
