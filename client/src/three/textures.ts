/**
 * Texturas generadas por canvas en tiempo de carga: no hay imágenes que descargar,
 * lo que mantiene el peso inicial muy bajo.
 */
import * as THREE from 'three';
import { isJoker, tileColor, tileNumber, type TileId } from '@rummi/shared';
import { BACK_THEMES, TABLE_THEMES, type BackTheme, type TableTheme } from './themes';

export const TILE_COLORS = ['#d3343b', '#1f63c6', '#e58a0c', '#1b1c22'];
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 7;
/** Celda especial para el dorso. */
export const BACK_CELL = 53;
export const JOKER_CELL = 52;

export function cellOf(id: TileId): number {
  if (isJoker(id)) return JOKER_CELL;
  return tileColor(id) * 13 + tileNumber(id) - 1;
}

export function cellOffset(cell: number): [number, number] {
  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  // flipY=false en la textura: v crece hacia abajo en el canvas
  return [col / ATLAS_COLS, row / ATLAS_ROWS];
}

function drawSymbol(g: CanvasRenderingContext2D, color: number, cx: number, cy: number, r: number) {
  g.beginPath();
  switch (color) {
    case 0: // círculo
      g.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 1: // cuadrado
      g.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
      break;
    case 2: // triángulo
      g.moveTo(cx, cy - r * 1.05);
      g.lineTo(cx + r * 1.05, cy + r * 0.85);
      g.lineTo(cx - r * 1.05, cy + r * 0.85);
      g.closePath();
      break;
    default: // estrella
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.5;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
  }
  g.fill();
}

/** Texto "grabado": sombra interior oscura + luz inferior. */
function engraved(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, s: number) {
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(text, x + s * 0.6, y + s * 0.9);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillText(text, x - s * 0.5, y - s * 0.7);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

export function createAtlas(symbols: boolean, cellW = 128, back: BackTheme = BACK_THEMES[0]!): THREE.CanvasTexture {
  const cellH = Math.round(cellW * 1.4);
  const canvas = document.createElement('canvas');
  canvas.width = cellW * ATLAS_COLS;
  canvas.height = cellH * ATLAS_ROWS;
  const g = canvas.getContext('2d')!;
  const font = '"Inter", "Segoe UI", Roboto, system-ui, sans-serif';

  for (let cell = 0; cell < ATLAS_COLS * ATLAS_ROWS; cell++) {
    const x0 = (cell % ATLAS_COLS) * cellW;
    const y0 = Math.floor(cell / ATLAS_COLS) * cellH;
    g.save();
    g.translate(x0, y0);
    // Fondo marfil con un leve degradado
    const grad = g.createLinearGradient(0, 0, 0, cellH);
    grad.addColorStop(0, '#fbf7ec');
    grad.addColorStop(1, '#efe8d6');
    g.fillStyle = grad;
    g.fillRect(0, 0, cellW, cellH);

    if (cell < 52) {
      const color = Math.floor(cell / 13);
      const n = (cell % 13) + 1;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(cellW * (n >= 10 ? 0.62 : 0.74))}px ${font}`;
      const cy = symbols ? cellH * 0.4 : cellH * 0.47;
      engraved(g, String(n), cellW / 2, cy, TILE_COLORS[color]!, cellW / 64);
      if (symbols) {
        g.fillStyle = TILE_COLORS[color]!;
        drawSymbol(g, color, cellW / 2, cellH * 0.8, cellW * 0.1);
      } else {
        // pequeño punto decorativo
        g.fillStyle = TILE_COLORS[color]!;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(cellW / 2, cellH * 0.82, cellW * 0.055, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    } else if (cell === JOKER_CELL) {
      // Comodín: cara sonriente multicolor
      const cx = cellW / 2, cy = cellH * 0.44, r = cellW * 0.3;
      const ring = g.createConicGradient(0, cx, cy);
      TILE_COLORS.forEach((c, i) => ring.addColorStop(i / 4, c));
      ring.addColorStop(1, TILE_COLORS[0]!);
      g.lineWidth = cellW * 0.07;
      g.strokeStyle = ring;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#1b1c22';
      g.beginPath();
      g.arc(cx - r * 0.35, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
      g.arc(cx + r * 0.35, cy - r * 0.2, r * 0.12, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = cellW * 0.045;
      g.strokeStyle = '#d3343b';
      g.beginPath();
      g.arc(cx, cy + r * 0.05, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      g.font = `800 ${Math.round(cellW * 0.2)}px ${font}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      engraved(g, 'J', cellW / 2, cellH * 0.82, '#b8860b', 1.5);
    } else if (cell === BACK_CELL) {
      drawBack(g, cellW, cellH, back);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Dorso de las fichas según el tema elegido. */
function drawBack(g: CanvasRenderingContext2D, w: number, h: number, t: BackTheme) {
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, t.from);
  bg.addColorStop(1, t.to);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = t.accent;
  g.globalAlpha = 0.85;
  g.lineWidth = w * 0.035;
  g.strokeRect(w * 0.12, h * 0.1, w * 0.76, h * 0.8);
  g.globalAlpha = 1;
  g.fillStyle = t.accent;
  const cx = w / 2, cy = h / 2;
  g.beginPath();
  if (t.pattern === 'diamond') {
    g.moveTo(cx, h * 0.3);
    g.lineTo(w * 0.7, cy);
    g.lineTo(cx, h * 0.7);
    g.lineTo(w * 0.3, cy);
    g.closePath();
    g.fill();
  } else if (t.pattern === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? w * 0.22 : w * 0.09;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else if (t.pattern === 'crown') {
    const y0 = cy + w * 0.12, y1 = cy - w * 0.14;
    g.moveTo(w * 0.28, y0);
    g.lineTo(w * 0.28, y1);
    g.lineTo(w * 0.39, cy - w * 0.02);
    g.lineTo(cx, y1 - w * 0.06);
    g.lineTo(w * 0.61, cy - w * 0.02);
    g.lineTo(w * 0.72, y1);
    g.lineTo(w * 0.72, y0);
    g.closePath();
    g.fill();
  } else {
    // galaxia: puntos de estrellas deterministas
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.16 + rnd() * 0.68), y = h * (0.13 + rnd() * 0.74), r = w * (0.006 + rnd() * 0.018);
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
    g.fill();
    g.beginPath();
    g.arc(cx, cy, w * 0.1, 0, Math.PI * 2);
    g.globalAlpha = 0.5;
    g.fill();
    g.globalAlpha = 1;
  }
}

function noiseCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, img: ImageData) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  draw(g, img);
  return c;
}

