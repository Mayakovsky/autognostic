import type { IAgentRuntime } from "@elizaos/core";
import type { HttpService } from "../services/httpService";
import type { Discovery } from "../publicspace/discoveryFactory";

export interface FilePreview {
  url: string;
  path: string;
  estBytes: number;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

export interface SourcePreview {
  sourceId: string;
  totalBytes: number;
  files: FilePreview[];
}

export async function previewSourceFiles(
  runtime: IAgentRuntime,
  sourceId: string,
  discovery: Discovery
): Promise<SourcePreview> {
  const http = runtime.getService<HttpService>("http");
  if (!http) {
    throw new Error("HttpService not available for previewSourceFiles");
  }

  const discovered = await discovery.list();
  const files: FilePreview[] = [];
  let totalBytes = 0;

  for (const f of discovered) {
    try {
      // Prefer HEAD for fast metadata-only probing; fall back to a tiny ranged GET if HEAD is unsupported.
      let res: Response;
      try {
        res = await http.head(f.url, { timeoutMs: 15_000 });
      } catch {
        res = await http.get(f.url, {
          timeoutMs: 15_000,
          headers: { range: "bytes=0-0" },
        });
      }

      // Some servers respond to HEAD but omit content-length; a ranged GET can sometimes provide it.
      if (!res.headers.get("content-length") && res.ok) {
        try {
          const ranged = await http.get(f.url, {
            timeoutMs: 15_000,
            headers: { range: "bytes=0-0" },
          });
          if (ranged.ok) res = ranged;
        } catch {
          // ignore; keep original response headers
        }
      }

      const size = Number(res.headers.get("content-length") ?? 0);
      const type = res.headers.get("content-type") ?? "unknown";
      const etag = res.headers.get("etag") ?? undefined;
      const lm = res.headers.get("last-modified") ?? undefined;

      files.push({
        url: f.url,
        path: f.path,
        estBytes: size,
        contentType: type,
        etag,
        lastModified: lm,
      });
      totalBytes += size;
    } catch {
      files.push({
        url: f.url,
        path: f.path,
        estBytes: 0,
        contentType: "unknown",
      });
    }
  }

  return { sourceId, totalBytes, files };
}
