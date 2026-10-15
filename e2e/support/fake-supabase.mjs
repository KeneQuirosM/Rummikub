// Supabase falso (solo para e2e): auth anónima, usuario, correo y dos tablas REST.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export function startFakeSupabase(port = 0) {
  const users = new Map(); // id -> user
  const tokens = new Map(); // token -> id
  const tables = { results: [], legacy_stats: [] };
  const profiles = new Map(); // id -> { name, avatar, code }
  const friends = new Set(); // "a|b" (ambos sentidos)
  const requests = new Set(); // "from|to"
  let codeSeq = 0;
  const codeOf = () => 'ABCDEFGHJK'.split('').map((c, i) => 'ABCDEFGHJKMNPQRSTUVWXYZ'[(codeSeq * 7 + i * 3) % 23]).join('').slice(0, 6) + (codeSeq++ ? '' : '');
  const friendReq = (me, target) => {
    if (!target) return 'not_found';
    if (target === me) return 'self';
    if (friends.has(`${me}|${target}`)) return 'already';
    if (requests.has(`${target}|${me}`)) {
      friends.add(`${me}|${target}`);
      friends.add(`${target}|${me}`);
      requests.delete(`${target}|${me}`);
      requests.delete(`${me}|${target}`);
      return 'accepted';
    }
    requests.add(`${me}|${target}`);
    return 'sent';
  };
  const prof = (id) => profiles.get(id) ?? { name: 'Jugador', avatar: '🙂' };
  const log = [];
  const SERVICE = 'service-secret';

  const session = (u) => {
    const tok = `tok-${u.id}-${Date.now()}`;
    tokens.set(tok, u.id);
    return { access_token: tok, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${tok}`, user: u };
  };
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const whoami = (req) => {
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (tok === SERVICE) return 'service';
    return tokens.has(tok) ? users.get(tokens.get(tok)) : null;
  };

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    log.push({ method: req.method, path: url.pathname, query: url.search });

    if (url.pathname === '/__state') return send(res, 200, { users: [...users.values()], tables, log, profiles: Object.fromEntries(profiles), friends: [...friends], requests: [...requests] });
    if (url.pathname === '/__insert' && req.method === 'POST') {
      tables.results.push({ ...json, played_at: new Date().toISOString() });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
      const u = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: '', is_anonymous: true, identities: [], user_metadata: json.data ?? {}, app_metadata: {}, created_at: new Date().toISOString() };
      users.set(u.id, u);
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const u = whoami(req);
      if (!u || u === 'service') return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid' });
      if (req.method === 'PUT') {
        if (json.data) u.user_metadata = { ...u.user_metadata, ...json.data };
        if (json.email) u.new_email = json.email;
      }
      return send(res, 200, u);
    }
    if (url.pathname === '/auth/v1/otp') return send(res, 200, {});
    if (url.pathname === '/auth/v1/logout') return send(res, 204);

    // Funciones (RPC) de amigos: misma lógica que supabase/schema.sql (probada aparte con Postgres)
    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpcMatch) {
      const u = whoami(req);
      if (!u || u === 'service') return send(res, 401, { message: 'no auth' });
      const me = u.id;
      switch (rpcMatch[1]) {
        case 'ensure_profile': {
          const p = profiles.get(me) ?? { code: codeOf() };
          profiles.set(me, { ...p, name: json.p_name, avatar: json.p_avatar });
          return send(res, 200, profiles.get(me).code);
        }
        case 'send_friend_request': {
          const target = [...profiles.entries()].find(([, p]) => p.code === String(json.p_code).toUpperCase())?.[0];
          return send(res, 200, friendReq(me, target));
        }
        case 'send_friend_request_to': {
          const together = tables.results.some((a) => a.user_id === me && a.game_id && tables.results.some((b) => b.user_id === json.p_user && b.game_id === a.game_id));
          return send(res, 200, together ? friendReq(me, json.p_user) : 'not_allowed');
        }
        case 'respond_friend_request': {
          if (!requests.delete(`${json.p_from}|${me}`)) return send(res, 200, 'not_found');
          if (json.p_accept) { friends.add(`${me}|${json.p_from}`); friends.add(`${json.p_from}|${me}`); }
          return send(res, 200, json.p_accept ? 'accepted' : 'declined');
        }
        case 'remove_friend':
          friends.delete(`${me}|${json.p_user}`); friends.delete(`${json.p_user}|${me}`); requests.delete(`${me}|${json.p_user}`);
          return send(res, 200, null);
        case 'my_friends': {
          const out = [];
          for (const k of friends) { const [a, b] = k.split('|'); if (a === me) out.push({ user_id: b, ...prof(b), status: 'friend' }); }
          for (const k of requests) {
            const [a, b] = k.split('|');
            if (b === me) out.push({ user_id: a, ...prof(a), status: 'incoming' });
            if (a === me) out.push({ user_id: b, ...prof(b), status: 'outgoing' });
          }
          return send(res, 200, out.map(({ code, ...x }) => x));
        }
        case 'friends_leaderboard': {
          const people = [me, ...[...friends].map((k) => k.split('|')).filter(([a]) => a === me).map(([, b]) => b)];
          const rows = people.map((id) => {
            const mine = tables.results.filter((r) => r.user_id === id && r.mode === 'online');
            return { user_id: id, name: prof(id).name, avatar: prof(id).avatar, is_me: id === me, played: mine.length, won: mine.filter((r) => r.won).length, together: 0, my_wins: 0, their_wins: 0 };
          });
          return send(res, 200, rows.sort((a, b) => b.won - a.won));
        }
      }
      return send(res, 404, { message: 'no rpc' });
    }
    if (url.pathname === '/rest/v1/friendships') {
      if (whoami(req) !== 'service') return send(res, 401, {});
      const a = url.searchParams.get('user_id')?.replace(/^eq\./, '');
      const b = url.searchParams.get('friend_id')?.replace(/^eq\./, '');
      return send(res, 200, friends.has(`${a}|${b}`) ? [{ user_id: a }] : []);
    }

    const m = url.pathname.match(/^\/rest\/v1\/(results|legacy_stats)$/);
    if (m) {
      const who = whoami(req);
      if (!who) return send(res, 401, { message: 'no auth' });
      const rows = tables[m[1]];
      if (req.method === 'POST') {
        const list = Array.isArray(json) ? json : [json];
        for (const r of list) {
          if (who !== 'service' && r.user_id !== who.id) return send(res, 403, { message: 'RLS' });
          if (m[1] === 'legacy_stats' && rows.some((x) => x.user_id === r.user_id)) return send(res, 409, { code: '23505', message: 'duplicate' });
          rows.push({ ...r, played_at: new Date().toISOString() });
        }
        return send(res, 201);
      }
      // GET: filtro user_id=eq.X (y RLS: solo lo propio)
      const uid = url.searchParams.get('user_id')?.replace(/^eq\./, '');
      const out = rows.filter((r) => r.user_id === uid && (who === 'service' || r.user_id === who.id));
      if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
        if (out.length === 1) return send(res, 200, out[0]);
        return send(res, 406, { code: 'PGRST116', message: 'no rows', details: 'Results contain 0 rows' });
      }
      return send(res, 200, out);
    }
    send(res, 404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, SERVICE })));
}
