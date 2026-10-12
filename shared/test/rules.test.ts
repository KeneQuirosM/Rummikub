import { describe, expect, it } from 'vitest';
import type { Meld } from '../src/melds.js';
import { applyMove, applyTurn, canOpen, openingPoints, scoring, type TurnContext, type TurnSnapshot } from '../src/rules.js';
import { B, J1, K, O, R } from './helpers.js';

let seq = 100;
const gen = () => `m${seq++}`;

function ctx(rack: number[], table: number[][], opened: boolean): TurnContext {
  const t: Meld[] = table.map((tiles, i) => ({ id: `t${i}`, tiles }));
  return { start: { rack, table: t }, opened };
}

function play(c: TurnContext, moves: Parameters<typeof applyMove>[3][], tiles: number[]): TurnSnapshot {
  let snap: TurnSnapshot = { rack: [...c.start.rack], table: c.start.table.map((m) => ({ ...m, tiles: [...m.tiles] })) };
  moves.forEach((to, i) => {
    const r = applyMove(c, snap, tiles[i]!, to, gen);
    if (!r.ok) throw new Error(r.error);
    snap = r.snapshot;
  });
  return snap;
}

describe('canOpen / apertura de 30', () => {
  it('suma >= 30 con fichas propias', () => {
    expect(canOpen([[R(10), B(10), O(10)]])).toBe(true); // 30
    expect(canOpen([[R(9), B(9), O(9)]])).toBe(false); // 27
    expect(canOpen([[R(9), B(9), O(9)], [K(1), K(2), K(3)]])).toBe(true); // 33
  });
  it('el comodín cuenta como la ficha que representa', () => {
    expect(canOpen([[R(9), J1, O(9)], [K(1), K(2), K(3)]])).toBe(true);
    expect(canOpen([[K(11), J1, K(13)]])).toBe(true); // 36
  });
  it('una combinación inválida impide abrir', () => {
    expect(canOpen([[R(13), B(13), O(13)], [K(1), K(2)]])).toBe(false);
  });
});

describe('applyTurn - apertura', () => {
  it('abre con 30 exactos', () => {
    const c = ctx([R(10), B(10), O(10), K(2)], [], false);
    const end = play(c, [{ kind: 'new' }, { kind: 'meld', meldId: 'm100', index: 1 }, { kind: 'meld', meldId: 'm100', index: 2 }], [R(10), B(10), O(10)]);
    seq = 100;
    const r = applyTurn(c, end);
    expect(r).toMatchObject({ ok: true, openedNow: true });
    if (r.ok) expect(r.played.sort()).toEqual([R(10), B(10), O(10)].sort());
  });
  it('rechaza apertura de 27', () => {
    const c = ctx([R(9), B(9), O(9)], [], false);
    const end: TurnSnapshot = { rack: [], table: [{ id: 'x', tiles: [R(9), B(9), O(9)] }] };
    expect(applyTurn(c, end)).toEqual({ ok: false, error: 'OPENING_TOO_LOW' });
  });
  it('sin abrir no se puede tocar la mesa (ni sumar a combinaciones ajenas)', () => {
    const c = ctx([R(4), R(10), B(10), O(10)], [[R(1), R(2), R(3)]], false);
    const r = applyMove(c, c.start, R(4), { kind: 'meld', meldId: 't0', index: 3 }, gen);
    expect(r).toEqual({ ok: false, error: 'NOT_OPENED' });
    const r2 = applyMove(c, c.start, R(1), { kind: 'new' }, gen);
    expect(r2).toEqual({ ok: false, error: 'NOT_OPENED' });
    // Aunque se fabrique el estado final a mano, applyTurn lo rechaza
    const end: TurnSnapshot = {
      rack: [],
      table: [{ id: 't0', tiles: [R(1), R(2), R(3), R(4)] }, { id: 'n', tiles: [R(10), B(10), O(10)] }],
    };
    expect(applyTurn(c, end)).toEqual({ ok: false, error: 'OPENING_TABLE_TOUCHED' });
  });
  it('las fichas de la mesa no cuentan para la apertura', () => {
    const c = ctx([K(10), K(11)], [[R(1), R(2), R(3)], [K(12), B(12), O(12)]], false);
    const end: TurnSnapshot = {
      rack: [],
      table: [{ id: 't0', tiles: [R(1), R(2), R(3)] }, { id: 't1', tiles: [B(12), O(12)] }, { id: 'n', tiles: [K(10), K(11), K(12)] }],
    };
    expect(applyTurn(c, end).ok).toBe(false);
  });
});

