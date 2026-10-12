/**
 * Bot de práctica. Busca combinaciones con backtracking:
 *  1. Mejor conjunto de grupos/escaleras desde el atril (DFS con poda).
 *  2. Si ya abrió: extiende combinaciones de la mesa, libera comodines
 *     reemplazándolos y "toma prestadas" fichas de combinaciones largas.
 * Todas las jugadas se expresan como movimientos simulados con el mismo motor (applyMove),
 * así el bot nunca puede proponer algo que el servidor rechace.
 */
import { analyzeMeld, arrangeMeld, type Meld } from './melds.js';
import type { Intent, MoveTarget } from './protocol.js';
import { applyMove, applyTurn, cloneSnapshot, type TurnContext, type TurnSnapshot } from './rules.js';
import { isJoker, MIN_OPEN_POINTS, tileColor, tileNumber, type TileId } from './tiles.js';

/** Movimiento del bot. Las combinaciones se referencian por una ficha "ancla" que contienen. */
export type BotMove =
  | { tileId: TileId; to: { kind: 'rack' } | { kind: 'new' } }
  | { tileId: TileId; to: { kind: 'with'; anchor: TileId; index: number } };

export interface BotPlan {
  moves: BotMove[];
  /** true si termina el turno jugando; false si debe robar. */
  play: boolean;
}

interface Candidate {
  kinds: number[]; // color*13 + (número-1)
  jokers: number;
  value: number;
}

const kindOf = (t: TileId) => tileColor(t) * 13 + tileNumber(t) - 1;

function generateCandidates(counts: number[], jokers: number): Candidate[] {
  const out: Candidate[] = [];
  // Escaleras
  for (let c = 0; c < 4; c++) {
    for (let start = 1; start <= 11; start++) {
      for (let len = 3; start + len - 1 <= 13; len++) {
        const kinds: number[] = [];
        let missing = 0;
        for (let n = start; n < start + len; n++) {
          const k = c * 13 + n - 1;
          if (counts[k]! > 0) kinds.push(k);
          else missing++;
        }
        if (missing > jokers) {
          if (missing > jokers + 1) break; // alargar solo empeora
          continue;
        }
        if (kinds.length === 0) continue;
        out.push({ kinds, jokers: missing, value: ((start + start + len - 1) * len) / 2 });
      }
    }
  }
  // Grupos
  for (let n = 1; n <= 13; n++) {
    const avail = [0, 1, 2, 3].filter((c) => counts[c * 13 + n - 1]! > 0);
    const subsets = 1 << avail.length;
    for (let mask = 1; mask < subsets; mask++) {
      const cols = avail.filter((_, i) => mask & (1 << i));
      for (let size = 3; size <= 4; size++) {
        const j = size - cols.length;
        if (j < 0 || j > jokers || cols.length + j > 4) continue;
        out.push({ kinds: cols.map((c) => c * 13 + n - 1), jokers: j, value: n * size });
      }
    }
  }
  // Primero las que usan menos comodines y más fichas
  out.sort((a, b) => a.jokers - b.jokers || b.kinds.length - a.kinds.length || b.value - a.value);
  return out;
}

