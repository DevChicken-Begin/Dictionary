import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// M27 (bổ sung 2026-10-19): khung vuông tracking nhận diện vật thể — helper
// chuẩn hoá bbox + reset state + ghim markup overlay trong index.html.
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
  return { methods: options.methods };
}

const { methods } = loadApp();

describe('M27 tracking box — subjectBoxToPercent', () => {
  it('bbox hợp lệ -> % theo vùng phân tích (bao gồm +1 pixel biên)', () => {
    expect(methods.subjectBoxToPercent.call({}, { x0: 10, y0: 20, x1: 59, y1: 99 }, 100, 200))
      .toEqual({ left: 10, top: 10, width: 50, height: 40 });
  });

  it('clamp biên âm/vượt khung', () => {
    expect(methods.subjectBoxToPercent.call({}, { x0: -5, y0: -3, x1: 150, y1: 250 }, 100, 200))
      .toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('thiếu dữ liệu / bbox rỗng / đảo cạnh -> null', () => {
    expect(methods.subjectBoxToPercent.call({}, null, 100, 200)).toBeNull();
    expect(methods.subjectBoxToPercent.call({}, { x0: 1, y0: 1, x1: 2, y1: 2 }, 0, 0)).toBeNull();
    expect(methods.subjectBoxToPercent.call({}, { x0: 50, y0: 10, x1: 40, y1: 90 }, 100, 200)).toBeNull();
  });

  it('resetCameraLock xoá box cùng toàn bộ trạng thái lock', () => {
    const ctx = {
      camera: {
        lock: {
          enabled: true, seed: { fx: 0.5, fy: 0.5 }, ready: true,
          box: { left: 10, top: 10, width: 20, height: 20 },
          checks: {}, guidance: [], chips: [], stableCount: 3, samples: 3,
          agreement: 0.9, evidence: {}, evidenceSummary: 'x', lastError: ''
        }
      },
      stopCameraLockLoop: vi.fn()
    };
    methods.resetCameraLock.call(ctx);
    expect(ctx.camera.lock.box).toBeNull();
    expect(ctx.camera.lock.seed).toBeNull();
    expect(ctx.camera.lock.ready).toBe(false);
  });
});

describe('index.html — overlay khung vuông tracking', () => {
  const html = readFileSync('index.html', 'utf8');

  it('overlay bám camera.lock.box với 2 trạng thái nhận diện + không chặn tap', () => {
    expect(html).toContain('camera.lock.box');
    expect(html).toContain('Đang bám vật thể');
    expect(html).toContain('Đã nhận diện');
    const idx = html.indexOf('camera.lock.box');
    const block = html.slice(Math.max(0, idx - 200), idx + 700);
    expect(block).toContain('pointer-events-none');
  });
});
