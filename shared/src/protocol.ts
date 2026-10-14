import type { Meld } from './melds.js';
import type { TileId } from './tiles.js';

/** Destino de un movimiento de ficha. */
export type MoveTarget =
  | { kind: 'rack' }
  | { kind: 'new' }
  | { kind: 'meld'; meldId: string; index: number };

/** Intenciones que el cliente envía al servidor durante su turno. */
export type Intent =
  | { type: 'move'; tileId: TileId; to: MoveTarget }
  /** Mover una combinación entera: a otra (unirlas), a un espacio libre o de vuelta al atril. */
  | { type: 'moveMeld'; meldId: string; to: MoveTarget }
  /** Mover varias fichas del atril juntas (selección múltiple). */
  | { type: 'moveTiles'; tileIds: TileId[]; to: MoveTarget }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'draw' }
  | { type: 'endTurn' };

export type GameErrorCode =
  | 'NOT_YOUR_TURN'
  | 'GAME_OVER'
  | 'BAD_INTENT'
  | 'TILE_NOT_AVAILABLE'
  | 'NOT_OPENED'
  | 'CANT_TAKE_FROM_TABLE'
  | 'MELD_NOT_FOUND'
  | 'NOTHING_TO_UNDO'
  | 'INVALID_MELDS'
  | 'OPENING_TOO_LOW'
  | 'OPENING_TABLE_TOUCHED'
  | 'TILES_MISSING';

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'BAD_REQUEST'
  | 'NOT_IN_ROOM'
  | 'RATE_LIMITED'
  | 'GAME_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS';

export interface PublicPlayer {
  name: string;
  avatar: string;
  connected: boolean;
  rackCount: number;
  opened: boolean;
  isBot: boolean;
  /** Abandonó la partida y el bot juega por él. */
  replaced?: boolean;
  wins: number;
}

export type GameStatus = 'waiting' | 'playing' | 'ended';

export interface GameResult {
  /** Asientos ganadores (más de uno si empatan con el pozo agotado). */
  winners: number[];
  reason: 'out' | 'pool';
  /** Puntos que quedaron en cada atril (por asiento). */
  points: number[];
}

export type GameEvent =
  | { type: 'start'; seq: number }
  | { type: 'draw'; player: number; seq: number; timeout?: boolean }
  | { type: 'play'; player: number; seq: number; tiles: TileId[] }
  | { type: 'end'; seq: number };

/**
 * Vista filtrada que cada jugador recibe. Nunca contiene el atril del rival ni el pozo.
 * Durante el turno de cualquiera, `table` es la mesa "en edición" (pública).
 */
export interface PlayerView {
  roomCode: string;
  /** Mi asiento (0..n-1). */
  you: number;
  /** Jugadores por asiento, en orden de turno (2 a 4). */
  players: PublicPlayer[];
  /** Asiento del anfitrión (quien puede empezar la partida). */
  host: number;
  rack: TileId[];
  table: Meld[];
  poolCount: number;
  turn: number;
  /** Epoch ms del servidor en que vence el turno (null = sin límite). */
  turnDeadline: number | null;
  serverNow: number;
  turnSeconds: number;
  status: GameStatus;
  canUndo: boolean;
  /** Fichas jugadas desde el atril en el turno actual (públicas porque están en la mesa). */
  playedThisTurn: TileId[];
  /** Ids de fichas que estaban en la mesa al empezar el turno. */
  turnStartTable: TileId[];
  lastEvent: GameEvent | null;
  result: GameResult | null;
  rematch: boolean[];
  /** Modo de la sala (1 = partida única, 3 = mejor de 3). */
  bestOf: number;
  /** Torneo en curso (null en partida única). */
  match: MatchInfo | null;
  version: number;
  /** Siguiente id de combinación (para predicción determinista en el cliente). */
  nextMeldSeq: number;
}

export interface RoomSettings {
  /** 0 = sin límite */
  turnSeconds: number;
  /** 1 = partida única, 3 = torneo al mejor de 3. */
  bestOf: number;
}

/** Torneo al mejor de N: gana quien primero llega a ceil(N/2) partidas. */
export interface MatchInfo {
  bestOf: number;
  /** Partida actual (1, 2, 3…). */
  game: number;
  /** Partidas ganadas por asiento. */
  wins: number[];
  /** Asientos campeones cuando el torneo terminó (null = sigue). */
  champions: number[] | null;
}

export const ALLOWED_BEST_OF = [1, 3] as const;

/** Partidas que hay que ganar para llevarse el torneo. */
export function winsNeeded(bestOf: number): number {
  return Math.ceil(bestOf / 2);
}

export interface ProfilePayload {
  name: string;
  avatar: string;
}

export interface CreateRoomPayload extends ProfilePayload {
  settings: Partial<RoomSettings>;
}

export interface JoinRoomPayload extends ProfilePayload {
  code: string;
  token?: string;
}

export type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error: GameErrorCode | RoomErrorCode };

export interface RoomJoined {
  code: string;
  token: string;
  seat: number;
}

export interface DragPayload {
  /** Solo se reenvía si la ficha es pública (está en la mesa). */
  tileId: TileId | null;
  /** Coordenadas en el plano de la mesa (mundo). */
  x: number;
  z: number;
  active: boolean;
}

export interface ChatMessage {
  from: number;
  text: string;
  at: number;
}

export const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '👏', '🤔', '😎', '😭', '🥳', '😱', '🙏', '💪', '🤯', '😴', '❤️'] as const;

/** Frases rápidas: viajan como `phrase:<id>` y cada cliente las muestra traducidas a su idioma. */
export const PHRASES = ['gg', 'hurry', 'close', 'beat', 'luck', 'lol', 'rematch', 'phew'] as const;
export type PhraseId = (typeof PHRASES)[number];

/** ¿Es una reacción válida (emoji de la lista o frase rápida)? */
export function isReaction(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if ((EMOTES as readonly string[]).includes(raw)) return true;
  return raw.startsWith('phrase:') && (PHRASES as readonly string[]).includes(raw.slice(7));
}

export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: (r: Ack<RoomJoined>) => void) => void;
  'room:join': (p: JoinRoomPayload, ack: (r: Ack<RoomJoined>) => void) => void;
  'room:leave': () => void;
  'game:intent': (i: Intent, ack: (r: Ack) => void) => void;
  'game:rematch': () => void;
  'room:start': (ack: (r: Ack) => void) => void;
  /** El anfitrión cambia el modo en la sala de espera. */
  'room:config': (cfg: { bestOf: number }, ack: (r: Ack) => void) => void;
  drag: (d: DragPayload) => void;
  emote: (e: string) => void;
  chat: (text: string) => void;
}

export interface ServerToClientEvents {
  state: (v: PlayerView) => void;
  drag: (d: DragPayload) => void;
  emote: (e: { from: number; emoji: string }) => void;
  chat: (m: ChatMessage) => void;
  'room:closed': () => void;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_REGEX = /^[A-Z]{4}$/;
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 140;
export const DEFAULT_TURN_SECONDS = 60;
export const ALLOWED_TURN_SECONDS = [0, 30, 60, 90, 120, 180] as const;
