import type { IAgentRuntime, UUID } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";
import { HttpService } from "../services/httpService";
import { randomUUID, createHash } from "crypto";
import { datamirrorDocumentsRepository } from "../db/datamirrorDocumentsRepository";

/**
 * Convert URLs to their raw content equivalents.
 * - GitHub blob URLs → raw.githubusercontent.com
 * - GitLab blob URLs → raw URLs
 * - Gist URLs → raw URLs
 */
function normalizeToRawUrl(url: string): string {
  const parsed = new URL(url);

  // GitHub: github.com/:owner/:repo/blob/:branch/:path
  // → raw.githubusercontent.com/:owner/:repo/:branch/:path
  if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (match) {
      const [, owner, repo, rest] = match;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
    }
  }

  // GitHub Gist: gist.github.com/:user/:gistId → raw URL
  if (parsed.hostname === "gist.github.com") {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (match) {
      const [, user, gistId] = match;
      return `https://gist.githubusercontent.com/${user}/${gistId}/raw`;
    }
  }

  // GitLab: gitlab.com/:owner/:repo/-/blob/:branch/:path
  // → gitlab.com/:owner/:repo/-/raw/:branch/:path
  if (parsed.hostname === "gitlab.com" || parsed.hostname.includes("gitlab")) {
    const blobMatch = parsed.pathname.match(/^(.+)\/-\/blob\/(.+)$/);
    if (blobMatch) {
      const [, projectPath, rest] = blobMatch;
      return `https://${parsed.hostname}${projectPath}/-/raw/${rest}`;
    }
  }

  // Return original URL if no transformation needed
  return url;
}

export interface MirrorDocParams {
  url: string;
  filename: string;
  contentType?: string;
  roomId: UUID;
  entityId: UUID;
  worldId?: UUID;
  metadata?: Record<string, unknown>;
}

export async function mirrorDocToKnowledge(
  runtime: IAgentRuntime,
  params: MirrorDocParams
) {
  const http =
    runtime.getService<HttpService>("http") ?? new HttpService({ runtime } as any);

  const knowledge = runtime.getService<KnowledgeService>("knowledge" as any);
  if (!knowledge) {
    throw new Error(
      "KnowledgeService not available. Make sure @elizaos/plugin-knowledge is registered."
    );
  }

  // Convert GitHub/GitLab blob URLs to raw content URLs
  const rawUrl = normalizeToRawUrl(params.url);
  const res = await http.get(rawUrl);
  const contentType =
    params.contentType || res.headers.get("content-type") || "text/plain";

  let content: string;
  if (
    contentType.startsWith("application/") &&
    !contentType.includes("json")
  ) {
    const buf = Buffer.from(await res.arrayBuffer());
    content = buf.toString("base64");
  } else {
    content = await res.text();
  }

  // Store full document for exact quote retrieval
  const sourceId = params.metadata?.sourceId as string | undefined;
  const versionId = params.metadata?.versionId as string | undefined;
  if (sourceId && versionId) {
    const contentHash = createHash("sha256").update(content).digest("hex");
    await datamirrorDocumentsRepository.store(runtime, {
      sourceId,
      versionId,
      url: params.url,
      content,
      contentHash,
      mimeType: contentType,
      byteSize: Buffer.byteLength(content, "utf8"),
    });
  }

  const clientDocumentId = randomUUID();
  const worldId = params.worldId ?? runtime.agentId;

  const result = await (knowledge as any).addKnowledge({
    worldId,
    roomId: params.roomId,
    entityId: params.entityId,
    clientDocumentId,
    originalFilename: params.filename,
    contentType,
    content,
    metadata: {
      sourceUrl: params.url,
      rawUrl: rawUrl !== params.url ? rawUrl : undefined,
      datamirror: true,
      ...(params.metadata ?? {}),
    },
  });

  return {
    knowledgeDocumentId: result.id as string,
    clientDocumentId,
    worldId,
  };
}
