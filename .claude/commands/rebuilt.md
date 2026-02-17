---
description: Rebuild agent repo, wipe database, restart server
allowed-tools: Bash(bun:*), Bash(npx:*), Bash(elizaos:*), Bash(Remove-Item:*), Bash(cd:*), Bash(powershell:*)
---

Full agent rebuild cycle: install deps, build, wipe PGlite database, restart.

## Steps

1. First rebuild the plugin (dependency):
   ```
   cd C:\Users\kidco\dev\eliza\plugin-autognostic
   bun run build
   ```
   - If plugin build fails: report errors and STOP

2. Then rebuild the agent:
   ```
   cd C:\Users\kidco\dev\eliza\autognostic-agent
   bun install
   bun run build
   ```
   - If agent build fails: report errors and STOP

3. Wipe the PGlite database for a clean slate:
   ```
   cd C:\Users\kidco\dev\eliza\autognostic-agent
   Remove-Item -Recurse -Force .\.eliza
   ```

4. Start the agent:
   ```
   cd C:\Users\kidco\dev\eliza\autognostic-agent
   elizaos dev
   ```

5. Report:
```
REBUILT — autognostic-agent
============================
Plugin build: PASS | FAIL
Agent build:  PASS | FAIL
Database:     WIPED
Server:       RUNNING on http://localhost:3000
```

If any step fails, STOP and report which step failed and why. Do NOT continue past a failed build.
