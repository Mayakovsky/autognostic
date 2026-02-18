import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPdfBytes, normalizeToRawUrl, normalizePdfText } from "../src/services/ContentResolver";

// Minimal valid %PDF header bytes for testing
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

// Controllable mock return value for PdfExtractor
let pdfExtractResult = {
  text: "Mock PDF text.",
  pageCount: 1,
  metadata: {} as Record<string, string | undefined>,
};

// Mock PdfExtractor ONCE — hoisted to top by vitest
vi.mock("../src/services/PdfExtractor", () => ({
  PdfExtractor: class {
    async extract(_buf: Uint8Array) {
      return pdfExtractResult;
    }
  },
}));

// Must import ContentResolver AFTER the vi.mock so the mock is in effect
import { ContentResolver } from "../src/services/ContentResolver";

/**
 * Create a mock HttpService that returns canned responses keyed by URL.
 */
function createMockHttp(
  responses: Map<
    string,
    {
      status: number;
      headers: Record<string, string>;
      body: string | Uint8Array;
    }
  >
) {
  return {
    get: vi.fn(async (url: string, _opts?: any) => {
      const resp = responses.get(url);
      if (!resp) throw new Error(`No mock for ${url}`);
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        headers: new Headers(resp.headers),
        text: async () =>
          typeof resp.body === "string"
            ? resp.body
            : new TextDecoder().decode(resp.body),
        arrayBuffer: async () =>
          typeof resp.body === "string"
            ? new TextEncoder().encode(resp.body).buffer
            : resp.body.buffer,
      };
    }),
  } as any;
}

// Synthetic HTML fixtures
const ARTICLE_HTML_PAYWALL = `<!DOCTYPE html>
<html><head>
  <title>Study of Policy Implementation</title>
  <meta name="citation_doi" content="10.1186/s12961-017-0235-3">
  <meta name="citation_pdf_url" content="https://publisher.example.com/paper.pdf">
  <meta name="description" content="A systematic review">
</head><body>
  <nav>Home | Journals</nav>
  <article>
    <h1>Study of Policy Implementation</h1>
    <p>Background: Policy implementation is a critical challenge.</p>
    <h2>Methods</h2>
    <p>We conducted a systematic review of 47 studies.</p>
    <h2>Results</h2>
    <p>The review identified three major themes.</p>
  </article>
  <footer>Copyright 2017</footer>
</body></html>`;

const ARTICLE_HTML_GOOD_PDF = `<!DOCTYPE html>
<html><head>
  <title>Open Access Paper</title>
  <meta name="citation_pdf_url" content="https://publisher.example.com/open.pdf">
</head><body>
  <article>
    <h1>Open Access Paper</h1>
    <p>This paper is freely available.</p>
  </article>
</body></html>`;

// Structured HTML with proper heading hierarchy (simulates open-access paper)
// Content must exceed 5000 chars for quality gate to trigger
const FILLER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(50);
const ARTICLE_HTML_STRUCTURED = `<!DOCTYPE html>
<html><head>
  <title>Structured Open Access Paper</title>
  <meta name="citation_pdf_url" content="https://publisher.example.com/structured.pdf">
</head><body>
  <article>
    <h1>Structured Open Access Paper</h1>
    <p>Background: This is the abstract inline summary. Method: We used surveys. Results: Positive outcomes.</p>
    <h2>Background</h2>
    <p>${FILLER}</p>
    <h2>Methods</h2>
    <p>${FILLER}</p>
    <h2>Results</h2>
    <p>${FILLER}</p>
    <h2>Discussion</h2>
    <p>${FILLER}</p>
  </article>
</body></html>`;

const HTML_NO_ARTICLE = `<!DOCTYPE html>
<html><head><title>Simple Page</title></head>
<body>
  <div class="content">
    <h2>Section Title</h2>
    <p>Content without an article tag.</p>
    <p>Second paragraph here.</p>
  </div>
</body></html>`;

