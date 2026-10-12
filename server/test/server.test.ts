import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, PlayerView, RoomJoined, ServerToClientEvents } from '@rummi/shared';
import { createApp, type App } from '../src/app.js';
import { RoomManager, sanitizeChat, sanitizeName } from '../src/rooms.js';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: App;
let url: string;
const clients: C[] = [];

beforeAll(async () => {
  app = await createApp({ port: 0 });
  url = `http://localhost:${app.port}`;
});
afterAll(async () => {
  clients.forEach((c) => c.close());
  await app.close();
});

function client(): Promise<C> {
  return new Promise((res) => {
    const c: C = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(c);
    c.on('connect', () => res(c));
  });
}

function nextState(c: C, pred: (v: PlayerView) => boolean = () => true, ms = 2000): Promise<PlayerView> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout esperando state')), ms);
    const h = (v: PlayerView) => {
      if (!pred(v)) return;
      clearTimeout(t);
      c.off('state', h);
      res(v);
    };
    c.on('state', h);
  });
}

const create = (c: C, turnSeconds = 60) =>
  new Promise<Ack<RoomJoined>>((res) => c.emit('room:create', { name: 'Ana', avatar: '🦊', settings: { turnSeconds } }, res));
const join = (c: C, code: string, token?: string, name = 'Beto') =>
  new Promise<Ack<RoomJoined>>((res) => c.emit('room:join', { code, name, avatar: '🐼', ...(token ? { token } : {}) }, res));

async function setupRoom() {
  const a = await client();
  const b = await client();
  const ra = await create(a);
  if (!ra.ok) throw new Error('create');
  const pa = nextState(a, (v) => v.status === 'playing');
  const pb = nextState(b, (v) => v.status === 'playing');
  const rb = await join(b, ra.code);
  if (!rb.ok) throw new Error('join');
  const [va, vb] = await Promise.all([pa, pb]);
  return { a, b, ra, rb, va, vb };
}

