import { describe, it, expect } from "vitest";
import {
  computeHoleSimilarity,
  computeAspectRatioSimilarity,
  scoreCandidateGeometry,
  rerankCandidatesByGeometry
} from "../src/moris/retrieval/geometricReranker.js";

describe("Moris Layer 3 — Geometric Re-Ranking Engine", () => {
  it("so khớp số lượng lỗ: 0 lỗ vs 0 lỗ -> điểm 1.0", () => {
    const s = computeHoleSimilarity({ hole_count: 0 }, { hole_count: 0 });
    expect(s).toBe(1.0);
  });

  it("so khớp số lượng lỗ: lệch 1 lỗ -> 0.5, lệch 2 lỗ trở lên -> 0.0", () => {
    expect(computeHoleSimilarity({ hole_count: 2 }, { hole_count: 3 })).toBe(0.5);
    expect(computeHoleSimilarity({ hole_count: 2 }, { hole_count: 4 })).toBe(0.0);
    expect(computeHoleSimilarity({ hole_count: 1 }, { hole_count: 4 })).toBe(0.0);
  });

  it("bất biến khi lật mặt sau (Mirror Invariant): nhận diện chính xác 100% tọa độ đảo gương", () => {
    // Query có 2 lỗ lệch sang bên trái: x = 0.2 và x = 0.4
    const query = {
      hole_count: 2,
      hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }]
    };

    // DB chụp từ mặt trước nên lỗ nằm lệch sang phải: x = 0.6 và x = 0.8 (đối xứng gương của 0.4 và 0.2)
    const dbCandidate = {
      hole_count: 2,
      hole_centroids: [{ x: 0.6, y: 0.5 }, { x: 0.8, y: 0.5 }]
    };

    const s = computeHoleSimilarity(query, dbCandidate);
    // Nhờ tính năng Mirror Invariant (1 - x), điểm tương đồng phải xấp xỉ 1.0!
    expect(s).toBeCloseTo(1.0, 2);
  });

  it("tái xếp hạng: linh kiện khớp đúng số lỗ phải vượt lên Top 1 dù vector DINOv2 hơi thấp hơn một chút", () => {
    const queryGeometry = {
      hole_count: 3,
      aspect_ratio: 2.0,
      hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }]
    };

    const candidates = [
      {
        id: "candidate-A",
        code: "PART-4-HOLES",
        vector_similarity: 0.95, // DINOv2 đánh giá rất cao vì phôi cùng hình dạng
        hole_count: 4, // Nhưng thực tế có 4 lỗ (sai khác cấu trúc)
        aspect_ratio: 2.0,
        hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.8, y: 0.5 }]
      },
      {
        id: "candidate-B",
        code: "PART-3-HOLES-EXACT",
        vector_similarity: 0.91, // DINOv2 hơi thấp hơn một chút do ánh sáng
        hole_count: 3, // Khớp chính xác 3 lỗ!
        aspect_ratio: 2.0,
        hole_centroids: [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }]
      }
    ];

    const reranked = rerankCandidatesByGeometry(candidates, queryGeometry);

    // Candidate B (khớp đúng 3 lỗ) bắt buộc phải vươn lên Top 1!
    expect(reranked[0].id).toBe("candidate-B");
    expect(reranked[0].code).toBe("PART-3-HOLES-EXACT");
    expect(reranked[0].geometric_score).toBeGreaterThan(reranked[1].geometric_score);

    // Candidate A bị cảnh báo khác số lỗ
    expect(reranked[1].geometric_warning).toContain("khác số lỗ");
  });

  it("tỷ lệ khung hình: giống tỷ lệ cho điểm 1.0, lệch tỷ lệ giảm điểm", () => {
    expect(computeAspectRatioSimilarity(2.0, 2.0)).toBe(1.0);
    expect(computeAspectRatioSimilarity(2.0, 1.0)).toBe(0.5);
  });

  it("linh kiện to và dài: hỗ trợ rerank theo aspect_ratio ngay cả khi hole_count là null", () => {
    // Truy vấn linh kiện dài có aspect_ratio = 4.2
    const queryGeometry = {
      hole_count: null,
      aspect_ratio: 4.2
    };

    const candidates = [
      {
        id: "short-part",
        code: "PART-SQUARE",
        vector_similarity: 0.88,
        aspect_ratio: 1.2
      },
      {
        id: "long-part",
        code: "PART-LONG-MATCH",
        vector_similarity: 0.86,
        aspect_ratio: 4.2
      }
    ];

    const reranked = rerankCandidatesByGeometry(candidates, queryGeometry);
    // Linh kiện dài khớp aspect_ratio được cộng điểm vượt lên Top 1
    expect(reranked[0].id).toBe("long-part");
    expect(reranked[0].s_ratio).toBe(1.0);
    expect(reranked[1].s_ratio).toBeLessThan(0.5);
  });

  it("sắp xếp danh sách Top 10 từ tỷ lệ lớn trở xuống: mã 3465490001 đạt 68% được đặt Top 1 thay vì Top 3", async () => {
    const { toPublicMorisResult } = await import("../functions/_lib/moris/v5/presentation/publicResult.js");

    // Dữ liệu mô phỏng đúng như ảnh image.png
    const mockResult = {
      mode: "MORIS_VECTOR_CLEAR",
      candidates: [
        { code: "3410990101", final_score: 0.50, match_score: 0.50 },
        { code: "3405120101", final_score: 0.59, match_score: 0.59 },
        { code: "3465490001", final_score: 0.68, match_score: 0.68 },
        { code: "3405110101", final_score: 0.58, match_score: 0.58 },
        { code: "3410770101", final_score: 0.57, match_score: 0.57 }
      ]
    };

    const publicOut = toPublicMorisResult(mockResult);

    // Kiểm tra danh sách candidates: mã 3465490001 (68%) bắt buộc phải đứng ở Top 1!
    expect(publicOut.candidates[0].code).toBe("3465490001");
    expect(publicOut.candidates[0].match_score).toBe(0.68);

    expect(publicOut.candidates[1].code).toBe("3405120101");
    expect(publicOut.candidates[1].match_score).toBe(0.59);

    expect(publicOut.candidates[2].code).toBe("3405110101");
    expect(publicOut.candidates[2].match_score).toBe(0.58);

    expect(publicOut.candidates[3].code).toBe("3410770101");
    expect(publicOut.candidates[3].match_score).toBe(0.57);

    expect(publicOut.candidates[4].code).toBe("3410990101");
    expect(publicOut.candidates[4].match_score).toBe(0.50);

    // Kiểm tra text trả về trong user_message: mã Top 1 phải là 3465490001
    expect(publicOut.user_message).toContain("1. 3465490001");
  });

  it("Cross-Modal Recovery: tự động phục hồi số lượng lỗ từ text identifying_features khi DB hole_count = 0", () => {
    const queryGeometry = {
      hole_count: 4,
      aspect_ratio: 2.0
    };

    const candidateWithoutText = {
      id: "cand-no-text",
      code: "NO-TEXT-PART",
      vector_similarity: 0.90,
      hole_count: 0,
      aspect_ratio: 2.0
    };

    const candidateWithText = {
      id: "cand-with-text",
      code: "RECOVERED-PART",
      vector_similarity: 0.90,
      hole_count: 0, // Corrupted legacy 0
      aspect_ratio: 2.0,
      identifying_features: "4 lỗ tròn to"
    };

    const scoreNoText = scoreCandidateGeometry(candidateWithoutText, queryGeometry);
    const scoreWithText = scoreCandidateGeometry(candidateWithText, queryGeometry);

    expect(scoreNoText.s_holes).toBe(0.0);
    expect(scoreWithText.s_holes).toBeGreaterThanOrEqual(0.85);
    expect(scoreWithText.final_score).toBeGreaterThan(scoreNoText.final_score);
  });

  it("phân bổ lỗ to/nhỏ: ứng viên có phân bổ lỗ to/nhỏ khớp chính xác đạt điểm s_holes cao hơn", () => {
    const queryGeometry = {
      hole_count: 5,
      big_hole_count: 4,
      small_hole_count: 1,
      aspect_ratio: 2.0
    };

    const candidateExact = {
      id: "cand-exact-clusters",
      code: "PART-4BIG-1SMALL",
      vector_similarity: 0.88,
      hole_count: 5,
      big_hole_count: 4,
      small_hole_count: 1,
      aspect_ratio: 2.0
    };

    const candidateDifferent = {
      id: "cand-diff-clusters",
      code: "PART-2BIG-3SMALL",
      vector_similarity: 0.88,
      hole_count: 5,
      big_hole_count: 2,
      small_hole_count: 3,
      aspect_ratio: 2.0
    };

    const scoreExact = scoreCandidateGeometry(candidateExact, queryGeometry);
    const scoreDiff = scoreCandidateGeometry(candidateDifferent, queryGeometry);

    expect(scoreExact.s_holes).toBeGreaterThan(scoreDiff.s_holes);
    expect(scoreExact.final_score).toBeGreaterThan(scoreDiff.final_score);
  });

  it("classifyHoleSizes1D: phân cụm lỗ to và lỗ nhỏ chuẩn xác theo diện tích logarit", async () => {
    const { classifyHoleSizes1D } = await import("../src/moris/moris-layer1-optical.js");

    const holeAreas = [125, 120, 118, 115, 24];
    const clustered = classifyHoleSizes1D(holeAreas);

    expect(clustered.totalHoles).toBe(5);
    expect(clustered.bigHoles).toBe(4);
    expect(clustered.smallHoles).toBe(1);
    expect(clustered.splitArea).toBeGreaterThan(24);
    expect(clustered.splitArea).toBeLessThan(115);
  });
});

