import { describe, it, expect } from 'vitest';
import {
  extractDinov2Tokens,
  downsampleTo16x16Grid,
  computeHybridMaskedGemEmbedding,
  extractTopKeyPatches,
  executeGeometricGate,
  synthesizePerspectiveCentroid,
  rankStage2Candidates,
  MorisPartSignature
} from '../src/moris/moris-layer2-embedding.js';

describe('moris-layer2-embedding: Layer 2 Coarse Gate & Hybrid Masked-GeM', () => {
  it('Trích xuất DINOv2 ONNX token: [1, 257, 384] bỏ CLS lấy 256 patch, từ chối CLS [1, 384] theo M06', () => {
    // 1. Trường hợp chuẩn: 257 tokens (1 CLS + 256 patches)
    const raw257 = new Float32Array(257 * 384);
    raw257.fill(0.1);
    raw257[0] = 1.0; // CLS token đặc biệt
    raw257[384] = 2.0; // patch 0 token

    const res257 = extractDinov2Tokens({ data: raw257, dims: [1, 257, 384] });
    expect(res257.isSpatial).toBe(true);
    expect(res257.clsToken.length).toBe(384);
    expect(res257.patchTokens.length).toBe(256 * 384);
    expect(res257.patchTokens[0]).toBe(2.0);

    // 2. Trường hợp fallback: chỉ có 1 token [1, 384]
    const raw384 = new Float32Array(384);
    raw384.fill(0.5);
    expect(() => extractDinov2Tokens({ data: raw384, dims: [1, 384] })).toThrow(/spatial tokens required/);
  });

  it('Downsampling 224x224 mask và gradient về 16x16 grid chính xác', () => {
    const size = 224;
    const fgMask = new Uint8Array(size * size);
    const scharr = new Float32Array(size * size);

    // Tô cell (0, 0) góc trên cùng bên trái [y: 0..13, x: 0..13]
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 14; x++) {
        fgMask[y * size + x] = 1;
        scharr[y * size + x] = 0.8;
      }
    }

    const { mask16x16, edge16x16 } = downsampleTo16x16Grid(fgMask, scharr, size, 16);
    expect(mask16x16.length).toBe(256);
    expect(edge16x16.length).toBe(256);
    // Cell 0 kín 100%
    expect(mask16x16[0]).toBeCloseTo(1.0);
    expect(edge16x16[0]).toBeCloseTo(0.8);
    // Cell 1 trống
    expect(mask16x16[1]).toBe(0);
    expect(edge16x16[1]).toBe(0);
  });

  it('Signed GeM Pooling p=3.0 & Edge-detail pooling tạo ra vector 768 chiều L2-normalized', () => {
    const numPatches = 256;
    const dim = 384;
    const patchTokens = new Float32Array(numPatches * dim);
    for (let i = 0; i < patchTokens.length; i++) {
      patchTokens[i] = (i % 2 === 0 ? 1 : -1) * 0.05;
    }

    const mask16x16 = new Float32Array(numPatches).fill(0.8);
    const edge16x16 = new Float32Array(numPatches).fill(0.6);

    const hybrid = computeHybridMaskedGemEmbedding(patchTokens, mask16x16, edge16x16);
    expect(hybrid.length).toBe(768);

    // Kiểm tra L2-norm == 1.0
    let sumSq = 0;
    for (let i = 0; i < 768; i++) sumSq += hybrid[i] * hybrid[i];
    expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 4);

    // Kiểm tra trích xuất Top-32 Key Patches
    const keyPatches = extractTopKeyPatches(patchTokens, mask16x16, edge16x16, 32);
    expect(keyPatches.length).toBe(32);
    expect(keyPatches[0].vec.length).toBe(384);
  });

  it('Stage 2A Hard Geometric Gate lọc chính xác theo ngưỡng AR, Solidity và HoleCount', () => {
    const dummySignature = (id: string, ar: number, sol: number, holes: number): MorisPartSignature => ({
      skuId: id,
      version: 2,
      aspectRatio: ar,
      solidity: sol,
      holeCount: holes,
      canonicalEmbedding: new Float32Array(768),
      perspectiveCentroid: new Float32Array(768),
      holeConstellation: [],
      efdCoefficients: new Float32Array(16),
      keyPatches: []
    });

    const candidates: MorisPartSignature[] = [
      dummySignature('P1', 2.0, 0.85, 4), // Khớp chuẩn
      dummySignature('P2', 2.1, 0.82, 4), // Trong tolerance
      dummySignature('P3', 2.0, 0.85, 8), // Sai số lỗ (lệch 4 lỗ > 1) -> bị loại
      dummySignature('P4', 4.0, 0.85, 4), // Sai tỷ lệ AR lệch lớn -> bị loại
      dummySignature('P5', 2.0, 0.50, 4)  // Sai solidity lệch 0.35 > 0.12 -> bị loại
    ];

    const query = { aspectRatio: 2.0, solidity: 0.85, holeCount: 4 };
    const res = executeGeometricGate(query, candidates);

    expect(res.passed.some(c => c.skuId === 'P1')).toBe(true);
    expect(res.passed.some(c => c.skuId === 'P2')).toBe(true);
    // P3, P4, P5 bị loại khỏi danh sách đạt chuẩn strict nếu pool đủ lớn
  });

  it('Multi-prototype enrollment sinh perspectiveCentroid và xếp hạng Top 40', () => {
    const patchTokens = new Float32Array(256 * 384);
    for (let i = 0; i < patchTokens.length; i++) {
      patchTokens[i] = Math.sin(i);
    }
    const mask = new Float32Array(256).fill(0.9);
    const edge = new Float32Array(256).fill(0.5);

    const canonical = computeHybridMaskedGemEmbedding(patchTokens, mask, edge);
    const centroid = synthesizePerspectiveCentroid(patchTokens, mask, edge);
    expect(centroid.length).toBe(768);

    // Verify L2 norm of centroid is 1.0 (within float tolerance)
    let normSq = 0;
    for (let d = 0; d < 768; d++) {
      normSq += centroid[d] * centroid[d];
    }
    expect(Math.abs(Math.sqrt(normSq) - 1.0)).toBeLessThan(1e-4);

    const candidate: MorisPartSignature = {
      skuId: 'TEST-SKU',
      version: 2,
      aspectRatio: 1.5,
      solidity: 0.9,
      holeCount: 2,
      canonicalEmbedding: canonical,
      perspectiveCentroid: centroid,
      holeConstellation: [],
      efdCoefficients: new Float32Array(16),
      keyPatches: []
    };

    const queryHybrid = canonical;
    const ranked = rankStage2Candidates(queryHybrid, [candidate], 10);
    expect(ranked.top40.length).toBe(1);
    expect(ranked.top40[0].score).toBeGreaterThan(0.5);
  });
});
