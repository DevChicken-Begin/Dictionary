import { describe, it, expect } from 'vitest';
import {
  R2_ORPHAN_BUCKET,
  R2_ORPHAN_KEEP_PREFIXES,
  R2_ORPHAN_LIMITS,
  buildKeyTypeSummary,
  selectR2OrphanTargets
} from '../tools/r2-orphan-selection.mjs';

// R2-01/T7 (sổ nợ 2026-10-17): ghim quy tắc dry-run của tools/r2-purge-orphans.mjs —
// 77 object legacy `parts/` KHÔNG bao giờ lọt vào danh sách targets dù mồ côi.
describe('R2 orphan selection — legacy parts/ luôn nằm trong KEEP mặc định', () => {
  const objects = [
    { key: 'front/3410970001/a.webp', size: 100 },
    { key: 'thumb/3410970001/a.webp', size: 50 },
    { key: 'parts/legacy/a.webp', size: 10 },
    { key: 'parts/3410970001/front.png', size: 20 },
    { key: 'front/3410970002/b.webp', size: 200 }
  ];

  it('KEEP mặc định chứa parts/; bucket mặc định là catalogue-images', () => {
    expect(R2_ORPHAN_KEEP_PREFIXES).toContain('parts/');
    expect(R2_ORPHAN_BUCKET).toBe('catalogue-images');
  });

  it('object còn tham chiếu DB không bao giờ là orphan', () => {
    const referenced = new Set(['front/3410970001/a.webp', 'parts/legacy/a.webp']);
    const { orphans, kept, targets } = selectR2OrphanTargets(objects, referenced);
    expect(orphans.map(o => o.key)).not.toContain('front/3410970001/a.webp');
    expect(orphans.map(o => o.key)).not.toContain('parts/legacy/a.webp');
    expect(kept.map(o => o.key)).toEqual(['parts/3410970001/front.png']);
    expect(targets.map(o => o.key)).toEqual(['thumb/3410970001/a.webp', 'front/3410970002/b.webp']);
  });

  it('parts/ mồ côi đi vào kept, không bao giờ vào targets dù unreferenced', () => {
    const { orphans, kept, targets } = selectR2OrphanTargets(objects, new Set());
    expect(orphans).toHaveLength(5);
    expect(kept.map(o => o.key)).toEqual(['parts/legacy/a.webp', 'parts/3410970001/front.png']);
    expect(targets.map(o => o.key)).toEqual(['front/3410970001/a.webp', 'thumb/3410970001/a.webp', 'front/3410970002/b.webp']);
    expect(targets.some(o => o.key.startsWith('parts/'))).toBe(false);
  });

  it('prefix KEEP có thể mở rộng có chủ đích (khi chủ dự án duyệt purge parts/)', () => {
    const { kept, targets } = selectR2OrphanTargets(objects, new Set(), ['front/']);
    expect(kept.map(o => o.key)).toEqual(['front/3410970001/a.webp', 'front/3410970002/b.webp']);
    expect(targets.map(o => o.key)).toEqual(['thumb/3410970001/a.webp', 'parts/legacy/a.webp', 'parts/3410970001/front.png']);
  });

  it('danh sách rỗng -> không có gì để purge (dry-run an toàn)', () => {
    const { orphans, kept, targets } = selectR2OrphanTargets([], new Set());
    expect(orphans).toEqual([]);
    expect(kept).toEqual([]);
    expect(targets).toEqual([]);
  });

  it('buildKeyTypeSummary đếm theo prefix, key dị dạng xếp unknown', () => {
    expect(buildKeyTypeSummary(['front/a.webp', 'front/b.webp', 'thumb/c.webp', 'parts/d.webp', ''])).toEqual({
      front: 2,
      thumb: 1,
      parts: 1,
      unknown: 1
    });
  });

  it('ngưỡng safety của purge được ghim (500 targets / 20MB)', () => {
    expect(R2_ORPHAN_LIMITS.maxTargets).toBe(500);
    expect(R2_ORPHAN_LIMITS.maxBytes).toBe(20 * 1024 * 1024);
  });
});
