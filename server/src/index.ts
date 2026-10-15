import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAccounts } from './accounts.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const candidates = [process.env.STATIC_DIR, resolve(here, '../../client/dist'), resolve(here, '../public')].filter(Boolean) as string[];
const staticDir = process.env.SERVE_CLIENT === 'false' ? null : (candidates.find((d) => existsSync(resolve(d, 'index.html'))) ?? null);

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const accounts = supabaseAccounts(process.env, log);
const app = await createApp({ port, corsOrigins, staticDir, log, accounts });
console.log(`Rummi 3D server escuchando en :${app.port}${staticDir ? ` (sirviendo cliente desde ${staticDir})` : ''}${accounts ? ' · cuentas: Supabase' : ' · cuentas: desactivadas'}`);

const shutdown = async () => {
  console.log('Cerrando…');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
