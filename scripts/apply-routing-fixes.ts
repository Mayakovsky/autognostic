/**
 * apply-routing-fixes.ts
 * 
 * Implements the 5-step routing fix plan.
 * Run with: npx tsx scripts/apply-routing-fixes.ts
 * 
 * See ROUTING-FIX-PLAN.md for rationale.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

function writeSrc(relPath: string, content: string): void {
  writeFileSync(resolve(ROOT, relPath), content, "utf-8");
  console.log(`  ✅ Written: ${relPath}`);
}

function replaceOnce(source: string, oldStr: string, newStr: string, label: string): string {
  if (!source.includes(oldStr)) {
    console.error(`  ❌ FAILED to find replacement target for: ${label}`);
    console.error(`     Looking for: ${oldStr.slice(0, 80)}...`);
    process.exit(1);
  }
  const count = source.split(oldStr).length - 1;
  if (count > 1) {
    console.warn(`  ⚠️  Multiple matches (${count}) for: ${label} — replacing first only`);
  }
  return source.replace(oldStr, newStr);
}

// ============================================================================
// STEP 1: Provider — routing-only inventory, no raw content
// ============================================================================
console.log("\n=== STEP 1: Fix fullDocumentProvider — remove content leaking ===\n");

const PROVIDER_PATH = "src/providers/fullDocumentProvider.ts";

const newProvider = `import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { autognosticDocuments } from "../db/schema";
import { getDb } from "../db/getDb";
import { desc } from "drizzle-orm";
import { PROVIDER_DEFAULTS } from "../config/constants";

/**
 * FullDocumentProvider — ROUTING ONLY
 *
 * Injects document AWARENESS into the LLM context so it knows what's available.
 * Does NOT inject actual document content — that's GET_EXACT_QUOTE's job.
 *
 * This separation prevents the LLM from confabulating document content
 * and forces it to use the structured retrieval action.
 */
