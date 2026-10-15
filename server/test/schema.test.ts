/**
 * El esquema de Supabase (supabase/schema.sql) contra un Postgres real en memoria (PGlite),
 * simulando auth.uid() y los roles de Supabase. Verifica RLS, amigos y ranking.
 */
import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';
const D = 'dddddddd-0000-0000-0000-000000000004';
let db: PGlite;

/** Ejecuta como el usuario `uid` (rol authenticated), igual que una petición de Supabase. */
async function as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
const rpc = async <T = unknown>(uid: string, sql: string, params: unknown[] = []) =>
  (await as(uid, (tx) => tx.query<T>(sql, params))).rows;
const one = async <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) => (await rpc<T>(uid, sql, params))[0]!;

/** Partida online anotada por el servidor (service_role = sin RLS). */
async function serverResult(gameId: string, rows: [string, boolean][]) {
  for (const [uid, won] of rows)
    await db.query(
      `insert into public.results (user_id, mode, place, players, won, points, rivals, duration_sec, best_play, game_id)
       values ($1, 'online', $2, $3, $4, 0, '[]', 60, 3, $5)`,
      [uid, won ? 1 : 2, rows.length, won, gameId],
    );
}

beforeAll(async () => {
  db = new PGlite();
  // Lo mínimo de Supabase: esquema auth, auth.uid() y los roles
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}');
  `);
  await db.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  // Supabase da estos permisos por defecto en public; RLS decide qué filas
  await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
  // El esquema debe poder ejecutarse dos veces sin errores (migraciones)
  await db.exec(readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
});

describe('esquema de Supabase', () => {
  it('perfil: código de amigo estable y nombre saneado', async () => {
    const { ensure_profile: code } = await one<{ ensure_profile: string }>(A, `select public.ensure_profile('  Ana <b>  ', '🦊')`);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const again = await one<{ ensure_profile: string }>(A, `select public.ensure_profile('Ana María de los Ángeles', '🐼')`);
    expect(again.ensure_profile).toBe(code);
    expect(await one(A, `select name, avatar from public.profiles`)).toEqual({ name: 'Ana María de los', avatar: '🐼' });
    for (const [u, n] of [[B, 'Beto'], [C, 'Caro'], [D, 'Dani']] as const) await rpc(u, `select public.ensure_profile($1, '🐯')`, [n]);
    // Solo veo mi perfil
    expect(await rpc(B, `select user_id from public.profiles`)).toEqual([{ user_id: B }]);
  });

  it('solicitudes por código: enviar, ver, aceptar al cruzarse, repetir y errores', async () => {
    const codeOf = async (u: string) => (await one<{ friend_code: string }>(u, `select friend_code from public.profiles`)).friend_code;
    const bCode = await codeOf(B);
    expect((await one(A, `select public.send_friend_request($1) as r`, [bCode.toLowerCase()])).r).toBe('sent');
    expect((await one(A, `select public.send_friend_request($1) as r`, [await codeOf(A)])).r).toBe('self');
    expect((await one(A, `select public.send_friend_request('ZZZZZZ') as r`)).r).toBe('not_found');
    expect(await rpc(B, `select user_id, name, status from public.my_friends()`)).toEqual([{ user_id: A, name: 'Ana María de los', status: 'incoming' }]);
    expect(await rpc(A, `select user_id, status from public.my_friends()`)).toEqual([{ user_id: B, status: 'outgoing' }]);
    // B también agrega a A por código: quedan como amigos
    expect((await one(B, `select public.send_friend_request($1) as r`, [await codeOf(A)])).r).toBe('accepted');
    expect(await rpc(A, `select user_id, status from public.my_friends()`)).toEqual([{ user_id: B, status: 'friend' }]);
    expect((await one(A, `select public.send_friend_request($1) as r`, [bCode])).r).toBe('already');
    // Aceptar / rechazar explícitamente
    await rpc(C, `select public.send_friend_request($1)`, [await codeOf(A)]);
    expect((await one(A, `select public.respond_friend_request($1, true) as r`, [C])).r).toBe('accepted');
    await rpc(D, `select public.send_friend_request($1)`, [await codeOf(A)]);
    expect((await one(A, `select public.respond_friend_request($1, false) as r`, [D])).r).toBe('declined');
    expect((await rpc(A, `select user_id from public.my_friends() order by name`)).map((r) => (r as { user_id: string }).user_id)).toEqual([B, C]);
  });

  it('no se puede escribir directo en amistades ni resultados online', async () => {
    await expect(as(D, (tx) => tx.query(`insert into public.friendships (user_id, friend_id) values ($1, $2)`, [D, A]))).rejects.toThrow();
    await expect(
      as(D, (tx) => tx.query(`insert into public.results (user_id, mode, place, players, won, points, duration_sec) values ($1, 'online', 1, 2, true, 0, 60)`, [D])),
    ).rejects.toThrow();
    // Práctica propia sí
    await as(D, (tx) => tx.query(`insert into public.results (user_id, mode, place, players, won, points, duration_sec) values ($1, 'bot', 1, 2, true, 0, 60)`, [D]));
    // …pero no a nombre de otro
    await expect(
      as(D, (tx) => tx.query(`insert into public.results (user_id, mode, place, players, won, points, duration_sec) values ($1, 'bot', 1, 2, true, 0, 60)`, [A])),
    ).rejects.toThrow();
    // Los invitados sin sesión no llaman funciones
    await expect(as(null, (tx) => tx.query(`select public.my_friends()`))).rejects.toThrow();
  });

  it('agregar desde el historial solo si jugaron juntos', async () => {
    expect((await one(D, `select public.send_friend_request_to($1) as r`, [B])).r).toBe('not_allowed');
    await serverResult('11111111-1111-1111-1111-111111111111', [[D, false], [B, true]]);
    expect((await one(D, `select public.send_friend_request_to($1) as r`, [B])).r).toBe('sent');
    expect((await one(D, `select public.remove_friend($1)`, [B]))).toBeDefined(); // cancela la solicitud
    expect(await rpc(B, `select * from public.my_friends() where status = 'incoming'`)).toEqual([]);
  });

  it('ranking: yo y mis amigos (no extraños), victorias online y cara a cara', async () => {
    await serverResult('22222222-2222-2222-2222-222222222222', [[A, true], [B, false], [C, false]]);
    await serverResult('33333333-3333-3333-3333-333333333333', [[A, false], [B, true]]);
    await serverResult('44444444-4444-4444-4444-444444444444', [[A, true], [C, false]]);
    // Práctica no cuenta
    await as(A, (tx) => tx.query(`insert into public.results (user_id, mode, place, players, won, points, duration_sec) values ($1, 'bot', 1, 2, true, 0, 60)`, [A]));
    const rows = await rpc<{ user_id: string; is_me: boolean; played: number; won: number; together: number; my_wins: number; their_wins: number }>(
      A,
      `select user_id, is_me, played, won, together, my_wins, their_wins from public.friends_leaderboard()`,
    );
    // B ganó 2 online (incluida la de D, que no es amigo de A pero B sí cuenta sus partidas)
    expect(rows).toEqual([
      { user_id: A, is_me: true, played: 3, won: 2, together: 0, my_wins: 0, their_wins: 0 },
      { user_id: B, is_me: false, played: 3, won: 2, together: 2, my_wins: 1, their_wins: 1 },
      { user_id: C, is_me: false, played: 2, won: 0, together: 2, my_wins: 2, their_wins: 0 },
    ].sort((x, y) => y.won - x.won || x.played - y.played));
    expect(rows.some((r) => r.user_id === D)).toBe(false);
    // Quitar amigo: desaparece para ambos
    await rpc(A, `select public.remove_friend($1)`, [C]);
    expect((await rpc(C, `select * from public.my_friends()`)).length).toBe(0);
  });
});
