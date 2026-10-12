import { expect, test, type Browser, type Page } from '@playwright/test';

type View = {
  you: 0 | 1;
  turn: 0 | 1;
  status: string;
  rack: number[];
  table: { id: string; tiles: number[] }[];
  poolCount: number;
  players: { name: string; rackCount: number; connected: boolean }[];
};

async function player(browser: Browser, name: string, mobile: boolean): Promise<Page> {
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 760 } },
  );
  await ctx.addInitScript((n) => {
    localStorage.setItem('rummi.settings.v1', JSON.stringify({ tutorialDone: true, fullscreen: false, sound: false }));
    localStorage.setItem('rummi.profile.v1', JSON.stringify({ name: n, avatar: '🦊' }));
  }, name);
  return ctx.newPage();
}

const view = (p: Page) => p.evaluate(() => (window as unknown as { __rummi: { view(): View | null } }).__rummi.view());

async function dragRackTileToTable(p: Page) {
  const vp = p.viewportSize()!;
  const rackH = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rack-h')));
  const sx = 40, sy = vp.height - rackH + 40;
  const tx = vp.width / 2, ty = vp.height * 0.45;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) await p.mouse.move(sx + ((tx - sx) * k) / 12, sy + ((ty - sy) * k) / 12);
  await p.mouse.up();
}

test('dos jugadores: crear sala, unirse por link, jugar un turno y sincronizar', async ({ browser }) => {
  const A = await player(browser, 'Ana', true);
  const B = await player(browser, 'Beto', false);

  await A.goto('/');
  await A.click('#btn-create');
  await expect(A.locator('#lobby')).toBeVisible();
  const code = (await A.locator('#lobby-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // B entra con el link compartido
  await B.goto(`/?r=${code}`);
  await expect(A.locator('#hud')).toBeVisible();
  await expect(B.locator('#hud')).toBeVisible();
  await expect(A.locator('#opp-name')).toHaveText('Beto');
  await expect(B.locator('#opp-name')).toHaveText('Ana');

  let va = (await view(A))!;
  let vb = (await view(B))!;
  expect(va.status).toBe('playing');
  expect(va.rack).toHaveLength(14);
  expect(vb.rack).toHaveLength(14);
  expect(va.turn).toBe(vb.turn);
  expect(va.poolCount).toBe(78);
  // Anti-trampa: no se conocen las fichas del rival
  for (const t of vb.rack) expect(va.rack).not.toContain(t);

  const [cur, other] = va.turn === va.you ? [A, B] : [B, A];

  // Mover una ficha a la mesa: el rival la ve en tiempo real
  await dragRackTileToTable(cur);
  await expect.poll(async () => (await view(other))!.table.flatMap((m) => m.tiles).length).toBe(1);
  const played = (await view(cur))!.table[0]!.tiles[0]!;
  expect((await view(other))!.table[0]!.tiles).toEqual([played]);

  // Terminar turno con una combinación inválida: el servidor lo rechaza
  await cur.click('#act-end');
  await expect(cur.locator('.toast.error').first()).toBeVisible();

  // Deshacer (Z) devuelve la ficha y la mesa del rival se vacía
  await cur.keyboard.press('z');
  await expect.poll(async () => (await view(other))!.table.length).toBe(0);

  // Robar termina el turno
  await cur.click('#act-draw');
  await expect.poll(async () => (await view(other))!.poolCount).toBe(77);
  const vo = (await view(other))!;
  expect(vo.turn).toBe(vo.you);
  expect(vo.players[1 - vo.you]!.rackCount).toBe(15);
  await expect(other.locator('#turn-label')).toHaveClass(/mine/);

  // Chat
  await other.click('#btn-chat');
  await other.fill('#chat-input', 'hola!');
  await other.press('#chat-input', 'Enter');
  await expect(cur.locator('#chat-log')).toContainText('hola!');

  // Reconexión: recargar conserva el atril
  const before = [...(await view(other))!.rack].sort();
  await other.reload();
  await expect(other.locator('#hud')).toBeVisible();
  await expect.poll(async () => [...((await view(other))?.rack ?? [])].sort()).toEqual(before);
  await expect.poll(async () => (await view(cur))!.players.every((p) => p.connected)).toBe(true);
});

test('errores amigables: sala inexistente', async ({ browser }) => {
  const P = await player(browser, 'Cata', true);
  await P.goto('/?r=QQQQ');
  await expect(P.locator('.toast.error')).toBeVisible();
  await expect(P.locator('#menu')).toBeVisible();
});

test('práctica contra el bot arranca y el bot juega su turno', async ({ browser }) => {
  const P = await player(browser, 'Solo', true);
  await P.goto('/');
  await P.click('#btn-practice');
  await expect(P.locator('#hud')).toBeVisible();
  const v = (await view(P))!;
  expect(v.players[1]!.name).not.toBe('');
  // Yo empiezo en práctica: robo y el bot debe devolver el turno
  await P.click('#act-draw');
  await expect.poll(async () => (await view(P))!.turn, { timeout: 20_000 }).toBe(0);
});
