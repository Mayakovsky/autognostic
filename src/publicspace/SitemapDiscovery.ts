import type { HttpService } from "../services/httpService";
import type { Discovery, DiscoveredFile } from "./discoveryFactory";

/**
 * Parses XML sitemap and discovers URLs.
 * Supports standard sitemap format with <urlset> and <url><loc> elements.
 * Also supports sitemap index files with <sitemapindex> and <sitemap><loc>.
 */
export class SitemapDiscovery implements Discovery {
  constructor(
    private http: HttpService,
    private sitemapUrl: string
  ) {}

  async list(): Promise<DiscoveredFile[]> {
    const xml = await this.http.getText(this.sitemapUrl);
    return this.parseXml(xml);
  }

  private parseXml(xml: string): DiscoveredFile[] {
    const files: DiscoveredFile[] = [];

    // Check if this is a sitemap index (contains other sitemaps)
    if (xml.includes("<sitemapindex")) {
      // For sitemap index, we only extract the sitemap URLs
      // The caller would need to recursively process these
      const sitemapLocs = this.extractTags(xml, "sitemap", "loc");
      for (const loc of sitemapLocs) {
        files.push({
          url: loc,
          path: this.urlToPath(loc),
        });
      }
      return files;
    }

    // Standard sitemap with <urlset>
    const urlLocs = this.extractTags(xml, "url", "loc");
    for (const loc of urlLocs) {
      files.push({
        url: loc,
        path: this.urlToPath(loc),
      });
    }

    return files;
  }

  /**
   * Extract text content from nested tags.
   * For sitemap: extracts <loc> values from within <url> or <sitemap> elements.
   */
  private extractTags(xml: string, parentTag: string, childTag: string): string[] {
    const results: string[] = [];

    // Match parent elements
    const parentRegex = new RegExp(`<${parentTag}[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, "gi");
    let parentMatch;

    while ((parentMatch = parentRegex.exec(xml)) !== null) {
      const parentContent = parentMatch[1];

      // Extract child tag content
      const childRegex = new RegExp(`<${childTag}[^>]*>([^<]+)<\\/${childTag}>`, "i");
      const childMatch = childRegex.exec(parentContent);

      if (childMatch && childMatch[1]) {
        const value = this.decodeXmlEntities(childMatch[1].trim());
        if (value) {
          results.push(value);
        }
      }
    }

    return results;
  }

  /**
   * Decode common XML entities.
   */
  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Convert URL to a relative path for storage.
   */
  private urlToPath(url: string): string {
    try {
      const u = new URL(url);
      let path = u.pathname.replace(/^\//, "");

      // If path is empty, use "index"
      if (!path) {
        path = "index";
      }

      // Remove common extensions for cleaner paths
      // but keep them if they're meaningful (like .xml for sitemaps)
      return path;
    } catch {
      // If URL parsing fails, use the URL as-is
      return url;
    }
  }
}
