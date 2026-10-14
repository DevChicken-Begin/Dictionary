import { describe, it, expect } from 'vitest';
import {
  computeEllipticFourierDescriptors,
  computeEfdDistance,
  computeSpatialPatchSimilarity,
  computeHoleConstellationChamferDistance,
  rerankLayer3Top10,
  Layer3CandidateInput
} from '../src/moris/moris-layer3-rerank.js';
import { MorisPartSignature, SpatialKeyPatch } from '../src/moris/moris-layer2-embedding.js';

describe('moris-layer3-rerank: Layer 3 Topological & Spatial Patch Re-ranking', () => {
  it('16-Harmonic Elliptic Fourier Descriptors (EFD) tính toán chính xác và bất biến tỷ lệ', () => {
    // Tạo contour hình chữ nhật 100x50
    const contour1 = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 }
    ];
    const efd1 = computeEllipticFourierDescriptors(contour1, 16);
    expect(efd1.length).toBe(16);
    expect(efd1[0]).toBeCloseTo(1.0, 4); // Harmonic 1 luôn chuẩn hoá về 1.0

    // Phóng to gấp 2 lần: hình chữ nhật 200x100
    const contour2 = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 }
    ];
    const efd2 = computeEllipticFourierDescriptors(contour2, 16);

    // Khoảng cách EFD giữa hai hình đồng dạng phải xấp xỉ 0 (Bất biến tỷ lệ / Scale Invariant)
    const distScale = computeEfdDistance(efd1, efd2);
    expect(distScale).toBeLessThan(0.01);

    // Hình tam giác khác hẳn hình chữ nhật -> Khoảng cách EFD lớn
    const contourTriangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 }
    ];
    const efdTri = computeEllipticFourierDescriptors(contourTriangle, 16);
    const distDiff = computeEfdDistance(efd1, efdTri);
    expect(distDiff).toBeGreaterThan(0.05);
  });

  it('Dense Spatial Patch Verification (3x3 spatial window) so khớp chính xác', () => {
    const dim = 384;
    const patchVecA = new Float32Array(dim).fill(0.05);

    // Query có 1 key patch ở gridIdx = 18 (hàng 1, cột 2)
    const qPatches: SpatialKeyPatch[] = [
      { gridIdx: 18, weight: 1.0, vec: patchVecA }
    ];

    // Candidate 1 có patch giống hệt ở lân cận (hàng 1, cột 3 -> gridIdx = 19)
    const cPatchesNear: SpatialKeyPatch[] = [
      { gridIdx: 19, weight: 0.9, vec: patchVecA }
    ];
    const simNear = computeSpatialPatchSimilarity(qPatches, cPatchesNear);
    expect(simNear).toBeGreaterThan(0.9);

    // Candidate 2 có patch ở quá xa (hàng 10, cột 10 -> ngoài cửa sổ 3x3)
    const cPatchesFar: SpatialKeyPatch[] = [
      { gridIdx: 170, weight: 0.9, vec: patchVecA }
    ];
    const simFar = computeSpatialPatchSimilarity(qPatches, cPatchesFar);
    expect(simFar).toBe(0);
  });

  it('Hole-Constellation Chamfer Distance hỗ trợ lật gương và phạt lệch lỗ', () => {
    // 2 lỗ tại u: -0.3 và u: +0.2
    const qHoles = [
      { u: -0.3, v: 0.0, relArea: 0.1, pixelArea: 50 },
      { u: 0.2, v: 0.0, relArea: 0.1, pixelArea: 50 }
    ];

    // Bản ghi giống hệt
    const cHolesIdentical = [
      { u: -0.3, v: 0.0, relArea: 0.1, pixelArea: 50 },
      { u: 0.2, v: 0.0, relArea: 0.1, pixelArea: 50 }
    ];
    expect(computeHoleConstellationChamferDistance(qHoles, cHolesIdentical)).toBeCloseTo(0.0, 4);

    // Bản ghi bị lật mặt sau (u' = -u)
    const cHolesMirrored = [
      { u: 0.3, v: 0.0, relArea: 0.1, pixelArea: 50 },
      { u: -0.2, v: 0.0, relArea: 0.1, pixelArea: 50 }
    ];
    expect(computeHoleConstellationChamferDistance(qHoles, cHolesMirrored)).toBeCloseTo(0.0, 4);

    // Bản ghi không có lỗ nào -> Phạt nặng > 1.0
    expect(computeHoleConstellationChamferDistance(qHoles, [])).toBeGreaterThan(1.0);
  });

  it('Z-Score Fusion kết hợp 4 trọng số và xếp hạng Top 10 giảm dần', () => {
    const dummyCand = (id: string, holes: number): MorisPartSignature => ({
      skuId: id,
      version: 2,
      aspectRatio: 1.5,
      solidity: 0.85,
      holeCount: holes,
      canonicalEmbedding: new Float32Array(768),
      perspectiveCentroid: new Float32Array(768),
      holeConstellation: holes === 2 ? [
        { u: -0.2, v: 0, relArea: 0.1, pixelArea: 20 },
        { u: 0.2, v: 0, relArea: 0.1, pixelArea: 20 }
      ] : [],
      efdCoefficients: new Float32Array(16).fill(0.1),
      keyPatches: []
    });

    const candidates: Layer3CandidateInput[] = [
      { candidate: dummyCand('SKU_BEST', 2), sHybridVec: 0.95 },
      { candidate: dummyCand('SKU_MID', 2), sHybridVec: 0.70 },
      { candidate: dummyCand('SKU_NO_HOLE', 0), sHybridVec: 0.85 } // Vector cao nhưng lệch số lỗ
    ];

    const query = {
      keyPatches: [],
      holeConstellation: [
        { u: -0.2, v: 0, relArea: 0.1, pixelArea: 20 },
        { u: 0.2, v: 0, relArea: 0.1, pixelArea: 20 }
      ],
      efdCoefficients: new Float32Array(16).fill(0.1)
    };

    const top10 = rerankLayer3Top10(query, candidates, 10);
    expect(top10.length).toBe(3);
    expect(top10[0].skuId).toBe('SKU_BEST');
    expect(top10[0].rank).toBe(1);
    expect(top10[0].finalScore).toBeGreaterThan(top10[1].finalScore);
  });
});
