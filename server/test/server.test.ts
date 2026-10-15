import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, PlayerView, RoomJoined, ServerToClientEvents } from '@rummi/shared';
import { createApp, type App } from '../src/app.js';
import type { Accounts, ResultRow } from '../src/accounts.js';
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
  // El anfitrión empieza la partida
  const started = await new Promise<Ack>((res) => a.emit('room:start', res));
  if (!started.ok) throw new Error('start');
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

  it('sala inexistente y partida ya empezada', async () => {
    const x = await client();
    expect(await join(x, 'ZZZZ')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(await join(x, '12')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    const { ra } = await setupRoom();
    if (!ra.ok) return;
    const c = await client();
    expect(await join(c, ra.code)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
  });

  it('solo el anfitrión empieza y hacen falta 2', async () => {
    const a = await client();
    const b = await client();
    const ra = await create(a);
    if (!ra.ok) return;
    expect(await new Promise<Ack>((res) => a.emit('room:start', res))).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    await join(b, ra.code);
    expect(await new Promise<Ack>((res) => b.emit('room:start', res))).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('cuatro jugadores: la mesa llena empieza sola, el 5.º no entra y el turno rota', async () => {
    const cs = await Promise.all([client(), client(), client(), client()]);
    const ra = await create(cs[0]!);
    if (!ra.ok) return;
    const playing = cs.map((c) => nextState(c, (v) => v.status === 'playing', 4000));
    for (let i = 1; i < 4; i++) expect(await join(cs[i]!, ra.code, undefined, `P${i}`)).toMatchObject({ ok: true, seat: i });
    const views = await Promise.all(playing);
    expect(views.map((v) => v.you).sort()).toEqual([0, 1, 2, 3]);
    for (const v of views) {
      expect(v.players).toHaveLength(4);
      expect(v.rack).toHaveLength(14);
      expect(v.poolCount).toBe(50);
    }
    // Nadie ve fichas de otro
    const all = views.flatMap((v) => v.rack);
    expect(new Set(all).size).toBe(56);
    const fifth = await client();
    expect(await join(fifth, ra.code)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
    // El turno pasa al siguiente asiento
    const turn = views[0]!.turn;
    const cur = cs[views.findIndex((v) => v.you === turn)]!;
    const next = nextState(cs[0]!, (v) => v.turn === (turn + 1) % 4);
    expect(await new Promise<Ack>((res) => cur.emit('game:intent', { type: 'draw' }, res))).toEqual({ ok: true });
    await next;
  });

  it('al unirse empieza la partida y cada uno ve solo su atril', async () => {
    const { va, vb } = await setupRoom();
    expect(va.rack).toHaveLength(14);
    expect(vb.rack).toHaveLength(14);
    expect(va.players[1]!.rackCount).toBe(14);
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
    // Frases rápidas: solo las de la lista
    const gotPhrase = new Promise<unknown>((res) => b.once('emote', res));
    a.emit('emote', 'phrase:hackeo');
    a.emit('emote', 'phrase:gg');
    expect(await gotPhrase).toMatchObject({ emoji: 'phrase:gg' });
  });
});

describe('RoomManager', () => {
  it('timeout de turno: revierte y roba', () => {
    let t = 1000;
    const rm = new RoomManager(() => t);
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, { turnSeconds: 30 }, 's1');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's2');
    rm.start(room, 0);
    const g = room.game!;
    const seat = g.turn;
    const before = g.racks[seat]!.length;
    const tile = g.working.rack[0]!;
    expect(rm.intent(room, seat, { type: 'move', tileId: tile, to: { kind: 'new' } }).ok).toBe(true);
    t += 31_000;
    expect(rm.tick(room)).toBe(true);
    expect(g.racks[seat]).toHaveLength(before + 1);
    expect(g.table).toHaveLength(0);
    expect(g.turn).toBe((seat + 1) % 2);
  });

  it('revancha: requiere a todos y alterna quién empieza', () => {
    const rm = new RoomManager();
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, {}, 's1');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's2');
    rm.start(room, 0);
    room.game!.status = 'ended';
    room.game!.result = { winners: [0], reason: 'out', points: [0, 10] };
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

  const fourRoom = (rm: RoomManager) => {
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, { turnSeconds: 0 }, 's0');
    for (let i = 1; i < 3; i++) rm.join(room.code, { name: `P${i}`, avatar: '🐼' }, undefined, `s${i}`);
    return room;
  };

  it('sala de espera: si sale el anfitrión, el siguiente pasa a ser anfitrión', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    expect(room.seats).toHaveLength(3);
    rm.leave(room.code, 0, 's0');
    expect(room.seats.map((s) => s.name)).toEqual(['P1', 'P2']);
    expect(room.host).toBe(0);
    expect(rm.start(room, 1)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rm.start(room, 0)).toEqual({ ok: true });
    expect(room.game!.numPlayers).toBe(2);
  });

  it('abandono en partida: el bot toma su lugar y juega su turno', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    rm.start(room, 0);
    const g = room.game!;
    const leaver = g.turn;
    rm.leave(room.code, leaver, `s${leaver}`);
    expect(room.seats[leaver]!.replaced).toBe(true);
    expect(rm.view(room, (leaver + 1) % 3).players[leaver]).toMatchObject({ isBot: true, replaced: true });
    expect(rm.isBotTurn(room)).toBe(true);
    let steps = 0;
    while (rm.isBotTurn(room) && steps++ < 100) rm.botStep(room);
    expect(g.turn).toBe((leaver + 1) % 3);
    // Si vuelve con su token recupera el asiento
    const back = rm.join(room.code, { name: 'X', avatar: '🙂' }, room.seats[leaver]!.token, 'new');
    expect(back).toMatchObject({ ok: true, seat: leaver, reconnected: true });
    expect(room.seats[leaver]!.replaced).toBe(false);
  });

  it('si queda un solo humano la partida sigue contra el bot', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    rm.start(room, 0);
    rm.leave(room.code, 1, 's1');
    rm.leave(room.code, 2, 's2');
    expect(room.game!.status).toBe('playing');
    expect(room.seats.map((s) => s.replaced)).toEqual([false, true, true]);
    // En 1 vs 1 también: quien sale es reemplazado por el bot
    const rm2 = new RoomManager();
    const { room: r2 } = rm2.create({ name: 'A', avatar: '🦊' }, {}, 'a');
    rm2.join(r2.code, { name: 'B', avatar: '🐼' }, undefined, 'b');
    rm2.start(r2, 0);
    rm2.leave(r2.code, 1, 'b');
    expect(r2.game!.status).toBe('playing');
    expect(rm2.view(r2, 0).players[1]).toMatchObject({ isBot: true, replaced: true });
  });

  it('nadie conectado: los bots no juegan solos', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    rm.start(room, 0);
    const g = room.game!;
    rm.leave(room.code, g.turn, `s${g.turn}`);
    expect(rm.isBotTurn(room)).toBe(true);
    for (let i = 0; i < 3; i++) if (room.seats[i]!.socketId) rm.disconnect(room.code, i, `s${i}`);
    expect(rm.isBotTurn(room)).toBe(false);
  });

  it('revancha parcial: sigue solo con quienes siguen conectados', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    rm.start(room, 0);
    room.game!.status = 'ended';
    room.game!.result = { winners: [2], reason: 'out', points: [5, 9, 0] };
    rm.disconnect(room.code, 1, 's1');
    rm.rematch(room, 0);
    const first = room.game;
    rm.rematch(room, 2);
    expect(room.game).not.toBe(first);
    expect(room.seats.map((s) => s.name)).toEqual(['A', 'P2']);
    expect(room.game!.numPlayers).toBe(2);
  });

  it('quien se desconecta y no vuelve en 30 s es relevado por el bot; al volver recupera su asiento', () => {
    let t = 0;
    const rm = new RoomManager(() => t);
    const room = fourRoom(rm);
    rm.start(room, 0);
    const g = room.game!;
    const cur = g.turn;
    rm.disconnect(room.code, cur, `s${cur}`);
    expect(rm.nextCheckAt(room)).toBe(30_000);
    t += 20_000;
    expect(rm.tick(room)).toBe(false);
    expect(rm.isBotTurn(room)).toBe(false);
    t += 11_000;
    expect(rm.tick(room)).toBe(true);
    expect(room.seats[cur]!.replaced).toBe(true);
    expect(rm.isBotTurn(room)).toBe(true);
    // El bot juega su turno completo
    let steps = 0;
    while (rm.isBotTurn(room) && steps++ < 100) rm.botStep(room);
    expect(g.turn).toBe((cur + 1) % 3);
    // Vuelve con su token
    const back = rm.join(room.code, { name: 'X', avatar: '🙂' }, room.seats[cur]!.token, 'new');
    expect(back).toMatchObject({ ok: true, seat: cur, reconnected: true });
    expect(room.seats[cur]!.replaced).toBe(false);
  });

  it('Empezar dos veces no da error: la segunda vez entra a la partida en curso', () => {
    const rm = new RoomManager();
    const room = fourRoom(rm);
    expect(rm.start(room, 0)).toEqual({ ok: true });
    const g = room.game;
    expect(rm.start(room, 0)).toEqual({ ok: true });
    expect(room.game).toBe(g);
  });

  it('torneo al mejor de 3: marcador, campeón y nuevo torneo', () => {
    const rm = new RoomManager();
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, { turnSeconds: 0 }, 's0');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's1');
    expect(rm.configure(room, 1, { bestOf: 3 })).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rm.configure(room, 0, { bestOf: 7 })).toEqual({ ok: false, error: 'BAD_REQUEST' });
    expect(rm.configure(room, 0, { bestOf: 3 })).toEqual({ ok: true });
    expect(rm.view(room, 1).bestOf).toBe(3);
    rm.start(room, 0);
    const endGame = (winner: number) => {
      const g = room.game!;
      g.status = 'ended';
      g.result = { winners: [winner], reason: 'out', points: [0, 0] };
      // como si el motor terminara la partida: se cuenta el resultado
      (rm as unknown as { countResult(r: typeof room): void }).countResult(room);
    };
    expect(rm.view(room, 0).match).toEqual({ bestOf: 3, game: 1, wins: [0, 0], champions: null });
    endGame(0);
    expect(rm.view(room, 0).match).toMatchObject({ game: 1, wins: [1, 0], champions: null });
    rm.rematch(room, 0);
    rm.rematch(room, 1);
    expect(rm.view(room, 0).match).toMatchObject({ game: 2, wins: [1, 0] });
    endGame(1);
    rm.rematch(room, 0);
    rm.rematch(room, 1);
    expect(rm.view(room, 1).match).toMatchObject({ game: 3, wins: [1, 1], champions: null });
    endGame(1);
    expect(rm.view(room, 0).match).toMatchObject({ wins: [1, 2], champions: [1] });
    // Revancha tras el campeón: torneo nuevo
    rm.rematch(room, 0);
    rm.rematch(room, 1);
    expect(rm.view(room, 0).match).toEqual({ bestOf: 3, game: 1, wins: [0, 0], champions: null });
  });

  it('partida única: sin torneo', () => {
    const rm = new RoomManager();
    const { room } = rm.create({ name: 'A', avatar: '🦊' }, {}, 's0');
    rm.join(room.code, { name: 'B', avatar: '🐼' }, undefined, 's1');
    rm.start(room, 0);
    expect(rm.view(room, 0)).toMatchObject({ bestOf: 1, match: null });
  });
});

