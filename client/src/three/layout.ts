import type { Meld, TileId } from '@rummi/shared';
import { TILE_D, TILE_W } from './tileset';

export const TILE_GAP = 0.06;
export const MELD_GAP = 0.75;
export const ROW_GAP = 0.5;
export const STEP = TILE_W + TILE_GAP;

export interface MeldBox {
  id: string;
  /** x del centro de la primera ficha */
  x0: number;
  z: number;
  tiles: TileId[];
  /** ancho total */
  width: number;
}

export interface TableLayout {
  pos: Map<TileId, { x: number; z: number }>;
  melds: MeldBox[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Posición sugerida para una combinación nueva. */
  next: { x: number; z: number };
}

export function meldWidth(n: number): number {
  return n * TILE_W + Math.max(0, n - 1) * TILE_GAP;
}

/**
 * Distribuye las combinaciones en filas (flujo de izquierda a derecha), centradas en el origen.
 */
export function layoutTable(melds: readonly Meld[], rowWidth: number): TableLayout {
  const rows: { items: { m: Meld; w: number }[]; w: number }[] = [];
  let cur: { items: { m: Meld; w: number }[]; w: number } = { items: [], w: 0 };
  for (const m of melds) {
    const w = meldWidth(m.tiles.length);
    const add = (cur.items.length ? MELD_GAP : 0) + w;
    if (cur.items.length && cur.w + add > rowWidth) {
      rows.push(cur);
      cur = { items: [], w: 0 };
    }
    cur.w += (cur.items.length ? MELD_GAP : 0) + w;
    cur.items.push({ m, w });
  }
  if (cur.items.length) rows.push(cur);

  const rowH = TILE_D + ROW_GAP;
  const totalRows = Math.max(1, rows.length);
  const z0 = -((totalRows - 1) * rowH) / 2;
  const pos = new Map<TileId, { x: number; z: number }>();
  const boxes: MeldBox[] = [];
  let minX = Infinity, maxX = -Infinity;
  rows.forEach((row, ri) => {
    const z = z0 + ri * rowH;
    // Filas centradas: el contenido queda en el medio de la mesa
    let x = -row.w / 2;
    for (const { m, w } of row.items) {
      const x0 = x + TILE_W / 2;
      m.tiles.forEach((t, i) => pos.set(t, { x: x0 + i * STEP, z }));
      boxes.push({ id: m.id, x0, z, tiles: [...m.tiles], width: w });
      minX = Math.min(minX, x);
      x += w + MELD_GAP;
      maxX = Math.max(maxX, x - MELD_GAP);
    }
  });
  const last = rows[rows.length - 1];
  let next: { x: number; z: number };
  if (!last) next = { x: 0, z: 0 };
  else if (last.w + MELD_GAP + TILE_W * 3 <= rowWidth) {
    const w = last.w + MELD_GAP + TILE_W;
    next = { x: -w / 2 + last.w + MELD_GAP + TILE_W / 2, z: z0 + (rows.length - 1) * rowH };
  } else next = { x: 0, z: z0 + rows.length * rowH };
  minX = Math.min(minX, next.x - TILE_W / 2);
  maxX = Math.max(maxX, next.x + TILE_W / 2);
  return {
    pos,
    melds: boxes,
    minX,
    maxX,
    minZ: Math.min(z0, next.z) - TILE_D / 2,
    maxZ: Math.max(z0 + (totalRows - 1) * rowH, next.z) + TILE_D / 2,
    next,
  };
}

export interface DropTarget {
  kind: 'meld' | 'new';
  meldId?: string;
  index?: number;
}

/**
 * ¿Dónde caería una ficha soltada en (x, z)? Si está cerca de una combinación se inserta según la x.
 */
export function findDropTarget(layout: TableLayout, x: number, z: number, dragged: TileId | null): DropTarget {
  let best: { box: MeldBox; d: number } | null = null;
  for (const box of layout.melds) {
    const tiles = box.tiles.filter((t) => t !== dragged);
    if (tiles.length === 0) continue;
    const left = box.x0 - TILE_W / 2 - 0.55;
    const right = box.x0 + box.width - TILE_W / 2 + 0.55;
    const dz = Math.abs(z - box.z);
    if (x < left || x > right || dz > TILE_D * 0.62) continue;
    const d = dz + Math.max(0, left + 0.55 - x, x - right + 0.55);
    if (!best || d < best.d) best = { box, d };
  }
  if (!best) return { kind: 'new' };
  const tiles = best.box.tiles.filter((t) => t !== dragged);
  let index = 0;
  for (const t of tiles) {
    const p = layout.pos.get(t);
    if (p && p.x < x) index++;
  }
  return { kind: 'meld', meldId: best.box.id, index };
}
