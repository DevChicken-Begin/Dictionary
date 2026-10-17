import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8) throw new Error('PNG quá ngắn');
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('Chữ ký PNG không hợp lệ');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) throw new Error('Chunk PNG vượt quá kích thước file');
    if (type === 'IHDR') {
      if (length < 13) throw new Error('IHDR không hợp lệ');
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height) throw new Error('PNG thiếu IHDR hợp lệ');
  if (bitDepth !== 8) throw new Error(`Chỉ hỗ trợ PNG 8-bit (gặp ${bitDepth})`);
  if (interlace !== 0) throw new Error('Không hỗ trợ PNG interlaced (Adam7)');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Chỉ hỗ trợ PNG RGB/RGBA (color type ${colorType})`);
  }
  if (!idat.length) throw new Error('PNG thiếu dữ liệu IDAT');

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const expected = height * (stride + 1);
  if (raw.length < expected) throw new Error('Dữ liệu PNG không đủ để dựng ảnh');

  const rgba = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const src = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = new Uint8Array(stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (filter === 0) {
        // no-op
      } else if (filter === 1) {
        v = (v + a) & 0xff;
      } else if (filter === 2) {
        v = (v + b) & 0xff;
      } else if (filter === 3) {
        v = (v + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 0xff;
      } else {
        throw new Error(`PNG filter không hợp lệ: ${filter}`);
      }
      cur[x] = v;
    }

    let o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      rgba[o++] = cur[s];
      rgba[o++] = cur[s + 1];
      rgba[o++] = cur[s + 2];
      rgba[o++] = channels === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }

  return { width, height, data: rgba };
}
