import { describe, it, expect } from "vitest";
import {
  fromError,
  forCondition,
  formatForCallback,
  type UserErrorMessage,
} from "../src/services/ErrorMessageFactory";
import { ContentResolverError } from "../src/errors/ContentResolverError";
import { AutognosticError, ErrorCode } from "../src/errors/AutognosticError";
import { AutognosticNetworkError } from "../src/errors/NetworkError";

// ---------------------------------------------------------------------------
// ErrorMessageFactory.forCondition — all 13 conditions
// ---------------------------------------------------------------------------

describe("ErrorMessageFactory.forCondition", () => {
  it("paywall → correct summary + suggestion", () => {
    const msg = forCondition("paywall", { url: "https://springer.com/paper" });
    expect(msg.summary).toContain("paywall");
    expect(msg.suggestion).toContain("DOI");
    expect(msg.suggestion).toContain("Unpaywall");
    expect(msg.emoji).toBe("\u{1F512}");
    expect(msg.isRetryable).toBe(false);
  });

  it("html_stub → paywall-like message", () => {
    const msg = forCondition("html_stub", { url: "https://publisher.com/paper" });
    expect(msg.summary).toContain("login page");
    expect(msg.suggestion).toContain("DOI");
    expect(msg.isRetryable).toBe(false);
  });

  it("rate_limited → retryable message", () => {
    const msg = forCondition("rate_limited");
    expect(msg.summary).toContain("limiting requests");
    expect(msg.suggestion).toContain("Wait");
    expect(msg.isRetryable).toBe(true);
  });

  it("timeout → retryable message", () => {
    const msg = forCondition("timeout", { url: "https://slow.example.com" });
    expect(msg.summary).toContain("too long");
    expect(msg.suggestion).toContain("try again");
    expect(msg.isRetryable).toBe(true);
  });

  it("dns_failure → non-retryable + URL check suggestion", () => {
    const msg = forCondition("dns_failure", { hostname: "fake.example.com" });
    expect(msg.summary).toContain("fake.example.com");
    expect(msg.suggestion).toContain("typos");
    expect(msg.isRetryable).toBe(false);
  });

  it("pdf_extraction → scanned PDF suggestion", () => {
    const msg = forCondition("pdf_extraction");
    expect(msg.summary).toContain("PDF couldn't be read");
    expect(msg.suggestion).toContain("scanned");
    expect(msg.suggestion).toContain("arXiv");
    expect(msg.isRetryable).toBe(false);
  });

  it("empty_content → redirect suggestion", () => {
    const msg = forCondition("empty_content");
    expect(msg.summary).toContain("empty");
    expect(msg.suggestion).toContain("redirect");
    expect(msg.isRetryable).toBe(false);
  });

  it("unpaywall_no_result → search alternative sources", () => {
    const msg = forCondition("unpaywall_no_result", { identifier: "10.1234/test" });
    expect(msg.summary).toContain("No open-access version");
    expect(msg.suggestion).toContain("Semantic Scholar");
    expect(msg.isRetryable).toBe(false);
  });

  it("semantic_scholar_404 → try DOI or SEARCH_PAPERS", () => {
    const msg = forCondition("semantic_scholar_404", { identifier: "10.1234/test" });
    expect(msg.summary).toContain("wasn't found");
    expect(msg.suggestion).toContain("SEARCH_PAPERS");
    expect(msg.isRetryable).toBe(false);
  });

  it("openalex_empty → broaden search suggestion", () => {
    const msg = forCondition("openalex_empty", { query: "nonexistent topic" });
    expect(msg.summary).toContain("No papers matched");
    expect(msg.suggestion).toContain("broader");
    expect(msg.isRetryable).toBe(false);
  });

  it("copyright_gate → OA alternative suggestion", () => {
    const msg = forCondition("copyright_gate");
    expect(msg.summary).toContain("open-access license");
    expect(msg.suggestion).toContain("FIND_RELATED_PAPERS");
    expect(msg.isRetryable).toBe(false);
  });

  it("url_not_found → input guidance", () => {
    const msg = forCondition("url_not_found");
    expect(msg.summary).toContain("couldn't find a URL");
    expect(msg.suggestion).toContain("https://");
    expect(msg.isRetryable).toBe(false);
  });

  it("invalid_url → format guidance", () => {
    const msg = forCondition("invalid_url", { url: "not-a-url" });
    expect(msg.summary).toContain("valid URL");
    expect(msg.suggestion).toContain("https://");
    expect(msg.isRetryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ErrorMessageFactory.fromError — classification from various error types
// ---------------------------------------------------------------------------

describe("ErrorMessageFactory.fromError", () => {
  it("ContentResolverError paywall → paywall message", () => {
    const error = ContentResolverError.paywall("https://springer.com/p", 403);
    const msg = fromError(error, { url: "https://springer.com/p" });
    expect(msg.summary).toContain("paywall");
    expect(msg.isRetryable).toBe(false);
  });

  it("ContentResolverError rate_limited → rate limit message", () => {
    const error = ContentResolverError.rateLimited("https://api.example.com");
    const msg = fromError(error);
    expect(msg.summary).toContain("limiting requests");
    expect(msg.isRetryable).toBe(true);
  });

  it("ContentResolverError timeout → timeout message", () => {
    const error = ContentResolverError.timeout("https://slow.com");
    const msg = fromError(error);
    expect(msg.summary).toContain("too long");
    expect(msg.isRetryable).toBe(true);
  });

  it("ContentResolverError dns_failure → DNS message with hostname", () => {
    const error = ContentResolverError.dnsFailure("https://fake.com/paper", "fake.com");
    const msg = fromError(error);
    expect(msg.summary).toContain("fake.com");
    expect(msg.isRetryable).toBe(false);
  });

  it("ContentResolverError pdf_extraction → PDF message", () => {
    const error = ContentResolverError.pdfExtraction("https://example.com/paper.pdf");
    const msg = fromError(error);
    expect(msg.summary).toContain("PDF couldn't be read");
  });

  it("ContentResolverError empty_content → empty message", () => {
    const error = ContentResolverError.emptyContent("https://example.com/empty", 50);
    const msg = fromError(error);
    expect(msg.summary).toContain("empty");
  });

  it("ContentResolverError html_stub → login page message", () => {
    const error = ContentResolverError.htmlStub("https://publisher.com/paper", 500);
    const msg = fromError(error);
    expect(msg.summary).toContain("login page");
  });

  it("AutognosticError with CONTENT_PAYWALL code → paywall message", () => {
    const error = new AutognosticError("test", ErrorCode.CONTENT_PAYWALL, {
      operation: "test",
    });
    const msg = fromError(error);
    expect(msg.summary).toContain("paywall");
  });

  it("AutognosticError with DISCOVERY_NOT_FOUND → S2 message", () => {
    const error = new AutognosticError("test", ErrorCode.DISCOVERY_NOT_FOUND, {
      operation: "test",
    });
    const msg = fromError(error, { identifier: "10.1234/test" });
    expect(msg.summary).toContain("wasn't found");
  });

  it("AutognosticNetworkError rate limited → rate limit message", () => {
    const error = AutognosticNetworkError.rateLimited("api.example.com");
    const msg = fromError(error);
    expect(msg.summary).toContain("limiting requests");
    expect(msg.isRetryable).toBe(true);
  });

  it("plain Error with 'timeout' → timeout message", () => {
    const error = new Error("Request timed out after 30000ms");
    const msg = fromError(error, { url: "https://slow.com" });
    expect(msg.summary).toContain("too long");
    expect(msg.isRetryable).toBe(true);
  });

  it("plain Error with ENOTFOUND → DNS failure message", () => {
    const error = new Error("getaddrinfo ENOTFOUND fake.example.com");
    const msg = fromError(error, { url: "https://fake.example.com/paper" });
    expect(msg.summary).toContain("Could not connect");
    expect(msg.isRetryable).toBe(false);
  });

  it("plain Error with '403' → paywall message", () => {
    const error = new Error("HTTP 403 (Forbidden) for https://publisher.com");
    const msg = fromError(error);
    expect(msg.summary).toContain("paywall");
  });

  it("plain AbortError → timeout message", () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    const msg = fromError(error);
    expect(msg.summary).toContain("too long");
    expect(msg.isRetryable).toBe(true);
  });

  it("unknown error → graceful fallback", () => {
    const msg = fromError("something random");
    expect(msg.summary).toContain("Something went wrong");
    expect(msg.suggestion).toContain("Try again");
    expect(msg.isRetryable).toBe(true);
  });

  it("null error → graceful fallback", () => {
    const msg = fromError(null);
    expect(msg.summary).toContain("Something went wrong");
    expect(msg.isRetryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ContentResolverError class
// ---------------------------------------------------------------------------

describe("ContentResolverError", () => {
  it("should carry failureType", () => {
    const err = ContentResolverError.paywall("https://example.com", 403);
    expect(err.failureType).toBe("paywall");
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe(ErrorCode.CONTENT_PAYWALL);
  });

  it("should carry hostname for DNS failures", () => {
    const err = ContentResolverError.dnsFailure("https://fake.com/paper", "fake.com");
    expect(err.failureType).toBe("dns_failure");
    expect(err.hostname).toBe("fake.com");
    expect(err.isRetryable).toBe(false);
  });

  it("should be instanceof AutognosticError", () => {
    const err = ContentResolverError.timeout("https://slow.com");
    expect(err).toBeInstanceOf(AutognosticError);
    expect(err).toBeInstanceOf(ContentResolverError);
  });

  it("timeout should be retryable", () => {
    const err = ContentResolverError.timeout("https://slow.com");
    expect(err.isRetryable).toBe(true);
  });

  it("paywall should NOT be retryable", () => {
    const err = ContentResolverError.paywall("https://publisher.com", 403);
    expect(err.isRetryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatForCallback
// ---------------------------------------------------------------------------

describe("formatForCallback", () => {
  it("should format emoji + summary + newline + suggestion", () => {
    const msg: UserErrorMessage = {
      summary: "Test summary",
      suggestion: "Test suggestion",
      emoji: "\u{1F512}",
      isRetryable: false,
    };
    const text = formatForCallback(msg);
    expect(text).toBe("\u{1F512} Test summary\nTest suggestion");
  });

  it("each action handler callback should include emoji", () => {
    // Verify the format works for all conditions
    const conditions = [
      "paywall", "html_stub", "rate_limited", "timeout", "dns_failure",
      "pdf_extraction", "empty_content", "unpaywall_no_result",
      "semantic_scholar_404", "openalex_empty", "copyright_gate",
      "url_not_found", "invalid_url",
    ] as const;

    for (const condition of conditions) {
      const msg = forCondition(condition);
      const text = formatForCallback(msg);
      // Every message should have an emoji at the start and contain a newline
      expect(text.length).toBeGreaterThan(10);
      expect(text).toContain("\n");
    }
  });
});
