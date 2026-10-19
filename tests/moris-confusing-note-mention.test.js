import { describe, it, expect } from 'vitest';

describe('Editor @mention autocomplete logic for confusing_note', () => {
  // Logic mirror for filterMentionSuggestions from src/app.js
  function filterMentionSuggestions(query, catalogueCodes, currentCode) {
    const q = String(query || '').trim().toLowerCase();
    const curr = String(currentCode || '').trim().toLowerCase();
    const all = catalogueCodes || [];

    const candidates = all.filter(c => {
      const code = String(c.code || '').trim().toLowerCase();
      return code && code !== curr;
    });

    if (!q) {
      return candidates.slice(0, 8);
    }

    const starts = [];
    const contains = [];

    for (const item of candidates) {
      const code = String(item.code || '').trim().toLowerCase();
      if (code.startsWith(q)) {
        starts.push(item);
      } else if (code.includes(q)) {
        contains.push(item);
      }
    }

    return [...starts, ...contains].slice(0, 10);
  }

  // Regex pattern from src/app.js
  const MENTION_TRIGGER_REGEX = /(?:^|\s)@([0-9a-zA-Z_-]*)$/;

  const mockCatalog = [
    { code: '3440010001', identifying_features: '4 lỗ tròn' },
    { code: '3440010002', identifying_features: '6 lỗ tròn' },
    { code: '3440020001', identifying_features: '2 lỗ dài' },
    { code: '3450010001', identifying_features: 'ngàm gài' },
    { code: '9934400001', identifying_features: 'mã đặc biệt chứa 344 ở giữa' },
    { code: '8880000000', identifying_features: 'khác hoàn toàn' }
  ];

  describe('Regex trigger matching', () => {
    it('detects @ at start of input', () => {
      const match = '@344'.match(MENTION_TRIGGER_REGEX);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('344');
    });

    it('detects @ after whitespace', () => {
      const match = 'Hay nhầm với @3440'.match(MENTION_TRIGGER_REGEX);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('3440');
    });

    it('detects empty query right after typing @', () => {
      const match = 'Dễ nhầm với @'.match(MENTION_TRIGGER_REGEX);
      expect(match).not.toBeNull();
      expect(match[1]).toBe('');
    });

    it('does NOT trigger inside email or words without space', () => {
      expect('contact@example.com'.match(MENTION_TRIGGER_REGEX)).toBeNull();
      expect('abc@def'.match(MENTION_TRIGGER_REGEX)).toBeNull();
    });

    it('does NOT trigger when cursor is after a space', () => {
      expect('Dễ nhầm với @3440010001 '.match(MENTION_TRIGGER_REGEX)).toBeNull();
    });
  });

  describe('filterMentionSuggestions priority and behavior', () => {
    it('prioritizes prefix matches (left-to-right) before substring matches', () => {
      const suggestions = filterMentionSuggestions('344', mockCatalog, 'CURRENT_CODE');
      expect(suggestions.length).toBe(4);
      // Starts with 344 first
      expect(suggestions[0].code).toBe('3440010001');
      expect(suggestions[1].code).toBe('3440010002');
      expect(suggestions[2].code).toBe('3440020001');
      // Substring match comes after
      expect(suggestions[3].code).toBe('9934400001');
    });

    it('excludes current part being edited from suggestions', () => {
      const suggestions = filterMentionSuggestions('344', mockCatalog, '3440010001');
      const codes = suggestions.map(s => s.code);
      expect(codes).not.toContain('3440010001');
      expect(codes).toContain('3440010002');
    });

    it('returns top 8 candidates when query is empty (@)', () => {
      const suggestions = filterMentionSuggestions('', mockCatalog, '3440010001');
      expect(suggestions.length).toBe(5); // 6 minus 1 excluded
      expect(suggestions.map(s => s.code)).not.toContain('3440010001');
    });

    it('is case-insensitive', () => {
      const upper = [{ code: 'SKU_ABC' }, { code: 'SKU_XYZ' }];
      const suggestions = filterMentionSuggestions('sku_a', upper, '');
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].code).toBe('SKU_ABC');
    });
  });

  describe('Mention insertion simulation', () => {
    function simulateInsertMention(originalText, matchStart, matchEnd, selectedCode) {
      const before = originalText.slice(0, matchStart);
      const after = originalText.slice(matchEnd);
      const insert = `@${selectedCode} `;
      return {
        resultText: before + insert + after,
        newCursorPos: before.length + insert.length
      };
    }

    it('replaces partial @mention and appends trailing space', () => {
      const original = 'Dễ nhầm với @344 cần kiểm tra';
      const atIndex = original.indexOf('@');
      const cursorPos = atIndex + 4; // after @344

      const { resultText, newCursorPos } = simulateInsertMention(original, atIndex, cursorPos, '3440010001');
      expect(resultText).toBe('Dễ nhầm với @3440010001  cần kiểm tra');
      expect(newCursorPos).toBe(atIndex + '@3440010001 '.length);
    });

    it('handles multiple mentions in sequence', () => {
      const original = 'Nhầm với @3440010001 và @344';
      const atIndex = original.lastIndexOf('@');
      const cursorPos = original.length;

      const { resultText } = simulateInsertMention(original, atIndex, cursorPos, '3440010002');
      expect(resultText).toBe('Nhầm với @3440010001 và @3440010002 ');
    });
  });
});
