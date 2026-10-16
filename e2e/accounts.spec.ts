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

/** Arranca el servidor del juego (también para simular un redespliegue). */
async function startServer() {
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
}

/** Apaga el servidor como Render en un redespliegue (SIGTERM) y espera a que termine. */
async function stopServer() {
  const s = srv;
  const done = new Promise((res) => s.once('exit', res));
  s.kill('SIGTERM');
  await done;
}

test.beforeAll(async () => {
  fake = await startFakeSupabase();
  await startServer();
});
test.afterAll(async () => {
  if (srv && srv.exitCode === null) await stopServer();
  fake?.server.close();
});

let ctx: BrowserContext;
const extra: BrowserContext[] = [];
test.afterEach(async () => {
  await ctx?.close();
  await Promise.all(extra.splice(0).map((c) => c.close()));
});

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
  // (la conexión de presencia ya lo verificó al abrir; el servidor lo guarda en caché)
  await P.click('#btn-create');
  await expect(P.locator('#lobby')).toBeVisible();
  await expect.poll(async () => (await state()).log.filter((l) => l.path === '/auth/v1/user' && l.method === 'GET').length).toBeGreaterThan(0);
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
  await P.locator('.modal [data-close]').first().click();
  await P.setViewportSize({ width: 844, height: 390 });
  await P.waitForTimeout(800);
  await P.screenshot({ path: 'test-results/menu-landscape.png' });
});

test('amigos: agregar por código, aceptar, ver en línea, invitar a la sala; logros e historial detallado', async ({ browser }) => {
  const mkPlayer = async (name: string, avatar: string, seedWin: boolean) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    extra.push(c);
    await c.addInitScript(
      ([n, a, win]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('rummi.settings.v1', JSON.stringify({ tutorialDone: true, fullscreen: false, sound: false }));
        localStorage.setItem('rummi.profile.v1', JSON.stringify({ name: n, avatar: a }));
        if (win) {
          const tt = { played: 1, won: 1, streak: 1, bestStreak: 1, bestPlay: 4, fastestWin: 500, tourneys: 0 };
          const z = { played: 0, won: 0, streak: 0, bestStreak: 0, bestPlay: 0, fastestWin: 0, tourneys: 0 };
          localStorage.setItem('rummi.stats.v1', JSON.stringify({ v: 1, records: [{ at: Date.now() - 5e5, mode: 'bot', level: 'normal', place: 1, players: 3, won: true, myPoints: 0, rivals: [{ name: 'Robo', avatar: '🤖', points: 22, place: 2, won: false }, { name: 'Byte', avatar: '👾', points: 31, place: 3, won: false }], durationSec: 500, bestPlay: 4, draws: 3 }], totals: { online: z, bot: tt } }));
        }
      },
      [name, avatar, seedWin] as const,
    );
    const p = await c.newPage();
    await p.goto(base);
    await expect(p.locator('#friends-chip')).toBeVisible({ timeout: 15_000 });
    return p;
  };
  const A = await mkPlayer('Ana', '🦊', true);
  const B = await mkPlayer('Beto', '🐼', false);
  const codeOf = async (name: string) => {
    let code = '';
    await expect.poll(async () => {
      const s = (await (await fetch(`http://localhost:${fake.port}/__state`)).json()) as { profiles: Record<string, { name: string; code: string }> };
      code = Object.values(s.profiles).find((p) => p.name === name)?.code ?? '';
      return code;
    }).not.toBe('');
    return code;
  };

  // B agrega a A con su código
  const aCode = await codeOf('Ana');
  await B.click('#friends-chip');
  await B.click('.friends-modal .stats-tabs button[data-v="add"]');
  await expect(B.locator('#fr-mycode')).toHaveText(await codeOf('Beto'));
  await B.fill('#fr-code', aCode.toLowerCase());
  await B.click('#fr-add-form button[type="submit"]');
  await expect(B.locator('#fr-msg')).toContainText('Solicitud enviada');
  await B.locator('.friends-modal [data-close]').click();

  // A ve la solicitud (globito) y la acepta
  await A.reload();
  await expect(A.locator('#friends-badge')).toHaveText('1', { timeout: 15_000 });
  await A.click('#friends-chip');
  await A.click('.friends-modal button[data-act="accept"]');
  await expect(A.locator('.friend-row')).toHaveCount(1);
  await expect(A.locator('.friend-row .presence.online')).toBeVisible({ timeout: 15_000 });
  await A.waitForTimeout(400);
  await A.screenshot({ path: 'test-results/friends-list.png' });
  await A.click('.friends-modal .stats-tabs button[data-v="ranking"]');
  await expect(A.locator('.rank-list li')).toHaveCount(2);
  await A.locator('.friends-modal [data-close]').click();

  // A crea una sala e invita a B, que recibe la invitación y entra
  await A.click('#btn-create');
  await expect(A.locator('#lobby')).toBeVisible();
  await A.click('#btn-invite-friends');
  await A.click('.friends-modal button[data-act="invite"]');
  await expect(A.locator('.friends-modal')).toContainText('Invitado');
  await expect(B.locator('#inv-join')).toBeVisible({ timeout: 10_000 });
  await B.waitForTimeout(500);
  await B.screenshot({ path: 'test-results/friends-invite.png' });
  await B.click('#inv-join');
  await expect(B.locator('#lobby')).toBeVisible();
  await expect(A.locator('#lobby-players')).toContainText('Beto');
  await A.locator('.friends-modal [data-close]').click();

  // Logros (deducidos de la victoria previa) e historial con detalle
  await A.click('#btn-lobby-leave');
  await A.click('#btn-stats');
  await A.click('.stats-modal .stats-tabs button[data-v="ach"]');
  await expect(A.locator('.ach-grid li.on')).toHaveCount(1);
  await expect(A.locator('.ach-count')).toContainText('1 de 15');
  await A.waitForTimeout(300);
  await A.screenshot({ path: 'test-results/achievements.png' });
  await A.click('.stats-modal .stats-tabs button[data-v="all"]');
  await A.click('.history > li >> nth=0');
  await expect(A.locator('.game-detail')).toContainText('Byte');
  await expect(A.locator('.game-detail')).toContainText('Fichas robadas');
  await A.waitForTimeout(300);
  await A.screenshot({ path: 'test-results/history-detail.png' });
});

