import { EMOTES, type ChatMessage, type GameErrorCode, type GameEvent, type PlayerView, type RoomErrorCode } from '@rummi/shared';
import { sfx, vibrate } from '../audio';
import type { GameController } from '../game/controller';
import { onLangChange, t } from '../i18n';
import { settings, updateSettings } from '../settings';
import type { BoardScene } from '../three/board';
import { $, closeAllModals, escapeHtml, hasOpenModal, modal, toast, type Modal } from './dom';

export interface HudOptions {
  onMenu(): void;
  onLeave(): void;
}

function safeBottomPx(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden';
  document.body.appendChild(probe);
  const v = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return v;
}

/** HUD HTML sobre el canvas: rival, turno, temporizador, pozo, acciones, reacciones y chat. */
export class GameHud {
  private root = $('hud');
  private offs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval>;
  private clockOffset = 0;
  private endModal: Modal | null = null;
  private lastTurnMine: boolean | null = null;
  private chatOpen = false;

  constructor(private ctl: GameController, private board: BoardScene, private opts: HudOptions) {
    this.root.hidden = false;
    const tr = ctl.transport;
    this.offs.push(
      ctl.em.on('change', (v) => this.update(v)),
      ctl.em.on('error', (c) => this.onError(c)),
      ctl.em.on('gameEvent', (e, v) => this.onGameEvent(e, v)),
      tr.on('emote', (e) => this.floatEmoji(e.emoji, e.from === ctl.view?.you)),
      tr.on('chat', (m) => this.onChat(m)),
      onLangChange(() => this.ctl.view && this.update(this.ctl.view)),
    );
    const on = (id: string, f: () => void) => {
      const el = $(id);
      const h = (e: Event) => {
        e.preventDefault();
        f();
      };
      el.addEventListener('click', h);
      this.offs.push(() => el.removeEventListener('click', h));
    };
    on('act-undo', () => ctl.undo());
    on('act-draw', () => {
      this.board.clearSelection();
      ctl.draw();
    });
    on('act-end', () => {
      this.board.clearSelection();
      ctl.endTurn();
    });
    on('act-sort', () => {
      ctl.sort(settings.sortMode);
      sfx.rack();
      updateSettings({ sortMode: settings.sortMode === 'color' ? 'number' : 'color' });
      this.updateSortLabel();
    });
    on('btn-recenter', () => board.recenter());
    on('btn-mute', () => {
      updateSettings({ sound: !settings.sound });
      this.updateMute();
    });
    on('btn-menu', () => opts.onMenu());
    on('btn-emote', () => this.toggleEmotes());
    on('btn-chat', () => this.toggleChat());
    on('rack-left', () => this.scrollRack(-1));
    on('rack-right', () => this.scrollRack(1));
    const picker = $('emote-picker');
    picker.innerHTML = EMOTES.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('');
    const pick = (e: Event) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      tr.emote(b.dataset.e!);
      picker.hidden = true;
    };
    picker.addEventListener('click', pick);
    this.offs.push(() => picker.removeEventListener('click', pick));
    const form = $('chat-form') as HTMLFormElement;
    const submit = (e: Event) => {
      e.preventDefault();
      const input = $<HTMLInputElement>('chat-input');
      const text = input.value.trim();
      if (!text) return;
      tr.chat(text);
      input.value = '';
    };
    form.addEventListener('submit', submit);
    this.offs.push(() => form.removeEventListener('submit', submit));

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.layout);
    this.offs.push(() => window.removeEventListener('keydown', this.onKey), () => window.removeEventListener('resize', this.layout));
    this.timer = setInterval(() => this.tickTimer(), 250);
    $('chat-log').innerHTML = '';
    $('floaters').innerHTML = '';
    this.updateSortLabel();
    this.updateMute();
    requestAnimationFrame(this.layout);
  }

  /** Calcula los huecos que el HUD tapa para centrar la cámara y coloca el atril. */
  layout = () => {
    const top = $('hud').querySelector('.hud-top')!.getBoundingClientRect().bottom + 34;
    const landscapeShort = window.innerWidth > window.innerHeight && window.innerHeight < 560;
    const actions = $('actions');
    const bottom = landscapeShort ? 0 : actions.getBoundingClientRect().height;
    const right = landscapeShort ? actions.getBoundingClientRect().width + 8 : 0;
    this.board.setInsets({ top, bottom, right, safeBottom: safeBottomPx() });
    document.documentElement.style.setProperty('--rack-h', `${this.board.rackH}px`);
    this.updateRackArrows();
  };

  private scrollRack(dir: number) {
    this.board.scrollRack(dir * window.innerWidth * 0.6);
    this.updateRackArrows();
  }

  private updateRackArrows() {
    const s = this.board.canScrollRack;
    $('rack-left').hidden = !s.left;
    $('rack-right').hidden = !s.right;
  }

  private updateSortLabel() {
    $('sort-label').textContent = t(settings.sortMode === 'color' ? 'btn.sortColor' : 'btn.sortNumber');
  }

  private updateMute() {
    $('btn-mute').textContent = settings.sound ? '🔊' : '🔇';
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || hasOpenModal()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.ctl.endTurn();
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) return;
      this.ctl.undo();
    } else if (e.key === ' ') {
      e.preventDefault();
      this.ctl.draw();
    } else if (e.key === 'Escape') {
      this.board.clearSelection();
      $('emote-picker').hidden = true;
      if (this.chatOpen) this.toggleChat();
    } else if (e.key === 'c' || e.key === 'C') {
      this.ctl.sort('color');
    } else if (e.key === 'n' || e.key === 'N') {
      this.ctl.sort('number');
    }
  };

  private toggleEmotes() {
    const p = $('emote-picker');
    p.hidden = !p.hidden;
    if (!p.hidden && this.chatOpen) this.toggleChat();
  }

  private toggleChat() {
    this.chatOpen = !this.chatOpen;
    $('chat').hidden = !this.chatOpen;
    $('chat-badge').hidden = true;
    if (this.chatOpen) {
      $('emote-picker').hidden = true;
      const log = $('chat-log');
      log.scrollTop = log.scrollHeight;
    }
  }

  private onChat(m: ChatMessage) {
    const mine = m.from === this.ctl.view?.you;
    const log = $('chat-log');
    const div = document.createElement('div');
    if (mine) div.className = 'me';
    div.textContent = m.text;
    log.appendChild(div);
    while (log.children.length > 50) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    if (!mine) {
      sfx.pop();
      if (!this.chatOpen) {
        $('chat-badge').hidden = false;
        this.floatBubble(m.text);
      }
    }
  }

  private floatEmoji(emoji: string, mine: boolean) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = emoji;
    el.style.left = `${mine ? 60 + Math.random() * 25 : 15 + Math.random() * 25}%`;
    el.style.top = mine ? `calc(100% - var(--rack-h) - var(--actions-h) - 90px)` : `calc(var(--hud-h) + 40px)`;
    $('floaters').appendChild(el);
    sfx.pop();
    vibrate(10);
    setTimeout(() => el.remove(), 2300);
  }

  private floatBubble(text: string) {
    const el = document.createElement('div');
    el.className = 'floater bubble';
    el.textContent = text;
    el.style.left = '12px';
    el.style.top = `calc(var(--hud-h) + 50px)`;
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  private onError(code: GameErrorCode | RoomErrorCode) {
    toast(t(`err.${code}`), 'error');
    sfx.invalid();
    vibrate([20, 40, 20]);
    if (code === 'INVALID_MELDS' || code === 'OPENING_TOO_LOW' || code === 'OPENING_TABLE_TOUCHED') this.board.shakeInvalid();
  }

  private onGameEvent(e: GameEvent, v: PlayerView) {
    const oppName = v.players[1 - v.you]!.name;
    switch (e.type) {
      case 'draw':
        sfx.draw();
        if (e.player === v.you && e.timeout) toast(t('game.timeout'), 'error');
        else if (e.player !== v.you) toast(t('game.drew', { name: oppName }));
        break;
      case 'play':
        if (e.player !== v.you) toast(t(e.tiles.length === 1 ? 'game.played1' : 'game.played', { name: oppName, n: e.tiles.length }));
        else sfx.valid();
        break;
      case 'end':
        break;
      case 'start':
        closeAllModals();
        this.endModal = null;
        break;
    }
  }

  update(v: PlayerView) {
    this.clockOffset = v.serverNow - Date.now();
    const me = v.players[v.you]!;
    const opp = v.players[1 - v.you]!;
    const mine = v.status === 'playing' && v.turn === v.you;
    $('opp-avatar').textContent = opp.avatar;
    $('opp-name').textContent = opp.name;
    $('opp-count').textContent = String(opp.rackCount);
    $('opp-dot').classList.toggle('off', !opp.connected);
    $('opp').classList.toggle('active', v.status === 'playing' && !mine);
    $('opp-status').textContent = !opp.connected
      ? `· ${t('hud.disconnected')}`
      : opp.isBot && v.status === 'playing' && !mine
        ? `· ${t('hud.botThinking')}`
        : '';
    $('pool-count').textContent = String(v.poolCount);
    const label = $('turn-label');
    label.textContent = v.status === 'playing' ? (mine ? t('hud.yourTurn') : t('hud.theirTurn', { name: opp.name })) : '';
    label.hidden = v.status !== 'playing';
    label.classList.toggle('mine', mine);
    $('turn').classList.toggle('mine', mine);
    if (this.lastTurnMine !== mine && v.status === 'playing') {
      label.classList.remove('pop');
      void label.offsetWidth;
      label.classList.add('pop');
      if (mine && this.lastTurnMine !== null) {
        sfx.turn();
        vibrate([15, 60, 15]);
      }
    }
    this.lastTurnMine = v.status === 'playing' ? mine : null;

    // Apertura
    const opening = $('opening');
    if (mine && !me.opened) {
      const pts = this.ctl.openingPoints();
      opening.hidden = false;
      opening.textContent = t('hud.opening', { pts });
      opening.classList.toggle('ok', pts >= 30);
    } else opening.hidden = true;

    // Botones
    const played = v.playedThisTurn.length > 0;
    const allValid = this.ctl.invalidMeldIds().size === 0;
    ($('act-undo') as HTMLButtonElement).disabled = !mine || !v.canUndo;
    ($('act-draw') as HTMLButtonElement).disabled = !mine;
    const end = $('act-end') as HTMLButtonElement;
    end.disabled = !mine || !played;
    end.classList.toggle('ready', mine && played && allValid && (me.opened || this.ctl.openingPoints() >= 30));
    this.board.setInteractive(true);
    this.tickTimer();
    this.updateRackArrows();

    if (v.status === 'ended') this.showEnd(v);
    else if (this.endModal) {
      this.endModal.close();
      this.endModal = null;
    }
  }

  private tickTimer() {
    const v = this.ctl.view;
    const ring = $('ring-fg');
    const label = $('turn-time');
    const wrap = $('turn');
    if (!v || v.status !== 'playing' || v.turnDeadline === null) {
      label.textContent = v?.status === 'playing' ? '∞' : '–';
      ring.style.strokeDashoffset = '0';
      wrap.classList.remove('urgent');
      return;
    }
    const remain = Math.max(0, v.turnDeadline - (Date.now() + this.clockOffset));
    const secs = Math.ceil(remain / 1000);
    label.textContent = String(secs);
    const frac = Math.min(1, remain / (v.turnSeconds * 1000));
    ring.style.strokeDashoffset = String(97.4 * (1 - frac));
    const urgent = secs <= 10 && v.turn === v.you;
    if (urgent && !wrap.classList.contains('urgent') && secs > 0) vibrate(30);
    wrap.classList.toggle('urgent', urgent);
  }

  private showEnd(v: PlayerView) {
    const r = v.result!;
    const me = v.players[v.you]!;
    const opp = v.players[1 - v.you]!;
    const won = r.winner === v.you;
    const draw = r.winner === null;
    const title = draw ? t('end.draw') : won ? t('end.win') : t('end.lose');
    const reason =
      r.reason === 'out' ? t('end.reasonOut', { name: escapeHtml(r.winner === v.you ? me.name : opp.name) }) : t('end.reasonPool');
    const askedByOpp = v.rematch[1 - v.you] && !v.rematch[v.you];
    const iAsked = v.rematch[v.you];
    const html = `
      <div class="end-card">
        <div style="font-size:54px">${draw ? '🤝' : won ? '🏆' : '😔'}</div>
        <div class="end-title ${won ? 'win' : ''}">${title}</div>
        <p class="muted">${reason}</p>
        <p class="muted" style="margin:14px 0 4px">${t('end.points')}</p>
        <div class="end-scores">
          <div>${escapeHtml(me.avatar)} ${escapeHtml(me.name)}<b>${r.points[v.you]}</b></div>
          <div>${escapeHtml(opp.avatar)} ${escapeHtml(opp.name)}<b>${r.points[1 - v.you]}</b></div>
        </div>
        <p class="muted">${t('end.score')}: <b style="color:var(--gold)">${me.wins} – ${opp.wins}</b></p>
        ${askedByOpp ? `<p style="color:var(--gold)">${t('end.rematchAsked', { name: escapeHtml(opp.name) })}</p>` : ''}
        <div class="actions-row">
          <button class="btn" id="end-menu">${t('end.menu')}</button>
          <button class="btn btn-gold" id="end-rematch" ${iAsked ? 'disabled' : ''}>${iAsked ? t('end.rematchWaiting') : t('end.rematch')}</button>
        </div>
      </div>`;
    const first = !this.endModal;
    if (this.endModal) this.endModal.el.innerHTML = html;
    else this.endModal = modal(html, { dismissible: false });
    const el = this.endModal.el;
    el.querySelector('#end-menu')!.addEventListener('click', () => this.opts.onLeave());
    el.querySelector('#end-rematch')!.addEventListener('click', () => {
      this.ctl.transport.rematch();
      const b = el.querySelector<HTMLButtonElement>('#end-rematch')!;
      b.disabled = true;
      b.textContent = t('end.rematchWaiting');
    });
    if (first) {
      if (won) {
        sfx.win();
        vibrate([30, 50, 30, 50, 80]);
        this.board.celebrate();
      } else if (!draw) sfx.lose();
    }
  }

  dispose() {
    clearInterval(this.timer);
    this.offs.forEach((f) => f());
    this.endModal?.close();
    this.root.hidden = true;
    $('emote-picker').hidden = true;
    $('chat').hidden = true;
    this.chatOpen = false;
  }
}
