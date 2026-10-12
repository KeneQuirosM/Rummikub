import { isJoker, tileColor, tileNumber, type TileId } from './tiles.js';

export interface Meld {
  id: string;
  tiles: TileId[];
}

export type MeldKind = 'group' | 'run';

export type MeldError =
  | 'too_short'
  | 'too_long'
  | 'mixed'
  | 'duplicate_color'
  | 'not_consecutive'
  | 'out_of_range';

export interface MeldAnalysis {
  valid: boolean;
  kind: MeldKind | null;
  /** Suma de puntos (los comodines valen lo que representan). 0 si no es válida. */
  value: number;
  error?: MeldError;
}

function analyzeGroup(tiles: readonly TileId[]): MeldAnalysis {
  if (tiles.length > 4) return { valid: false, kind: null, value: 0, error: 'too_long' };
  let num = 0;
  const colors = new Set<number>();
  for (const t of tiles) {
    if (isJoker(t)) continue;
    const n = tileNumber(t);
    if (num === 0) num = n;
    else if (n !== num) return { valid: false, kind: null, value: 0, error: 'mixed' };
    const c = tileColor(t);
    if (colors.has(c)) return { valid: false, kind: null, value: 0, error: 'duplicate_color' };
    colors.add(c);
  }
  if (num === 0) return { valid: false, kind: null, value: 0, error: 'mixed' };
  return { valid: true, kind: 'group', value: num * tiles.length };
}

/** Escalera respetando el orden en que están las fichas. El 1 no conecta con el 13. */
function analyzeRun(tiles: readonly TileId[]): MeldAnalysis {
  if (tiles.length > 13) return { valid: false, kind: null, value: 0, error: 'too_long' };
  let color = -1;
  let start: number | null = null;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (isJoker(t)) continue;
    const c = tileColor(t);
    if (color === -1) color = c;
    else if (c !== color) return { valid: false, kind: null, value: 0, error: 'mixed' };
    const s = tileNumber(t) - i;
    if (start === null) start = s;
    else if (s !== start) return { valid: false, kind: null, value: 0, error: 'not_consecutive' };
  }
  if (start === null) return { valid: false, kind: null, value: 0, error: 'mixed' };
  const end = start + tiles.length - 1;
  if (start < 1 || end > 13) return { valid: false, kind: null, value: 0, error: 'out_of_range' };
  const value = ((start + end) * tiles.length) / 2;
  return { valid: true, kind: 'run', value };
}

export function analyzeMeld(tiles: readonly TileId[]): MeldAnalysis {
  if (tiles.length < 3) return { valid: false, kind: null, value: 0, error: 'too_short' };
  const g = analyzeGroup(tiles);
  const r = analyzeRun(tiles);
  if (g.valid && r.valid) return g.value >= r.value ? g : r;
  if (g.valid) return g;
  if (r.valid) return r;
  // Elegimos el error más descriptivo
  const allSameColor = new Set(tiles.filter((t) => !isJoker(t)).map(tileColor)).size <= 1;
  return allSameColor ? r : g;
}

export function isValidMeld(tiles: readonly TileId[]): boolean {
  return analyzeMeld(tiles).valid;
}

export interface MeldsValidation {
  allValid: boolean;
  results: MeldAnalysis[];
}

export function validateMelds(melds: readonly Meld[] | readonly (readonly TileId[])[]): MeldsValidation {
  const results = melds.map((m) => analyzeMeld(Array.isArray(m) ? (m as TileId[]) : (m as Meld).tiles));
  return { allValid: results.every((r) => r.valid), results };
}

export function meldsValue(melds: readonly (readonly TileId[])[]): number {
  let s = 0;
  for (const m of melds) s += analyzeMeld(m).value;
  return s;
}

/**
 * Reordena una combinación de forma determinista para que las escaleras queden
 * ordenadas y los comodines rellenen huecos. Si el orden actual ya es válido se respeta
 * (así el jugador puede decidir dónde va un comodín en un extremo).
 * El resultado nunca cambia el conjunto de fichas.
 */
export function arrangeMeld(tiles: readonly TileId[]): TileId[] {
  if (tiles.length <= 1) return [...tiles];
  if (analyzeMeld(tiles).valid) return [...tiles];
  const nonJ = tiles.filter((t) => !isJoker(t));
  const jokers = tiles.filter((t) => isJoker(t));
  if (nonJ.length === 0) return [...tiles];

  const sameColor = new Set(nonJ.map(tileColor)).size === 1;
  const nums = nonJ.map(tileNumber);
  const distinctNums = new Set(nums).size === nums.length;
  const sameNumber = new Set(nums).size === 1;

  if (sameColor && distinctNums && !(sameNumber && nonJ.length === 1 && jokers.length === 0)) {
    const sorted = [...nonJ].sort((a, b) => tileNumber(a) - tileNumber(b));
    let gaps = 0;
    for (let i = 1; i < sorted.length; i++) gaps += tileNumber(sorted[i]!) - tileNumber(sorted[i - 1]!) - 1;
    if (gaps <= jokers.length) {
      const out: TileId[] = [];
      const js = [...jokers];
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0) {
          const gap = tileNumber(sorted[i]!) - tileNumber(sorted[i - 1]!) - 1;
          for (let g = 0; g < gap; g++) out.push(js.shift()!);
        }
        out.push(sorted[i]!);
      }
      // Comodines sobrantes: primero al final (si cabe), luego al principio
      let last = tileNumber(sorted[sorted.length - 1]!);
      while (js.length && last < 13) {
        out.push(js.shift()!);
        last++;
      }
      while (js.length) out.unshift(js.shift()!);
      if (out.length < 3 || analyzeMeld(out).valid) return out;
    }
    if (!sameNumber) return [...sorted, ...jokers];
  }
  if (sameNumber) {
    const sorted = [...nonJ].sort((a, b) => tileColor(a) - tileColor(b) || a - b);
    return [...sorted, ...jokers];
  }
  return [...tiles];
}