describe('salas', () => {
  it('crear sala devuelve código de 4 letras y estado de espera', async () => {
    const a = await client();
    const waiting = nextState(a);
    const r = await create(a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    const v = await waiting;
    expect(v.status).toBe('waiting');
  });

  it('sala inexistente y sala llena', async () => {
    const x = await client();
    expect(await join(x, 'ZZZZ')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(await join(x, '12')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    const { ra } = await setupRoom();
    if (!ra.ok) return;
    const c = await client();
    expect(await join(c, ra.code)).toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('al unirse empieza la partida y cada uno ve solo su atril', async () => {
    const { va, vb } = await setupRoom();
    expect(va.rack).toHaveLength(14);
    expect(vb.rack).toHaveLength(14);
    expect(va.players[1].rackCount).toBe(14);
    // Anti-trampa: ninguna ficha de B aparece en la vista de A y no hay pozo
    for (const t of vb.rack) expect(va.rack).not.toContain(t);
    expect(JSON.stringify(va)).not.toMatch(/"pool"|"racks"/);
    expect(va.poolCount).toBe(78);
    expect(va.turn).toBe(vb.turn);
  });

  it('solo el jugador en turno puede actuar; robar sincroniza a ambos', async () => {
    const { a, b, va } = await setupRoom();
    const [cur, other] = va.turn === va.you ? [a, b] : [b, a];
    const bad = await new Promise<Ack>((res) => other.emit('game:intent', { type: 'draw' }, res));
    expect(bad).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    const sOther = nextState(other, (v) => v.poolCount === 77);
    const sCur = nextState(cur, (v) => v.poolCount === 77);
    const ok = await new Promise<Ack>((res) => cur.emit('game:intent', { type: 'draw' }, res));
    expect(ok).toEqual({ ok: true });
    const [vo, vc] = await Promise.all([sOther, sCur]);
    expect(vc.rack).toHaveLength(15);
    expect(vo.players[1 - vo.you]!.rackCount).toBe(15);
    expect(vo.turn).toBe(vo.you);
  });

  it('intenciones malformadas se rechazan', async () => {
    const { a, b, va } = await setupRoom();
    const cur = va.turn === va.you ? a : b;
    const r = await new Promise<Ack>((res) => cur.emit('game:intent', { type: 'move', tileId: 9999, to: { kind: 'new' } } as never, res));
    expect(r).toEqual({ ok: false, error: 'BAD_INTENT' });
    // mover una ficha que no es suya
    const theirs = va.turn === va.you ? null : va.rack[0];
    if (theirs !== null && theirs !== undefined) {
      const r2 = await new Promise<Ack>((res) => cur.emit('game:intent', { type: 'move', tileId: theirs, to: { kind: 'new' } }, res));
      expect(r2).toEqual({ ok: false, error: 'TILE_NOT_AVAILABLE' });
    }
  });

  it('reconexión con token: recupera asiento y atril', async () => {
    const { a, b, ra, va } = await setupRoom();
    if (!ra.ok) return;
    const disc = nextState(b, (v) => !v.players[1 - v.you]!.connected);
    a.close();
    const vd = await disc;
    expect(vd.players[1 - vd.you]!.connected).toBe(false);
    const a2 = await client();
    const back = nextState(a2);
    const r = await join(a2, ra.code, ra.token, 'Ana');
    expect(r).toMatchObject({ ok: true, seat: ra.seat });
    const v2 = await back;
    expect([...v2.rack].sort()).toEqual([...va.rack].sort());
  });

  it('el arrastre del rival oculta fichas privadas', async () => {
    const { a, b, va } = await setupRoom();
    const [cur, other, view] = va.turn === va.you ? [a, b, va] : [b, a, null];
    const got = new Promise<unknown>((res) => other.once('drag', res));
    const tile = view ? view.rack[0]! : 0;
    cur.emit('drag', { tileId: tile, x: 1, z: 2, active: true });
    const d = await got;
    expect(d).toEqual({ tileId: null, x: 1, z: 2, active: true });
  });

  it('chat y emojis se reenvían saneados', async () => {
    const { a, b } = await setupRoom();
    const gotChat = new Promise<unknown>((res) => b.once('chat', res));
    a.emit('chat', '  hola\u0000 ');
    expect(await gotChat).toMatchObject({ text: 'hola', from: expect.any(Number) });
    const gotEmote = new Promise<unknown>((res) => b.once('emote', res));
    a.emit('emote', '<script>');
    a.emit('emote', '👍');
    expect(await gotEmote).toMatchObject({ emoji: '👍' });
  });
});

describe('RoomManager', () => {
  it('timeout de turno: revierte y roba', () => {
    let t = 1000;
    const rm = new RoomManager(() => t);
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, { turnSeconds: 30 }, 's1');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's2');
    const g = room.game!;
    const seat = g.turn;
    const before = g.racks[seat].length;
    const tile = g.working.rack[0]!;
    expect(rm.intent(room, seat, { type: 'move', tileId: tile, to: { kind: 'new' } }).ok).toBe(true);
    t += 31_000;
    expect(rm.tick(room)).toBe(true);
    expect(g.racks[seat]).toHaveLength(before + 1);
    expect(g.table).toHaveLength(0);
    expect(g.turn).toBe(1 - seat);
  });

  it('revancha: requiere a los dos y alterna quién empieza', () => {
    const rm = new RoomManager();
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, {}, 's1');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's2');
    room.game!.status = 'ended';
    room.game!.result = { winner: 0, reason: 'out', points: [0, 10] };
    const first = room.game!;
    rm.rematch(room, 0);
    expect(room.game).toBe(first);
    rm.rematch(room, 1);
    expect(room.game).not.toBe(first);
    expect(room.game!.status).toBe('playing');
  });

  it('limpieza de salas inactivas', () => {
    let t = 0;
    const rm = new RoomManager(() => t);
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, {}, 's1');
    rm.disconnect(room.code, 0, 's1');
    t += 31 * 60_000;
    expect(rm.sweep()).toEqual([room.code]);
  });

  it('saneado de entradas', () => {
    expect(sanitizeName('  <b>Ana</b>\u0007 ')).toBe('bAna/b');
    expect(sanitizeName('x'.repeat(50))).toHaveLength(16);
    expect(sanitizeName(42)).toBe('Jugador');
    expect(sanitizeChat('   ')).toBeNull();
    expect(sanitizeChat('a'.repeat(500))).toHaveLength(140);
  });
});
