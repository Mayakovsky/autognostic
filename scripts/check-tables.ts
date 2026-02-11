import { PGlite } from "@electric-sql/pglite";
import path from "path";

const db = new PGlite(path.resolve(".eliza/.elizadb"));

// List ALL tables in public schema
const tables = await db.query(`
  SELECT table_schema, table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public'
  ORDER BY table_name;
`);
console.log(`\n=== PUBLIC TABLES (${tables.rows.length}) ===`);
for (const row of tables.rows as any[]) {
  console.log(`  - ${row.table_name}`);
}

// Check for documents table
try {
  const docs = await db.query(`SELECT COUNT(*) as cnt FROM documents;`);
  console.log(`\n=== DOCUMENTS TABLE: ${(docs.rows[0] as any).cnt} entries ===`);
} catch (e: any) {
  console.log(`\n=== DOCUMENTS TABLE: ${e.message} ===`);
}

// Check for knowledge table
try {
  const know = await db.query(`SELECT COUNT(*) as cnt FROM knowledge;`);
  console.log(`=== KNOWLEDGE TABLE: ${(know.rows[0] as any).cnt} entries ===`);
} catch (e: any) {
  console.log(`=== KNOWLEDGE TABLE: ${e.message} ===`);
}

// Check memories table structure
try {
  const cols = await db.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'memories' AND table_schema = 'public'
    ORDER BY ordinal_position;
  `);
  console.log(`\n=== MEMORIES TABLE COLUMNS ===`);
  for (const row of cols.rows as any[]) {
    console.log(`  - ${row.column_name} (${row.data_type})`);
  }
} catch (e: any) {
  console.log(`\n=== MEMORIES: ${e.message} ===`);
}

// Check if memories has a "type" or "tableName" column for dynamic tables
try {
  const sample = await db.query(`SELECT DISTINCT type FROM memories LIMIT 20;`);
  console.log(`\n=== MEMORY TYPES ===`);
  for (const row of sample.rows as any[]) {
    console.log(`  - ${(row as any).type}`);
  }
} catch (e: any) {
  // Try alternate column name
  try {
    const sample2 = await db.query(`SELECT DISTINCT "tableName" FROM memories LIMIT 20;`);
    console.log(`\n=== MEMORY TABLE NAMES ===`);
    for (const row of sample2.rows as any[]) {
      console.log(`  - ${(row as any).tableName}`);
    }
  } catch (e2: any) {
    console.log(`\n=== MEMORY TYPES: no type/tableName column ===`);
  }
}

await db.close();
console.log("\nDone.\n");
