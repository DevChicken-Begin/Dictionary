/**
 * size-contract.js
 * ============================================================================
 * MORIS M28 — SIZE CONTRACT (S1, query-side only, fail-open)
 *
 * Quy ước kích thước (pipeline_moris.md §10.3, chủ dự án Q1/Q5/Q6/Q9):
 *  - Lưu/so khớp cặp (length_mm, width_mm) theo trục chính PCA, luôn L >= W.
 *  - Bất biến góc xoay/hướng chụp: người dùng chỉ nhập "cạnh dài nhất" và
 *    "cạnh ngắn nhất"; nếu nhập ngược thứ tự, tự động hoán vị (L >= W).
 *  - Hình vuông KHÔNG special case: shape_class = 'square' chỉ khi
 *    |L-W| / max(L,W) <= 5% (dùng để hiển thị/nhóm, không dùng để tính).
 *  - Metric d_max = max theo cạnh của |delta| / max(q,c), thử thêm bản hoán vị
 *    (L,W) <-> (W,L) để bắt lỗi người dùng đo nhầm cạnh.
 *  - Dung sai 2 tầng (§5.4, Q5): mỗi cạnh cho phép max(5% * cạnh, sàn 2mm).
 *  - Trạng thái trung tính (Q8): thiếu size query hoặc thiếu dims catalogue
 *    thì KHÔNG lọc (fail-open), chỉ ghi evidence.
 *
 * Module thuần, DOM-free, mirror với functions/_lib/moris/v5/retrieval/sizeGate.js.
 * ============================================================================
 */

export const SIZE_CONTRACT_VERSION = 'size_contract_v1';

export const DEFAULT_SIZE_TOLERANCE = Object.freeze({
  relative: 0.05,
  floorMm: 2
});

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
 * Trả về null nếu thiếu/không hợp lệ (fail-open phía gọi).
 */
export function normalizeSizePair(length, width, { maxMm = SIZE_MAX_MM } = {}) {
  const l = toFiniteNumber(length);
  const w = toFiniteNumber(width);
  if (l == null || w == null) return null;
  if (l <= 0 || w <= 0) return null;
  const cap = toFiniteNumber(maxMm) ?? SIZE_MAX_MM;
  if (l > cap || w > cap) return null;
  return l >= w
    ? { length_mm: l, width_mm: w }
    : { length_mm: w, width_mm: l };
}

export function shapeClass(lengthMm, widthMm) {
  const pair = normalizeSizePair(lengthMm, widthMm);
  if (!pair) return null;
  const diff = Math.abs(pair.length_mm - pair.width_mm) / pair.length_mm;
  return diff <= SIZE_SQUARE_CLASS_MAX_DIFF ? 'square' : 'rect';
}

/** Dung sai 2 tầng: tầng tương đối (5%) hoặc sàn tuyệt đối (2mm), lấy giá trị lớn hơn. */
export function toleranceForEdge(refMm, tolerance = DEFAULT_SIZE_TOLERANCE) {
  const ref = toFiniteNumber(refMm);
  if (ref == null || ref <= 0) return null;
  const tol = sanitizeTolerance(tolerance);
  return Math.max(tol.relative * ref, tol.floorMm);
}

function compareEdges(queryPair, candidatePair, tolerance) {
  const tol = sanitizeTolerance(tolerance);
  const edges = ['length_mm', 'width_mm'].map((key) => {
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
    ...edges.map((edge, index) => {
      const key = index === 0 ? 'length_mm' : 'width_mm';
      return round(edge.delta) / Math.max(queryPair[key], candidatePair[key]);
    })
  );
  return {
    ok: edges.every((edge) => edge.ok),
    d_max: round(dMax),
    edges
  };
}

/**
 * Khoảng cách chuẩn hoá d_max với hoán vị (L,W) <-> (W,L) (§10.3).
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
  const swapped = compareEdges(
    q,
    { length_mm: c.width_mm, width_mm: c.length_mm },
    DEFAULT_SIZE_TOLERANCE
  );
  return Math.min(identity.d_max, swapped.d_max);
}

/**
 * So khớp 1 ứng viên với size query.
 * status: 'match' | 'mismatch' | 'unknown' (thiếu dữ liệu -> trung tính, giữ nguyên ứng viên).
 */
export function evaluateSizeMatch(
  queryPair,
  candidatePair,
  tolerance = DEFAULT_SIZE_TOLERANCE
) {
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
      edges: []
    };
  }

  const identity = compareEdges(q, c, tolerance);
  const swappedPair = { length_mm: c.width_mm, width_mm: c.length_mm };
  const swapped = compareEdges(q, swappedPair, tolerance);

  let chosen = identity;
  let permutation = 'identity';

  if (!identity.ok && swapped.ok) {
    chosen = swapped;
    permutation = 'swapped';
  } else if (!identity.ok && !swapped.ok && swapped.d_max < identity.d_max) {
    chosen = swapped;
    permutation = 'swapped';
  }

  return {
    status: chosen.ok ? 'match' : 'mismatch',
    permutation,
    d_max: chosen.d_max,
    edges: chosen.edges
  };
}

/**
 * Chuẩn hoá payload size từ query (`body.size`) — fail-open: trả null nếu không hợp lệ.
 * Chấp nhận { length_mm, width_mm, source?, confidence? }.
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
  return `${fmt(normalized.length_mm)} × ${fmt(normalized.width_mm)} mm`;
}