/** Mejor combinación de jugadas con fichas del atril. */
export function bestRackMelds(rack: readonly TileId[], minValue = 0, nodeLimit = 40000): TileId[][] {
  const counts = new Array<number>(52).fill(0);
  let jokers = 0;
  for (const t of rack) {
    if (isJoker(t)) jokers++;
    else counts[kindOf(t)]!++;
  }
  const cands = generateCandidates(counts, jokers);
  let best: Candidate[] = [];
  let bestScore = -1;
  let nodes = 0;
  const chosen: Candidate[] = [];
  const score = (tiles: number, js: number, value: number) => tiles * 100 - js * 15 + value;

  const dfs = (from: number, jLeft: number, tiles: number, js: number, value: number) => {
    if (++nodes > nodeLimit) return;
    if (value >= minValue && chosen.length > 0) {
      const s = score(tiles, js, value);
      if (s > bestScore) {
        bestScore = s;
        best = [...chosen];
      }
    }
    for (let i = from; i < cands.length; i++) {
      const c = cands[i]!;
      if (c.jokers > jLeft) continue;
      if (!c.kinds.every((k) => counts[k]! > 0)) continue;
      // Si el tipo de ficha aparece dos veces en la candidata (no ocurre) se ignoraría.
      for (const k of c.kinds) counts[k]!--;
      chosen.push(c);
      dfs(i, jLeft - c.jokers, tiles + c.kinds.length + c.jokers, js + c.jokers, value + c.value);
      chosen.pop();
      for (const k of c.kinds) counts[k]!++;
      if (nodes > nodeLimit) return;
    }
  };
  dfs(0, jokers, 0, 0, 0);

  // Concretar ids
  const pool = [...rack];
  const takeKind = (k: number) => {
    const i = pool.findIndex((t) => !isJoker(t) && kindOf(t) === k);
    return pool.splice(i, 1)[0]!;
  };
  const takeJoker = () => pool.splice(pool.findIndex(isJoker), 1)[0]!;
  return best.map((c) => {
    const tiles = c.kinds.map(takeKind);
    for (let j = 0; j < c.jokers; j++) tiles.push(takeJoker());
    return tiles;
  });
}

class Simulator {
  snap: TurnSnapshot;
  moves: BotMove[] = [];
  private seq = 0;
  constructor(public ctx: TurnContext, start: TurnSnapshot) {
    this.snap = cloneSnapshot(start);
  }
  private gen = () => `bot${this.seq++}`;

  meldOf(tile: TileId): Meld | undefined {
    return this.snap.table.find((m) => m.tiles.includes(tile));
  }

  /** Intenta una secuencia de movimientos; si el resultado no es completamente válido, revierte. */
  attempt(ops: BotMove[], requireValid = true): boolean {
    let snap = this.snap;
    for (const op of ops) {
      let to: MoveTarget;
      if (op.to.kind === 'with') {
        const m = snap.table.find((mm) => mm.tiles.includes((op.to as { anchor: TileId }).anchor));
        if (!m) return false;
        to = { kind: 'meld', meldId: m.id, index: op.to.index };
      } else to = op.to;
      const r = applyMove(this.ctx, snap, op.tileId, to, this.gen);
      if (!r.ok) return false;
      snap = r.snapshot;
    }
    if (requireValid && !snap.table.every((m) => analyzeMeld(m.tiles).valid)) return false;
    this.snap = snap;
    this.moves.push(...ops);
    return true;
  }
}

function newMeldOps(tiles: TileId[]): BotMove[] {
  const [first, ...rest] = tiles;
  const ops: BotMove[] = [{ tileId: first!, to: { kind: 'new' } }];
  rest.forEach((t, i) => ops.push({ tileId: t, to: { kind: 'with', anchor: first!, index: i + 1 } }));
  return ops;
}

