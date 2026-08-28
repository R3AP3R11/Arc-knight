// 神像图标白线加粗：目标为“游戏内显示 5px/3px”
// 图标 1145px 默认显示约 110px，缩放 ≈0.096，源图需对应 52px / 31px
import fs from 'node:fs';
import zlib from 'node:zlib';
const SRC = 'e:/demo2/public/idol-clean.png';
const DST = 'e:/demo2/public/idol.png';
const OUTER_ROUNDS = 23;   // ≈(52-6)/2
const INNER_ROUNDS = 13;   // ≈(31-6)/2

const buf = fs.readFileSync(SRC);
let pos = 8, width = 0, height = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
  else if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * 4;
const px = Buffer.alloc(stride * height);
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1) + 1);
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? px[y * stride + x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
    let v = line[x];
    if (f === 1) v = (v + a) & 255;
    else if (f === 2) v = (v + b) & 255;
    else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    px[y * stride + x] = v;
  }
  prev = px.subarray(y * stride, (y + 1) * stride);
}

const isWhite = i => { const o = i * 4; return px[o] > 200 && px[o + 1] > 200 && px[o + 2] > 200 && px[o + 3] > 200; };
const isTransparent = i => px[i * 4 + 3] < 10;
const N = width * height;
const white = new Uint8Array(N);
const outer = new Uint8Array(N);
const inner = new Uint8Array(N);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x;
  if (!isWhite(i)) continue;
  white[i] = 1;
  const nearBg = (x > 0 && isTransparent(i - 1)) || (x < width - 1 && isTransparent(i + 1))
    || (y > 0 && isTransparent(i - width)) || (y < height - 1 && isTransparent(i + width));
  if (nearBg) outer[i] = 1; else inner[i] = 1;
}

const dilate = (src, rounds) => {
  let m = Buffer.from(src);
  for (let r = 0; r < rounds; r++) {
    const next = Buffer.from(m);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (m[i]) continue;
      if ((x > 0 && m[i - 1]) || (x < width - 1 && m[i + 1])
        || (y > 0 && m[i - width]) || (y < height - 1 && m[i + width])) next[i] = 1;
    }
    m = next;
  }
  return m;
};

const outerThick = dilate(outer, OUTER_ROUNDS);
const innerThick = dilate(inner, INNER_ROUNDS);
let painted = 0;
for (let i = 0; i < N; i++) {
  if (white[i] || outerThick[i] || innerThick[i]) {
    px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255;
    painted++;
  }
}

const CRC = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc32 = b => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const scan = Buffer.alloc(height * (stride + 1));
for (let y = 0; y < height; y++) { scan[y * (stride + 1)] = 0; px.copy(scan, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
fs.writeFileSync(DST, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]));
console.log(`done: outer+${OUTER_ROUNDS}轮, inner+${INNER_ROUNDS}轮, painted ${painted}px -> ${DST}`);
