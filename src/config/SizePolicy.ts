export interface AutognosticSizePolicy {
  previewAlways: boolean;
  autoIngestBelowBytes: number;
  maxBytesHardLimit: number;
}

export const MIN_AUTO_INGEST_BYTES = 50 * 1024 * 1024; // 50 MB

export const DEFAULT_SIZE_POLICY: AutognosticSizePolicy = {
  previewAlways: false,
  autoIngestBelowBytes: MIN_AUTO_INGEST_BYTES,
  maxBytesHardLimit: 1024 * 1024 * 1024, // 1 GB
};
