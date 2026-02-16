import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetQuoteAction } from "../src/actions/getQuoteAction";
import { createMockRuntime } from "./setup";

// Mock the integration module
vi.mock("../src/integration/getExactQuote", () => ({
  getExactQuote: vi.fn(),
  getLineContent: vi.fn(),
  getFullDocument: vi.fn(),
}));

// Mock the repository for profile-aware handler
vi.mock("../src/db/autognosticDocumentsRepository", () => ({
  autognosticDocumentsRepository: {
    getWithProfile: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    getFullContent: vi.fn().mockResolvedValue(null),
  },
}));

// Mock the DB modules used by the handler's fallback URL lookup
vi.mock("../src/db/getDb", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
}));

vi.mock("../src/db/schema", () => ({
  autognosticDocuments: {
    url: "url",
    createdAt: "createdAt",
  },
}));

function createMessage(text: string, extras: Record<string, unknown> = {}) {
  return {
    content: { text, ...extras },
    userId: "test-user",
    roomId: "test-room",
  } as any;
}

describe("GetQuoteAction", () => {
  describe("validate", () => {
    const runtime = createMockRuntime();

    it("should match 'repeat the last line'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("repeat the last line"));
      expect(result).toBe(true);
    });

    it("should match 'read me line 5'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("read me line 5"));
      expect(result).toBe(true);
    });

    it("should match 'what does it say'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("what does it say"));
      expect(result).toBe(true);
    });

    it("should match 'quote from the document'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("quote from the document"));
      expect(result).toBe(true);
    });

    it("should match 'copy the text from'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("copy the text from the file"));
      expect(result).toBe(true);
    });

    it("should match 'first line'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("show me the first line"));
      expect(result).toBe(true);
    });

    it("should match 'word for word'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("give it to me word for word"));
      expect(result).toBe(true);
    });

    it("should NOT match 'send a message to Bob'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("send a message to Bob"));
      expect(result).toBe(false);
    });

    it("should NOT match 'hello how are you'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("hello how are you"));
      expect(result).toBe(false);
    });

    it("should NOT match 'add this URL to knowledge'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("add this URL to knowledge https://example.com"));
      expect(result).toBe(false);
    });

    it("should match 'how many words'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("how many words are in the document"));
      expect(result).toBe(true);
    });

    it("should match 'last two sentences'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("give me the last two sentences"));
      expect(result).toBe(true);
    });

    it("should match 'paragraph 3'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("show me paragraph 3"));
      expect(result).toBe(true);
    });

    it("should match 'lines 5 through 10'", async () => {
      const result = await GetQuoteAction.validate!(runtime as any, createMessage("read lines 5 through 10"));
      expect(result).toBe(true);
    });
  });

  describe("handler", () => {
    let mockCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockCallback = vi.fn();
      vi.clearAllMocks();
    });

    it("should resolve 'last line' mode from natural language", async () => {
      const { autognosticDocumentsRepository } = await import("../src/db/autognosticDocumentsRepository");
      (autognosticDocumentsRepository.getWithProfile as any).mockResolvedValue({
        content: "Line one\nLine two\nLine three\nThe final line",
        profile: null,
      });

      const runtime = createMockRuntime();
      const message = createMessage("repeat the last line from https://example.com/doc.txt", { url: "https://example.com/doc.txt" });
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("The final line");
      expect((result as any).success).toBe(true);
    });

    it("should resolve 'first line' to lineNumber 1", async () => {
      const { autognosticDocumentsRepository } = await import("../src/db/autognosticDocumentsRepository");
      (autognosticDocumentsRepository.getWithProfile as any).mockResolvedValue({
        content: "This is the first line\nSecond line",
        profile: null,
      });

      const runtime = createMockRuntime();
      const message = createMessage("read me the first line from https://example.com/doc.txt", { url: "https://example.com/doc.txt" });
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("This is the first line");
      expect((result as any).success).toBe(true);
    });

    it("should extract URL from message text when not in structured args", async () => {
      const { autognosticDocumentsRepository } = await import("../src/db/autognosticDocumentsRepository");
      (autognosticDocumentsRepository.getWithProfile as any).mockResolvedValue({
        content: "Some content\nLast one",
        profile: null,
      });

      const runtime = createMockRuntime();
      const message = createMessage("repeat the last line from https://example.com/test.md");
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      expect((result as any).success).toBe(true);
    });

    it("should return error when no URL found anywhere", async () => {
      const runtime = createMockRuntime();
      const message = createMessage("repeat the last line");
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("No document URL found");
      expect((result as any).success).toBe(false);
    });

    it("should return only word count when asked 'how many words' (stat_specific)", async () => {
      const { autognosticDocumentsRepository } = await import("../src/db/autognosticDocumentsRepository");
      (autognosticDocumentsRepository.getWithProfile as any).mockResolvedValue({
        content: "Hello world. Goodbye.",
        profile: {
          charCount: 21, wordCount: 3, lineCount: 1, nonBlankLineCount: 1,
          sentenceCount: 2, paragraphCount: 1,
          sentences: [], paragraphs: [], lines: [],
          firstSentence: "Hello world.", lastSentence: "Goodbye.",
          avgWordsPerSentence: 1.5, avgSentencesPerParagraph: 2,
          analyzedAt: "2026-01-01T00:00:00.000Z", analyzerVersion: "1.0",
        },
      });

      const runtime = createMockRuntime();
      const message = createMessage("how many words are in https://example.com/doc.txt", { url: "https://example.com/doc.txt" });
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("3 words");
      // stat_specific returns ONLY the requested stat, not the full dump
      expect(callText).not.toContain("sentences");
      expect(callText).not.toContain("paragraphs");
      expect((result as any).success).toBe(true);
    });

    it("should return last N sentences when asked", async () => {
      const { autognosticDocumentsRepository } = await import("../src/db/autognosticDocumentsRepository");
      (autognosticDocumentsRepository.getWithProfile as any).mockResolvedValue({
        content: "First sentence. Second sentence. Third sentence.",
        profile: {
          charCount: 48, wordCount: 6, lineCount: 1, nonBlankLineCount: 1,
          sentenceCount: 3, paragraphCount: 1,
          sentences: [
            { index: 0, start: 0, end: 15, lineNumber: 1, wordCount: 2, text: "First sentence." },
            { index: 1, start: 16, end: 32, lineNumber: 1, wordCount: 2, text: "Second sentence." },
            { index: 2, start: 33, end: 48, lineNumber: 1, wordCount: 2, text: "Third sentence." },
          ],
          paragraphs: [], lines: [],
          firstSentence: "First sentence.", lastSentence: "Third sentence.",
          avgWordsPerSentence: 2, avgSentencesPerParagraph: 3,
          analyzedAt: "2026-01-01T00:00:00.000Z", analyzerVersion: "1.0",
        },
      });

      const runtime = createMockRuntime();
      const message = createMessage("give me the last two sentences from https://example.com/doc.txt", { url: "https://example.com/doc.txt" });
      const result = await GetQuoteAction.handler(runtime as any, message, undefined, undefined, mockCallback);

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("Second sentence.");
      expect(callText).toContain("Third sentence.");
      expect((result as any).success).toBe(true);
    });
  });
});
