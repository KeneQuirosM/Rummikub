/**
 * Gestión de salas independiente de la red (testeable). El servidor es la única autoridad:
 * guarda el estado completo de la partida y solo publica vistas filtradas.
 */
import { randomUUID } from 'node:crypto';
import {
  ALLOWED_TURN_SECONDS,
  applyIntent,
  botMoveToIntent,
  checkTimeout,
  createGame,
  currentTable,
  DEFAULT_TURN_SECONDS,
  isReaction,
  ALLOWED_BEST_OF,
  winsNeeded,
  type MatchInfo,
  forceDraw,
  forceFinish,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  planBotTurn,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_REGEX,
  sanitizeIntent,
  turnContext,
  viewFor,
  type BotMove,
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
  /** Abandonó a mitad de partida: el bot juega por él. */
  replaced: boolean;
  /** Momento en que se desconectó (null si está conectado). */
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  settings: RoomSettings;
  /** Asientos en orden de turno. Durante la partida, el índice coincide con el asiento del juego. */
  seats: SeatInfo[];
  /** Índice del anfitrión en `seats`. */
  host: number;
  game: GameState | null;
  rematch: boolean[];
  lastActivity: number;
  createdAt: number;
  gamesPlayed: number;
  /** El resultado de la partida actual ya se contó en el marcador. */
  counted: boolean;
  /** Plan del bot sustituto para el turno en curso. */
  botPlan: { key: string; moves: BotMove[]; play: boolean } | null;
  /** Torneo en curso: victorias por token de asiento (sobrevive a reordenamientos). */
  match: { bestOf: number; game: number; winsByToken: Record<string, number>; champions: string[] | null } | null;
}

export type JoinResult =
  | { ok: true; room: Room; seat: Seat; token: string; reconnected: boolean }
  | { ok: false; error: RoomErrorCode };

/** Si un jugador se desconecta en plena partida y no vuelve en este tiempo, el bot juega por él. */
export const TAKEOVER_MS = 30_000;

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
  const bo = Number(r.bestOf);
  return {
    turnSeconds: (ALLOWED_TURN_SECONDS as readonly number[]).includes(ts) ? ts : DEFAULT_TURN_SECONDS,
    bestOf: (ALLOWED_BEST_OF as readonly number[]).includes(bo) ? bo : 1,
  };
}

export function sanitizeChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  return [...s].slice(0, MAX_CHAT_LENGTH).join('');
}

