import { EMOTES, PHRASES, winsNeeded, type ChatMessage, type GameErrorCode, type GameEvent, type PlayerView, type RoomErrorCode } from '@rummi/shared';
import { sfx, vibrate } from '../audio';
import type { GameController } from '../game/controller';
import { onLangChange, t } from '../i18n';
import { settings, updateSettings } from '../settings';
import type { BoardScene } from '../three/board';
import { opponentsForHud } from '../game/seats';
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
  private replacedSeen = new Set<number>();
  private relayoutTimers: ReturnType<typeof setTimeout>[] = [];
  /** Última jugada (para destacar la jugada ganadora en la cinemática). */
  private lastPlay: { player: number; tiles: number[] } | null = null;
  /** La cinemática de fin está en curso: el ranking se muestra al terminar. */
  private cinematicRunning = false;
  private endShownFor = false;
  private layoutQueued = false;

  constructor(private ctl: GameController, private board: BoardScene, private opts: HudOptions) {
    this.root.hidden = false;
    const tr = ctl.transport;
    this.offs.push(
      ctl.em.on('change', (v) => this.update(v)),
      ctl.em.on('error', (c) => this.onError(c)),
      ctl.em.on('gameEvent', (e, v) => this.onGameEvent(e, v)),
      tr.on('emote', (e) => this.floatEmoji(e.emoji, e.from)),
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
    this.renderPicker('emojis');
    const pick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.tab) {
        this.renderPicker(b.dataset.tab as 'emojis' | 'phrases');
        return;
      }
      if (!b.dataset.e) return;
      tr.emote(b.dataset.e);
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
    // Al girar el teléfono los tamaños llegan en varios pasos (sobre todo en iOS): re-medir varias veces
    const relayout = () => {
      this.relayoutTimers.forEach(clearTimeout);
      this.relayoutTimers = [];
      this.layout();
      requestAnimationFrame(this.layout);
      for (const ms of [150, 400, 900]) this.relayoutTimers.push(setTimeout(this.layout, ms));
    };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    // Cuando la escena cambia de tamaño por su cuenta, el CSS del atril debe seguirla
    board.onLayout = () => {
      document.documentElement.style.setProperty('--rack-h', `${board.rackH}px`);
      this.updateRackArrows();
      if (!this.layoutQueued) {
        this.layoutQueued = true;
        requestAnimationFrame(() => {
          this.layoutQueued = false;
          this.layout();
        });
      }
    };
    this.offs.push(
      () => window.removeEventListener('keydown', this.onKey),
      () => window.removeEventListener('resize', relayout),
      () => window.removeEventListener('orientationchange', relayout),
      () => window.visualViewport?.removeEventListener('resize', relayout),
      () => this.relayoutTimers.forEach(clearTimeout),
      () => (board.onLayout = () => {}),
    );
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
    // Las columnas de botones laterales no deben tapar a los rivales sentados a los lados
    const w = window.innerWidth;
    const leftTools = $('hud').querySelector<HTMLElement>('.side-tools:not(.right)')!.getBoundingClientRect();
    const rightTools = $('hud').querySelector<HTMLElement>('.side-tools.right')!.getBoundingClientRect();
    const left = leftTools.width ? leftTools.right + 4 : 0;
    const rightEdge = Math.min(rightTools.width ? rightTools.left : w, landscapeShort ? actions.getBoundingClientRect().left : w);
    const right = Math.max(0, w - rightEdge + 4);
    this.board.setInsets({ top, bottom, right, left, safeBottom: safeBottomPx() });
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
    const who = this.ctl.view?.players[m.from];
    const log = $('chat-log');
    const div = document.createElement('div');
    if (mine) div.className = 'me';
    else if (who) {
      const name = document.createElement('span');
      name.className = 'who';
      name.textContent = `${who.avatar} ${who.name}`;
      div.appendChild(name);
    }
    div.appendChild(document.createTextNode(m.text));
    log.appendChild(div);
    while (log.children.length > 50) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    if (!mine) {
      sfx.pop();
      if (!this.chatOpen) {
        $('chat-badge').hidden = false;
        this.floatBubble(who ? `${who.avatar} ${m.text}` : m.text, m.from);
      }
    }
  }

  /** Posición en pantalla de la ficha (chip) de un rival en el HUD. */
  private chipPos(seat: number): { left: string; top: string } | null {
    const chip = $('opps').querySelector<HTMLElement>(`[data-seat="${seat}"]`);
    if (!chip) return null;
    const r = chip.getBoundingClientRect();
    return { left: `${Math.max(4, r.left + 4)}px`, top: `${r.bottom + 6}px` };
  }

  /** Selector de reacciones con dos pestañas: emojis y frases rápidas. */
  private renderPicker(tab: 'emojis' | 'phrases') {
    const picker = $('emote-picker');
    const tabs = `<div class="picker-tabs">
      <button type="button" data-tab="emojis" class="${tab === 'emojis' ? 'on' : ''}">😀 ${t('react.emojis')}</button>
      <button type="button" data-tab="phrases" class="${tab === 'phrases' ? 'on' : ''}">💬 ${t('react.phrases')}</button>
    </div>`;
    const body =
      tab === 'emojis'
        ? `<div class="picker-grid">${EMOTES.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>`
        : `<div class="picker-phrases">${PHRASES.map((id) => `<button type="button" data-e="phrase:${id}">${escapeHtml(t(`phrase.${id}`))}</button>`).join('')}</div>`;
    picker.innerHTML = tabs + body;
  }

  private floatEmoji(raw: string, from: number) {
    // Frase rápida: globo con el texto traducido al idioma de quien lo recibe
    if (raw.startsWith('phrase:')) {
      const id = raw.slice(7);
      const who = this.ctl.view?.players[from];
      if (id === 'gg' || id === 'rematch') sfx.applause();
      else if (id === 'lol') sfx.laugh();
      else sfx.pop();
      vibrate(10);
      this.floatBubble(`${who?.avatar ?? ''} ${t(`phrase.${id}`)}`, from, from === this.ctl.view?.you);
      return;
    }
    const emoji = raw;
    const mine = from === this.ctl.view?.you;
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = emoji;
    const pos = mine ? null : this.chipPos(from);
    el.style.left = pos?.left ?? `${mine ? 60 + Math.random() * 25 : 15 + Math.random() * 25}%`;
    el.style.top = pos?.top ?? (mine ? `calc(100% - var(--rack-h) - var(--actions-h) - 90px)` : `calc(var(--hud-h) + 40px)`);
    $('floaters').appendChild(el);
    if (emoji === '👏') sfx.applause();
    else if (emoji === '😂') sfx.laugh();
    else sfx.pop();
    vibrate(10);
    setTimeout(() => el.remove(), 2300);
  }

  private floatBubble(text: string, from: number, mine = false) {
    const el = document.createElement('div');
    el.className = 'floater bubble';
    el.textContent = text;
    const pos = mine
      ? { left: 'auto', top: `calc(100% - var(--rack-h) - var(--actions-h) - 110px)` }
      : this.chipPos(from);
    if (mine) el.style.right = 'calc(70px + var(--sar))';
    el.style.left = pos?.left ?? '12px';
    el.style.top = pos?.top ?? `calc(var(--hud-h) + 50px)`;
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
    const oppName = 'player' in e ? (v.players[e.player]?.name ?? '') : '';
    switch (e.type) {
      case 'draw':
        sfx.draw();
        if (e.player === v.you && e.timeout) toast(t('game.timeout'), 'error');
        // Con más de 2 jugadores el contador de cada rival ya lo muestra (evita llenar la mesa de avisos)
        else if (e.player !== v.you && v.players.length === 2) toast(t('game.drew', { name: oppName }));
        break;
      case 'play':
        this.lastPlay = { player: e.player, tiles: e.tiles };
        if (e.player !== v.you) toast(t(e.tiles.length === 1 ? 'game.played1' : 'game.played', { name: oppName, n: e.tiles.length }));
        else sfx.valid();
        break;
      case 'end':
        break;
      case 'start':
        closeAllModals();
        this.endModal = null;
        this.endShownFor = false;
        this.lastPlay = null;
        break;
    }
  }

  update(v: PlayerView) {
    this.clockOffset = v.serverNow - Date.now();
    const me = v.players[v.you]!;
    const mine = v.status === 'playing' && v.turn === v.you;
    this.renderOpponents(v);
    // Torneo: en qué partida vamos
    const pill = $('match-pill');
    pill.hidden = !v.match || v.status !== 'playing';
    if (v.match) {
      const vars = { game: v.match.game, max: v.match.bestOf, need: winsNeeded(v.match.bestOf) };
      pill.textContent = t('match.pill', vars);
      pill.title = t('match.pillTitle', vars);
    }
    // Avisar cuando alguien abandona y el bot toma su lugar
    v.players.forEach((p, i) => {
      if (p.replaced && !this.replacedSeen.has(i) && v.status === 'playing') toast(t('game.replaced', { name: p.name }));
      if (p.replaced) this.replacedSeen.add(i);
      else this.replacedSeen.delete(i);
    });
    $('pool-count').textContent = String(v.poolCount);
    const label = $('turn-label');
    label.textContent = v.status === 'playing' ? (mine ? t('hud.yourTurn') : t('hud.theirTurn', { name: v.players[v.turn]?.name ?? '' })) : '';
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
    this.tickTimer();
    this.updateRackArrows();

    if (v.status === 'playing') this.endShownFor = false;
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

  /** Fichas compactas de los rivales, en el mismo orden que en la mesa (izquierda, enfrente, derecha). */
  private renderOpponents(v: PlayerView) {
    const opps = opponentsForHud(v);
    const box = $('opps');
    box.classList.toggle('many', opps.length >= 3);
    box.innerHTML = opps
      .map(({ seat }) => {
        const p = v.players[seat]!;
        const active = v.status === 'playing' && v.turn === seat;
        const status = p.replaced
          ? `🤖 ${t('hud.replaced')}`
          : !p.connected
            ? t('hud.disconnected')
            : p.isBot && active
              ? t('hud.botThinking')
              : '';
        return `<div class="opp ${active ? 'active' : ''} ${p.replaced ? 'left-game' : ''}" data-seat="${seat}">
          <span class="avatar">${escapeHtml(p.avatar)}<i class="dot ${p.connected ? '' : 'off'}"></i></span>
          <div class="opp-info">
            <div class="opp-name">${escapeHtml(p.name)}${v.match && v.match.wins[seat] ? `<span class="trophies">${'🏆'.repeat(v.match.wins[seat]!)}</span>` : ''}</div>
            <div class="opp-sub"><b>${p.rackCount}</b> ${t('hud.tiles')}${status ? `<span class="opp-status">· ${escapeHtml(status)}</span>` : ''}</div>
          </div>
        </div>`;
      })
      .join('');
  }

  private showEnd(v: PlayerView) {
    if (this.cinematicRunning) return;
    if (!this.endModal && !this.endShownFor) {
      // Primero la cámara cinemática (saltable con un toque) y después el ranking
      this.endShownFor = true;
      this.cinematicRunning = true;
      const r = v.result!;
      const won = r.winners.includes(v.you);
      const tiles = this.lastPlay && r.winners.includes(this.lastPlay.player) ? this.lastPlay.tiles : [];
      if (won) {
        sfx.win();
        vibrate([30, 50, 30, 50, 80]);
      } else sfx.lose();
      const skip = () => this.board.skipCinematic();
      window.addEventListener('pointerdown', skip, { once: true });
      void this.board.playCinematic(tiles, { confetti: won }).then(() => {
        window.removeEventListener('pointerdown', skip);
        this.cinematicRunning = false;
        const latest = this.ctl.view;
        if (latest?.status === 'ended') this.showEnd(latest);
      });
      return;
    }
    const r = v.result!;
    const won = r.winners.includes(v.you);
    const shared = r.winners.length > 1;
    const m = v.match;
    const champs = m?.champions ?? null;
    let title = won ? (shared ? t('end.sharedWin') : t('end.win')) : t('end.lose');
    if (m && !champs) title = won ? t('match.wonGame') : t('match.lostGame');
    const champLine = champs
      ? champs.includes(v.you)
        ? t('match.youChampion')
        : t('match.champion', { name: champs.map((c) => escapeHtml(v.players[c]?.name ?? '')).join(', ') })
      : '';
    const matchBoard = m
      ? `<p class="muted" style="margin:10px 0 2px">${t('match.board')} · ${t('mode.bo3')}</p>
         <div class="match-board">${v.players
           .map((p, i) => `<span>${escapeHtml(p.avatar)} ${escapeHtml(p.name)}<b class="pips">${'●'.repeat(m.wins[i] ?? 0)}${'○'.repeat(Math.max(0, winsNeeded(m.bestOf) - (m.wins[i] ?? 0)))}</b></span>`)
           .join('')}</div>`
      : '';
    const rematchLabel = m ? (champs ? t('match.newTourney') : t('match.next', { game: m.game + 1, max: m.bestOf })) : t('end.rematch');
    const winnerNames = r.winners.map((w) => escapeHtml(v.players[w]?.name ?? '')).join(', ');
    const reason = r.reason === 'out' ? t('end.reasonOut', { name: winnerNames }) : t('end.reasonPool');
    // Ranking: menos puntos primero
    const order = v.players.map((_, i) => i).sort((a, b) => r.points[a]! - r.points[b]! || a - b);
    const rows = order
      .map((seat, i) => {
        const p = v.players[seat]!;
        const cls = [r.winners.includes(seat) ? 'win' : '', seat === v.you ? 'me' : ''].join(' ');
        return `<li class="${cls}"><span class="pos">${r.winners.includes(seat) ? '🏆' : i + 1}</span>
          <span class="nm">${escapeHtml(p.avatar)} ${escapeHtml(p.name)}${p.replaced ? ' 🤖' : ''}</span>
          <span class="pts">${r.points[seat]}</span><span class="wins">${p.wins} ✓</span></li>`;
      })
      .join('');
    const voters = v.players.map((p, i) => (p.connected && !p.replaced && !p.isBot ? i : -1)).filter((i) => i >= 0);
    const yes = voters.filter((i) => v.rematch[i]).length;
    const iAsked = !!v.rematch[v.you];
    const asked = voters.filter((i) => i !== v.you && v.rematch[i]).map((i) => escapeHtml(v.players[i]!.name));
    const html = `
      <div class="end-card">
        <div style="font-size:54px">${champs ? (champs.includes(v.you) ? '🏆' : '🥈') : won ? '🏆' : '😔'}</div>
        <div class="end-title ${won ? 'win' : ''}">${title}</div>
        ${champLine ? `<p class="champion">${champLine}</p>` : ''}
        <p class="muted">${reason}</p>
        ${matchBoard}
        <ol class="rank">${rows}</ol>
        <p class="muted" style="font-size:12px;margin:0 0 6px">${t('end.points')} · ✓ = ${t('end.score')}</p>
        ${asked.length && !iAsked ? `<p style="color:var(--gold)">${t('end.rematchAsked', { name: asked.join(', ') })}</p>` : ''}
        <div class="actions-row">
          <button class="btn" id="end-menu">${t('end.menu')}</button>
          <button class="btn btn-gold" id="end-rematch" ${iAsked ? 'disabled' : ''}>${
            iAsked ? `${t('end.rematchWaiting')} ${yes}/${voters.length}` : `${rematchLabel}${voters.length > 2 ? ` ${yes}/${voters.length}` : ''}`
          }</button>
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
    void first;
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
