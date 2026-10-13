import type { Meld } from './melds.js';
import type {
  GameErrorCode,
  GameEvent,
  GameResult,
  GameStatus,
  Intent,
  MatchInfo,
  MoveTarget,
  PlayerView,
  PublicPlayer,
} from './protocol.js';
import {
  applyMeldMove,
  applyMove,
  applyTurn,
  cloneSnapshot,
  scoring,
  tableTiles,
  type TurnContext,
  type TurnSnapshot,
} from './rules.js';
import { MAX_PLAYERS, MIN_PLAYERS } from './protocol.js';
import { createDeck, isValidTileId, mulberry32, RACK_SIZE, shuffle, type TileId } from './tiles.js';

/** Asiento 0..n-1 (n = 2..4), en orden de turno. */
export type Seat = number;

export interface GameState {
  /** Número de jugadores (2 a 4). */
  numPlayers: number;
  pool: TileId[];
  racks: TileId[][];
  /** Mesa confirmada (al inicio del turno actual). */
  table: Meld[];
  opened: boolean[];
  turn: Seat;
  status: GameStatus;
  turnSeconds: number;
  turnDeadline: number | null;
  /** Estado en edición del turno actual. */
  working: TurnSnapshot;
  history: TurnSnapshot[];
  nextMeldSeq: number;
  result: GameResult | null;
  lastEvent: GameEvent | null;
  eventSeq: number;
  version: number;
}

export interface CreateGameOptions {
  /** Jugadores (2 a 4). Por defecto 2. */
  players?: number;
  seed?: number;
  turnSeconds?: number;
  firstPlayer?: Seat;
  now?: number;
}

export function createGame(opts: CreateGameOptions = {}): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = mulberry32(seed);
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(opts.players ?? 2)));
  const pool = shuffle(createDeck(), rand);
  const racks = Array.from({ length: n }, () => pool.splice(0, RACK_SIZE));
  const first: Seat = opts.firstPlayer !== undefined ? opts.firstPlayer % n : Math.floor(rand() * n);
  const state: GameState = {
    numPlayers: n,
    pool,
    racks,
    table: [],
    opened: new Array<boolean>(n).fill(false),
    turn: first,
    status: 'playing',
    turnSeconds: opts.turnSeconds ?? 60,
    turnDeadline: null,
    working: { rack: [], table: [] },
    history: [],
    nextMeldSeq: 1,
    result: null,
    lastEvent: null,
    eventSeq: 0,
    version: 0,
  };
  startTurn(state, first, opts.now ?? Date.now());
  state.lastEvent = { type: 'start', seq: ++state.eventSeq };
  return state;
}

function startTurn(state: GameState, seat: Seat, now: number): void {
  state.turn = seat;
  state.working = { rack: [...state.racks[seat]!], table: state.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })) };
  state.history = [];
  state.turnDeadline = state.turnSeconds > 0 ? now + state.turnSeconds * 1000 : null;
}

export function turnContext(state: GameState): TurnContext {
  return { start: { rack: state.racks[state.turn]!, table: state.table }, opened: state.opened[state.turn]! };
}

function meldIdGen(state: GameState): () => string {
  return () => `m${state.nextMeldSeq++}`;
}

export function cloneGame(s: GameState): GameState {
  return {
    ...s,
    pool: [...s.pool],
    racks: s.racks.map((r) => [...r]),
    table: s.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })),
    opened: [...s.opened],
    working: cloneSnapshot(s.working),
    history: s.history.map(cloneSnapshot),
    result: s.result ? { ...s.result, winners: [...s.result.winners], points: [...s.result.points] } : null,
  };
}

function finish(state: GameState, reason: 'out' | 'pool'): void {
  const sc = scoring(state.racks);
  state.status = 'ended';
  state.turnDeadline = null;
  state.result = { winners: sc.winners, reason, points: sc.points };
  state.lastEvent = { type: 'end', seq: ++state.eventSeq };
}

