/**
 * Conexión ligera al servidor mientras el juego está abierto (con cuenta): sirve para que
 * los amigos te vean "en línea" y para recibir invitaciones a sus salas.
 */
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, InvitePayload, PresenceInfo, ServerToClientEvents } from '@rummi/shared';
import { accessToken, accountState, onAccountChange } from '../account';
import { SERVER_URL } from './socket';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: S | null = null;
let userId: string | null = null;
const inviteListeners = new Set<(p: InvitePayload) => void>();

/** Conecta (o reconecta con otra cuenta) según el estado de la cuenta. */
function sync() {
  const u = accountState().user;
  const want = u?.id ?? null;
  if (want === userId) return;
  socket?.close();
  socket = null;
  userId = want;
  if (!want) return;
  socket = io(SERVER_URL ?? '/', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    auth: (cb) => {
      const tok = accessToken();
      cb(tok ? { accessToken: tok } : {});
    },
  });
  socket.on('invite', (p) => inviteListeners.forEach((f) => f(p)));
}

export function startPresence() {
  sync();
  onAccountChange(() => sync());
}

export function onInvite(f: (p: InvitePayload) => void): () => void {
  inviteListeners.add(f);
  return () => inviteListeners.delete(f);
}

export function queryPresence(ids: string[]): Promise<PresenceInfo> {
  const s = socket;
  if (!s?.connected || !ids.length) return Promise.resolve({ online: [], playing: [] });
  return new Promise((res) => {
    const t = setTimeout(() => res({ online: [], playing: [] }), 4000);
    s.emit('presence:query', ids, (r) => {
      clearTimeout(t);
      res(r);
    });
  });
}

export function sendInvite(to: string, code: string): Promise<Ack> {
  const s = socket;
  if (!s?.connected) return Promise.resolve({ ok: false, error: 'OFFLINE' });
  return new Promise((res) => {
    const t = setTimeout(() => res({ ok: false, error: 'OFFLINE' }), 6000);
    s.emit('invite:send', { to, code }, (r) => {
      clearTimeout(t);
      res(r);
    });
  });
}
