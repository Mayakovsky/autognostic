/**
 * Direct DB query — checks the 'autognostic' PG schema (not 'public').
 * Run with: npx tsx scripts/check-knowledge.ts
 */
import { PGlite } from "@electric-sql/pglite";
import path from "path";

const DB_PATH = path.resolve(".eliza/.elizadb");

async function main() {
  console.log(`\n📂 Connecting to PGlite at: ${DB_PATH}\n`);
  
  const db = new PGlite(DB_PATH);

  // List ALL schemas
  const schemas = await db.query(`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;`);
  console.log("=== SCHEMAS ===");
  for (const row of schemas.rows as any[]) {
    console.log(`  - ${row.schema_name}`);
  }

  // Check autognostic schema tables
  const tables = await db.query(`
    SELECT table_schema, table_name FROM information_schema.tables 
    WHERE table_schema = 'autognostic'
    ORDER BY table_name;
  `);
  console.log(`\n=== AUTOGNOSTIC TABLES (${tables.rows.length}) ===`);
  if (tables.rows.length === 0) {
    console.log("  (none — schema exists but no tables, or schema missing)");
  } else {
    for (const row of tables.rows as any[]) {
      console.log(`  - ${row.table_schema}.${row.table_name}`);
    }
  }

  // Documents
  try {
    const docs = await db.query(`SELECT id, url, content_hash, created_at FROM autognostic.documents ORDER BY created_at DESC;`);
    console.log(`\n=== DOCUMENTS (${docs.rows.length}) ===`);
    for (const row of docs.rows as any[]) {
      console.log(`  [${row.id?.slice(0, 8)}] ${row.url}  (hash: ${row.content_hash?.slice(0, 12)})`);
    }
    if (docs.rows.length === 0) console.log("  (empty)");
  } catch (e: any) {
    console.log(`\n=== DOCUMENTS: ${e.message} ===`);
  }

  // Sources
  try {
    const sources = await db.query(`SELECT id, source_url, enabled, last_sync_at FROM autognostic.sources ORDER BY created_at DESC;`);
    console.log(`\n=== SOURCES (${sources.rows.length}) ===`);
    for (const row of sources.rows as any[]) {
      console.log(`  [${row.id?.slice(0, 8)}] ${row.source_url}  enabled=${row.enabled}  synced=${row.last_sync_at ?? "never"}`);
    }
    if (sources.rows.length === 0) console.log("  (empty)");
  } catch (e: any) {
    console.log(`\n=== SOURCES: ${e.message} ===`);
  }

  // Taxonomy (seed data check)
  try {
    const tax = await db.query(`SELECT COUNT(*) as cnt FROM autognostic.taxonomy_nodes;`);
    const vocab = await db.query(`SELECT COUNT(*) as cnt FROM autognostic.controlled_vocab;`);
    console.log(`\n=== SEED DATA: ${(tax.rows[0] as any).cnt} taxonomy nodes, ${(vocab.rows[0] as any).cnt} vocab terms ===`);
  } catch (e: any) {
    console.log(`\n=== SEED DATA: ${e.message} ===`);
  }

  // Paper classifications
  try {
    const papers = await db.query(`SELECT id, document_id, zone, confidence FROM autognostic.paper_classification ORDER BY created_at DESC;`);
    console.log(`\n=== PAPER CLASSIFICATIONS (${papers.rows.length}) ===`);
    for (const row of papers.rows as any[]) {
      console.log(`  [${row.id?.slice(0, 8)}] doc:${row.document_id?.slice(0, 8)} zone=${row.zone} conf=${row.confidence ?? "?"}`);
    }
    if (papers.rows.length === 0) console.log("  (empty)");
  } catch (e: any) {
    console.log(`\n=== PAPER CLASSIFICATIONS: ${e.message} ===`);
  }

  // ElizaOS knowledge table
  try {
    const knowledge = await db.query(`SELECT COUNT(*) as cnt FROM knowledge;`);
    console.log(`\n=== ELIZAOS KNOWLEDGE: ${(knowledge.rows[0] as any).cnt} entries ===`);
  } catch (e: any) {
    console.log(`\n=== ELIZAOS KNOWLEDGE: ${e.message} ===`);
  }

  // Messages
  try {
    const msgs = await db.query(`SELECT COUNT(*) as cnt FROM memories;`);
    console.log(`=== MEMORIES: ${(msgs.rows[0] as any).cnt} messages ===`);
  } catch (e: any) {
    console.log(`=== MEMORIES: ${e.message} ===`);
  }

  await db.close();
  console.log("\nDone.\n");
}

main().catch(console.error);
