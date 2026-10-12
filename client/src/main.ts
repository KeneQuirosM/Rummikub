import './styles.css';
import { ROOM_CODE_REGEX, type PlayerView } from '@rummi/shared';
import { unlockAudio } from './audio';
import { applyI18n, setLang, t } from './i18n';
import type { Transport } from './net/transport';
import { getSessionToken, onSettingsChange, profile, settings } from './settings';
import { $, banner, closeAllModals, confirmDialog, modal, show, toast } from './ui/dom';
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
  let symbols = settings.symbols;
  onSettingsChange((s) => {
    if (s.symbols !== symbols) {
      symbols = s.symbols;
      engine.setSymbols(s.symbols);
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
  $('btn-practice').addEventListener('click', () => void startPractice());
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
  const off = tr.on('state', (v: PlayerView) => {
    if (v.status !== 'waiting') {
      off();
      pendingSocket = null;
      void startGame(tr, v);
    }
  });
}

async function joinRoom(code: string) {
  const tr = await connect();
  if (!tr) {
    showMenu();
    return;
  }
  let first: PlayerView | null = null;
  const off = tr.on('state', (v) => (first = v));
  const r = await tr.join(code, getSessionToken(code));
  if (!r.ok) {
    off();
    tr.leave();
    toast(t(`err.${r.error}`), 'error', 4000);
    showMenu();
    return;
  }
  setUrlRoom(code);
  // Si soy el creador y el rival aún no llegó (recarga en la sala de espera)
  const waitFirst = async () => {
    for (let i = 0; i < 40 && !first; i++) await new Promise((res) => setTimeout(res, 50));
    return first as PlayerView | null;
  };
  const v = await waitFirst();
  off();
  if (v && v.status === 'waiting') {
    pendingSocket = tr;
    showLobby(code, tr);
    return;
  }
  void startGame(tr, v ?? undefined);
}

// ------------------------------------------------------------------ práctica

async function startPractice(forceTutorial = false) {
  const { LocalTransport } = await import('./net/local');
  const tr = new LocalTransport(profile, settings.turnSeconds);
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
    reorder: (tile, index) => ctl.reorderRack(tile, index),
    drag: (d) => transport.drag(d),
    notMyTurn: () => toast(t('err.NOT_YOUR_TURN'), 'error'),
  });
  engine.setScene(board);
  const hud = new mods.GameHud(ctl, board, {
    onMenu: () => openGameMenu(),
    onLeave: () => leaveGame(),
  });
  const offs: (() => void)[] = [
    ctl.em.on('change', (v) => board.sync(v, ctl.rackOrder, true)),
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
  ];
  session = { transport, board, ctl, hud, offs };
  const init = transport.lastState ?? initial;
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

function leaveGame() {
  const s = session;
  session = null;
  if (s) {
    s.endTutorial?.();
    s.offs.forEach((f) => f());
    s.hud.dispose();
    s.ctl.dispose();
    s.transport.leave();
  }
  closeAllModals();
  banner(null);
  void exitImmersive();
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
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Exponer estado para tests e2e (solo lectura)
declare global {
  interface Window {
    __rummi?: { view(): PlayerView | null; rackOrder(): number[] };
  }
}
window.__rummi = {
  view: () => session?.ctl.view ?? null,
  rackOrder: () => session?.ctl.rackOrder ?? [],
};

// Solo en desarrollo: juega automáticamente mi turno con la IA (para probar finales de partida)
if (import.meta.env.DEV) {
  (window as unknown as { __autoplay: () => Promise<void> }).__autoplay = async () => {
    const { planBotTurn, botMoveToIntent } = await import('@rummi/shared');
    const s = session;
    const v = s?.ctl.view;
    if (!s || !v || v.turn !== v.you || v.status !== 'playing') return;
    const plan = planBotTurn({ start: { rack: v.rack, table: v.table }, opened: v.players[v.you].opened });
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
