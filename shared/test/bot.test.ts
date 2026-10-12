import { describe, expect, it } from 'vitest';
import { bestRackMelds, botMoveToIntent, planBotTurn } from '../src/bot.js';
import { applyIntent, createGame, turnContext } from '../src/game.js';
import { isValidMeld } from '../src/melds.js';
import { canOpen } from '../src/rules.js';
import { B, J1, K, O, R } from './helpers.js';

describe('bot', () => {
  it('encuentra la mejor apertura con backtracking', () => {
    const rack = [R(10), B(10), O(10), K(10), R(1), R(2), R(3), B(7), O(2)];
    const melds = bestRackMelds(rack, 30);
    expect(melds.every(isValidMeld)).toBe(true);
    expect(canOpen(melds)).toBe(true);
    expect(melds.flat().length).toBe(7);
  });
  it('no abre si no llega a 30', () => {
    const plan = planBotTurn({ start: { rack: [R(1), R(2), R(3), B(5)], table: [] }, opened: false });
    expect(plan.play).toBe(false);
  });
  it('usa comodines', () => {
    const melds = bestRackMelds([R(12), R(13), J1, B(2)], 30);
    expect(melds).toHaveLength(1);
    expect(melds[0]).toContain(J1);
  });
  it('extiende combinaciones de la mesa', () => {
    const plan = planBotTurn({
      start: { rack: [R(4), K(9)], table: [{ id: 'a', tiles: [R(1), R(2), R(3)] }] },
      opened: true,
    });
    expect(plan.play).toBe(true);
    expect(plan.moves.map((m) => m.tileId)).toContain(R(4));
  });
  it('libera un comodín de la mesa', () => {
    const plan = planBotTurn({
      start: { rack: [R(5), B(8), O(8)], table: [{ id: 'a', tiles: [R(4), J1, R(6)] }] },
      opened: true,
    });
    expect(plan.play).toBe(true);
    expect(plan.moves.map((m) => m.tileId).sort()).toEqual([R(5), B(8), O(8), J1].sort());
  });
  it('toma prestada una ficha de una escalera larga', () => {
    const plan = planBotTurn({
      start: { rack: [K(5), B(5)], table: [{ id: 'a', tiles: [R(2), R(3), R(4), R(5)] }] },
      opened: true,
    });
    expect(plan.play).toBe(true);
  });
  it('partidas completas bot vs bot terminan sin errores', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = createGame({ seed, turnSeconds: 0 });
      let turns = 0;
      while (g.status === 'playing' && turns < 400) {
        const seat = g.turn;
        const plan = planBotTurn(turnContext(g));
        for (const m of plan.moves) {
          const intent = botMoveToIntent(m, g.working.table);
          expect(intent).not.toBeNull();
          const r = applyIntent(g, seat, intent!);
          expect(r).toEqual({ ok: true });
        }
        const r = applyIntent(g, seat, { type: plan.play ? 'endTurn' : 'draw' });
        expect(r).toEqual({ ok: true });
        turns++;
        // Invariantes: 106 fichas siempre
        const total = g.pool.length + g.racks[0].length + g.racks[1].length + g.table.reduce((s, m) => s + m.tiles.length, 0);
        expect(total).toBe(106);
        expect(g.table.every((m) => isValidMeld(m.tiles))).toBe(true);
      }
      expect(g.status).toBe('ended');
    }
  }, 60_000);
});
