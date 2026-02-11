#!/usr/bin/env bun
/**
 * scaffold-test-agent.ts
 * 
 * Creates a real ElizaOS agent project for testing plugin-autognostic.
 * Based on the archived autognostic-agent but cleaned up and modernized.
 * 
 * Run from plugin-autognostic directory:
 *   npx tsx scripts/scaffold-test-agent.ts
 * 
 * This creates: C:\Users\kidco\dev\eliza\autognostic-agent\
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";

const AGENT_DIR = resolve(import.meta.dirname, "..", "..", "autognostic-agent");
const PLUGIN_DIR = resolve(import.meta.dirname, "..");

if (existsSync(AGENT_DIR)) {
  console.error(`\n❌ Directory already exists: ${AGENT_DIR}`);
  console.error("   Remove it first if you want to re-scaffold:");
  console.error(`   Remove-Item -Recurse -Force "${AGENT_DIR}"\n`);
  process.exit(1);
}

function writeFile(relPath: string, content: string) {
  const fullPath = join(AGENT_DIR, relPath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("\\") > -1 ? fullPath.lastIndexOf("\\") : fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  console.log(`  ✅ ${relPath}`);
}

console.log(`\n=== Scaffolding agent at ${AGENT_DIR} ===\n`);

// ============================================================================
// package.json
// ============================================================================
writeFile("package.json", JSON.stringify({
  name: "autognostic-agent",
  description: "Test agent for @elizaos/plugin-autognostic — real environment testing",
  version: "0.1.0",
  type: "module",
  main: "dist/index.js",
  module: "dist/index.js",
  types: "dist/index.d.ts",
  keywords: ["project", "elizaos"],
  exports: {
    "./package.json": "./package.json",
    ".": {
      import: {
        types: "./dist/index.d.ts",
        default: "./dist/index.js"
      }
    }
  },
  workspaces: ["packages/*"],
  files: ["dist"],
  dependencies: {
    "@elizaos/cli": "1.6.5",
    "@elizaos/client": "1.6.5",
    "@elizaos/core": "1.6.5",
    "@elizaos/plugin-anthropic": "^1.5.12",
    "@elizaos/plugin-bootstrap": "1.6.5",
    "@elizaos/plugin-autognostic": "workspace:*",
    "@elizaos/plugin-knowledge": "^1.5.15",
    "@elizaos/plugin-ollama": "^1.2.4",
    "@elizaos/plugin-openai": "^1.5.18",
    "@elizaos/plugin-sql": "1.6.5",
    "@elizaos/server": "1.6.5",
    zod: "^3.23.8"
  },
  devDependencies: {
    typescript: "^5.9.3"
  },
  scripts: {
    start: "elizaos start",
    dev: "elizaos dev",
    build: "bun run build.ts",
    "type-check": "tsc --noEmit"
  }
}, null, 2));

// ============================================================================
// .env — real config with Ollama + Anthropic
// ============================================================================
writeFile(".env", `# ============================================================================
# AUTOGNOSTIC TEST AGENT — Environment Configuration
# ============================================================================

# --- LLM: Anthropic for chat ---
ANTHROPIC_API_KEY=your-anthropic-api-key-here
ANTHROPIC_SMALL_MODEL=claude-3-5-haiku-20241022

# --- Embeddings: Ollama (local, no rate limits) ---
OLLAMA_API_ENDPOINT=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# --- Database: PGlite (embedded) ---
ELIZA_DB_PROVIDER=sql

# --- Autognostic plugin ---
# AUTOGNOSTIC_AUTH_TOKEN=your-secure-token
# CROSSREF_MAILTO=your@email.com
`);

// ============================================================================
// .env.example — safe version for git
// ============================================================================
writeFile(".env.example", `# LLM
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_SMALL_MODEL=claude-3-5-haiku-20241022

# Embeddings (Ollama local)
OLLAMA_API_ENDPOINT=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Database
ELIZA_DB_PROVIDER=sql

# Autognostic (optional)
# AUTOGNOSTIC_AUTH_TOKEN=your-secure-token
# CROSSREF_MAILTO=your@email.com
`);

// ============================================================================
// .gitignore
// ============================================================================
writeFile(".gitignore", `# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Environment files
.env
.env.local

# ElizaOS data
.eliza/

# Logs
*.log

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Bun
bun.lock

# Claude
.claude/
.seshmem/
`);

// ============================================================================
// tsconfig.json
// ============================================================================
writeFile("tsconfig.json", JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "Bundler",
    outDir: "dist",
    rootDir: "src",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    declaration: true,
    sourceMap: true,
    paths: {
      "@elizaos/plugin-autognostic": ["./packages/plugin-autognostic/src/index.ts"]
    }
  },
  include: ["src"],
  exclude: ["node_modules", "dist", "packages"]
}, null, 2));

// ============================================================================
// tsconfig.build.json — for declaration generation
// ============================================================================
writeFile("tsconfig.build.json", JSON.stringify({
  extends: "./tsconfig.json",
  compilerOptions: {
    emitDeclarationOnly: true,
    declaration: true,
    declarationMap: true,
    outDir: "dist"
  },
  include: ["src"],
  exclude: ["node_modules", "dist", "packages", "**/__tests__/**"]
}, null, 2));

// ============================================================================
// build.ts — Bun bundler (same pattern as archived agent)
// ============================================================================
writeFile("build.ts", `#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { $ } from "bun";

async function build() {
  const start = performance.now();
  console.log("Building autognostic-agent...");

  if (existsSync("dist")) {
    await rm("dist", { recursive: true, force: true });
  }

  const [buildResult, tscResult] = await Promise.all([
    (async () => {
      const result = await Bun.build({
        entrypoints: ["./src/index.ts"],
        outdir: "./dist",
        target: "node",
        format: "esm",
        sourcemap: true,
        minify: false,
        external: [
          "dotenv", "fs", "path", "https", "node:*",
          "@elizaos/core", "@elizaos/plugin-bootstrap",
          "@elizaos/plugin-sql", "@elizaos/plugin-autognostic",
          "@elizaos/plugin-knowledge", "@elizaos/plugin-ollama",
          "@elizaos/plugin-anthropic", "@elizaos/plugin-openai",
          "@elizaos/cli", "zod",
        ],
        naming: { entry: "[dir]/[name].[ext]" },
      });
      if (!result.success) {
        console.error("Build failed:", result.logs);
        return { success: false };
      }
      const sizeMB = (result.outputs.reduce((s, o) => s + o.size, 0) / 1024 / 1024).toFixed(2);
      console.log(\`✓ Built \${result.outputs.length} file(s) — \${sizeMB}MB\`);
      return result;
    })(),
    (async () => {
      try {
        await $\`tsc --emitDeclarationOnly --incremental --project ./tsconfig.build.json\`.quiet();
        console.log("✓ TypeScript declarations generated");
        return { success: true };
      } catch {
        console.warn("⚠ Declaration generation failed (non-fatal)");
        return { success: false };
      }
    })(),
  ]);

  if (!buildResult.success) process.exit(1);
  console.log(\`✅ Build complete (\${((performance.now() - start) / 1000).toFixed(2)}s)\`);
}

build().catch((e) => { console.error(e); process.exit(1); });
`);

// ============================================================================
// src/index.ts — Agent entry point
// ============================================================================
writeFile("src/index.ts", `import { logger, type IAgentRuntime, type Project, type ProjectAgent } from "@elizaos/core";

import sqlPlugin from "@elizaos/plugin-sql";
import anthropicPlugin from "@elizaos/plugin-anthropic";
import ollamaPlugin from "@elizaos/plugin-ollama";
import knowledgePlugin from "@elizaos/plugin-knowledge";
import autognosticPlugin from "@elizaos/plugin-autognostic";

import { character } from "./character.ts";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info(\`Agent initialized: \${character.name}\`);
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  // Plugin load order matters:
  // 1. sql — database adapter
  // 2. ollama — registers TEXT_EMBEDDING handler (must be before knowledge)
  // 3. anthropic — registers chat model handler
  // 4. knowledge — depends on embedding handler being registered
  // 5. autognostic — depends on knowledge service + overrides TEXT_EMBEDDING with direct Ollama API
  plugins: [sqlPlugin, ollamaPlugin, anthropicPlugin, knowledgePlugin, autognosticPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from "./character.ts";
export default project;
`);

// ============================================================================
// src/character.ts — Knowledge-focused character
// ============================================================================
writeFile("src/character.ts", `import { type Character } from "@elizaos/core";

/**
 * Autognostic Test Agent
 * 
 * A knowledge-management focused character for testing plugin-autognostic.
 * System prompt is tuned to prioritize structured actions over free-form replies.
 */
