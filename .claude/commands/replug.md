---
description: Rebuild plugin, run build and full test suite
allowed-tools: Bash(bun:*), Bash(npx:*)
---

Rebuild and test the plugin-autognostic package. Run from the plugin root directory.

## Steps

1. Run `bun run build` from C:\Users\kidco\dev\eliza\plugin-autognostic
   - If errors: list each error with file and line number, then STOP
   - If clean: continue

2. Run `npx vitest run` from the same directory
   - Report: total tests, passed, failed, test files count
   - If failures: list each failed test name and assertion

3. Summary:
```
REPLUG — plugin-autognostic
============================
Build:  PASS | FAIL (N errors)
Tests:  PASS (N/N) | FAIL (N passed, N failed)
```

Do NOT fix anything. Report only.
