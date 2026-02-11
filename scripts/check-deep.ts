import { PGlite } from "@electric-sql/pglite";
import path from "path";

const db = new PGlite(path.resolve(".eliza/.elizadb"));

// Check what the agent record looks like
const agents = await db.query(`SELECT id, name FROM agents LIMIT 5;`);
console.log(`\n=== AGENTS ===`);
for (const row of agents.rows as any[]) {
  console.log(`  [${row.id?.slice(0, 8)}] ${row.name}`);
}

// Check if there's a components table with plugin info
try {
  const components = await db.query(`SELECT DISTINCT type FROM components LIMIT 20;`);
  console.log(`\n=== COMPONENT TYPES ===`);
  for (const row of components.rows as any[]) {
    console.log(`  - ${(row as any).type}`);
  }
} catch (e: any) {
  console.log(`Components: ${e.message}`);
}

// Check cache for any ollama/knowledge settings
try {
  const cache = await db.query(`SELECT key FROM cache WHERE key LIKE '%ollama%' OR key LIKE '%knowledge%' OR key LIKE '%embed%' LIMIT 20;`);
  console.log(`\n=== RELEVANT CACHE KEYS ===`);
  for (const row of cache.rows as any[]) {
    console.log(`  - ${(row as any).key}`);
  }
  if (cache.rows.length === 0) console.log("  (none)");
} catch (e: any) {
  console.log(`Cache: ${e.message}`);
}

// Memory type distribution
const types = await db.query(`SELECT type, COUNT(*) as cnt FROM memories GROUP BY type ORDER BY cnt DESC;`);
console.log(`\n=== MEMORY TYPES ===`);
if (types.rows.length === 0) {
  console.log("  (no type values - all NULL)");
  const nullCount = await db.query(`SELECT COUNT(*) as cnt FROM memories WHERE type IS NULL;`);
  console.log(`  NULL type count: ${(nullCount.rows[0] as any).cnt}`);
} else {
  for (const row of types.rows as any[]) {
    console.log(`  type="${row.type ?? '(null)'}" → ${row.cnt} rows`);
  }
}

// Sample memories content
const sample = await db.query(`
  SELECT id, type, content->>'text' as txt, 
         metadata->>'type' as meta_type,
         metadata->>'source' as meta_source
  FROM memories 
  ORDER BY "createdAt" DESC 
  LIMIT 8;
`);
console.log(`\n=== LAST 8 MEMORIES ===`);
for (const row of sample.rows as any[]) {
  const txt = (row as any).txt?.slice(0, 60) || "(no text)";
  console.log(`  type=${(row as any).type ?? 'NULL'} | meta_type=${(row as any).meta_type ?? 'NULL'} | src=${(row as any).meta_source ?? 'NULL'}`);
  console.log(`    "${txt}"`);
}

await db.close();
console.log("\nDone.\n");
