/**
 * Gestión de salas independiente de la red (testeable). El servidor es la única autoridad:
 * guarda el estado completo de la partida y solo publica vistas filtradas.
 */
import { randomUUID } from 'node:crypto';
import {
  ALLOWED_TURN_SECONDS,
  applyIntent,
  checkTimeout,
  createGame,
  currentTable,
  DEFAULT_TURN_SECONDS,
  EMOTES,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_REGEX,
  sanitizeIntent,
  viewFor,
  type DragPayload,
  type GameErrorCode,
  type GameState,
  type PlayerView,
  type RoomErrorCode,
  type RoomSettings,
  type Seat,
  type ViewMeta,
} from '@rummi/shared';

export interface SeatInfo {
  token: string;
  name: string;
  avatar: string;
  socketId: string | null;
  wins: number;
}

export interface Room {
  code: string;
  settings: RoomSettings;
  seats: [SeatInfo | null, SeatInfo | null];
  game: GameState | null;
  rematch: [boolean, boolean];
  lastActivity: number;
  createdAt: number;
  gamesPlayed: number;
  /** El resultado de la partida actual ya se contó en el marcador. */
  counted: boolean;
}

export type JoinResult =
  | { ok: true; room: Room; seat: Seat; token: string; reconnected: boolean }
  | { ok: false; error: RoomErrorCode };

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // eliminar caracteres de control y espacios repetidos
  const clean = s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, MAX_NAME_LENGTH).join('') || 'Jugador';
}

export function sanitizeAvatar(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length > 0 && s.length <= 8 && !/[<>]/.test(s) ? s : '🙂';
}

export function sanitizeSettings(raw: unknown): RoomSettings {
  const r = (raw ?? {}) as Partial<RoomSettings>;
  const ts = Number(r.turnSeconds);
  return { turnSeconds: (ALLOWED_TURN_SECONDS as readonly number[]).includes(ts) ? ts : DEFAULT_TURN_SECONDS };
}

export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  return [...s].slice(0, MAX_CHAT_LENGTH).join('');
}

