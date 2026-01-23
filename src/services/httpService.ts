import { Service, type IAgentRuntime } from "@elizaos/core";

/**
 * HttpService
 * - Centralized HTTP fetch helpers for the plugin.
 * - Provides GET/HEAD with timeouts and basic safety defaults.
 * - Registered as an ElizaOS Service (core 1.6+ requires static start()).
 */
export class HttpService extends Service {
  static readonly serviceType = "http";

  override capabilityDescription =
    "Fetches remote HTTP(S) resources (GET/HEAD) for preview and ingestion, with timeouts and safe defaults.";

  private defaultTimeoutMs = 20_000;
  private defaultUserAgent =
    "elizaos-plugin-datamirror/1.x (+https://elizaos.ai)";

  /** Required by ElizaOS core (service registration). */
  static async start(runtime: IAgentRuntime): Promise<HttpService> {
    return new HttpService(runtime);
  }

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    // Optional per-character tuning
    const dm = (runtime.character as any)?.settings?.datamirror;
    const http = dm?.http;
    if (typeof http?.timeoutMs === "number") this.defaultTimeoutMs = http.timeoutMs;
    if (typeof http?.userAgent === "string") this.defaultUserAgent = http.userAgent;
  }

  override async stop(): Promise<void> {
    // No persistent resources (fetch is stateless). If you add keep-alive agents later,
    // close them here.
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const h = new Headers(extra ?? {});
    if (!h.has("user-agent")) h.set("user-agent", this.defaultUserAgent);
    // Encourage deterministic responses from some CDNs
    if (!h.has("accept")) h.set("accept", "*/*");
    return h;
  }

  private async withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(t);
    }
  }

  async head(
    url: string,
    opts?: { timeoutMs?: number; headers?: HeadersInit }
  ): Promise<Response> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const headers = this.buildHeaders(opts?.headers);

    return this.withTimeout(timeoutMs, (signal) =>
      fetch(url, { method: "HEAD", headers, signal, redirect: "follow" })
    );
  }

  async get(
    url: string,
    opts?: { timeoutMs?: number; headers?: HeadersInit }
  ): Promise<Response> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const headers = this.buildHeaders(opts?.headers);

    return this.withTimeout(timeoutMs, (signal) =>
      fetch(url, { method: "GET", headers, signal, redirect: "follow" })
    );
  }

  async getText(
    url: string,
    opts?: { timeoutMs?: number; headers?: HeadersInit; maxChars?: number }
  ): Promise<string> {
    const res = await this.get(url, opts);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText}) for ${url}`);
    }
    const text = await res.text();
    const maxChars = opts?.maxChars ?? 2_000_000; // 2MB-ish of text safety cap
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  async getJson<T>(
    url: string,
    opts?: { timeoutMs?: number; headers?: HeadersInit }
  ): Promise<T> {
    const res = await this.get(url, {
      ...opts,
      headers: { ...(opts?.headers ?? {}), accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${res.statusText}) for ${url}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Utility: quickly infer remote size/type when possible.
   * Some servers don't return content-length to HEAD; handle gracefully.
   */
  async probe(
    url: string,
    opts?: { timeoutMs?: number; headers?: HeadersInit }
  ): Promise<{ contentLength?: number; contentType?: string; finalUrl?: string }> {
    const res = await this.head(url, opts);
    const cl = res.headers.get("content-length");
    const ct = res.headers.get("content-type") ?? undefined;
    const finalUrl = res.url || url;
    const contentLength = cl ? Number(cl) : undefined;
    return {
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
      contentType: ct,
      finalUrl,
    };
  }
}
