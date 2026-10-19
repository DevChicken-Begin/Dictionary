import { describe, it, expect } from 'vitest';
import {
  extractConfusingSkus,
  arePartsConfusingPair,
  evaluateHardNegativeCondition,
  detectConfusingPairInTopCandidates
} from '../functions/_lib/moris/v5/retrieval/confusingPairs.js';
import { buildMorisUserMessage } from '../functions/_lib/moris/v5/presentation/userMessage.js';
import { toPublicMorisResult } from '../functions/_lib/moris/v5/presentation/publicResult.js';

describe('Moris Confusing Pairs (Hard-Negative Pairs via @mention)', () => {
  describe('extractConfusingSkus', () => {
    it('returns empty array for empty, non-string, or null inputs', () => {
      expect(extractConfusingSkus('')).toEqual([]);
      expect(extractConfusingSkus(null)).toEqual([]);
      expect(extractConfusingSkus(undefined)).toEqual([]);
      expect(extractConfusingSkus(12345)).toEqual([]);
    });

    it('extracts a single mention', () => {
      const text = 'Dễ nhầm lẫn với mã @3440010001 cần kiểm tra kỹ lỗ';
      expect(extractConfusingSkus(text)).toEqual(['3440010001']);
    });

    it('extracts multiple mentions and dedupes them', () => {
      const text = 'Dễ nhầm với @3440010001 và @3440010002, hoặc cũng có thể là @3440010001';
      expect(extractConfusingSkus(text)).toEqual(['3440010001', '3440010002']);
    });

    it('supports alphanumeric, underscore, and hyphen SKU formats', () => {
      const text = 'Xem thêm @PART-01_A và @SKU_XYZ-99';
      expect(extractConfusingSkus(text)).toEqual(['PART-01_A', 'SKU_XYZ-99']);
    });

    it('ignores @ with fewer than 4 characters', () => {
      const text = 'Liên hệ @ab hoặc @c1';
      expect(extractConfusingSkus(text)).toEqual([]);
    });
  });

  describe('arePartsConfusingPair', () => {
    const partA = { code: '3440010001', confusing_note: 'Dễ nhầm với @3440010002' };
    const partB = { code: '3440010002', confusing_note: '' };
    const partC = { code: '3440010003', confusing_note: 'Không có ghi chú' };

    it('returns true when part A declares @B', () => {
      expect(arePartsConfusingPair(partA, partB)).toBe(true);
    });

    it('returns true symmetrically (B vs A) even if B has no note', () => {
      expect(arePartsConfusingPair(partB, partA)).toBe(true);
    });

    it('returns false when parts do not declare each other', () => {
      expect(arePartsConfusingPair(partA, partC)).toBe(false);
      expect(arePartsConfusingPair(partB, partC)).toBe(false);
    });

    it('returns false when comparing a part with itself', () => {
      expect(arePartsConfusingPair(partA, partA)).toBe(false);
    });

    it('returns false if candidates are missing or lack code', () => {
      expect(arePartsConfusingPair(null, partA)).toBe(false);
      expect(arePartsConfusingPair(partA, {})).toBe(false);
    });
  });

  describe('evaluateHardNegativeCondition', () => {
    it('rejects pairs that are not declared', () => {
      const res = evaluateHardNegativeCondition({
        partA: { code: 'SKU_A' },
        partB: { code: 'SKU_B' }
      });
      expect(res.isHardNegative).toBe(false);
      expect(res.reason).toBe('not_declared_pair');
    });

    it('confirms hard-negative when sizes match within tolerance', () => {
      const res = evaluateHardNegativeCondition({
        partA: { code: '3440010001', confusing_note: '@3440010002', geometry: { hole_count: 4 } },
        partB: { code: '3440010002', geometry: { hole_count: 6 } },
        dimsA: { length_mm: 120 },
        dimsB: { length_mm: 122 }
      });
      expect(res.isHardNegative).toBe(true);
      expect(res.isDeclaredPair).toBe(true);
      expect(res.sizeMatch).toBe(true);
      expect(res.differentHoleCount).toBe(true);
      expect(res.skuA).toBe('3440010001');
      expect(res.skuB).toBe('3440010002');
    });

    it('rejects when sizes differ beyond tolerance (e.g. >5% and >3mm)', () => {
      const res = evaluateHardNegativeCondition({
        partA: { code: '3440010001', confusing_note: '@3440010002' },
        partB: { code: '3440010002' },
        dimsA: { length_mm: 100 },
        dimsB: { length_mm: 150 },
        tolerance: 0.05,
        floorMm: 3
      });
      expect(res.isHardNegative).toBe(false);
      expect(res.reason).toBe('size_different');
      expect(res.diffLen).toBe(50);
    });

    it('fail-open when dimensions are not provided', () => {
      const res = evaluateHardNegativeCondition({
        partA: { code: '3440010001', confusing_note: '@3440010002' },
        partB: { code: '3440010002' }
      });
      expect(res.isHardNegative).toBe(true);
      expect(res.sizeMatch).toBe(true);
    });
  });

  describe('detectConfusingPairInTopCandidates', () => {
    const candidates = [
      { code: '3440010001', confusing_note: 'Hay nhầm với @3440010003', match_score: 0.95 },
      { code: '9999990001', confusing_note: '', match_score: 0.91 },
      { code: '3440010003', confusing_note: '', match_score: 0.89 },
      { code: '8888880001', confusing_note: '', match_score: 0.82 }
    ];

    it('detects confusable pair within top 3 candidates', () => {
      const notice = detectConfusingPairInTopCandidates(candidates, 3);
      expect(notice).not.toBeNull();
      expect(notice.active).toBe(true);
      expect(notice.skuA).toBe('3440010001');
      expect(notice.skuB).toBe('3440010003');
      expect(notice.rankA).toBe(1);
      expect(notice.rankB).toBe(3);
    });

    it('does not detect pairs outside topN window', () => {
      // If topN is 2, rank 3 is ignored
      const notice = detectConfusingPairInTopCandidates(candidates, 2);
      expect(notice).toBeNull();
    });

    it('returns null if no confusable pair declared', () => {
      const pool = [
        { code: 'SKU_1', confusing_note: '' },
        { code: 'SKU_2', confusing_note: '' }
      ];
      expect(detectConfusingPairInTopCandidates(pool, 3)).toBeNull();
    });
  });

  describe('buildMorisUserMessage and toPublicMorisResult integration', () => {
    it('appends expert warning note when confusing_pair_evidence is active', () => {
      const result = {
        mode: 'MORIS_VECTOR_SUGGESTIONS',
        decision: { status: 'suggested' },
        candidates: [{ code: '3440010001', match_score: 0.95 }],
        confusing_pair_evidence: {
          active: true,
          skuA: '3440010001',
          skuB: '3440010003'
        }
      };

      const msg = buildMorisUserMessage(result);
      expect(msg).toContain('Lưu ý: Mã 3440010001 và 3440010003 là cặp dễ nhầm lẫn');
      expect(msg).toContain('Anh kiểm tra kỹ vị trí/kích thước lỗ nhé');
    });

    it('toPublicMorisResult includes confusing_pair_evidence in public output and debug', () => {
      const result = {
        mode: 'MORIS_VECTOR_SUGGESTIONS',
        decision: { status: 'suggested' },
        candidates: [{ code: '3440010001', match_score: 0.95 }],
        confusing_pair_evidence: {
          active: true,
          skuA: '3440010001',
          skuB: '3440010003'
        }
      };

      const pub = toPublicMorisResult(result, { debug: true });
      expect(pub.confusing_pair_evidence).toEqual(result.confusing_pair_evidence);
      expect(pub.debug.confusing_pair_evidence).toEqual(result.confusing_pair_evidence);
      expect(pub.user_message).toContain('cặp dễ nhầm lẫn');
    });
  });
});
