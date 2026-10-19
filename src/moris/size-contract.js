/**
 * size-contract.js
 * ============================================================================
 * MORIS M28 — SIZE CONTRACT (S1.1, query-side only, fail-open)
 *
 * Quy ước kích thước (pipeline_moris.md §10.3, chủ dự án Q1/Q5/Q6/Q9 + chốt S1.1
 * 2026-10-19):
 *  - Lưu/so khớp cặp (length_mm, width_mm) theo trục chính PCA, luôn L >= W.
 *  - Bất biến góc xoay/hướng chụp: người dùng chỉ nhập "cạnh dài nhất" và
 *    "cạnh ngắn nhất"; nếu nhập ngược thứ tự, tự động hoán vị (L >= W).
 *  - S1.1: **cạnh dài bắt buộc, cạnh ngắn tùy chọn** — thiếu width_mm vẫn hợp lệ,
 *    khi so khớp chỉ đối chiếu cạnh dài (status 'match_partial'), KHÔNG loại trừ.
 *  - Hình vuông KHÔNG special case: shape_class = 'square' chỉ khi
 *    |L-W| / max(L,W) <= 5% (dùng để hiển thị/nhóm, không dùng để tính);
 *    thiếu cạnh ngắn -> shape_class = null (không kết luận).
 *  - Metric d_max = max theo cạnh của |delta| / max(q,c), thử thêm bản hoán vị
 *    (L,W) <-> (W,L) để bắt lỗi người dùng đo nhầm cạnh (chỉ khi có đủ 2 cạnh).
 *  - Dung sai theo NGUỒN đo (S1.1, chủ dự án chốt 2026-10-19):
 *      * số đo nhập tay (source/method = 'user' hoặc không rõ): 10% hoặc sàn 3mm
 *        (sai số nhập tay ±5% mỗi bên -> chênh 2 bên tới ~10% vẫn phải khớp);
 *      * số đo kiểm chuẩn (caliper/marker_photo/erp/camera_measured — cả 2 bên):
 *        5% hoặc sàn 2mm;
 *      * chỉ khi CẢ HAI bên đều verified mới dùng mức chặt.
 *  - Trạng thái trung tính (Q8): thiếu cạnh dài query hoặc thiếu dims catalogue
 *    thì KHÔNG lọc (fail-open), chỉ ghi evidence.
 *
 * Module thuần, DOM-free, mirror với functions/_lib/moris/v5/retrieval/sizeGate.js.
 * ============================================================================
 */

export const SIZE_CONTRACT_VERSION = 'size_contract_v1_1';

export const DEFAULT_SIZE_TOLERANCE = Object.freeze({
  relative: 0.05,
  floorMm: 2
});

/** Dung sai theo nguồn đo (S1.1): nhập tay rộng hơn số đo kiểm chuẩn. */
export const SIZE_TOLERANCE_BY_SOURCE = Object.freeze({
  verified: Object.freeze({ relative: 0.05, floorMm: 2 }),
  manual: Object.freeze({ relative: 0.10, floorMm: 3 })
});

export const SIZE_VERIFIED_METHODS = Object.freeze(['caliper', 'marker_photo', 'erp']);
export const SIZE_VERIFIED_SOURCES = Object.freeze(['caliper', 'marker_photo', 'erp', 'camera_measured']);

export const SIZE_SQUARE_CLASS_MAX_DIFF = 0.05;

export const SIZE_MAX_MM = 5000;

const SIZE_ROUND_DIGITS = 6;

function round(value, digits = SIZE_ROUND_DIGITS) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeTolerance(tolerance) {
  const relative = toFiniteNumber(tolerance?.relative);
  const floorMm = toFiniteNumber(tolerance?.floorMm);
  return {
    relative: relative != null && relative >= 0 ? relative : DEFAULT_SIZE_TOLERANCE.relative,
    floorMm: floorMm != null && floorMm >= 0 ? floorMm : DEFAULT_SIZE_TOLERANCE.floorMm
  };
}

/**
 * Chuẩn hoá cặp kích thước về quy ước (L >= W).
 * S1.1: cạnh dài bắt buộc, cạnh ngắn tùy chọn — chỉ truyền 1 số thì số đó là
 * cạnh dài (width_mm = null). Trả về null nếu thiếu cả hai / không hợp lệ.
 */
