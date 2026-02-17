import type { IAgentRuntime, UUID } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";
import { HttpService } from "../services/httpService";
import { ContentResolver } from "../services/ContentResolver";
import { randomUUID, createHash } from "crypto";
import { autognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";
import { analyzeDocument } from "../services/DocumentAnalyzer";
import { logger } from "../utils/logger";

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
    runtime.getService<HttpService>("http") ?? new HttpService(runtime);
  const resolver = new ContentResolver(http);

  const knowledge = runtime.getService<KnowledgeService>("knowledge");
  if (!knowledge) {
    throw new Error(
      "KnowledgeService not available. Make sure @elizaos/plugin-knowledge is registered."
    );
  }

  // === CONTENT RESOLUTION (replaces all fetch/parse/PDF logic) ===
  const resolved = await resolver.resolve(params.url);

  // Log diagnostics at debug level (visible with LOG_LEVEL=debug)
  const log = logger.child({ operation: "mirrorDocToKnowledge", url: params.url });
  for (const d of resolved.diagnostics) {
    log.debug(d);
  }
  log.info("Content resolved", {
    source: resolved.source,
    textLength: resolved.text.length,
    resolvedUrl: resolved.resolvedUrl,
  });

  // === VERBATIM DOCUMENT STORAGE ===
  // Only store if caller provided sourceId + versionId
  // (addUrlToKnowledgeAction does; ReconciliationService does NOT)
  const sourceId = params.metadata?.sourceId as string | undefined;
  const versionId = params.metadata?.versionId as string | undefined;
  if (sourceId && versionId) {
    const contentHash = createHash("sha256").update(resolved.text).digest("hex");

    // Store with original URL (what user likely mentions in conversation)
    await autognosticDocumentsRepository.store(runtime, {
      sourceId,
      versionId,
      url: params.url,
      content: resolved.text,
      contentHash,
      mimeType: resolved.contentType,
      byteSize: Buffer.byteLength(resolved.text, "utf8"),
    });

    // Compute and store structural profile for retrieval
    try {
      const profile = analyzeDocument(resolved.text);
      await autognosticDocumentsRepository.updateProfile(runtime, params.url, profile);
    } catch (err) {
      log.debug("Profile analysis failed (non-fatal)");
    }

    // Also store with resolved URL if different (for flexible lookup)
    if (resolved.resolvedUrl !== params.url) {
      try {
        await autognosticDocumentsRepository.store(runtime, {
          sourceId: randomUUID(),
          versionId,
          url: resolved.resolvedUrl,
          content: resolved.text,
          contentHash,
          mimeType: resolved.contentType,
          byteSize: Buffer.byteLength(resolved.text, "utf8"),
        });
        const profile = analyzeDocument(resolved.text);
        await autognosticDocumentsRepository.updateProfile(runtime, resolved.resolvedUrl, profile);
      } catch { /* duplicate key or non-fatal */ }
    }
  }

  // === PUSH TO KNOWLEDGE SERVICE ===
  const clientDocumentId = randomUUID();
  const worldId = params.worldId ?? runtime.agentId;

  const result = await knowledge.addKnowledge({
    worldId,
    roomId: params.roomId,
    entityId: params.entityId,
    clientDocumentId,
    originalFilename: params.filename,
    contentType: resolved.contentType,
    content: resolved.text,
    metadata: {
      sourceUrl: params.url,
      rawUrl: resolved.resolvedUrl !== params.url ? resolved.resolvedUrl : undefined,
      autognostic: true,
      contentSource: resolved.source,
      ...(params.metadata ?? {}),
    },
  });

  return {
    knowledgeDocumentId: result.storedDocumentMemoryId as string,
    clientDocumentId,
    worldId,
  };
}
