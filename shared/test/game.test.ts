import { describe, expect, it } from 'vitest';
import { applyIntent, checkTimeout, createGame, forceDraw, forceFinish, sanitizeIntent, viewFor, type GameState, type Seat, type ViewMeta } from '../src/game.js';
import { B, K, O, R } from './helpers.js';

const meta: ViewMeta = {
  roomCode: 'ABCD',
  players: [
    { name: 'A', avatar: '🦊', connected: true, isBot: false, wins: 0 },
    { name: 'B', avatar: '🐼', connected: true, isBot: false, wins: 0 },
  ],
  rematch: [false, false],
};

function rig(state: GameState, seat: Seat, rack: number[]) {
  // Fuerza un atril concreto (conserva el total de fichas intercambiando con el pozo)
  const all = [...state.pool, ...state.racks.flat()];
  const rest = all.filter((t) => !rack.includes(t));
  state.racks = state.racks.map((_, i) => (i === seat ? [...rack] : rest.splice(0, 14)));
  state.pool = rest;
  state.working = { rack: [...state.racks[state.turn]!], table: [] };
}

describe('partida', () => {
  it('reparte 14 a cada uno y 78 al pozo', () => {
    const g = createGame({ seed: 1 });
    expect(g.racks[0]).toHaveLength(14);
    expect(g.racks[1]).toHaveLength(14);
    expect(g.pool).toHaveLength(78);
    expect(new Set([...g.pool, ...g.racks[0]!, ...g.racks[1]!]).size).toBe(106);
  });

  it('solo juega quien tiene el turno', () => {
    const g = createGame({ seed: 2, firstPlayer: 0 });
    expect(applyIntent(g, 1, { type: 'draw' })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('robar pasa el turno y suma una ficha', () => {
    const g = createGame({ seed: 3, firstPlayer: 0 });
    expect(applyIntent(g, 0, { type: 'draw' }).ok).toBe(true);
    expect(g.racks[0]).toHaveLength(15);
    expect(g.pool).toHaveLength(77);
    expect(g.turn).toBe(1);
  });

  it('terminar turno sin jugar equivale a robar', () => {
    const g = createGame({ seed: 4, firstPlayer: 0 });
    applyIntent(g, 0, { type: 'endTurn' });
    expect(g.racks[0]).toHaveLength(15);
    expect(g.turn).toBe(1);
  });

  it('abrir, deshacer ilimitado y rollback', () => {
    const g = createGame({ seed: 5, firstPlayer: 0 });
    rig(g, 0, [R(10), B(10), O(10), K(1), K(2), K(5), K(7), R(1), R(2), B(4), B(5), O(6), O(8), O(11)]);
    const n = g.nextMeldSeq;
    expect(applyIntent(g, 0, { type: 'move', tileId: R(10), to: { kind: 'new' } }).ok).toBe(true);
    const id = `m${n}`;
    applyIntent(g, 0, { type: 'move', tileId: B(10), to: { kind: 'meld', meldId: id, index: 1 } });
    // Intentar terminar con 2 fichas -> inválido
    expect(applyIntent(g, 0, { type: 'endTurn' })).toEqual({ ok: false, error: 'INVALID_MELDS' });
    applyIntent(g, 0, { type: 'move', tileId: O(10), to: { kind: 'meld', meldId: id, index: 2 } });
    expect(g.working.rack).toHaveLength(11);
    // deshacer 3 veces
    for (let i = 0; i < 3; i++) expect(applyIntent(g, 0, { type: 'undo' }).ok).toBe(true);
    expect(applyIntent(g, 0, { type: 'undo' })).toEqual({ ok: false, error: 'NOTHING_TO_UNDO' });
    expect(g.working.rack).toHaveLength(14);
    expect(g.working.table).toHaveLength(0);
    // rehacer y terminar
    applyIntent(g, 0, { type: 'move', tileId: R(10), to: { kind: 'new' } });
    const id2 = g.working.table[0]!.id;
    applyIntent(g, 0, { type: 'move', tileId: B(10), to: { kind: 'meld', meldId: id2, index: 1 } });
    applyIntent(g, 0, { type: 'move', tileId: O(10), to: { kind: 'meld', meldId: id2, index: 2 } });
    expect(applyIntent(g, 0, { type: 'endTurn' })).toEqual({ ok: true });
    expect(g.opened[0]).toBe(true);
    expect(g.racks[0]).toHaveLength(11);
    expect(g.table).toHaveLength(1);
    expect(g.turn).toBe(1);
  });

  it('timeout: revierte el turno y roba', () => {
    const g = createGame({ seed: 6, firstPlayer: 0, turnSeconds: 60, now: 1000 });
    rig(g, 0, [R(10), B(10), O(10), K(1), K(2), K(5), K(7), R(1), R(2), B(4), B(5), O(6), O(8), O(11)]);
    applyIntent(g, 0, { type: 'move', tileId: R(10), to: { kind: 'new' } }, 2000);
    expect(checkTimeout(g, 30_000)).toBe(false);
    expect(checkTimeout(g, 61_000)).toBe(true);
    expect(g.table).toHaveLength(0);
    expect(g.racks[0]).toHaveLength(15);
    expect(g.racks[0]).toContain(R(10));
    expect(g.turn).toBe(1);
    expect(g.lastEvent).toMatchObject({ type: 'draw', player: 0, timeout: true });
  });

  it('pozo agotado: termina y gana quien tiene menos puntos', () => {
    const g = createGame({ seed: 7, firstPlayer: 0 });
    g.pool = [];
    g.racks[0] = [R(1)];
    g.racks[1] = [K(13)];
    g.working = { rack: [R(1)], table: [] };
    applyIntent(g, 0, { type: 'draw' });
    expect(g.status).toBe('ended');
    expect(g.result).toEqual({ winners: [0], reason: 'pool', points: [1, 13] });
  });

  it('gana quien se queda sin fichas', () => {
    const g = createGame({ seed: 8, firstPlayer: 0 });
    g.opened[0] = true;
    g.racks[0] = [R(1), R(2), R(3)];
    g.working = { rack: [R(1), R(2), R(3)], table: [] };
    applyIntent(g, 0, { type: 'move', tileId: R(1), to: { kind: 'new' } });
    const id = g.working.table[0]!.id;
    applyIntent(g, 0, { type: 'move', tileId: R(2), to: { kind: 'meld', meldId: id, index: 1 } });
    applyIntent(g, 0, { type: 'move', tileId: R(3), to: { kind: 'meld', meldId: id, index: 2 } });
    applyIntent(g, 0, { type: 'endTurn' });
    expect(g.status).toBe('ended');
    expect(g.result?.winners).toEqual([0]);
    expect(g.result?.reason).toBe('out');
  });

  it('la vista nunca expone el atril rival ni el pozo', () => {
    const g = createGame({ seed: 9, firstPlayer: 0 });
    const v = viewFor(g, 1, meta);
    const json = JSON.stringify(v);
    expect(v.rack).toEqual(g.racks[1]);
    expect(v.players[0]!.rackCount).toBe(14);
    expect(json).not.toContain('pool"');
    // Ninguna ficha del rival aparece en la vista
    for (const t of g.racks[0]!) expect(v.rack).not.toContain(t);
    expect(Object.keys(v)).not.toContain('racks');
  });

  it('sanitizeIntent rechaza basura', () => {
    expect(sanitizeIntent(null)).toBeNull();
    expect(sanitizeIntent({ type: 'move', tileId: 999, to: { kind: 'new' } })).toBeNull();
    expect(sanitizeIntent({ type: 'move', tileId: 3, to: { kind: 'meld', meldId: 'x', index: -1 } })).toBeNull();
    expect(sanitizeIntent({ type: 'hack' })).toBeNull();
    expect(sanitizeIntent({ type: 'undo', extra: 1 })).toEqual({ type: 'undo' });
  });
});

describe('partida de 3 y 4 jugadores', () => {
  it('reparte 14 a cada uno: con 4 quedan 50 en el pozo', () => {
    const g = createGame({ seed: 11, players: 4 });
    expect(g.numPlayers).toBe(4);
    expect(g.racks.map((r) => r.length)).toEqual([14, 14, 14, 14]);
    expect(g.pool).toHaveLength(50);
    expect(new Set([...g.pool, ...g.racks.flat()]).size).toBe(106);
    expect(createGame({ seed: 1, players: 3 }).pool).toHaveLength(64);
  });

  it('el turno rota en orden y vuelve al primero', () => {
    const g = createGame({ seed: 12, players: 3, firstPlayer: 1 });
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(g.turn);
      expect(applyIntent(g, g.turn, { type: 'draw' }).ok).toBe(true);
    }
    expect(order).toEqual([1, 2, 0, 1, 2, 0]);
    expect(applyIntent(g, (g.turn + 1) % 3, { type: 'draw' })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('pozo agotado con empate: varios ganadores', () => {
    const g = createGame({ seed: 13, players: 4, firstPlayer: 0 });
    g.pool = [];
    g.racks = [[R(5)], [B(5)], [K(13)], [O(9)]];
    g.working = { rack: [R(5)], table: [] };
    applyIntent(g, 0, { type: 'draw' });
    expect(g.result).toEqual({ winners: [0, 1], reason: 'pool', points: [5, 5, 13, 9] });
  });

  it('la vista de cada jugador solo trae su atril; los demás solo como cantidad', () => {
    const g = createGame({ seed: 14, players: 4 });
    const players = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, avatar: '🙂', connected: true, isBot: false, wins: 0 }));
    for (let seat = 0; seat < 4; seat++) {
      const v = viewFor(g, seat, { roomCode: 'ABCD', players, rematch: [false, false, false, false] });
      expect(v.players).toHaveLength(4);
      expect(v.rack).toEqual(g.racks[seat]);
      for (let o = 0; o < 4; o++) if (o !== seat) for (const t of g.racks[o]!) expect(v.rack).not.toContain(t);
      expect(v.players.every((p) => p.rackCount === 14)).toBe(true);
    }
  });

  it('forceDraw salta a un jugador ausente', () => {
    const g = createGame({ seed: 15, players: 3, firstPlayer: 2 });
    expect(forceDraw(g)).toBe(true);
    expect(g.turn).toBe(0);
    expect(g.racks[2]).toHaveLength(15);
  });

  it('forceFinish termina con ranking por puntos', () => {
    const g = createGame({ seed: 16, players: 3 });
    g.racks = [[R(9)], [R(2)], [R(4)]];
    forceFinish(g);
    expect(g.status).toBe('ended');
    expect(g.result?.winners).toEqual([1]);
  });
});
