import './styles.css';
import { MAX_PLAYERS, ROOM_CODE_REGEX, type PlayerView } from '@rummi/shared';
import { unlockAudio } from './audio';
import { applyI18n, setLang, t } from './i18n';
import type { Transport } from './net/transport';
import { getSessionToken, onSettingsChange, profile, settings, updateSettings } from './settings';
import { GameStatsTracker } from './stats';
import { $, banner, closeAllModals, confirmDialog, escapeHtml, modal, show, toast } from './ui/dom';
import { openHowTo, openJoin, openProfile, openSettings } from './ui/menus';
import type { Engine } from './three/engine';
import type { BoardScene } from './three/board';
import type { GameController } from './game/controller';
import type { GameHud } from './ui/hud';
import type { SocketTransport } from './net/socket';

// ------------------------------------------------------------------ carga

const progressEl = $('ld-progress');
function progress(p: number, text?: string) {
  progressEl.style.width = `${Math.round(p * 100)}%`;
  if (text) $('ld-text').textContent = text;
}

let engine: Engine;
let homeSceneCtor: typeof import('./three/home').HomeScene;

interface Session {
  transport: Transport;
  board: BoardScene;
  ctl: GameController;
  hud: GameHud;
  offs: (() => void)[];
  endTutorial?: () => void;
}
let session: Session | null = null;
let wakeLock: WakeLockSentinel | null = null;
let pendingSocket: SocketTransport | null = null;

async function boot() {
  setLang(settings.lang);
  applyI18n(document.body);
  progress(0.1, t('loading'));
  unlockAudio();
  setupConnectivityBanner();
  registerServiceWorker();

  const [engineMod, homeMod] = await Promise.all([
    import('./three/engine').then((m) => (progress(0.6), m)),
    import('./three/home').then((m) => (progress(0.75), m)),
  ]);
  homeSceneCtor = homeMod.HomeScene;
  engine = new engineMod.Engine($<HTMLCanvasElement>('scene'));
  progress(0.9);
  engine.setScene(new homeSceneCtor(engine));
  onSettingsChange((s) => {
    engine.applyQualitySetting(s.quality);
  });
  let symbols = settings.symbols, back = settings.backTheme, table = settings.tableTheme;
  onSettingsChange((s) => {
    if (s.symbols !== symbols || s.backTheme !== back) {
      symbols = s.symbols;
      back = s.backTheme;
      engine.rebuildAtlas();
    }
    if (s.tableTheme !== table) {
      table = s.tableTheme;
      engine.setTableTheme(s.tableTheme);
    }
  });
  bindMenu();
  progress(1);
  // Precargar en segundo plano el módulo de juego
  void import('./game/session-modules');
  requestAnimationFrame(() => $('loading').classList.add('done'));
  setTimeout(() => $('loading').remove(), 700);

  const code = new URLSearchParams(location.search).get('r')?.toUpperCase();
  if (code && ROOM_CODE_REGEX.test(code)) void joinRoom(code);
  else showMenu();
}

// ------------------------------------------------------------------ menú

function refreshProfileChip() {
  $('menu-avatar').textContent = profile.avatar;
  $('menu-name').textContent = profile.name;
}

function showMenu() {
  show($('menu'), true);
  show($('lobby'), false);
  refreshProfileChip();
  if (!(engine.current instanceof homeSceneCtor)) engine.setScene(new homeSceneCtor(engine));
  setUrlRoom(null);
}

function bindMenu() {
  $('btn-create').addEventListener('click', () => void createRoom());
  $('btn-join').addEventListener('click', () => openJoin((c) => void joinRoom(c)));
  // La primera vez va directo al tutorial (1 vs 1); después se elige cuántos bots
  $('btn-practice').addEventListener('click', () => (settings.tutorialDone ? choosePractice() : void startPractice()));
  $('btn-stats').addEventListener('click', () => void import('./ui/statsView').then((m) => m.openStats()));
  $('btn-settings').addEventListener('click', () => openSettings({ onTutorial: () => void startPractice(true) }));
  $('btn-howto').addEventListener('click', () => openHowTo(() => void startPractice(true)));
  $('profile-chip').addEventListener('click', () => openProfile(refreshProfileChip));
  $('btn-lobby-leave').addEventListener('click', () => {
    pendingSocket?.leave();
    pendingSocket = null;
    showMenu();
  });
}

