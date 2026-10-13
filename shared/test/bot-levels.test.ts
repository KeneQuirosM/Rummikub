import { describe, expect, it } from 'vitest';
import { botMoveToIntent, planBotTurn, solveTableRearrangement, type BotLevel } from '../src/bot.js';
import { applyIntent, createGame, turnContext } from '../src/game.js';
import { isValidMeld } from '../src/melds.js';
import { mulberry32 } from '../src/tiles.js';
import { B, O, R } from './helpers.js';

/** Torneo determinista entre dos niveles. Toda jugada del bot debe ser aceptada por el motor. */
function match(a: BotLevel, b: BotLevel, games: number, seed0: number): [number, number] {
  const wins: [number, number] = [0, 0];
  for (let i = 0; i < games; i++) {
    const g = createGame({ seed: seed0 + i, players: 2, turnSeconds: 0, firstPlayer: i % 2 });
    const rand = mulberry32(seed0 * 7 + i);
    const levels = [a, b];
    let turns = 0;
    while (g.status === 'playing' && turns++ < 500) {
      const seat = g.turn;
      const plan = planBotTurn(turnContext(g), undefined, { level: levels[seat], rand });
      for (const m of plan.moves) {
        const intent = botMoveToIntent(m, g.working.table);
        expect(intent).not.toBeNull();
        expect(applyIntent(g, seat, intent!)).toEqual({ ok: true });
      }
      expect(applyIntent(g, seat, { type: plan.play ? 'endTurn' : 'draw' })).toEqual({ ok: true });
      expect(g.table.every((m) => isValidMeld(m.tiles))).toBe(true);
    }
    expect(g.status).toBe('ended');
    if (g.result!.winners.length === 1) wins[g.result!.winners[0] as 0 | 1]++;
  }
  return wins;
}

describe('dificultad del bot', () => {
  it('Normal le gana a Fácil la mayoría de las veces (Fácil no es imposible de ganar ni regala)', () => {
    const [easy, normal] = match('easy', 'normal', 16, 500);
    expect(normal).toBeGreaterThan(easy * 2);
  }, 120_000);

  it('Difícil le gana a Normal la mayoría de las veces', () => {
    const [normal, hard] = match('normal', 'hard', 12, 900);
    expect(hard).toBeGreaterThan(normal * 2);
  }, 120_000);

  it('Difícil reorganiza la mesa y juega donde Normal tiene que robar', () => {
    // Posición real encontrada en partidas bot vs bot
    const ctx = {
      start: {
        rack: [6, 8, 26, 56, 49, 94, 75],
        table: [
          { id: 'a', tiles: [65, 14, 15, 68, 17] },
          { id: 'b', tiles: [86, 105, 36, 89, 90] },
          { id: 'c', tiles: [63, 76, 50] },
          { id: 'd', tiles: [81, 30, 83] },
        ],
      },
      opened: true,
    };
    expect(planBotTurn(ctx, undefined, { level: 'normal' }).play).toBe(false);
    const solved = solveTableRearrangement(ctx, ctx.start);
    expect(solved).not.toBeNull();
    expect(solved!.placed).toBeGreaterThan(0);
    expect(planBotTurn(ctx, undefined, { level: 'hard' }).play).toBe(true);
  });

  it('Fácil nunca reorganiza ni libera comodines', () => {
    const ctx = {
      start: { rack: [R(5), B(8), O(8)], table: [{ id: 'a', tiles: [R(4), 104, R(6)] }] },
      opened: true,
    };
    // Con azar fijo que no "se despista", Fácil no toca el comodín (Normal sí, ver bot.test)
    const plan = planBotTurn(ctx, undefined, { level: 'easy', rand: () => 0.99 });
    expect(plan.moves.some((m) => m.tileId === 104)).toBe(false);
  });
});
