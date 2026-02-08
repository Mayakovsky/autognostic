# Claude Code CLI - Complete Fix for Cyclic JSON Serialization

## Problem

Action handlers return `ActionResult.data` objects containing:
- Nested objects from database queries
- Date objects
- Potentially circular references

ElizaOS core tries to `JSON.stringify()` these, causing serialization failures.

---

## TASK 1: Create safeSerialize Utility

**Create file:** `src/utils/safeSerialize.ts`

```typescript
/**
 * Recursively sanitize an object to ensure JSON serializability.
 * - Converts Date to ISO string
 * - Converts UUID objects to strings  
 * - Removes functions and undefined values
 * - Breaks circular references
 */
export function safeSerialize<T>(obj: T, seen = new WeakSet()): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "function") {
    return undefined as unknown as T;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as unknown as T;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  // Circular reference check
  if (seen.has(obj as object)) {
    return "[Circular]" as unknown as T;
  }
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && typeof value !== "function") {
      result[key] = safeSerialize(value, seen);
    }
  }
  return result as T;
}
```

---

## TASK 2: Update Actions to Use safeSerialize

For each action file, add the import and wrap ALL `data:` objects in `safeSerialize()`.

### Pattern to Apply

```typescript
// Add import at top
import { safeSerialize } from "../utils/safeSerialize";

// Wrap every ActionResult.data object
return {
  success: true,
  text: "...",
  data: safeSerialize({
    // ... existing data fields
  }),
};
```

### Files to Update

1. `src/actions/addUrlToKnowledgeAction.ts` - 4 return statements with data
2. `src/actions/mirrorSourceToKnowledgeAction.ts` - 4 return statements with data
3. `src/actions/getQuoteAction.ts` - 5 return statements with data
4. `src/actions/listDocumentsAction.ts` - 2 return statements with data
5. `src/actions/listSourcesAction.ts` - 2 return statements with data
6. `src/actions/removeDocumentAction.ts` - 4 return statements with data
7. `src/actions/removeSourceAction.ts` - 4 return statements with data
8. `src/actions/refreshSourceAction.ts` - 4 return statements with data
9. `src/actions/setAutognosticRefreshPolicyAction.ts` - 2 return statements with data
10. `src/actions/setAutognosticSizePolicyAction.ts` - 2 return statements with data
11. `src/actions/setVersionTrackingAction.ts` - 5 return statements with data

---

## TASK 3: Specific Fix for addUrlToKnowledgeAction.ts

This is the most complex one. Here's the exact change needed:

**Add import at top:**
```typescript
import { safeSerialize } from "../utils/safeSerialize";
```

**Replace the success return block (around line 200):**

Find:
```typescript
if (callback) await callback({ text: responseText, action: "ADD_URL_TO_KNOWLEDGE" });
return {
  success: true,
  text: responseText,
  data: {
```

Replace the entire return statement with:
```typescript
if (callback) await callback({ text: responseText, action: "ADD_URL_TO_KNOWLEDGE" });
return {
  success: true,
  text: responseText,
  data: safeSerialize({
    url,
    filename,
    roomId,
    sourceId,
    versionId,
    authEnabled: isAuthEnabled(runtime),
    isScientificPaper: handlerResult.isScientificPaper,
    lakehouseZone: handlerResult.zone,
    classification: handlerResult.classification ? {
      primaryPath: handlerResult.classification.primaryPath,
      confidence: handlerResult.classification.confidence,
      focus: handlerResult.classification.focus,
    } : undefined,
    paperMetadata: handlerResult.paperMetadata ? {
      doi: handlerResult.paperMetadata.doi,
      title: handlerResult.paperMetadata.title,
      journal: handlerResult.paperMetadata.journal,
      authors: handlerResult.paperMetadata.authors,
    } : undefined,
    knowledgeDocumentId: result.knowledgeDocumentId,
    clientDocumentId: result.clientDocumentId,
    worldId: result.worldId,
  }),
};
```

**Also wrap the error return (around line 230):**

```typescript
return {
  success: false,
  text: errorText,
  data: safeSerialize({
    error: "ingestion_failed",
    code: wrappedError.code,
    details: wrappedError.message,
    isRetryable: wrappedError.isRetryable,
  }),
};
```

**And the auth error returns (around lines 95-115):**

```typescript
return {
  success: false,
  text,
  data: safeSerialize({
    error: "auth_required",
    authEnabled: true,
    needsToken: true,
  }),
};
```

---

## TASK 4: Quick Pattern for Simple Actions

For actions with simple data (listSourcesAction, removeDocumentAction, etc.), just add:

```typescript
import { safeSerialize } from "../utils/safeSerialize";
```

And wrap each `data: { ... }` with `data: safeSerialize({ ... })`.

---

## TASK 5: Verification

```bash
# Build
bun run build

# Test
bun run test

# Start dev
elizaos dev
```

Test with:
```
Add this URL to your knowledge: https://github.com/Mayakovsky/test_tube/blob/main/potato_chimpanzee_falafel_garb
```

---

## Summary

- Create 1 new file: `src/utils/safeSerialize.ts`
- Update 11 action files to import and use `safeSerialize()`
- Every `data:` field in every `return` statement must be wrapped
- Rebuild and test
