import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PROFILE-01 (sổ nợ 2026-10-17): ghim hành vi fallback hiện tại của
// functions/_lib/moris/v5/vector/search.js — không silent error ở nhánh RPC chính.
const { rpcServiceMock } = vi.hoisted(() => ({ rpcServiceMock: vi.fn() }));

vi.mock('../functions/_lib/moris/v5/connectors/supabaseService.js', () => ({
  rpcService: rpcServiceMock
}));

import { searchVectorIndex } from '../functions/_lib/moris/v5/vector/search.js';

const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const config = {
  vector: {
    topK: 12,
    model: 'dinov2',
    modelVersion: 'v1',
    preprocessVersion: 'kim_canon_v3_letterbox',
    profile: 'hybrid_gem_edge_v1'
  }
};
const queryVector = [0.1, 0.2];

beforeEach(() => {
  rpcServiceMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searchVectorIndex fallback chain (PROFILE-01)', () => {
  it('v6 RPC thành công -> một lời gọi duy nhất, trả nguyên rows', async () => {
    rpcServiceMock.mockImplementation(async (_env, fn) => (
      fn === 'match_catalogue_image_vectors_v6' ? [{ record_id: 'a' }] : []
    ));

    const result = await searchVectorIndex(env, config, queryVector, 10);
    expect(result).toEqual([{ record_id: 'a' }]);
    expect(rpcServiceMock).toHaveBeenCalledTimes(1);
    const [, fn, args] = rpcServiceMock.mock.calls[0];
    expect(fn).toBe('match_catalogue_image_vectors_v6');
    expect(args).toMatchObject({
      p_embedding_model: 'dinov2',
      p_embedding_model_version: 'v1',
      p_preprocess_version: 'kim_canon_v3_letterbox',
      p_embedding_profile: 'hybrid_gem_edge_v1',
      p_match_count: 10
    });
  });

  it('v6 lỗi -> fallback production RPC cùng tham số (profile giữ nguyên)', async () => {
    rpcServiceMock.mockImplementation(async (_env, fn) => {
      if (fn === 'match_catalogue_image_vectors_v6') throw new Error('v6 chưa migrate');
      return [{ record_id: 'prod' }];
    });

    const result = await searchVectorIndex(env, config, queryVector, 10);
    expect(result).toEqual([{ record_id: 'prod' }]);
    expect(rpcServiceMock).toHaveBeenCalledTimes(2);
    const [, fn, args] = rpcServiceMock.mock.calls[1];
    expect(fn).toBe('match_catalogue_image_vectors');
    expect(args.p_embedding_profile).toBe('hybrid_gem_edge_v1');
  });

  it('v6 + production đều lỗi -> console.warn (không im lặng) rồi vẫn thử profile legacy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcServiceMock.mockImplementation(async (_env, fn, args) => {
      if (fn === 'match_catalogue_image_vectors_v6') throw new Error('v6 down');
      if (args.p_embedding_profile === 'cls_l2_v1') return [{ record_id: 'legacy' }];
      throw new Error('prod down');
    });

    const result = await searchVectorIndex(env, config, queryVector, 10);
    expect(result).toEqual([{ record_id: 'legacy' }]);
    expect(warn).toHaveBeenCalledWith('searchVectorIndex RPC failed:', 'prod down');
    const [, fn, args] = rpcServiceMock.mock.calls[2];
    expect(fn).toBe('match_catalogue_image_vectors');
    expect(args).toMatchObject({
      p_preprocess_version: 'kim_canon_v2',
      p_embedding_profile: 'cls_l2_v1'
    });
  });

  it('v6 trả rỗng + profile mới -> fallback profile legacy 1.090 vector production', async () => {
    rpcServiceMock.mockImplementation(async (_env, fn, args) => {
      if (args.p_embedding_profile === 'cls_l2_v1') return [{ record_id: 'legacy' }];
      return [];
    });

    const result = await searchVectorIndex(env, config, queryVector, 10);
    expect(result).toEqual([{ record_id: 'legacy' }]);
    expect(rpcServiceMock).toHaveBeenCalledTimes(2);
    expect(rpcServiceMock.mock.calls[1][2].p_embedding_profile).toBe('cls_l2_v1');
  });

  it('profile đang là cls_l2_v1 + rỗng -> không gọi lặp legacy, trả []', async () => {
    rpcServiceMock.mockResolvedValue([]);
    const legacyConfig = { vector: { ...config.vector, profile: 'cls_l2_v1' } };

    const result = await searchVectorIndex(env, legacyConfig, queryVector, 10);
    expect(result).toEqual([]);
    expect(rpcServiceMock).toHaveBeenCalledTimes(1);
  });

  it('legacy fallback lỗi -> nuốt lỗi, trả [] (không ném ra orchestrator)', async () => {
    rpcServiceMock.mockImplementation(async (_env, fn) => {
      if (fn === 'match_catalogue_image_vectors_v6') throw new Error('down');
      throw new Error('all down');
    });

    await expect(searchVectorIndex(env, config, queryVector, 10)).resolves.toEqual([]);
  });

  it('matchCount clamp [1,100]; 0/undefined dùng topK; vector literal 8 chữ số', async () => {
    rpcServiceMock.mockResolvedValue([]);

    await searchVectorIndex(env, config, queryVector, 500);
    expect(rpcServiceMock.mock.calls[0][2].p_match_count).toBe(100);
    expect(rpcServiceMock.mock.calls[0][2].p_query_embedding).toBe('[0.10000000,0.20000000]');

    rpcServiceMock.mockClear();
    await searchVectorIndex(env, config, queryVector, 0);
    expect(rpcServiceMock.mock.calls[0][2].p_match_count).toBe(config.vector.topK);

    rpcServiceMock.mockClear();
    await searchVectorIndex(env, config, queryVector);
    expect(rpcServiceMock.mock.calls[0][2].p_match_count).toBe(config.vector.topK);
  });
});
