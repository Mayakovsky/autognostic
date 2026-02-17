---
description: Run full build and test suite, report pass/fail summary
allowed-tools: Bash(bun:*), Bash(npx:*), Read
---

Run the full build and test pipeline for plugin-autognostic. Report results concisely.

## Steps

1. Run `bun run build` from the plugin root directory
   - If errors: list each error with file and line number
   - If clean: report "Build: PASS (0 errors)"

2. Run `npx vitest run` from the plugin root directory
   - Report: total tests, passed, failed, skipped, test files count
   - If any failures: list each failed test name and the assertion that failed
   - If clean: report "Tests: PASS (N/N)"

3. Summary — output exactly this format:
```
BUILD CHECK — plugin-autognostic
================================
Build:  PASS | FAIL (N errors)
Tests:  PASS (N/N) | FAIL (N passed, N failed)
Status: ALL GREEN | NEEDS ATTENTION
```

4. If everything passes, say "Ready to commit." and nothing else after the summary.
   If anything fails, list the specific fixes needed — file, line, what to change.

Do NOT fix anything automatically. This is a read-only check. Report only.