test('redespliegue a mitad de partida: la sala se recupera y "Volver a tu partida" en el menú', async ({ browser }) => {
  const mk = async (name: string) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    extra.push(c);
    await c.addInitScript((n) => {
      localStorage.setItem('rummi.settings.v1', JSON.stringify({ tutorialDone: true, fullscreen: false, sound: false }));
      localStorage.setItem('rummi.profile.v1', JSON.stringify({ name: n, avatar: '🦊' }));
    }, name);
    const p = await c.newPage();
    await p.goto(base);
    await expect(p.locator('#menu')).toBeVisible();
    return p;
  };
  type V = { status: string; rack: number[]; turn: number; you: number; roomCode: string } | null;
  const view = (p: import('@playwright/test').Page) => p.evaluate(() => (window as unknown as { __rummi: { view(): V } }).__rummi.view());
  const A = await mk('Ana');
  const B = await mk('Beto');
  await A.click('#btn-create');
  await expect(A.locator('#lobby')).toBeVisible();
  const code = (await A.locator('#lobby-code').textContent())!.trim();
  await B.goto(`${base}/?r=${code}`);
  await expect(B.locator('#lobby')).toBeVisible();
  await A.click('#btn-start');
  await expect.poll(async () => (await view(A))?.status, { timeout: 15_000 }).toBe('playing');
  const rackA = (await view(A))!.rack;
  const turn = (await view(A))!.turn;
  await expect.poll(async () => Object.keys((await (await fetch(`http://localhost:${fake.port}/__state`)).json()).rooms)).toContain(code);

  // Redespliegue: el servidor se apaga (guarda la sala) y arranca otro sin nada en memoria
  await stopServer();
  await startServer();

  // Los jugadores reconectan solos y siguen en la misma partida con el mismo atril
  await expect.poll(async () => (await view(A))?.status, { timeout: 20_000 }).toBe('playing');
  await expect.poll(async () => [...((await view(A))?.rack ?? [])].sort().join(), { timeout: 20_000 }).toBe([...rackA].sort().join());
  expect((await view(A))!.turn).toBe(turn);
  await expect(A.locator('#act-draw')).toBeVisible();

  // B cerró la pestaña sin querer: al abrir el juego, el menú ofrece volver
  const rackB = (await view(B))!.rack;
  await B.goto(`${base}/`);
  await B.evaluate(() => history.replaceState(null, '', '/'));
  await B.reload();
  await expect(B.locator('#btn-resume')).toBeVisible({ timeout: 15_000 });
  await expect(B.locator('#btn-resume')).toContainText('Partida en curso');
  await B.waitForTimeout(300);
  await B.screenshot({ path: 'test-results/resume-button.png' });
  await B.click('#btn-resume');
  await expect.poll(async () => (await view(B))?.status, { timeout: 15_000 }).toBe('playing');
  expect([...(await view(B))!.rack].sort().join()).toBe([...rackB].sort().join());

});
