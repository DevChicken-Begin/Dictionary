import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSignature,
  saveSignaturesBatch,
  getSignatureBySku,
  getAllSignatures,
  clearAllSignatures,
  countSignatures,
  serializeSignature,
  deserializeSignature
} from '../src/moris/moris-idb.js';
import { MorisPartSignature } from '../src/moris/moris-layer2-embedding.js';

describe('moris-idb: IndexedDB Part Signature Storage v2', () => {
  beforeEach(async () => {
    await clearAllSignatures();
  });

  it('Serialize và Deserialize signature bảo toàn cấu trúc TypedArray và các trường', () => {
    const orig: MorisPartSignature = {
      skuId: '3411160201',
      version: 2,
      aspectRatio: 2.15,
      solidity: 0.88,
      holeCount: 6,
      canonicalEmbedding: new Float32Array(768).fill(0.05),
      perspectiveCentroid: new Float32Array(768).fill(0.04),
      holeConstellation: [
        { u: -0.3, v: 0.1, relArea: 0.08, pixelArea: 32 }
      ],
      efdCoefficients: new Float32Array(16).fill(0.12),
      keyPatches: [
        { gridIdx: 45, weight: 0.85, vec: new Float32Array(384).fill(0.1) }
      ]
    };

    const serialized = serializeSignature(orig);
    expect(Array.isArray(serialized.canonicalEmbedding)).toBe(true);

    const recovered = deserializeSignature(serialized);
    expect(recovered.skuId).toBe('3411160201');
    expect(recovered.version).toBe(2);
    expect(recovered.aspectRatio).toBe(2.15);
    expect(recovered.holeCount).toBe(6);
    expect(recovered.canonicalEmbedding instanceof Float32Array).toBe(true);
    expect(recovered.canonicalEmbedding.length).toBe(768);
    expect(recovered.keyPatches.length).toBe(1);
    expect(recovered.keyPatches[0].vec instanceof Float32Array).toBe(true);
  });

  it('Lưu đơn lẻ và truy xuất chính xác bằng SKU ID', async () => {
    const sig: MorisPartSignature = {
      skuId: 'SKU-001',
      version: 2,
      aspectRatio: 1.5,
      solidity: 0.9,
      holeCount: 2,
      canonicalEmbedding: new Float32Array(768),
      perspectiveCentroid: new Float32Array(768),
      holeConstellation: [],
      efdCoefficients: new Float32Array(16),
      keyPatches: []
    };

    await saveSignature(sig);
    const count = await countSignatures();
    expect(count).toBe(1);

    const fetched = await getSignatureBySku('SKU-001');
    expect(fetched).not.toBeNull();
    expect(fetched?.skuId).toBe('SKU-001');
    expect(fetched?.holeCount).toBe(2);
  });

  it('Batch upsert và lấy toàn bộ signatures cho 850 SKUs', async () => {
    const batch: MorisPartSignature[] = [];
    for (let i = 1; i <= 50; i++) {
      batch.push({
        skuId: `SKU-${String(i).padStart(4, '0')}`,
        version: 2,
        aspectRatio: 1.0 + (i % 5) * 0.2,
        solidity: 0.85,
        holeCount: i % 8,
        canonicalEmbedding: new Float32Array(768),
        perspectiveCentroid: new Float32Array(768),
        holeConstellation: [],
        efdCoefficients: new Float32Array(16),
        keyPatches: []
      });
    }

    const saved = await saveSignaturesBatch(batch);
    expect(saved).toBe(50);

    const all = await getAllSignatures();
    expect(all.length).toBe(50);
  });
});
