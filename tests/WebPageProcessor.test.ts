import { describe, it, expect } from "vitest";
import { WebPageProcessor } from "../src/services/WebPageProcessor";

describe("WebPageProcessor", () => {
  const processor = new WebPageProcessor();

  describe("extractFromHtml", () => {
    it("extracts title and body text", () => {
      const html = `<html><head><title>Test Page</title></head>
        <body><p>Hello world.</p></body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.title).toBe("Test Page");
      expect(result.text).toContain("Hello world");
    });

    it("removes script/style/nav/footer", () => {
      const html = `<html><body>
        <nav>Navigation</nav>
        <script>alert('x')</script>
        <style>.x{color:red}</style>
        <footer>Footer</footer>
        <main><p>Main content here.</p></main>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Main content");
      expect(result.text).not.toContain("Navigation");
      expect(result.text).not.toContain("alert");
      expect(result.text).not.toContain("Footer");
    });

    it("prefers article/main content", () => {
      const html = `<html><body>
        <div>Sidebar junk</div>
        <article><p>Article content.</p></article>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Article content");
    });

    it("extracts metadata from meta tags", () => {
      const html = `<html><head>
        <meta name="description" content="A test page">
        <meta name="citation_doi" content="10.1000/test">
        <meta name="citation_pdf_url" content="https://example.com/paper.pdf">
      </head><body><p>Content</p></body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.metadata.description).toBe("A test page");
      expect(result.metadata.doi).toBe("10.1000/test");
      expect(result.metadata.citationPdfUrl).toBe("https://example.com/paper.pdf");
    });

    it("extracts and classifies links", () => {
      const html = `<html><body>
        <a href="/paper.pdf">Download PDF</a>
        <a href="/page.html">HTML page</a>
        <a href="/other">Other link</a>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.links).toHaveLength(3);
      expect(result.pdfLinks).toHaveLength(1);
      expect(result.pdfLinks[0].href).toBe("https://example.com/paper.pdf");
    });

    it("resolves relative URLs", () => {
      const html = `<html><body><a href="/docs/file.pdf">Link</a></body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com/page");
      expect(result.links[0].href).toBe("https://example.com/docs/file.pdf");
    });
  });

  describe("findBestPdfLink", () => {
    it("prefers citation_pdf_url", () => {
      const page = processor.extractFromHtml(
        `<html><head><meta name="citation_pdf_url" content="https://example.com/best.pdf"></head>
         <body><a href="/other.pdf">Other</a></body></html>`,
        "https://example.com"
      );
      const best = processor.findBestPdfLink(page);
      expect(best).not.toBeNull();
      expect(best!.href).toBe("https://example.com/best.pdf");
    });

    it("falls back to .pdf links", () => {
      const page = processor.extractFromHtml(
        `<html><body><a href="/paper.pdf">Download</a></body></html>`,
        "https://example.com"
      );
      const best = processor.findBestPdfLink(page);
      expect(best).not.toBeNull();
      expect(best!.href).toContain("paper.pdf");
    });

    it("constructs arXiv PDF from abs link", () => {
      const page = processor.extractFromHtml(
        `<html><body><a href="https://arxiv.org/abs/2301.12345">Paper</a></body></html>`,
        "https://arxiv.org"
      );
      const best = processor.findBestPdfLink(page);
      expect(best).not.toBeNull();
      expect(best!.href).toContain("/pdf/2301.12345");
    });

    it("returns null when no PDF link found", () => {
      const page = processor.extractFromHtml(
        `<html><body><p>No links here.</p></body></html>`,
        "https://example.com"
      );
      expect(processor.findBestPdfLink(page)).toBeNull();
    });
  });
});
