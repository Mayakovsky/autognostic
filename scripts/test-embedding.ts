/**
 * Test the embedding pipeline directly through Ollama.
 * This bypasses ElizaOS and hits the Ollama API directly to confirm it works.
 * Run with: npx tsx scripts/test-embedding.ts
 */

const OLLAMA_URL = "http://localhost:11434";

async function main() {
  // Step 1: Check Ollama is reachable
  console.log("\n=== STEP 1: Ollama connectivity ===");
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await resp.json() as { models: Array<{ name: string }> };
    console.log("  ✅ Ollama is running");
    console.log(`  Models: ${data.models.map((m: { name: string }) => m.name).join(", ")}`);
  } catch (e: any) {
    console.log(`  ❌ Cannot reach Ollama at ${OLLAMA_URL}: ${e.message}`);
    console.log("  Run 'ollama serve' first");
    process.exit(1);
  }

  // Step 2: Test embedding generation
  console.log("\n=== STEP 2: Generate test embedding ===");
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text:latest",
        input: "This is a test document about knowledge management systems.",
      }),
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      console.log(`  ❌ Ollama returned ${resp.status}: ${text}`);
      process.exit(1);
    }

    const data = await resp.json() as { embeddings: number[][] };
    const embedding = data.embeddings?.[0];
    if (!embedding || embedding.length === 0) {
      console.log(`  ❌ Empty embedding returned`);
      console.log(`  Response: ${JSON.stringify(data).slice(0, 200)}`);
      process.exit(1);
    }

    console.log(`  ✅ Embedding generated: ${embedding.length} dimensions`);
    console.log(`  First 5 values: [${embedding.slice(0, 5).map(n => n.toFixed(4)).join(", ")}]`);
  } catch (e: any) {
    console.log(`  ❌ Embedding generation failed: ${e.message}`);
    process.exit(1);
  }

  // Step 3: Test the Vercel AI SDK path (what plugin-ollama actually uses)
  console.log("\n=== STEP 3: Test via 'ai' + 'ollama-ai-provider' SDK (plugin-ollama's path) ===");
  try {
    const { createOllama } = await import("ollama-ai-provider");
    const { embed } = await import("ai");

    const ollama = createOllama({ baseURL: `${OLLAMA_URL}/api` });
    const result = await embed({
      model: ollama.embedding("nomic-embed-text:latest"),
      value: "Test embedding through the AI SDK path.",
    });

    console.log(`  ✅ AI SDK embedding: ${result.embedding.length} dimensions`);
    console.log(`  First 5 values: [${result.embedding.slice(0, 5).map(n => n.toFixed(4)).join(", ")}]`);
  } catch (e: any) {
    console.log(`  ❌ AI SDK path failed: ${e.message}`);
    console.log("  This is the path plugin-ollama uses. If this fails, embeddings won't work in ElizaOS.");
    console.log(`  You may need: bun add ollama-ai-provider ai`);
  }

  // Step 4: Check embedding dimension compatibility
  console.log("\n=== STEP 4: Dimension check ===");
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    const path = await import("path");
    const db = new PGlite(path.resolve(".eliza/.elizadb"));
    
    const cols = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'embeddings' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.log("  Embeddings table columns:");
    for (const row of cols.rows as any[]) {
      console.log(`    - ${row.column_name}`);
    }
    await db.close();
  } catch (e: any) {
    console.log(`  ⚠️ Could not check embeddings table: ${e.message}`);
  }

  console.log("\n✅ All checks passed. Embedding pipeline should work.\n");
}

main().catch(console.error);
