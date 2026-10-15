// Pravi PNG ikonice za početni ekran telefona: node scripts/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const A = [0x00, 0x7a, 0xff];
const B = [0xaf, 0x52, 0xde];
const BARS = [
  [6, 8, 18],
  [6, 12, 18],
  [6, 16, 13]
]; // [x1, y, x2] na mreži 24×24, kao SVG ikonica
const STROKE = 2.4;

function capsuleDist(px, py, [x1, y, x2]) {
  const cx = Math.max(x1, Math.min(x2, px));
  return Math.hypot(px - cx, py - y);
}

function insideRoundedRect(x, y, size, r) {
  const dx = Math.max(r - x, 0, x - (size - r));
  const dy = Math.max(r - y, 0, y - (size - r));
  return dx * dx + dy * dy <= r * r;
}

function render(size, { rounded, contentScale }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  const unit = (size * contentScale) / 24;
  const offset = (size - 24 * unit) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (rounded && !insideRoundedRect(fx, fy, size, size * 0.225)) continue;
          const t = (fx + fy) / (2 * size);
          let c = A.map((v, i) => v + (B[i] - v) * t);
          const ux = (fx - offset) / unit;
          const uy = (fy - offset) / unit;
          if (BARS.some((bar) => capsuleDist(ux, uy, bar) <= STROKE / 2)) c = [255, 255, 255];
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cov = a / n;
      // prethodno pomnožena boja → obična
      px[i] = cov ? r / (a / 255) : 0;
      px[i + 1] = cov ? g / (a / 255) : 0;
      px[i + 2] = cov ? b / (a / 255) : 0;
      px[i + 3] = cov;
    }
  }
  return encodePng(size, px);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = -1;
  for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const icons = {
  'icon-192.png': render(192, { rounded: true, contentScale: 0.9 }),
  'icon-512.png': render(512, { rounded: true, contentScale: 0.9 }),
  'icon-maskable-512.png': render(512, { rounded: false, contentScale: 0.62 }),
  'apple-touch-icon.png': render(180, { rounded: false, contentScale: 0.72 })
};
for (const [name, png] of Object.entries(icons)) {
  fs.writeFileSync(new URL(name, out), png);
  console.log(name, png.length, 'B');
}
