import { matchHoleTopology } from "../geometry/holeMatcher.js";
import { fuseCandidateScore } from "./scoreFusion.js";
import { normalizeGeometry } from "./geometryEvidence.js";
/**
 * geometricReranker.js — Thuật toán Re-Ranking hình học Lớp 3 cho hệ thống tìm kiếm linh kiện Moris.
 * 
 * Kết hợp:
 * - DINOv2 Coarse Vector Similarity (S_vec; trọng số thuộc scoreFusion)
 * - Hole Topology & Centroid Distribution (S_holes)
 * - Aspect Ratio Congruence (S_ratio)
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

/** Optimal bounded assignment; count-only fallback exposes reduced reliability. */
export function computeHoleSimilarity(queryHoles, dbHoles) {
  return matchHoleTopology(normalizeGeometry(queryHoles),normalizeGeometry(dbHoles)).similarity;
}

/**
 * Tính điểm tương đồng tỷ lệ khung hình S_ratio (Bất biến xoay 90 độ).
 */
export function computeAspectRatioSimilarity(qAR, dbAR) {
  if (qAR == null || dbAR == null || !Number.isFinite(qAR) || !Number.isFinite(dbAR) || qAR <= 0 || dbAR <= 0) return null;
  const rawA = qAR;
  const rawB = dbAR;
  const a = Math.max(rawA, 1.0 / rawA);
  const b = Math.max(rawB, 1.0 / rawB);
  const diff = Math.abs(a - b);
  const maxAR = Math.max(a, b);
  return clamp01(1.0 - diff / maxAR);
}

/**
 * Thu thập evidence hình học; scoreFusion là chủ sở hữu điểm cuối.
 * 
 * Cross-Modal Recovery:
 * Tự động phục hồi số lượng lỗ cho các bản ghi DB có hole_count === 0 nhưng identifying_features
 * mô tả số lỗ dập, tránh bị trừ điểm oan.
 */
export function collectGeometryEvidence(candidate, queryGeometry) {
  candidate = normalizeGeometry(candidate);
  queryGeometry = normalizeGeometry(queryGeometry);
  const sVec = clamp01(candidate?.vector_similarity ?? candidate?.similarity ?? 0);

  // Nếu không có bất kỳ thông tin hình học nào -> Fallback điểm vector gốc
  if (!queryGeometry || (queryGeometry.hole_count == null && queryGeometry.aspect_ratio == null)) {
    return {
      s_vec: sVec,
      s_holes: null,
      s_ratio: null,
      geometric_warning: null
    };
  }

  // Cross-Modal Geometry + Text Recovery
  let dbHoleCount = candidate?.hole_count != null ? Number(candidate.hole_count) : null;
  let dbBigHoleCount = candidate?.big_hole_count != null ? Number(candidate.big_hole_count) : null;
  let dbSmallHoleCount = candidate?.small_hole_count != null ? Number(candidate.small_hole_count) : null;

  if (candidate?.identifying_features) {
    const textAST = parseIdentifyingFeaturesAST(candidate.identifying_features);
    if (textAST && textAST.totalHoles != null && textAST.totalHoles > 0) {
      if (dbHoleCount == null || (dbHoleCount === 0 && candidate.geometry_version === "legacy_unknown")) {
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

  const holeMatch = matchHoleTopology(queryGeometry, {
    ...candidate, hole_count:dbHoleCount,big_hole_count:dbBigHoleCount,
    small_hole_count:dbSmallHoleCount,hole_centroids:candidate?.hole_centroids
  });
  const sHoles=holeMatch.similarity;

  const sRatio = computeAspectRatioSimilarity(
    queryGeometry?.aspect_ratio,
    candidate?.aspect_ratio
  );


  let warning = null;
  const qCount = Number(queryGeometry.hole_count || 0);

  if (sVec > 0.85 && sHoles != null && qCount !== dbHoleCount) {
    warning = `Kiểu dáng giống (${Math.round(sVec * 100)}%) nhưng khác số lỗ: Ảnh chụp có ${qCount} lỗ, catalogue có ${dbHoleCount} lỗ.`;
  }

  return {
    hole_match: holeMatch,
    aspect_reliability: sRatio==null?0:(queryGeometry.quality?.reliable===true && candidate.quality?.reliable===true?1:.25),
    s_vec: sVec,
    s_holes: sHoles == null ? null : Number(sHoles.toFixed(4)),
    s_ratio: sRatio == null ? null : Number(sRatio.toFixed(4)),
    geometric_warning: warning
  };
}

// Compatibility adapter delegates final scoring to the same owner as the server.
export function scoreCandidateGeometry(candidate, queryGeometry) {
  const evidence=collectGeometryEvidence(candidate,queryGeometry);
  const fused=fuseCandidateScore({...candidate,geometry_evidence:evidence});
  return {...evidence,final_score:fused.final_score,score_breakdown:fused.score_breakdown};
}

/**
 * Tái sắp xếp (Re-rank) danh sách ứng viên dựa trên hình học.
 */
export function rerankCandidatesByGeometry(candidates, queryGeometry, options = {}) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  if (!list.length) return [];

  const scored = list.map(c => {
    const geo = scoreCandidateGeometry(c, queryGeometry);
    return {
      ...c,
      final_score: geo.final_score,
      match_score: geo.final_score,
      geometric_score: geo.final_score,
      s_vec: geo.s_vec,
      s_holes: geo.s_holes,
      s_ratio: geo.s_ratio,
      score_breakdown: geo.score_breakdown,
      geometric_warning: geo.geometric_warning
    };
  });

  scored.sort((a, b) => Number(b.geometric_score ?? b.match_score ?? b.final_score ?? 0) - Number(a.geometric_score ?? a.match_score ?? a.final_score ?? 0));
  return scored;
}
