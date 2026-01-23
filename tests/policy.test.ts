import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIZE_POLICY,
  MIN_AUTO_INGEST_BYTES,
  type DatamirrorSizePolicy,
} from "../src/config/SizePolicy";
import {
  DEFAULT_REFRESH_POLICY,
  type DatamirrorRefreshPolicy,
} from "../src/config/RefreshPolicy";

describe("SizePolicy", () => {
  describe("DEFAULT_SIZE_POLICY", () => {
    it("should have previewAlways set to false by default", () => {
      expect(DEFAULT_SIZE_POLICY.previewAlways).toBe(false);
    });

    it("should have autoIngestBelowBytes set to MIN_AUTO_INGEST_BYTES", () => {
      expect(DEFAULT_SIZE_POLICY.autoIngestBelowBytes).toBe(MIN_AUTO_INGEST_BYTES);
    });

    it("should have MIN_AUTO_INGEST_BYTES at 50MB", () => {
      expect(MIN_AUTO_INGEST_BYTES).toBe(50 * 1024 * 1024);
    });

    it("should have maxBytesHardLimit at 1GB", () => {
      expect(DEFAULT_SIZE_POLICY.maxBytesHardLimit).toBe(1024 * 1024 * 1024);
    });
  });

  describe("policy enforcement logic", () => {
    it("should auto-ingest when totalBytes is below threshold", () => {
      const policy: DatamirrorSizePolicy = {
        previewAlways: false,
        autoIngestBelowBytes: 50 * 1024 * 1024, // 50 MB
        maxBytesHardLimit: 1024 * 1024 * 1024,
      };
      const totalBytes = 10 * 1024 * 1024; // 10 MB

      const shouldAutoIngest = totalBytes <= policy.autoIngestBelowBytes;
      expect(shouldAutoIngest).toBe(true);
    });

    it("should require confirmation when totalBytes exceeds threshold", () => {
      const policy: DatamirrorSizePolicy = {
        previewAlways: false,
        autoIngestBelowBytes: 50 * 1024 * 1024, // 50 MB
        maxBytesHardLimit: 1024 * 1024 * 1024,
      };
      const totalBytes = 100 * 1024 * 1024; // 100 MB

      const requiresConfirmation = totalBytes > policy.autoIngestBelowBytes;
      expect(requiresConfirmation).toBe(true);
    });

    it("should block when totalBytes exceeds hard limit", () => {
      const policy: DatamirrorSizePolicy = {
        previewAlways: false,
        autoIngestBelowBytes: 50 * 1024 * 1024,
        maxBytesHardLimit: 500 * 1024 * 1024, // 500 MB
      };
      const totalBytes = 600 * 1024 * 1024; // 600 MB

      const exceedsHardLimit = totalBytes > policy.maxBytesHardLimit;
      expect(exceedsHardLimit).toBe(true);
    });

    it("should always require preview when previewAlways is true", () => {
      const policy: DatamirrorSizePolicy = {
        previewAlways: true,
        autoIngestBelowBytes: 50 * 1024 * 1024,
        maxBytesHardLimit: 1024 * 1024 * 1024,
      };
      const totalBytes = 1 * 1024 * 1024; // 1 MB (well below threshold)

      const requiresPreview =
        policy.previewAlways || totalBytes > policy.autoIngestBelowBytes;
      expect(requiresPreview).toBe(true);
    });
  });
});

describe("RefreshPolicy", () => {
  describe("DEFAULT_REFRESH_POLICY", () => {
    it("should have previewCacheTtlMs at 10 minutes", () => {
      expect(DEFAULT_REFRESH_POLICY.previewCacheTtlMs).toBe(10 * 60 * 1000);
    });

    it("should have reconcileCooldownMs at 5 minutes", () => {
      expect(DEFAULT_REFRESH_POLICY.reconcileCooldownMs).toBe(5 * 60 * 1000);
    });

    it("should have maxConcurrentReconciles at 2", () => {
      expect(DEFAULT_REFRESH_POLICY.maxConcurrentReconciles).toBe(2);
    });

    it("should have startupReconcileTimeoutMs at 60 seconds", () => {
      expect(DEFAULT_REFRESH_POLICY.startupReconcileTimeoutMs).toBe(60 * 1000);
    });
  });

  describe("cache freshness logic", () => {
    it("should consider cache fresh when within TTL", () => {
      const policy: DatamirrorRefreshPolicy = {
        previewCacheTtlMs: 10 * 60 * 1000, // 10 min
        reconcileCooldownMs: 5 * 60 * 1000,
        maxConcurrentReconciles: 2,
        startupReconcileTimeoutMs: 60 * 1000,
      };

      const cachedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      const now = new Date();

      const isFresh = now.getTime() - cachedAt.getTime() <= policy.previewCacheTtlMs;
      expect(isFresh).toBe(true);
    });

    it("should consider cache stale when beyond TTL", () => {
      const policy: DatamirrorRefreshPolicy = {
        previewCacheTtlMs: 10 * 60 * 1000, // 10 min
        reconcileCooldownMs: 5 * 60 * 1000,
        maxConcurrentReconciles: 2,
        startupReconcileTimeoutMs: 60 * 1000,
      };

      const cachedAt = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago
      const now = new Date();

      const isFresh = now.getTime() - cachedAt.getTime() <= policy.previewCacheTtlMs;
      expect(isFresh).toBe(false);
    });
  });
});
