import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type BrowserContext } from '@playwright/test';
// @ts-expect-error módulo JS de apoyo sin tipos
import { startFakeSupabase } from './support/fake-supabase.mjs';

// El juego con cuentas activadas, contra un Supabase falso (sin red externa)
const PORT = 4331;
let fake: { server: import('node:http').Server; port: number; SERVICE: string };
let srv: ChildProcess;
const base = `http://localhost:${PORT}`;
const state = async () => (await (await fetch(`http://localhost:${fake.port}/__state`)).json()) as {
  users: { id: string; user_metadata: Record<string, string>; new_email?: string }[];
  tables: { results: unknown[]; legacy_stats: { user_id: string; data: { totals: { bot: { won: number } } } }[] };
  log: { method: string; path: string }[];
};

test.beforeAll(async () => {
  fake = await startFakeSupabase();
  srv = spawn('node', ['server/dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SUPABASE_URL: `http://localhost:${fake.port}`,
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: fake.SERVICE,
    },
    stdio: 'inherit',
  });
  await expect.poll(async () => (await fetch(`${base}/healthz`).catch(() => null))?.ok ?? false, { timeout: 15_000 }).toBe(true);
});
test.afterAll(async () => {
  srv?.kill();
  fake?.server.close();
});

let ctx: BrowserContext;
test.afterEach(async () => ctx?.close());

test('cuenta anónima automática, historial previo subido una vez, servidor la reconoce y vincular por correo', async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('rummi.settings.v1', JSON.stringify({ tutorialDone: true, fullscreen: false, sound: false }));
    localStorage.setItem('rummi.profile.v1', JSON.stringify({ name: 'Kene', avatar: '🦊' }));
    const t = { played: 1, won: 1, streak: 1, bestStreak: 1, bestPlay: 5, fastestWin: 300, tourneys: 0 };
    const z = { played: 0, won: 0, streak: 0, bestStreak: 0, bestPlay: 0, fastestWin: 0, tourneys: 0 };
    localStorage.setItem('rummi.stats.v1', JSON.stringify({ v: 1, records: [{ at: Date.now() - 1e6, mode: 'bot', level: 'easy', place: 1, players: 2, won: true, myPoints: 0, rivals: [{ name: 'Bot', avatar: '🤖' }], durationSec: 300, bestPlay: 5 }], totals: { online: z, bot: t } }));
  });
  const P = await ctx.newPage();
  await P.goto(base);
  await expect(P.locator('#menu')).toBeVisible();

  // 1) Cuenta anónima creada, historial previo subido y perfil sincronizado
  await expect.poll(async () => (await state()).tables.legacy_stats.length, { timeout: 15_000 }).toBe(1);
  let s = await state();
  expect(s.users).toHaveLength(1);
  const uid = s.users[0]!.id;
  expect(s.tables.legacy_stats[0]!.data.totals.bot.won).toBe(1);
  await expect.poll(async () => (await state()).users[0]!.user_metadata.rummi_name).toBe('Kene');

  // Recargar no crea otra cuenta ni vuelve a subir el historial
  await P.reload();
  await expect(P.locator('#menu')).toBeVisible();
  await P.waitForTimeout(1500);
  s = await state();
  expect(s.users).toHaveLength(1);
  expect(s.tables.legacy_stats).toHaveLength(1);

  // 2) El servidor del juego verifica el token al conectar
  const before = s.log.filter((l) => l.path === '/auth/v1/user' && l.method === 'GET').length;
  await P.click('#btn-create');
  await expect(P.locator('#lobby')).toBeVisible();
  await expect.poll(async () => (await state()).log.filter((l) => l.path === '/auth/v1/user' && l.method === 'GET').length).toBeGreaterThan(before);
  await P.click('#btn-lobby-leave');

  // 3) Estadísticas desde la nube: historial previo + una partida online anotada por el servidor
  await fetch(`http://localhost:${fake.port}/__insert`, {
    method: 'POST',
    body: JSON.stringify({ user_id: uid, mode: 'online', level: null, place: 1, players: 3, won: true, points: 0, rivals: [{ name: 'Ana', avatar: '🐼' }, { name: 'Leo', avatar: '🐯' }], duration_sec: 420, best_play: 7, champion: false, best_of: 1 }),
  });
  await P.click('#btn-stats');
  await expect(P.locator('.stats-modal')).toContainText('Guardadas en tu cuenta');
  await expect(P.locator('.stats-grid .stat').first()).toContainText('2');
  await expect(P.locator('.history li')).toHaveCount(2);
  await expect(P.locator('#st-clear')).toHaveCount(0);
  await P.locator('.stats-modal [data-close]').click();

  // 4) Perfil: invitado → opciones de Google y correo; el correo se vincula a ESTA cuenta
  await P.click('#profile-chip');
  await expect(P.locator('#ac-google')).toBeVisible();
  await P.waitForTimeout(600);
  await P.screenshot({ path: 'test-results/account-profile.png' });
  await P.fill('#ac-email', 'kene@example.com');
  await P.click('#ac-email-send');
  await expect(P.locator('#ac-msg')).toContainText('kene@example.com');
  expect((await state()).users[0]!.new_email).toBe('kene@example.com');
});
