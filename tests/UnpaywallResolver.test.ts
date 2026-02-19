import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveOpenAccess, extractDoiFromUrl } from "../src/services/UnpaywallResolver";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("UnpaywallResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("resolveOpenAccess", () => {
    it("should return pdfUrl from best_oa_location", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          doi: "10.1234/test.5678",
          oa_status: "gold",
          best_oa_location: {
            url_for_pdf: "https://example.com/paper.pdf",
            host_type: "publisher",
            version: "publishedVersion",
          },
          oa_locations: [
            { url_for_pdf: "https://example.com/paper.pdf" },
          ],
        }),
      });

      const result = await resolveOpenAccess("10.1234/test.5678");

      expect(result).not.toBeNull();
      expect(result!.pdfUrl).toBe("https://example.com/paper.pdf");
      expect(result!.oaStatus).toBe("gold");
      expect(result!.host).toBe("publisher");
      expect(result!.version).toBe("publishedVersion");

      // Verify the API was called with correct URL
      expect(mockFetch).toHaveBeenCalledOnce();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("10.1234%2Ftest.5678");
      expect(callUrl).toContain("email=");
    });

    it("should return null when DOI not found (404)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await resolveOpenAccess("10.1234/nonexistent");
      expect(result).toBeNull();
    });

    it("should return null on network timeout", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const result = await resolveOpenAccess("10.1234/timeout");
      expect(result).toBeNull();
    });

    it("should use UNPAYWALL_EMAIL env var when set", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "test@example.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          best_oa_location: {
            url_for_pdf: "https://example.com/paper.pdf",
            host_type: "repository",
            version: "acceptedVersion",
          },
          oa_status: "green",
        }),
      });

      await resolveOpenAccess("10.1234/test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("email=test%40example.com");
    });

    it("should fall back to CROSSREF_MAILTO when UNPAYWALL_EMAIL not set", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "");
      vi.stubEnv("CROSSREF_MAILTO", "crossref@example.com");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          best_oa_location: {
            url_for_pdf: "https://example.com/paper.pdf",
            host_type: "repository",
            version: "submittedVersion",
          },
          oa_status: "green",
        }),
      });

      await resolveOpenAccess("10.1234/test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("email=crossref%40example.com");
    });

    it("should use fallback email when no env vars set", async () => {
      vi.stubEnv("UNPAYWALL_EMAIL", "");
      vi.stubEnv("CROSSREF_MAILTO", "");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          best_oa_location: null,
          oa_status: "closed",
        }),
      });

      await resolveOpenAccess("10.1234/test");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("email=autognostic-plugin%40users.noreply.github.com");
    });

    it("should return null when best_oa_location is null", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          doi: "10.1234/closed",
          oa_status: "closed",
          best_oa_location: null,
          oa_locations: [],
        }),
      });

      const result = await resolveOpenAccess("10.1234/closed");
      expect(result).toBeNull();
    });

    it("should return null when best_oa_location has no url_for_pdf", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          doi: "10.1234/nopdf",
          oa_status: "gold",
          best_oa_location: {
            url: "https://example.com/abstract",
            url_for_pdf: null,
            host_type: "publisher",
          },
        }),
      });

      const result = await resolveOpenAccess("10.1234/nopdf");
      expect(result).toBeNull();
    });

    it("should return null when rate limited (429)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await resolveOpenAccess("10.1234/ratelimit");
      expect(result).toBeNull();
    });

    it("should return null on server error (500)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await resolveOpenAccess("10.1234/servererror");
      expect(result).toBeNull();
    });
  });

  describe("extractDoiFromUrl", () => {
    it("should extract DOI from doi.org URL", () => {
      expect(extractDoiFromUrl("https://doi.org/10.1234/test.5678")).toBe("10.1234/test.5678");
    });

    it("should extract DOI from dx.doi.org URL", () => {
      expect(extractDoiFromUrl("https://dx.doi.org/10.1038/nature12373")).toBe("10.1038/nature12373");
    });

    it("should extract DOI from publisher URL path", () => {
      expect(extractDoiFromUrl("https://link.springer.com/article/10.1007/s00521-020-05678-4")).toBe("10.1007/s00521-020-05678-4");
    });

    it("should extract DOI from Wiley URL", () => {
      expect(extractDoiFromUrl("https://onlinelibrary.wiley.com/doi/10.1002/adma.202100123")).toBe("10.1002/adma.202100123");
    });

    it("should strip trailing punctuation from DOI", () => {
      expect(extractDoiFromUrl("https://doi.org/10.1234/test.5678.")).toBe("10.1234/test.5678");
    });

    it("should return null for non-DOI URLs", () => {
      expect(extractDoiFromUrl("https://arxiv.org/abs/2301.00001")).toBeNull();
    });

    it("should return null for URLs without DOI patterns", () => {
      expect(extractDoiFromUrl("https://example.com/article/12345")).toBeNull();
    });

    it("should handle DOI with query parameters", () => {
      expect(extractDoiFromUrl("https://doi.org/10.1234/test?source=web")).toBe("10.1234/test");
    });
  });
});