describe('applyTurn - manipulación de mesa', () => {
  it('todas las combinaciones deben quedar válidas', () => {
    const c = ctx([R(9)], [[R(1), R(2), R(3)]], true);
    const end = play(c, [{ kind: 'new' }], [R(9)]);
    expect(applyTurn(c, end)).toEqual({ ok: false, error: 'INVALID_MELDS' });
  });
  it('no se puede devolver al atril una ficha de la mesa', () => {
    const c = ctx([R(9)], [[R(1), R(2), R(3), R(4)]], true);
    expect(applyMove(c, c.start, R(4), { kind: 'rack' }, gen)).toEqual({ ok: false, error: 'CANT_TAKE_FROM_TABLE' });
    const forged: TurnSnapshot = { rack: [R(9), R(4)], table: [{ id: 't0', tiles: [R(1), R(2), R(3)] }] };
    expect(applyTurn(c, forged)).toEqual({ ok: false, error: 'CANT_TAKE_FROM_TABLE' });
  });
  it('detecta fichas que desaparecen o aparecen', () => {
    const c = ctx([R(9)], [[R(1), R(2), R(3)]], true);
    const forged: TurnSnapshot = { rack: [], table: [{ id: 't0', tiles: [R(1), R(2), R(3)] }] };
    expect(applyTurn(c, forged)).toEqual({ ok: false, error: 'TILES_MISSING' });
  });
  it('sí se puede devolver al atril una ficha propia jugada en el turno', () => {
    const c = ctx([R(4), K(9)], [[R(1), R(2), R(3)]], true);
    const s1 = play(c, [{ kind: 'meld', meldId: 't0', index: 3 }], [R(4)]);
    const r = applyMove(c, s1, R(4), { kind: 'rack' }, gen);
    expect(r.ok).toBe(true);
  });
  it('dividir una escalera quitando una ficha interior y reconstruir', () => {
    // Mesa: R1..R7. Atril: R4 (copia). Resultado: R1-R4 y R4-R7
    const c = ctx([R(4, 1)], [[R(1), R(2), R(3), R(4), R(5), R(6), R(7)]], true);
    let snap = play(c, [{ kind: 'new' }], [R(4)]); // dividir: [1,2,3] [5,6,7] [4]
    expect(snap.table.map((m) => m.tiles.length).sort()).toEqual([1, 3, 3]);
    const left = snap.table.find((m) => m.tiles.includes(R(1)))!;
    const right = snap.table.find((m) => m.tiles.includes(R(5)))!;
    const r1 = applyMove(c, snap, R(4), { kind: 'meld', meldId: left.id, index: 3 }, gen);
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyMove(c, r1.snapshot, R(4, 1), { kind: 'meld', meldId: right.id, index: 0 }, gen);
    if (!r2.ok) throw new Error(r2.error);
    snap = r2.snapshot;
    expect(applyTurn(c, snap)).toMatchObject({ ok: true, played: [R(4, 1)] });
  });
  it('reemplazo de comodín: la ficha real entra y el comodín se reutiliza', () => {
    // Mesa: R4 J R6 (J=R5). Atril: R5, B8, O8 -> R4 R5 R6  y  B8 O8 J
    const c = ctx([R(5), B(8), O(8)], [[R(4), J1, R(6)]], true);
    const snap = play(
      c,
      [{ kind: 'meld', meldId: 't0', index: 1 }, { kind: 'new' }],
      [R(5), J1],
    );
    const jm = snap.table.find((m) => m.tiles.includes(J1))!;
    expect(snap.table.find((m) => m.id === 't0')!.tiles).toEqual([R(4), R(5), R(6)]);
    const r1 = applyMove(c, snap, B(8), { kind: 'meld', meldId: jm.id, index: 1 }, gen);
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyMove(c, r1.snapshot, O(8), { kind: 'meld', meldId: jm.id, index: 2 }, gen);
    if (!r2.ok) throw new Error(r2.error);
    const r = applyTurn(c, r2.snapshot);
    expect(r).toMatchObject({ ok: true });
  });
  it('el comodín retirado no puede ir al atril', () => {
    const c = ctx([R(5)], [[R(4), J1, R(6)]], true);
    const s = play(c, [{ kind: 'meld', meldId: 't0', index: 1 }], [R(5)]);
    expect(applyMove(c, s, J1, { kind: 'rack' }, gen)).toEqual({ ok: false, error: 'CANT_TAKE_FROM_TABLE' });
    // y si queda suelto en la mesa el turno es inválido
    const s2 = applyMove(c, s, J1, { kind: 'new' }, gen);
    if (!s2.ok) throw new Error();
    expect(applyTurn(c, s2.snapshot)).toEqual({ ok: false, error: 'INVALID_MELDS' });
  });
  it('sin fichas jugadas -> played vacío (robar)', () => {
    const c = ctx([R(5)], [[R(1), R(2), R(3)]], true);
    expect(applyTurn(c, c.start)).toEqual({ ok: true, played: [], openedNow: false });
  });
});

describe('openingPoints', () => {
  it('suma solo combinaciones nuevas válidas', () => {
    const c = ctx([R(10), B(10), O(10), K(3)], [[K(1), B(1), O(1)]], false);
    const s = play(c, [{ kind: 'new' }], [R(10)]);
    expect(openingPoints(c, s)).toBe(0);
  });
});

describe('scoring', () => {
  it('gana quien se queda sin fichas', () => {
    expect(scoring([[], [R(5)]])).toEqual({ points: [0, 5], winners: [0] });
  });
  it('pozo agotado: menos puntos gana; comodín = 30; empates = varios ganadores', () => {
    expect(scoring([[J1], [R(13), B(13)]])).toEqual({ points: [30, 26], winners: [1] });
    expect(scoring([[R(3)], [B(3)]]).winners).toEqual([0, 1]);
    expect(scoring([[R(9)], [K(3)], [O(3)], [B(1)]]).winners).toEqual([3]);
  });
});
