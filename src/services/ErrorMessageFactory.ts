/**
 * ErrorMessageFactory — maps error conditions to structured user-facing messages.
 *
 * Pure function library: error in, message out. No runtime, no database.
 */

import { ErrorCode, isAutognosticError } from "../errors/AutognosticError";
import { ContentResolverError, type ContentFailureType } from "../errors/ContentResolverError";

export interface UserErrorMessage {
  summary: string;
  suggestion: string;
  emoji: string;
  debugInfo?: string;
  isRetryable: boolean;
}

interface ErrorContext {
  url?: string;
  hostname?: string;
  identifier?: string;
  query?: string;
}

/**
 * Build a user-facing error message from any error + optional context.
 */
export function fromError(error: unknown, context: ErrorContext = {}): UserErrorMessage {
  // ContentResolverError carries failureType classification
  if (error instanceof ContentResolverError) {
    return fromContentFailure(error.failureType, error, context);
  }

  // AutognosticError — check error code
  if (isAutognosticError(error)) {
    return fromErrorCode(error.code, error.message, context);
  }

  // Plain Error — heuristic classification
  if (error instanceof Error) {
    return fromPlainError(error, context);
  }

  return genericFallback(typeof error === "string" ? error : undefined);
}

/**
 * Build message for specific named conditions (used directly by action handlers).
 */
export function forCondition(
  condition:
    | "paywall"
    | "html_stub"
    | "rate_limited"
    | "timeout"
    | "dns_failure"
    | "pdf_extraction"
    | "empty_content"
    | "unpaywall_no_result"
    | "semantic_scholar_404"
    | "openalex_empty"
    | "copyright_gate"
    | "url_not_found"
    | "invalid_url",
  context: ErrorContext = {}
): UserErrorMessage {
  switch (condition) {
    case "paywall":
      return {
        summary: "This paper appears to be behind a paywall",
        suggestion: "Try providing just the DOI — I can search for a free open-access version via Unpaywall",
        emoji: "\u{1F512}",
        debugInfo: context.url ? `Paywall detected at ${context.url}` : undefined,
        isRetryable: false,
      };

    case "html_stub":
      return {
        summary: "The publisher returned a login page instead of the paper",
        suggestion: "Try providing just the DOI — I can search for a free open-access version via Unpaywall",
        emoji: "\u{1F512}",
        debugInfo: context.url ? `HTML stub from ${context.url}` : undefined,
        isRetryable: false,
      };

    case "rate_limited":
      return {
        summary: "The source is temporarily limiting requests",
        suggestion: "Wait a minute and try again, or provide a direct PDF link if you have one",
        emoji: "\u{23F3}",
        debugInfo: context.url ? `429 from ${context.url}` : undefined,
        isRetryable: true,
      };

    case "timeout":
      return {
        summary: "The source took too long to respond",
        suggestion: "This might be a temporary issue — try again in a moment. If it persists, the server may be down",
        emoji: "\u{23F1}\u{FE0F}",
        debugInfo: context.url ? `Timeout for ${context.url}` : undefined,
        isRetryable: true,
      };

    case "dns_failure":
      return {
        summary: context.hostname
          ? `Could not connect to ${context.hostname}`
          : "Could not connect to the server",
        suggestion: "Check the URL for typos. If it's an internal resource, make sure you're connected to the right network",
        emoji: "\u{1F50C}",
        debugInfo: context.url ? `DNS failure for ${context.url}` : undefined,
        isRetryable: false,
      };

    case "pdf_extraction":
      return {
        summary: "The PDF couldn't be read — it may be scanned images or a corrupt file",
        suggestion: "If this is a scanned paper, try finding a text-based version on the publisher's site or arXiv",
        emoji: "\u{1F4C4}",
        debugInfo: context.url ? `PDF extraction failed for ${context.url}` : undefined,
        isRetryable: false,
      };

    case "empty_content":
      return {
        summary: "The document appears to be empty or could not be parsed",
        suggestion: "The URL may point to a redirect page. Try the direct link to the PDF or full-text HTML",
        emoji: "\u{1F4AD}",
        debugInfo: context.url ? `Empty content from ${context.url}` : undefined,
        isRetryable: false,
      };

    case "unpaywall_no_result":
      return {
        summary: "No open-access version found for this DOI",
        suggestion: "You can try searching for the paper title on Semantic Scholar or Google Scholar for alternative sources",
        emoji: "\u{1F50D}",
        debugInfo: context.identifier ? `Unpaywall returned no result for ${context.identifier}` : undefined,
        isRetryable: false,
      };

    case "semantic_scholar_404":
      return {
        summary: "This paper wasn't found in Semantic Scholar's database",
        suggestion: "Try using the DOI directly, or search by title with SEARCH_PAPERS",
        emoji: "\u{2753}",
        debugInfo: context.identifier ? `S2 404 for ${context.identifier}` : undefined,
        isRetryable: false,
      };

    case "openalex_empty":
      return {
        summary: "No papers matched your search",
        suggestion: "Try broader search terms, or remove date/OA filters",
        emoji: "\u{1F50E}",
        debugInfo: context.query ? `OpenAlex empty for "${context.query}"` : undefined,
        isRetryable: false,
      };

    case "copyright_gate":
      return {
        summary: "This paper is not available under an open-access license",
        suggestion: "Full-text ingestion is limited to open-access papers. I've recorded the metadata — try FIND_RELATED_PAPERS to find OA alternatives",
        emoji: "\u{00A9}\u{FE0F}",
        debugInfo: context.identifier ? `Copyright gate blocked ${context.identifier}` : undefined,
        isRetryable: false,
      };

    case "url_not_found":
      return {
        summary: "I couldn't find a URL in your message",
        suggestion: "Paste the full URL starting with https://, or provide a DOI like 10.1234/example",
        emoji: "\u{1F517}",
        isRetryable: false,
      };

    case "invalid_url":
      return {
        summary: "That doesn't look like a valid URL",
        suggestion: "Check for missing characters — URLs should start with https:// and contain no spaces",
        emoji: "\u{26A0}\u{FE0F}",
        debugInfo: context.url ? `Invalid URL: ${context.url}` : undefined,
        isRetryable: false,
      };
  }
}

