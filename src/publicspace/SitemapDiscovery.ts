import type { HttpService } from "../services/httpService";
import type { Discovery, DiscoveredFile } from "./discoveryFactory";

export class SitemapDiscovery implements Discovery {
  constructor(
    private http: HttpService,
    private sitemapUrl: string
  ) {}

  async list(): Promise<DiscoveredFile[]> {
    // TODO: parse XML sitemap properly.
    // For now, simple stub that returns empty list.
    // Add real implementation later with xml parsing.
    return [];
  }
}
