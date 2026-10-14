/**
 * geometricReranker.js — Thuật toán Re-Ranking hình học Lớp 3 cho hệ thống tìm kiếm linh kiện Moris.
 * 
 * Kết hợp:
 * - DINOv2 Coarse Vector Similarity (S_vec - Trọng số 45%)
 * - Hole Topology & Centroid Distribution (S_holes - Trọng số 40%)
 * - Aspect Ratio Congruence (S_ratio - Trọng số 15%)
 * 
 * Hỗ trợ:
 * - Bất biến lật mặt sau (Mirror Invariant: x <-> 1 - x, y <-> 1 - y)
 * - Tự động phục hồi số lượng lỗ (Cross-Modal Recovery) cho các bản ghi front legacy bị hole_count = 0
 *   dựa trên phân tích identifying_features text AST
 * - So khớp phân bổ lỗ to / nhỏ (big_hole_count, small_hole_count) với ngưỡng sai số cảm tính (+/- 1)
 * - Bất biến xoay tỷ lệ khung hình (Oriented Aspect Ratio: Math.max(w/h, h/w))
 */

import { parseIdentifyingFeaturesAST } from "./featureMatcher.js";

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

/**
 * Tính khoảng cách Euclid trung bình giữa hai tập tâm lỗ.
 */
function computeCentroidDistance(qCentroids, dbCentroids) {
  const n = qCentroids.length;
  if (n === 0) return 0;

  let sumDist = 0;
  for (let i = 0; i < n; i++) {
    const q = qCentroids[i];
    const d = dbCentroids[i];
    const dx = Number(q?.x || 0) - Number(d?.x || 0);
    const dy = Number(q?.y || 0) - Number(d?.y || 0);
    sumDist += Math.hypot(dx, dy);
  }

  return sumDist / n;
}

/**
 * Tính điểm tương đồng cấu trúc lỗ S_holes giữa ảnh query và bản ghi DB.
 * Có xử lý bất biến phản xạ gương và phân bổ lỗ to/nhỏ.
 */
export function computeHoleSimilarity(queryHoles, dbHoles) {
  const qCount = Number(queryHoles?.hole_count ?? (Array.isArray(queryHoles?.hole_centroids) ? queryHoles.hole_centroids.length : 0));
  const dbCount = Number(dbHoles?.hole_count ?? (Array.isArray(dbHoles?.hole_centroids) ? dbHoles.hole_centroids.length : 0));

  // Nếu cả hai đều không có lỗ nào -> 1.0
  if (qCount === 0 && dbCount === 0) {
    return 1.0;
  }

  // Nếu số lượng lỗ khác nhau: lệch 1 lỗ -> 0.5, lệch >= 2 lỗ -> 0.0
  const diff = Math.abs(qCount - dbCount);
  if (diff >= 1) {
    return Math.max(0, 1.0 - 0.5 * diff);
  }

  // Cả hai có cùng tổng số lỗ (diff === 0)
  let sSub = 1.0;
  const qBig = queryHoles?.big_hole_count != null ? Number(queryHoles.big_hole_count) : null;
  const dbBig = dbHoles?.big_hole_count != null ? Number(dbHoles.big_hole_count) : null;
  const qSmall = queryHoles?.small_hole_count != null ? Number(queryHoles.small_hole_count) : null;
  const dbSmall = dbHoles?.small_hole_count != null ? Number(dbHoles.small_hole_count) : null;

  if (qBig != null && dbBig != null && qSmall != null && dbSmall != null) {
    if (qBig === dbBig && qSmall === dbSmall) {
      sSub = 1.0;
    } else if (Math.abs(qBig - dbBig) === 1 && Math.abs(qSmall - dbSmall) === 1) {
      sSub = 0.85; // Cảm nhận mắt thường ranh giới to/nhỏ
    } else {
      const subDiff = Math.abs(qBig - dbBig) + Math.abs(qSmall - dbSmall);
      sSub = Math.max(0.3, 1.0 - 0.25 * subDiff);
    }
  } else if (qBig != null && dbBig != null) {
    if (qBig === dbBig) {
      sSub = 1.0;
    } else if (Math.abs(qBig - dbBig) === 1) {
      sSub = 0.85;
    } else {
      sSub = Math.max(0.3, 1.0 - 0.3 * Math.abs(qBig - dbBig));
    }
  }

  const qArr = Array.isArray(queryHoles?.hole_centroids) ? [...queryHoles.hole_centroids] : [];
  const dbArr = Array.isArray(dbHoles?.hole_centroids) ? [...dbHoles.hole_centroids] : [];

  if (qArr.length === 0 || dbArr.length === 0 || qArr.length !== dbArr.length) {
    return clamp01(sSub * 0.85); // Cùng count nhưng thiếu chi tiết centroid
  }

  // Sắp xếp tăng dần theo X
  qArr.sort((a, b) => Number(a.x || 0) - Number(b.x || 0));
  dbArr.sort((a, b) => Number(a.x || 0) - Number(b.x || 0));

  // Kịch bản 1: Giữ nguyên hướng
  const distDirect = computeCentroidDistance(qArr, dbArr);

  // Kịch bản 2: Lật mặt sau ngang (Mirror X: x' = 1 - x)
  const qMirrorH = qArr.map(p => ({
    ...p,
    x: 1.0 - Number(p.x || 0)
  })).sort((a, b) => a.x - b.x);
  const distMirrorH = computeCentroidDistance(qMirrorH, dbArr);

  // Kịch bản 3: Lật dọc (Mirror Y: y' = 1 - y)
  const qMirrorV = qArr.map(p => ({
    ...p,
    y: 1.0 - Number(p.y || 0)
  })).sort((a, b) => a.x - b.x);
  const distMirrorV = computeCentroidDistance(qMirrorV, dbArr);

  // Kịch bản 4: Xoay 180 độ (Both: x' = 1 - x, y' = 1 - y)
  const qMirrorBoth = qArr.map(p => ({
    ...p,
    x: 1.0 - Number(p.x || 0),
    y: 1.0 - Number(p.y || 0)
  })).sort((a, b) => a.x - b.x);
  const distMirrorBoth = computeCentroidDistance(qMirrorBoth, dbArr);

  const bestDist = Math.min(distDirect, distMirrorH, distMirrorV, distMirrorBoth);
  const sDist = clamp01(1.0 - bestDist);

  return clamp01(sSub * (0.6 + 0.4 * sDist));
}

