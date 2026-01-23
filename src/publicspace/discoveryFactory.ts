import type { IAgentRuntime } from "@elizaos/core";
import { classifySourceUrl, SourceDiscoveryKind, type ClassifiedSource } from "./UrlClassifier";
import { LlmsTxtDiscovery } from "./LlmsTxtDiscovery";
import { LlmsFullListDiscovery } from "./LlmsFullListDiscovery";
import { SitemapDiscovery } from "./SitemapDiscovery";
import { SingleUrlDiscovery } from "./SingleUrlDiscovery";
import type { HttpService } from "../services/httpService";

export interface DiscoveredFile {
  url: string;
  path: string;
}

export interface Discovery {
  list(): Promise<DiscoveredFile[]>;
}

export function createDiscoveryForRawUrl(
  runtime: IAgentRuntime,
  rawUrl: string
): { classified: ClassifiedSource; discovery: Discovery } {
  const classified = classifySourceUrl(rawUrl);
  const http = runtime.getService<HttpService>("http");
  if (!http) {
    throw new Error("HttpService required for discovery");
  }

  switch (classified.kind) {
    case SourceDiscoveryKind.LLMS_TXT:
      return {
        classified,
        discovery: new LlmsTxtDiscovery(http, classified.baseUrl),
      };
    case SourceDiscoveryKind.LLMS_FULL_LIST:
      return {
        classified,
        discovery: new LlmsFullListDiscovery(http, classified.baseUrl),
      };
    case SourceDiscoveryKind.SITEMAP:
      return {
        classified,
        discovery: new SitemapDiscovery(http, classified.baseUrl),
      };
    case SourceDiscoveryKind.SINGLE_URL:
    default:
      return {
        classified,
        discovery: new SingleUrlDiscovery(classified.baseUrl),
      };
  }
}
