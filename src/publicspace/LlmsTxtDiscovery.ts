import type { HttpService } from "../services/httpService";
import type { Discovery, DiscoveredFile } from "./discoveryFactory";

export class LlmsTxtDiscovery implements Discovery {
  constructor(
    private http: HttpService,
    private root: string // origin root, e.g. https://docs.elizaos.ai
  ) {}

  async list(): Promise<DiscoveredFile[]> {
    const url = `${this.root}/llms.txt`;
    const text = await this.http.getText(url);
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
