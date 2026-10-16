/**
 * Persistencia de salas para sobrevivir a reinicios y redespliegues del servidor.
 *
 * El servidor guarda cada sala poco después de cada cambio y, al apagarse (SIGTERM), todas.
 * Al reiniciar NO carga nada de golpe: recupera una sala cuando alguien intenta volver a ella
 * (así, en un redespliegue, el servidor nuevo lee lo último que guardó el viejo al apagarse).
 */

export interface StoredRoom {
  data: unknown;
  savedAt: number;
}

export interface RoomStore {
  load(code: string): Promise<StoredRoom | null>;
  save(code: string, data: unknown): Promise<void>;
  remove(code: string): Promise<void>;
  /** Borra salas guardadas hace más de `maxAgeMs`. */
  prune(maxAgeMs: number): Promise<void>;
}

/** En memoria (tests y desarrollo). Simula un reinicio si se comparte entre dos apps. */
export function memoryStore(): RoomStore & { rows: Map<string, StoredRoom> } {
  const rows = new Map<string, StoredRoom>();
  return {
    rows,
    async load(code) {
      const r = rows.get(code);
      return r ? { data: JSON.parse(JSON.stringify(r.data)), savedAt: r.savedAt } : null;
    },
    async save(code, data) {
      rows.set(code, { data: JSON.parse(JSON.stringify(data)), savedAt: Date.now() });
    },
    async remove(code) {
      rows.delete(code);
    },
    async prune(maxAgeMs) {
      const limit = Date.now() - maxAgeMs;
      for (const [k, v] of rows) if (v.savedAt < limit) rows.delete(k);
    },
  };
}

/** En Supabase (tabla `rooms_state`, solo accesible con la llave secreta del servidor). */
export function supabaseStore(env: NodeJS.ProcessEnv, log: (...a: unknown[]) => void = () => {}): RoomStore | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const base = `${url}/rest/v1/rooms_state`;
  const fail = (what: string) => async (res: Response) => {
    if (!res.ok) log(`[store] error al ${what}`, res.status, (await res.text()).slice(0, 200));
  };
  return {
    async load(code) {
      try {
        const res = await fetch(`${base}?select=data,saved_at&code=eq.${encodeURIComponent(code)}`, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          await fail('leer')(res);
          return null;
        }
        const rows = (await res.json()) as { data: unknown; saved_at: string }[];
        const r = rows[0];
        return r ? { data: r.data, savedAt: Date.parse(r.saved_at) } : null;
      } catch (e) {
        log('[store] no se pudo leer la sala', (e as Error).message);
        return null;
      }
    },
    async save(code, data) {
      await fetch(base, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ code, data, saved_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      })
        .then(fail('guardar'))
        .catch((e: Error) => log('[store] no se pudo guardar la sala', e.message));
    },
    async remove(code) {
      await fetch(`${base}?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) })
        .then(fail('borrar'))
        .catch((e: Error) => log('[store] no se pudo borrar la sala', e.message));
    },
    async prune(maxAgeMs) {
      const limit = new Date(Date.now() - maxAgeMs).toISOString();
      await fetch(`${base}?saved_at=lt.${encodeURIComponent(limit)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(8000) })
        .then(fail('limpiar'))
        .catch((e: Error) => log('[store] no se pudo limpiar', e.message));
    },
  };
}