describe("ContentResolver", () => {
  beforeEach(() => {
    // Reset the mock return value before each test
    pdfExtractResult = {
      text: "Mock PDF text.",
      pageCount: 1,
      metadata: {},
    };
  });

  describe("resolve()", () => {
    it("html-with-paywall-pdf: uses HTML extraction when PDF link returns non-PDF", async () => {
      const responses = new Map();
      responses.set("https://publisher.example.com/article/123", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: ARTICLE_HTML_PAYWALL,
      });
      responses.set("https://publisher.example.com/paper.pdf", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<html><body><h1>Please subscribe</h1></body></html>",
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://publisher.example.com/article/123");

      expect(result.source).toBe("html");
      expect(result.text).toContain("Policy implementation");
      expect(result.text).toContain("Methods");
      expect(result.text).not.toContain("Home | Journals");
      expect(result.diagnostics.some(d => d.includes("non-PDF content-type"))).toBe(true);
    });

    it("html-with-real-pdf: extracts from real PDF when link returns valid PDF", async () => {
      pdfExtractResult = {
        text: "Extracted PDF text from open access paper.",
        pageCount: 5,
        metadata: { title: "PDF Title" },
      };

      const responses = new Map();
      responses.set("https://publisher.example.com/article/456", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: ARTICLE_HTML_GOOD_PDF,
      });
      responses.set("https://publisher.example.com/open.pdf", {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: PDF_MAGIC,
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://publisher.example.com/article/456");

      expect(result.source).toBe("pdf");
      expect(result.text).toContain("Extracted PDF text");
      expect(result.diagnostics.some(d => d.includes("PDF extracted"))).toBe(true);
    });

    it("direct-pdf: handles direct PDF response", async () => {
      pdfExtractResult = {
        text: "Direct PDF content here.",
        pageCount: 3,
        metadata: { title: "Direct PDF" },
      };

      const responses = new Map();
      responses.set("https://example.com/doc.pdf", {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: PDF_MAGIC,
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://example.com/doc.pdf");

      expect(result.source).toBe("pdf");
      expect(result.text).toContain("Direct PDF content");
      expect(result.diagnostics.some(d => d.includes("Direct PDF response"))).toBe(true);
    });

    it("github-blob: normalizes GitHub blob URL to raw", async () => {
      const responses = new Map();
      responses.set(
        "https://raw.githubusercontent.com/owner/repo/main/README.md",
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: "# Hello World\n\nThis is a readme.",
        }
      );

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve(
        "https://github.com/owner/repo/blob/main/README.md"
      );

      expect(result.source).toBe("raw");
      expect(result.resolvedUrl).toBe(
        "https://raw.githubusercontent.com/owner/repo/main/README.md"
      );
      expect(result.text).toContain("Hello World");
      expect(result.diagnostics.some(d => d.includes("URL normalized"))).toBe(true);
    });

    it("html-no-article-tag: falls back to body content", async () => {
      const responses = new Map();
      responses.set("https://example.com/page", {
        status: 200,
        headers: { "content-type": "text/html" },
        body: HTML_NO_ARTICLE,
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://example.com/page");

      expect(result.source).toBe("html");
      expect(result.text).toContain("Content without an article tag");
      expect(result.title).toBe("Simple Page");
    });

    it("fake-pdf-magic-bytes: rejects PDF with wrong magic bytes", async () => {
      const fakeBody = new TextEncoder().encode(
        "<html><body>This is not a PDF</body></html>"
      );
      const responses = new Map();
      responses.set("https://example.com/fake.pdf", {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: new Uint8Array(fakeBody),
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://example.com/fake.pdf");

      expect(result.source).not.toBe("pdf");
      expect(result.diagnostics.some(d => d.includes("magic bytes missing"))).toBe(true);
    });

    it("plain-text: passes through text/plain as-is", async () => {
      const responses = new Map();
      responses.set("https://example.com/data.txt", {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "Line 1\nLine 2\nLine 3",
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://example.com/data.txt");

      expect(result.source).toBe("raw");
      expect(result.text).toBe("Line 1\nLine 2\nLine 3");
      expect(result.contentType).toContain("text/plain");
    });

    it("structured-html-preferred: skips PDF when HTML has heading hierarchy", async () => {
      pdfExtractResult = {
        text: "Flat PDF text with no headings at all.",
        pageCount: 5,
        metadata: { title: "PDF Title" },
      };

      const responses = new Map();
      responses.set("https://publisher.example.com/article/789", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: ARTICLE_HTML_STRUCTURED,
      });
      // PDF exists and is valid — but should NOT be downloaded
      responses.set("https://publisher.example.com/structured.pdf", {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: PDF_MAGIC,
      });

      const mockHttp = createMockHttp(responses);
      const resolver = new ContentResolver(mockHttp);
      const result = await resolver.resolve("https://publisher.example.com/article/789");

      // Should use HTML, not PDF
      expect(result.source).toBe("html");
      expect(result.text).toContain("## Background");
      expect(result.text).toContain("## Methods");
      expect(result.text).toContain("## Results");
      // Abstract inline headers should NOT have markdown prefixes
      expect(result.text).toContain("Background: This is the abstract");
      // PDF URL should not have been fetched
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(result.diagnostics.some(d => d.includes("skipping PDF download"))).toBe(true);
    });

    it("academic-publisher-url: Accept header prefers PDF for known publishers", async () => {
      const responses = new Map();
      responses.set("https://link.springer.com/article/10.1186/s12961-017-0235-3", {
        status: 200,
        headers: { "content-type": "text/html" },
        body: ARTICLE_HTML_PAYWALL,
      });
      // Paywall PDF response (non-PDF content-type)
      responses.set("https://publisher.example.com/paper.pdf", {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html><body>Paywall</body></html>",
      });

      const mockHttp = createMockHttp(responses);
      const resolver = new ContentResolver(mockHttp);
      await resolver.resolve("https://link.springer.com/article/10.1186/s12961-017-0235-3");

      // Verify the first HTTP call used PDF-preferring Accept header
      const firstCall = mockHttp.get.mock.calls[0];
      const headers = firstCall[1]?.headers;
      expect(headers?.Accept).toContain("application/pdf");
    });

    it("diagnostics-populated: diagnostics array always has entries", async () => {
      const responses = new Map();
      responses.set("https://example.com/page", {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<html><body><p>Simple page.</p></body></html>",
      });

      const resolver = new ContentResolver(createMockHttp(responses));
      const result = await resolver.resolve("https://example.com/page");

      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.some(d => d.includes("Accept header"))).toBe(true);
      expect(result.diagnostics.some(d => d.includes("content-type"))).toBe(true);
    });
  });

  describe("isPdfBytes()", () => {
    it("returns true for valid %PDF- header", () => {
      expect(isPdfBytes(PDF_MAGIC)).toBe(true);
    });

    it("returns false for non-PDF data", () => {
      const html = new TextEncoder().encode("<html>");
      expect(isPdfBytes(html)).toBe(false);
    });

    it("returns false for empty data", () => {
      expect(isPdfBytes(new Uint8Array(0))).toBe(false);
    });
  });

  describe("normalizeToRawUrl()", () => {
    it("converts GitHub blob URL to raw", () => {
      expect(
        normalizeToRawUrl("https://github.com/owner/repo/blob/main/file.txt")
      ).toBe("https://raw.githubusercontent.com/owner/repo/main/file.txt");
    });

    it("converts Gist URL to raw", () => {
      expect(
        normalizeToRawUrl("https://gist.github.com/user/abc123")
      ).toBe("https://gist.githubusercontent.com/user/abc123/raw");
    });

    it("converts GitLab blob URL to raw", () => {
      expect(
        normalizeToRawUrl("https://gitlab.com/owner/repo/-/blob/main/file.txt")
      ).toBe("https://gitlab.com/owner/repo/-/raw/main/file.txt");
    });

    it("returns non-matching URLs unchanged", () => {
      const url = "https://example.com/page";
      expect(normalizeToRawUrl(url)).toBe(url);
    });
  });

  describe("normalizePdfText()", () => {
    it("puts section headers with colons on their own lines", () => {
      const flat =
        "Author Name 1,2 Abstract Background: In 1982, the Annals published a paper showing results. " +
        "Method: A total of 3366 articles were retrieved. " +
        "Results: Most publications are not available directly. " +
        "Conclusions: Although OA may help in building capacity.";
      const result = normalizePdfText(flat);
      // Headers should be on their own lines (newline after colon)
      expect(result).toContain("\n\nBackground:\n");
      expect(result).toContain("\n\nMethod:\n");
      expect(result).toContain("\n\nResults:\n");
      expect(result).toContain("\n\nConclusions:\n");
    });

    it("inserts newlines before section headers after sentence-ending punctuation", () => {
      const flat =
        "This paper examines global health. " +
        "Background The field has expanded significantly. " +
        "Methods We conducted a systematic review. " +
        "Results Most publications are not available. " +
        "Conclusions OA may help in building capacity.";
      const result = normalizePdfText(flat);
      expect(result).toContain("\n\nBackground\n");
      expect(result).toContain("\n\nMethods\n");
      expect(result).toContain("\n\nResults\n");
      expect(result).toContain("\n\nConclusions\n");
    });

    it("preserves text that already has line breaks", () => {
      const structured =
        "# Title\n\nAbstract\nThis paper.\n\nMethods\nWe did stuff.\n\nResults\nGood results.\n";
      const result = normalizePdfText(structured);
      // Should be unchanged since it already has line structure
      expect(result).toBe(structured);
    });

    it("returns short text unchanged", () => {
      const short = "Just a short string.";
      expect(normalizePdfText(short)).toBe(short);
    });

    it("breaks sentence-ending periods before capitals in very flat text", () => {
      const flat =
        "A".repeat(3000) + ". " +
        "First sentence here. Second sentence follows. Third one too. " +
        "Fourth sentence. Fifth sentence. Sixth sentence here.";
      const result = normalizePdfText(flat);
      // Should have broken some sentence boundaries
      expect(result.split("\n").length).toBeGreaterThan(1);
    });
  });
});
