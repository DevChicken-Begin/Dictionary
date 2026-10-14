import { describe, it, expect } from 'vitest';
import {
  computeConvexHull,
  computePolygonArea,
  rgbToCieLuminance,
  computeScharrGradient,
  computeChamferDistanceTransform,
  buildStructuralPseudoRGBTensor,
  processLayer1Optical
} from '../src/moris/moris-layer1-optical.js';

describe('moris-layer1-optical: Layer 1 Optical Normalization', () => {
  it('Andrew Monotone Chain convex hull & Shoelace area tính chính xác', () => {
    // Hình vuông 10x10 có 4 góc (0,0), (10,0), (10,10), (0,10)
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // điểm bên trong
      { x: 2, y: 3 }
    ];
    const hull = computeConvexHull(points);
    expect(hull.length).toBe(4);
    const area = computePolygonArea(hull);
    expect(area).toBe(100);
  });

  it('CIE 1976 L* Luminance chuyển đổi chính xác từ sRGB', () => {
    // Màu đen (0, 0, 0) -> L = 0
    expect(rgbToCieLuminance(0, 0, 0)).toBe(0);
    // Màu trắng (255, 255, 255) -> L = 100
    expect(Math.round(rgbToCieLuminance(255, 255, 255))).toBe(100);
    // Màu xám trung tính (128, 128, 128) -> L xấp xỉ 53.58
    const grayL = rgbToCieLuminance(128, 128, 128);
    expect(grayL).toBeGreaterThan(50);
    expect(grayL).toBeLessThan(60);
  });

  it('Scharr 3x3 Gradient và Two-Pass Chamfer tính chính xác trên mask', () => {
    const size = 224;
    const mask = new Uint8Array(size * size);
    // Tạo một vùng linh kiện chữ nhật ở giữa [50..170, 50..170]
    for (let y = 50; y < 170; y++) {
      for (let x = 50; x < 170; x++) {
        mask[y * size + x] = 1;
      }
    }

    const dummyLuma = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      dummyLuma[i] = mask[i] ? 0.8 : 0.0;
    }

    const grad = computeScharrGradient(dummyLuma, mask, size);
    expect(grad.length).toBe(size * size);
    // Điểm ở đường viền biên (50, 50) tiếp giáp với vùng 0 có gradient lớn hơn 0
    expect(grad[50 * size + 50]).toBeGreaterThan(0);

    const chamfer = computeChamferDistanceTransform(mask, size, size);
    expect(chamfer.length).toBe(size * size);
    // Điểm ngoài vật thể (40, 40) có khoảng cách chamfer = 0
    expect(chamfer[40 * size + 40]).toBe(0);
    // Điểm sâu bên trong tâm (110, 110) có khoảng cách chamfer lớn hơn điểm mép viền (50, 50)
    expect(chamfer[110 * size + 110]).toBeGreaterThan(chamfer[50 * size + 50]);
  });

  it('Pseudo-RGB Tensor đạt đúng kích thước [1, 3, 224, 224] và ImageNet mean/std', () => {
    const size = 224 * 224;
    const ch0 = new Float32Array(size).fill(0.485); // mean của channel 0
    const ch1 = new Float32Array(size).fill(0.456); // mean của channel 1
    const ch2 = new Float32Array(size).fill(0.406); // mean của channel 2

    const tensor = buildStructuralPseudoRGBTensor(ch0, ch1, ch2);
    expect(tensor.length).toBe(3 * 224 * 224);
    // Khi input = mean thì (val - mean)/std = 0
    expect(Math.abs(tensor[0])).toBeLessThan(1e-5);
    expect(Math.abs(tensor[size])).toBeLessThan(1e-5);
    expect(Math.abs(tensor[2 * size])).toBeLessThan(1e-5);
  });

  it('Quy trình Layer 1 hoàn chỉnh phân tách vật thể kim loại có lỗ đục chuẩn xác', () => {
    const width = 120;
    const height = 80;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Nền sáng (r:240, g:240, b:240, a:255)
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 240;
      rgba[i * 4 + 1] = 240;
      rgba[i * 4 + 2] = 240;
      rgba[i * 4 + 3] = 255;
    }

    // Linh kiện kim loại tối màu ở giữa [y: 15..65, x: 20..100]
    for (let y = 15; y < 65; y++) {
      for (let x = 20; x < 100; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 40;
        rgba[idx + 1] = 42;
        rgba[idx + 2] = 45;
        rgba[idx + 3] = 255;
      }
    }

    // Đục 1 lỗ tròn ở tâm [y: 35..45, x: 55..65] (màu nền sáng)
    for (let y = 35; y < 45; y++) {
      for (let x = 55; x < 65; x++) {
        const idx = (y * width + x) * 4;
        rgba[idx] = 240;
        rgba[idx + 1] = 240;
        rgba[idx + 2] = 240;
        rgba[idx + 3] = 255;
      }
    }

    const result = processLayer1Optical(rgba, width, height);

    expect(result.fgMask.length).toBe(224 * 224);
    expect(result.canonicalRgba.length).toBe(224 * 224 * 4);
    expect(result.pseudoRgbTensor.length).toBe(3 * 224 * 224);
    expect(result.holeCount).toBe(1);
    expect(result.solidity).toBeGreaterThan(0.7);
    expect(result.solidity).toBeLessThanOrEqual(1.0);
    expect(result.aspectRatio).toBeGreaterThan(1.0); // Bề ngang 80px > bề dọc 50px
    expect(result.outerContour.length).toBeGreaterThan(10);
  });
});
