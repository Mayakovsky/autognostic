import { describe, it, expect } from "vitest";
import { WebPageProcessor } from "../src/services/WebPageProcessor";

describe("WebPageProcessor", () => {
  const processor = new WebPageProcessor();

  describe("extractFromHtml — structured text", () => {
    it("extracts title and body text", () => {
      const html = `<html><head><title>Test Page</title></head>
        <body><p>Hello world.</p></body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.title).toBe("Test Page");
      expect(result.text).toContain("Hello world");
    });

    it("preserves paragraph breaks between <p> elements", () => {
      const html = `<html><body>
        <p>First paragraph with some content.</p>
        <p>Second paragraph with other content.</p>
        <p>Third paragraph here.</p>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      // Should have double-newline between paragraphs
      const paragraphs = result.text.split(/\n\n+/).filter(Boolean);
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
      expect(paragraphs[0]).toContain("First paragraph");
      expect(paragraphs[1]).toContain("Second paragraph");
      expect(paragraphs[2]).toContain("Third paragraph");
    });

    it("converts headings to markdown-style prefixes", () => {
      const html = `<html><body>
        <h1>Main Title</h1>
        <p>Some text.</p>
        <h2>Subsection</h2>
        <p>More text.</p>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("# Main Title");
      expect(result.text).toContain("## Subsection");
    });

    it("converts list items with dash prefix", () => {
      const html = `<html><body>
        <ul>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ul>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("- First item");
      expect(result.text).toContain("- Second item");
      expect(result.text).toContain("- Third item");
    });

    it("converts blockquotes with > prefix", () => {
      const html = `<html><body>
        <blockquote>This is a quoted passage.</blockquote>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("> This is a quoted passage.");
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

    it("removes elements with junk class/id patterns", () => {
      const html = `<html><body>
        <div class="sidebar-widget">Sidebar stuff</div>
        <div id="cookie-banner">Accept cookies</div>
        <div class="ad-container">Buy now!</div>
        <article><p>Real content.</p></article>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Real content");
      expect(result.text).not.toContain("Sidebar stuff");
      expect(result.text).not.toContain("Accept cookies");
      expect(result.text).not.toContain("Buy now");
    });

    it("prefers article/main content", () => {
      const html = `<html><body>
        <div>Sidebar junk</div>
        <article><p>Article content.</p></article>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Article content");
    });

    it("handles a realistic academic article structure", () => {
      const html = `<html><head>
        <title>Study of Policy Implementation</title>
        <meta name="citation_doi" content="10.1186/s12961-017-0235-3">
      </head><body>
        <nav>Home | Journals | About</nav>
        <article>
          <h1>Study of Policy Implementation in Developing Countries</h1>
          <p>Background: Policy implementation is a critical challenge in public health systems across developing nations.</p>
          <h2>Methods</h2>
          <p>We conducted a systematic review of 47 studies published between 2000 and 2016.</p>
          <p>Data extraction followed PRISMA guidelines with two independent reviewers.</p>
          <h2>Results</h2>
          <p>The review identified three major themes in implementation barriers.</p>
          <h2>Conclusion</h2>
          <p>Effective policy implementation requires sustained institutional support and community engagement.</p>
        </article>
        <footer>Copyright 2017</footer>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://link.springer.com/article/test");

      // Should have clean structure
      expect(result.text).toContain("# Study of Policy Implementation");
      expect(result.text).toContain("## Methods");
      expect(result.text).toContain("## Results");
      expect(result.text).toContain("## Conclusion");
      expect(result.text).not.toContain("Home | Journals");
      expect(result.text).not.toContain("Copyright");

      // Should have multiple paragraphs (split by double newline)
      const paragraphs = result.text.split(/\n\n+/).filter(Boolean);
      expect(paragraphs.length).toBeGreaterThanOrEqual(6); // title + 4 paragraphs + headings
    });

    it("does NOT collapse everything into one line", () => {
      const html = `<html><body>
        <p>Sentence one in paragraph one.</p>
        <p>Sentence two in paragraph two.</p>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      // Critical: must contain newlines, not be a single line
      expect(result.text).toContain("\n");
      // Must not be a single line blob
      const lines = result.text.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("extractFromHtml — metadata", () => {
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
  });

  describe("extractFromHtml — links", () => {
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

  describe("hardening — layout modifier classes preserved", () => {
    it("does NOT strip content wrapped in layout utility class l-with-sidebar", () => {
      const html = `<html><body>
        <div class="c-article-main u-container l-with-sidebar">
          <article>
            <h1>Study Title</h1>
            <h2>Abstract</h2>
            <p>This study investigates important findings.</p>
            <h2>Introduction</h2>
            <p>Background information about the topic.</p>
            <h2>Methods</h2>
            <p>We used systematic review methodology.</p>
          </article>
        </div>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://link.springer.com/article/test");
      expect(result.text).toContain("Study Title");
      expect(result.text).toContain("Abstract");
      expect(result.text).toContain("important findings");
      expect(result.text).toContain("Introduction");
      expect(result.text).toContain("Methods");
    });

    it("does NOT strip content wrapped in has-sidebar class", () => {
      const html = `<html><body>
        <div class="content-wrapper has-sidebar">
          <article><p>Important article text.</p></article>
        </div>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Important article text");
    });

    it("still strips actual sidebar elements", () => {
      const html = `<html><body>
        <div class="sidebar">Sidebar junk</div>
        <div class="page-sidebar">More sidebar junk</div>
        <article><p>Real content.</p></article>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("Real content");
      expect(result.text).not.toContain("Sidebar junk");
      expect(result.text).not.toContain("More sidebar junk");
    });
  });

  describe("hardening — publisher selectors", () => {
    it("extracts content from class='c-article-body' when no <article> tag", () => {
      const html = `<html><body>
        <div class="sidebar-widget">Sidebar junk</div>
        <div class="c-article-body">
          <h2>Introduction</h2>
          <p>Article content from publisher-specific class.</p>
        </div>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://link.springer.com/article/test");
      expect(result.text).toContain("Article content from publisher-specific class");
      expect(result.text).toContain("Introduction");
    });
  });

  describe("hardening — reference section preservation", () => {
    it("does not strip elements with reference/bibliography class", () => {
      const html = `<html><body>
        <article>
          <p>Article body text.</p>
          <div class="related-references" id="bibliography">
            <h2>References</h2>
            <p>1. Smith et al., 2020. Important paper.</p>
          </div>
        </article>
      </body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      expect(result.text).toContain("References");
      expect(result.text).toContain("Smith et al.");
    });
  });

  describe("hardening — text length guard", () => {
    it("truncates oversized extracted text", () => {
      // Build a huge HTML page (>500K chars of body text)
      const bigParagraph = "<p>" + "A".repeat(100_000) + "</p>";
      const html = `<html><body>${bigParagraph.repeat(6)}</body></html>`;
      const result = processor.extractFromHtml(html, "https://example.com");
      // Max is 500K — extracted text should be at most that
      expect(result.text.length).toBeLessThanOrEqual(500_000);
    });
  });
});
