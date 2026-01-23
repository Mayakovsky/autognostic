export enum SourceDiscoveryKind {
  LLMS_TXT = "LLMS_TXT",
  LLMS_FULL_LIST = "LLMS_FULL_LIST",
  SITEMAP = "SITEMAP",
  SINGLE_URL = "SINGLE_URL",
}

export interface ClassifiedSource {
  kind: SourceDiscoveryKind;
  baseUrl: string;
}

export function classifySourceUrl(rawUrl: string): ClassifiedSource {
  const url = new URL(rawUrl);

  if (url.pathname.endsWith("/llms-full.txt")) {
    return {
      kind: SourceDiscoveryKind.LLMS_FULL_LIST,
      baseUrl: rawUrl,
    };
  }

  if (url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    return {
      kind: SourceDiscoveryKind.LLMS_TXT,
      baseUrl: url.origin,
    };
  }

  if (url.pathname.endsWith("/sitemap.xml")) {
    return {
      kind: SourceDiscoveryKind.SITEMAP,
      baseUrl: rawUrl,
    };
  }

  return {
    kind: SourceDiscoveryKind.SINGLE_URL,
    baseUrl: rawUrl,
  };
}
