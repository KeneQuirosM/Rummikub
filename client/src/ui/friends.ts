/**
 * Amigos: lista con estado (en línea / en partida), invitaciones, ranking y agregar por código.
 * Requiere cuentas (Supabase); el servidor del juego informa quién está conectado.
 */
import {
  accountState,
  addFriendByCode,
  listFriends,
  leaderboard,
  myFriendCode,
  removeFriend,
  respondFriend,
  type Friend,
  type RankRow,
} from '../account';
import { t } from '../i18n';
import { queryPresence, sendInvite } from '../net/presence';
import { confirmDialog, escapeHtml, modal, toast } from './dom';
import { requestResultText } from './friendText';

type Tab = 'friends' | 'ranking' | 'add';

export interface FriendsOptions {
  /** Sala de espera abierta: los amigos en línea se pueden invitar a ella. */
  roomCode?: string;
  /** Desde el menú: crear una sala e invitar a este amigo. */
  onPlayWith?: (friendId: string) => void;
  /** Cambió la cantidad de solicitudes pendientes (para el globito del menú). */
  onPending?: (n: number) => void;
  tab?: Tab;
}


export function openFriends(opts: FriendsOptions = {}) {
  let tab: Tab = opts.tab ?? 'friends';
  let friends: Friend[] | null | undefined; // undefined = cargando, null = no disponible
  let ranking: RankRow[] | null | undefined;
  let online = new Set<string>();
  let playing = new Set<string>();
  const invited = new Set<string>();

  const unavailable = () => `<p class="muted friends-empty">${t('friends.unavailable')}</p>`;
  const loading = () => `<p class="muted friends-empty">${t('friends.loading')}</p>`;

  const presence = (id: string) =>
    playing.has(id)
      ? `<span class="presence playing">${t('friends.playing')}</span>`
      : online.has(id)
        ? `<span class="presence online">${t('friends.online')}</span>`
        : `<span class="presence">${t('friends.offline')}</span>`;

  const friendsTab = () => {
    if (friends === undefined) return loading();
    if (friends === null) return unavailable();
    const incoming = friends.filter((f) => f.status === 'incoming');
    const outgoing = friends.filter((f) => f.status === 'outgoing');
    const list = friends
      .filter((f) => f.status === 'friend')
      .sort((a, b) => Number(online.has(b.userId)) - Number(online.has(a.userId)) || a.name.localeCompare(b.name));
    const row = (f: Friend, actions: string, sub = presence(f.userId)) => `<li class="friend-row">
        <span class="avatar">${escapeHtml(f.avatar)}</span>
        <span class="who"><b>${escapeHtml(f.name)}</b>${sub}</span>
        <span class="acts">${actions}</span>
      </li>`;
    const canInvite = (f: Friend) => online.has(f.userId) && !playing.has(f.userId);
    const mainAction = (f: Friend) => {
      if (opts.roomCode)
        return invited.has(f.userId)
          ? `<button class="btn btn-sm" disabled>${t('friends.invited')}</button>`
          : `<button class="btn btn-sm btn-gold" data-act="invite" data-id="${f.userId}" ${canInvite(f) ? '' : 'disabled'}>${t('friends.invite')}</button>`;
      if (opts.onPlayWith)
        return `<button class="btn btn-sm btn-gold" data-act="play" data-id="${f.userId}" ${canInvite(f) ? '' : 'disabled'}>${t('friends.play')}</button>`;
      return '';
    };
    return `
      ${incoming.length ? `<h3 class="stats-sub">${t('friends.requests')}</h3><ul class="friend-list">${incoming
        .map((f) => row(f, `<button class="btn btn-sm btn-gold" data-act="accept" data-id="${f.userId}">${t('friends.accept')}</button><button class="btn btn-sm btn-ghost" data-act="decline" data-id="${f.userId}" aria-label="${t('friends.decline')}">✕</button>`, `<span class="presence">${t('friends.wantsYou')}</span>`))
        .join('')}</ul>` : ''}
      ${list.length
        ? `<ul class="friend-list">${list.map((f) => row(f, `${mainAction(f)}<button class="btn btn-sm btn-ghost" data-act="remove" data-id="${f.userId}" aria-label="${t('friends.remove')}">⋯</button>`)).join('')}</ul>`
        : `<p class="muted friends-empty">${t('friends.none')}</p>
           <button class="btn" data-tab="add">➕ ${t('friends.addTitle')}</button>`}
      ${outgoing.length ? `<h3 class="stats-sub">${t('friends.sent')}</h3><ul class="friend-list">${outgoing
        .map((f) => row(f, `<button class="btn btn-sm btn-ghost" data-act="cancel" data-id="${f.userId}">${t('common.cancel')}</button>`, `<span class="presence">${t('friends.pending')}</span>`))
        .join('')}</ul>` : ''}`;
  };

  const rankingTab = () => {
    if (ranking === undefined) return loading();
    if (ranking === null) return unavailable();
    if (ranking.length <= 1) return `<p class="muted friends-empty">${t('friends.rankEmpty')}</p>`;
    const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
    return `<ul class="rank-list">${ranking
      .map((r, i) => {
        const pct = r.played ? Math.round((r.won / r.played) * 100) : 0;
        const duel = !r.isMe && r.together ? `<small>${t('friends.vsYou', { me: r.myWins, them: r.theirWins })}</small>` : '';
        return `<li class="${r.isMe ? 'me' : ''}">
          <span class="pos">${medal(i)}</span>
          <span class="avatar">${escapeHtml(r.avatar)}</span>
          <span class="who"><b>${escapeHtml(r.name)}${r.isMe ? ` · ${t('friends.you')}` : ''}</b><small>${t('friends.rankLine', { won: r.won, played: r.played, pct })}</small>${duel}</span>
          <span class="wins">${r.won}<small>🏆</small></span>
        </li>`;
      })
      .join('')}</ul>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">${t('friends.rankNote')}</p>`;
  };

  const addTab = () => {
    const code = myFriendCode();
    return `
      <p class="muted" style="margin:0 0 6px">${t('friends.myCode')}</p>
      ${code
        ? `<div class="friend-code" id="fr-mycode">${code}</div>
           <div class="actions-row" style="margin-top:8px"><button class="btn" id="fr-share">🔗 ${t('friends.shareCode')}</button></div>`
        : unavailable()}
      <form class="email-row" id="fr-add-form" style="margin-top:16px">
        <input class="text-input code-input" id="fr-code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('friends.codePh')}" required/>
        <button class="btn btn-gold" type="submit">${t('friends.add')}</button>
      </form>
      <p class="account-msg" id="fr-msg" role="status"></p>
      <p class="muted" style="font-size:13px;margin:10px 0 0">${t('friends.addHint')}</p>`;
  };

  const render = () => {
    const pending = friends ? friends.filter((f) => f.status === 'incoming').length : 0;
    const body = tab === 'friends' ? friendsTab() : tab === 'ranking' ? rankingTab() : addTab();
    const anon = accountState().user?.anonymous;
    return `
      <h2>👥 ${t('friends.title')}</h2>
      <div class="seg stats-tabs" data-seg="tab">
        ${(['friends', 'ranking', 'add'] as Tab[])
          .map((x) => `<button type="button" data-v="${x}" class="${x === tab ? 'on' : ''}">${t(`friends.tab.${x}`)}${x === 'friends' && pending ? ` <i class="dot-badge">${pending}</i>` : ''}</button>`)
          .join('')}
      </div>
      <div class="friends-body">${body}</div>
      ${anon ? `<p class="muted" style="font-size:12px;text-align:center;margin:12px 0 0">${t('friends.guestNote')}</p>` : ''}
      <div class="actions-row"><button class="btn btn-gold" data-close>${t('common.close')}</button></div>`;
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const m = modal(render(), { className: 'friends-modal', onClose: () => timer && clearInterval(timer) });
  const redraw = () => {
    // Conservar lo escrito en el campo de código
    const typed = m.el.querySelector<HTMLInputElement>('#fr-code')?.value;
    m.el.innerHTML = render();
    if (typed) m.el.querySelector<HTMLInputElement>('#fr-code')!.value = typed;
  };

  const refreshPresence = async () => {
    const ids = (friends ?? []).filter((f) => f.status === 'friend').map((f) => f.userId);
    const p = await queryPresence(ids);
    online = new Set(p.online);
    playing = new Set(p.playing);
    if (tab === 'friends') redraw();
  };
  const loadFriends = async () => {
    friends = await listFriends();
    opts.onPending?.(friends ? friends.filter((f) => f.status === 'incoming').length : 0);
    if (tab === 'friends') redraw();
    await refreshPresence();
  };
  const loadRanking = async () => {
    ranking = await leaderboard();
    if (tab === 'ranking') redraw();
  };
  void loadFriends();
  void loadRanking();
  timer = setInterval(() => void refreshPresence(), 10_000);

  m.el.addEventListener('submit', async (e) => {
    const form = (e.target as HTMLElement).closest('#fr-add-form');
    if (!form) return;
    e.preventDefault();
    const input = m.el.querySelector<HTMLInputElement>('#fr-code')!;
    const code = input.value.trim().toUpperCase();
    const msg = m.el.querySelector<HTMLElement>('#fr-msg')!;
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      msg.textContent = t('friends.res.not_found');
      msg.dataset.kind = 'error';
      return;
    }
    const r = requestResultText(await addFriendByCode(code));
    msg.textContent = r.text;
    msg.dataset.kind = r.ok ? 'ok' : 'error';
    if (r.ok) {
      input.value = '';
      void loadFriends();
      void loadRanking();
    }
  });

  m.el.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement;
    const tb = el.closest<HTMLButtonElement>('.stats-tabs button[data-v], [data-tab]');
    if (tb) {
      tab = (tb.dataset.v ?? tb.dataset.tab) as Tab;
      redraw();
      return;
    }
    if (el.closest('#fr-share')) {
      const code = myFriendCode();
      if (!code) return;
      const text = t('friends.shareText', { code, url: location.origin });
      if (navigator.share) void navigator.share({ text }).catch(() => {});
      else void navigator.clipboard?.writeText(text).then(() => toast(t('room.copied'), 'ok'));
      return;
    }
    const b = el.closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const id = b.dataset.id!;
    const f = friends?.find((x) => x.userId === id);
    b.disabled = true;
    switch (b.dataset.act) {
      case 'accept':
      case 'decline':
        await respondFriend(id, b.dataset.act === 'accept');
        await loadFriends();
        void loadRanking();
        break;
      case 'cancel':
        await removeFriend(id);
        await loadFriends();
        break;
      case 'remove':
        if (await confirmDialog(t('friends.removeConfirm', { name: f?.name ?? '' }), t('friends.remove'), t('common.cancel'))) {
          await removeFriend(id);
          await loadFriends();
          void loadRanking();
        } else b.disabled = false;
        break;
      case 'invite': {
        const r = await sendInvite(id, opts.roomCode!);
        if (r.ok) {
          invited.add(id);
          toast(t('friends.inviteSent', { name: f?.name ?? '' }), 'ok');
        } else toast(t(`err.${r.error}`), 'error');
        redraw();
        break;
      }
      case 'play':
        m.close();
        opts.onPlayWith?.(id);
        break;
    }
  });
}
