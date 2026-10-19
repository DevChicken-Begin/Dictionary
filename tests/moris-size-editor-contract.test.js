import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as sizeContract from '../src/moris/size-contract.js';

// Gate D (2026-10-19): test hành vi thật cho 2 ô size trong editor + wiring RPC
// app_upsert_part_dimensions / app_get_part_dimensions. Nạp src/app.js thật qua vm
// (pattern tests/moris-size-ui-contract.test.js).
function loadApp() {
  let options;
  vm.runInNewContext(readFileSync('src/app.js', 'utf8'), {
    Vue: { createApp(o) { options = o; return { mount() {} }; } },
    window: { addEventListener() {} },
    atob,
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {}
  });
  return { methods: options.methods, computed: options.computed };
}

const { methods, computed } = loadApp();

function formCtx(form, overrides = {}) {
  return {
    session: { token: 'tok' },
    editor: { form },
    loadSizeContractModule: async () => sizeContract,
    ...overrides
  };
}

function saveCtx(form, overrides = {}) {
  const calls = [];
  const ctx = {
    canEdit: true,
    saving: false,
    toast: vi.fn(),
    readError: (e) => String(e?.message || e),
    session: { token: 'tok' },
    loadSizeContractModule: async () => sizeContract,
    readEditorSize: methods.readEditorSize,
    editor: {
      form: { id: 'uuid-1', code: 'abc', part_id: '', usage_side: 'unknown', identifying_features: '', confusing_note: '', size_length: '', size_width: '', ...form },
      assets: [{ asset_type: 'thumb', image_path: 'thumb/ABC.webp', image_name: 'a.webp', sort_order: 1 }],
      files: {},
      previews: {}
    },
    rpcRow: vi.fn(async (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'app_upsert_part_metadata') return { ok: true, id: 'uuid-1' };
      return { ok: true };
    }),
    purgeR2Assets: vi.fn(),
    closeEditor: vi.fn(),
    closeDetail: vi.fn(),
    loadParts: vi.fn(),
    ...overrides
  };
  return { ctx, calls };
}

