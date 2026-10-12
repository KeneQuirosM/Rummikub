import { describe, expect, it } from 'vitest';
import { analyzeMeld, arrangeMeld, isValidMeld, validateMelds } from '../src/melds.js';
import { createDeck, isJoker, rackPoints, tileColor, tileNumber } from '../src/tiles.js';
import { B, J1, J2, K, O, R } from './helpers.js';

describe('fichas', () => {
  it('hay 106 fichas: 2 copias de 1-13 en 4 colores + 2 comodines', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(106);
    expect(deck.filter(isJoker)).toHaveLength(2);
    const counts = new Map<string, number>();
    for (const t of deck.filter((t) => !isJoker(t))) {
      const k = `${tileColor(t)}-${tileNumber(t)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
  });
  it('comodín en atril vale 30', () => {
    expect(rackPoints([J1, R(5)])).toBe(35);
  });
});

describe('grupos', () => {
  it('3 y 4 colores distintos del mismo número son válidos', () => {
    expect(isValidMeld([R(7), B(7), O(7)])).toBe(true);
    expect(analyzeMeld([R(7), B(7), O(7), K(7)])).toMatchObject({ valid: true, kind: 'group', value: 28 });
  });
  it('colores repetidos no valen', () => {
    expect(analyzeMeld([R(7), R(7, 1), O(7)])).toMatchObject({ valid: false, error: 'duplicate_color' });
  });
  it('más de 4 no vale, menos de 3 no vale', () => {
    expect(isValidMeld([R(7), B(7), O(7), K(7), J1])).toBe(false);
    expect(analyzeMeld([R(7), B(7)])).toMatchObject({ valid: false, error: 'too_short' });
  });
  it('comodines en grupos', () => {
    expect(analyzeMeld([R(9), J1, O(9)])).toMatchObject({ valid: true, kind: 'group', value: 27 });
    expect(analyzeMeld([R(9), J1, O(9), J2])).toMatchObject({ valid: true, value: 36 });
  });
});

describe('escaleras', () => {
  it('3 o más consecutivas del mismo color', () => {
    expect(analyzeMeld([B(3), B(4), B(5)])).toMatchObject({ valid: true, kind: 'run', value: 12 });
    expect(isValidMeld([B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9), B(10), B(11), B(12), B(13)])).toBe(true);
  });
  it('colores mezclados o huecos no valen', () => {
    expect(isValidMeld([B(3), R(4), B(5)])).toBe(false);
    expect(isValidMeld([B(3), B(5), B(6)])).toBe(false);
  });
  it('12-13-1 es inválida (el 1 no conecta con el 13)', () => {
    expect(isValidMeld([O(12), O(13), O(1)])).toBe(false);
    expect(isValidMeld([O(13), O(1), O(2)])).toBe(false);
    expect(arrangeMeld([O(12), O(13), O(1)]).length).toBe(3);
    expect(isValidMeld(arrangeMeld([O(12), O(13), O(1)]))).toBe(false);
  });
  it('comodín en medio y en extremos', () => {
    expect(analyzeMeld([K(4), J1, K(6)])).toMatchObject({ valid: true, kind: 'run', value: 15 });
    expect(analyzeMeld([J1, K(5), K(6)])).toMatchObject({ valid: true, value: 15 });
    expect(analyzeMeld([K(12), K(13), J1])).toMatchObject({ valid: false }); // sería 14
    expect(analyzeMeld([J1, K(12), K(13)])).toMatchObject({ valid: true, value: 36 });
    expect(analyzeMeld([J1, J2, K(1)])).toMatchObject({ valid: true, kind: 'group', value: 3 }); // como escalera empezaría en -1
  });
  it('dos comodines', () => {
    expect(analyzeMeld([R(1), J1, J2, R(4)])).toMatchObject({ valid: true, kind: 'run', value: 10 });
  });
  it('X-J-J puede ser grupo o escalera: se toma el mayor valor', () => {
    expect(analyzeMeld([R(5), J1, J2])).toMatchObject({ valid: true, kind: 'run', value: 18 });
  });
});

describe('arrangeMeld', () => {
  it('ordena escaleras y coloca comodines en huecos', () => {
    expect(arrangeMeld([R(6), R(4), J1])).toEqual([R(4), J1, R(6)]);
    expect(arrangeMeld([R(6), R(5), R(4)])).toEqual([R(4), R(5), R(6)]);
  });
  it('comodín sobrante al final o al principio si no cabe', () => {
    expect(arrangeMeld([R(13), J1, R(12)])).toEqual([J1, R(12), R(13)]);
    expect(arrangeMeld([R(3), J1, R(4)])).toEqual([R(3), R(4), J1]);
  });
  it('respeta el orden si ya es válido', () => {
    expect(arrangeMeld([J1, R(5), R(6)])).toEqual([J1, R(5), R(6)]);
  });
  it('nunca cambia el conjunto de fichas', () => {
    const tiles = [R(2), B(9), J1, O(4)];
    expect([...arrangeMeld(tiles)].sort()).toEqual([...tiles].sort());
  });
});

describe('validateMelds', () => {
  it('reporta por combinación', () => {
    const v = validateMelds([[R(1), R(2), R(3)], [R(1), B(2)]]);
    expect(v.allValid).toBe(false);
    expect(v.results.map((r) => r.valid)).toEqual([true, false]);
  });
});
