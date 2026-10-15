/**
 * Cuentas con Supabase (opcionales: solo si el servidor publica la configuración en /config.json).
 *
 *  - Al abrir el juego se crea una cuenta ANÓNIMA automáticamente (sin registrarse).
 *  - "Guardar mi progreso": vincula esa cuenta a Google o a un correo (enlace mágico) sin perder nada.
 *  - En otro dispositivo, entrar con Google o con el correo recupera la cuenta.
 *  - Las partidas online las anota el servidor; las de práctica, el propio cliente.
 *  - Las estadísticas que ya había en el teléfono se suben una sola vez por cuenta.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { profile, updateProfile } from './settings';
import { applyRecord, emptyStats, loadStats, normalizeStats, onRecord, setRemoteStatsSource, type GameRecord, type StatsData } from './stats';

const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

export interface AccountUser {
  id: string;
  anonymous: boolean;
  email: string | null;
  /** Proveedores vinculados (google, email…). */
  providers: string[];
}

export interface AccountState {
  /** El servidor tiene cuentas configuradas. */
  enabled: boolean;
  user: AccountUser | null;
}

interface ResultRow {
  played_at: string;
  mode: 'online' | 'bot';
  level: 'easy' | 'normal' | 'hard' | null;
  place: number;
  players: number;
  won: boolean;
  points: number;
  rivals: { name: string; avatar: string }[];
  duration_sec: number;
  best_play: number;
  champion: boolean;
}

const STATS_CACHE_KEY = 'rummi.cloudStats.v1';
const LAST_USER_KEY = 'rummi.account.lastUser';
const PENDING_KEY = 'rummi.account.pending';

let sb: SupabaseClient | null = null;
let session: Session | null = null;
let state: AccountState = { enabled: false, user: null };
let cloud: { userId: string; data: StatsData } | null = null;
/** Último usuario ya procesado (perfil, historial previo, estadísticas). */
let handledUser: string | null = null;
const listeners = new Set<(s: AccountState) => void>();
let readyResolve: () => void = () => {};
const ready = new Promise<void>((r) => (readyResolve = r));

export const accountState = (): AccountState => state;

export function onAccountChange(f: (s: AccountState) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Token de acceso actual (para identificarse ante el servidor del juego). */
export const accessToken = (): string | null => session?.access_token ?? null;

/** Espera a que la cuenta esté lista (como mucho `ms`), para no conectar sin identidad. */
export function accountReady(ms = 2500): Promise<void> {
  return Promise.race([ready, new Promise<void>((r) => setTimeout(r, ms))]);
}

function emit() {
  listeners.forEach((f) => f(state));
}

function store(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* modo privado */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Error que vuelve en la URL tras un intento de vincular (p. ej. esa cuenta de Google ya existe). */
function takeRedirectError(): string | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const code = params.get('error_code') ?? q.get('error_code');
  if (!code) return null;
  // Limpiar la URL sin perder la sala
  const url = new URL(location.href);
  url.hash = '';
  for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k);
  history.replaceState(null, '', url);
  return code;
}

export async function initAccount(): Promise<void> {
  try {
    const redirectError = takeRedirectError();
    const res = await fetch(`${SERVER_URL ?? ''}/config.json`, { cache: 'no-store' }).catch(() => null);
    const cfg = res?.ok ? ((await res.json().catch(() => ({}))) as { supabase?: { url: string; anonKey: string } }) : {};
    if (!cfg.supabase?.url || !cfg.supabase.anonKey) return;
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(cfg.supabase.url, cfg.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'rummi.auth' },
    });
    state = { enabled: true, user: null };
    setRemoteStatsSource(() => (cloud && cloud.userId === state.user?.id ? cloud.data : null));
    onRecord((r) => void recordGame(r));

    sb.auth.onAuthStateChange((_ev, s) => {
      session = s;
      // No llamar a Supabase dentro del callback (bloquea); diferirlo
      setTimeout(() => void onUser(), 0);
    });
    const { data } = await sb.auth.getSession();
    session = data.session;

    // Ese Google/correo ya tenía cuenta propia: entrar en ella (la anónima de este teléfono se deja)
    const pending = read(PENDING_KEY);
    store(PENDING_KEY, null);
    if (redirectError && pending === 'google' && /identity_already_exists|already/.test(redirectError)) {
      await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
      return;
    }
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      session = r.data.session;
    }
    await onUser();
  } catch (e) {
    console.warn('[cuenta] no disponible', e);
  } finally {
    readyResolve();
    emit();
  }
}

function setUser() {
  const u = session?.user;
  state = {
    enabled: !!sb,
    user: u
      ? {
          id: u.id,
          anonymous: !!u.is_anonymous,
          email: u.email ?? null,
          providers: (u.identities ?? []).map((i) => i.provider).filter((p) => p !== 'anonymous'),
        }
      : null,
  };
}

/** Cambió el usuario (arranque, inicio de sesión, vinculación o cierre de sesión). */
async function onUser() {
  setUser();
  emit();
  const u = session?.user;
  if (!sb || !u || u.id === handledUser) return;
  handledUser = u.id;
  // Perfil: en un dispositivo nuevo se recupera el nombre y avatar de la cuenta; si no, se sube el local
  const meta = (u.user_metadata ?? {}) as { rummi_name?: string; rummi_avatar?: string };
  const isNewHere = read(LAST_USER_KEY) !== u.id;
  store(LAST_USER_KEY, u.id);
  if (isNewHere && meta.rummi_name) {
    updateProfile({ name: meta.rummi_name, ...(meta.rummi_avatar ? { avatar: meta.rummi_avatar } : {}) });
    emit();
  } else if (meta.rummi_name !== profile.name || meta.rummi_avatar !== profile.avatar) void syncProfile();
  // Estadísticas: caché inmediata y luego la nube
  try {
    const c = JSON.parse(read(STATS_CACHE_KEY) ?? 'null') as { userId: string; data: unknown } | null;
    if (c?.userId === u.id) cloud = { userId: u.id, data: normalizeStats(c.data) };
  } catch {
    /* caché corrupta */
  }
  await importLegacy(u.id);
  await refreshStats();
}

