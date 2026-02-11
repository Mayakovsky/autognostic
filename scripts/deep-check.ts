import { PGlite } from "@electric-sql/pglite";
import path from "path";

const db = new PGlite(path.resolve(".eliza/.elizadb"));

// Full type distribution
const types = await db.query(`SELECT type, COUNT(*) as cnt FROM memories GROUP BY type ORDER BY cnt DESC;`);
console.log(`\n=== MEMORY TYPE DISTRIBUTION (${types.rows.length} types) ===`);
for (const row of types.rows as any[]) {
  console.log(`  type="${row.type ?? '(null)'}" → ${row.cnt} rows`);
}

// Check for documents/knowledge types specifically
const docKnow = await db.query(`
  SELECT type, COUNT(*) as cnt 
  FROM memories 
  WHERE type IN ('documents', 'knowledge', 'fragments', 'messages') 
  GROUP BY type;
`);
console.log(`\n=== KEY TYPES ===`);
if (docKnow.rows.length === 0) {
  console.log("  No documents/knowledge/messages types found");
} else {
  for (const row of docKnow.rows as any[]) {
    console.log(`  ${row.type}: ${row.cnt}`);
  }
}

// Sample documents-type memories if any
const docs = await db.query(`
  SELECT id, type, content->'text' as text_start, metadata 
  FROM memories 
  WHERE type = 'documents' 
  ORDER BY "createdAt" DESC 
  LIMIT 3;
`);
console.log(`\n=== DOCUMENT MEMORIES (${docs.rows.length}) ===`);
for (const row of docs.rows as any[]) {
  const text = typeof row.text_start === 'string' ? row.text_start.slice(0, 100) : JSON.stringify(row.text_start)?.slice(0, 100);
  console.log(`  [${row.id?.slice(0, 8)}] ${text}`);
  console.log(`  meta: ${JSON.stringify(row.metadata)?.slice(0, 150)}`);
}

// Sample knowledge-type memories if any
const know = await db.query(`
  SELECT id, type, content->'text' as text_start, metadata 
  FROM memories 
  WHERE type = 'knowledge' 
  ORDER BY "createdAt" DESC 
  LIMIT 3;
`);
console.log(`\n=== KNOWLEDGE MEMORIES (${know.rows.length}) ===`);
for (const row of know.rows as any[]) {
  const text = typeof row.text_start === 'string' ? row.text_start.slice(0, 100) : JSON.stringify(row.text_start)?.slice(0, 100);
  console.log(`  [${row.id?.slice(0, 8)}] ${text}`);
  console.log(`  meta: ${JSON.stringify(row.metadata)?.slice(0, 150)}`);
}

// Check embeddings
const embeds = await db.query(`SELECT COUNT(*) as cnt FROM embeddings;`);
console.log(`\n=== EMBEDDINGS: ${(embeds.rows[0] as any).cnt} entries ===`);

// Sample embeddings to see if they link to knowledge memories
const embedSample = await db.query(`
  SELECT e.id, e."memoryId", m.type as memory_type
  FROM embeddings e
  LEFT JOIN memories m ON m.id = e."memoryId"
  LIMIT 5;
`);
console.log(`\n=== EMBEDDING→MEMORY LINKS (sample) ===`);
for (const row of embedSample.rows as any[]) {
  console.log(`  embed=${row.id?.slice(0, 8)} → memory=${row.memoryId?.slice(0, 8)} type=${row.memory_type ?? '(null)'}`);
}

// Check for autognostic metadata in ANY memory
const autoMeta = await db.query(`
  SELECT id, type, metadata::text as meta_text 
  FROM memories 
  WHERE metadata::text LIKE '%autognostic%' 
  LIMIT 5;
`);
console.log(`\n=== MEMORIES WITH 'autognostic' IN METADATA: ${autoMeta.rows.length} ===`);
for (const row of autoMeta.rows as any[]) {
  console.log(`  [${row.id?.slice(0, 8)}] type=${row.type} meta=${row.meta_text?.slice(0, 150)}`);
}

// Check for sourceUrl in metadata
const srcUrl = await db.query(`
  SELECT id, type, metadata->'sourceUrl' as src 
  FROM memories 
  WHERE metadata->>'sourceUrl' IS NOT NULL 
  LIMIT 5;
`);
console.log(`\n=== MEMORIES WITH sourceUrl: ${srcUrl.rows.length} ===`);
for (const row of srcUrl.rows as any[]) {
  console.log(`  [${row.id?.slice(0, 8)}] type=${row.type} src=${row.src}`);
}

await db.close();
console.log("\nDone.\n");