/** Calcula el turno del bot. */
export function planBotTurn(ctx: TurnContext, current?: TurnSnapshot): BotPlan {
  const sim = new Simulator(ctx, current ?? ctx.start);
  const rack = () => sim.snap.rack;

  if (!ctx.opened) {
    const melds = bestRackMelds(rack(), MIN_OPEN_POINTS);
    if (melds.length === 0) return { moves: [], play: false };
    for (const m of melds) sim.attempt(newMeldOps(m));
  } else {
    for (const m of bestRackMelds(rack(), 0)) sim.attempt(newMeldOps(m));

    let progress = true;
    let guard = 0;
    while (progress && guard++ < 30) {
      progress = false;
      // Extender combinaciones existentes (fichas normales primero, comodines al final)
      const ordered = [...rack()].sort((a, b) => Number(isJoker(a)) - Number(isJoker(b)));
      for (const t of ordered) {
        if (!rack().includes(t)) continue;
        for (const m of [...sim.snap.table]) {
          const anchor = m.tiles[0]!;
          let done = false;
          for (const idx of [m.tiles.length, 0]) {
            if (sim.attempt([{ tileId: t, to: { kind: 'with', anchor, index: idx } }])) {
              done = true;
              break;
            }
          }
          if (done) {
            progress = true;
            break;
          }
        }
      }
      if (progress) continue;
      // Liberar comodines: poner la ficha que representa y recolocar el comodín
      for (const m of [...sim.snap.table]) {
        const joker = m.tiles.find(isJoker);
        if (joker === undefined) continue;
        for (const t of [...rack()]) {
          if (isJoker(t)) continue;
          const anchor = m.tiles.find((x) => x !== joker)!;
          const jIdx = m.tiles.indexOf(joker);
          const base: BotMove[] = [{ tileId: t, to: { kind: 'with', anchor, index: jIdx } }];
          // El comodín liberado: a otra combinación o a una nueva con dos fichas del atril
          const options: BotMove[][] = [];
          for (const other of sim.snap.table) {
            if (other.id === m.id) continue;
            const a = other.tiles[0]!;
            options.push([{ tileId: joker, to: { kind: 'with', anchor: a, index: other.tiles.length } }]);
            options.push([{ tileId: joker, to: { kind: 'with', anchor: a, index: 0 } }]);
          }
          const rest = rack().filter((x) => x !== t && !isJoker(x));
          for (let i = 0; i < rest.length; i++)
            for (let k = i + 1; k < rest.length; k++)
              options.push([
                { tileId: joker, to: { kind: 'new' } },
                { tileId: rest[i]!, to: { kind: 'with', anchor: joker, index: 1 } },
                { tileId: rest[k]!, to: { kind: 'with', anchor: joker, index: 2 } },
              ]);
          for (const opt of options) {
            if (sim.attempt([...base, ...opt])) {
              progress = true;
              break;
            }
          }
          if (progress) break;
        }
        if (progress) break;
      }
      if (progress) continue;
      // Tomar prestada una ficha de la mesa para formar una combinación con dos del atril
      const r = rack().filter((x) => !isJoker(x));
      outer: for (let i = 0; i < r.length; i++) {
        for (let k = i + 1; k < r.length; k++) {
          const a = r[i]!, b = r[k]!;
          if (a === b) continue;
          const sameNum = tileNumber(a) === tileNumber(b) && tileColor(a) !== tileColor(b);
          const near = tileColor(a) === tileColor(b) && Math.abs(tileNumber(a) - tileNumber(b)) <= 2 && tileNumber(a) !== tileNumber(b);
          if (!sameNum && !near) continue;
          for (const m of sim.snap.table) {
            for (const t of m.tiles) {
              if (!analyzeMeld(arrangeMeld([t, a, b])).valid) continue;
              if (sim.attempt([
                { tileId: t, to: { kind: 'new' } },
                { tileId: a, to: { kind: 'with', anchor: t, index: 1 } },
                { tileId: b, to: { kind: 'with', anchor: t, index: 2 } },
              ])) {
                progress = true;
                break outer;
              }
            }
          }
        }
      }
    }
  }

  if (sim.moves.length === 0) return { moves: [], play: false };
  const check = applyTurn(ctx, sim.snap);
  if (!check.ok || check.played.length === 0) return { moves: [], play: false };
  return { moves: sim.moves, play: true };
}

/** Traduce un movimiento del bot a una intención real según la mesa actual. */
export function botMoveToIntent(move: BotMove, table: readonly Meld[]): Intent | null {
  if (move.to.kind === 'with') {
    const anchor = move.to.anchor;
    const m = table.find((mm) => mm.tiles.includes(anchor));
    if (!m) return null;
    return { type: 'move', tileId: move.tileId, to: { kind: 'meld', meldId: m.id, index: move.to.index } };
  }
  return { type: 'move', tileId: move.tileId, to: move.to };
}
