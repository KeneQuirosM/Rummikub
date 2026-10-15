import { t } from '../i18n';
import { settings, updateSettings } from '../settings';
import { combinedTotals, currentStats } from '../stats';
import { ACHIEVEMENTS } from '@rummi/shared';
import { BACK_THEMES, TABLE_THEMES, type BackTheme, type TableTheme } from '../three/themes';
import { modal, toast } from './dom';

/** Personalizar mesa y dorsos. Algunos temas se desbloquean con victorias y otros con logros. */
export function openCustomize() {
  const stats = currentStats();
  const wins = combinedTotals(stats).won;
  const isLocked = (x: TableTheme | BackTheme) => (x.unlockAch ? !stats.achievements[x.unlockAch] : wins < x.unlockWins);
  /** Qué falta para desbloquearlo (texto corto bajo el nombre). */
  const needText = (x: TableTheme | BackTheme) => {
    if (!x.unlockAch) return t('theme.need', { n: x.unlockWins });
    const a = ACHIEVEMENTS.find((y) => y.id === x.unlockAch);
    return `${a?.icon ?? '🏅'} ${t(`ach.${x.unlockAch}`)}`;
  };
  const swatch = (kind: 'table' | 'back', x: TableTheme | BackTheme, selected: boolean) => {
    const locked = isLocked(x);
    const name = t(`theme.${kind}.${x.id}`);
    return `<button type="button" class="swatch ${selected ? 'on' : ''} ${locked ? 'locked' : ''}" data-kind="${kind}" data-id="${x.id}" aria-label="${name}">
      <span class="chip ${kind}" style="--c:${x.swatch}">${locked ? '🔒' : selected ? '✓' : ''}</span>
      <span class="nm">${name}</span>
      ${locked ? `<span class="need">${needText(x)}</span>` : ''}
    </button>`;
  };
  const render = () => `
    <h2>🎨 ${t('theme.title')}</h2>
    <p class="muted" style="margin:0 0 6px">${t('theme.table')}</p>
    <div class="swatches">${TABLE_THEMES.map((x) => swatch('table', x, settings.tableTheme === x.id)).join('')}</div>
    <p class="muted" style="margin:14px 0 6px">${t('theme.back')}</p>
    <div class="swatches">${BACK_THEMES.map((x) => swatch('back', x, settings.backTheme === x.id)).join('')}</div>
    <p class="muted" style="font-size:12px;margin:12px 0 0">${t('theme.wins', { n: wins })}</p>
    <div class="actions-row"><button class="btn btn-gold" data-close>${t('common.ok')}</button></div>`;
  const m = modal(render(), { className: 'customize-modal' });
  m.el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
    if (!b) return;
    const theme = (b.dataset.kind === 'table' ? TABLE_THEMES : BACK_THEMES).find((x) => x.id === b.dataset.id)!;
    if (isLocked(theme)) {
      toast(theme.unlockAch ? t('theme.lockedAch', { ach: needText(theme) }) : t('theme.locked', { n: theme.unlockWins - wins }), 'error');
      return;
    }
    if (b.dataset.kind === 'table') updateSettings({ tableTheme: b.dataset.id! });
    else updateSettings({ backTheme: b.dataset.id! });
    m.el.innerHTML = render();
  });
}
