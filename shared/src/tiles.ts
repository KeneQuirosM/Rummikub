/**
 * Fichas: 106 en total.
 *  - ids 0..103: número 1..13, 4 colores, 2 copias.
 *    copia = floor(id / 52), color = floor((id % 52) / 13), número = id % 13 + 1
 *  - ids 104 y 105: comodines.
 */
export type TileId = number;

export const COLORS = ['red', 'blue', 'orange', 'black'] as const;
export type TileColor = (typeof COLORS)[number];

export const TILE_COUNT = 106;
export const JOKER_IDS: readonly TileId[] = [104, 105];
export const JOKER_PENALTY = 30;
export const RACK_SIZE = 14;
export const MIN_OPEN_POINTS = 30;

export interface TileInfo {
  id: TileId;
  joker: boolean;
  /** 1..13, 0 para comodín */
  number: number;
  /** índice 0..3, -1 para comodín */
  color: number;
}

export function isJoker(id: TileId): boolean {
  return id >= 104;
}

export function tileNumber(id: TileId): number {
  return isJoker(id) ? 0 : (id % 13) + 1;
}

export function tileColor(id: TileId): number {
  return isJoker(id) ? -1 : Math.floor((id % 52) / 13);
}

export function tileInfo(id: TileId): TileInfo {
  return { id, joker: isJoker(id), number: tileNumber(id), color: tileColor(id) };
}

/** Id de la ficha para (color, número, copia). Útil en tests y bot. */
export function tileOf(color: number, number: number, copy = 0): TileId {
  return copy * 52 + color * 13 + (number - 1);
}

export function isValidTileId(id: unknown): id is TileId {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < TILE_COUNT;
}

/** Puntos de una ficha en el atril (comodín = 30). */
export function rackTileValue(id: TileId): number {
  return isJoker(id) ? JOKER_PENALTY : tileNumber(id);
}

export function rackPoints(rack: readonly TileId[]): number {
  let s = 0;
  for (const t of rack) s += rackTileValue(t);
  return s;
}

export function tileLabel(id: TileId): string {
  if (isJoker(id)) return 'J';
  return `${COLORS[tileColor(id)]![0]!.toUpperCase()}${tileNumber(id)}`;
}

export function createDeck(): TileId[] {
  return Array.from({ length: TILE_COUNT }, (_, i) => i);
}

/** PRNG determinista (mulberry32) para poder reproducir partidas en tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Orden por color y luego número (comodines al final). */
export function compareByColor(a: TileId, b: TileId): number {
  const ja = isJoker(a), jb = isJoker(b);
  if (ja || jb) return ja === jb ? a - b : ja ? 1 : -1;
  return tileColor(a) - tileColor(b) || tileNumber(a) - tileNumber(b) || a - b;
}

/** Orden por número y luego color (comodines al final). */
export function compareByNumber(a: TileId, b: TileId): number {
  const ja = isJoker(a), jb = isJoker(b);
  if (ja || jb) return ja === jb ? a - b : ja ? 1 : -1;
  return tileNumber(a) - tileNumber(b) || tileColor(a) - tileColor(b) || a - b;
}