export function isEmote(raw: unknown): raw is string {
  return isReaction(raw);
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

  private newSeat(profile: { name: unknown; avatar: unknown }, socketId: string): SeatInfo {
    return {
      token: randomUUID(),
      name: sanitizeName(profile.name),
      avatar: sanitizeAvatar(profile.avatar),
      socketId,
      wins: 0,
      replaced: false,
      disconnectedAt: null,
    };
  }

  seatByToken(room: Room, token: string | undefined): number {
    return token ? room.seats.findIndex((s) => s.token === token) : -1;
  }

  create(profile: { name: unknown; avatar: unknown }, settings: unknown, socketId: string): { room: Room; seat: Seat; token: string } {
    const code = this.newCode();
    const seat = this.newSeat(profile, socketId);
    const room: Room = {
      code,
      settings: sanitizeSettings(settings),
      seats: [seat],
      host: 0,
      game: null,
      rematch: [],
      lastActivity: this.now(),
      createdAt: this.now(),
      gamesPlayed: 0,
      counted: false,
      botPlan: null,
      match: null,
    };
    this.rooms.set(code, room);
    return { room, seat: 0, token: seat.token };
  }

  join(rawCode: unknown, profile: { name: unknown; avatar: unknown }, token: unknown, socketId: string): JoinResult {
    const code = typeof rawCode === 'string' ? rawCode.toUpperCase().trim() : '';
    if (!ROOM_CODE_REGEX.test(code)) return { ok: false, error: 'ROOM_NOT_FOUND' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    room.lastActivity = this.now();
    // Reconexión con token (aunque haya abandonado: recupera su asiento)
    const idx = this.seatByToken(room, typeof token === 'string' ? token : undefined);
    if (idx >= 0) {
      const s = room.seats[idx]!;
      s.socketId = socketId;
      s.disconnectedAt = null;
      s.replaced = false;
      if (profile.name !== undefined) s.name = sanitizeName(profile.name);
      if (profile.avatar !== undefined) s.avatar = sanitizeAvatar(profile.avatar);
      return { ok: true, room, seat: idx, token: s.token, reconnected: true };
    }
    if (room.game) return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: 'ROOM_FULL' };
    const seat = this.newSeat(profile, socketId);
    room.seats.push(seat);
    // Mesa completa: empieza sola
    if (room.seats.length === MAX_PLAYERS) this.startGame(room);
    return { ok: true, room, seat: room.seats.length - 1, token: seat.token, reconnected: false };
  }

  /** El anfitrión (o cualquiera si el anfitrión no está) empieza la partida con 2 a 4 jugadores. */
  start(room: Room, seat: Seat): { ok: true } | { ok: false; error: RoomErrorCode } {
    // Idempotente: si la partida ya empezó (doble toque, o un cliente que se quedó en la sala de espera),
    // responder ok para que el cliente entre a la partida en curso en vez de quedarse atascado.
    if (room.game) return { ok: true };
    const hostAway = !room.seats[room.host]?.socketId;
    if (seat !== room.host && !hostAway) return { ok: false, error: 'NOT_HOST' };
    if (room.seats.length < MIN_PLAYERS) return { ok: false, error: 'NOT_ENOUGH_PLAYERS' };
    this.startGame(room);
    return { ok: true };
  }

  /** El anfitrión elige el modo (partida única / mejor de 3) en la sala de espera. */
  configure(room: Room, seat: Seat, raw: unknown): { ok: true } | { ok: false; error: RoomErrorCode } {
    if (room.game) return { ok: false, error: 'GAME_IN_PROGRESS' };
    const hostAway = !room.seats[room.host]?.socketId;
    if (seat !== room.host && !hostAway) return { ok: false, error: 'NOT_HOST' };
    const bo = Number((raw as { bestOf?: unknown } | null)?.bestOf);
    if (!(ALLOWED_BEST_OF as readonly number[]).includes(bo)) return { ok: false, error: 'BAD_REQUEST' };
    room.settings.bestOf = bo;
    return { ok: true };
  }

  startGame(room: Room) {
    const n = room.seats.length;
    // Torneo: se crea al empezar (o al empezar una revancha cuando el anterior ya tiene campeón)
    if (room.settings.bestOf > 1) {
      if (!room.match || room.match.champions) room.match = { bestOf: room.settings.bestOf, game: 1, winsByToken: {}, champions: null };
      else room.match.game++;
    } else room.match = null;
    // Alterna quién empieza en cada partida (la primera se sortea)
    const first: Seat = room.gamesPlayed === 0 ? Math.floor(this.rand() * n) : room.gamesPlayed % n;
    room.game = createGame({ players: n, turnSeconds: room.settings.turnSeconds, firstPlayer: first, now: this.now() });
    room.rematch = new Array<boolean>(n).fill(false);
    room.counted = false;
    room.botPlan = null;
    room.gamesPlayed++;
  }

  /** Humanos que siguen en la partida (no reemplazados por el bot). */
  humans(room: Room): number {
    return room.seats.filter((s) => !s.replaced).length;
  }

  /** Marca el socket como desconectado. Devuelve la sala afectada. */
  disconnect(code: string, seat: Seat, socketId: string): Room | null {
    const room = this.rooms.get(code);
    const s = room?.seats[seat];
    if (!room || !s || s.socketId !== socketId) return null;
    s.socketId = null;
    s.disconnectedAt = this.now();
    room.lastActivity = this.now();
    return room;
  }

  /**
   * Salida voluntaria.
   *  - En la sala de espera: se libera el asiento (y el anfitrión pasa al siguiente).
   *  - En partida: el bot toma su lugar. Si queda un solo humano, la partida termina.
   */
  leave(code: string, seat: Seat, socketId: string): { room: Room; closed: boolean } | null {
    const room = this.rooms.get(code);
    const s = room?.seats[seat];
    if (!room || !s || s.socketId !== socketId) return null;
    room.lastActivity = this.now();
    if (!room.game) {
      room.seats.splice(seat, 1);
      if (room.host > seat) room.host--;
      if (room.host >= room.seats.length) room.host = 0;
      if (room.seats.length === 0) {
        this.rooms.delete(code);
        return { room, closed: true };
      }
      return { room, closed: false };
    }
    s.socketId = null;
    s.disconnectedAt = this.now();
    // El bot juega por él (también si queda un solo humano: puede terminar la partida contra el bot)
    s.replaced = true;
    if (room.game.status === 'ended') this.checkRematch(room);
    if (room.seats.every((x) => !x.socketId)) {
      this.rooms.delete(code);
      return { room, closed: true };
    }
    if (seat === room.host) room.host = Math.max(0, room.seats.findIndex((x) => x.socketId && !x.replaced));
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

  /** Timeout del turno o jugador ausente demasiado tiempo. Devuelve true si cambió algo. */
  tick(room: Room): boolean {
    const g = room.game;
    if (!g || g.status !== 'playing') return false;
    const tookOver = this.takeoverAbsent(room);
    const changed = checkTimeout(g, this.now());
    if (changed) this.countResult(room);
    return changed || tookOver;
  }

  /**
   * Quien lleva más de TAKEOVER_MS desconectado en plena partida pasa a ser jugado por el bot
   * (si vuelve con su token, recupera el asiento). Devuelve true si cambió algo.
   */
  takeoverAbsent(room: Room): boolean {
    const g = room.game;
    if (!g || g.status !== 'playing') return false;
    let changed = false;
    for (const s of room.seats) {
      if (!s.replaced && !s.socketId && s.disconnectedAt !== null && this.now() - s.disconnectedAt >= TAKEOVER_MS) {
        s.replaced = true;
        changed = true;
      }
    }
    return changed;
  }

  /** Próximo momento en que hay que revisar la sala (fin de turno o relevo de un ausente). */
  nextCheckAt(room: Room): number | null {
    const g = room.game;
    if (!g || g.status !== 'playing') return null;
    const times: number[] = [];
    if (g.turnDeadline !== null) times.push(g.turnDeadline);
    for (const s of room.seats) if (!s.replaced && !s.socketId && s.disconnectedAt !== null) times.push(s.disconnectedAt + TAKEOVER_MS);
    return times.length ? Math.min(...times) : null;
  }

  /** ¿Le toca al bot sustituto? */
  isBotTurn(room: Room): boolean {
    const g = room.game;
    // Solo si queda alguien conectado mirando (no tiene sentido que los bots jueguen solos)
    return !!g && g.status === 'playing' && !!room.seats[g.turn]?.replaced && room.seats.some((s) => s.socketId);
  }

  /**
   * Avanza un paso del bot sustituto (un movimiento o el fin de turno).
   * Devuelve true si cambió el estado.
   */
  botStep(room: Room): boolean {
    const g = room.game;
    if (!g || !this.isBotTurn(room)) return false;
    const key = `${g.eventSeq}:${g.turn}`;
    if (!room.botPlan || room.botPlan.key !== key) {
      // Planificar desde el inicio del turno (por si quedó algo a medias)
      if (g.history.length) applyIntent(g, g.turn, { type: 'reset' }, this.now());
      const plan = planBotTurn(turnContext(g));
      room.botPlan = { key, moves: [...plan.moves], play: plan.play };
    }
    const plan = room.botPlan;
    const m = plan.moves.shift();
    if (m) {
      const intent = botMoveToIntent(m, g.working.table);
      if (intent) applyIntent(g, g.turn, intent, this.now());
      return true;
    }
    const r = applyIntent(g, g.turn, { type: plan.play ? 'endTurn' : 'draw' }, this.now());
    if (!r.ok) applyIntent(g, g.turn, { type: 'draw' }, this.now());
    room.botPlan = null;
    this.countResult(room);
    return true;
  }

  private countResult(room: Room) {
    const g = room.game;
    if (!g || g.status !== 'ended' || room.counted) return;
    room.counted = true;
    for (const w of g.result?.winners ?? []) {
      const s = room.seats[w];
      if (!s) continue;
      s.wins++;
      if (room.match) room.match.winsByToken[s.token] = (room.match.winsByToken[s.token] ?? 0) + 1;
    }
    // ¿Alguien llegó a las victorias necesarias? -> campeón(es) del torneo
    const m = room.match;
    if (m && !m.champions) {
      const need = winsNeeded(m.bestOf);
      const champs = Object.entries(m.winsByToken).filter(([, w]) => w >= need).map(([tok]) => tok);
      if (champs.length) m.champions = champs;
    }
  }

  /** Jugadores que cuentan para la revancha: humanos conectados. */
  private rematchVoters(room: Room): number[] {
    return room.seats.map((s, i) => (s.socketId && !s.replaced ? i : -1)).filter((i) => i >= 0);
  }

  rematch(room: Room, seat: Seat): boolean {
    if (!room.game || room.game.status !== 'ended') return false;
    room.rematch[seat] = true;
    room.lastActivity = this.now();
    this.checkRematch(room);
    return true;
  }

  /** Si todos los humanos conectados aceptaron, empieza la revancha solo con ellos. */
  private checkRematch(room: Room) {
    const voters = this.rematchVoters(room);
    if (voters.length === 0 || !voters.every((i) => room.rematch[i])) return;
    const keep = room.seats.filter((_, i) => voters.includes(i));
    const hostToken = room.seats[room.host]?.token;
    room.seats = keep;
    room.host = Math.max(0, keep.findIndex((s) => s.token === hostToken));
    if (keep.length >= MIN_PLAYERS) this.startGame(room);
    else {
      // No alcanza para jugar: volver a la sala de espera para que entre más gente
      room.game = null;
      room.rematch = [];
    }
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
    const players: ViewMeta['players'] = room.seats.map((s) => ({
      name: s.name,
      avatar: s.avatar,
      connected: !!s.socketId || s.replaced,
      isBot: s.replaced,
      replaced: s.replaced,
      wins: s.wins,
    }));
    if (!room.game) {
      return {
        roomCode: room.code,
        you: seat,
        players: players.map((p) => ({ ...p, rackCount: 0, opened: false })),
        host: room.host,
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
        rematch: [],
        bestOf: room.settings.bestOf,
        match: null,
        version: 0,
        nextMeldSeq: 1,
      };
    }
    return viewFor(room.game, seat, {
      roomCode: room.code,
      players,
      rematch: [...room.rematch],
      host: room.host,
      bestOf: room.settings.bestOf,
      match: this.matchInfo(room),
      now: this.now(),
    });
  }

  private matchInfo(room: Room): MatchInfo | null {
    const m = room.match;
    if (!m) return null;
    const champions = m.champions ? room.seats.map((s, i) => (m.champions!.includes(s.token) ? i : -1)).filter((i) => i >= 0) : null;
    return { bestOf: m.bestOf, game: m.game, wins: room.seats.map((s) => m.winsByToken[s.token] ?? 0), champions };
  }

  /** Elimina salas inactivas. Devuelve los códigos eliminados. */
  sweep(maxIdleMs = 30 * 60_000, maxWaitingMs = 2 * 60 * 60_000): string[] {
    const now = this.now();
    const out: string[] = [];
    for (const [code, room] of this.rooms) {
      const anyone = room.seats.some((s) => s.socketId);
      const idle = now - room.lastActivity;
      if ((!anyone && idle > maxIdleMs) || (!room.game && now - room.createdAt > maxWaitingMs) || idle > 6 * 60 * 60_000) {
        this.rooms.delete(code);
        out.push(code);
      }
    }
    return out;
  }
}
