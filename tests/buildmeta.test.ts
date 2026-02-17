import { describe, it, expect } from "vitest";
import { BUILD_META } from "../src/config/buildmeta";

describe("BUILD_META", () => {
  it("should have the expected shape", () => {
    expect(BUILD_META).toHaveProperty("phase");
    expect(BUILD_META).toHaveProperty("builtAt");
    expect(BUILD_META).toHaveProperty("version");
    expect(typeof BUILD_META.phase).toBe("string");
    expect(typeof BUILD_META.builtAt).toBe("string");
    expect(typeof BUILD_META.version).toBe("string");
  });

  it("should have phase 3", () => {
    expect(BUILD_META.phase).toBe("3");
  });
});
