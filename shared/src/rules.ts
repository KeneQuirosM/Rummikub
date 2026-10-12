import { analyzeMeld, arrangeMeld, type Meld } from './melds.js';
import type { GameErrorCode, MoveTarget } from './protocol.js';
import { MIN_OPEN_POINTS, rackPoints, type TileId } from './tiles.js';

/** Estado editable de un turno (atril del jugador en turno + mesa). */
export interface TurnSnapshot {
  rack: TileId[];
  table: Meld[];
}

export interface TurnContext {
  /** Atril y mesa al comenzar el turno. */
  start: TurnSnapshot;
  /** ¿Había abierto antes de este turno? */
  opened: boolean;
}

export type RuleResult<T = {}> = ({ ok: true } & T) | { ok: false; error: GameErrorCode };

export function cloneSnapshot(s: TurnSnapshot): TurnSnapshot {
  return { rack: [...s.rack], table: s.table.map((m) => ({ id: m.id, tiles: [...m.tiles] })) };
}

export function tableTiles(table: readonly Meld[]): TileId[] {
  const out: TileId[] = [];
  for (const m of table) out.push(...m.tiles);
  return out;
}

export function locateTile(
  snap: TurnSnapshot,
  tileId: TileId,
): { where: 'rack'; index: number } | { where: 'table'; meldIndex: number; index: number } | null {
  const ri = snap.rack.indexOf(tileId);
  if (ri >= 0) return { where: 'rack', index: ri };
  for (let mi = 0; mi < snap.table.length; mi++) {
    const ti = snap.table[mi]!.tiles.indexOf(tileId);
    if (ti >= 0) return { where: 'table', meldIndex: mi, index: ti };
  }
  return null;
}

/**
 * Aplica un movimiento de ficha sobre el estado del turno. Función pura: devuelve un snapshot nuevo.
 * `index` del destino se interpreta sobre la combinación destino DESPUÉS de retirar la ficha de su origen.
 * Quitar una ficha del interior de una escalera válida la divide en dos.
 */
export function applyMove(
  ctx: TurnContext,
  current: TurnSnapshot,
  tileId: TileId,
  to: MoveTarget,
  newMeldId: () => string,
): RuleResult<{ snapshot: TurnSnapshot }> {
  const loc = locateTile(current, tileId);
  if (!loc) return { ok: false, error: 'TILE_NOT_AVAILABLE' };
  const startTable = new Set(tableTiles(ctx.start.table));
  const fromStartRack = ctx.start.rack.includes(tileId);

  if (loc.where === 'table' && startTable.has(tileId) && !ctx.opened) return { ok: false, error: 'NOT_OPENED' };
  if (to.kind === 'rack') {
    if (!fromStartRack) return { ok: false, error: 'CANT_TAKE_FROM_TABLE' };
    if (loc.where === 'rack') return { ok: true, snapshot: cloneSnapshot(current) };
  }
  if (to.kind === 'meld') {
    const target = current.table.find((m) => m.id === to.meldId);
    if (!target) return { ok: false, error: 'MELD_NOT_FOUND' };
    if (!ctx.opened && target.tiles.some((t) => startTable.has(t))) return { ok: false, error: 'NOT_OPENED' };
    if (!Number.isInteger(to.index)) return { ok: false, error: 'BAD_INTENT' };
  }

  const snap = cloneSnapshot(current);
  // 1) Retirar del origen
  if (loc.where === 'rack') {
    snap.rack.splice(loc.index, 1);
  } else {
    const src = snap.table[loc.meldIndex]!;
    const before = [...src.tiles];
    src.tiles.splice(loc.index, 1);
    const sameTarget = to.kind === 'meld' && to.meldId === src.id;
    const interior = loc.index > 0 && loc.index < before.length - 1;
    if (!sameTarget && interior && analyzeMeld(before).kind === 'run') {
      const right: Meld = { id: newMeldId(), tiles: src.tiles.splice(loc.index) };
      snap.table.splice(loc.meldIndex + 1, 0, right);
    } else if (src.tiles.length === 0) {
      snap.table.splice(loc.meldIndex, 1);
    } else if (!sameTarget) {
      src.tiles = arrangeMeld(src.tiles);
    }
  }
  // 2) Insertar en el destino
  if (to.kind === 'rack') {
    snap.rack.push(tileId);
  } else if (to.kind === 'new') {
    snap.table.push({ id: newMeldId(), tiles: [tileId] });
  } else {
    const target = snap.table.find((m) => m.id === to.meldId);
    if (!target) {
      // La combinación destino era la de origen y quedó vacía: crear una nueva.
      snap.table.push({ id: to.meldId, tiles: [tileId] });
    } else {
      const idx = Math.max(0, Math.min(target.tiles.length, to.index));
      target.tiles.splice(idx, 0, tileId);
      target.tiles = arrangeMeld(target.tiles);
    }
  }
  return { ok: true, snapshot: snap };
}