/**
 * Format a UserErrorMessage into callback text.
 */
export function formatForCallback(msg: UserErrorMessage): string {
  return `${msg.emoji} ${msg.summary}\n${msg.suggestion}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fromContentFailure(
  failureType: ContentFailureType,
  error: ContentResolverError,
  context: ErrorContext
): UserErrorMessage {
  const ctx = {
    ...context,
    url: context.url || error.context.url,
    hostname: context.hostname || error.hostname,
  };

  switch (failureType) {
    case "paywall":
      return forCondition("paywall", ctx);
    case "html_stub":
      return forCondition("html_stub", ctx);
    case "rate_limited":
      return forCondition("rate_limited", ctx);
    case "timeout":
      return forCondition("timeout", ctx);
    case "dns_failure":
      return forCondition("dns_failure", ctx);
    case "pdf_extraction":
      return forCondition("pdf_extraction", ctx);
    case "empty_content":
      return forCondition("empty_content", ctx);
    default:
      return genericFallback(error.message);
  }
}

function fromErrorCode(code: ErrorCode, message: string, context: ErrorContext): UserErrorMessage {
  switch (code) {
    case ErrorCode.CONTENT_PAYWALL:
      return forCondition("paywall", context);
    case ErrorCode.CONTENT_RATE_LIMITED:
      return forCondition("rate_limited", context);
    case ErrorCode.CONTENT_TIMEOUT:
      return forCondition("timeout", context);
    case ErrorCode.CONTENT_DNS_FAILURE:
      return forCondition("dns_failure", context);
    case ErrorCode.CONTENT_PDF_FAILED:
      return forCondition("pdf_extraction", context);
    case ErrorCode.CONTENT_EMPTY:
      return forCondition("empty_content", context);
    case ErrorCode.CONTENT_HTML_STUB:
      return forCondition("html_stub", context);
    case ErrorCode.DISCOVERY_NOT_FOUND:
      return forCondition("semantic_scholar_404", context);
    case ErrorCode.DISCOVERY_NO_RESULTS:
      return forCondition("openalex_empty", context);
    case ErrorCode.NETWORK_TIMEOUT:
      return forCondition("timeout", context);
    case ErrorCode.NETWORK_RATE_LIMITED:
      return forCondition("rate_limited", context);
    default:
      return genericFallback(message);
  }
}

function fromPlainError(error: Error, context: ErrorContext): UserErrorMessage {
  const msg = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Timeout
  if (name === "aborterror" || msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout") || msg.includes("abort")) {
    return forCondition("timeout", context);
  }

  // DNS / connection
  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("econnreset")) {
    const hostname = context.hostname || extractHostname(context.url);
    return forCondition("dns_failure", { ...context, hostname });
  }

  // Rate limiting
  if (msg.includes("429") || msg.includes("rate limit")) {
    return forCondition("rate_limited", context);
  }

  // Paywall
  if (msg.includes("403") || msg.includes("401") || msg.includes("forbidden") || msg.includes("unauthorized")) {
    return forCondition("paywall", context);
  }

  return genericFallback(error.message);
}

function genericFallback(message?: string): UserErrorMessage {
  return {
    summary: "Something went wrong while processing your request",
    suggestion: "Try again in a moment. If the problem persists, check the URL and try a different source",
    emoji: "\u{274C}",
    debugInfo: message,
    isRetryable: true,
  };
}

function extractHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
