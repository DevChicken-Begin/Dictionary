import { describe, it, expect } from 'vitest';
import {
  R2_USAGE_DEFAULT_QUOTA_BYTES,
  formatBytesMb,
  formatUsageReport,
  summarizeBucketUsage
} from '../tools/r2-usage.mjs';

// R2-02 (sổ nợ 2026-10-17): parse usage read-only từ listing R2 (fixture).
const MB = 1024 * 1024;

describe('R2 quota monitor — tổng hợp usage read-only', () => {
  const objects = [
    { key: 'front/3410970001/a.webp', size: 4 * MB },
    { key: 'front/3410970001/b.webp', size: 2 * MB },
    { key: 'thumb/3410970001/a.webp', size: 0.5 * MB },
    { key: 'parts/legacy/d.webp', size: 1024 },
    { key: '', size: 10 }
  ];

  it('tổng hợp đúng object_count/tổng bytes/phần trăm quota mặc định 10GB', () => {
    const summary = summarizeBucketUsage(objects);
    expect(summary.object_count).toBe(5);
    expect(summary.total_bytes).toBe(4 * MB + 2 * MB + 0.5 * MB + 1024 + 10);
    expect(summary.total_mb).toBe(Number(((4 * MB + 2 * MB + 0.5 * MB + 1024 + 10) / MB).toFixed(2)));
    expect(summary.quota_bytes).toBe(R2_USAGE_DEFAULT_QUOTA_BYTES);
    expect(summary.quota_gb).toBe(10);
    expect(summary.usage_percent).toBe(0.06);
    expect(summary.over_quota).toBe(false);
  });

  it('types xếp theo bytes giảm dần; key dị dạng vào unknown', () => {
    const summary = summarizeBucketUsage(objects);
    expect(summary.types.map(t => t.type)).toEqual(['front', 'thumb', 'parts', 'unknown']);
    expect(summary.types[0]).toMatchObject({ type: 'front', count: 2, bytes: 6 * MB });
    expect(summary.types[3]).toMatchObject({ type: 'unknown', count: 1, bytes: 10 });
  });

  it('bucket vượt quota -> over_quota=true và report có cảnh báo', () => {
    const summary = summarizeBucketUsage(objects, { quotaBytes: 3 * MB });
    expect(summary.over_quota).toBe(true);
    const lines = formatUsageReport(summary);
    expect(lines[0]).toContain('VƯỢT HẠN MỨC');
    expect(lines[0]).toContain('5 objects');
    expect(lines[0]).toContain('6.50MB');
  });

  it('bucket rỗng -> toàn số 0, không ném, report ghi (bucket trống)', () => {
    const summary = summarizeBucketUsage([]);
    expect(summary.object_count).toBe(0);
    expect(summary.total_bytes).toBe(0);
    expect(summary.usage_percent).toBe(0);
    expect(summary.types).toEqual([]);
    expect(formatUsageReport(summary)).toEqual([
      '[quota] R2: 0 objects · 0.00MB / 10GB (0.00%)',
      '[quota] (bucket trống)'
    ]);
  });

  it('size âm/NaN coi như 0 (không đầu độc tổng)', () => {
    const summary = summarizeBucketUsage([
      { key: 'front/a.webp', size: -5 },
      { key: 'front/b.webp', size: 'oops' },
      { key: 'front/c.webp', size: 2 * MB }
    ]);
    expect(summary.total_bytes).toBe(2 * MB);
  });

  it('formatUsageReport giới hạn top types và format MB 2 chữ số', () => {
    const lines = formatUsageReport(summarizeBucketUsage(objects), { topTypes: 2 });
    expect(lines[1]).toBe('[quota] top: front 2 obj/6.00MB · thumb 1 obj/0.50MB');
    expect(formatBytesMb(1536)).toBe('0.00MB');
    expect(formatBytesMb(1.5 * MB)).toBe('1.50MB');
  });
});
