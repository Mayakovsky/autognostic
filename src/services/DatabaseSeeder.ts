import type { IAgentRuntime } from "@elizaos/core";
import { getDb } from "../db/getDb";
import { autognosticTaxonomyNodes, autognosticControlledVocab } from "../db/schema";
import { L1_TAXONOMY_NODES, ALL_CONTROLLED_VOCAB } from "../db/seedData";

/**
 * DatabaseSeeder
 * 
 * Seeds initial reference data (L1 taxonomy nodes, controlled vocabulary)
 * on plugin initialization. Idempotent - safe to run multiple times.
 * 
 * Works with both PGlite (local) and PostgreSQL (cloud) backends.
 */
export class DatabaseSeeder {
  constructor(private runtime: IAgentRuntime) {}

  /**
   * Seed reference data if tables are empty.
   * Uses try/catch per insert for idempotency (handles duplicates gracefully).
   */
  async seedIfEmpty(): Promise<{ taxonomySeeded: number; vocabSeeded: number }> {
    const db = await getDb(this.runtime);
    let taxonomySeeded = 0;
    let vocabSeeded = 0;

    try {
      // Check if taxonomy nodes exist
      const existingNodes = await db.select().from(autognosticTaxonomyNodes).limit(1);
      
      if (existingNodes.length === 0) {
        // Seed L1 taxonomy nodes
        for (const node of L1_TAXONOMY_NODES) {
          try {
            await db.insert(autognosticTaxonomyNodes).values({
              id: node.id,
              level: node.level,
              name: node.name,
              definition: node.definition,
              keywords: node.keywords,
              status: "active",
              versionIntroduced: "1.0",
            });
            taxonomySeeded++;
          } catch (err) {
            // Ignore duplicate key errors (idempotent behavior)
            const errMsg = err instanceof Error ? err.message : String(err);
            if (!errMsg.includes("duplicate") && !errMsg.includes("unique") && !errMsg.includes("UNIQUE")) {
              console.warn(`[autognostic] Failed to seed taxonomy node ${node.id}:`, errMsg);
            }
          }
        }
        
        if (taxonomySeeded > 0) {
          console.log(`[autognostic] Seeded ${taxonomySeeded} taxonomy nodes`);
        }
      }

      // Check if controlled vocab exists
      const existingVocab = await db.select().from(autognosticControlledVocab).limit(1);
      
      if (existingVocab.length === 0) {
        // Seed controlled vocabulary
        for (const vocab of ALL_CONTROLLED_VOCAB) {
          try {
            await db.insert(autognosticControlledVocab).values({
              id: vocab.id,
              facetType: vocab.facetType,
              term: vocab.term,
              definition: vocab.definition,
              status: "active",
              usageCount: 0,
            });
            vocabSeeded++;
          } catch (err) {
            // Ignore duplicate key errors
            const errMsg = err instanceof Error ? err.message : String(err);
            if (!errMsg.includes("duplicate") && !errMsg.includes("unique") && !errMsg.includes("UNIQUE")) {
              console.warn(`[autognostic] Failed to seed vocab ${vocab.id}:`, errMsg);
            }
          }
        }
        
        if (vocabSeeded > 0) {
          console.log(`[autognostic] Seeded ${vocabSeeded} controlled vocabulary terms`);
        }
      }

    } catch (err) {
      // Tables may not exist yet on first run before Drizzle migration completes
      // This is expected - ElizaOS will create tables from schema export
      const errMsg = err instanceof Error ? err.message : String(err);
      
      // Only log if it's not a "table doesn't exist" error
      if (!errMsg.includes("does not exist") && !errMsg.includes("no such table")) {
        console.warn("[autognostic] Database seeding issue:", errMsg);
      }
    }

    return { taxonomySeeded, vocabSeeded };
  }

  /**
   * Check if seed data exists (for diagnostics).
   */
  async checkSeedStatus(): Promise<{ taxonomyCount: number; vocabCount: number }> {
    try {
      const db = await getDb(this.runtime);
      
      const taxonomyRows = await db.select().from(autognosticTaxonomyNodes);
      const vocabRows = await db.select().from(autognosticControlledVocab);
      
      return {
        taxonomyCount: taxonomyRows.length,
        vocabCount: vocabRows.length,
      };
    } catch {
      return { taxonomyCount: 0, vocabCount: 0 };
    }
  }
}
