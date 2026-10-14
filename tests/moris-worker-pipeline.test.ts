import { describe, it, expect, beforeEach } from 'vitest';
import {
  enrollSkuSignature,
  searchPartTop10,
  reindexBatchSignatures
} from '../src/moris/moris-worker-pipeline.js';
import { clearAllSignatures, countSignatures } from '../src/moris/moris-idb.js';

describe('moris-worker-pipeline: End-to-End 3-Layer Integration', () => {
  beforeEach(async () => {
    await clearAllSignatures();
  });

  // Mock extractor mô phỏng DINOv2 ONNX output [1, 257, 384]
  const mockDinov2Extractor = async (tensor: Float32Array) => {
    const totalFloats = 257 * 384;
    const data = new Float32Array(totalFloats);
    // Điền dữ liệu giả lập từ tensor đầu vào để có tính chất phụ thuộc ảnh
    for (let i = 0; i < totalFloats; i++) {
      data[i] = ((i % 17) - 8) * 0.05 + (tensor[i % tensor.length] || 0) * 0.01;
    }
    return { data, dims: [1, 257, 384] };
  };

  // Tạo ảnh mẫu linh kiện 100x60 có đục lỗ
  function createSamplePartRgba(width = 100, height = 60, holes = 2) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Nền sáng
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 240;
      rgba[i * 4 + 1] = 240;
      rgba[i * 4 + 2] = 240;
      rgba[i * 4 + 3] = 255;
    }

    // Thân kim loại [10..50, 15..85]
    for (let y = 10; y < 50; y++) {
      for (let x = 15; x < 85; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 45;
        rgba[idx + 1] = 45;
        rgba[idx + 2] = 48;
        rgba[idx + 3] = 255;
      }
    }

    // Đục lỗ nếu có
    if (holes >= 1) {
      for (let y = 25; y < 35; y++) {
        for (let x = 30; x < 40; x++) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 240;
          rgba[idx + 1] = 240;
          rgba[idx + 2] = 240;
        }
      }
    }
    if (holes >= 2) {
      for (let y = 25; y < 35; y++) {
        for (let x = 60; x < 70; x++) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 240;
          rgba[idx + 1] = 240;
          rgba[idx + 2] = 240;
        }
      }
    }

    return { rgba, width, height };
  }

  it('Đăng ký linh kiện mới (enrollSkuSignature) qua 3 lớp và lưu vào IndexedDB', async () => {
    const part = createSamplePartRgba(100, 60, 2);
    const sig = await enrollSkuSignature(
      'SKU-TEST-001',
      part.rgba,
      part.width,
      part.height,
      mockDinov2Extractor
    );

    expect(sig.skuId).toBe('SKU-TEST-001');
    expect(sig.version).toBe(2);
    expect(sig.canonicalEmbedding.length).toBe(768);
    expect(sig.perspectiveCentroid.length).toBe(768);
    expect(sig.holeCount).toBe(2);
    expect(sig.efdCoefficients.length).toBe(16);
    expect(sig.keyPatches.length).toBeGreaterThan(0);

    const count = await countSignatures();
    expect(count).toBe(1);
  });

  it('Tìm kiếm ảnh Query qua phễu 3 lớp: Funnel 850 -> Gate -> Top 40 -> Rerank Top 10', async () => {
    // Đăng ký 5 mã với cấu trúc hình học khác nhau
    const part2Holes = createSamplePartRgba(100, 60, 2);
    const part1Hole = createSamplePartRgba(100, 60, 1);
    const partNoHole = createSamplePartRgba(100, 60, 0);

    await enrollSkuSignature('PART-TARGET-2H', part2Holes.rgba, part2Holes.width, part2Holes.height, mockDinov2Extractor);
    await enrollSkuSignature('PART-1H', part1Hole.rgba, part1Hole.width, part1Hole.height, mockDinov2Extractor);
    await enrollSkuSignature('PART-0H', partNoHole.rgba, partNoHole.width, partNoHole.height, mockDinov2Extractor);

    // Tìm kiếm với ảnh Query có 2 lỗ
    const queryPart = createSamplePartRgba(100, 60, 2);
    const res = await searchPartTop10(
      queryPart.rgba,
      queryPart.width,
      queryPart.height,
      mockDinov2Extractor
    );

    expect(res.top10.length).toBeGreaterThan(0);
    expect(res.top10[0].skuId).toBe('PART-TARGET-2H');
    expect(res.top10[0].rank).toBe(1);
    expect(res.totalCandidates).toBe(3);
  });

  it('Batch re-indexing utility cho danh sách SKUs', async () => {
    const items = [
      { skuId: 'BATCH-01', ...createSamplePartRgba(80, 50, 1) },
      { skuId: 'BATCH-02', ...createSamplePartRgba(80, 50, 2) },
      { skuId: 'BATCH-03', ...createSamplePartRgba(80, 50, 0) }
    ];

    let progressCalls = 0;
    const res = await reindexBatchSignatures(
      items,
      mockDinov2Extractor,
      (_processed, _total) => {
        progressCalls++;
      }
    );

    expect(res.enrolled).toBe(3);
    expect(res.errors.length).toBe(0);
    expect(progressCalls).toBe(3);

    const count = await countSignatures();
    expect(count).toBe(3);
  });
});
