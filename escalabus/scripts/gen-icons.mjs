// Gera os ícones PNG da PWA sem dependências externas (desenho vetorial simples rasterizado).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('public/icons');
fs.mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // supersampling 3x3 para bordas suaves
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const p = pixel((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / 9) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const NAVY = [31, 58, 95, 1], WHITE = [255, 255, 255, 1], AMBER = [242, 169, 0, 1], NONE = [0, 0, 0, 0];
const rr = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const circle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Ônibus estilizado; `pad` reduz o desenho para a área segura dos ícones "maskable". */
function draw(full, pad) {
  return (u, v) => {
    if (!full && !rr(u, v, 0, 0, 1, 1, 0.2)) return NONE;
    const x = (u - pad) / (1 - 2 * pad), y = (v - pad) / (1 - 2 * pad);
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      if (circle(x, y, 0.32, 0.8, 0.075) || circle(x, y, 0.68, 0.8, 0.075)) return circle(x, y, 0.32, 0.8, 0.03) || circle(x, y, 0.68, 0.8, 0.03) ? NAVY : WHITE;
      if (rr(x, y, 0.18, 0.2, 0.82, 0.77, 0.08)) {
        if (rr(x, y, 0.24, 0.27, 0.76, 0.5, 0.03)) return NAVY;            // para-brisa
        if (y > 0.6 && y < 0.67 && ((x > 0.25 && x < 0.34) || (x > 0.66 && x < 0.75))) return AMBER; // faróis
        if (y > 0.21 && y < 0.25 && x > 0.4 && x < 0.6) return AMBER;      // letreiro
        return WHITE;
      }
    }
    return NAVY;
  };
}

const files = {
  'icon-192.png': png(192, draw(false, 0.08)),
  'icon-512.png': png(512, draw(false, 0.08)),
  'icon-maskable-512.png': png(512, draw(true, 0.16)),
  'apple-touch-icon.png': png(180, draw(true, 0.1)),
};
for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), b);
console.log('Ícones gerados em', OUT);
