/**
 * sizeGate.js
 * ============================================================================
 * MORIS M28 — SIZE CONTRACT & SIZE GATE (S1, query-side only, fail-open)
 *
 * Phần hợp đồng kích thước mirror 1:1 với src/moris/size-contract.js
 * (quy ước §10.3, dung sai 2 tầng §5.4, Q5/Q8/Q9 của chủ dự án).
 *
 * Gate được chèn sau hydrate ANN, trước rankMetadata/structural/fusion (§5.5-5):
 *  - query thiếu size           -> status 'not_provided', không lọc (fail-open)
 *  - bảng catalogue_part_dimensions chưa có (Gate D) -> 'dims_unavailable', giữ nguyên
 *  - ứng viên thiếu dims        -> giữ nguyên + cờ size_status='unknown'
 *  - |delta| vượt dung sai      -> loại khỏi pool, ghi evidence size_rejected
 * ============================================================================
 */

export const SIZE_CONTRACT_VERSION = 'size_contract_v1';

export const DEFAULT_SIZE_TOLERANCE = Object.freeze({
  relative: 0.05,
  floorMm: 2
});

export const SIZE_SQUARE_CLASS_MAX_DIFF = 0.05;

export const SIZE_MAX_MM = 5000;

export const SIZE_DIMS_TABLE = 'catalogue_part_dimensions';

export const SIZE_GATE_MESSAGES = Object.freeze({
  dimsUnavailable:
    'Chưa có dữ liệu kích thước catalogue — em chưa lọc theo kích thước được.',
  neutral:
    'Chưa đủ dữ liệu để kết luận kích thước — anh chụp kèm thẻ chuẩn để lọc chính xác hơn.'
});

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

function lookupDims(dimsById, id) {
  if (!dimsById || !id) return null;
  if (dimsById instanceof Map) return dimsById.get(id) || null;
  if (typeof dimsById === 'object') return dimsById[id] || null;
  return null;
}

/**
 * Nạp dims ứng viên từ bảng proposal `catalogue_part_dimensions` (Gate D).
 * Fail-open: bảng chưa tồn tại / lỗi mạng / thiếu env -> trả null (không lọc).
 */
export async function loadCandidateDims(env, token, recordIds) {
  const ids = [...new Set((recordIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
    .slice(0, 100);
  if (!ids.length) return new Map();

  const base = String(env?.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;

  const serviceKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '');
  const anonKey = String(env?.SUPABASE_ANON_KEY || '');
  const apikey = serviceKey || anonKey;
  if (!apikey) return null;
  const bearer = serviceKey || String(token || '') || anonKey;

  const params = new URLSearchParams();
  params.set('select', 'record_id,length_mm,width_mm,method,confidence');
  params.set('record_id', `in.(${ids.join(',')})`);

  try {
    const res = await fetch(`${base}/rest/v1/${SIZE_DIMS_TABLE}?${params.toString()}`, {
      headers: {
        apikey,
        authorization: `Bearer ${bearer}`,
        accept: 'application/json'
      }
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) return null;
    return new Map(data.map((row) => [String(row?.record_id || ''), row]));
  } catch {
    return null;
  }
}

/**
 * Áp Size Gate lên pool ứng viên (hàm thuần, testable).
 *
 * @param {object} args
 * @param {Array} args.candidates  - pool sau hydrate (mỗi row có id/record_id + code)
 * @param {object|null} args.querySize - size query đã chuẩn hoá (hoặc raw, sẽ chuẩn hoá lại)
 * @param {Map|object|null} args.dimsById - map record_id -> {length_mm,width_mm}; null = không đọc được
 * @param {object} [args.tolerance] - { relative, floorMm }
 */
export function applySizeGate({
  candidates,
  querySize,
  dimsById,
  tolerance = DEFAULT_SIZE_TOLERANCE
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const queryPair = normalizeQuerySize(querySize);

  if (!queryPair) {
    return {
      candidates: list,
      rejected: [],
      evidence: { status: 'not_provided' },
      warnings: []
    };
  }

  if (dimsById == null) {
    return {
      candidates: list,
      rejected: [],
      evidence: {
        status: 'dims_unavailable',
        measured: queryPair,
        tolerance: sanitizeTolerance(tolerance)
      },
      warnings: [SIZE_GATE_MESSAGES.dimsUnavailable]
    };
  }

  const tol = sanitizeTolerance(tolerance);
  const kept = [];
  const rejected = [];
  let unknownCount = 0;

  for (const row of list) {
    const id = String(row?.record_id ?? row?.id ?? '');
    const dims = lookupDims(dimsById, id);
    const candidatePair = normalizeSizePair(dims?.length_mm, dims?.width_mm);

    if (!candidatePair) {
      unknownCount += 1;
      kept.push({ ...row, size_status: 'unknown' });
      continue;
    }

    const verdict = evaluateSizeMatch(queryPair, candidatePair, tol);

    if (verdict.status === 'match') {
      kept.push({
        ...row,
        size_status: 'match',
        size_evidence: {
          d_max: verdict.d_max,
          permutation: verdict.permutation,
          candidate: { ...candidatePair }
        }
      });
      continue;
    }

    rejected.push({
      id,
      code: row?.code ?? null,
      d_max: verdict.d_max,
      permutation: verdict.permutation,
      candidate: { ...candidatePair }
    });
  }

  const warnings = rejected.length
    ? [
        `Đã loại ${rejected.length} mã khác kích thước ngoài dung sai ` +
          `(${Math.round(tol.relative * 100)}% hoặc tối thiểu ${tol.floorMm}mm).`
      ]
    : [];

  return {
    candidates: kept,
    rejected,
    evidence: {
      status: 'applied',
      measured: queryPair,
      tolerance: tol,
      matched_count: kept.filter((row) => row.size_status === 'match').length,
      unknown_count: unknownCount,
      rejected_count: rejected.length,
      rejected: rejected.slice(0, 10)
    },
    warnings
  };
}
