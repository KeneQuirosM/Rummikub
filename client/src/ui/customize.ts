import { t } from '../i18n';
import { settings, updateSettings } from '../settings';
import { combinedTotals, loadStats } from '../stats';
import { BACK_THEMES, TABLE_THEMES } from '../three/themes';
import { modal, toast } from './dom';

/** Personalizar mesa y dorsos. Algunos temas se desbloquean con victorias. */
export function openCustomize() {
  const wins = combinedTotals(loadStats()).won;
  const swatch = (kind: 'table' | 'back', id: string, color: string, need: number, selected: boolean) => {
    const locked = wins < need;
    const name = t(`theme.${kind}.${id}`);
    return `<button type="button" class="swatch ${selected ? 'on' : ''} ${locked ? 'locked' : ''}" data-kind="${kind}" data-id="${id}" data-need="${need}" aria-label="${name}">
      <span class="chip ${kind}" style="--c:${color}">${locked ? '🔒' : selected ? '✓' : ''}</span>
      <span class="nm">${name}</span>
      ${locked ? `<span class="need">${t('theme.need', { n: need })}</span>` : ''}
    </button>`;
  };
  const render = () => `
    <h2>🎨 ${t('theme.title')}</h2>
    <p class="muted" style="margin:0 0 6px">${t('theme.table')}</p>
    <div class="swatches">${TABLE_THEMES.map((x) => swatch('table', x.id, x.swatch, x.unlockWins, settings.tableTheme === x.id)).join('')}</div>
    <p class="muted" style="margin:14px 0 6px">${t('theme.back')}</p>
    <div class="swatches">${BACK_THEMES.map((x) => swatch('back', x.id, x.swatch, x.unlockWins, settings.backTheme === x.id)).join('')}</div>
    <p class="muted" style="font-size:12px;margin:12px 0 0">${t('theme.wins', { n: wins })}</p>
    <div class="actions-row"><button class="btn btn-gold" data-close>${t('common.ok')}</button></div>`;
  const m = modal(render(), { className: 'customize-modal' });
  m.el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
    if (!b) return;
    const need = Number(b.dataset.need);
    if (wins < need) {
      toast(t('theme.locked', { n: need - wins }), 'error');
      return;
    }
    if (b.dataset.kind === 'table') updateSettings({ tableTheme: b.dataset.id! });
    else updateSettings({ backTheme: b.dataset.id! });
    m.el.innerHTML = render();
  });
}
