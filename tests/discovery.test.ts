import { describe, it, expect, vi } from "vitest";
import { SingleUrlDiscovery } from "../src/publicspace/SingleUrlDiscovery";
import { LlmsTxtDiscovery } from "../src/publicspace/LlmsTxtDiscovery";
import { SitemapDiscovery } from "../src/publicspace/SitemapDiscovery";
import { classifySourceUrl, SourceDiscoveryKind } from "../src/publicspace/UrlClassifier";
import { createMockHttpService } from "./setup";

describe("SingleUrlDiscovery", () => {
  it("should return a single file with the URL", async () => {
    const discovery = new SingleUrlDiscovery("https://example.com/docs/page.html");
    const files = await discovery.list();

    expect(files).toHaveLength(1);
    expect(files[0].url).toBe("https://example.com/docs/page.html");
    expect(files[0].path).toBe("docs/page.html");
  });

  it("should handle root URL with index fallback", async () => {
    const discovery = new SingleUrlDiscovery("https://example.com/");
    const files = await discovery.list();

    expect(files).toHaveLength(1);
    expect(files[0].url).toBe("https://example.com/");
    expect(files[0].path).toBe("index");
  });

  it("should handle URL without trailing slash", async () => {
    const discovery = new SingleUrlDiscovery("https://example.com");
    const files = await discovery.list();

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("index");
  });

  it("should strip leading slash from path", async () => {
    const discovery = new SingleUrlDiscovery("https://example.com/api/reference");
    const files = await discovery.list();

    expect(files[0].path).toBe("api/reference");
  });
});

describe("LlmsTxtDiscovery", () => {
  it("should parse llms.txt and return discovered files", async () => {
    const mockHttp = createMockHttpService({
      "https://docs.example.com/llms.txt": `https://docs.example.com/intro.html
https://docs.example.com/guide/getting-started.html
https://docs.example.com/api/reference.html`,
    });

    const discovery = new LlmsTxtDiscovery(mockHttp as any, "https://docs.example.com");
    const files = await discovery.list();

    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({
      url: "https://docs.example.com/intro.html",
      path: "intro.html",
    });
    expect(files[1]).toEqual({
      url: "https://docs.example.com/guide/getting-started.html",
      path: "guide/getting-started.html",
    });
    expect(files[2]).toEqual({
      url: "https://docs.example.com/api/reference.html",
      path: "api/reference.html",
    });
  });

  it("should skip empty lines", async () => {
    const mockHttp = createMockHttpService({
      "https://docs.example.com/llms.txt": `https://docs.example.com/page1.html

https://docs.example.com/page2.html

https://docs.example.com/page3.html`,
    });

    const discovery = new LlmsTxtDiscovery(mockHttp as any, "https://docs.example.com");
    const files = await discovery.list();

    expect(files).toHaveLength(3);
  });

  it("should trim whitespace from lines", async () => {
    const mockHttp = createMockHttpService({
      "https://docs.example.com/llms.txt": `  https://docs.example.com/page1.html
	https://docs.example.com/page2.html	`,
    });

    const discovery = new LlmsTxtDiscovery(mockHttp as any, "https://docs.example.com");
    const files = await discovery.list();

    expect(files).toHaveLength(2);
    expect(files[0].url).toBe("https://docs.example.com/page1.html");
    expect(files[1].url).toBe("https://docs.example.com/page2.html");
  });
});

