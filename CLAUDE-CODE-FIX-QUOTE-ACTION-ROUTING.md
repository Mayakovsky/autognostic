# CLI Task: Fix GET_EXACT_QUOTE Action Routing

> **Priority:** P0 — Blocks field testing
> **Scope:** 2 files modified, 1 file created
> **Risk:** Low — No schema/DB changes, no new dependencies
> **Estimated test impact:** Existing 91 tests unaffected; add ≥6 new test cases

---

## Problem Summary

During live field testing (2026-02-08), two runtime failures were observed:

1. **SEND_MESSAGE collision** — User says "repeat the last line" or "read me what it says". The bootstrap `SEND_MESSAGE` action wins because `GET_EXACT_QUOTE.validate` has a narrow regex that misses natural phrasing. The agent tries to send a message to a nonexistent user instead of retrieving a quote.

2. **Wrong line returned** — When `GET_EXACT_QUOTE` does NOT fire, the `fullDocumentProvider` (position: -10) still injects document text into context. The LLM sees the text and hallucinate-picks the wrong lines instead of using the programmatic `getLineContent()` function.

Both issues stem from the same root: **the action doesn't match broadly enough, so it loses the routing contest**.

---

## Task 1: Widen `GetQuoteAction.validate` regex

**File:** `src/actions/getQuoteAction.ts`

**Current (line ~28):**
```typescript
return /\b(quote|line\s+\d|exact|verbatim)/i.test(text);
```

**Replace with:**
```typescript
return /\b(quote|line\s+\d+|exact|verbatim|repeat.*(?:line|sentence|paragraph|word)|read\s+(?:me\s+)?(?:the\s+)?(?:line|back|from|what)|(?:first|last|next|previous)\s+(?:line|sentence|paragraph|word)|what\s+does\s+(?:it|the\s+\w+)\s+say|recite|word\s+for\s+word|copy\s+(?:the\s+)?(?:text|line|content))/i.test(text);
```

**Rationale:** Catches natural language like "repeat the last line", "read me what it says", "first 3 words", "copy the text from", etc.

---

## Task 2: Update `GetQuoteAction.description` with negative examples

**File:** `src/actions/getQuoteAction.ts`

**Current:**
```typescript
description: "Retrieve exact quotes or line content from a stored document. No auth required.",
```

**Replace with:**
```typescript
description:
  "Retrieve exact quotes, lines, or text content from a stored knowledge document. No auth required. " +
  "Use this when the user asks to repeat, read, quote, or retrieve specific text from a document in the knowledge base. " +
  "This is NOT for sending messages to other users. This is NOT for composing new text. " +
  "This retrieves EXISTING stored document content only.",
```

---

## Task 3: Add URL extraction fallback + natural language line resolution in handler

**File:** `src/actions/getQuoteAction.ts`

The handler currently reads `args.url` from structured parameters, but the LLM often fails to populate these. Add fallback extraction from the raw message text, and add "last line" / "first line" resolution.

**Replace the entire `handler` method with:**

