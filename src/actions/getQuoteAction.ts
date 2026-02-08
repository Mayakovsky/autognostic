import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, Content } from "@elizaos/core";
import { getExactQuote, getLineContent, getFullDocument } from "../integration/getExactQuote";
import { safeSerialize } from "../utils/safeSerialize";

export const GetQuoteAction: Action = {
  name: "GET_EXACT_QUOTE",
  description: "Retrieve exact quotes or line content from a stored document. No auth required.",
  similes: ["QUOTE_FROM", "GET_LINE", "EXACT_QUOTE"],
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL of the document" },
      searchText: { type: "string", description: "Text to find for exact quote" },
      lineNumber: { type: "number", description: "Line number to retrieve" },
      mode: {
        type: "string",
        enum: ["search", "line", "full"],
        description: "search=find text, line=get line N, full=entire doc",
      },
    },
    required: ["url"],
  },

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = ((message.content as Content)?.text || "").toLowerCase();
    return /\b(quote|line\s+\d|exact|verbatim)/i.test(text);
  },

  async handler(
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: HandlerOptions | undefined,
    callback: HandlerCallback | undefined
  ): Promise<ActionResult> {
    const args = (_message.content as Record<string, unknown>) || {};
    const url = args.url as string;
    const mode = (args.mode as string) || "search";

    if (mode === "full") {
      const content = await getFullDocument(runtime, url);
      if (!content) {
        const text = `Document not found: ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Full document (${content.length} chars):\n\n${content.slice(0, 5000)}${content.length > 5000 ? "\n...[truncated]" : ""}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return {
        success: true,
        text,
        data: safeSerialize({ url, charCount: content.length }),
      };
    }

    if (mode === "line" && args.lineNumber) {
      const lineNumber = args.lineNumber as number;
      const line = await getLineContent(runtime, url, lineNumber);
      if (line === null) {
        const text = `Line ${lineNumber} not found in ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Line ${lineNumber}: "${line}"`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return {
        success: true,
        text,
        data: safeSerialize({ url, lineNumber, content: line }),
      };
    }

    if (args.searchText) {
      const result = await getExactQuote(runtime, url, args.searchText as string);
      if (!result.found) {
        const text = `Text not found in ${url}`;
        if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
        return { success: false, text, data: safeSerialize({ error: "not_found" }) };
      }
      const text = `Found at line ${result.lineNumber}:\n"${result.quote}"\n\nContext: ...${result.context}...`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return {
        success: true,
        text,
        data: safeSerialize(result as unknown as Record<string, unknown>),
      };
    }

    const text = "Specify searchText for search mode or lineNumber for line mode";
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: false, text, data: safeSerialize({ error: "invalid_params" }) };
  },
};
