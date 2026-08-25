// 一次性工具：剔除售货机图标黑色背景（从边缘泛洪，仅移除与外部连通的黑底）
import fs from 'node:fs';
import zlib from 'node:zlib';

const SRC = 'E:/demo2/图标/售货机.png';
const DST = 'e:/demo2/public/vending.png';

const buf = fs.readFileSync(SRC);
let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  throw new Error(`unsupported png: depth=${bitDepth} color=${colorType}`);
}
const channels = colorType === 6 ? 4 : 3;
const bpp = channels;
const stride = width * bpp;

// 解码扫描线（反向滤波）
const raw = zlib.inflateSync(Buffer.concat(idat));
const pixels = Buffer.alloc(stride * height);
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1) + 1);
  const cur = pixels.subarray(y * stride, (y + 1) * stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev[x];
    const c = x >= bpp ? prev[x - bpp] : 0;
    let v = line[x];
    if (filter === 1) v = (v + a) & 0xff;
    else if (filter === 2) v = (v + b) & 0xff;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    cur[x] = v;
  }
  prev = cur;
}

// 边缘泛洪：只移除与外部连通的黑色背景（先膨胀内容遮罩封住白边缝隙，内部像素全部保留原图）
const out = channels === 4 ? pixels : (() => {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3];
    rgba[i * 4 + 1] = pixels[i * 3 + 1];
    rgba[i * 4 + 2] = pixels[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
})();
const isBlack = i => {
  const o = i * 4;
  return out[o] < 46 && out[o + 1] < 46 && out[o + 2] < 46;
};

// 内容遮罩（非黑像素）+ 膨胀 4 轮，封住白边上的缺口，防止泛洪漏进内部
let content = new Uint8Array(width * height);
for (let i = 0; i < width * height; i++) content[i] = isBlack(i) ? 0 : 1;
for (let round = 0; round < 4; round++) {
  const next = Buffer.from(content);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (content[i]) continue;
      if ((x > 0 && content[i - 1]) || (x < width - 1 && content[i + 1])
        || (y > 0 && content[i - width]) || (y < height - 1 && content[i + width])) next[i] = 1;
    }
  }
  content = next;
}

const visited = new Uint8Array(width * height);
const stack = [];
const push = idx => { if (!visited[idx] && !content[idx] && isBlack(idx)) { visited[idx] = 1; stack.push(idx); } };
for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
let removed = 0;
while (stack.length) {
  const idx = stack.pop();
  out[idx * 4 + 3] = 0;
  removed++;
  const x = idx % width, y = (idx / width) | 0;
  if (x > 0) push(idx - 1);
  if (x < width - 1) push(idx + 1);
  if (y > 0) push(idx - width);
  if (y < height - 1) push(idx + width);
}
console.log(`bg removed: ${removed} / ${width * height} (${(removed / (width * height) * 100).toFixed(1)}%)`);

// 裁掉全透明边缘
let minX = width, minY = height, maxX = -1, maxY = -1;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  if (out[(y * width + x) * 4 + 3] > 0) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const crop = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  out.copy(crop, y * cw * 4, ((minY + y) * width + minX) * 4, ((minY + y) * width + minX + cw) * 4);
}

// 重编码 PNG（filter 0）
const CRC_TABLE = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = b => {
  let c = 0xffffffff;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(cw, 0);
ihdr.writeUInt32BE(ch, 4);
ihdr[8] = 8; ihdr[9] = 6;
const scanlines = Buffer.alloc(ch * (cw * 4 + 1));
for (let y = 0; y < ch; y++) {
  scanlines[y * (cw * 4 + 1)] = 0;
  crop.copy(scanlines, y * (cw * 4 + 1) + 1, y * cw * 4, (y + 1) * cw * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(scanlines)),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(DST, png);
console.log(`done: ${cw}x${ch} -> ${DST} (${png.length} bytes)`);
