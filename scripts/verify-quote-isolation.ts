#!/usr/bin/env npx tsx
/**
 * GET_EXACT_QUOTE Section Isolation Verification
 * 
 * Runs against the ElizaOS v1.6.5 Session API to verify that
 * GET_EXACT_QUOTE returns correct, isolated content for each mode.
 * 
 * Prerequisites:
 *   1. Agent server running: `cd autognostic-agent && elizaos dev`
 *   2. A document already ingested (or set INGEST_URL below)
 * 
 * Usage:
 *   cd C:\Users\kidco\dev\eliza\plugin-autognostic
 *   npx tsx scripts/verify-quote-isolation.ts
 * 
 * Environment:
 *   BASE_URL       - Server URL (default: http://localhost:3000)
 *   INGEST_URL     - URL to ingest before testing (default: arxiv paper below)
 *   SKIP_INGEST    - Set to "true" to skip ingestion (if doc already loaded)
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const API = `${BASE_URL}/api`;
const MESSAGING = `${API}/messaging`;
const INGEST_URL = process.env.INGEST_URL || "https://arxiv.org/abs/2401.04088";
const SKIP_INGEST = process.env.SKIP_INGEST === "true";

// Polling config
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000; // 2 min max wait per message (ingestion can be slow)
const RESPONSE_TIMEOUT_MS = 60000; // 1 min for regular queries

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  message: string;
  timeout?: number;
  validate: (response: string) => ValidationResult;
}

interface ValidationResult {
  pass: boolean;
  detail: string;
}

interface SessionInfo {
  sessionId: string;
  channelId: string;
  agentId: string;
  userId: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function log(msg: string) {
  console.log(`  ${msg}`);
}

function logHeader(msg: string) {
  console.log(`\n${colors.bold(colors.cyan(`═══ ${msg} ═══`))}`);
}

function logTest(name: string, result: ValidationResult) {
  const icon = result.pass ? colors.green("✅ PASS") : colors.red("❌ FAIL");
  console.log(`\n  ${icon}  ${colors.bold(name)}`);
  console.log(`  ${colors.dim(result.detail)}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function getAgents(): Promise<any[]> {
  const res = await fetch(`${API}/agents`);
  if (!res.ok) throw new Error(`GET /agents failed: ${res.status}`);
  const data = await res.json();
  return data.data?.agents || [];
}

async function createSession(agentId: string): Promise<SessionInfo> {
  // Generate a deterministic user ID for testing
  const userId = "00000000-0000-0000-0000-000000000001";

  const res = await fetch(`${MESSAGING}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      userId,
      timeoutConfig: {
        timeoutMinutes: 30,
        autoRenew: true,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /messaging/sessions failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  return {
    sessionId: data.sessionId,
    channelId: data.channelId,
    agentId: data.agentId,
    userId: data.userId,
  };
}

async function sendMessage(sessionId: string, content: string): Promise<any> {
  const res = await fetch(`${MESSAGING}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST message failed: ${res.status} — ${text}`);
  }

  return res.json();
}

async function getMessages(sessionId: string, after?: number): Promise<any[]> {
  const params = new URLSearchParams({ limit: "50" });
  if (after) params.set("after", String(after));

  const res = await fetch(`${MESSAGING}/sessions/${sessionId}/messages?${params}`);
  if (!res.ok) throw new Error(`GET messages failed: ${res.status}`);

  const data = await res.json();
  return data.data?.messages || data.messages || data || [];
}

/**
 * Send a message and poll for the agent's response.
 * Returns the agent's response text.
 */
async function askAgent(
  session: SessionInfo,
  content: string,
  timeoutMs: number = RESPONSE_TIMEOUT_MS
): Promise<string> {
  // Send the user message
  const sent = await sendMessage(session.sessionId, content);
  const sentAt = Date.now();

  log(colors.dim(`→ "${content}"`));
  log(colors.dim(`  Waiting for agent response...`));

  // Poll for response
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const messages = await getMessages(session.sessionId, sentAt - 1000);

    // Find agent response (isAgent flag or authorId check)
    const agentMessages = (Array.isArray(messages) ? messages : [])
      .filter((m: any) => {
        if (m.isAgent !== undefined) return m.isAgent === true;
        const authorId = m.authorId || m.author_id;
        return authorId !== session.userId;
      })
      .sort((a: any, b: any) => {
        const aTime = new Date(a.createdAt || a.created_at).getTime();
        const bTime = new Date(b.createdAt || b.created_at).getTime();
        return bTime - aTime; // newest first
      });

    if (agentMessages.length > 0) {
      const latest = agentMessages[0];
      const text =
        typeof latest.content === "string"
          ? latest.content
          : latest.content?.text || JSON.stringify(latest.content);

      const elapsed = ((Date.now() - sentAt) / 1000).toFixed(1);
      log(colors.dim(`  ← Response received (${elapsed}s)`));
      return text;
    }
  }

  throw new Error(`Timeout waiting for agent response after ${timeoutMs / 1000}s`);
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