/** Revierte el turno, roba una ficha y pasa el turno. Si el pozo está vacío termina la partida. */
function drawAndPass(state: GameState, now: number, timeout = false): void {
  const seat = state.turn;
  state.working = { rack: [...state.racks[seat]!], table: state.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })) };
  state.history = [];
  if (state.pool.length === 0) {
    finish(state, 'pool');
    return;
  }
  const tile = state.pool.pop()!;
  state.racks[seat]!.push(tile);
  state.lastEvent = { type: 'draw', player: seat, seq: ++state.eventSeq, ...(timeout ? { timeout: true } : {}) };
  startTurn(state, nextSeat(state, seat), now);
}

/** Siguiente asiento en orden de turno. */
export function nextSeat(state: GameState, seat: Seat): Seat {
  return (seat + 1) % state.numPlayers;
}

export type IntentResult = { ok: true } | { ok: false; error: GameErrorCode };

function sanitizeTarget(raw: unknown): MoveTarget | null {
  const to = raw as Record<string, unknown> | undefined;
  if (!to || typeof to !== 'object') return null;
  if (to.kind === 'rack' || to.kind === 'new') return { kind: to.kind };
  if (
    to.kind === 'meld' &&
    typeof to.meldId === 'string' &&
    to.meldId.length <= 16 &&
    typeof to.index === 'number' &&
    Number.isInteger(to.index) &&
    to.index >= 0 &&
    to.index <= 20
  ) {
    return { kind: 'meld', meldId: to.meldId, index: to.index };
  }
  return null;
}

/** Valida que una intención recibida por red tenga la forma correcta. */
export function sanitizeIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Record<string, unknown>;
  switch (i.type) {
    case 'undo':
    case 'reset':
    case 'draw':
    case 'endTurn':
      return { type: i.type };
    case 'moveMeld': {
      if (typeof i.meldId !== 'string' || !i.meldId || i.meldId.length > 16) return null;
      const target = sanitizeTarget(i.to);
      return target ? { type: 'moveMeld', meldId: i.meldId, to: target } : null;
    }
    case 'move': {
      if (!isValidTileId(i.tileId)) return null;
      const to = i.to as Record<string, unknown> | undefined;
      if (!to || typeof to !== 'object') return null;
      if (to.kind === 'rack' || to.kind === 'new') return { type: 'move', tileId: i.tileId, to: { kind: to.kind } };
      if (
        to.kind === 'meld' &&
        typeof to.meldId === 'string' &&
        to.meldId.length <= 16 &&
        typeof to.index === 'number' &&
        Number.isInteger(to.index) &&
        to.index >= 0 &&
        to.index <= 20
      ) {
        return { type: 'move', tileId: i.tileId, to: { kind: 'meld', meldId: to.meldId, index: to.index } };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Aplica una intención de un jugador. MUTA el estado (el servidor es el dueño).
 * Para predicción en cliente usar sobre una copia (cloneGame).
 */
export function applyIntent(state: GameState, seat: Seat, intent: Intent, now = Date.now()): IntentResult {
  if (state.status !== 'playing') return { ok: false, error: 'GAME_OVER' };
  if (state.turn !== seat) return { ok: false, error: 'NOT_YOUR_TURN' };
  switch (intent.type) {
    case 'move': {
      const r = applyMove(turnContext(state), state.working, intent.tileId, intent.to, meldIdGen(state));
      if (!r.ok) return r;
      state.history.push(state.working);
      state.working = r.snapshot;
      break;
    }
    case 'moveMeld': {
      const r = applyMeldMove(turnContext(state), state.working, intent.meldId, intent.to);
      if (!r.ok) return r;
      // Un solo paso de deshacer para toda la combinación
      state.history.push(state.working);
      state.working = r.snapshot;
      break;
    }
    case 'undo': {
      const prev = state.history.pop();
      if (!prev) return { ok: false, error: 'NOTHING_TO_UNDO' };
      state.working = prev;
      break;
    }
    case 'reset': {
      if (state.history.length === 0) return { ok: false, error: 'NOTHING_TO_UNDO' };
      state.history = [];
      state.working = { rack: [...state.racks[seat]!], table: state.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })) };
      break;
    }
    case 'draw': {
      drawAndPass(state, now);
      break;
    }
    case 'endTurn': {
      const r = applyTurn(turnContext(state), state.working);
      if (!r.ok) return r;
      if (r.played.length === 0) {
        drawAndPass(state, now);
        break;
      }
      state.racks[seat] = [...state.working.rack];
      state.table = state.working.table.map((m) => ({ id: m.id, tiles: [...m.tiles] }));
      if (r.openedNow) state.opened[seat] = true;
      state.lastEvent = { type: 'play', player: seat, seq: ++state.eventSeq, tiles: r.played };
      if (state.racks[seat]!.length === 0) {
        finish(state, 'out');
      } else {
        startTurn(state, nextSeat(state, seat), now);
      }
      break;
    }
  }
  state.version++;
  return { ok: true };
}

