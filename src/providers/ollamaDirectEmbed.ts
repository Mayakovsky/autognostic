/**
 * Direct Ollama embedding provider.
 * 
 * Bypasses the broken ollama-ai-provider SDK (v1 spec incompatible with ai@5)
 * by calling the Ollama REST API directly.
 * 
 * This registers as a ModelType.TEXT_EMBEDDING handler in the plugin's models map,
 * overriding plugin-ollama's broken SDK path.
 */

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text:latest";

export async function ollamaDirectEmbed(
  runtime: { getSetting: (key: string) => string | undefined },
  params: { text?: string; input?: string }
): Promise<number[]> {
  const baseUrl = runtime.getSetting("OLLAMA_API_ENDPOINT") 
    || runtime.getSetting("OLLAMA_API_URL") 
    || OLLAMA_DEFAULT_URL;
  const model = runtime.getSetting("OLLAMA_EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL;
  const text = params.text || params.input || "";

  if (!text.trim()) {
    console.warn("[autognostic:embed] Empty text for embedding, returning zero vector");
    return new Array(768).fill(0);
  }

  const resp = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Ollama embedding failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json() as { embeddings: number[][] };
  const embedding = data.embeddings?.[0];

  if (!embedding || embedding.length === 0) {
    throw new Error(`Ollama returned empty embedding for model ${model}`);
  }

  return embedding;
}