function setUrlRoom(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('r', code);
  else url.searchParams.delete('r');
  history.replaceState(null, '', url);
}

function roomLink(code: string) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('r', code);
  return url.toString();
}

// ------------------------------------------------------------------ online

async function connect(): Promise<SocketTransport | null> {
  if (!navigator.onLine) {
    toast(t('err.offline'), 'error');
    return null;
  }
  const { SocketTransport } = await import('./net/socket');
  try {
    return await SocketTransport.connect();
  } catch {
    toast(t('err.server'), 'error', 4000);
    return null;
  }
}

async function createRoom() {
  const btn = $<HTMLButtonElement>('btn-create');
  btn.disabled = true;
  try {
    const tr = await connect();
    if (!tr) return;
    const r = await tr.create({ turnSeconds: settings.turnSeconds });
    if (!r.ok) {
      toast(t(`err.${r.error}`), 'error');
      tr.leave();
      return;
    }
    pendingSocket = tr;
    setUrlRoom(r.code);
    showLobby(r.code, tr);
  } finally {
    btn.disabled = false;
  }
}

function showLobby(code: string, tr: SocketTransport) {
  show($('menu'), false);
  show($('lobby'), true);
  $('lobby-code').textContent = code;
  const link = roomLink(code);
  const text = t('room.shareText', { code, url: link });
  $('btn-share').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Rummi 3D', text, url: link });
        return;
      } catch {
        /* cancelado: caer a WhatsApp */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  $('btn-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('room.copied'), 'ok');
    } catch {
      prompt(t('room.copy'), link);
    }
  };
  const startBtn = $<HTMLButtonElement>('btn-start');
  startBtn.onclick = async () => {
    startBtn.disabled = true;
    const r = await tr.start();
    startBtn.disabled = false;
    if (!r.ok) {
      toast(t(`err.${r.error}`), 'error');
      return;
    }
    // Si la partida ya estaba en curso y seguimos en la sala de espera, entrar a ella
    setTimeout(() => {
      const v = tr.lastState;
      if (!session && !$('lobby').hidden && v && v.status !== 'waiting') {
        off();
        offClosed();
        pendingSocket = null;
        void startGame(tr, v);
      }
    }, 600);
  };
  const render = (v: PlayerView) => renderLobby(v);
  $('lobby-mode').onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (!b || b.disabled) return;
    const r = await tr.configure(Number(b.dataset.v));
    if (!r.ok) toast(t(`err.${r.error}`), 'error');
  };
  if (tr.lastState?.status === 'waiting') render(tr.lastState);
  const off = tr.on('state', (v: PlayerView) => {
    if (v.status !== 'waiting') {
      off();
      offClosed();
      pendingSocket = null;
      void startGame(tr, v);
    } else render(v);
  });
  const offClosed = tr.on('closed', () => {
    off();
    offClosed();
    toast(t('err.ROOM_NOT_FOUND'), 'error');
    pendingSocket = null;
    showMenu();
  });
}

/** Lista de jugadores de la sala de espera (hasta 4) y botón de empezar para el anfitrión. */
function renderLobby(v: PlayerView) {
  const list = $('lobby-players');
  const rows = v.players.map((p, i) => {
    const tags = [i === v.host ? `👑 ${t('lobby.host')}` : '', i === v.you ? t('lobby.you') : ''].filter(Boolean).join(' · ');
    return `<li><span class="avatar">${escapeHtml(p.avatar)}</span>${escapeHtml(p.name)}${p.connected ? '' : ' <i class="dot off"></i>'}<span class="tag">${tags}</span></li>`;
  });
  for (let i = v.players.length; i < MAX_PLAYERS; i++) rows.push(`<li class="empty">${t('lobby.empty')}</li>`);
  list.innerHTML = rows.join('');
  const n = v.players.length;
  const host = v.players[v.host];
  const iAmHost = v.you === v.host || !host?.connected;
  const btn = $<HTMLButtonElement>('btn-start');
  btn.hidden = !iAmHost;
  btn.disabled = n < 2;
  btn.textContent = t('lobby.start', { n });
  $('lobby-status').textContent = n < 2 ? t('lobby.needMore') : iAmHost ? t('lobby.canStart') : t('lobby.waitHost', { name: host?.name ?? '' });
  // Modo: solo el anfitrión lo cambia; los demás lo ven
  const mode = $('lobby-mode');
  mode.classList.toggle('readonly', !iAmHost);
  mode.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) === v.bestOf);
    b.disabled = !iAmHost;
  });
}