describe('M28 Gate D — form editor có trường size', () => {
  it('emptyForm có size_length/size_width mặc định rỗng', () => {
    const form = methods.emptyForm.call({});
    expect(form.size_length).toBe('');
    expect(form.size_width).toBe('');
  });

  it('editorSizeHint phản ánh trạng thái nhập (trống/thiếu/sai/quá cỡ/hợp lệ)', () => {
    const hint = (form) => computed.editorSizeHint.call({ editor: { form } });
    expect(hint({})).toContain('Tùy chọn');
    expect(hint({ size_length: '80' })).toBe('Lưu cạnh dài 80 mm — nhập thêm cạnh ngắn để lọc chính xác hơn');
    expect(hint({ size_width: '80' })).toBe('Cần nhập cạnh dài (mm) — cạnh ngắn có thể để trống');
    expect(hint({ size_length: '0', size_width: '80' })).toBe('Số đo phải lớn hơn 0');
    expect(hint({ size_length: 'abc' })).toBe('Số đo phải lớn hơn 0');
    expect(hint({ size_length: '6000', size_width: '80' })).toBe('Số đo tối đa 5000mm');
    expect(hint({ size_length: '80', size_width: '120' })).toBe('Lưu 120 × 80 mm');
    expect(hint({ size_length: '80,5', size_width: '120' })).toBe('Lưu 120 × 80.5 mm');
  });

  it('readEditorSize S1.1: trống cả 2 -> empty; chỉ cạnh ngắn -> error; chỉ cạnh dài -> hợp lệ (width null)', async () => {
    expect(await methods.readEditorSize.call(formCtx({}))).toEqual({ empty: true });
    const shortOnly = await methods.readEditorSize.call(formCtx({ size_width: '80' }));
    expect(shortOnly.error).toContain('cạnh dài');
    expect(await methods.readEditorSize.call(formCtx({ size_length: '80' })))
      .toEqual({ length_mm: 80, width_mm: null });
  });

  it('readEditorSize: hoán vị L >= W + chấp nhận dấu phẩy thập phân', async () => {
    expect(await methods.readEditorSize.call(formCtx({ size_length: '80', size_width: '120' })))
      .toEqual({ length_mm: 120, width_mm: 80 });
    expect(await methods.readEditorSize.call(formCtx({ size_length: '80,5', size_width: '120,25' })))
      .toEqual({ length_mm: 120.25, width_mm: 80.5 });
  });

  it('readEditorSize: sai/âm/quá cỡ -> error, không ném', async () => {
    for (const form of [
      { size_length: 'abc', size_width: '80' },
      { size_length: '-5', size_width: '80' },
      { size_length: '6000', size_width: '80' }
    ]) {
      const out = await methods.readEditorSize.call(formCtx(form));
      expect(out.error, JSON.stringify(form)).toBeTruthy();
    }
  });

  it('readEditorSize: module lỗi -> fallback inline vẫn hoán vị/partial, quá cỡ vẫn error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = formCtx({ size_length: '80', size_width: '120' }, {
        loadSizeContractModule: async () => { throw new Error('offline'); }
      });
      expect(await methods.readEditorSize.call(ctx)).toEqual({ length_mm: 120, width_mm: 80 });
      expect(warn).toHaveBeenCalled();

      const partial = formCtx({ size_length: '80' }, {
        loadSizeContractModule: async () => { throw new Error('offline'); }
      });
      expect(await methods.readEditorSize.call(partial)).toEqual({ length_mm: 80, width_mm: null });

      const over = formCtx({ size_length: '9000', size_width: '80' }, {
        loadSizeContractModule: async () => { throw new Error('offline'); }
      });
      expect((await methods.readEditorSize.call(over)).error).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });

  it('loadEditorSize: gọi RPC khi có id, điền lại 2 ô; lỗi RPC -> để trống, không ném', async () => {
    const ctx = formCtx({ id: 'uuid-9', size_length: '1', size_width: '1' }, {
      rpcRow: vi.fn(async () => ({ ok: true, length_mm: 52.5, width_mm: 30 }))
    });
    await methods.loadEditorSize.call(ctx);
    expect(ctx.rpcRow).toHaveBeenCalledWith('app_get_part_dimensions', expect.objectContaining({ p_image_id: 'uuid-9' }));
    expect(ctx.editor.form.size_length).toBe('52.5');
    expect(ctx.editor.form.size_width).toBe('30');

    const partialRow = formCtx({ id: 'uuid-9', size_length: '1', size_width: '1' }, {
      rpcRow: vi.fn(async () => ({ ok: true, length_mm: 52.5, width_mm: null }))
    });
    await methods.loadEditorSize.call(partialRow);
    expect(partialRow.editor.form.size_length).toBe('52.5');
    expect(partialRow.editor.form.size_width).toBe('');

    const fail = formCtx({ id: 'uuid-9', size_length: '9', size_width: '9' }, {
      rpcRow: vi.fn(async () => { throw new Error('missing table'); })
    });
    await methods.loadEditorSize.call(fail);
    expect(fail.editor.form.size_length).toBe('');
    expect(fail.editor.form.size_width).toBe('');

    const noId = formCtx({ id: null, size_length: '9', size_width: '9' }, { rpcRow: vi.fn() });
    await methods.loadEditorSize.call(noId);
    expect(noId.rpcRow).not.toHaveBeenCalled();
    expect(noId.editor.form.size_length).toBe('');
  });

  it('openEditor(id): nạp size đã lưu vào form', async () => {
    const ctx = {
      canEdit: true,
      toast: vi.fn(),
      clearEditorFiles: vi.fn(),
      renderIcons: vi.fn(),
      session: { token: 'tok' },
      editor: { open: false, form: null, assets: [], files: {}, previews: {} },
      rpcRows: vi.fn(async () => []),
      rpcRow: vi.fn(async (fn) => (fn === 'app_get_part_dimensions' ? { ok: true, length_mm: 52.5, width_mm: 30 } : null)),
      loadEditorSize: methods.loadEditorSize
    };
    await methods.openEditor.call(ctx, { id: 'uuid-9', code: 'X' });
    expect(ctx.editor.open).toBe(true);
    expect(ctx.editor.form.size_length).toBe('52.5');
    expect(ctx.editor.form.size_width).toBe('30');
  });

  it('savePart: nhập size -> gọi app_upsert_part_dimensions với cặp L >= W đã chuẩn hoá', async () => {
    const { ctx, calls } = saveCtx({ size_length: '80', size_width: '120' });
    await methods.savePart.call(ctx);
    const dim = calls.find(([fn]) => fn === 'app_upsert_part_dimensions');
    expect(dim).toBeTruthy();
    expect(dim[1]).toMatchObject({ p_image_id: 'uuid-1', p_length_mm: 120, p_width_mm: 80 });
    expect(calls.find(([fn]) => fn === 'app_upsert_part_metadata')).toBeTruthy();
    expect(ctx.toast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('savePart: để trống cả 2 ô -> không gọi RPC dims', async () => {
    const { ctx, calls } = saveCtx({ size_length: '', size_width: '' });
    await methods.savePart.call(ctx);
    expect(calls.find(([fn]) => fn === 'app_upsert_part_dimensions')).toBeUndefined();
    expect(calls.find(([fn]) => fn === 'app_upsert_part_metadata')).toBeTruthy();
  });

  it('savePart S1.1: chỉ nhập cạnh dài -> lưu partial (p_width_mm null), vẫn hoạt động', async () => {
    const { ctx, calls } = saveCtx({ size_length: '80', size_width: '' });
    await methods.savePart.call(ctx);
    const dim = calls.find(([fn]) => fn === 'app_upsert_part_dimensions');
    expect(dim).toBeTruthy();
    expect(dim[1]).toMatchObject({ p_length_mm: 80, p_width_mm: null });
    expect(calls.find(([fn]) => fn === 'app_upsert_part_metadata')).toBeTruthy();
  });

  it('savePart: chỉ nhập cạnh ngắn (thiếu cạnh dài) -> chặn trước khi gọi metadata (không upload)', async () => {
    const { ctx, calls } = saveCtx({ size_length: '', size_width: '80' });
    const upload = vi.fn();
    ctx.uploadToR2 = upload;
    await methods.savePart.call(ctx);
    expect(calls.find(([fn]) => fn === 'app_upsert_part_metadata')).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
    expect(ctx.toast).toHaveBeenCalledWith('error', expect.stringContaining('cạnh'));
  });

  it('savePart: RPC dims trả lỗi -> dừng lưu, không im lặng', async () => {
    const { ctx } = saveCtx({ size_length: '80', size_width: '120' });
    ctx.rpcRow = vi.fn(async (fn) => {
      if (fn === 'app_upsert_part_metadata') return { ok: true, id: 'uuid-1' };
      if (fn === 'app_upsert_part_dimensions') return { ok: false, message: 'Không tìm thấy mã linh kiện để lưu kích thước.' };
      return { ok: true };
    });
    await methods.savePart.call(ctx);
    expect(ctx.toast).toHaveBeenCalledWith('error', expect.stringContaining('kích thước'));
  });
});
