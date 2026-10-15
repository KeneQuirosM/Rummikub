import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, Seat, ServerToClientEvents } from '@rummi/shared';
import type { Accounts } from './accounts.js';
import { isEmote, RoomManager, sanitizeChat, type Room } from './rooms.js';

export interface AppOptions {
  port?: number;
  /** Orígenes permitidos para CORS (lista). Vacío = cualquiera. */
  corsOrigins?: string[];
  /** Carpeta con el cliente compilado para servirlo desde el mismo origen (opcional). */
  staticDir?: string | null;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** Cuentas (Supabase). null = sin cuentas. */
  accounts?: Accounts | null;
}

interface SocketData {
  code?: string;
  /** Token del asiento (los índices pueden cambiar en una revancha). */
  token?: string;
  /** Usuario verificado con el token de acceso del handshake (null = sin cuenta). */
  userId?: string | null;
  buckets: Record<string, { tokens: number; at: number }>;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Límite de eventos por socket (token bucket). */
const LIMITS: Record<string, { rate: number; burst: number }> = {
  intent: { rate: 25, burst: 40 },
  drag: { rate: 30, burst: 30 },
  chat: { rate: 1, burst: 5 },
  emote: { rate: 2, burst: 6 },
  room: { rate: 2, burst: 8 },
  presence: { rate: 0.5, burst: 6 },
  invite: { rate: 0.5, burst: 5 },
};

function allow(socket: S, kind: keyof typeof LIMITS, now: number): boolean {
  const lim = LIMITS[kind]!;
  const b = (socket.data.buckets[kind] ??= { tokens: lim.burst, at: now });
  b.tokens = Math.min(lim.burst, b.tokens + ((now - b.at) / 1000) * lim.rate);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(join(dir, path));
  if (!file.startsWith(resolve(dir))) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(path)) return false;
    file = join(dir, 'index.html');
    path = '/index.html';
    if (!existsSync(file)) return false;
  }
  const ext = extname(file);
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' };
  if (path.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
  return true;
}

export interface App {
  http: HttpServer;
  io: IO;
  rooms: RoomManager;
  port: number;
  close(): Promise<void>;
}

