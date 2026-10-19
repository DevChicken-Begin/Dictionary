import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../tools/png-decode.mjs';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function filterRow(type, raw, prev, bpp) {
  const out = Buffer.alloc(raw.length);
  for (let x = 0; x < raw.length; x++) {
    const a = x >= bpp ? raw[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = x >= bpp && prev ? prev[x - bpp] : 0;
    let pred = 0;
    if (type === 1) pred = a;
    else if (type === 2) pred = b;
    else if (type === 3) pred = (a + b) >> 1;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = (raw[x] - pred) & 0xff;
  }
  return out;
}

function encodePng(width, height, rgba, filterType = 0, overrides = {}) {
  const bpp = 4;
  const stride = width * bpp;
  const rows = [];
  let prev = null;
  for (let y = 0; y < height; y++) {
    const raw = Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride);
    rows.push(Buffer.from([filterType]), filterRow(filterType, raw, prev, bpp));
    prev = raw;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = overrides.bitDepth ?? 8;
  ihdr[9] = overrides.colorType ?? 6;
  ihdr[12] = overrides.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function samplePixels(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 37 + y * 11) & 0xff;
      data[i + 1] = (x * 5 + y * 61 + 17) & 0xff;
      data[i + 2] = (x * 90 + y * 3 + 200) & 0xff;
      data[i + 3] = 255 - ((x + y) & 0x7);
    }
  }
  return data;
}

describe('png-decode (M27 real-photo harness)', () => {
  it('giải mã đúng cho cả 5 loại filter PNG', () => {
    const width = 9;
    const height = 5;
    const pixels = samplePixels(width, height);
    for (let filterType = 0; filterType <= 4; filterType++) {
      const png = encodePng(width, height, pixels, filterType);
      const decoded = decodePng(png);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Array.from(decoded.data)).toEqual(Array.from(pixels));
    }
  });

  it('từ chối PNG interlaced và bit depth khác 8', () => {
    const pixels = samplePixels(4, 4);
    const interlaced = encodePng(4, 4, pixels, 0, { interlace: 1 });
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
    const sixteenBit = encodePng(4, 4, pixels, 0, { bitDepth: 16 });
    expect(() => decodePng(sixteenBit)).toThrow(/8-bit/);
  });

  it('từ chối chữ ký và dữ liệu hỏng', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow();
    const pixels = samplePixels(4, 4);
    const png = encodePng(4, 4, pixels, 0);
    const truncated = png.subarray(0, Math.floor(png.length / 2));
    expect(() => decodePng(truncated)).toThrow();
  });

  it('đọc được ảnh PNG kích thước lớn trong repo ("Simple/lỗ chữ L.png")', () => {
    const file = readFileSync('Simple/lỗ chữ L.png');
    const decoded = decodePng(file);
    expect(decoded.width).toBeGreaterThan(1000);
    expect(decoded.height).toBeGreaterThan(300);
    expect(decoded.data.length).toBe(decoded.width * decoded.height * 4);
  });
});