export function normalizeSizePair(length, width, { maxMm = SIZE_MAX_MM } = {}) {
  const l = toFiniteNumber(length);
  const w = toFiniteNumber(width);
  if (l == null && w == null) return null;
  const cap = toFiniteNumber(maxMm) ?? SIZE_MAX_MM;
  if (l == null) {
    if (w <= 0 || w > cap) return null;
    return { length_mm: w, width_mm: null };
  }
  if (l <= 0 || l > cap) return null;
  if (w == null) return { length_mm: l, width_mm: null };
  if (w <= 0 || w > cap) return null;
  return l >= w
    ? { length_mm: l, width_mm: w }
    : { length_mm: w, width_mm: l };
}

export function shapeClass(lengthMm, widthMm) {
  const pair = normalizeSizePair(lengthMm, widthMm);
  if (!pair || pair.width_mm == null) return null;
  const diff = Math.abs(pair.length_mm - pair.width_mm) / pair.length_mm;
  return diff <= SIZE_SQUARE_CLASS_MAX_DIFF ? 'square' : 'rect';
}

/** Dung sai 2 tầng: tầng tương đối hoặc sàn tuyệt đối, lấy giá trị lớn hơn. */
export function toleranceForEdge(refMm, tolerance = DEFAULT_SIZE_TOLERANCE) {
  const ref = toFiniteNumber(refMm);
  if (ref == null || ref <= 0) return null;
  const tol = sanitizeTolerance(tolerance);
  return Math.max(tol.relative * ref, tol.floorMm);
}

/** Bên đo có phải số đo kiểm chuẩn (không phải nhập tay) không. */
export function isVerifiedMeasurement(side) {
  if (!side || typeof side !== 'object') return false;
  const method = String(side.method || '').trim().toLowerCase();
  const source = String(side.source || '').trim().toLowerCase();
  return SIZE_VERIFIED_METHODS.includes(method) || SIZE_VERIFIED_SOURCES.includes(source);
}

/**
 * Chọn dung sai cho một phép so khớp (S1.1).
 * - explicit (tham số tolerance truyền thẳng) luôn thắng (test/override).
 * - Chỉ khi CẢ HAI bên là số đo kiểm chuẩn mới dùng mức chặt 5%/2mm;
 *   còn lại (nhập tay/không rõ) dùng mức rộng 10%/3mm.
 */
export function resolveSizeTolerance(querySide, candidateSide, explicit) {
  const relative = toFiniteNumber(explicit?.relative);
  const floorMm = toFiniteNumber(explicit?.floorMm);
  if (relative != null || floorMm != null) return sanitizeTolerance(explicit);
  const verified = isVerifiedMeasurement(querySide) && isVerifiedMeasurement(candidateSide);
  const chosen = verified ? SIZE_TOLERANCE_BY_SOURCE.verified : SIZE_TOLERANCE_BY_SOURCE.manual;
  return { relative: chosen.relative, floorMm: chosen.floorMm };
}

function compareEdges(queryPair, candidatePair, tolerance) {
  const tol = sanitizeTolerance(tolerance);
  const hasWidth = queryPair.width_mm != null && candidatePair.width_mm != null;
  const keys = hasWidth ? ['length_mm', 'width_mm'] : ['length_mm'];
  const edges = keys.map((key) => {
    const q = queryPair[key];
    const c = candidatePair[key];
    const delta = Math.abs(q - c);
    const ref = Math.max(q, c);
    const allowed = Math.max(tol.relative * ref, tol.floorMm);
    return {
      key,
      delta: round(delta),
      allowed: round(allowed),
      ok: delta <= allowed + 1e-9
    };
  });
  const dMax = Math.max(
    ...edges.map((edge) => round(edge.delta) / Math.max(
      queryPair[edge.key],
      candidatePair[edge.key]
    ))
  );
  return {
    ok: edges.every((edge) => edge.ok),
    partial: !hasWidth,
    d_max: round(dMax),
    edges
  };
}

/**
 * Khoảng cách chuẩn hoá d_max với hoán vị (L,W) <-> (W,L) (§10.3).
 * Thiếu cạnh ngắn -> chỉ tính trên cạnh dài.
 * Trả về null nếu một trong hai cặp không hợp lệ.
 */
