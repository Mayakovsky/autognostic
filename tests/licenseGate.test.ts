import { describe, it, expect, vi, beforeEach } from "vitest";
import { AddUrlToKnowledgeAction } from "../src/actions/addUrlToKnowledgeAction";
import type { IAgentRuntime, Memory, Content, HandlerCallback } from "@elizaos/core";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockResolveOpenAccess = vi.fn();
const mockExtractDoiFromUrl = vi.fn();
const mockMirrorDocToKnowledge = vi.fn();
const mockStore = vi.fn();
const mockProcess = vi.fn();
const mockGetByUrl = vi.fn();
const mockMarkStaticContent = vi.fn();

vi.mock("../src/services/UnpaywallResolver", () => ({
  resolveOpenAccess: (...args: unknown[]) => mockResolveOpenAccess(...args),
  extractDoiFromUrl: (...args: unknown[]) => mockExtractDoiFromUrl(...args),
}));

vi.mock("../src/integration/mirrorDocToKnowledge", () => ({
  mirrorDocToKnowledge: (...args: unknown[]) => mockMirrorDocToKnowledge(...args),
}));

vi.mock("../src/db/autognosticDocumentsRepository", () => ({
  autognosticDocumentsRepository: {
    store: (...args: unknown[]) => mockStore(...args),
  },
  AutognosticDocumentsRepository: vi.fn().mockImplementation(() => ({
    getByUrl: (...args: unknown[]) => mockGetByUrl(...args),
  })),
}));

vi.mock("../src/db/autognosticSourcesRepository", () => ({
  AutognosticSourcesRepository: vi.fn().mockImplementation(() => ({
    markStaticContent: (...args: unknown[]) => mockMarkStaticContent(...args),
  })),
}));

vi.mock("../src/services/ScientificPaperDetector", () => ({
  getScientificPaperDetector: () => ({
    isLikelyScientificPaper: () => true,
  }),
}));

vi.mock("../src/services/ScientificPaperHandler", () => ({
  createScientificPaperHandler: () => ({
    process: (...args: unknown[]) => mockProcess(...args),
  }),
}));

