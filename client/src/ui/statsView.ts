import { getLang, t } from '../i18n';
import { ACHIEVEMENTS } from '@rummi/shared';
import { accountState, addFriendById, onAccountChange, refreshStats } from '../account';
import { clearStats, combinedTotals, currentStats, type GameRecord, type ModeTotals } from '../stats';
import { confirmDialog, escapeHtml, modal, toast } from './dom';
import { requestResultText } from './friendText';

type Tab = 'all' | 'online' | 'bot' | 'ach';

function fmtDuration(sec: number): string {
  if (!sec) return '–';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`;
}

function fmtDate(at: number): string {
  try {
    return new Intl.DateTimeFormat(getLang() === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
  } catch {
    return new Date(at).toLocaleString();
  }
}

function cards(tt: ModeTotals): string {
  const pct = tt.played ? Math.round((tt.won / tt.played) * 100) : 0;
  const card = (v: string | number, label: string) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  return `<div class="stats-grid">
    ${card(tt.played, t('stats.played'))}
    ${card(tt.won, t('stats.won'))}
    ${card(`${pct}%`, t('stats.winRate'))}
    ${card(tt.streak, t('stats.streak'))}
    ${card(tt.bestStreak, t('stats.bestStreak'))}
    ${card(tt.bestPlay || '–', t('stats.bestPlay'))}
    <div class="stat wide"><b>${fmtDuration(tt.fastestWin)}</b><span>${t('stats.fastestWin')}</span></div>
    <div class="stat wide"><b>🏆 ${tt.tourneys}</b><span>${t('stats.tourneys')}</span></div>
  </div>`;
}

function placeLabel(place: number | undefined, won: boolean | undefined): string {
  if (won) return '🏆';
  return place ? `${place}.º` : '';
}

function detail(r: GameRecord): string {
  const me = accountState().user?.id;
  const canAdd = accountState().enabled && !!me;
  const rivals = r.rivals
    .map((x) => {
      const add =
        canAdd && x.userId && x.userId !== me
          ? `<button class="btn btn-sm" data-add="${escapeHtml(x.userId)}">➕ ${t('friends.add')}</button>`
          : '';
      return `<li><span class="place">${placeLabel(x.place, x.won)}</span><span class="avatar sm">${escapeHtml(x.avatar)}</span>
        <span class="nm">${escapeHtml(x.name)}${x.bot ? ` <small class="muted">(${t('stats.botReplaced')})</small>` : ''}</span>
        ${x.points !== undefined ? `<span class="pts">${x.points}<small>${t('stats.pts')}</small></span>` : ''}${add}</li>`;
    })
    .join('');
  const row = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
  return `<div class="game-detail">
    <ul class="detail-rivals">
      <li class="you"><span class="place">${placeLabel(r.place, r.won)}</span><span class="avatar sm">⭐</span><span class="nm"><b>${t('friends.you')}</b></span><span class="pts">${r.myPoints}<small>${t('stats.pts')}</small></span></li>
      ${rivals}
    </ul>
    <div class="detail-grid">
      ${row(t('stats.duration'), fmtDuration(r.durationSec))}
      ${row(t('stats.bestPlay'), r.bestPlay ? String(r.bestPlay) : '–')}
      ${row(t('stats.draws'), r.draws === undefined ? '–' : String(r.draws))}
      ${row(t('stats.mode'), r.mode === 'bot' ? `🤖 ${r.level ? t(`practice.${r.level}`) : ''}` : `👥 ${t('stats.online')}`)}
    </div>
  </div>`;
}

function history(records: GameRecord[], open: number): string {
  if (!records.length) return `<p class="muted" style="text-align:center;margin:18px 0">${t('stats.empty')}</p>`;
  return `<ul class="history">${records
    .map((r, i) => {
      const mode = r.mode === 'bot' ? `🤖 ${r.level ? t(`practice.${r.level}`) : ''}` : `👥 ${t('stats.online')}`;
      const rivals = r.rivals.map((x) => escapeHtml(x.avatar)).join('');
      return `<li class="${r.won ? 'win' : ''} ${i === open ? 'open' : ''}" data-i="${i}" tabindex="0" role="button" aria-expanded="${i === open}">
        <span class="place">${r.champion ? '👑' : r.won ? '🏆' : `${r.place}.º`}</span>
        <span class="info"><b>${mode}</b> · ${rivals}<br><small>${fmtDate(r.at)} · ${t('stats.of', { n: r.players })} · ${fmtDuration(r.durationSec)}</small></span>
        <span class="pts">${r.myPoints}<small>${t('stats.pts')}</small></span>
        ${i === open ? detail(r) : ''}
      </li>`;
    })
    .join('')}</ul>`;
}

function achievements(got: Partial<Record<string, number>>): string {
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  return `<p class="muted ach-count">${t('ach.count', { n, total: ACHIEVEMENTS.length })}</p>
  <ul class="ach-grid">${ACHIEVEMENTS.map((a) => {
    const at = got[a.id];
    return `<li class="${at ? 'on' : ''}">
      <span class="ach-icon">${at ? a.icon : '🔒'}</span>
      <b>${t(`ach.${a.id}`)}</b>
      <small>${t(`ach.${a.id}.desc`)}</small>
      ${at ? `<small class="when">${fmtDate(at)}</small>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

export function openStats() {
  let tab: Tab = 'all';
  let open = -1;
  const render = () => {
    const d = currentStats();
    const u = accountState().user;
    const inCloud = !!u && accountState().enabled;
    const totals = tab === 'all' || tab === 'ach' ? combinedTotals(d) : d.totals[tab];
    const recs = tab === 'all' || tab === 'ach' ? d.records : d.records.filter((r) => r.mode === tab);
    return `
      <h2>📊 ${t('stats.title')}</h2>
      <div class="seg stats-tabs" data-seg="tab">
        ${(['all', 'online', 'bot', 'ach'] as Tab[]).map((x) => `<button type="button" data-v="${x}" class="${x === tab ? 'on' : ''}">${t(`stats.tab.${x}`)}</button>`).join('')}
      </div>
      ${tab === 'ach'
        ? achievements(d.achievements)
        : `${cards(totals)}
      <h3 class="stats-sub">${t('stats.history')} <small class="muted">· ${t('stats.tapForDetail')}</small></h3>
      ${history(recs, open)}`}
      <div class="actions-row">
        ${inCloud ? '' : `<button class="btn btn-ghost" id="st-clear">${t('stats.clear')}</button>`}
        <button class="btn btn-gold" data-close>${t('common.close')}</button>
      </div>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">${t(inCloud ? 'stats.cloud' : 'stats.local')}</p>`;
  };
  let off: () => void = () => {};
  const m = modal(render(), { className: 'stats-modal', onClose: () => off() });
  // Con cuenta: traer lo último de la nube y redibujar
  off = onAccountChange(() => (m.el.innerHTML = render()));
  void refreshStats();
  m.el.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLButtonElement>('.stats-tabs button[data-v]');
    if (b) {
      tab = b.dataset.v as Tab;
      open = -1;
      m.el.innerHTML = render();
      return;
    }
    // Agregar como amigo a alguien con quien jugué
    const add = target.closest<HTMLButtonElement>('button[data-add]');
    if (add) {
      add.disabled = true;
      const r = requestResultText(await addFriendById(add.dataset.add!));
      toast(r.text, r.ok ? 'ok' : 'error');
      if (r.ok) add.textContent = '✓';
      else add.disabled = false;
      return;
    }
    // Abrir / cerrar el detalle de una partida
    const li = target.closest<HTMLElement>('.history > li[data-i]');
    if (li && !target.closest('.game-detail')) {
      const i = Number(li.dataset.i);
      open = open === i ? -1 : i;
      const scroll = m.el.scrollTop;
      m.el.innerHTML = render();
      m.el.scrollTop = scroll;
      return;
    }
    if (target.closest('#st-clear')) {
      if (await confirmDialog(t('stats.clearConfirm'), t('stats.clear'), t('common.cancel'))) {
        clearStats();
        m.el.innerHTML = render();
      }
    }
  });
}