export function sizeDistance(queryPair, candidatePair) {
  const q = normalizeSizePair(
    queryPair?.length_mm ?? queryPair?.lengthMm,
    queryPair?.width_mm ?? queryPair?.widthMm
  );
  const c = normalizeSizePair(
    candidatePair?.length_mm ?? candidatePair?.lengthMm,
    candidatePair?.width_mm ?? candidatePair?.widthMm
  );
  if (!q || !c) return null;
  const identity = compareEdges(q, c, DEFAULT_SIZE_TOLERANCE);
  if (identity.partial) return identity.d_max;
  const swapped = compareEdges(
    q,
    { length_mm: c.width_mm, width_mm: c.length_mm },
    DEFAULT_SIZE_TOLERANCE
  );
  return Math.min(identity.d_max, swapped.d_max);
}

/**
 * So khớp 1 ứng viên với size query.
 * status: 'match' | 'match_partial' | 'mismatch' | 'unknown'
 *  - 'match'         : đủ 2 cạnh và nằm trong dung sai.
 *  - 'match_partial' : thiếu cạnh ngắn (1 trong 2 bên) — chỉ đối chiếu cạnh dài,
 *                      giữ nguyên ứng viên (S1.1, không loại trừ oan).
 *  - 'unknown'       : thiếu cạnh dài/không hợp lệ -> trung tính, giữ nguyên.
 */
export function evaluateSizeMatch(queryPair, candidatePair, tolerance) {
  const q = normalizeSizePair(
    queryPair?.length_mm ?? queryPair?.lengthMm,
    queryPair?.width_mm ?? queryPair?.widthMm
  );
  const c = normalizeSizePair(
    candidatePair?.length_mm ?? candidatePair?.lengthMm,
    candidatePair?.width_mm ?? candidatePair?.widthMm
  );
  if (!q || !c) {
    return {
      status: 'unknown',
      permutation: null,
      d_max: null,
      edges: [],
      tolerance: null
    };
  }

  const tol = resolveSizeTolerance(queryPair, candidatePair, tolerance);
  const identity = compareEdges(q, c, tol);

  let chosen = identity;
  let permutation = 'identity';

  if (!identity.partial) {
    const swappedPair = { length_mm: c.width_mm, width_mm: c.length_mm };
    const swapped = compareEdges(q, swappedPair, tol);
    if (!identity.ok && swapped.ok) {
      chosen = swapped;
      permutation = 'swapped';
    } else if (!identity.ok && !swapped.ok && swapped.d_max < identity.d_max) {
      chosen = swapped;
      permutation = 'swapped';
    }
  }

  return {
    status: chosen.ok ? (chosen.partial ? 'match_partial' : 'match') : 'mismatch',
    permutation,
    d_max: chosen.d_max,
    edges: chosen.edges,
    tolerance: tol
  };
}

/**
 * Chuẩn hoá payload size từ query (`body.size`) — fail-open: trả null nếu không hợp lệ.
 * Chấp nhận { length_mm, width_mm?, source?, confidence? } — cạnh dài bắt buộc,
 * cạnh ngắn tùy chọn (S1.1).
 */
export function normalizeQuerySize(input) {
  if (!input || typeof input !== 'object') return null;
  const pair = normalizeSizePair(
    input.length_mm ?? input.lengthMm,
    input.width_mm ?? input.widthMm
  );
  if (!pair) return null;

  const source =
    typeof input.source === 'string' && /^[a-z0-9_]{1,32}$/.test(input.source)
      ? input.source
      : 'unknown';
  const confidence =
    typeof input.confidence === 'number' &&
    Number.isFinite(input.confidence) &&
    input.confidence >= 0 &&
    input.confidence <= 1
      ? input.confidence
      : null;

  return {
    length_mm: pair.length_mm,
    width_mm: pair.width_mm,
    shape_class: shapeClass(pair.length_mm, pair.width_mm),
    source,
    confidence
  };
}

export function formatSizePair(pair) {
  const normalized = normalizeSizePair(
    pair?.length_mm ?? pair?.lengthMm,
    pair?.width_mm ?? pair?.widthMm
  );
  if (!normalized) return '';
  const fmt = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return String(rounded);
  };
  if (normalized.width_mm == null) return `${fmt(normalized.length_mm)} mm`;
  return `${fmt(normalized.length_mm)} × ${fmt(normalized.width_mm)} mm`;
}
