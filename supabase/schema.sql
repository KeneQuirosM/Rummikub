-- Rummi 3D · esquema de cuentas y estadísticas.
-- Pegar completo en Supabase → SQL Editor → Run (se puede ejecutar varias veces).

-- Resultados: una fila por jugador con cuenta y partida terminada.
--  · Online: las escribe SOLO el servidor (llave service_role), así nadie puede inventarse victorias.
--  · Práctica (contra bots, corre en el teléfono): las escribe el propio jugador.
create table if not exists public.results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  played_at timestamptz not null default now(),
  mode text not null check (mode in ('online', 'bot')),
  level text check (level in ('easy', 'normal', 'hard')),
  place smallint not null check (place between 1 and 4),
  players smallint not null check (players between 2 and 4),
  won boolean not null,
  points integer not null check (points between 0 and 2000),
  rivals jsonb not null default '[]'::jsonb check (jsonb_typeof(rivals) = 'array' and octet_length(rivals::text) < 2000),
  duration_sec integer not null check (duration_sec between 0 and 86400),
  best_play smallint not null default 0 check (best_play between 0 and 106),
  champion boolean not null default false,
  best_of smallint not null default 1 check (best_of in (1, 3, 5))
);
create index if not exists results_user_played_idx on public.results (user_id, played_at desc);

-- v2: partida compartida (para ranking entre amigos y "jugaron juntos") y robos (logro "ganar sin robar")
alter table public.results add column if not exists game_id uuid;
alter table public.results add column if not exists draws smallint not null default 0;
create index if not exists results_game_idx on public.results (game_id) where game_id is not null;

alter table public.results enable row level security;

drop policy if exists "leer mis resultados" on public.results;
create policy "leer mis resultados" on public.results
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "anotar mis practicas" on public.results;
create policy "anotar mis practicas" on public.results
  for insert to authenticated with check (user_id = (select auth.uid()) and mode = 'bot');

-- Estadísticas que había en el teléfono antes de tener cuenta: se suben UNA sola vez por cuenta
-- (sin políticas de update/delete: no se pueden reescribir después).
create table if not exists public.legacy_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (octet_length(data::text) < 20000),
  imported_at timestamptz not null default now()
);

alter table public.legacy_stats enable row level security;

drop policy if exists "leer mi historial previo" on public.legacy_stats;
create policy "leer mi historial previo" on public.legacy_stats
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "subir mi historial previo" on public.legacy_stats;
create policy "subir mi historial previo" on public.legacy_stats
  for insert to authenticated with check (user_id = (select auth.uid()));

-- =====================================================================================
-- v2 · Amigos, perfiles públicos y ranking
-- Todo se modifica a través de funciones (RPC) que validan; las tablas solo se leen.
-- =====================================================================================

-- Perfil visible para tus amigos + código para agregarte
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Jugador' check (char_length(name) between 1 and 16),
  avatar text not null default '🙂' check (char_length(avatar) between 1 and 8),
  friend_code text not null unique check (friend_code ~ '^[A-Z2-9]{6}$'),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "leer mi perfil" on public.profiles;
create policy "leer mi perfil" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