/** Fieltro con grano fino, del color del tema. */
export function createFeltTexture(theme: TableTheme = TABLE_THEMES[0]!): THREE.CanvasTexture {
  if (theme.wood) {
    const wood = createWoodTexture(theme.felt);
    return wood;
  }
  const size = 256;
  const [fr, fg, fb] = theme.felt;
  const c = noiseCanvas(size, size, (g, img) => {
    const d = img.data;
    for (let i = 0; i < size * size; i++) {
      const n = Math.random() * 18 - 9;
      d[i * 4] = fr + n * 0.6;
      d[i * 4 + 1] = fg + n;
      d[i * 4 + 2] = fb + n * 0.8;
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // fibras sutiles
    g.globalAlpha = 0.05;
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = Math.random() < 0.5 ? '#000' : theme.fiber;
      g.beginPath();
      const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI;
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      g.stroke();
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Madera: vetas con ruido sinusoidal. */
export function createWoodTexture(base: [number, number, number] = [120, 72, 40]): THREE.CanvasTexture {
  const w = 512, h = 128;
  const c = noiseCanvas(w, h, (g, img) => {
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v =
          Math.sin(x * 0.02 + Math.sin(y * 0.09) * 2.5 + Math.sin(x * 0.003) * 4) * 0.5 +
          Math.sin(x * 0.11 + y * 0.03) * 0.12 +
          (Math.random() - 0.5) * 0.12;
        const k = 0.75 + v * 0.18;
        const i = (y * w + x) * 4;
        d[i] = base[0] * k;
        d[i + 1] = base[1] * k;
        d[i + 2] = base[2] * k;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sombra radial suave para sombras de contacto baratas. */
export function createBlobTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
