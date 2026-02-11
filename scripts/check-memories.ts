import { PGlite } from "@electric-sql/pglite";
import path from "path";

const db = new PGlite(path.resolve(".eliza/.elizadb"));

// Check what types exist in memories
const types = await db.query(`SELECT type, COUNT(*) as cnt FROM memories GROUP BY type ORDER BY cnt DESC;`);
console.log(`\n=== MEMORY TYPE DISTRIBUTION ===`);
for (const row of types.rows as any[]) {
  console.log(`  type="${row.type ?? '(null)'}" → ${row.cnt} rows`);
}

// Sample a few recent memories to see structure
const sample = await db.query(`SELECT id, type, "agentId", "entityId", "createdAt", content->'text' as text_preview, metadata FROM memories ORDER BY "createdAt" DESC LIMIT 5;`);
console.log(`\n=== LAST 5 MEMORIES ===`);
for (const row of sample.rows as any[]) {
  const text = typeof row.text_preview === 'string' ? row.text_preview.slice(0, 80) : JSON.stringify(row.text_preview)?.slice(0, 80);
  const meta = row.metadata ? JSON.stringify(row.metadata).slice(0, 100) : '(null)';
  console.log(`  [${row.id?.slice(0, 8)}] type=${row.type ?? '(null)'} agent=${row.agentId?.slice(0, 8)}`);
  console.log(`    text: ${text}`);
  console.log(`    meta: ${meta}`);
  console.log();
}

// Check if ANY memories have document/knowledge/fragment types
const docTypes = await db.query(`SELECT type, COUNT(*) as cnt FROM memories WHERE type IN ('documents', 'knowledge', 'fragments', 'document', 'fragment') GROUP BY type;`);
console.log(`=== DOCUMENT/KNOWLEDGE MEMORIES ===`);
if (docTypes.rows.length === 0) {
  console.log("  (none found — knowledge pipeline never wrote to memories)");
} else {
  for (const row of docTypes.rows as any[]) {
    console.log(`  type="${row.type}" → ${row.cnt} rows`);
  }
}

// Check metadata for any autognostic markers
const autoMeta = await db.query(`SELECT id, type, metadata FROM memories WHERE metadata::text LIKE '%autognostic%' LIMIT 5;`);
console.log(`\n=== MEMORIES WITH AUTOGNOSTIC METADATA: ${autoMeta.rows.length} ===`);
for (const row of autoMeta.rows as any[]) {
  console.log(`  [${row.id?.slice(0, 8)}] type=${row.type} meta=${JSON.stringify(row.metadata).slice(0, 120)}`);
}

// Check embeddings table
const embeds = await db.query(`SELECT COUNT(*) as cnt FROM embeddings;`);
console.log(`\n=== EMBEDDINGS: ${(embeds.rows[0] as any).cnt} entries ===`);

await db.close();
console.log("\nDone.\n");
