import type { IAgentRuntime, UUID } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";
import { HttpService } from "../services/httpService";
import { randomUUID } from "crypto";

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

  const res = await http.get(params.url);
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
