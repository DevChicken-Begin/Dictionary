// R2-02 (sổ nợ 2026-10-17): logic thuần cho quota monitor R2 — chỉ đọc, không ghi.
export const R2_USAGE_DEFAULT_QUOTA_BYTES = 10 * 1024 ** 3;
export const R2_USAGE_DEFAULT_TOP_TYPES = 8;

export function formatBytesMb(bytes) {
  const value = Number(bytes);
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${(safe / (1024 * 1024)).toFixed(2)}MB`;
}

export function summarizeBucketUsage(objects, { quotaBytes = R2_USAGE_DEFAULT_QUOTA_BYTES } = {}) {
  const list = Array.isArray(objects) ? objects : [];
  const byType = new Map();
  let totalBytes = 0;
  for (const object of list) {
    const size = Number(object?.size);
    const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
    const type = String(object?.key || '').split('/')[0] || 'unknown';
    const current = byType.get(type) || { type, count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += safeSize;
    byType.set(type, current);
    totalBytes += safeSize;
  }
  const types = [...byType.values()].sort((a, b) => b.bytes - a.bytes || a.type.localeCompare(b.type));
  const quota = Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : R2_USAGE_DEFAULT_QUOTA_BYTES;
  return {
    object_count: list.length,
    total_bytes: totalBytes,
    total_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    quota_bytes: quota,
    quota_gb: Number((quota / 1024 ** 3).toFixed(2)),
    usage_percent: Number(((totalBytes / quota) * 100).toFixed(2)),
    over_quota: totalBytes > quota,
    types
  };
}

export function formatUsageReport(summary, { topTypes = R2_USAGE_DEFAULT_TOP_TYPES } = {}) {
  const head = `[quota] R2: ${summary.object_count} objects · ${summary.total_mb.toFixed(2)}MB / `
    + `${summary.quota_gb}GB (${summary.usage_percent.toFixed(2)}%)`
    + (summary.over_quota ? ' — VƯỢT HẠN MỨC' : '');
  const top = summary.types
    .slice(0, Math.max(1, topTypes))
    .map((t) => `${t.type} ${t.count} obj/${formatBytesMb(t.bytes)}`)
    .join(' · ');
  return [head, top ? `[quota] top: ${top}` : '[quota] (bucket trống)'];
}
