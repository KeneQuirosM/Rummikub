import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

type View = {
  you: 0 | 1;
  turn: 0 | 1;
  status: string;
  rack: number[];
  table: { id: string; tiles: number[] }[];
  poolCount: number;
  players: { name: string; rackCount: number; connected: boolean }[];
};

// Cada test cierra sus navegadores: si quedan abiertos animando la escena 3D (WebGL por software)
// le roban CPU al siguiente test.
const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((c) => c.close()));
});

async function player(browser: Browser, name: string, mobile: boolean): Promise<Page> {
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 760 } },
  );
  await ctx.addInitScript((n) => {
    localStorage.setItem('rummi.settings.v1', JSON.stringify({ tutorialDone: true, fullscreen: false, sound: false }));
    localStorage.setItem('rummi.profile.v1', JSON.stringify({ name: n, avatar: '🦊' }));
  }, name);
  openContexts.push(ctx);
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

  // B entra con el link compartido y A (anfitrión) empieza
  await B.goto(`/?r=${code}`);
  await expect(A.locator('#lobby-players li:not(.empty)')).toHaveCount(2, { timeout: 30_000 });
  await expect(B.locator('#btn-start')).toBeHidden();
  await A.click('#btn-start');
  // La primera escena 3D compila shaders (lento con WebGL por software en CI)
  await expect(A.locator('#hud')).toBeVisible({ timeout: 30_000 });
  await expect(B.locator('#hud')).toBeVisible({ timeout: 30_000 });
  await expect(A.locator('#opps .opp-name')).toHaveText('Beto');
  await expect(B.locator('#opps .opp-name')).toHaveText('Ana');

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
  await P.click('.bots-pick button[data-n="1"]');
  await expect(P.locator('#hud')).toBeVisible();
  const v = (await view(P))!;
  expect(v.players[1]!.name).not.toBe('');
  // Yo empiezo en práctica: robo y el bot debe devolver el turno
  await P.click('#act-draw');
  await expect.poll(async () => (await view(P))!.turn, { timeout: 20_000 }).toBe(0);
});

test('tres jugadores en la misma mesa: turnos rotativos y sincronización', async ({ browser }) => {
  const A = await player(browser, 'Ana', true);
  const B = await player(browser, 'Beto', false);
  const C = await player(browser, 'Cata', true);
  await A.goto('/');
  await A.click('#btn-create');
  await expect(A.locator('#lobby')).toBeVisible();
  const code = (await A.locator('#lobby-code').textContent())!.trim();
  await B.goto(`/?r=${code}`);
  await expect(B.locator('#lobby')).toBeVisible({ timeout: 30_000 });
  await C.goto(`/?r=${code}`);
  await expect(C.locator('#lobby')).toBeVisible({ timeout: 30_000 });
  await expect(A.locator('#lobby-players li:not(.empty)')).toHaveCount(3);
  await expect(A.locator('#btn-start')).toContainText('3/4');
  await A.click('#btn-start');
  for (const p of [A, B, C]) await expect(p.locator('#hud')).toBeVisible({ timeout: 30_000 });
  for (const p of [A, B, C]) await expect(p.locator('#opps .opp')).toHaveCount(2);

  const pages = [A, B, C];
  const views = await Promise.all(pages.map(view));
  expect(new Set(views.map((v) => v!.you)).size).toBe(3);
  for (const v of views) {
    expect(v!.players).toHaveLength(3);
    expect(v!.rack).toHaveLength(14);
    expect(v!.poolCount).toBe(64);
  }
  // Nadie ve fichas de otro
  expect(new Set(views.flatMap((v) => v!.rack)).size).toBe(42);

  // Tres turnos seguidos: cada uno roba y el turno rota por los 3 asientos
  const seen: number[] = [];
  for (let k = 0; k < 3; k++) {
    const v0 = (await view(A))!;
    seen.push(v0.turn);
    const cur = pages[views.findIndex((v) => v!.you === v0.turn)]!;
    await cur.click('#act-draw');
    await expect.poll(async () => (await view(A))!.poolCount).toBe(64 - (k + 1));
  }
  expect(new Set(seen).size).toBe(3);
  // Todos terminan viendo lo mismo
  await expect
    .poll(async () => {
      const after = await Promise.all(pages.map(view));
      return new Set(after.map((v) => v!.turn)).size === 1 && after.every((v) => v!.players.every((p) => p.rackCount === 15));
    })
    .toBe(true);
});

test('girar el celular (vertical ↔ horizontal) no deja botones encima del atril', async ({ browser }) => {
  const P = await player(browser, 'Giro', true);
  await P.setViewportSize({ width: 390, height: 664 });
  await P.goto('/');
  await P.click('#btn-practice');
  await P.click('.bots-pick button[data-n="2"]');
  await expect(P.locator('#hud')).toBeVisible();
  const layoutProblems = () =>
    P.evaluate(() => {
      const w = window as unknown as { __rummi: { rackH(): number | null } };
      const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rack-h'));
      const rackH = w.__rummi.rackH()!;
      const rackTop = innerHeight - rackH;
      const out: string[] = [];
      if (Math.abs(css - rackH) > 1) out.push(`--rack-h ${css} != ${rackH}`);
      for (const id of ['act-undo', 'act-sort', 'act-draw', 'act-end', 'turn']) {
        const b = document.getElementById(id)!.getBoundingClientRect();
        if (b.bottom > rackTop + 1) out.push(`${id} sobre el atril`);
        if (b.right > innerWidth || b.left < 0 || b.top < 0) out.push(`${id} fuera de pantalla`);
      }
      return out;
    });
  for (const size of [
    { width: 844, height: 340 },
    { width: 390, height: 664 },
    { width: 932, height: 380 },
    { width: 430, height: 740 },
  ]) {
    await P.setViewportSize(size);
    await expect.poll(layoutProblems, { timeout: 5_000 }).toEqual([]);
  }
});
