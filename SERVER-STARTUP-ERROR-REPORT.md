# ElizaOS Server Startup Error Report

**Date:** February 3, 2026
**Server Status:** Running on port 3000 (but without agents)

---

## Error Summary

The ElizaOS server starts but fails to load the project/agents due to a module initialization error.

## Error Messages

```
[Warn] Failed to import project: Cannot access 'autognosticPlugin' before initialization
[Error] Error loading project: Could not find project entry point
```

## Root Cause

**Circular dependency or module loading order issue** in the `@elizaos/plugin-autognostic` package.

When ElizaOS tries to import the agent's `src/index.ts`, it imports `autognosticPlugin` from `@elizaos/plugin-autognostic`. The error "Cannot access 'autognosticPlugin' before initialization" indicates that:

1. The plugin module is being accessed before its exports are fully initialized
2. This is typically caused by circular imports within the plugin's dependency chain
3. One of the plugin's internal imports likely references something that indirectly imports `autognosticPlugin` back

## Affected Files

| File | Role |
|------|------|
| `autognostic-agent/src/index.ts` | Imports `autognosticPlugin` |
| `plugin-autognostic/src/index.ts` | Exports `autognosticPlugin` |
| `plugin-autognostic/src/schema.ts` | Imports from `./db/schema` |
| `plugin-autognostic/src/db/schema.ts` | May have circular references |

## Current State

- **Server:** Running on http://localhost:3000
- **Agents:** 0 loaded (agentCount=0)
- **Database:** Migrations completed successfully
- **Plugin schema:** Not registered (project failed to load)

## Recommended Fix

1. **Audit circular imports** in `plugin-autognostic/src/`:
   - Check if `db/schema.ts` imports anything from `index.ts`
   - Check if any action/service imports the plugin itself
   - Use a tool like `madge` to visualize circular dependencies

2. **Lazy initialization pattern:**
   ```typescript
   // Instead of:
   export const autognosticPlugin: Plugin = { ... }
   export default autognosticPlugin;

   // Consider:
   let _plugin: Plugin | null = null;
   export function getAutognosticPlugin(): Plugin {
     if (!_plugin) {
       _plugin = { ... };
     }
     return _plugin;
   }
   export default getAutognosticPlugin();
   ```

3. **Move schema export** to a separate entry point that doesn't depend on the plugin object.

## Quick Diagnostic Commands

```bash
# Check for circular dependencies
cd packages/plugin-autognostic
npx madge --circular src/index.ts

# Check import order
npx madge --image graph.png src/index.ts
```

---

**End of Report**