/** Si el turno expiró: se revierte y se roba. Devuelve true si hubo cambios. */
export function checkTimeout(state: GameState, now = Date.now()): boolean {
  if (state.status !== 'playing' || state.turnDeadline === null || now < state.turnDeadline) return false;
  drawAndPass(state, now, true);
  state.version++;
  return true;
}

/** Fuerza el fin del turno actual (revertir + robar), p. ej. por un jugador ausente. */
export function forceDraw(state: GameState, now = Date.now()): boolean {
  if (state.status !== 'playing') return false;
  drawAndPass(state, now, true);
  state.version++;
  return true;
}

/** Termina la partida ahora (p. ej. si solo queda un humano). Gana quien tenga menos puntos. */
export function forceFinish(state: GameState): void {
  if (state.status !== 'playing') return;
  state.working = { rack: [...state.racks[state.turn]!], table: state.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })) };
  state.history = [];
  finish(state, 'pool');
  state.version++;
}

/** Atril visible para un asiento (si es su turno, el atril en edición). */
export function rackOf(state: GameState, seat: Seat): TileId[] {
  return state.turn === seat && state.status === 'playing' ? state.working.rack : state.racks[seat]!;
}

export function currentTable(state: GameState): Meld[] {
  return state.status === 'playing' ? state.working.table : state.table;
}

export interface ViewMeta {
  roomCode: string;
  /** Datos públicos por asiento (tantos como jugadores). */
  players: Omit<PublicPlayer, 'rackCount' | 'opened'>[];
  rematch: boolean[];
  host?: number;
  bestOf?: number;
  match?: MatchInfo | null;
  now?: number;
}

/** Proyección filtrada del estado para un jugador (anti-trampa: sin atril rival ni pozo). */
export function viewFor(state: GameState, seat: Seat, meta: ViewMeta): PlayerView {
  const players: PublicPlayer[] = state.racks.map((_, i) => ({
    ...meta.players[i]!,
    rackCount: rackOf(state, i).length,
    opened: state.opened[i]!,
  }));
  const playing = state.status === 'playing';
  const startRack = state.racks[state.turn]!;
  const workingRack = new Set(state.working.rack);
  return {
    roomCode: meta.roomCode,
    you: seat,
    players,
    host: meta.host ?? 0,
    rack: [...rackOf(state, seat)],
    table: currentTable(state).map((m) => ({ id: m.id, tiles: [...m.tiles] })),
    poolCount: state.pool.length,
    turn: state.turn,
    turnDeadline: state.turnDeadline,
    serverNow: meta.now ?? Date.now(),
    turnSeconds: state.turnSeconds,
    status: state.status,
    canUndo: playing && state.turn === seat && state.history.length > 0,
    playedThisTurn: playing ? startRack.filter((t) => !workingRack.has(t)) : [],
    turnStartTable: tableTiles(state.table),
    lastEvent: state.lastEvent,
    result: state.result,
    rematch: [...meta.rematch],
    bestOf: meta.bestOf ?? 1,
    match: meta.match ?? null,
    version: state.version,
    nextMeldSeq: state.nextMeldSeq,
  };
}
