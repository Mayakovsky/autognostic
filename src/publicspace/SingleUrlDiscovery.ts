import type { Discovery, DiscoveredFile } from "./discoveryFactory";

export class SingleUrlDiscovery implements Discovery {
  constructor(private url: string) {}

  async list(): Promise<DiscoveredFile[]> {
    const u = new URL(this.url);
    return [
      {
        url: this.url,
        path: u.pathname.replace(/^\//, "") || "index",
      },
    ];
  }
}