```typescript
async handler(
  runtime: IAgentRuntime,
  _message: Memory,
  _state: State | undefined,
  _options: HandlerOptions | undefined,
  callback: HandlerCallback | undefined
): Promise<ActionResult> {
  const args = (_message.content as Record<string, unknown>) || {};
  const messageText = ((_message.content as Content)?.text || "").toLowerCase();

  // --- URL resolution: structured args first, then extract from text ---
  let url = args.url as string | undefined;
  if (!url) {
    const urlMatch = messageText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
    if (urlMatch) url = urlMatch[0];
  }

  // --- Mode inference from natural language ---
  let mode = (args.mode as string) || "";
  let lineNumber = args.lineNumber as number | undefined;
  let searchText = args.searchText as string | undefined;

  if (!mode) {
    if (/\b(?:full|entire|whole|all)\b/.test(messageText)) {
      mode = "full";
    } else if (lineNumber || /\bline\s+\d+/i.test(messageText)) {
      mode = "line";
      if (!lineNumber) {
        const lineMatch = messageText.match(/line\s+(\d+)/i);
        if (lineMatch) lineNumber = parseInt(lineMatch[1], 10);
      }
    } else if (/\b(?:last|final|ending)\s+(?:line|sentence|word)/i.test(messageText)) {
      mode = "last";
    } else if (/\b(?:first|opening|beginning|starting)\s+(?:line|sentence|word)/i.test(messageText)) {
      mode = "line";
      lineNumber = 1;
    } else if (searchText) {
      mode = "search";
    } else {
      // Default: if no clear mode, try to find any quoted search text
      const quotedMatch = messageText.match(/["']([^"']+)["']/);
      if (quotedMatch) {
        searchText = quotedMatch[1];
        mode = "search";
      }
    }
  }

  // --- If still no URL, try most recent document ---
  if (!url) {
    try {
      const { getDb } = await import("../db/getDb");
      const { autognosticDocuments } = await import("../db/schema");
      const { desc } = await import("drizzle-orm");
      const db = await getDb(runtime);
      const recent = await db
        .select({ url: autognosticDocuments.url })
        .from(autognosticDocuments)
        .orderBy(desc(autognosticDocuments.createdAt))
        .limit(1);
      if (recent.length > 0) url = recent[0].url;
    } catch {
      // Fall through
    }
  }

  if (!url) {
    const text = "No document URL found. Specify which document to quote from, or add a document first.";
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: false, text, data: safeSerialize({ error: "no_url" }) };
  }

  // --- FULL mode ---
  if (mode === "full") {
    const content = await getFullDocument(runtime, url);
    if (!content) {
      const text = `Document not found: ${url}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: false, text, data: safeSerialize({ error: "not_found" }) };
    }
    const text = `Full document (${content.length} chars):\n\n${content.slice(0, 5000)}${content.length > 5000 ? "\n...[truncated]" : ""}`;
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: true, text, data: safeSerialize({ url, charCount: content.length }) };
  }

  // --- LAST line/sentence mode ---
  if (mode === "last") {
    const content = await getFullDocument(runtime, url);
    if (!content) {
      const text = `Document not found: ${url}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: false, text, data: safeSerialize({ error: "not_found" }) };
    }
    const lines = content.split("\n").filter(l => l.trim().length > 0);
    const lastLine = lines[lines.length - 1];
    const lastLineNumber = content.split("\n").length;
    const text = `Last line (line ${lastLineNumber}): "${lastLine}"`;
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return {
      success: true,
      text,
      data: safeSerialize({ url, lineNumber: lastLineNumber, content: lastLine }),
    };
  }

  // --- LINE mode ---
  if (mode === "line" && lineNumber) {
    const line = await getLineContent(runtime, url, lineNumber);
    if (line === null) {
      const text = `Line ${lineNumber} not found in ${url}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: false, text, data: safeSerialize({ error: "not_found" }) };
    }
    const text = `Line ${lineNumber}: "${line}"`;
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: true, text, data: safeSerialize({ url, lineNumber, content: line }) };
  }

  // --- SEARCH mode ---
  if (searchText) {
    const result = await getExactQuote(runtime, url, searchText);
    if (!result.found) {
      const text = `Text not found in ${url}`;
      if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
      return { success: false, text, data: safeSerialize({ error: "not_found" }) };
    }
    const text = `Found at line ${result.lineNumber}:\n"${result.quote}"\n\nContext: ...${result.context}...`;
    if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
    return { success: true, text, data: safeSerialize(result as unknown as Record<string, unknown>) };
  }

  const text = "Specify what to retrieve: a line number, search text in quotes, 'last line', or 'full' document.";
  if (callback) await callback({ text, action: "GET_EXACT_QUOTE" });
  return { success: false, text, data: safeSerialize({ error: "invalid_params" }) };
},
```

---

## Task 4: Add similes to improve LLM action routing

**File:** `src/actions/getQuoteAction.ts`

**Current:**
```typescript
similes: ["QUOTE_FROM", "GET_LINE", "EXACT_QUOTE"],
```

**Replace with:**
```typescript
similes: [
  "QUOTE_FROM",
  "GET_LINE",
  "EXACT_QUOTE",
  "READ_LINE",
  "READ_DOCUMENT",
  "REPEAT_LINE",
  "REPEAT_TEXT",
  "SHOW_LINE",
  "RETRIEVE_TEXT",
  "GET_CONTENT",
  "LAST_LINE",
  "FIRST_LINE",
],
```

---

## Task 5: Guard provider against action routing conflict

**File:** `src/providers/fullDocumentProvider.ts`

The provider should include a stronger hint that the agent must use the GET_EXACT_QUOTE action rather than extracting content from provider context.

**Find this block in the `IMPORTANT INSTRUCTIONS` section:**
```
- You MUST quote ONLY from the document text provided below
```

**Add immediately after it:**
```
- To retrieve specific lines or quotes, use the GET_EXACT_QUOTE action — do NOT extract lines yourself from this context
- If the user asks for "line N", "last line", "first line", or similar, ALWAYS call GET_EXACT_QUOTE
```

---

## Task 6: Add test cases

**File:** `tests/getQuoteAction.test.ts` (create new)

Test cases to add:

1. `validate` matches "repeat the last line" → `true`
2. `validate` matches "read me line 5" → `true`
3. `validate` matches "what does it say" → `true`
4. `validate` does NOT match "send a message to Bob" → `false`
5. `validate` does NOT match "hello how are you" → `false`
6. Handler resolves "last line" without explicit lineNumber param
7. Handler falls back to most recent document when no URL in message

---

## Verification

After applying all changes:

```bash
bun run build
npx vitest run
```

**Expected:** 0 build errors, 91+ existing tests pass, new tests pass.

---

## Files Changed

| File | Change Type |
|------|-------------|
| `src/actions/getQuoteAction.ts` | Modified — validate, description, similes, handler |
| `src/providers/fullDocumentProvider.ts` | Modified — add action-routing hint |
| `tests/getQuoteAction.test.ts` | Created — 7 test cases |

---

## Commit Message

```
fix(quote): widen GET_EXACT_QUOTE routing to prevent SEND_MESSAGE collision

- Broaden validate regex to match natural language (repeat, read, last line, etc.)
- Add negative examples to description to differentiate from SEND_MESSAGE
- Expand similes for better LLM action matching
- Add URL extraction fallback from message text when structured args missing
- Add "last line" / "first line" natural language resolution
- Add most-recent-document fallback when no URL mentioned
- Add provider hint to prefer action over context extraction
- Add 7 test cases for new routing behavior

Fixes: SEND_MESSAGE collision and wrong-line-selection during field testing
```

---

*Handoff document for Claude Code CLI — 2026-02-09*