async function joinRoom(code: string) {
  const tr = await connect();
  if (!tr) {
    showMenu();
    return;
  }
  const r = await tr.join(code, getSessionToken(code));
  if (!r.ok) {
    tr.leave();
    toast(t(`err.${r.error}`), 'error', 4000);
    showMenu();
    return;
  }
  setUrlRoom(code);
  // Esperar el primer estado (puede tardar en redes lentas); la sala de espera también sabe arrancar la partida
  const v =
    tr.lastState ??
    (await new Promise<PlayerView | null>((res) => {
      const timer = setTimeout(() => {
        off();
        res(tr.lastState);
      }, 10_000);
      const off = tr.on('state', (s) => {
        clearTimeout(timer);
        off();
        res(s);
      });
    }));
  if (!v || v.status === 'waiting') {
    pendingSocket = tr;
    showLobby(code, tr);
    return;
  }
  void startGame(tr, v);
}

// ------------------------------------------------------------------ práctica

/** Elegir contra cuántos bots (1 a 3) y con qué dificultad jugar la práctica. */
function choosePractice() {
  let level = settings.botLevel;
  let bestOf = 1;
  const m = modal(`
    <h2>${t('practice.title')}</h2>
    <p class="muted" style="margin:0 0 6px">${t('practice.level')}</p>
    <div class="seg level-seg" data-seg="level">
      ${(['easy', 'normal', 'hard'] as const).map((l) => `<button type="button" data-v="${l}" class="${l === level ? 'on' : ''}">${t(`practice.${l}`)}</button>`).join('')}
    </div>
    <p class="muted level-hint" id="level-hint">${t(`practice.${level}Hint`)}</p>
    <div class="seg mode-seg" style="margin-bottom:10px">
      <button type="button" data-bo="1" class="${bestOf === 1 ? 'on' : ''}">${t('mode.single')}</button>
      <button type="button" data-bo="3" class="${bestOf === 3 ? 'on' : ''}">${t('mode.bo3')}</button>
    </div>
    <div class="bots-pick">
      ${[1, 2, 3].map((n) => `<button type="button" data-n="${n}"><b>${n}</b><span>🤖 ${n === 1 ? t('practice.rival') : t('practice.rivals')}</span></button>`).join('')}
    </div>
    <div class="actions-row"><button class="btn" data-close>${t('common.cancel')}</button></div>`);
  m.el.querySelector('.level-seg')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (!b) return;
    level = b.dataset.v as typeof level;
    m.el.querySelectorAll('.level-seg button').forEach((x) => x.classList.toggle('on', x === b));
    m.el.querySelector('#level-hint')!.textContent = t(`practice.${level}Hint`);
  });
  m.el.querySelectorAll<HTMLButtonElement>('[data-bo]').forEach((b) =>
    b.addEventListener('click', () => {
      bestOf = Number(b.dataset.bo);
      m.el.querySelectorAll('[data-bo]').forEach((x) => x.classList.toggle('on', x === b));
    }),
  );
  m.el.querySelector('.bots-pick')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-n]');
    if (!b) return;
    updateSettings({ botLevel: level });
    m.close();
    void startPractice(false, Number(b.dataset.n), bestOf);
  });
}

async function startPractice(forceTutorial = false, bots = 1, bestOf = 1) {
  const { LocalTransport } = await import('./net/local');
  // El tutorial siempre contra un bot Normal
  const tr = new LocalTransport(profile, settings.turnSeconds, bots, forceTutorial || !settings.tutorialDone ? 'normal' : settings.botLevel, bestOf);
  await startGame(tr);
  if ((forceTutorial || !settings.tutorialDone) && session) {
    const { startTutorial } = await import('./ui/tutorial');
    const s = session;
    s.endTutorial = startTutorial(s.ctl, () => (s.endTutorial = undefined));
  }
}

