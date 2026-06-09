import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const outDir = new URL("../public/assets/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function writePng(path, width, height, pixelAt) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = pixelAt(x / (width - 1), y / (height - 1), x, y);
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
  writeFileSync(path, png);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

writePng(new URL("zhaohe-cover.png", outDir), 1600, 900, (u, v, x, y) => {
  const wave = Math.sin(u * 20 + v * 9) * 0.08;
  const t = Math.max(0, Math.min(1, u * 0.55 + v * 0.45 + wave));
  const line = Math.abs((y - 160 - Math.sin(x / 84) * 54) % 180);
  const ink = line < 3 ? 24 : 0;
  return [
    Math.max(0, mix(18, 244, t) - ink),
    Math.max(0, mix(58, 172, t * 0.9) - ink),
    Math.max(0, mix(66, 142, t * 0.75) - ink),
    255
  ];
});

writePng(new URL("zhaohe-avatar.png", outDir), 512, 512, (u, v) => {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  const ring = Math.abs(r - 0.32) < 0.018 ? 40 : 0;
  const mark = Math.abs(dx + dy * 0.55) < 0.025 && r < 0.34 ? 56 : 0;
  return [
    Math.max(0, 231 - ring - mark),
    Math.max(0, 244 - ring - Math.round(mark * 0.6)),
    Math.max(0, 241 - ring),
    r > 0.47 ? 0 : 255
  ];
});
