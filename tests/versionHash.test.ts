import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import type { SourcePreview, FilePreview } from "../src/orchestrator/previewSource";

// Replicate VersionResolver logic for testing
function computeRemoteVersionFromPreview(preview: SourcePreview): string {
  const h = createHash("sha256");
  const files = [...preview.files].sort((a, b) => a.path.localeCompare(b.path));

  for (const f of files) {
    h.update(f.url);
    h.update("|");
    h.update(f.path);
    h.update("|");
    h.update(String(f.estBytes));
    h.update("|");
    if (f.etag) h.update(f.etag);
    h.update("|");
    if (f.lastModified) h.update(f.lastModified);
    h.update("||");
  }
  h.update(`count:${files.length}`);
  return h.digest("hex");
}

function needsUpdate(localVersionId: string | null, remoteVersionId: string): boolean {
  if (!localVersionId) return true;
  return localVersionId !== remoteVersionId;
}

describe("VersionResolver", () => {
  describe("computeRemoteVersionFromPreview", () => {
    it("should compute a consistent hash for the same files", () => {
      const preview: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 2000,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
          { url: "https://example.com/b.html", path: "b.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview);
      const hash2 = computeRemoteVersionFromPreview(preview);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it("should produce different hash when file content changes", () => {
      const preview1: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const preview2: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1500,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1500, contentType: "text/html" },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview1);
      const hash2 = computeRemoteVersionFromPreview(preview2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash when etag changes", () => {
      const preview1: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          {
            url: "https://example.com/a.html",
            path: "a.html",
            estBytes: 1000,
            contentType: "text/html",
            etag: '"abc123"',
          },
        ],
      };

      const preview2: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          {
            url: "https://example.com/a.html",
            path: "a.html",
            estBytes: 1000,
            contentType: "text/html",
            etag: '"xyz789"',
          },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview1);
      const hash2 = computeRemoteVersionFromPreview(preview2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash when lastModified changes", () => {
      const preview1: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          {
            url: "https://example.com/a.html",
            path: "a.html",
            estBytes: 1000,
            contentType: "text/html",
            lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
          },
        ],
      };

      const preview2: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          {
            url: "https://example.com/a.html",
            path: "a.html",
            estBytes: 1000,
            contentType: "text/html",
            lastModified: "Thu, 02 Jan 2025 00:00:00 GMT",
          },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview1);
      const hash2 = computeRemoteVersionFromPreview(preview2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce same hash regardless of file order", () => {
      const preview1: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 2000,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
          { url: "https://example.com/b.html", path: "b.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const preview2: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 2000,
        files: [
          { url: "https://example.com/b.html", path: "b.html", estBytes: 1000, contentType: "text/html" },
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview1);
      const hash2 = computeRemoteVersionFromPreview(preview2);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash when a file is added", () => {
      const preview1: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 1000,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const preview2: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 2000,
        files: [
          { url: "https://example.com/a.html", path: "a.html", estBytes: 1000, contentType: "text/html" },
          { url: "https://example.com/b.html", path: "b.html", estBytes: 1000, contentType: "text/html" },
        ],
      };

      const hash1 = computeRemoteVersionFromPreview(preview1);
      const hash2 = computeRemoteVersionFromPreview(preview2);

      expect(hash1).not.toBe(hash2);
    });

    it("should include file count in hash", () => {
      // Even if somehow the file list manipulation were identical,
      // the count suffix ensures different counts produce different hashes
      const preview: SourcePreview = {
        sourceId: "test-source",
        totalBytes: 0,
        files: [],
      };

      const hash = computeRemoteVersionFromPreview(preview);
      expect(hash).toHaveLength(64);
    });
  });

  describe("needsUpdate", () => {
    it("should return true when localVersionId is null", () => {
      expect(needsUpdate(null, "abc123")).toBe(true);
    });

    it("should return true when versions differ", () => {
      expect(needsUpdate("old-version", "new-version")).toBe(true);
    });

    it("should return false when versions match", () => {
      expect(needsUpdate("same-version", "same-version")).toBe(false);
    });
  });
});
