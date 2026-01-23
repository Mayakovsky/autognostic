import type { HttpService } from "../services/httpService";
import type { Discovery, DiscoveredFile } from "./discoveryFactory";

export class LlmsFullListDiscovery implements Discovery {
  constructor(
    private http: HttpService,
    private fullListUrl: string // e.g. https://docs.elizaos.ai/llms-full.txt
  ) {}

  async list(): Promise<DiscoveredFile[]> {
    const text = await this.http.getText(this.fullListUrl);
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    return lines.map((line) => {
      const u = new URL(line);
      return {
        url: line,
        path: u.pathname.replace(/^\//, ""),
      };
    });
  }
}
