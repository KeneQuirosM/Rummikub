// Supabase falso (solo para e2e): auth anónima, usuario, correo y dos tablas REST.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export function startFakeSupabase(port = 0) {
  const users = new Map(); // id -> user
  const tokens = new Map(); // token -> id
  const tables = { results: [], legacy_stats: [] };
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

    if (url.pathname === '/__state') return send(res, 200, { users: [...users.values()], tables, log });
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