export function createApp(opts: AppOptions = {}): Promise<App> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const rooms = new RoomManager(now);
  const accounts = opts.accounts ?? null;
  if (accounts) rooms.onResults = (rows) => accounts.record(rows);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    // Configuración pública para el cliente (las cuentas son opcionales)
    if (req.url === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(accounts ? { supabase: accounts.publicConfig } : {}));
      return;
    }
    if (opts.staticDir && req.method === 'GET' && serveStatic(opts.staticDir, req, res)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Rummi 3D server');
  });

  const origins = opts.corsOrigins?.filter(Boolean) ?? [];
  const io: IO = new Server(http, {
    cors: { origin: origins.length ? origins : true, methods: ['GET', 'POST'] },
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16_000,
  });

  const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const broadcast = (room: Room) => {
    room.seats.forEach((s, i) => {
      if (s.socketId) io.to(s.socketId).emit('state', rooms.view(room, i));
    });
    schedule(room);
    driveBot(room);
  };

  /** Bot sustituto de jugadores que abandonaron: un movimiento cada ~0.4 s. */
  const driveBot = (room: Room) => {
    if (botTimers.has(room.code) || !rooms.isBotTurn(room)) return;
    const thinking = !room.botPlan;
    botTimers.set(
      room.code,
      setTimeout(
        () => {
          botTimers.delete(room.code);
          if (!rooms.rooms.has(room.code)) return;
          if (rooms.botStep(room)) broadcast(room);
        },
        thinking ? 1100 : 400,
      ),
    );
  };

  /** Temporizador del turno: dispara exactamente al vencer. */
  const schedule = (room: Room) => {
    const prev = timers.get(room.code);
    if (prev) clearTimeout(prev);
    timers.delete(room.code);
    // Fin de turno o relevo de un jugador desconectado por el bot
    const at = rooms.nextCheckAt(room);
    if (at === null) return;
    const ms = Math.max(0, at - now()) + 20;
    timers.set(
      room.code,
      setTimeout(() => {
        timers.delete(room.code);
        if (!rooms.rooms.has(room.code)) return;
        if (rooms.tick(room)) broadcast(room);
        else schedule(room);
      }, ms),
    );
  };

  const seatOf = (socket: S): { room: Room; seat: Seat } | null => {
    const { code, token } = socket.data;
    if (!code || !token) return null;
    const room = rooms.rooms.get(code);
    if (!room) return null;
    const seat = rooms.seatByToken(room, token);
    if (seat < 0 || room.seats[seat]!.socketId !== socket.id) return null;
    return { room, seat };
  };

  const attach = (socket: S, room: Room, token: string) => {
    // Si este socket estaba en otra sala, salir
    if (socket.data.code && socket.data.code !== room.code) void socket.leave(socket.data.code);
    socket.data.code = room.code;
    socket.data.token = token;
    void socket.join(room.code);
  };

  const clearRoomTimers = (code: string) => {
    for (const m of [timers, botTimers]) {
      const t = m.get(code);
      if (t) clearTimeout(t);
      m.delete(code);
    }
  };

  // Identificar la cuenta con el token del handshake (si no hay o no es válido, se juega sin cuenta)
  io.use((socket, next) => {
    const tok = (socket.handshake.auth as { accessToken?: unknown } | undefined)?.accessToken;
    if (!accounts || typeof tok !== 'string') {
      socket.data.userId = null;
      return next();
    }
    accounts
      .verify(tok)
      .then((id) => {
        socket.data.userId = id;
        next();
      })
      .catch(() => {
        socket.data.userId = null;
        next();
      });
  });

  /** Cuentas conectadas: usuario -> sockets (menú y partidas). */
  const online = new Map<string, Set<string>>();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isPlaying = (userId: string) => {
    for (const room of rooms.rooms.values())
      if (room.game?.status === 'playing' && room.seats.some((s) => s.userId === userId && !s.replaced)) return true;
    return false;
  };

  io.on('connection', (socket: S) => {
    socket.data.buckets = {};
    const uid = socket.data.userId;
    if (uid) {
      const set = online.get(uid) ?? new Set<string>();
      set.add(socket.id);
      online.set(uid, set);
      socket.on('disconnect', () => {
        set.delete(socket.id);
        if (!set.size && online.get(uid) === set) online.delete(uid);
      });
    }

    socket.on('presence:query', (ids, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'presence', now()) || !Array.isArray(ids)) return ack({ online: [], playing: [] });
      const list = ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 200);
      const on = list.filter((x) => online.has(x));
      ack({ online: on, playing: on.filter(isPlaying) });
    });

    socket.on('invite:send', (p, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'invite', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const me = socket.data.userId;
      if (!me || !accounts) return ack({ ok: false, error: 'NO_ACCOUNT' });
      const to = typeof p?.to === 'string' ? p.to : '';
      const room = rooms.rooms.get(String(p?.code ?? '').toUpperCase());
      // Solo a mi propia sala, mientras espera jugadores
      const mySeat = room?.seats.find((s) => s.userId === me && s.socketId);
      if (!room || !mySeat) return ack({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (room.game) return ack({ ok: false, error: 'GAME_IN_PROGRESS' });
      const targets = online.get(to);
      if (!targets?.size) return ack({ ok: false, error: 'OFFLINE' });
      void accounts.areFriends(me, to).then((friends) => {
        if (!friends) return ack({ ok: false, error: 'NOT_FRIENDS' });
        for (const sid of targets) io.to(sid).emit('invite', { from: { id: me, name: mySeat.name, avatar: mySeat.avatar }, code: room.code });
        log(`[room ${room.code}] invitación enviada`);
        ack({ ok: true });
      });
    });

    socket.on('room:create', (p, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'room', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const { room, seat, token } = rooms.create(p ?? {}, p?.settings, socket.id);
      room.seats[seat]!.userId = socket.data.userId ?? null;
      attach(socket, room, token);
      log(`[room ${room.code}] creada`);
      ack({ ok: true, code: room.code, token, seat });
      broadcast(room);
    });

    socket.on('room:join', (p, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'room', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const prevSocket = (() => {
        const room = rooms.rooms.get(String(p?.code ?? '').toUpperCase());
        const s = room?.seats.find((x) => x.token === p?.token);
        return s?.socketId ?? null;
      })();
      const r = rooms.join(p?.code, p ?? {}, p?.token, socket.id);
      if (!r.ok) return ack(r);
      // Vincular la cuenta (al reconectar sin token válido se conserva la anterior)
      const st = r.room.seats[r.seat]!;
      if (socket.data.userId) st.userId = socket.data.userId;
      else if (!r.reconnected) st.userId = null;
      // Expulsar la conexión anterior del mismo asiento (otra pestaña / socket zombie)
      if (prevSocket && prevSocket !== socket.id) io.sockets.sockets.get(prevSocket)?.disconnect(true);
      attach(socket, r.room, r.token);
      log(`[room ${r.room.code}] asiento ${r.seat} ${r.reconnected ? 'reconectado' : 'unido'}`);
      ack({ ok: true, code: r.room.code, token: r.token, seat: r.seat });
      broadcast(r.room);
    });

    socket.on('game:intent', (intent, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'intent', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const ctx = seatOf(socket);
      if (!ctx) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      const r = rooms.intent(ctx.room, ctx.seat, intent);
      // Primero el estado, luego el ack (el cliente aplica el último estado al recibir el ack)
      if (r.ok) broadcast(ctx.room);
      ack(r);
    });

    socket.on('room:start', (ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'room', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const ctx = seatOf(socket);
      if (!ctx) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      const r = rooms.start(ctx.room, ctx.seat);
      if (r.ok) {
        log(`[room ${ctx.room.code}] partida de ${ctx.room.seats.length} jugadores`);
        broadcast(ctx.room);
      }
      ack(r);
    });

    socket.on('room:config', (cfg, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow(socket, 'room', now())) return ack({ ok: false, error: 'RATE_LIMITED' });
      const ctx = seatOf(socket);
      if (!ctx) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      const r = rooms.configure(ctx.room, ctx.seat, cfg);
      if (r.ok) broadcast(ctx.room);
      ack(r);
    });

    socket.on('game:rematch', () => {
      const ctx = seatOf(socket);
      if (!ctx) return;
      if (rooms.rematch(ctx.room, ctx.seat)) broadcast(ctx.room);
    });

    socket.on('drag', (d) => {
      if (!allow(socket, 'drag', now())) return;
      const ctx = seatOf(socket);
      if (!ctx) return;
      const g = ctx.room.game;
      if (!g || g.status !== 'playing' || g.turn !== ctx.seat) return;
      const safe = rooms.filterDrag(ctx.room, d);
      if (!safe) return;
      // A todos los demás jugadores de la mesa
      ctx.room.seats.forEach((s, i) => {
        if (i !== ctx.seat && s.socketId) io.to(s.socketId).volatile.emit('drag', safe);
      });
    });

    socket.on('emote', (e) => {
      if (!allow(socket, 'emote', now()) || !isEmote(e)) return;
      const ctx = seatOf(socket);
      if (ctx) io.to(ctx.room.code).emit('emote', { from: ctx.seat, emoji: e });
    });

    socket.on('chat', (text) => {
      if (!allow(socket, 'chat', now())) return;
      const clean = sanitizeChat(text);
      const ctx = seatOf(socket);
      if (ctx && clean) io.to(ctx.room.code).emit('chat', { from: ctx.seat, text: clean, at: now() });
    });

    socket.on('room:leave', () => {
      const ctx = seatOf(socket);
      if (!ctx) return;
      const r = rooms.leave(ctx.room.code, ctx.seat, socket.id);
      void socket.leave(ctx.room.code);
      socket.data.code = undefined;
      socket.data.token = undefined;
      if (!r) return;
      if (r.closed) {
        io.to(ctx.room.code).emit('room:closed');
        clearRoomTimers(ctx.room.code);
      } else broadcast(r.room);
    });

    socket.on('disconnect', () => {
      const ctx = seatOf(socket);
      if (!ctx) return;
      const room = rooms.disconnect(ctx.room.code, ctx.seat, socket.id);
      if (room) broadcast(room);
    });
  });

  const sweeper = setInterval(() => {
    for (const code of rooms.sweep()) {
      clearRoomTimers(code);
      log(`[room ${code}] eliminada por inactividad`);
    }
  }, 60_000);
  sweeper.unref();

  return new Promise((resolveApp) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
      resolveApp({
        http,
        io,
        rooms,
        port,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(sweeper);
            timers.forEach(clearTimeout);
            botTimers.forEach(clearTimeout);
            io.close(() => res());
          }),
      });
    });
  });
}