/**
 * Tính điểm tương đồng tỷ lệ khung hình S_ratio (Bất biến xoay 90 độ).
 */
export function computeAspectRatioSimilarity(qAR, dbAR) {
  const rawA = Math.max(0.01, Number(qAR || 1.0));
  const rawB = Math.max(0.01, Number(dbAR || 1.0));
  const a = Math.max(rawA, 1.0 / rawA);
  const b = Math.max(rawB, 1.0 / rawB);
  const diff = Math.abs(a - b);
  const maxAR = Math.max(a, b);
  return clamp01(1.0 - diff / maxAR);
}

/**
 * Chấm điểm tổng hợp S_final cho một ứng viên.
 * S_final = 0.45 * S_vec + 0.40 * S_holes + 0.15 * S_ratio
 * 
 * Cross-Modal Recovery:
 * Tự động phục hồi số lượng lỗ cho các bản ghi DB có hole_count === 0 nhưng identifying_features
 * mô tả số lỗ dập, tránh bị trừ điểm oan.
 */
export function scoreCandidateGeometry(candidate, queryGeometry, weights = { wVec: 0.45, wHoles: 0.40, wRatio: 0.15 }) {
  const sVec = clamp01(candidate?.vector_similarity ?? candidate?.similarity ?? 0);

  // Nếu không có bất kỳ thông tin hình học nào -> Fallback điểm vector gốc
  if (!queryGeometry || (queryGeometry.hole_count == null && queryGeometry.aspect_ratio == null)) {
    return {
      final_score: sVec,
      s_vec: sVec,
      s_holes: 1.0,
      s_ratio: 1.0,
      geometric_warning: null
    };
  }

  // Cross-Modal Geometry + Text Recovery
  let dbHoleCount = candidate?.hole_count != null ? Number(candidate.hole_count) : 0;
  let dbBigHoleCount = candidate?.big_hole_count != null ? Number(candidate.big_hole_count) : null;
  let dbSmallHoleCount = candidate?.small_hole_count != null ? Number(candidate.small_hole_count) : null;

  if (candidate?.identifying_features) {
    const textAST = parseIdentifyingFeaturesAST(candidate.identifying_features);
    if (textAST && textAST.totalHoles != null && textAST.totalHoles > 0) {
      if (dbHoleCount === 0) {
        dbHoleCount = textAST.totalHoles;
      }
      if (dbBigHoleCount == null && textAST.bigHoles != null) {
        dbBigHoleCount = textAST.bigHoles;
      }
      if (dbSmallHoleCount == null && textAST.smallHoles != null) {
        dbSmallHoleCount = textAST.smallHoles;
      }
    }
  }

  const sHoles = queryGeometry.hole_count != null
    ? computeHoleSimilarity(queryGeometry, {
        hole_count: dbHoleCount,
        big_hole_count: dbBigHoleCount,
        small_hole_count: dbSmallHoleCount,
        hole_centroids: candidate?.hole_centroids ?? []
      })
    : 1.0;

  const sRatio = computeAspectRatioSimilarity(
    queryGeometry?.aspect_ratio ?? 1.0,
    candidate?.aspect_ratio ?? 1.0
  );

  const finalScore = Number((
    weights.wVec * sVec +
    weights.wHoles * sHoles +
    weights.wRatio * sRatio
  ).toFixed(4));

  let warning = null;
  const qCount = Number(queryGeometry.hole_count || 0);

  if (sVec > 0.85 && qCount !== dbHoleCount) {
    warning = `Kiểu dáng giống (${Math.round(sVec * 100)}%) nhưng khác số lỗ: Ảnh chụp có ${qCount} lỗ, catalogue có ${dbHoleCount} lỗ.`;
  }

  return {
    final_score: finalScore,
    s_vec: sVec,
    s_holes: Number(sHoles.toFixed(4)),
    s_ratio: Number(sRatio.toFixed(4)),
    geometric_warning: warning
  };
}

/**
 * Tái sắp xếp (Re-rank) danh sách ứng viên dựa trên hình học.
 */
export function rerankCandidatesByGeometry(candidates, queryGeometry, options = {}) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  if (!list.length) return [];

  const scored = list.map(c => {
    const geo = scoreCandidateGeometry(c, queryGeometry, options.weights);
    return {
      ...c,
      final_score: geo.final_score,
      match_score: geo.final_score,
      geometric_score: geo.final_score,
      s_vec: geo.s_vec,
      s_holes: geo.s_holes,
      s_ratio: geo.s_ratio,
      geometric_warning: geo.geometric_warning
    };
  });

  scored.sort((a, b) => Number(b.geometric_score ?? b.match_score ?? b.final_score ?? 0) - Number(a.geometric_score ?? a.match_score ?? a.final_score ?? 0));
  return scored;
}
