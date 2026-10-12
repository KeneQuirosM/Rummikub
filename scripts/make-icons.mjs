// Genera los íconos PNG de la PWA sin dependencias (rasterizado simple + zlib).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  const pad = maskable ? 0.2 : 0.1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      let c = [0, 0, 0, 0];
      // fondo
      const bgD = maskable ? -1 : sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22);
      if (bgD < 0) {
        const g = 1 - Math.hypot(u - 0.5, v - 0.45) * 0.9;
        c = [16 + 20 * g, 48 + 40 * g, 40 + 30 * g, 255];
      }
      // ficha
      const tw = (0.5 - pad) * 0.72, th = (0.5 - pad) * 0.95;
      const shadow = sdRoundRect(u, v, 0.5 + 0.015, 0.5 + 0.03, tw, th, 0.07);
      if (shadow < 0 && c[3]) c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 255];
      const td = sdRoundRect(u, v, 0.5, 0.5, tw, th, 0.07);
      if (td < 0) {
        c = td > -0.018 ? [242, 199, 92, 255] : [248, 242, 226, 255];
        // "R" estilizada: círculo rojo + barra (simplificado como número/ficha)
        const cx = 0.5, cy = 0.46;
        const ring = Math.abs(Math.hypot(u - cx, v - cy) - 0.13);
        if (ring < 0.04) c = [211, 52, 59, 255];
        if (Math.hypot(u - 0.5, v - 0.73) < 0.035) c = [31, 99, 198, 255];
      }
      for (let k = 0; k < 4; k++) acc[k] += c[k];
    }
    const i = (y * size + x) * 4;
    for (let k = 0; k < 4; k++) px[i + k] = Math.round(acc[k] / (S * S));
  }
  return png(size, px);
}
const out = 'client/public/icons';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/icon-192.png`, render(192, false));
writeFileSync(`${out}/icon-512.png`, render(512, false));
writeFileSync(`${out}/maskable-512.png`, render(512, true));
console.log('íconos generados');