describe('cuentas', () => {
  it('al terminar se anotan los resultados de quienes tienen cuenta (no de quien abandonó)', () => {
    let t = 1_000;
    const rm = new RoomManager(() => t);
    const rows: ResultRow[][] = [];
    rm.onResults = (r) => rows.push(r);
    const { room } = rm.create({ name: 'Ana', avatar: '🦊' }, { bestOf: 3 }, 's0');
    rm.join(room.code, { name: 'Beto', avatar: '🐼' }, undefined, 's1');
    rm.join(room.code, { name: 'Caro', avatar: '🐯' }, undefined, 's2');
    room.seats[0]!.userId = '11111111-1111-1111-1111-111111111111';
    room.seats[2]!.userId = '33333333-3333-3333-3333-333333333333';
    rm.start(room, 0);
    room.seats[2]!.replaced = true; // Caro se fue: el bot terminó por ella
    const g = room.game!;
    // Mejor jugada: se cuenta desde los eventos del motor
    g.lastEvent = { type: 'play', player: 0, seq: ++g.eventSeq, tiles: [1, 2, 3, 4] };
    (rm as unknown as { countResult(r: typeof room): void }).countResult(room);
    t += 95_000;
    g.status = 'ended';
    g.result = { winners: [0], reason: 'out', points: [0, 12, 30] };
    (rm as unknown as { countResult(r: typeof room): void }).countResult(room);
    (rm as unknown as { countResult(r: typeof room): void }).countResult(room); // solo una vez
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      {
        user_id: '11111111-1111-1111-1111-111111111111', mode: 'online', level: null, place: 1, players: 3, won: true, points: 0,
        rivals: [{ name: 'Beto', avatar: '🐼' }, { name: 'Caro', avatar: '🐯' }],
        duration_sec: 95, best_play: 4, champion: false, best_of: 3,
      },
    ]);
  });

  it('el token del handshake vincula la cuenta al asiento y /config.json la publica', async () => {
    const recorded: ResultRow[][] = [];
    const accounts: Accounts = {
      publicConfig: { url: 'https://x.supabase.co', anonKey: 'anon' },
      verify: async (tok) => (tok === 'good' ? '22222222-2222-2222-2222-222222222222' : null),
      record: (r) => recorded.push(r),
    };
    const a2 = await createApp({ port: 0, accounts });
    try {
      const u = `http://localhost:${a2.port}`;
      expect(await (await fetch(`${u}/config.json`)).json()).toEqual({ supabase: { url: 'https://x.supabase.co', anonKey: 'anon' } });
      const mk = (accessToken?: string) =>
        new Promise<C>((res) => {
          const c: C = ioc(u, { transports: ['websocket'], forceNew: true, reconnection: false, auth: accessToken ? { accessToken } : {} });
          clients.push(c);
          c.on('connect', () => res(c));
        });
      const a = await mk('good');
      const b = await mk('bad');
      const ra = await create(a);
      if (!ra.ok) throw new Error('create');
      expect((await join(b, ra.code)).ok).toBe(true);
      const room = a2.rooms.rooms.get(ra.code)!;
      expect(room.seats.map((s) => s.userId)).toEqual(['22222222-2222-2222-2222-222222222222', null]);
    } finally {
      await a2.close();
    }
    // sin cuentas: configuración vacía
    expect(await (await fetch(`${url}/config.json`)).json()).toEqual({});
  });
});