function multisetEqual(a: readonly TileId[], b: readonly TileId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

function sameSet(a: readonly TileId[], b: readonly TileId[]): boolean {
  return multisetEqual(a, b);
}

/**
 * ¿Las combinaciones nuevas permiten abrir? Solo cuentan fichas del propio atril.
 */
export function canOpen(newMelds: readonly (readonly TileId[])[], minPoints = MIN_OPEN_POINTS): boolean {
  let sum = 0;
  for (const m of newMelds) {
    const a = analyzeMeld(m);
    if (!a.valid) return false;
    sum += a.value;
  }
  return sum >= minPoints;
}

/** Puntos de apertura que suman las combinaciones nuevas válidas del turno (para el HUD). */
export function openingPoints(ctx: TurnContext, current: TurnSnapshot): number {
  const startTable = new Set(tableTiles(ctx.start.table));
  let sum = 0;
  for (const m of current.table) {
    if (m.tiles.some((t) => startTable.has(t))) continue;
    sum += analyzeMeld(m.tiles).value;
  }
  return sum;
}

export interface TurnOutcome {
  /** Fichas que salieron del atril hacia la mesa. */
  played: TileId[];
  /** El jugador abrió en este turno. */
  openedNow: boolean;
}

/**
 * Valida el final de un turno (aplica las reglas de la mesa). Función pura.
 *  - Conservación de fichas, nada de la mesa vuelve al atril.
 *  - Todas las combinaciones de la mesa válidas.
 *  - Si no había abierto: mesa original intacta y combinaciones nuevas >= 30 con fichas propias.
 * Si no se jugó ninguna ficha devuelve played = [] (el llamador debe robar).
 */
export function applyTurn(ctx: TurnContext, end: TurnSnapshot): RuleResult<TurnOutcome> {
  const startTable = tableTiles(ctx.start.table);
  const endTable = tableTiles(end.table);
  if (!multisetEqual([...ctx.start.rack, ...startTable], [...end.rack, ...endTable])) {
    return { ok: false, error: 'TILES_MISSING' };
  }
  const endRackSet = new Set(end.rack);
  if (startTable.some((t) => endRackSet.has(t))) return { ok: false, error: 'CANT_TAKE_FROM_TABLE' };
  const played = ctx.start.rack.filter((t) => !endRackSet.has(t));
  if (played.length === 0) {
    // Nada jugado: la mesa debe quedar como estaba (en la práctica se revierte y se roba).
    return { ok: true, played: [], openedNow: false };
  }
  for (const m of end.table) {
    if (!analyzeMeld(m.tiles).valid) return { ok: false, error: 'INVALID_MELDS' };
  }
  if (!ctx.opened) {
    const startSet = new Set(startTable);
    const touched = end.table.filter((m) => m.tiles.some((t) => startSet.has(t)));
    const intact =
      touched.length === ctx.start.table.length &&
      touched.every((m) => ctx.start.table.some((s) => sameSet(s.tiles, m.tiles)));
    if (!intact) return { ok: false, error: 'OPENING_TABLE_TOUCHED' };
    const fresh = end.table.filter((m) => !m.tiles.some((t) => startSet.has(t))).map((m) => m.tiles);
    if (!canOpen(fresh)) return { ok: false, error: 'OPENING_TOO_LOW' };
    return { ok: true, played, openedNow: true };
  }
  return { ok: true, played, openedNow: false };
}

/** Puntuación final cuando se acaba el pozo o alguien gana. */
export function scoring(racks: readonly (readonly TileId[])[]): { points: number[]; winner: number | null } {
  const points = racks.map((r) => rackPoints(r));
  const empty = racks.findIndex((r) => r.length === 0);
  if (empty >= 0) return { points, winner: empty };
  const min = Math.min(...points);
  const winners = points.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
  return { points, winner: winners.length === 1 ? winners[0]! : null };
}
