import type { IAgentRuntime } from "@elizaos/core";
import type { KnowledgeService } from "@elizaos/plugin-knowledge";
import { AutognosticKnowledgeLinkRepository } from "../db/autognosticKnowledgeLinkRepository";
import { AutognosticDocumentsRepository } from "../db/autognosticDocumentsRepository";

/**
 * Remove knowledge documents from the semantic store (plugin-knowledge).
 * This handles the cascade removal that was previously missing.
 */
export async function removeFromKnowledge(
  runtime: IAgentRuntime,
  knowledgeDocumentIds: string[]
): Promise<{ removed: number; failed: number }> {
  const knowledge = runtime.getService<KnowledgeService>("knowledge" as any);
  if (!knowledge) {
    console.warn(
      "[autognostic] KnowledgeService not available for removal. Semantic store may have orphaned entries."
    );
    return { removed: 0, failed: knowledgeDocumentIds.length };
  }

  let removed = 0;
  let failed = 0;

  for (const docId of knowledgeDocumentIds) {
    try {
      // Try to remove from plugin-knowledge
      if (typeof (knowledge as any).removeKnowledge === "function") {
        await (knowledge as any).removeKnowledge(docId);
      } else if (typeof (knowledge as any).deleteKnowledge === "function") {
        await (knowledge as any).deleteKnowledge(docId);
      } else {
        console.warn(
          `[autognostic] KnowledgeService does not expose removeKnowledge/deleteKnowledge method. ` +
          `Document ${docId} may remain in semantic store.`
        );
        failed++;
        continue;
      }
      removed++;
    } catch (err) {
      console.warn(
        `[autognostic] Failed to remove knowledge document ${docId}:`,
        err
      );
      failed++;
    }
  }

  console.log(
    `[autognostic] Knowledge removal complete: ${removed} removed, ${failed} failed`
  );
  return { removed, failed };
}

/**
 * Remove a single document by URL from both stores (verbatim + semantic).
 */
export async function removeDocumentByUrl(
  runtime: IAgentRuntime,
  url: string
): Promise<{ success: boolean; error?: string }> {
  const docsRepo = new AutognosticDocumentsRepository(runtime);
  const linkRepo = new AutognosticKnowledgeLinkRepository(runtime);

  // Find the document in verbatim store
  const docs = await docsRepo.getByUrl(url);
  if (!docs.length) {
    return { success: false, error: `Document not found: ${url}` };
  }

  const doc = docs[0];

  // Find linked knowledge entries for this source
  const links = await linkRepo.listBySource(doc.sourceId);
  const knowledgeIds = links.map((l) => l.knowledgeDocumentId);

  // Remove from semantic store
  if (knowledgeIds.length > 0) {
    await removeFromKnowledge(runtime, knowledgeIds);
    // Clean up link records
    for (const link of links) {
      await linkRepo.deleteByKnowledgeId(link.knowledgeDocumentId);
    }
  }

  // Remove from verbatim store
  await docsRepo.deleteByUrl(url);

  console.log(`[autognostic] Removed document ${url} from both stores`);
  return { success: true };
}

/**
 * Remove all documents for a source from both stores.
 * Used during source removal cascade.
 */
export async function removeSourceFromKnowledge(
  runtime: IAgentRuntime,
  sourceId: string
): Promise<{ removed: number; failed: number }> {
  const linkRepo = new AutognosticKnowledgeLinkRepository(runtime);
  const docsRepo = new AutognosticDocumentsRepository(runtime);

  // Get all knowledge links for this source
  const links = await linkRepo.listBySource(sourceId);
  const knowledgeIds = links.map((l) => l.knowledgeDocumentId);

  // Remove from semantic store
  const result = await removeFromKnowledge(runtime, knowledgeIds);

  // Remove verbatim documents
  await docsRepo.deleteBySourceId(sourceId);

  console.log(
    `[autognostic] Removed source ${sourceId} knowledge: ${result.removed} semantic docs removed`
  );

  return result;
}
