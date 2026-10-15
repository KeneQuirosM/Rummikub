/**
 * Historial y estadísticas. Siempre se guardan en el teléfono (localStorage); con cuenta,
 * además se leen desde la nube (ver account.ts) y `currentStats()` devuelve esas.
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

export interface StatsData {
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
    if (raw) return normalizeStats(JSON.parse(raw));
  } catch {
    /* datos corruptos o almacenamiento no disponible */
  }
  return emptyStats();
}

function saveStats(d: StatsData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* modo privado */
  }
}

/** Fuente alternativa (la cuenta en la nube). Si devuelve null se usan las del teléfono. */
let remoteSource: (() => StatsData | null) | null = null;
const recordListeners = new Set<(r: GameRecord) => void>();

export function setRemoteStatsSource(f: (() => StatsData | null) | null): void {
  remoteSource = f;
}

/** Avisa de cada partida registrada (la cuenta la sube a la nube). */
export function onRecord(f: (r: GameRecord) => void): () => void {
  recordListeners.add(f);
  return () => recordListeners.delete(f);
}

/** Estadísticas a mostrar: las de la cuenta si hay, si no las del teléfono. */
export function currentStats(): StatsData {
  return remoteSource?.() ?? loadStats();
}

export function emptyStats(): StatsData {
  return { v: 1, records: [], totals: { online: emptyTotals(), bot: emptyTotals() } };
}

/** Normaliza datos de origen desconocido (localStorage o la nube). */
export function normalizeStats(d: unknown): StatsData {
  const x = d as Partial<StatsData> | null;
  if (x?.v !== 1 || !Array.isArray(x.records)) return emptyStats();
  return { v: 1, records: x.records.slice(0, MAX_RECORDS), totals: { online: { ...emptyTotals(), ...x.totals?.online }, bot: { ...emptyTotals(), ...x.totals?.bot } } };
}

/** Suma una partida a unas estadísticas (sin guardar). */
export function applyRecord(d: StatsData, r: GameRecord): void {
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
}

export function addRecord(r: GameRecord): void {
  const d = loadStats();
  applyRecord(d, r);
  saveStats(d);
  recordListeners.forEach((f) => f(r));
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
