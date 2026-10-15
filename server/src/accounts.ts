/**
 * Cuentas (opcional) con Supabase: el servidor verifica quién es cada jugador y anota
 * los resultados de las partidas online. Sin variables de entorno, todo sigue funcionando
 * como antes (estadísticas solo en el teléfono).
 *
 * Variables: SUPABASE_URL, SUPABASE_ANON_KEY (pública) y SUPABASE_SERVICE_ROLE_KEY (secreta).
 */

/** Fila de la tabla `results` (una por jugador con cuenta y partida terminada). */
export interface ResultRow {
  user_id: string;
  mode: 'online' | 'bot';
  level?: string | null;
  place: number;
  players: number;
  won: boolean;
  points: number;
  rivals: { name: string; avatar: string; user_id?: string; points?: number; place?: number; won?: boolean; bot?: boolean }[];
  duration_sec: number;
  best_play: number;
  champion: boolean;
  best_of: number;
  game_id?: string | null;
  draws?: number;
}

export interface Accounts {
  /** Datos públicos para el cliente (URL + llave anónima). */
  publicConfig: { url: string; anonKey: string };
  /** Devuelve el id de usuario del token de acceso, o null si no es válido. */
  verify(accessToken: string): Promise<string | null>;
  /** Guarda resultados (sin esperar; los errores solo se registran). */
  record(rows: ResultRow[]): void;
  /** ¿Son amigos? (para permitir invitaciones directas) */
  areFriends(a: string, b: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseAccounts(env: NodeJS.ProcessEnv, log: (...a: unknown[]) => void = () => {}): Accounts | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey) return null;

  // Caché corta de tokens ya verificados (cada reconexión vuelve a enviar el token)
  const cache = new Map<string, { id: string | null; until: number }>();

  return {
    publicConfig: { url, anonKey },
    async verify(token) {
      if (!token || token.length > 4096) return null;
      const now = Date.now();
      const hit = cache.get(token);
      if (hit && hit.until > now) return hit.id;
      let id: string | null = null;
      try {
        const res = await fetch(`${url}/auth/v1/user`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const u = (await res.json()) as { id?: unknown };
          if (typeof u.id === 'string' && UUID.test(u.id)) id = u.id;
        }
      } catch (e) {
        log('[accounts] no se pudo verificar el token', (e as Error).message);
        return null; // sin caché: reintentar en la próxima conexión
      }
      if (cache.size > 5000) cache.clear();
      cache.set(token, { id, until: now + 5 * 60_000 });
      return id;
    },
    record(rows) {
      if (!rows.length) return;
      fetch(`${url}/rest/v1/results`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (res) => {
          if (!res.ok) log('[accounts] error guardando resultados', res.status, (await res.text()).slice(0, 300));
        })
        .catch((e: Error) => log('[accounts] error guardando resultados', e.message));
    },
    async areFriends(a, b) {
      if (!UUID.test(a) || !UUID.test(b)) return false;
      try {
        const res = await fetch(`${url}/rest/v1/friendships?select=user_id&user_id=eq.${a}&friend_id=eq.${b}&limit=1`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
          signal: AbortSignal.timeout(5000),
        });
        return res.ok && ((await res.json()) as unknown[]).length > 0;
      } catch (e) {
        log('[accounts] no se pudo comprobar la amistad', (e as Error).message);
        return false;
      }
    },
  };
}