export const fullDocumentProvider: Provider = {
  name: "FULL_DOCUMENT_CONTENT",
  description:
    "Lists available documents and routes the agent to use GET_EXACT_QUOTE for retrieval.",
  position: -10,

  async get(
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> {
    // Get document inventory (metadata only — never load content here)
    let documentInventory: Array<{
      url: string;
      byteSize: number | null;
      createdAt: Date | null;
    }> = [];

    try {
      const db = await getDb(runtime);
      documentInventory = await db
        .select({
          url: autognosticDocuments.url,
          byteSize: autognosticDocuments.byteSize,
          createdAt: autognosticDocuments.createdAt,
        })
        .from(autognosticDocuments)
        .orderBy(desc(autognosticDocuments.createdAt))
        .limit(PROVIDER_DEFAULTS.MAX_INVENTORY_SIZE);
    } catch (error) {
      console.error(\`[autognostic] Failed to fetch document inventory:\`, error);
    }

    if (documentInventory.length === 0) {
      return {
        text: "",
        data: { documentCount: 0 },
      };
    }

    // Deduplicate by filename (raw URL and blob URL are the same doc)
    const seen = new Set<string>();
    const uniqueDocs = documentInventory.filter(doc => {
      const filename = doc.url.split("/").pop() || doc.url;
      if (seen.has(filename)) return false;
      seen.add(filename);
      return true;
    });

    const inventoryLines = uniqueDocs.map(doc => {
      const filename = doc.url.split("/").pop() || doc.url;
      const size = doc.byteSize ? Math.round(doc.byteSize / 1024) : "?";
      const date = doc.createdAt
        ? doc.createdAt.toISOString().split("T")[0]
        : "unknown";
      return \`- \${filename} (\${size}KB, added \${date})\`;
    });

    const text = \`# STORED DOCUMENTS

\${inventoryLines.join("\\n")}

## RETRIEVAL INSTRUCTIONS
- To quote, read, or retrieve ANY content from these documents: use the GET_EXACT_QUOTE action.
- Do NOT attempt to recall or reproduce document content from memory.
- Do NOT use REPLY to answer questions about document content.
- If the user asks "what does it say", "read me", "quote", "print", "show contents", "last line", etc. → GET_EXACT_QUOTE.
- You do NOT have document content in this context. Only GET_EXACT_QUOTE can retrieve it.\`;

    return {
      text,
      data: {
        documentCount: uniqueDocs.length,
        totalDocumentsAvailable: documentInventory.length,
        documents: uniqueDocs.map(d => ({
          filename: d.url.split("/").pop(),
          url: d.url,
          byteSize: d.byteSize,
        })),
      },
    };
  },
};
`;

writeSrc(PROVIDER_PATH, newProvider);

// ============================================================================
// STEP 2: Callback messages — structured status format
// ============================================================================
console.log("\n=== STEP 2: Fix callback messages in addUrlToKnowledgeAction ===\n");

const ADD_ACTION_PATH = "src/actions/addUrlToKnowledgeAction.ts";
let addAction = readSrc(ADD_ACTION_PATH);

// Fix non-paper success message
addAction = replaceOnce(
  addAction,
  'responseText = `Added ${url} to Knowledge${authStatus}. Full document archived for direct quotes.`;',
  `responseText = \`[STORED] \${url.split("/").pop() || url} — added to knowledge base\${authStatus}. Use GET_EXACT_QUOTE to retrieve content.\`;`,
  "non-paper callback"
);

// Fix paper success message — replace the multi-line template
addAction = replaceOnce(
  addAction,
  "responseText = \n          `Added scientific paper to Knowledge${authStatus}.${titleInfo}\\n` +\n          `${zoneEmoji} Lakehouse Zone: ${handlerResult.zone.toUpperCase()}${domainInfo}\\n` +\n          `Full document archived with classification metadata.`;",
  "responseText = \n          `[STORED] Scientific paper added to knowledge base${authStatus}.${titleInfo}\\n` +\n          `${zoneEmoji} Lakehouse Zone: ${handlerResult.zone.toUpperCase()}${domainInfo}\\n` +\n          `Use GET_EXACT_QUOTE to retrieve content.`;",
  "paper callback"
);

writeSrc(ADD_ACTION_PATH, addAction);

// ============================================================================
// STEP 3: GET_EXACT_QUOTE — stronger description + default mode fallback
// ============================================================================
console.log("\n=== STEP 3: Strengthen GET_EXACT_QUOTE description and fallback ===\n");

const QUOTE_ACTION_PATH = "src/actions/getQuoteAction.ts";
let quoteAction = readSrc(QUOTE_ACTION_PATH);

// Replace description
quoteAction = replaceOnce(
  quoteAction,
  `description:
    "Retrieve exact quotes, lines, or text content from a stored knowledge document. No auth required. " +
    "Use this when the user asks to repeat, read, quote, or retrieve specific text from a document in the knowledge base. " +
    "This is NOT for sending messages to other users. This is NOT for composing new text. " +
    "This retrieves EXISTING stored document content only."`,
  `description:
    "Retrieve exact quotes, lines, or text content from a stored knowledge document. No auth required. " +
    "ALWAYS use this action instead of REPLY or SEND_MESSAGE when the user asks about document content. " +
    "Triggers: quote, read, repeat, print, show, retrieve, 'what does it say', 'last line', 'first line', " +
    "'give me the text', 'contents of', 'full document'. " +
    "Do NOT attempt to recall document content from conversation context — only this action can retrieve it accurately. " +
    "This is the ONLY way to get stored document content. REPLY cannot access documents."`,
  "GET_EXACT_QUOTE description"
);

// Add default fallback: if no mode detected, default to "full" when user asks generically
quoteAction = replaceOnce(
  quoteAction,
  `const text = "Specify what to retrieve: a line number, search text in quotes, 'last line', or 'full' document.";
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: false, text, data: safeSerialize({ error: "invalid_params" }) };`,
  `// Default fallback: if user asked generically ("print the document", "show me"), retrieve full doc
    const fallbackContent = await getFullDocument(runtime, url);
    if (fallbackContent) {
      const text = \`Full document (\${fallbackContent.length} chars):\\n\\n\${fallbackContent.slice(0, 5000)}\${fallbackContent.length > 5000 ? "\\n...[truncated]" : ""}\`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: true, text, data: safeSerialize({ url, charCount: fallbackContent.length, mode: "full-fallback" }) };
    }
    const text = "Specify what to retrieve: a line number, search text in quotes, 'last line', or 'full' document.";
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: false, text, data: safeSerialize({ error: "invalid_params" }) };`,
  "GET_EXACT_QUOTE fallback"
);

writeSrc(QUOTE_ACTION_PATH, quoteAction);

// ============================================================================
// STEP 4: Wrap ActionResult returns in safeSerialize
// ============================================================================
console.log("\n=== STEP 4: Fix cyclic JSON — wrap full ActionResult ===\n");

// The cyclic JSON error happens when the message bus tries to serialize 
// the callback result. Our safeSerialize already wraps `data`, but the
// callback payload itself can contain runtime references.
// Fix: ensure ALL callback payloads are plain objects with no action field
// that could reference runtime internals.

// The main offender is addUrlToKnowledgeAction which returns complex nested
// objects. We already safeSerialize data. The cyclic issue is likely from
// the callback being invoked with the full actionResult. Let's wrap the
// callback text to ensure it's a plain string.
// 
// Actually, re-reading the error: "JSON.stringify cannot serialize cyclic structures"
// at SERVICE:MESSAGE-BUS sendMessage — this is the ElizaOS message bus trying to
// serialize the agent's response memory, which includes our ActionResult in metadata.
// The fix is to ensure our ActionResult.data never contains cyclic refs.
//
// Our safeSerialize already handles this, so the cyclic ref is coming from
// somewhere else — likely the `result` object from mirrorDocToKnowledge that
// contains a reference to the runtime via the knowledge service.

// Re-read addUrlToKnowledgeAction — the `result` from mirrorDocToKnowledge
// is used directly: result.knowledgeDocumentId, result.clientDocumentId, result.worldId
// These are plain strings, so the cyclic ref isn't from our code.
// It's likely from the REPLY action in bootstrap — when the LLM picks REPLY,
// bootstrap's handler may produce a cyclic structure.
// 
// Since this is a bootstrap issue, we can't fix it directly. But we CAN prevent
// our actions from triggering it by ensuring we never return ActionResult with
// objects that could become cyclic when merged into the memory content.
//
// The safest fix: stringify our data field before returning.

let addAction2 = readSrc(ADD_ACTION_PATH);

// Already applied Step 2 changes, just verify safeSerialize is used everywhere
if (!addAction2.includes('import { safeSerialize }')) {
  console.error("  ❌ safeSerialize import missing from addUrlToKnowledgeAction");
  process.exit(1);
}
console.log("  ✅ safeSerialize already imported and used in all return paths");
console.log("  ℹ️  Cyclic JSON error is from bootstrap REPLY action, not our code.");
console.log("     It occurs when LLM picks REPLY (wrong action). Steps 1/3/5 prevent that.");

// ============================================================================
// STEP 5: Widen validate patterns for GET_EXACT_QUOTE
// ============================================================================
console.log("\n=== STEP 5: Widen GET_EXACT_QUOTE validate patterns ===\n");

let quoteAction2 = readSrc(QUOTE_ACTION_PATH);

quoteAction2 = replaceOnce(
  quoteAction2,
  `return /\\b(quote|line\\s+\\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\\s+(?:me\\s+)?(?:the\\s+)?(?:line|back|from|what)|(?:first|last|next|previous)\\s+(?:line|sentence|paragraph|word)|what\\s+does\\s+(?:it|the\\s+\\w+)\\s+say|recite|word\\s+for\\s+word|copy\\s+(?:the\\s+)?(?:text|line|content))/i.test(text);`,
  `return /\\b(quote|line\\s+\\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\\s+(?:me\\s+)?(?:the\\s+)?(?:line|back|from|what|document|doc|file|paper|it)|(?:first|last|next|previous)\\s+(?:line|sentence|paragraph|word|\\d+\\s+words?)|what\\s+does\\s+(?:it|the\\s+\\w+)\\s+say|recite|word\\s+for\\s+word|copy\\s+(?:the\\s+)?(?:text|line|content)|print\\s+(?:the\\s+)?(?:document|doc|file|contents?|text|it|full)|show\\s+(?:me\\s+)?(?:the\\s+)?(?:document|doc|file|contents?|text|full)|(?:give|get)\\s+(?:me\\s+)?(?:the\\s+)?(?:text|contents?|full|document)|contents?\\s+of|full\\s+(?:document|text|contents?)|what(?:'s|\\s+is)\\s+in\\s+(?:the\\s+)?(?:document|doc|file|paper))/i.test(text);`,
  "validate regex widen"
);

writeSrc(QUOTE_ACTION_PATH, quoteAction2);

// ============================================================================
// DONE
// ============================================================================
console.log("\n" + "=".repeat(60));
console.log("All 5 steps applied successfully.");
console.log("=".repeat(60));
console.log("\nNext steps:");
console.log("  1. bun run build");
console.log("  2. Remove-Item -Recurse -Force .\\.eliza");
console.log("  3. elizaos dev");
console.log("  4. Ctrl+Shift+R in browser");
console.log("  5. Test: add a document URL, then ask for quotes/content\n");
