// Renders images/icon.png (128×128): a flame over a status bar. No dependencies.
// Run with `npm run icon`.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SAMPLES = 4;

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const BG_TOP = hex('#3a1248');
const BG_BOTTOM = hex('#1c0a24');
const BAR = hex('#9f00a6');
const OUTER_TOP = hex('#ff3d00');
const OUTER_BOTTOM = hex('#ff9100');
const INNER = hex('#ffe57f');
const DOT = hex('#ffffff');

function insideRoundedSquare(x, y) {
  const r = 26;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Teardrop with its tip at (cx + lean, top) and a round base of radius r centred at (cx, base). */
function insideFlame(x, y, cx, base, r, top, lean) {
  if ((x - cx) ** 2 + (y - base) ** 2 <= r * r) {
    return true;
  }
  if (y < top || y > base) {
    return false;
  }
  const t = (y - top) / (base - top);
  const center = cx + lean * (1 - t) ** 2;
  return Math.abs(x - center) <= r * Math.pow(t, 0.9);
}

function shade(x, y) {
  if (!insideRoundedSquare(x, y)) {
    return null;
  }
  if (y >= 100) {
    if ((x - 26) ** 2 + (y - 114) ** 2 <= 16) {
      return DOT;
    }
    if (y >= 112 && y <= 116 && x >= 36 && x <= 78) {
      return mix(BAR, DOT, 0.7);
    }
    return BAR;
  }
  if (insideFlame(x, y, 64, 70, 15, 34, 4)) {
    return INNER;
  }
  if (insideFlame(x, y, 64, 62, 28, 8, 10)) {
    return mix(OUTER_TOP, OUTER_BOTTOM, Math.min(1, Math.max(0, (y - 10) / 80)));
  }
  return mix(BG_TOP, BG_BOTTOM, y / 100);
}

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  pixels[row] = 0; // no filter
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const c = shade(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
    }
    const o = row + 1 + px * 4;
    pixels[o] = a ? Math.round(r / a) : 0;
    pixels[o + 1] = a ? Math.round(g / a) : 0;
    pixels[o + 2] = a ? Math.round(b / a) : 0;
    pixels[o + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'images', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
