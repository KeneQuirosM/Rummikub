import { DEFAULT_TURN_SECONDS, MAX_NAME_LENGTH } from '@rummi/shared';
import type { Lang } from './i18n';

export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  lang: Lang;
  sound: boolean;
  vibration: boolean;
  symbols: boolean;
  quality: QualitySetting;
  turnSeconds: number;
  fullscreen: boolean;
  tutorialDone: boolean;
  sortMode: 'color' | 'number';
  botLevel: 'easy' | 'normal' | 'hard';
}

export interface Profile {
  name: string;
  avatar: string;
}

export const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐙', '🐧', '🦄', '🐨', '🐶', '🐱'];

const SETTINGS_KEY = 'rummi.settings.v1';
const PROFILE_KEY = 'rummi.profile.v1';
const SESSION_KEY = 'rummi.sessions.v1';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
}

const defaults: Settings = {
  lang: 'es',
  sound: true,
  vibration: true,
  symbols: false,
  quality: 'auto',
  turnSeconds: DEFAULT_TURN_SECONDS,
  fullscreen: true,
  tutorialDone: false,
  sortMode: 'color',
  botLevel: 'normal',
};

export const settings: Settings = load(SETTINGS_KEY, defaults);
const settingsListeners = new Set<(s: Settings) => void>();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  save(SETTINGS_KEY, settings);
  settingsListeners.forEach((f) => f(settings));
}

export function onSettingsChange(f: (s: Settings) => void): () => void {
  settingsListeners.add(f);
  return () => settingsListeners.delete(f);
}

function randomName(): string {
  const n = Math.floor(100 + Math.random() * 900);
  return `Jugador ${n}`;
}

export const profile: Profile = load(PROFILE_KEY, {
  name: randomName(),
  avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)]!,
});
save(PROFILE_KEY, profile);

export function updateProfile(p: Partial<Profile>): void {
  if (p.name !== undefined) p.name = p.name.trim().slice(0, MAX_NAME_LENGTH) || profile.name;
  Object.assign(profile, p);
  save(PROFILE_KEY, profile);
}

/** Tokens de sesión por sala, para reconectar sin perder el atril. */
export function getSessionToken(code: string): string | undefined {
  const all = load<Record<string, { token: string; at: number }>>(SESSION_KEY, {});
  return all[code]?.token;
}

export function setSessionToken(code: string, token: string): void {
  const all = load<Record<string, { token: string; at: number }>>(SESSION_KEY, {});
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - v.at > 1000 * 60 * 60 * 24) delete all[k];
  all[code] = { token, at: now };
  save(SESSION_KEY, all);
}

export function getLastRoom(): string | undefined {
  try {
    return sessionStorage.getItem('rummi.lastRoom') ?? undefined;
  } catch {
    return undefined;
  }
}

export function setLastRoom(code: string | null): void {
  try {
    if (code) sessionStorage.setItem('rummi.lastRoom', code);
    else sessionStorage.removeItem('rummi.lastRoom');
  } catch {
    /* noop */
  }
}