describe("classifySourceUrl", () => {
  it("should classify root URL as LLMS_TXT", () => {
    const result = classifySourceUrl("https://docs.example.com/");
    expect(result.kind).toBe(SourceDiscoveryKind.LLMS_TXT);
    expect(result.baseUrl).toBe("https://docs.example.com");
  });

  it("should classify index.html as LLMS_TXT", () => {
    const result = classifySourceUrl("https://docs.example.com/index.html");
    expect(result.kind).toBe(SourceDiscoveryKind.LLMS_TXT);
    expect(result.baseUrl).toBe("https://docs.example.com");
  });

  it("should classify llms-full.txt as LLMS_FULL_LIST", () => {
    const result = classifySourceUrl("https://docs.example.com/llms-full.txt");
    expect(result.kind).toBe(SourceDiscoveryKind.LLMS_FULL_LIST);
    expect(result.baseUrl).toBe("https://docs.example.com/llms-full.txt");
  });

  it("should classify sitemap.xml as SITEMAP", () => {
    const result = classifySourceUrl("https://docs.example.com/sitemap.xml");
    expect(result.kind).toBe(SourceDiscoveryKind.SITEMAP);
    expect(result.baseUrl).toBe("https://docs.example.com/sitemap.xml");
  });

  it("should classify specific page as SINGLE_URL", () => {
    const result = classifySourceUrl("https://docs.example.com/guide/intro.html");
    expect(result.kind).toBe(SourceDiscoveryKind.SINGLE_URL);
    expect(result.baseUrl).toBe("https://docs.example.com/guide/intro.html");
  });

  it("should classify markdown file as SINGLE_URL", () => {
    const result = classifySourceUrl("https://raw.githubusercontent.com/org/repo/main/README.md");
    expect(result.kind).toBe(SourceDiscoveryKind.SINGLE_URL);
  });
});

describe("SitemapDiscovery", () => {
  it("should parse standard sitemap with urlset", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1.html</loc>
    <lastmod>2025-01-01</lastmod>
  </url>
  <url>
    <loc>https://example.com/page2.html</loc>
  </url>
  <url>
    <loc>https://example.com/docs/guide.html</loc>
  </url>
</urlset>`;

    const mockHttp = createMockHttpService({
      "https://example.com/sitemap.xml": sitemapXml,
    });

    const discovery = new SitemapDiscovery(mockHttp as any, "https://example.com/sitemap.xml");
    const files = await discovery.list();

    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({
      url: "https://example.com/page1.html",
      path: "page1.html",
    });
    expect(files[1]).toEqual({
      url: "https://example.com/page2.html",
      path: "page2.html",
    });
    expect(files[2]).toEqual({
      url: "https://example.com/docs/guide.html",
      path: "docs/guide.html",
    });
  });

  it("should parse sitemap index", async () => {
    const sitemapIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-posts.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-pages.xml</loc>
  </sitemap>
</sitemapindex>`;

    const mockHttp = createMockHttpService({
      "https://example.com/sitemap.xml": sitemapIndexXml,
    });

    const discovery = new SitemapDiscovery(mockHttp as any, "https://example.com/sitemap.xml");
    const files = await discovery.list();

    expect(files).toHaveLength(2);
    expect(files[0].url).toBe("https://example.com/sitemap-posts.xml");
    expect(files[1].url).toBe("https://example.com/sitemap-pages.xml");
  });

  it("should decode XML entities in URLs", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page?a=1&amp;b=2</loc>
  </url>
</urlset>`;

    const mockHttp = createMockHttpService({
      "https://example.com/sitemap.xml": sitemapXml,
    });

    const discovery = new SitemapDiscovery(mockHttp as any, "https://example.com/sitemap.xml");
    const files = await discovery.list();

    expect(files).toHaveLength(1);
    expect(files[0].url).toBe("https://example.com/page?a=1&b=2");
  });

  it("should handle empty sitemap", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;

    const mockHttp = createMockHttpService({
      "https://example.com/sitemap.xml": sitemapXml,
    });

    const discovery = new SitemapDiscovery(mockHttp as any, "https://example.com/sitemap.xml");
    const files = await discovery.list();

    expect(files).toHaveLength(0);
  });

  it("should handle root URL path", async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
  </url>
</urlset>`;

    const mockHttp = createMockHttpService({
      "https://example.com/sitemap.xml": sitemapXml,
    });

    const discovery = new SitemapDiscovery(mockHttp as any, "https://example.com/sitemap.xml");
    const files = await discovery.list();

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("index");
  });
});
