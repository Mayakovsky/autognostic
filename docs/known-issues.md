# Known Issues — plugin-autognostic

## ISSUE-001: Action handlers must call callback() before returning
**Status:** Workaround available
**Symptom:** Infinite loop / "cyclic structures" error during JSON serialization when an action handler returns without calling `callback()`.
**Repro:** Remove the `callback()` call from any action handler, trigger the action via agent conversation.
**Root cause:** ElizaOS core falls back to `sendMessage` on the message bus when `callback()` is not called. The message bus serialization encounters cyclic structures from Drizzle query result objects.
**Workaround:** Always call `if (callback) await callback({ text, action: "ACTION_NAME" });` before every `return` statement in action handlers.
**Fix:** Requires ElizaOS core to add serialization safety to the sendMessage fallback path. Not under this plugin's control.

## ISSUE-002: Spreading opaque objects into ActionResult.data
**Status:** Resolved (2025-02-04)
**Symptom:** Same cyclic serialization crash as ISSUE-001, but triggered by `return { success: true, data: { ...result } }` where `result` contains Drizzle query internals.
**Root cause:** Drizzle query results contain non-serializable internal references when spread.
**Fix:** Added `safeSerialize` utility (commit 37bb493). All action handlers now destructure results to explicit primitive fields. See [DEC-005](./decisions.md#dec-005).

## ISSUE-003: LLM hallucinating nonexistent actions
**Status:** Open
**Symptom:** `[Error] Action not found` in dev server logs when the agent attempts to call actions that don't exist in the plugin.
**Repro:** Run the dev server and have a conversation that touches knowledge management topics.
**Root cause:** The LLM sometimes generates action names that don't match any registered action (e.g., `SEARCH_KNOWLEDGE` instead of `LIST_DOCUMENTS`).
**Workaround:** Improve action descriptions and validate patterns. No complete fix possible — this is inherent to LLM-driven action selection.
**Fix:** Ongoing — better action naming and description tuning.
