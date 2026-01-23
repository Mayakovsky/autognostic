import { vi } from "vitest";

// Mock @elizaos/core
vi.mock("@elizaos/core", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Global test utilities
export function createMockRuntime(overrides: Record<string, any> = {}) {
  return {
    agentId: "test-agent-id",
    getSetting: vi.fn().mockReturnValue(undefined),
    getService: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

export function createMockHttpService(responses: Record<string, string> = {}) {
  return {
    getText: vi.fn().mockImplementation(async (url: string) => {
      if (responses[url]) {
        return responses[url];
      }
      throw new Error(`No mock response for ${url}`);
    }),
    get: vi.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        headers: new Map([
          ["content-length", "1000"],
          ["content-type", "text/html"],
        ]),
      };
    }),
    head: vi.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        headers: new Map([
          ["content-length", "1000"],
          ["content-type", "text/html"],
        ]),
      };
    }),
  };
}