vi.mock("../src/auth/validateToken", () => ({
  validateToken: () => ({ valid: true, authEnabled: false }),
  isAuthEnabled: () => false,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRuntime = {
  agentId: "test-agent-id",
  getService: () => null,
} as unknown as IAgentRuntime;

function makeMessage(text: string): Memory {
  return {
    content: { text } as Content,
  } as unknown as Memory;
}

const defaultPaperHandlerResult = {
  isScientificPaper: true,
  zone: "bronze",
  enrichedContent: "",
  classification: null,
  paperMetadata: { doi: "10.1234/test", title: "Test Paper" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("License Gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.mockResolvedValue(defaultPaperHandlerResult);
    mockGetByUrl.mockResolvedValue([{ id: "doc-1", content: "some content" }]);
    mockMarkStaticContent.mockResolvedValue(undefined);
    mockMirrorDocToKnowledge.mockResolvedValue({
      knowledgeDocumentId: "kd-1",
      clientDocumentId: "cd-1",
      worldId: "test-agent-id",
    });
  });

  // =========================================================================
  // Core gate behavior
  // =========================================================================

  it("should block full-text ingestion for closed-access DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/closed.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: null,
      oaStatus: "closed",
      host: "unknown",
      version: "unknown",
    });
    mockStore.mockResolvedValue([{ id: "stored-doc" }]);

    const callback = vi.fn();
    const result = await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/closed.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // Should NOT call mirrorDocToKnowledge
    expect(mockMirrorDocToKnowledge).not.toHaveBeenCalled();

    // Should store metadata-only record (empty content)
    expect(mockStore).toHaveBeenCalledOnce();
    const storedDoc = mockStore.mock.calls[0][1];
    expect(storedDoc.content).toBe("");
    expect(storedDoc.byteSize).toBe(0);
    expect(storedDoc.oaStatus).toBe("closed");

    // Should call callback
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].text).toContain("closed-access");
    expect(callback.mock.calls[0][0].text).toContain("metadata only");

    // Should return accessRestriction
    expect(result).toMatchObject({
      success: true,
    });
    const data = (result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.accessRestriction).toBe("metadata_only");
    expect(data.oaStatus).toBe("closed");
  });

  it("should allow full-text ingestion for gold OA DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/gold.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://example.com/gold.pdf",
      oaStatus: "gold",
      host: "publisher",
      version: "publishedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/gold.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // Should call mirrorDocToKnowledge (full ingestion)
    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    // oaStatus should be passed through
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBe("gold");
    // Should NOT call autognosticDocumentsRepository.store directly (mirror handles it)
    expect(mockStore).not.toHaveBeenCalled();
  });

  it("should allow full-text ingestion for green OA DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/green.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://arxiv.org/pdf/2401.12345.pdf",
      oaStatus: "green",
      host: "repository",
      version: "submittedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/green.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBe("green");
  });

  it("should allow full-text ingestion for bronze OA DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/bronze.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://publisher.com/bronze.pdf",
      oaStatus: "bronze",
      host: "publisher",
      version: "publishedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/bronze.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBe("bronze");
  });

  it("should allow full-text ingestion for hybrid OA DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/hybrid.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://publisher.com/hybrid.pdf",
      oaStatus: "hybrid",
      host: "publisher",
      version: "publishedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/hybrid.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBe("hybrid");
  });

  // =========================================================================
  // Permissive defaults
  // =========================================================================

  it("should allow full-text ingestion for URL without DOI", async () => {
    mockExtractDoiFromUrl.mockReturnValue(null);

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://example.com/docs/readme.md to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // No DOI → no Unpaywall call, full ingestion proceeds
    expect(mockResolveOpenAccess).not.toHaveBeenCalled();
    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBeUndefined();
  });

  it("should allow full-text ingestion when Unpaywall fails (returns null)", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/timeout.paper");
    mockResolveOpenAccess.mockResolvedValue(null);

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/timeout.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // Unpaywall failure → permissive default, full ingestion
    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBeUndefined();
  });

  it("should allow full-text for DOI with unknown OA status (no PDF)", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/unknown.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: null,
      oaStatus: "unknown",
      host: "unknown",
      version: "unknown",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/unknown.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // unknown status → permissive, full ingestion using original URL
    expect(mockMirrorDocToKnowledge).toHaveBeenCalledOnce();
    expect(mockMirrorDocToKnowledge.mock.calls[0][1].oaStatus).toBe("unknown");
  });

  // =========================================================================
  // oaStatus storage
  // =========================================================================

  it("should pass oaStatus through to mirrorDocToKnowledge for OA papers", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/gold.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://example.com/gold.pdf",
      oaStatus: "gold",
      host: "publisher",
      version: "publishedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/gold.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    const mirrorParams = mockMirrorDocToKnowledge.mock.calls[0][1];
    expect(mirrorParams.oaStatus).toBe("gold");
  });

  it("should store oaStatus=closed on metadata-only record", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/closed.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: null,
      oaStatus: "closed",
      host: "unknown",
      version: "unknown",
    });
    mockStore.mockResolvedValue([{ id: "stored-doc" }]);

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/closed.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    const storedDoc = mockStore.mock.calls[0][1];
    expect(storedDoc.oaStatus).toBe("closed");
  });

  // =========================================================================
  // Classification still runs for closed papers
  // =========================================================================

  it("should still run paper detection for closed-access papers", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/closed.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: null,
      oaStatus: "closed",
      host: "unknown",
      version: "unknown",
    });
    mockStore.mockResolvedValue([{ id: "stored-doc" }]);

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/closed.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // Paper handler should still be called (for classification)
    expect(mockProcess).toHaveBeenCalledOnce();
  });

  // =========================================================================
  // Response format
  // =========================================================================

  it("should include DOI in closed-access response", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/closed.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: null,
      oaStatus: "closed",
      host: "unknown",
      version: "unknown",
    });
    mockStore.mockResolvedValue([{ id: "stored-doc" }]);

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/closed.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    const callbackText = callback.mock.calls[0][0].text;
    expect(callbackText).toContain("10.1234/closed.paper");
    expect(callbackText).toContain("copyright");
  });

  it("should use OA-resolved URL for full ingestion, not original", async () => {
    mockExtractDoiFromUrl.mockReturnValue("10.1234/gold.paper");
    mockResolveOpenAccess.mockResolvedValue({
      pdfUrl: "https://oa-repo.com/paper.pdf",
      oaStatus: "gold",
      host: "repository",
      version: "publishedVersion",
    });

    const callback = vi.fn();
    await AddUrlToKnowledgeAction.handler(
      mockRuntime,
      makeMessage("Add https://doi.org/10.1234/gold.paper to knowledge"),
      undefined,
      undefined,
      callback as unknown as HandlerCallback,
    );

    // The ingestUrl should be the OA-resolved URL
    const mirrorParams = mockMirrorDocToKnowledge.mock.calls[0][1];
    expect(mirrorParams.url).toBe("https://oa-repo.com/paper.pdf");
  });
});