// ------------------------------------------------------------------ partida

async function startGame(transport: Transport, initial?: PlayerView) {
  closeAllModals();
  const mods = await import('./game/session-modules');
  show($('menu'), false);
  show($('lobby'), false);
  const ctl = new mods.GameController(transport);
  const board: BoardScene = new mods.BoardScene(engine, {
    move: (tile, to, rackIndex) => ctl.move(tile, to, rackIndex),
    moveMeld: (meldId, to) => ctl.moveMeld(meldId, to),
    moveTiles: (ids, to) => ctl.moveTiles(ids, to),
    reorderMany: (ids, index) => ctl.reorderMany(ids, index),
    multiSelectHint: () => {
      // Ayuda las primeras veces que se seleccionan varias fichas
      try {
        const n = Number(localStorage.getItem('rummi.hintMulti') ?? '0');
        if (n >= 3) return;
        localStorage.setItem('rummi.hintMulti', String(n + 1));
      } catch {
        /* noop */
      }
      toast(t('hint.multi'));
    },
    reorder: (tile, index) => ctl.reorderRack(tile, index),
    drag: (d) => transport.drag(d),
    notMyTurn: () => toast(t('err.NOT_YOUR_TURN'), 'error'),
  });
  engine.setScene(board);
  const hud = new mods.GameHud(ctl, board, {
    onMenu: () => openGameMenu(),
    onLeave: () => leaveGame(),
  });
  // Estadísticas locales: registra cada partida al terminar
  const botLevel = (transport as { level?: 'easy' | 'normal' | 'hard' }).level;
  const tracker = new GameStatsTracker(transport.kind === 'local' ? 'bot' : 'online', botLevel);
  const offs: (() => void)[] = [
    ctl.em.on('change', (v) => board.sync(v, ctl.rackOrder, true)),
    ctl.em.on('change', (v) => tracker.onView(v)),
    ctl.em.on('gameEvent', (e, v) => {
      if (e.type === 'start') tracker.onStart();
      else if (e.type === 'play') tracker.onPlay(e.player, e.tiles.length, v.you);
    }),
    transport.on('drag', (d) => board.showGhost(d)),
    transport.on('status', (s) => {
      if (s === 'connected') {
        banner(null);
        toast(t('err.reconnected'), 'ok');
      } else if (s === 'reconnecting') banner(t('err.reconnecting'), 'warn');
      else banner(t('err.server'));
    }),
    transport.on('closed', () => {
      toast(t('err.ROOM_NOT_FOUND'), 'error', 4000);
      leaveGame();
    }),
    // Revancha sin suficientes jugadores: la sala vuelve a la espera para que entre más gente
    transport.on('state', (v) => {
      if (v.status !== 'waiting' || transport.kind !== 'online') return;
      const tr = transport as SocketTransport;
      teardownSession(false);
      showMenu();
      setUrlRoom(v.roomCode);
      pendingSocket = tr;
      showLobby(v.roomCode, tr);
    }),
  ];
  session = { transport, board, ctl, hud, offs };
  const init = transport.lastState ?? initial;
  if (init?.status === 'waiting' && transport.kind === 'online') {
    // La sala volvió a la espera mientras se montaba la escena
    teardownSession(false);
    showMenu();
    pendingSocket = transport as SocketTransport;
    showLobby(init.roomCode, transport as SocketTransport);
    return;
  }
  if (init) ctl.receive(init);
  hud.layout();
  void enterImmersive();
}

function openGameMenu() {
  const m = modal(`
    <h2>${t('btn.menu')}</h2>
    <div class="menu-list" style="margin:0">
      <button class="btn btn-lg" id="gm-settings">⚙️ ${t('menu.settings')}</button>
      <button class="btn btn-lg" id="gm-howto">📖 ${t('menu.howto')}</button>
      <button class="btn btn-lg" id="gm-leave">🚪 ${t('room.leave')}</button>
      <button class="btn btn-gold btn-lg" data-close>${t('common.close')}</button>
    </div>`);
  m.el.querySelector('#gm-settings')!.addEventListener('click', () => {
    m.close();
    openSettings({ inGame: true });
  });
  m.el.querySelector('#gm-howto')!.addEventListener('click', () => {
    m.close();
    openHowTo();
  });
  m.el.querySelector('#gm-leave')!.addEventListener('click', async () => {
    m.close();
    if (await confirmDialog(t('game.leaveConfirm'), t('room.leave'), t('common.cancel'))) leaveGame();
  });
}

