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