export const character: Character = {
  name: "Atlas",
  plugins: [
    "@elizaos/plugin-sql",
    "@elizaos/plugin-ollama",
    "@elizaos/plugin-anthropic",
    "@elizaos/plugin-knowledge",
    "@elizaos/plugin-autognostic",
    "@elizaos/plugin-bootstrap",
  ],
  settings: {
    secrets: {},
  },
  system: [
    "You are Atlas, a knowledge management agent powered by the Autognostic system.",
    "Your primary function is managing a knowledge base: adding documents, retrieving exact quotes, and listing stored content.",
    "",
    "CRITICAL RULES:",
    "- When a user shares a URL and wants to store it: use ADD_URL_TO_KNOWLEDGE.",
    "- When a user asks to read, quote, print, or retrieve ANY content from a stored document: use GET_EXACT_QUOTE. NEVER attempt to recall document content from memory or conversation context.",
    "- When a user asks what documents are stored: use LIST_KNOWLEDGE_DOCUMENTS.",
    "- When a user asks to remove a document: use REMOVE_KNOWLEDGE_DOCUMENT.",
    "- NEVER use REPLY or SEND_MESSAGE to answer questions about document content. Only GET_EXACT_QUOTE has access to stored documents.",
    "- If you don't know which document the user is referring to, ask them to clarify.",
    "",
    "You are precise, honest, and never fabricate document content.",
  ].join("\\n"),
  bio: [
    "Manages knowledge bases through natural conversation",
    "Stores documents, retrieves exact quotes, and classifies scientific papers",
    "Always uses structured actions for document operations",
    "Never fabricates or guesses document content",
    "Admits when it cannot find requested information",
  ],
  topics: [
    "knowledge management",
    "document storage and retrieval",
    "scientific paper classification",
    "exact quotation and citation",
  ],
  messageExamples: [
    [
      {
        name: "{{name1}}",
        content: { text: "Add this to knowledge: https://example.com/paper.md" },
      },
      {
        name: "Atlas",
        content: {
          text: "[STORED] paper.md — added to knowledge base. Use GET_EXACT_QUOTE to retrieve content.",
          actions: ["ADD_URL_TO_KNOWLEDGE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "What's the last line of that document?" },
      },
      {
        name: "Atlas",
        content: {
          text: 'Last line (line 42): "The results confirm our initial hypothesis."',
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Print the full document" },
      },
      {
        name: "Atlas",
        content: {
          text: "Full document (2341 chars):\\n\\nAbstract: This paper introduces...",
          actions: ["GET_EXACT_QUOTE"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "What documents do you have?" },
      },
      {
        name: "Atlas",
        content: {
          text: "I have 3 documents in the knowledge base:\\n- paper.md\\n- notes.md\\n- readme.md",
          actions: ["LIST_KNOWLEDGE_DOCUMENTS"],
        },
      },
    ],
  ],
  style: {
    all: [
      "Be precise and factual",
      "Use structured actions for all document operations",
      "Never fabricate document content",
      "Keep responses concise",
      "Admit uncertainty rather than guessing",
    ],
    chat: [
      "Be direct and helpful",
      "Confirm actions taken with clear status messages",
      "Ask for clarification when the target document is ambiguous",
    ],
  },
};
`);

// ============================================================================
// packages/plugin-autognostic — symlink stub (workspace reference)
// ============================================================================
// Instead of copying the full plugin, we create a minimal package.json
// that tells bun's workspace resolver where to find it.
// The actual code lives in ../plugin-autognostic via symlink.

console.log("\n  Creating workspace symlink for plugin-autognostic...");

// We need to create a junction/symlink from packages/plugin-autognostic → ../../plugin-autognostic
mkdirSync(join(AGENT_DIR, "packages"), { recursive: true });

// Write instructions for the symlink (can't create Windows junctions from Node easily)
writeFile("packages/README.md", `# Workspace Packages

This directory should contain a symlink to the plugin-autognostic source:

\`\`\`powershell
# From the autognostic-agent directory:
New-Item -ItemType Junction -Path packages\\plugin-autognostic -Target ..\\..\\plugin-autognostic\\
\`\`\`

This allows \`"@elizaos/plugin-autognostic": "workspace:*"\` in package.json
to resolve to the local plugin source code.
`);

// ============================================================================
// README.md
// ============================================================================
writeFile("README.md", `# Autognostic Test Agent

Real ElizaOS agent for testing [@elizaos/plugin-autognostic](https://github.com/Mayakovsky/autognostic).

## Setup

\`\`\`powershell
# 1. Create workspace symlink to plugin source
New-Item -ItemType Junction -Path packages\\plugin-autognostic -Target ..\\..\\plugin-autognostic\\

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 4. Ensure Ollama is running with embedding model
ollama list  # should show nomic-embed-text

# 5. Build and run
bun run build
elizaos dev
\`\`\`

## Architecture

- **Agent**: Atlas — knowledge management focused character
- **Plugin loading order**: sql → ollama → anthropic → knowledge → autognostic
- **Embeddings**: Ollama (nomic-embed-text, 768 dimensions) via direct REST API
- **Chat**: Anthropic (claude-3-5-haiku)
- **Database**: PGlite (embedded PostgreSQL)

## Testing Flow

1. Add a document: \`Add this to knowledge: https://github.com/Mayakovsky/test_tube/blob/main/potato_chimpanzee_falafel_garb.md\`
2. Verify storage: \`What documents do you have?\`
3. Test retrieval: \`Print the full document\`
4. Test quotes: \`What's the last line?\`
5. Test search: \`What does it say about potatoes?\`
`);

// ============================================================================
// DONE
// ============================================================================
console.log("\n" + "=".repeat(60));
console.log("Agent scaffolded successfully!");
console.log("=".repeat(60));
console.log(`\nLocation: ${AGENT_DIR}`);
console.log("\nRun these commands to set up:\n");
console.log("  cd ..\\autognostic-agent");
console.log("  New-Item -ItemType Junction -Path packages\\plugin-autognostic -Target ..\\plugin-autognostic\\");
console.log("  bun install");
console.log("  bun run build");
console.log("  elizaos dev");
console.log("\nThe agent will load your plugin from source via workspace symlink.");
console.log("Any changes to plugin-autognostic/src will be picked up on rebuild.\n");