-- Amistad simétrica: una fila por cada sentido (a→b y b→a)
create table if not exists public.friendships (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friendships enable row level security;
drop policy if exists "leer mis amistades" on public.friendships;
create policy "leer mis amistades" on public.friendships
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.friend_requests (
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists friend_requests_to_idx on public.friend_requests (to_id);
alter table public.friend_requests enable row level security;
drop policy if exists "leer mis solicitudes" on public.friend_requests;
create policy "leer mis solicitudes" on public.friend_requests
  for select to authenticated using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- Código de amigo de 6 caracteres sin letras ambiguas (sin 0/O/1/I/L)
create or replace function public.gen_friend_code() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end $$;

-- Crea o actualiza mi perfil (nombre y avatar) y devuelve mi código de amigo
create or replace function public.ensure_profile(p_name text, p_avatar text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  nm text := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g')), ''), 'Jugador'), 16);
  av text := case when char_length(coalesce(p_avatar, '')) between 1 and 8 and p_avatar !~ '[<>]' then p_avatar else '🙂' end;
  code text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.profiles (user_id, name, avatar, friend_code)
  values (me, nm, av, public.gen_friend_code())
  on conflict (user_id) do update set name = excluded.name, avatar = excluded.avatar, updated_at = now()
  returning friend_code into code;
  return code;
end $$;

-- Lógica común de solicitudes: si el otro ya me la había mandado, quedamos como amigos
create or replace function public._friend_request(me uuid, target uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if target is null then return 'not_found'; end if;
  if target = me then return 'self'; end if;
  if exists (select 1 from public.friendships where user_id = me and friend_id = target) then return 'already'; end if;
  if exists (select 1 from public.friend_requests where from_id = target and to_id = me) then
    insert into public.friendships (user_id, friend_id) values (me, target), (target, me) on conflict do nothing;
    delete from public.friend_requests where (from_id = target and to_id = me) or (from_id = me and to_id = target);
    return 'accepted';
  end if;
  if (select count(*) from public.friend_requests where from_id = me) >= 50 then return 'limit'; end if;
  insert into public.friend_requests (from_id, to_id) values (me, target) on conflict do nothing;
  return 'sent';
end $$;
revoke all on function public._friend_request(uuid, uuid) from public, anon, authenticated;

-- Agregar por código de amigo
create or replace function public.send_friend_request(p_code text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  return public._friend_request(me, (select user_id from public.profiles where friend_code = upper(btrim(p_code))));
end $$;

-- Agregar a alguien con quien ya jugaste una partida online (desde el historial)
create or replace function public.send_friend_request_to(p_user uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.results a join public.results b on a.game_id = b.game_id
    where a.user_id = me and b.user_id = p_user and a.game_id is not null
  ) then return 'not_allowed'; end if;
  return public._friend_request(me, p_user);
end $$;

create or replace function public.respond_friend_request(p_from uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.friend_requests where from_id = p_from and to_id = me) then return 'not_found'; end if;
  delete from public.friend_requests where from_id = p_from and to_id = me;
  if p_accept then
    insert into public.friendships (user_id, friend_id) values (me, p_from), (p_from, me) on conflict do nothing;
    return 'accepted';
  end if;
  return 'declined';
end $$;

-- Quitar amigo o cancelar una solicitud enviada
create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from public.friendships where (user_id = me and friend_id = p_user) or (user_id = p_user and friend_id = me);
  delete from public.friend_requests where from_id = me and to_id = p_user;
end $$;

-- Mis amigos y solicitudes (entrantes y enviadas) con nombre y avatar
create or replace function public.my_friends()
returns table (user_id uuid, name text, avatar text, status text, since timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.friend_id, coalesce(p.name, 'Jugador'), coalesce(p.avatar, '🙂'), 'friend', f.created_at
    from public.friendships f left join public.profiles p on p.user_id = f.friend_id
   where f.user_id = auth.uid()
  union all
  select r.from_id, coalesce(p.name, 'Jugador'), coalesce(p.avatar, '🙂'), 'incoming', r.created_at
    from public.friend_requests r left join public.profiles p on p.user_id = r.from_id
   where r.to_id = auth.uid()
  union all
  select r.to_id, coalesce(p.name, 'Jugador'), coalesce(p.avatar, '🙂'), 'outgoing', r.created_at
    from public.friend_requests r left join public.profiles p on p.user_id = r.to_id
   where r.from_id = auth.uid()
$$;

-- Ranking: yo y mis amigos. Cuentan solo las partidas online (las anota el servidor, no se pueden inventar).
-- "together" = partidas online que jugamos juntos y cuántas ganó cada uno.
create or replace function public.friends_leaderboard()
returns table (user_id uuid, name text, avatar text, is_me boolean, played integer, won integer,
               together integer, my_wins integer, their_wins integer)
language sql stable security definer set search_path = public, pg_temp as $$
  with people as (
    select auth.uid() as uid
    union
    select friend_id from public.friendships where user_id = auth.uid()
  ),
  totals as (
    select r.user_id, count(*)::int as played, count(*) filter (where r.won)::int as won
      from public.results r join people on people.uid = r.user_id
     where r.mode = 'online'
     group by r.user_id
  ),
  duel as (
    select o.user_id, count(*)::int as together,
           count(*) filter (where m.won)::int as my_wins,
           count(*) filter (where o.won)::int as their_wins
      from public.results m
      join public.results o on o.game_id = m.game_id and o.user_id <> m.user_id
      join people on people.uid = o.user_id
     where m.user_id = auth.uid() and m.game_id is not null
     group by o.user_id
  )
  select pe.uid, coalesce(p.name, 'Jugador'), coalesce(p.avatar, '🙂'), pe.uid = auth.uid(),
         coalesce(t.played, 0), coalesce(t.won, 0),
         coalesce(d.together, 0), coalesce(d.my_wins, 0), coalesce(d.their_wins, 0)
    from people pe
    left join public.profiles p on p.user_id = pe.uid
    left join totals t on t.user_id = pe.uid
    left join duel d on d.user_id = pe.uid
   where pe.uid is not null
   order by coalesce(t.won, 0) desc, coalesce(t.played, 0) asc, coalesce(p.name, '')
$$;

-- Solo usuarios con sesión (incluidas las anónimas) pueden llamar a las funciones
revoke all on function public.gen_friend_code() from public, anon;
revoke all on function public.ensure_profile(text, text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.send_friend_request_to(uuid) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.my_friends() from public, anon;
revoke all on function public.friends_leaderboard() from public, anon;
grant execute on function public.ensure_profile(text, text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.send_friend_request_to(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.friends_leaderboard() to authenticated;

-- =====================================================================================
-- v3 · Salas guardadas para sobrevivir a reinicios y redespliegues del servidor.
-- Solo el servidor (llave secreta) lee y escribe: RLS activado y sin políticas.
-- =====================================================================================
create table if not exists public.rooms_state (
  code text primary key check (code ~ '^[A-Z]{4}$'),
  data jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists rooms_state_saved_idx on public.rooms_state (saved_at);
alter table public.rooms_state enable row level security;
revoke all on public.rooms_state from anon, authenticated;
