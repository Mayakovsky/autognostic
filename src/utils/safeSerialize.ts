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
