/**
 * Historial y estadísticas guardados en el teléfono (localStorage). Sin cuentas ni servidor.
 */
import type { PlayerView } from '@rummi/shared';

export type GameMode = 'online' | 'bot';
export type BotLevelName = 'easy' | 'normal' | 'hard';

export interface GameRecord {
  at: number;
  mode: GameMode;
  level?: BotLevelName;
  /** Mi posición (1 = ganador; empatados comparten posición). */
  place: number;
  players: number;
  won: boolean;
  myPoints: number;
  /** Rivales (avatar + nombre) para el historial. */
  rivals: { name: string; avatar: string }[];
  durationSec: number;
  /** Más fichas que coloqué en un solo turno. */
  bestPlay: number;
  /** Esta partida cerró un torneo que gané. */
  champion?: boolean;
}

export interface ModeTotals {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  bestPlay: number;
  /** Victoria más rápida en segundos (0 = ninguna). */
  fastestWin: number;
  /** Torneos (mejor de 3) ganados. */
  tourneys: number;
}

interface StatsData {
  v: 1;
  records: GameRecord[];
  totals: Record<GameMode, ModeTotals>;
}

const KEY = 'rummi.stats.v1';
const MAX_RECORDS = 20;

const emptyTotals = (): ModeTotals => ({ played: 0, won: 0, streak: 0, bestStreak: 0, bestPlay: 0, fastestWin: 0, tourneys: 0 });

export function loadStats(): StatsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as StatsData;
      if (d?.v === 1 && Array.isArray(d.records)) return { ...d, totals: { online: { ...emptyTotals(), ...d.totals?.online }, bot: { ...emptyTotals(), ...d.totals?.bot } } };
    }
  } catch {
    /* datos corruptos o almacenamiento no disponible */
  }
  return { v: 1, records: [], totals: { online: emptyTotals(), bot: emptyTotals() } };
}

function saveStats(d: StatsData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* modo privado */
  }
}

export function addRecord(r: GameRecord): void {
  const d = loadStats();
  d.records.unshift(r);
  d.records = d.records.slice(0, MAX_RECORDS);
  const t = d.totals[r.mode];
  t.played++;
  if (r.won) {
    t.won++;
    t.streak++;
    t.bestStreak = Math.max(t.bestStreak, t.streak);
    if (r.durationSec > 0 && (t.fastestWin === 0 || r.durationSec < t.fastestWin)) t.fastestWin = r.durationSec;
  } else t.streak = 0;
  t.bestPlay = Math.max(t.bestPlay, r.bestPlay);
  if (r.champion) t.tourneys++;
  saveStats(d);
}

/** Suma de dos totales (para la vista "Todas"). La racha actual es la de la última partida jugada. */
export function combinedTotals(d: StatsData): ModeTotals {
  const a = d.totals.online, b = d.totals.bot;
  const last = d.records[0]?.mode;
  return {
    played: a.played + b.played,
    won: a.won + b.won,
    streak: last ? d.totals[last].streak : 0,
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    bestPlay: Math.max(a.bestPlay, b.bestPlay),
    fastestWin: [a.fastestWin, b.fastestWin].filter((x) => x > 0).reduce((m, x) => (m === 0 ? x : Math.min(m, x)), 0),
    tourneys: a.tourneys + b.tourneys,
  };
}

export function clearStats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/**
 * Sigue una partida y la registra una sola vez al terminar.
 * Cuenta la duración desde el reparto y la mejor jugada propia (más fichas en un turno).
 */
export class GameStatsTracker {
  private startedAt = Date.now();
  private bestPlay = 0;
  private recorded = false;

  constructor(private mode: GameMode, private level?: BotLevelName) {}

  onStart() {
    this.startedAt = Date.now();
    this.bestPlay = 0;
    this.recorded = false;
  }

  onPlay(player: number, tiles: number, me: number) {
    if (player === me) this.bestPlay = Math.max(this.bestPlay, tiles);
  }

  onView(v: PlayerView) {
    if (v.status !== 'ended' || !v.result || this.recorded) return;
    this.recorded = true;
    const r = v.result;
    const myPts = r.points[v.you] ?? 0;
    const won = r.winners.includes(v.you);
    // Posición: 1 + cuántos tienen estrictamente menos puntos (los ganadores por "out" tienen 0)
    const place = won ? 1 : 1 + r.points.filter((p, i) => i !== v.you && (p < myPts || r.winners.includes(i))).length;
    addRecord({
      at: Date.now(),
      mode: this.mode,
      ...(this.mode === 'bot' && this.level ? { level: this.level } : {}),
      place,
      players: v.players.length,
      won,
      myPoints: myPts,
      rivals: v.players.filter((_, i) => i !== v.you).map((p) => ({ name: p.name, avatar: p.avatar })),
      durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      bestPlay: this.bestPlay,
      ...(v.match?.champions?.includes(v.you) ? { champion: true } : {}),
    });
  }
}
