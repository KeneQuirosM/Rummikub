import { ALLOWED_TURN_SECONDS, ROOM_CODE_REGEX } from '@rummi/shared';
import { setLang, t, type Lang } from '../i18n';
import { AVATARS, profile, settings, updateProfile, updateSettings, type QualitySetting } from '../settings';
import { escapeHtml, modal } from './dom';

function seg<T extends string | number>(name: string, options: { v: T; label: string }[], current: T): string {
  return `<div class="seg" data-seg="${name}">${options
    .map((o) => `<button type="button" data-v="${o.v}" class="${o.v === current ? 'on' : ''}">${escapeHtml(o.label)}</button>`)
    .join('')}</div>`;
}

function bindSeg(root: HTMLElement, name: string, cb: (v: string) => void) {
  const el = root.querySelector<HTMLElement>(`[data-seg="${name}"]`)!;
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    cb(b.dataset.v!);
  });
}

function sw(name: string, on: boolean): string {
  return `<label class="switch"><input type="checkbox" data-sw="${name}" ${on ? 'checked' : ''}/><span></span></label>`;
}

export function openSettings(opts: { onTutorial?: () => void; inGame?: boolean } = {}) {
  const timerOpts = ALLOWED_TURN_SECONDS.map((s) => ({ v: s as number, label: s === 0 ? '∞' : `${s}s` }));
  const m = modal(`
    <h2>${t('settings.title')}</h2>
    <div class="row"><span>${t('settings.language')}</span>${seg<Lang>('lang', [{ v: 'es', label: 'Español' }, { v: 'en', label: 'English' }], settings.lang)}</div>
    <div class="row"><span>${t('settings.sound')}</span>${sw('sound', settings.sound)}</div>
    <div class="row"><span>${t('settings.vibration')}</span>${sw('vibration', settings.vibration)}</div>
    <div class="row"><span>${t('settings.symbols')}</span>${sw('symbols', settings.symbols)}</div>
    <div class="row"><span>${t('settings.fullscreen')}</span>${sw('fullscreen', settings.fullscreen)}</div>
    <div class="row" style="flex-wrap:wrap"><span>${t('settings.quality')}</span>${seg<QualitySetting>(
      'quality',
      (['auto', 'high', 'medium', 'low'] as const).map((q) => ({ v: q, label: t(`settings.quality.${q}`) })),
      settings.quality,
    )}</div>
    ${opts.inGame ? '' : `<div class="row" style="flex-wrap:wrap"><span>${t('settings.timer')}</span>${seg('timer', timerOpts, settings.turnSeconds)}</div>`}
    <div class="actions-row">
      ${opts.onTutorial ? `<button class="btn" id="st-tut">${t('settings.tutorial')}</button>` : ''}
      <button class="btn btn-gold" data-close>${t('common.ok')}</button>
    </div>`);
  const el = m.el;
  bindSeg(el, 'lang', (v) => {
    updateSettings({ lang: v as Lang });
    setLang(v as Lang);
    m.close();
    openSettings(opts);
  });
  bindSeg(el, 'quality', (v) => updateSettings({ quality: v as QualitySetting }));
  if (!opts.inGame) bindSeg(el, 'timer', (v) => updateSettings({ turnSeconds: Number(v) }));
  el.querySelectorAll<HTMLInputElement>('[data-sw]').forEach((inp) =>
    inp.addEventListener('change', () => updateSettings({ [inp.dataset.sw!]: inp.checked })),
  );
  el.querySelector('#st-tut')?.addEventListener('click', () => {
    m.close();
    opts.onTutorial?.();
  });
}

export function openHowTo(onTutorial?: () => void) {
  const m = modal(`
    <h2>${t('howto.title')}</h2>
    <div>${t('howto.body')}</div>
    <div class="actions-row">
      ${onTutorial ? `<button class="btn" id="ht-tut">${t('howto.tutorial')}</button>` : ''}
      <button class="btn btn-gold" data-close>${t('common.close')}</button>
    </div>`);
  m.el.querySelector('#ht-tut')?.addEventListener('click', () => {
    m.close();
    onTutorial?.();
  });
}

export function openJoin(onJoin: (code: string) => void, initial = '') {
  const m = modal(`
    <h2>${t('join.title')}</h2>
    <form id="join-form">
      <input class="text-input code-input" id="join-code" maxlength="4" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="${t('join.placeholder')}" value="${escapeHtml(initial)}"/>
      <div class="actions-row">
        <button type="button" class="btn" data-close>${t('common.cancel')}</button>
        <button class="btn btn-gold" id="join-go" disabled>${t('join.go')}</button>
      </div>
    </form>`);
  const input = m.el.querySelector<HTMLInputElement>('#join-code')!;
  const go = m.el.querySelector<HTMLButtonElement>('#join-go')!;
  const check = () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    go.disabled = !ROOM_CODE_REGEX.test(input.value);
  };
  input.addEventListener('input', check);
  check();
  setTimeout(() => input.focus(), 50);
  m.el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    if (go.disabled) return;
    m.close();
    onJoin(input.value);
  });
}

export function openProfile(onSave: () => void) {
  let avatar = profile.avatar;
  const m = modal(`
    <h2>${t('profile.title')}</h2>
    <label class="muted" for="pf-name">${t('profile.name')}</label>
    <input class="text-input" id="pf-name" maxlength="16" value="${escapeHtml(profile.name)}" autocomplete="nickname"/>
    <p class="muted" style="margin:14px 0 0">${t('profile.avatar')}</p>
    <div class="avatar-grid">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
    <div class="actions-row">
      <button class="btn" data-close>${t('common.cancel')}</button>
      <button class="btn btn-gold" id="pf-save">${t('profile.save')}</button>
    </div>`);
  m.el.querySelector('.avatar-grid')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    avatar = b.dataset.a!;
    m.el.querySelectorAll('.avatar-grid button').forEach((x) => x.classList.toggle('on', x === b));
  });
  m.el.querySelector('#pf-save')!.addEventListener('click', () => {
    updateProfile({ name: m.el.querySelector<HTMLInputElement>('#pf-name')!.value, avatar });
    m.close();
    onSave();
  });
}
