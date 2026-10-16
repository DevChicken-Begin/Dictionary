import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function editor() {
  let options;
  const embed = vi.fn(() => { throw new Error('Forbidden model call'); });
  const fetch = vi.fn(() => { throw new Error('Unexpected network'); });
  const timer = vi.fn();
  vm.runInNewContext(readFileSync('src/app.js', 'utf8'), {
    Vue: { createApp(o) { options = o; return { mount() {} }; }, nextTick: vi.fn() },
    window: { addEventListener() {} }, atob, console, fetch, setTimeout: timer,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }
  });
  const ctx = { ...options.methods, canEdit: true, session: { token: 'test' },
    editor: { form: { id: 'part', code: 'abc' }, assets: [{ asset_type: 'front', image_path: 'old.webp' }], files: {}, previews: {} },
    rpcRow: vi.fn(async () => ({ ok: true, id: 'part' })), rpcRows: vi.fn(async () => []),
    uploadToR2: vi.fn(async (_, code, type) => ({ asset_type: type, image_path: `${code}/${type}.webp` })),
    loadMorisBrowserVectorModule: embed, embedMorisImage: embed,
    toast: vi.fn(), closeEditor: vi.fn(), closeDetail: vi.fn(), loadParts: vi.fn(), readError: e => e.message,
    freshToken: async () => 'test', isSessionExpired: () => false, isSystemAdmin: () => false,
  };
  return { ctx, options, embed, fetch, timer };
}

describe('M02 Editor writes metadata/images only', () => {
  it.each(['create', 'metadata', 'image', 'repeat'])('%s save has zero index/model side effects', async kind => {
    const { ctx, embed, fetch } = editor();
    if (kind === 'create') ctx.editor.form.id = null;
    if (kind === 'image') await ctx.onFileChange('front', 1, { target: { files: [{ name: 'photo.png' }], value: 'photo' } });
    for (let i = 0; i < (kind === 'repeat' ? 10 : 1); i++) await ctx.savePart();
    expect(ctx.toast).toHaveBeenCalledWith('success', 'Lưu dữ liệu thành công!');
    expect(ctx.rpcRow.mock.calls.every(([name]) => ['app_upsert_part_metadata', 'app_replace_part_assets'].includes(name))).toBe(true);
    expect(ctx.rpcRow).toHaveBeenCalledWith('app_replace_part_assets', expect.objectContaining({ p_image_id: 'part' }));
    if (kind === 'image') expect(ctx.uploadToR2).toHaveBeenCalledTimes(2);
    expect(embed).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('session restore does not schedule a legacy queue', async () => {
    const { ctx, embed, timer, fetch } = editor();
    await ctx.checkSession();
    expect(ctx.loadParts).toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('exposes no Editor index entry points or UI button', () => {
    const { options } = editor();
    for (const name of ['vectorizeSavedPart', 'vectorizeCurrentEditorPart', 'enqueueMorisVectorJob', 'processMorisVectorQueue', 'upsertMorisVectors']) expect(options.methods[name]).toBeUndefined();
    const source = readFileSync('src/app.js', 'utf8');
    expect(source).not.toContain('enrollSkuSignatureV2');
    expect(source).not.toContain('/api/moris/vector-upsert');
    expect(readFileSync('index.html', 'utf8')).not.toContain('@click="vectorizeCurrentEditorPart"');
    expect(typeof options.methods.buildMorisQueryVector).toBe('function');
    expect(typeof options.methods.removeMorisVectorJobs).toBe('function');
  });
});