/** Sube el nombre y avatar a la cuenta (para recuperarlos en otro dispositivo). */
export async function syncProfile(): Promise<void> {
  if (!sb || !session) return;
  await sb.auth.updateUser({ data: { rummi_name: profile.name, rummi_avatar: profile.avatar } }).catch(() => {});
}

/** Primera vez que esta cuenta se usa en la nube: subir lo que ya había en el teléfono (una sola vez). */
async function importLegacy(userId: string) {
  if (!sb) return;
  const { data, error } = await sb.from('legacy_stats').select('user_id').eq('user_id', userId).maybeSingle();
  if (error || data) return;
  await sb.from('legacy_stats').insert({ user_id: userId, data: loadStats() });
}

/** Recalcula las estadísticas desde la nube: historial previo + todas las partidas de la cuenta. */
export async function refreshStats(): Promise<void> {
  const u = session?.user;
  if (!sb || !u) return;
  const [legacy, results] = await Promise.all([
    sb.from('legacy_stats').select('data').eq('user_id', u.id).maybeSingle(),
    sb
      .from('results')
      .select('played_at,mode,level,place,players,won,points,rivals,duration_sec,best_play,champion')
      .eq('user_id', u.id)
      .order('played_at', { ascending: true })
      .limit(2000),
  ]);
  if (results.error) return;
  const d = legacy.data ? normalizeStats((legacy.data as { data: unknown }).data) : emptyStats();
  for (const r of (results.data ?? []) as ResultRow[]) applyRecord(d, toRecord(r));
  cloud = { userId: u.id, data: d };
  store(STATS_CACHE_KEY, JSON.stringify(cloud));
  emit();
}

function toRecord(r: ResultRow): GameRecord {
  return {
    at: Date.parse(r.played_at),
    mode: r.mode,
    ...(r.level ? { level: r.level } : {}),
    place: r.place,
    players: r.players,
    won: r.won,
    myPoints: r.points,
    rivals: Array.isArray(r.rivals) ? r.rivals : [],
    durationSec: r.duration_sec,
    bestPlay: r.best_play,
    ...(r.champion ? { champion: true } : {}),
  };
}

/** Partida terminada: se refleja al instante y se confirma con la nube. */
async function recordGame(r: GameRecord) {
  const u = session?.user;
  if (!sb || !u) return;
  if (cloud?.userId === u.id) {
    applyRecord(cloud.data, r);
    store(STATS_CACHE_KEY, JSON.stringify(cloud));
    emit();
  }
  if (r.mode === 'bot') {
    await sb.from('results').insert({
      user_id: u.id,
      mode: 'bot',
      level: r.level ?? null,
      place: r.place,
      players: r.players,
      won: r.won,
      points: Math.min(2000, r.myPoints),
      rivals: r.rivals.slice(0, 3),
      duration_sec: Math.min(86400, r.durationSec),
      best_play: Math.min(106, r.bestPlay),
      champion: !!r.champion,
    });
  }
  // La partida online la anota el servidor: releer un poco después
  setTimeout(() => void refreshStats(), r.mode === 'online' ? 4000 : 500);
}

function returnUrl(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

/** Guardar progreso / entrar con Google. Con cuenta anónima se vincula (conserva todo). */
export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  if (!sb) return { ok: false };
  store(PENDING_KEY, 'google');
  const opts = { provider: 'google' as const, options: { redirectTo: returnUrl() } };
  const r = session?.user.is_anonymous ? await sb.auth.linkIdentity(opts) : await sb.auth.signInWithOAuth(opts);
  if (r.error) {
    store(PENDING_KEY, null);
    // Vinculación manual desactivada en Supabase: entrar con Google directamente
    if (session?.user.is_anonymous) {
      const r2 = await sb.auth.signInWithOAuth(opts);
      if (!r2.error) return { ok: true };
    }
    return { ok: false, error: r.error.message };
  }
  return { ok: true };
}

/**
 * Enlace por correo. Con cuenta anónima, el correo se añade a ESTA cuenta (al confirmar queda guardada);
 * si ese correo ya tiene cuenta, se envía un enlace para entrar en ella.
 */
export async function signInWithEmail(email: string): Promise<{ ok: boolean; mode?: 'link' | 'login'; error?: string }> {
  if (!sb) return { ok: false };
  const redirect = returnUrl();
  if (session?.user.is_anonymous) {
    const r = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect });
    if (!r.error) return { ok: true, mode: 'link' };
    if (!/exist|registered|already/i.test(r.error.message) && r.error.code !== 'email_exists') return { ok: false, error: r.error.message };
  }
  const r = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  return r.error ? { ok: false, error: r.error.message } : { ok: true, mode: 'login' };
}

/** Cerrar sesión: se vuelve a una cuenta anónima nueva (el progreso queda en la cuenta). */
export async function signOut(): Promise<void> {
  if (!sb) return;
  await sb.auth.signOut();
  cloud = null;
  handledUser = null;
  store(STATS_CACHE_KEY, null);
  const r = await sb.auth.signInAnonymously();
  session = r.data.session;
  await onUser();
}