export function isEmote(raw: unknown): raw is string {
  return typeof raw === 'string' && (EMOTES as readonly string[]).includes(raw);
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private now: () => number = Date.now, private rand: () => number = Math.random) {}

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += ROOM_CODE_ALPHABET[Math.floor(this.rand() * ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('No hay códigos libres');
  }

  create(profile: { name: unknown; avatar: unknown }, settings: unknown, socketId: string): { room: Room; seat: Seat; token: string } {
    const code = this.newCode();
    const token = randomUUID();
    const room: Room = {
      code,
      settings: sanitizeSettings(settings),
      seats: [{ token, name: sanitizeName(profile.name), avatar: sanitizeAvatar(profile.avatar), socketId, wins: 0 }, null],
      game: null,
      rematch: [false, false],
      lastActivity: this.now(),
      createdAt: this.now(),
      gamesPlayed: 0,
      counted: false,
    };
    this.rooms.set(code, room);
    return { room, seat: 0, token };
  }

  join(rawCode: unknown, profile: { name: unknown; avatar: unknown }, token: unknown, socketId: string): JoinResult {
    const code = typeof rawCode === 'string' ? rawCode.toUpperCase().trim() : '';
    if (!ROOM_CODE_REGEX.test(code)) return { ok: false, error: 'ROOM_NOT_FOUND' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    room.lastActivity = this.now();
    // Reconexión con token
    if (typeof token === 'string' && token) {
      const idx = room.seats.findIndex((s) => s?.token === token);
      if (idx >= 0) {
        const s = room.seats[idx]!;
        s.socketId = socketId;
        if (profile.name !== undefined) s.name = sanitizeName(profile.name);
        if (profile.avatar !== undefined) s.avatar = sanitizeAvatar(profile.avatar);
        return { ok: true, room, seat: idx as Seat, token, reconnected: true };
      }
    }
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: 'ROOM_FULL' };
    const newToken = randomUUID();
    room.seats[free] = { token: newToken, name: sanitizeName(profile.name), avatar: sanitizeAvatar(profile.avatar), socketId, wins: 0 };
    if (!room.game && room.seats[0] && room.seats[1]) this.startGame(room);
    return { ok: true, room, seat: free as Seat, token: newToken, reconnected: false };
  }

  startGame(room: Room) {
    // Alterna quién empieza en cada partida (la primera se sortea)
    const first: Seat = room.gamesPlayed === 0 ? (this.rand() < 0.5 ? 0 : 1) : ((room.gamesPlayed % 2) as Seat);
    room.game = createGame({ turnSeconds: room.settings.turnSeconds, firstPlayer: first, now: this.now() });
    room.rematch = [false, false];
    room.counted = false;
    room.gamesPlayed++;
  }

  /** Marca el socket como desconectado. Devuelve la sala afectada. */
  disconnect(code: string, seat: Seat, socketId: string): Room | null {
    const room = this.rooms.get(code);
    const s = room?.seats[seat];
    if (!room || !s || s.socketId !== socketId) return null;
    s.socketId = null;
    room.lastActivity = this.now();
    return room;
  }

  /** Salida voluntaria. En la sala de espera, si sale el creador se cierra la sala. */
  leave(code: string, seat: Seat, socketId: string): { room: Room; closed: boolean } | null {
    const room = this.disconnect(code, seat, socketId);
    if (!room) return null;
    if (!room.game) {
      this.rooms.delete(code);
      return { room, closed: true };
    }
    if (room.seats.every((s) => !s?.socketId)) {
      this.rooms.delete(code);
      return { room, closed: true };
    }
    return { room, closed: false };
  }

  intent(room: Room, seat: Seat, raw: unknown): { ok: true } | { ok: false; error: GameErrorCode | RoomErrorCode } {
    if (!room.game) return { ok: false, error: 'NOT_IN_ROOM' };
    const intent = sanitizeIntent(raw);
    if (!intent) return { ok: false, error: 'BAD_INTENT' };
    room.lastActivity = this.now();
    const r = applyIntent(room.game, seat, intent, this.now());
    if (r.ok) this.countResult(room);
    return r;
  }

  /** Aplica el timeout si corresponde. */
  tick(room: Room): boolean {
    if (!room.game) return false;
    const changed = checkTimeout(room.game, this.now());
    if (changed) this.countResult(room);
    return changed;
  }

  private countResult(room: Room) {
    const g = room.game;
    if (!g || g.status !== 'ended' || room.counted) return;
    room.counted = true;
    const w = g.result?.winner;
    if (w !== null && w !== undefined) room.seats[w]!.wins++;
  }

  rematch(room: Room, seat: Seat): boolean {
    if (!room.game || room.game.status !== 'ended') return false;
    room.rematch[seat] = true;
    room.lastActivity = this.now();
    if (room.rematch[0] && room.rematch[1]) {
      this.startGame(room);
      return true;
    }
    return true;
  }

  /** Filtra el arrastre: solo se revela el id si la ficha ya está en la mesa. */
  filterDrag(room: Room, raw: unknown): DragPayload | null {
    if (!raw || typeof raw !== 'object' || !room.game) return null;
    const d = raw as Partial<DragPayload>;
    const x = Number(d.x), z = Number(d.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let tileId: number | null = null;
    if (typeof d.tileId === 'number' && currentTable(room.game).some((m) => m.tiles.includes(d.tileId as number))) tileId = d.tileId;
    return { tileId, x: Math.max(-40, Math.min(40, x)), z: Math.max(-40, Math.min(40, z)), active: d.active === true };
  }

  view(room: Room, seat: Seat): PlayerView {
    const players = [0, 1].map((i) => {
      const s = room.seats[i];
      return {
        name: s?.name ?? '',
        avatar: s?.avatar ?? '',
        connected: !!s?.socketId,
        isBot: false,
        wins: s?.wins ?? 0,
      };
    }) as ViewMeta['players'];
    if (!room.game) {
      return {
        roomCode: room.code,
        you: seat,
        players: players.map((p) => ({ ...p, rackCount: 0, opened: false })) as PlayerView['players'],
        rack: [],
        table: [],
        poolCount: 0,
        turn: 0,
        turnDeadline: null,
        serverNow: this.now(),
        turnSeconds: room.settings.turnSeconds,
        status: 'waiting',
        canUndo: false,
        playedThisTurn: [],
        turnStartTable: [],
        lastEvent: null,
        result: null,
        rematch: [false, false],
        version: 0,
        nextMeldSeq: 1,
      };
    }
    return viewFor(room.game, seat, { roomCode: room.code, players, rematch: [...room.rematch], now: this.now() });
  }

  /** Elimina salas inactivas. Devuelve los códigos eliminados. */
  sweep(maxIdleMs = 30 * 60_000, maxWaitingMs = 2 * 60 * 60_000): string[] {
    const now = this.now();
    const out: string[] = [];
    for (const [code, room] of this.rooms) {
      const anyone = room.seats.some((s) => s?.socketId);
      const idle = now - room.lastActivity;
      if ((!anyone && idle > maxIdleMs) || (!room.game && now - room.createdAt > maxWaitingMs) || idle > 6 * 60 * 60_000) {
        this.rooms.delete(code);
        out.push(code);
      }
    }
    return out;
  }
}
