export interface DatamirrorRefreshPolicy {
  previewCacheTtlMs: number;
  reconcileCooldownMs: number;
  maxConcurrentReconciles: number;
  startupReconcileTimeoutMs: number;
}

export const DEFAULT_REFRESH_POLICY: DatamirrorRefreshPolicy = {
  previewCacheTtlMs: 10 * 60 * 1000,   // 10 min
  reconcileCooldownMs: 5 * 60 * 1000,  // 5 min
  maxConcurrentReconciles: 2,
  startupReconcileTimeoutMs: 60 * 1000 // 60 s
};
