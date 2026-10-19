/**
 * confusingPairs.js — Trích xuất và đối sánh cặp linh kiện dễ nhầm lẫn (Hard-Negative Pairs)
 * phục vụ phân giải nhầm lẫn (Disambiguation) và cảnh báo trong Moris V6.
 *
 * Cho phép người dùng đánh dấu cặp mã dễ nhầm bằng cú pháp '@<MÃ>' trong trường
 * `confusing_note` của Catalogue Editor (ví dụ: "Dễ nhầm với @3440010001, khác vị trí lỗ").
 */

/**
 * Trích xuất danh sách mã SKU được mention sau ký tự '@' trong chuỗi ghi chú.
 * @param {string} text
 * @returns {string[]} Mảng mã SKU duy nhất đã chuẩn hóa
 */
export function extractConfusingSkus(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.matchAll(/@([0-9a-zA-Z_-]{4,20})/g);
  const skus = [];
  for (const m of matches) {
    const sku = m[1].trim();
    if (sku && !skus.includes(sku)) {
      skus.push(sku);
    }
  }
  return skus;
}

/**
 * Kiểm tra xem 2 ứng viên có tạo thành cặp dễ nhầm lẫn được khai báo hay không.
 * (A khai báo @B HOẶC B khai báo @A)
 * @param {object} candidateA
 * @param {object} candidateB
 * @returns {boolean}
 */
export function arePartsConfusingPair(candidateA, candidateB) {
  if (!candidateA || !candidateB) return false;
  const codeA = String(candidateA.code || candidateA.sku || candidateA.part_id || '').trim();
  const codeB = String(candidateB.code || candidateB.sku || candidateB.part_id || '').trim();
  if (!codeA || !codeB || codeA === codeB) return false;

  const skusA = extractConfusingSkus(candidateA.confusing_note);
  const skusB = extractConfusingSkus(candidateB.confusing_note);

  return skusA.includes(codeB) || skusB.includes(codeA);
}

/**
 * Kiểm tra điều kiện "cùng kích thước nhưng khác lỗ":
 * - Kích thước dài/rộng chênh lệch trong dung sai (tolerance 5% hoặc floor 3mm).
 * - Đặc điểm nhận dạng lỗ hoặc số lượng lỗ khác nhau.
 *
 * @param {object} options
 * @param {object} options.partA
 * @param {object} options.partB
 * @param {object} [options.dimsA]
 * @param {object} [options.dimsB]
 * @param {number} [options.tolerance=0.05]
 * @param {number} [options.floorMm=3]
 * @returns {object} Kết quả đánh giá
 */
export function evaluateHardNegativeCondition({
  partA,
  partB,
  dimsA,
  dimsB,
  tolerance = 0.05,
  floorMm = 3
} = {}) {
  if (!partA || !partB) return { isHardNegative: false, reason: 'missing_parts' };

  const isDeclaredPair = arePartsConfusingPair(partA, partB);
  if (!isDeclaredPair) {
    return { isHardNegative: false, reason: 'not_declared_pair' };
  }

  // 1. So sánh kích thước (nếu có số đo)
  const lenA = Number(dimsA?.length_mm ?? partA?.size_length);
  const lenB = Number(dimsB?.length_mm ?? partB?.size_length);

  let sizeMatch = true;
  if (Number.isFinite(lenA) && Number.isFinite(lenB) && lenA > 0 && lenB > 0) {
    const maxLen = Math.max(lenA, lenB);
    const diffLen = Math.abs(lenA - lenB);
    const allowed = Math.max(maxLen * tolerance, floorMm);
    if (diffLen > allowed) {
      return {
        isHardNegative: false,
        reason: 'size_different',
        diffLen,
        allowed,
        skuA: partA.code || partA.sku,
        skuB: partB.code || partB.sku
      };
    }
  }

  // 2. Kiểm tra khác biệt lỗ (từ số lỗ hoặc định dạng lỗ)
  const holesA = partA?.geometry?.hole_count ?? null;
  const holesB = partB?.geometry?.hole_count ?? null;
  const differentHoleCount = (holesA != null && holesB != null && holesA !== holesB);

  return {
    isHardNegative: true,
    isDeclaredPair: true,
    sizeMatch,
    differentHoleCount,
    skuA: partA.code || partA.sku,
    skuB: partB.code || partB.sku,
    noteA: partA.confusing_note || '',
    noteB: partB.confusing_note || ''
  };
}

/**
 * Quét danh sách ứng viên Top đầu xem có cặp nào là cặp dễ nhầm lẫn không.
 * @param {Array<object>} candidates
 * @param {number} [topN=3] Giới hạn số ứng viên top đầu để kiểm tra
 * @returns {object|null} Thông tin cặp dễ nhầm nếu phát hiện, hoặc null
 */
export function detectConfusingPairInTopCandidates(candidates, topN = 3) {
  if (!Array.isArray(candidates) || candidates.length < 2) return null;
  const pool = candidates.slice(0, topN);

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      const result = evaluateHardNegativeCondition({ partA: a, partB: b });
      if (result.isHardNegative) {
        return {
          active: true,
          skuA: result.skuA,
          skuB: result.skuB,
          rankA: i + 1,
          rankB: j + 1,
          note: a.confusing_note || b.confusing_note || ''
        };
      }
    }
  }

  return null;
}
