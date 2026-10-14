import { describe, expect, it } from 'vitest';
import { applyIntent, createGame, sanitizeIntent } from '../src/game.js';
import { applyMeldMove, applyMultiMove, applyTurn, type TurnContext } from '../src/rules.js';
import { B, K, O, R } from './helpers.js';

const ctx = (rack: number[], table: number[][], opened: boolean): TurnContext => ({
  start: { rack, table: table.map((tiles, i) => ({ id: `t${i}`, tiles })) },
  opened,
});

describe('mover una combinación entera', () => {
  it('unir dos escaleras: 3-4-5 sobre 6-7 da 3-4-5-6-7', () => {
    const c = ctx([R(6), R(7)], [[R(3), R(4), R(5)]], true);
    const snap = { rack: [], table: [...c.start.table, { id: 'n', tiles: [R(6), R(7)] }] };
    const r = applyMeldMove(c, snap, 't0', { kind: 'meld', meldId: 'n', index: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.table).toHaveLength(1);
    expect(r.snapshot.table[0]!.tiles).toEqual([R(3), R(4), R(5), R(6), R(7)]);
    expect(applyTurn(c, r.snapshot).ok).toBe(true);
  });

  it('se ordena sola aunque se suelte "del lado equivocado"', () => {
    const c = ctx([R(6), R(7)], [[R(3), R(4), R(5)]], true);
    const snap = { rack: [], table: [...c.start.table, { id: 'n', tiles: [R(6), R(7)] }] };
    const r = applyMeldMove(c, snap, 'n', { kind: 'meld', meldId: 't0', index: 0 });
    expect(r.ok && r.snapshot.table[0]!.tiles).toEqual([R(3), R(4), R(5), R(6), R(7)]);
  });

  it('al atril solo si todas sus fichas son mías de este turno', () => {
    const c = ctx([R(10), B(10), O(10)], [[K(1), K(2), K(3)]], true);
    const mine = { rack: [], table: [...c.start.table, { id: 'n', tiles: [R(10), B(10), O(10)] }] };
    const r = applyMeldMove(c, mine, 'n', { kind: 'rack' });
    expect(r.ok && r.snapshot.rack.sort()).toEqual([R(10), B(10), O(10)].sort());
    expect(applyMeldMove(c, mine, 't0', { kind: 'rack' })).toEqual({ ok: false, error: 'CANT_TAKE_FROM_TABLE' });
  });

  it('sin abrir no se puede mover ni unir con combinaciones que ya estaban en la mesa', () => {
    const c = ctx([R(10), B(10), O(10)], [[K(1), K(2), K(3)]], false);
    const snap = { rack: [], table: [...c.start.table, { id: 'n', tiles: [R(10), B(10), O(10)] }] };
    expect(applyMeldMove(c, snap, 't0', { kind: 'new' })).toEqual({ ok: false, error: 'NOT_OPENED' });
    expect(applyMeldMove(c, snap, 'n', { kind: 'meld', meldId: 't0', index: 0 })).toEqual({ ok: false, error: 'NOT_OPENED' });
    // Mover la propia combinación nueva sí
    expect(applyMeldMove(c, snap, 'n', { kind: 'new' }).ok).toBe(true);
  });

  it('en la partida es un solo paso de deshacer y se valida en el servidor', () => {
    const g = createGame({ seed: 3, firstPlayer: 0 });
    g.opened[0] = true;
    g.racks[0] = [R(1), R(2), R(3), R(4), K(9)];
    g.working = { rack: [...g.racks[0]!], table: [] };
    applyIntent(g, 0, { type: 'move', tileId: R(1), to: { kind: 'new' } });
    const a = g.working.table[0]!.id;
    applyIntent(g, 0, { type: 'move', tileId: R(2), to: { kind: 'meld', meldId: a, index: 1 } });
    applyIntent(g, 0, { type: 'move', tileId: R(3), to: { kind: 'new' } });
    const b = g.working.table[1]!.id;
    applyIntent(g, 0, { type: 'move', tileId: R(4), to: { kind: 'meld', meldId: b, index: 1 } });
    expect(applyIntent(g, 0, { type: 'moveMeld', meldId: a, to: { kind: 'meld', meldId: b, index: 0 } })).toEqual({ ok: true });
    expect(g.working.table.map((m) => m.tiles)).toEqual([[R(1), R(2), R(3), R(4)]]);
    applyIntent(g, 0, { type: 'undo' });
    expect(g.working.table).toHaveLength(2);
    expect(applyIntent(g, 1, { type: 'moveMeld', meldId: a, to: { kind: 'new' } })).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('sanitizeIntent de moveMeld', () => {
    expect(sanitizeIntent({ type: 'moveMeld', meldId: 'm1', to: { kind: 'rack' } })).toEqual({ type: 'moveMeld', meldId: 'm1', to: { kind: 'rack' } });
    expect(sanitizeIntent({ type: 'moveMeld', meldId: 7, to: { kind: 'rack' } })).toBeNull();
    expect(sanitizeIntent({ type: 'moveMeld', meldId: 'm1', to: { kind: 'meld', meldId: 'x', index: 99 } })).toBeNull();
  });
});

describe('mover varias fichas del atril a la vez', () => {
  it('tres fichas a una combinación nueva, en un solo paso de deshacer', () => {
    const g = createGame({ seed: 5, firstPlayer: 0 });
    g.racks[0] = [R(10), B(10), O(10), K(3)];
    g.working = { rack: [...g.racks[0]!], table: [] };
    expect(applyIntent(g, 0, { type: 'moveTiles', tileIds: [R(10), B(10), O(10)], to: { kind: 'new' } })).toEqual({ ok: true });
    expect(g.working.table).toHaveLength(1);
    expect([...g.working.table[0]!.tiles].sort()).toEqual([R(10), B(10), O(10)].sort());
    expect(g.working.rack).toEqual([K(3)]);
    expect(applyIntent(g, 0, { type: 'endTurn' })).toEqual({ ok: true }); // apertura de 30
    expect(g.opened[0]).toBe(true);
  });

  it('dos fichas insertadas juntas en una escalera existente', () => {
    const c = ctx([R(4), R(5)], [[R(1), R(2), R(3)]], true);
    const r = applyMultiMove(c, c.start, [R(4), R(5)], { kind: 'meld', meldId: 't0', index: 3 }, () => 'x');
    expect(r.ok && r.snapshot.table[0]!.tiles).toEqual([R(1), R(2), R(3), R(4), R(5)]);
  });

  it('deshacer devuelve las tres de una vez', () => {
    const g = createGame({ seed: 6, firstPlayer: 0 });
    g.racks[0] = [R(10), B(10), O(10), K(3)];
    g.working = { rack: [...g.racks[0]!], table: [] };
    applyIntent(g, 0, { type: 'moveTiles', tileIds: [R(10), B(10), O(10)], to: { kind: 'new' } });
    applyIntent(g, 0, { type: 'undo' });
    expect(g.working.rack).toHaveLength(4);
    expect(g.working.table).toHaveLength(0);
  });

  it('valida: solo fichas de mi atril, sin repetidas, sin abrir no toca la mesa', () => {
    const c = ctx([R(4), R(5)], [[R(1), R(2), R(3)]], false);
    expect(applyMultiMove(c, c.start, [R(4), R(4)], { kind: 'new' }, () => 'x')).toEqual({ ok: false, error: 'BAD_INTENT' });
    expect(applyMultiMove(c, c.start, [R(1)], { kind: 'new' }, () => 'x')).toEqual({ ok: false, error: 'TILE_NOT_AVAILABLE' });
    expect(applyMultiMove(c, c.start, [R(4), R(5)], { kind: 'meld', meldId: 't0', index: 3 }, () => 'x')).toEqual({ ok: false, error: 'NOT_OPENED' });
    expect(sanitizeIntent({ type: 'moveTiles', tileIds: [1, 2, 999], to: { kind: 'new' } })).toBeNull();
    expect(sanitizeIntent({ type: 'moveTiles', tileIds: [1, 2], to: { kind: 'new' } })).toEqual({ type: 'moveTiles', tileIds: [1, 2], to: { kind: 'new' } });
  });
});