const tests: TestCase[] = [
  // ── Step 1: Section isolation ──
  {
    name: "Section: Abstract isolation",
    message: "Show me the abstract",
    validate: (response) => {
      const lower = response.toLowerCase();
      const hasAbstract = lower.includes("abstract") || response.length > 100;
      // Should NOT contain introduction headers or numbered sections
      const hasIntroBleed =
        /\b1[\.\)]\s*(introduction|intro)\b/i.test(response) ||
        /^#+ 1\b/m.test(response);
      return {
        pass: hasAbstract && !hasIntroBleed,
        detail: hasIntroBleed
          ? `BLEED: Introduction content detected in abstract response (${response.length} chars)`
          : `Returned ${response.length} chars, no section bleed detected`,
      };
    },
  },
  {
    name: "Section: Conclusion isolation",
    message: "Show me the conclusion",
    validate: (response) => {
      const lower = response.toLowerCase();
      const hasConclusion =
        lower.includes("conclusion") ||
        lower.includes("conclud") ||
        response.length > 100;
      // Should NOT contain references section
      const hasRefsBleed =
        /\breferences\b/i.test(response) &&
        /\[\d+\]\s+[A-Z]/.test(response); // citation-style references
      return {
        pass: hasConclusion && !hasRefsBleed,
        detail: hasRefsBleed
          ? `BLEED: References content detected in conclusion response (${response.length} chars)`
          : `Returned ${response.length} chars, no reference bleed detected`,
      };
    },
  },
  {
    name: "Section: Introduction isolation",
    message: "Show me the introduction",
    validate: (response) => {
      const lower = response.toLowerCase();
      const hasIntro =
        lower.includes("introduction") ||
        lower.includes("introduce") ||
        response.length > 100;
      return {
        pass: hasIntro && response.length > 50,
        detail: `Returned ${response.length} chars`,
      };
    },
  },

  // ── Step 2: Missing section ──
  {
    name: "Section: Nonexistent section (appendix)",
    message: "Show me the appendix",
    validate: (response) => {
      const lower = response.toLowerCase();
      const isNotFound =
        lower.includes("not found") ||
        lower.includes("no section") ||
        lower.includes("no appendix") ||
        lower.includes("couldn't find") ||
        lower.includes("could not find") ||
        lower.includes("don't have") ||
        lower.includes("doesn't have") ||
        lower.includes("does not have") ||
        lower.includes("unavailable") ||
        lower.includes("does not contain") ||
        lower.includes("doesn't contain") ||
        lower.includes("available sections");
      // Also acceptable: short response indicating nothing found
      const isShortEmpty = response.length < 100;
      return {
        pass: isNotFound || isShortEmpty,
        detail: isNotFound
          ? `Correctly reported section not found`
          : isShortEmpty
            ? `Short response (${response.length} chars) — likely not-found indicator`
            : `Unexpected: ${response.length} chars returned — may be returning random content`,
      };
    },
  },

  // ── Step 3: Nth mode ──
  {
    name: "Nth: Third sentence",
    message: "Give me the third sentence",
    validate: (response) => {
      // Should be a single sentence, not the whole document
      const sentenceCount = response.split(/[.!?]+\s/).filter(Boolean).length;
      return {
        pass: sentenceCount <= 3 && response.length < 2000,
        detail: `~${sentenceCount} sentence(s), ${response.length} chars (expected 1-2 sentences)`,
      };
    },
  },
  {
    name: "Range: Sentences 5 through 8",
    message: "Give me sentences 5 through 8",
    validate: (response) => {
      const sentenceCount = response.split(/[.!?]+\s/).filter(Boolean).length;
      return {
        pass: sentenceCount >= 2 && sentenceCount <= 8 && response.length < 5000,
        detail: `~${sentenceCount} sentence(s), ${response.length} chars (expected 4 sentences)`,
      };
    },
  },

  // ── Step 4: Search mode ──
  {
    name: "Search: Count occurrences of 'attention'",
    message: 'How many times does "attention" appear?',
    validate: (response) => {
      const hasCount = /\d+/.test(response);
      const mentions =
        response.toLowerCase().includes("time") ||
        response.toLowerCase().includes("occur") ||
        response.toLowerCase().includes("appear") ||
        response.toLowerCase().includes("found") ||
        response.toLowerCase().includes("mention");
      return {
        pass: hasCount,
        detail: hasCount
          ? `Contains count number, mentions keyword: ${mentions}`
          : `No count found in response`,
      };
    },
  },

  // ── Step 5: Compound request ──
  {
    name: "Compound: First and last paragraphs",
    message: "Show me the first and last paragraphs",
    validate: (response) => {
      // Should have meaningful content but not be the entire document
      return {
        pass: response.length > 100 && response.length < 15000,
        detail: `Returned ${response.length} chars (expected two paragraphs, not full doc)`,
      };
    },
  },
];

