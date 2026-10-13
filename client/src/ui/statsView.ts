import { getLang, t } from '../i18n';
import { clearStats, combinedTotals, loadStats, type GameRecord, type ModeTotals } from '../stats';
import { confirmDialog, escapeHtml, modal } from './dom';

type Tab = 'all' | 'online' | 'bot';

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
  </div>`;
}

function history(records: GameRecord[]): string {
  if (!records.length) return `<p class="muted" style="text-align:center;margin:18px 0">${t('stats.empty')}</p>`;
  return `<ul class="history">${records
    .map((r) => {
      const mode = r.mode === 'bot' ? `🤖 ${r.level ? t(`practice.${r.level}`) : ''}` : `👥 ${t('stats.online')}`;
      const rivals = r.rivals.map((x) => escapeHtml(x.avatar)).join('');
      return `<li class="${r.won ? 'win' : ''}">
        <span class="place">${r.won ? '🏆' : `${r.place}.º`}</span>
        <span class="info"><b>${mode}</b> · ${rivals}<br><small>${fmtDate(r.at)} · ${t('stats.of', { n: r.players })} · ${fmtDuration(r.durationSec)}</small></span>
        <span class="pts">${r.myPoints}<small>${t('stats.pts')}</small></span>
      </li>`;
    })
    .join('')}</ul>`;
}

export function openStats() {
  let tab: Tab = 'all';
  const render = () => {
    const d = loadStats();
    const totals = tab === 'all' ? combinedTotals(d) : d.totals[tab];
    const recs = tab === 'all' ? d.records : d.records.filter((r) => r.mode === tab);
    return `
      <h2>📊 ${t('stats.title')}</h2>
      <div class="seg stats-tabs" data-seg="tab">
        ${(['all', 'online', 'bot'] as Tab[]).map((x) => `<button type="button" data-v="${x}" class="${x === tab ? 'on' : ''}">${t(`stats.tab.${x}`)}</button>`).join('')}
      </div>
      ${cards(totals)}
      <h3 class="stats-sub">${t('stats.history')}</h3>
      ${history(recs)}
      <div class="actions-row">
        <button class="btn btn-ghost" id="st-clear">${t('stats.clear')}</button>
        <button class="btn btn-gold" data-close>${t('common.close')}</button>
      </div>
      <p class="muted" style="font-size:12px;text-align:center;margin:10px 0 0">${t('stats.local')}</p>`;
  };
  const m = modal(render(), { className: 'stats-modal' });
  m.el.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLButtonElement>('.stats-tabs button[data-v]');
    if (b) {
      tab = b.dataset.v as Tab;
      m.el.innerHTML = render();
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
