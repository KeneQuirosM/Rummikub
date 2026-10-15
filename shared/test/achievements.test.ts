import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementsForGame, achievementsFromTotals } from '../src/achievements.js';

const base = { mode: 'bot' as const, won: false, players: 2, durationSec: 600, bestPlay: 3 };
const tot = { played: 1, won: 0, onlineWon: 0, streak: 0 };

describe('logros', () => {
  it('ids únicos', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('una derrota normal no da nada', () => {
    expect(achievementsForGame(base, tot)).toEqual([]);
  });

  it('victoria online rápida, sin robar, en mesa de 4', () => {
    const got = achievementsForGame(
      { ...base, mode: 'online', won: true, players: 4, durationSec: 240, draws: 0, bestPlay: 11 },
      { played: 1, won: 1, onlineWon: 1, streak: 1 },
    );
    expect(got.sort()).toEqual(['big_play_10', 'fast_win', 'first_win', 'full_table_win', 'no_draw_win', 'online_win'].sort());
  });

  it('robos desconocidos (partidas antiguas) no dan "sin robar"; bot difícil y rachas', () => {
    const got = achievementsForGame({ ...base, won: true, level: 'hard' }, { played: 30, won: 12, onlineWon: 0, streak: 5 });
    expect(got).toContain('hard_bot');
    expect(got).toContain('streak_5');
    expect(got).toContain('games_25');
    expect(got).toContain('wins_10');
    expect(got).not.toContain('no_draw_win');
    expect(got).not.toContain('online_win');
  });

  it('se deducen de estadísticas antiguas', () => {
    expect(achievementsFromTotals({ played: 26, won: 11, onlineWon: 1, bestStreak: 3, bestPlay: 10, fastestWin: 200, tourneys: 1 }).sort()).toEqual(
      ['big_play_10', 'champion', 'fast_win', 'first_win', 'games_25', 'online_win', 'streak_3', 'wins_10'].sort(),
    );
  });
});
