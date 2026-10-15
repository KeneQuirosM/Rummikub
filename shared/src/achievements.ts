/**
 * Logros. Se calculan a partir de las partidas registradas (en el teléfono o en la cuenta),
 * así que son deterministas: recalcular desde el historial da siempre el mismo resultado.
 */

export type AchievementId =
  | 'first_win'
  | 'online_win'
  | 'streak_3'
  | 'streak_5'
  | 'big_play_10'
  | 'no_draw_win'
  | 'fast_win'
  | 'full_table_win'
  | 'champion'
  | 'hard_bot'
  | 'games_25'
  | 'games_100'
  | 'wins_10'
  | 'wins_50'
  | 'online_wins_10';

export interface AchievementDef {
  id: AchievementId;
  icon: string;
}

/** En el orden en que se muestran (de más fácil a más difícil). */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_win', icon: '🏆' },
  { id: 'online_win', icon: '🌐' },
  { id: 'streak_3', icon: '🔥' },
  { id: 'fast_win', icon: '⚡' },
  { id: 'big_play_10', icon: '💥' },
  { id: 'no_draw_win', icon: '🎯' },
  { id: 'full_table_win', icon: '🎉' },
  { id: 'hard_bot', icon: '🤖' },
  { id: 'games_25', icon: '🎲' },
  { id: 'wins_10', icon: '🏅' },
  { id: 'streak_5', icon: '☄️' },
  { id: 'champion', icon: '🥇' },
  { id: 'online_wins_10', icon: '🌍' },
  { id: 'games_100', icon: '💯' },
  { id: 'wins_50', icon: '🌟' },
];

/** Datos de una partida que importan para los logros. */
export interface AchievementGame {
  mode: 'online' | 'bot';
  level?: 'easy' | 'normal' | 'hard';
  won: boolean;
  players: number;
  durationSec: number;
  bestPlay: number;
  /** Fichas robadas en la partida (undefined = desconocido, partidas antiguas). */
  draws?: number;
  champion?: boolean;
}

/** Acumulados DESPUÉS de sumar la partida. */
export interface AchievementTotals {
  played: number;
  won: number;
  onlineWon: number;
  /** Racha actual de victorias (del modo de la partida). */
  streak: number;
}

/** Victoria relámpago: menos de 5 minutos. */
export const FAST_WIN_SEC = 300;

/** Logros que cumple esta partida (con los acumulados ya actualizados). */
export function achievementsForGame(g: AchievementGame, t: AchievementTotals): AchievementId[] {
  const out: AchievementId[] = [];
  const add = (cond: boolean, id: AchievementId) => cond && out.push(id);
  add(g.won, 'first_win');
  add(g.won && g.mode === 'online', 'online_win');
  add(t.streak >= 3, 'streak_3');
  add(t.streak >= 5, 'streak_5');
  add(g.bestPlay >= 10, 'big_play_10');
  add(g.won && g.draws === 0, 'no_draw_win');
  add(g.won && g.durationSec > 0 && g.durationSec < FAST_WIN_SEC, 'fast_win');
  add(g.won && g.players >= 4, 'full_table_win');
  add(!!g.champion, 'champion');
  add(g.won && g.mode === 'bot' && g.level === 'hard', 'hard_bot');
  add(t.played >= 25, 'games_25');
  add(t.played >= 100, 'games_100');
  add(t.won >= 10, 'wins_10');
  add(t.won >= 50, 'wins_50');
  add(t.onlineWon >= 10, 'online_wins_10');
  return out;
}

/** Totales guardados antes de existir los logros: lo que se puede deducir de ellos. */
export function achievementsFromTotals(t: {
  played: number;
  won: number;
  onlineWon: number;
  bestStreak: number;
  bestPlay: number;
  fastestWin: number;
  tourneys: number;
}): AchievementId[] {
  const out: AchievementId[] = [];
  const add = (cond: boolean, id: AchievementId) => cond && out.push(id);
  add(t.won > 0, 'first_win');
  add(t.onlineWon > 0, 'online_win');
  add(t.bestStreak >= 3, 'streak_3');
  add(t.bestStreak >= 5, 'streak_5');
  add(t.bestPlay >= 10, 'big_play_10');
  add(t.fastestWin > 0 && t.fastestWin < FAST_WIN_SEC, 'fast_win');
  add(t.tourneys > 0, 'champion');
  add(t.played >= 25, 'games_25');
  add(t.played >= 100, 'games_100');
  add(t.won >= 10, 'wins_10');
  add(t.won >= 50, 'wins_50');
  add(t.onlineWon >= 10, 'online_wins_10');
  return out;
}
