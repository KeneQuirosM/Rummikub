import type { GameController } from '../game/controller';
import { t } from '../i18n';
import { updateSettings } from '../settings';
import { $ } from './dom';

interface Step {
  text: string;
  /** Rectángulo a resaltar */
  rect: () => DOMRect | { left: number; top: number; width: number; height: number };
  /** Si existe, el paso avanza solo cuando se cumple */
  waitFor?: (done: () => void) => () => void;
}

/** Tutorial interactivo de ~1 minuto, sobre una partida de práctica real. */
export function startTutorial(ctl: GameController, onEnd: () => void): () => void {
  const rackRect = () => {
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rack-h')) || 160;
    return { left: 4, top: window.innerHeight - h + 2, width: window.innerWidth - 8, height: h - 6 };
  };
  const tableRect = () => {
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rack-h')) || 160;
    const top = $('hud').querySelector('.hud-top')!.getBoundingClientRect().bottom + 30;
    const bottom = window.innerHeight - h - $('actions').getBoundingClientRect().height;
    return { left: 12, top, width: window.innerWidth - 24, height: Math.max(80, bottom - top) };
  };
  const steps: Step[] = [
    { text: t('tut.1'), rect: rackRect },
    {
      text: t('tut.2'),
      rect: () => $('act-sort').getBoundingClientRect(),
      waitFor: (done) => {
        const b = $('act-sort');
        b.addEventListener('click', done, { once: true });
        return () => b.removeEventListener('click', done);
      },
    },
    {
      text: t('tut.3'),
      rect: tableRect,
      waitFor: (done) =>
        ctl.em.on('change', (v) => {
          if (v.playedThisTurn.length > 0) done();
        }),
    },
    { text: t('tut.4'), rect: tableRect },
    { text: t('tut.5'), rect: () => $('actions').getBoundingClientRect() },
  ];

  const root = document.createElement('div');
  root.className = 'tut';
  root.innerHTML = `<div class="tut-hole"></div><div class="card tut-box"><div class="tut-steps"></div><p></p><div class="actions-row" style="display:flex;gap:10px"><button class="btn btn-ghost" data-skip>${t('tut.skip')}</button><button class="btn btn-gold" data-next style="flex:1">${t('tut.next')}</button></div></div>`;
  document.body.appendChild(root);
  const hole = root.querySelector<HTMLElement>('.tut-hole')!;
  const box = root.querySelector<HTMLElement>('.tut-box')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
  let i = 0;
  let unwait: (() => void) | null = null;

  const finish = () => {
    unwait?.();
    root.remove();
    window.removeEventListener('resize', render);
    updateSettings({ tutorialDone: true });
    onEnd();
  };

  const render = () => {
    const s = steps[i]!;
    const r = s.rect();
    hole.style.left = `${r.left - 6}px`;
    hole.style.top = `${r.top - 6}px`;
    hole.style.width = `${r.width + 12}px`;
    hole.style.height = `${r.height + 12}px`;
    box.querySelector('p')!.innerHTML = s.text;
    box.querySelector('.tut-steps')!.innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    // Caja arriba si el resaltado está abajo y viceversa
    const below = r.top + r.height / 2 > window.innerHeight / 2;
    box.style.top = below ? `${Math.max(12, r.top - 220)}px` : `${Math.min(window.innerHeight - 220, r.top + r.height + 16)}px`;
    next.textContent = i === steps.length - 1 ? t('tut.done') : t('tut.next');
    next.hidden = !!s.waitFor;
    // El hueco deja pasar los toques (el resto se bloquea con la caja)
  };

  const go = () => {
    unwait?.();
    unwait = null;
    i++;
    if (i >= steps.length) return finish();
    const s = steps[i]!;
    if (s.waitFor) unwait = s.waitFor(() => setTimeout(go, 350));
    render();
  };

  next.addEventListener('click', go);
  root.querySelector('[data-skip]')!.addEventListener('click', finish);
  window.addEventListener('resize', render);
  render();
  return finish;
}
