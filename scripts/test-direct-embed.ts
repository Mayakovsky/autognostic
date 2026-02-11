/**
 * Quick test of our direct Ollama embedding override.
 * Run with: npx tsx scripts/test-direct-embed.ts
 */
import { ollamaDirectEmbed } from "../src/providers/ollamaDirectEmbed";

const mockRuntime = {
  getSetting: (key: string) => {
    if (key === "OLLAMA_API_ENDPOINT") return undefined;
    if (key === "OLLAMA_API_URL") return undefined;
    if (key === "OLLAMA_EMBEDDING_MODEL") return undefined;
    return undefined;
  },
};

async function main() {
  console.log("\n=== Testing ollamaDirectEmbed ===\n");

  try {
    const embedding = await ollamaDirectEmbed(mockRuntime, {
      text: "Knowledge management systems enable agents to build structured information.",
    });
    console.log(`✅ Embedding generated: ${embedding.length} dimensions`);
    console.log(`First 5: [${embedding.slice(0, 5).map(n => n.toFixed(4)).join(", ")}]`);
    
    if (embedding.length !== 768) {
      console.warn(`⚠️  Expected 768 dimensions (nomic-embed-text), got ${embedding.length}`);
    }
  } catch (e: any) {
    console.log(`❌ Failed: ${e.message}`);
  }

  console.log();
}

main().catch(console.error);
