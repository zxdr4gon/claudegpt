// Draws the app icons as PNGs with no dependencies (Node's zlib only), so they
// can be regenerated from the repo: `node scripts/make-icons.mjs`.
// The mark: two highlighter strokes on ink, echoing how the app marks text.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const INK = [30, 40, 51];
const STROKES = [
  // [x, y, width, height] as fractions of the safe area, and an RGB colour.
  { rect: [0.12, 0.3, 0.76, 0.16], color: [207, 226, 255] }, // due-date blue
  { rect: [0.12, 0.54, 0.5, 0.16], color: [255, 239, 160] }, // tag yellow
];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Is (x, y) inside a rounded rectangle? */
function inRoundRect(x, y, [rx, ry, rw, rh], r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * @param size   icon size in px
 * @param safe   fraction of the icon the mark may use (maskable icons need ~0.8)
 * @param corner background corner radius as a fraction (0 = full bleed)
 */
function draw(size, { safe = 1, corner = 0.22 } = {}) {
  const rows = [];
  const inset = ((1 - safe) / 2) * size;
  const area = size * safe;
  const ss = 4; // supersampling per axis, for smooth edges
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte + RGBA
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (corner > 0 && !inRoundRect(px, py, [0, 0, size, size], corner * size)) continue;
          let color = INK;
          for (const s of STROKES) {
            const [fx, fy, fw, fh] = s.rect;
            const rect = [inset + fx * area, inset + fy * area, fw * area, fh * area];
            if (inRoundRect(px, py, rect, 0.035 * area)) color = s.color;
          }
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      }
      const n = ss * ss;
      row.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)], 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', draw(192));
writeFileSync('public/icons/icon-512.png', draw(512));
// Maskable: full-bleed background, mark inside the 80% safe zone.
writeFileSync('public/icons/maskable-512.png', draw(512, { safe: 0.7, corner: 0 }));
writeFileSync('public/icons/apple-touch-icon.png', draw(180, { corner: 0 }));
writeFileSync('public/favicon.png', draw(64));
console.log('icons written to public/');
