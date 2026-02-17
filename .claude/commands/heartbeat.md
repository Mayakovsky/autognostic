---
description: Update heartbeat.md based on current build, test, and project state
allowed-tools: Bash(bun:*), Bash(npx:*), Bash(git:*), Read, Write
---

Update heartbeat.md to reflect the current state of the project. This is a status sync, not a planning session.

## Steps

1. Read the current heartbeat.md thoroughly

2. Run `bun run build` — record pass/fail and error count

3. Run `npx vitest run` — record total tests, pass count, fail count, test file count

4. Run `git log --oneline -5` — get the latest 5 commits for the session log

5. Update heartbeat.md with the following changes:
   - Update the timestamp line to now (local time, format: YYYY-MM-DD HH:MM)
   - Update "Updated by" to your session identity
   - **What Works section:** If build and tests pass, update the verified dates. Add any new verified capabilities that were not previously listed. Do NOT remove existing verified items unless they are genuinely broken now.
   - **What's Broken section:** If any tests fail, add them here with the test name and assertion. If a previously broken item now passes, move it to What Works with a strikethrough note showing it was fixed and the date.
   - **Session Log table:** Add a new row at the top with today's date, agent name, a short description of what changed, and the latest commit hash. Keep only the 5 most recent entries.
   - **Next Actions:** Reorder based on what makes sense given current state. Check off completed items. Add new items if the build/test results reveal new work.

6. After writing the updated heartbeat.md, show a brief diff summary of what changed.

## Rules
- Do NOT change the Focus section unless explicitly asked
- Do NOT change the Guardrails section
- Do NOT change the Quick Commands section
- Keep the same markdown structure and formatting
- If build or tests fail, do NOT mark them as passing — be honest
- Timestamp must reflect actual current time, not a guess
