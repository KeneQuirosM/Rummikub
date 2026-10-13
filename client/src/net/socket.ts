import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  DragPayload,
  Intent,
  PlayerView,
  RoomJoined,
  RoomSettings,
  ServerToClientEvents,
} from '@rummi/shared';
import { profile, setSessionToken } from '../settings';
import { Emitter, type Transport, type TransportEvents } from './transport';

export const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Transporte online. Reconexión automática: al volver la red, Socket.IO reconecta y
 * reenviamos room:join con el token de sesión para recuperar el asiento y el atril.
 */
export class SocketTransport implements Transport {
  readonly kind = 'online' as const;
  private em = new Emitter<TransportEvents>();
  code: string | null = null;
  private token: string | null = null;
  private left = false;
  lastState: PlayerView | null = null;

  private constructor(private socket: S) {
    socket.on('state', (v) => {
      this.lastState = v;
      this.em.emit('state', v);
    });
    socket.on('drag', (d) => this.em.emit('drag', d));
    socket.on('emote', (e) => this.em.emit('emote', e));
    socket.on('chat', (m) => this.em.emit('chat', m));
    socket.on('room:closed', () => this.em.emit('closed'));
    socket.on('disconnect', () => {
      if (!this.left) this.em.emit('status', 'reconnecting');
    });
    socket.io.on('reconnect_failed', () => this.em.emit('status', 'offline'));
    socket.on('connect', () => {
      if (!this.code || !this.token || this.left) return;
      // Reconexión: recuperar asiento con el token
      socket.emit('room:join', { code: this.code, token: this.token, name: profile.name, avatar: profile.avatar }, (r) => {
        if (r.ok) this.em.emit('status', 'connected');
        else this.em.emit('closed');
      });
    });
  }

  /** Conecta al servidor; rechaza si no responde. */
  static connect(timeoutMs = 8000): Promise<SocketTransport> {
    return new Promise((resolve, reject) => {
      const socket: S = io(SERVER_URL ?? '/', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: timeoutMs,
      });
      const fail = () => {
        cleanup();
        socket.close();
        reject(new Error('server'));
      };
      const timer = setTimeout(fail, timeoutMs);
      const ok = () => {
        cleanup();
        resolve(new SocketTransport(socket));
      };
      let errors = 0;
      const onErr = () => {
        if (++errors >= 3) fail();
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', ok);
        socket.off('connect_error', onErr);
      };
      socket.on('connect', ok);
      socket.on('connect_error', onErr);
    });
  }

  private remember(r: Ack<RoomJoined>) {
    if (r.ok) {
      this.code = r.code;
      this.token = r.token;
      setSessionToken(r.code, r.token);
    }
    return r;
  }

  create(settings: Partial<RoomSettings>): Promise<Ack<RoomJoined>> {
    return new Promise((resolve) =>
      this.socket.emit('room:create', { name: profile.name, avatar: profile.avatar, settings }, (r) => resolve(this.remember(r))),
    );
  }

  join(code: string, token?: string): Promise<Ack<RoomJoined>> {
    return new Promise((resolve) =>
      this.socket.emit('room:join', { code, name: profile.name, avatar: profile.avatar, ...(token ? { token } : {}) }, (r) =>
        resolve(this.remember(r)),
      ),
    );
  }

  /** El anfitrión elige el modo: partida única o mejor de 3. */
  configure(bestOf: number): Promise<Ack> {
    return new Promise((resolve) => this.socket.emit('room:config', { bestOf }, resolve));
  }

  /** El anfitrión empieza la partida (2 a 4 jugadores). */
  start(): Promise<Ack> {
    return new Promise((resolve) => this.socket.emit('room:start', resolve));
  }

    intent(i: Intent): Promise<Ack> {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve({ ok: false, error: 'NOT_IN_ROOM' });
      this.socket.timeout(10000).emit('game:intent', i, (err: Error | null, r: Ack) => resolve(err ? { ok: false, error: 'NOT_IN_ROOM' } : r));
    });
  }

  drag(d: DragPayload): void {
    this.socket.volatile.emit('drag', d);
  }

  emote(e: string): void {
    this.socket.emit('emote', e);
  }

  chat(text: string): void {
    this.socket.emit('chat', text);
  }

  rematch(): void {
    this.socket.emit('game:rematch');
  }

  leave(): void {
    this.left = true;
    this.socket.emit('room:leave');
    this.em.clear();
    setTimeout(() => this.socket.close(), 100);
  }

  on<K extends keyof TransportEvents>(ev: K, cb: TransportEvents[K]): () => void {
    return this.em.on(ev, cb);
  }
}
