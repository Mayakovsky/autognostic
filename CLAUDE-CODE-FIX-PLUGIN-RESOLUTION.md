# Claude Code CLI - Fix Plugin Resolution

> **Problem:** Agent cannot find `@elizaos/plugin-autognostic` module
> **Cause:** `package.json` points to GitHub repo instead of local workspace package
> **Solution:** Configure Bun workspace to use local package

---

## Autonomous Permissions

You have permission to:
- Modify `package.json` 
- Modify `bunfig.toml`
- Run `bun install`

---

## Step 1: Update bunfig.toml for Workspace

Edit `C:\Users\kidco\dev\eliza\autognostic-agent\bunfig.toml`:

**Add at the top of the file:**

```toml
[workspace]
packages = ["packages/*"]
```

The full file should look like:

```toml
[workspace]
packages = ["packages/*"]

[test]
timeout = 60000
coverage = true

[test.env]
NODE_ENV = "test"

coverage-exclude = [
  "**/dist/**",
  "**/build/**",
  "**/chunk-*.js",
  "**/*.chunk.js",
  "**/node_modules/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/coverage/**",
  "**/.turbo/**",
]
```

---

## Step 2: Update package.json Dependency

Edit `C:\Users\kidco\dev\eliza\autognostic-agent\package.json`:

**Change this line in dependencies:**

```json
"@elizaos/plugin-autognostic": "github:Mayakovsky/autognostic",
```

**To:**

```json
"@elizaos/plugin-autognostic": "workspace:*",
```

---

## Step 3: Ensure Plugin is Built

```bash
# Navigate to plugin directory
cd C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic

# Build the plugin
bun run build

# Verify dist exists
ls dist/
# Should see: index.js, index.d.ts, and subdirectories
```

---

## Step 4: Reinstall Dependencies

```bash
# Navigate to agent root
cd C:\Users\kidco\dev\eliza\autognostic-agent

# Clean and reinstall
rm -rf node_modules
rm -f bun.lock
bun install
```

---

## Step 5: Verify Resolution

```bash
# Check that bun recognizes the workspace package
bun pm ls @elizaos/plugin-autognostic

# Expected output should show it pointing to packages/plugin-autognostic
```

---

## Step 6: Fix Data Directory Path (Optional)

The startup log showed database path pointing to `datamirror-agent` instead of `autognostic-agent`.

Check `.env` file:

```bash
cat .env | grep -i eliza
cat .env | grep -i data
```

If you see a path with `datamirror`, update it to `autognostic-agent`.

---

## Step 7: Start the Server

```bash
cd C:\Users\kidco\dev\eliza\autognostic-agent
elizaos dev
```

---

## Expected Result

On successful startup, you should see:

```
Info       [CLI] Loading project agents (command=start)
```

**Without** these errors:
- ~~`Cannot find module '@elizaos/plugin-autognostic'`~~
- ~~`Failed to import project`~~

And you should see plugin initialization:
```
[autognostic] Initializing plugin...
[autognostic] Found X taxonomy nodes, Y vocabulary terms
```

---

## Troubleshooting

### If plugin still not found after workspace setup:

Try explicit path in `src/index.ts` as fallback:

```typescript
// Change this:
import autognosticPlugin from "@elizaos/plugin-autognostic";

// To this:
import { autognosticPlugin } from "../packages/plugin-autognostic/dist/index.js";
```

### If TypeScript complains about import:

Add path mapping to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@elizaos/plugin-autognostic": ["./packages/plugin-autognostic/src/index.ts"]
    }
  }
}
```

---

## Verification Checklist

- [ ] `bunfig.toml` has `[workspace]` section
- [ ] `package.json` uses `"workspace:*"` for plugin
- [ ] Plugin `dist/` directory exists with built files
- [ ] `bun install` completes without errors
- [ ] `elizaos dev` starts without "module not found" errors
- [ ] `[autognostic] Initializing plugin...` appears in logs

---

*End of Fix Instructions*