function teardownSession(leaveTransport: boolean) {
  const s = session;
  session = null;
  if (s) {
    s.endTutorial?.();
    s.offs.forEach((f) => f());
    s.hud.dispose();
    s.ctl.dispose();
    if (leaveTransport) s.transport.leave();
  }
  closeAllModals();
  banner(null);
  void exitImmersive();
}

function leaveGame() {
  teardownSession(true);
  showMenu(); // libera la escena de juego (dispose) y vuelve al fondo del menú
}

// ------------------------------------------------------------------ pantalla completa y wake lock

async function enterImmersive() {
  try {
    if (settings.fullscreen && matchMedia('(pointer: coarse)').matches && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    }
  } catch {
    /* requiere gesto del usuario; se ignora */
  }
  await requestWakeLock();
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && session) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    wakeLock = null;
  }
}

async function exitImmersive() {
  try {
    await wakeLock?.release();
  } catch {
    /* noop */
  }
  wakeLock = null;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

// iOS Safari ignora user-scalable=no: bloquear pellizco y doble toque del navegador
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) void requestWakeLock();
});

// ------------------------------------------------------------------ conectividad y PWA

function setupConnectivityBanner() {
  const update = () => banner(navigator.onLine ? null : t('offline.banner'));
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  if (!navigator.onLine) update();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    // La URL incluye la compilación: cada despliegue instala un service worker nuevo y borra la caché vieja
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {});
  });
}

/**
 * Tras un despliegue, una pestaña abierta con la versión anterior pide archivos que ya no existen (404).
 * En ese caso se recarga UNA vez para tomar la versión nueva (sin bucles si el problema es otro).
 */
function setupStaleBuildRecovery() {
  const KEY = 'rummi.reloadedFor';
  const reloadOnce = () => {
    try {
      if (sessionStorage.getItem(KEY) === __BUILD_ID__) return;
      sessionStorage.setItem(KEY, __BUILD_ID__);
    } catch {
      /* sin sessionStorage: recargar igual */
    }
    location.reload();
  };
  // Sin preventDefault: el import falla de verdad (no devuelve undefined) y la página se recarga
  window.addEventListener('vite:preloadError', () => reloadOnce());
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? '');
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i.test(msg)) {
      e.preventDefault();
      reloadOnce();
    }
  });
}
setupStaleBuildRecovery();

// Exponer estado para tests e2e (solo lectura)
declare global {
  interface Window {
    __rummi?: {
      view(): PlayerView | null;
      rackOrder(): number[];
      rackH(): number | null;
      tilePos(t: number): { x: number; y: number } | null;
    };
  }
}
window.__rummi = {
  view: () => session?.ctl.view ?? null,
  rackOrder: () => session?.ctl.rackOrder ?? [],
  rackH: () => session?.board.rackH ?? null,
  tilePos: (t: number) => session?.board.screenPosOfTile(t) ?? null,
};

// Solo en desarrollo: juega automáticamente mi turno con la IA (para probar finales de partida)
if (import.meta.env.DEV) {
  (window as unknown as { __autoplay: () => Promise<void> }).__autoplay = async () => {
    const { planBotTurn, botMoveToIntent } = await import('@rummi/shared');
    const s = session;
    const v = s?.ctl.view;
    if (!s || !v || v.turn !== v.you || v.status !== 'playing') return;
    const plan = planBotTurn({ start: { rack: v.rack, table: v.table }, opened: v.players[v.you]!.opened });
    for (const m of plan.moves) {
      const i = botMoveToIntent(m, s.ctl.view!.table);
      if (i && i.type === 'move') s.ctl.move(i.tileId, i.to);
      await new Promise((r) => setTimeout(r, 120));
    }
    if (plan.play) s.ctl.endTurn();
    else s.ctl.draw();
  };
}

void boot();
