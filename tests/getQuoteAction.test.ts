import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetQuoteAction } from "../src/actions/getQuoteAction";
import { createMockRuntime } from "./setup";

// Mock the integration module
vi.mock("../src/integration/getExactQuote", () => ({
  getExactQuote: vi.fn(),
  getLineContent: vi.fn(),
  getFullDocument: vi.fn(),
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
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("repeat the last line")
      );
      expect(result).toBe(true);
    });

    it("should match 'read me line 5'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("read me line 5")
      );
      expect(result).toBe(true);
    });

    it("should match 'what does it say'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("what does it say")
      );
      expect(result).toBe(true);
    });

    it("should match 'quote from the document'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("quote from the document")
      );
      expect(result).toBe(true);
    });

    it("should match 'copy the text from'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("copy the text from the file")
      );
      expect(result).toBe(true);
    });

    it("should match 'first line'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("show me the first line")
      );
      expect(result).toBe(true);
    });

    it("should match 'word for word'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("give it to me word for word")
      );
      expect(result).toBe(true);
    });

    it("should NOT match 'send a message to Bob'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("send a message to Bob")
      );
      expect(result).toBe(false);
    });

    it("should NOT match 'hello how are you'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("hello how are you")
      );
      expect(result).toBe(false);
    });

    it("should NOT match 'add this URL to knowledge'", async () => {
      const result = await GetQuoteAction.validate!(
        runtime as any,
        createMessage("add this URL to knowledge https://example.com")
      );
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    let mockCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockCallback = vi.fn();
      vi.clearAllMocks();
    });

    it("should resolve 'last line' mode from natural language", async () => {
      const { getFullDocument } = await import("../src/integration/getExactQuote");
      (getFullDocument as any).mockResolvedValue("Line one\nLine two\nLine three\nThe final line");

      const runtime = createMockRuntime();
      const message = createMessage(
        "repeat the last line from https://example.com/doc.txt",
        { url: "https://example.com/doc.txt" }
      );

      const result = await GetQuoteAction.handler(
        runtime as any,
        message,
        undefined,
        undefined,
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("The final line");
      expect((result as any).success).toBe(true);
    });

    it("should resolve 'first line' to lineNumber 1", async () => {
      const { getLineContent } = await import("../src/integration/getExactQuote");
      (getLineContent as any).mockResolvedValue("This is the first line");

      const runtime = createMockRuntime();
      const message = createMessage(
        "read me the first line from https://example.com/doc.txt",
        { url: "https://example.com/doc.txt" }
      );

      const result = await GetQuoteAction.handler(
        runtime as any,
        message,
        undefined,
        undefined,
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect((getLineContent as any)).toHaveBeenCalledWith(
        expect.anything(),
        "https://example.com/doc.txt",
        1
      );
      expect((result as any).success).toBe(true);
    });

    it("should extract URL from message text when not in structured args", async () => {
      const { getFullDocument } = await import("../src/integration/getExactQuote");
      (getFullDocument as any).mockResolvedValue("Some content\nLast one");

      const runtime = createMockRuntime();
      // URL only in text, not in structured args
      const message = createMessage(
        "repeat the last line from https://example.com/test.md"
      );

      const result = await GetQuoteAction.handler(
        runtime as any,
        message,
        undefined,
        undefined,
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      expect((result as any).success).toBe(true);
    });

    it("should return error when no URL found anywhere", async () => {
      const runtime = createMockRuntime();
      const message = createMessage("repeat the last line");

      const result = await GetQuoteAction.handler(
        runtime as any,
        message,
        undefined,
        undefined,
        mockCallback
      );

      expect(mockCallback).toHaveBeenCalled();
      const callText = mockCallback.mock.calls[0][0].text;
      expect(callText).toContain("No document URL found");
      expect((result as any).success).toBe(false);
    });
  });
});
