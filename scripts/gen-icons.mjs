// Generates placeholder PWA icons (solid billiard-green with a cue ball).
// No external deps — pure Node + zlib. Run: npm run gen:icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const off = y * (size * 3 + 1);
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = rgb(x, y, size);
      const p = off + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// billiard green felt with a white cue ball + small red spot
function iconRGB(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const d = Math.hypot(x - cx, y - cy);
  const bg = [11, 61, 46];
  const ballR = size * 0.34;
  if (d <= ballR) {
    const white = [240, 245, 242];
    // red spot
    const spotD = Math.hypot(x - (cx + size * 0.08), y - (cy - size * 0.05));
    if (spotD <= size * 0.045) return [200, 40, 40];
    return white;
  }
  return bg;
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePNG(size, iconRGB));
  console.log('wrote', file);
}

// also write a 512 maskable-padded variant (icon-512 already used for maskable)
console.log('done');