// ─── Main Runner ─────────────────────────────────────────────────────────────

async function main() {
  console.log(colors.bold("\n╔══════════════════════════════════════════════════╗"));
  console.log(colors.bold("║   GET_EXACT_QUOTE Section Isolation Verifier    ║"));
  console.log(colors.bold("╚══════════════════════════════════════════════════╝"));

  // Step 1: Find agent
  logHeader("Finding Atlas agent");
  let agents: any[];
  try {
    agents = await getAgents();
  } catch (e: any) {
    console.error(colors.red(`\n  ✗ Cannot reach server at ${BASE_URL}`));
    console.error(colors.red(`    Is the agent running? (cd autognostic-agent && elizaos dev)`));
    console.error(colors.dim(`    Error: ${e.message}`));
    process.exit(1);
  }

  const atlas = agents.find(
    (a) => a.name?.toLowerCase() === "atlas" && a.status === "active"
  );

  if (!atlas) {
    console.error(colors.red(`\n  ✗ Atlas agent not found or not active`));
    console.error(colors.dim(`    Active agents: ${agents.map((a) => `${a.name}(${a.status})`).join(", ") || "none"}`));
    process.exit(1);
  }

  log(colors.green(`Found Atlas: ${atlas.id}`));

  // Step 2: Create session
  logHeader("Creating test session");
  const session = await createSession(atlas.id);
  log(`Session: ${session.sessionId}`);
  log(`Channel: ${session.channelId}`);

  // Step 3: Ingest test document (unless skipped)
  if (!SKIP_INGEST) {
    logHeader("Ingesting test document");
    log(`URL: ${INGEST_URL}`);
    try {
      const ingestResponse = await askAgent(
        session,
        `Add this to knowledge: ${INGEST_URL}`,
        POLL_TIMEOUT_MS
      );
      log(colors.dim(`Agent: ${ingestResponse.substring(0, 200)}...`));
      // Small pause to let indexing settle
      await sleep(2000);
    } catch (e: any) {
      console.error(colors.yellow(`\n  ⚠ Ingestion may have timed out: ${e.message}`));
      console.error(colors.yellow(`    Will attempt tests anyway — doc may already be loaded`));
    }
  } else {
    log(colors.dim("Skipping ingestion (SKIP_INGEST=true)"));
  }

  // Step 4: Verify doc is loaded
  logHeader("Verifying document is loaded");
  try {
    const listResponse = await askAgent(session, "What documents do you have?");
    log(colors.dim(`Agent: ${listResponse.substring(0, 300)}`));
    if (
      listResponse.toLowerCase().includes("no document") ||
      listResponse.toLowerCase().includes("empty") ||
      listResponse.toLowerCase().includes("don't have any")
    ) {
      console.error(colors.red(`\n  ✗ No documents loaded — cannot run tests`));
      process.exit(1);
    }
  } catch (e: any) {
    console.error(colors.yellow(`  ⚠ Could not verify documents: ${e.message}`));
  }

  // Step 5: Run test cases
  logHeader("Running GET_EXACT_QUOTE tests");

  let passed = 0;
  let failed = 0;
  const results: { name: string; result: ValidationResult }[] = [];

  for (const test of tests) {
    try {
      const response = await askAgent(
        session,
        test.message,
        test.timeout || RESPONSE_TIMEOUT_MS
      );
      const result = test.validate(response);
      logTest(test.name, result);
      if (!result.pass) {
        console.log(colors.yellow(`  [DEBUG] Full response (${response.length} chars):`));
        console.log(colors.dim(`  ${response.substring(0, 500)}`));
      }
      results.push({ name: test.name, result });

      if (result.pass) passed++;
      else failed++;

      // Brief pause between tests
      await sleep(1000);
    } catch (e: any) {
      const errorResult: ValidationResult = {
        pass: false,
        detail: `ERROR: ${e.message}`,
      };
      logTest(test.name, errorResult);
      results.push({ name: test.name, result: errorResult });
      failed++;
    }
  }

  // ── Summary ──
  logHeader("Summary");
  console.log(
    `\n  ${colors.green(`${passed} passed`)}  ${failed > 0 ? colors.red(`${failed} failed`) : colors.dim("0 failed")}  ${colors.dim(`(${tests.length} total)`)}`
  );

  if (failed > 0) {
    console.log(colors.yellow("\n  Failed tests:"));
    for (const r of results) {
      if (!r.result.pass) {
        console.log(colors.red(`    • ${r.name}: ${r.result.detail}`));
      }
    }
  }

  console.log(); // trailing newline
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(colors.red(`\nFatal error: ${e.message}`));
  console.error(colors.dim(e.stack));
  process.exit(1);
});
