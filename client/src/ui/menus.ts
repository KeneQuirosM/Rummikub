import { ALLOWED_TURN_SECONDS, ROOM_CODE_REGEX } from '@rummi/shared';
import { setLang, t, type Lang } from '../i18n';
import { AVATARS, profile, settings, updateProfile, updateSettings, type QualitySetting } from '../settings';
import { accountState, onAccountChange, signInWithEmail, signInWithGoogle, signOut, syncProfile, type AccountState } from '../account';
import { escapeHtml, modal } from './dom';

const GOOGLE_ICON = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

/** Sección "Cuenta" del perfil: invitado → vincular con Google o correo; con cuenta → cerrar sesión. */
function accountHtml(s: AccountState): string {
  if (!s.enabled) return '';
  const u = s.user;
  if (u && !u.anonymous) {
    const via = u.providers.includes('google') ? 'Google' : t('account.viaEmail');
    return `<div class="account-box linked">
      <p class="account-title">✅ ${t('account.linked')}</p>
      <p class="muted account-who">${escapeHtml(u.email ?? '')} · ${via}</p>
      <p class="muted account-note">${t('account.linkedNote')}</p>
      <button type="button" class="btn btn-ghost" id="ac-out">${t('account.signOut')}</button>
    </div>`;
  }
  return `<div class="account-box">
    <p class="account-title">☁️ ${t('account.save')}</p>
    <p class="muted account-note">${t('account.guestNote')}</p>
    <button type="button" class="btn btn-google" id="ac-google">${GOOGLE_ICON}<span>${t('account.google')}</span></button>
    <div class="account-or"><span>${t('account.or')}</span></div>
    <form class="email-row" id="ac-email-form">
      <input class="text-input" type="email" id="ac-email" required autocomplete="email" inputmode="email" placeholder="${t('account.emailPh')}"/>
      <button type="submit" class="btn" id="ac-email-send">${t('account.sendLink')}</button>
    </form>
    <p class="account-msg" id="ac-msg" role="status"></p>
  </div>`;
}

function bindAccount(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>('#pf-account');
  if (!box) return;
  const msg = (text: string, kind: 'ok' | 'error' = 'ok') => {
    const el = box.querySelector<HTMLElement>('#ac-msg');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  };
  box.querySelector('#ac-google')?.addEventListener('click', async (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    const r = await signInWithGoogle();
    if (!r.ok) {
      (e.currentTarget as HTMLButtonElement).disabled = false;
      msg(t('account.error'), 'error');
    }
  });
  box.querySelector('#ac-email-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = box.querySelector<HTMLInputElement>('#ac-email')!;
    const btn = box.querySelector<HTMLButtonElement>('#ac-email-send')!;
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg(t('account.badEmail'), 'error');
    btn.disabled = true;
    const r = await signInWithEmail(email);
    btn.disabled = false;
    if (r.ok) msg(t(r.mode === 'login' ? 'account.sentLogin' : 'account.sentLink', { email }));
    else msg(/rate|limit|seconds/i.test(r.error ?? '') ? t('account.rateLimited') : t('account.error'), 'error');
  });
  box.querySelector('#ac-out')?.addEventListener('click', () => void signOut());
}

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
    <div class="row"><span>${t('theme.title')}</span><button type="button" class="btn" id="st-custom" style="min-height:40px">🎨 ${t('theme.open')}</button></div>
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
  el.querySelector('#st-custom')!.addEventListener('click', () => {
    m.close();
    void import('./customize').then((c) => c.openCustomize());
  });
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
  let offAccount: () => void = () => {};
  const m = modal(`
    <h2>${t('profile.title')}</h2>
    <label class="muted" for="pf-name">${t('profile.name')}</label>
    <input class="text-input" id="pf-name" maxlength="16" value="${escapeHtml(profile.name)}" autocomplete="nickname"/>
    <p class="muted" style="margin:14px 0 0">${t('profile.avatar')}</p>
    <div class="avatar-grid">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
    <div id="pf-account">${accountHtml(accountState())}</div>
    <div class="actions-row">
      <button class="btn" data-close>${t('common.cancel')}</button>
      <button class="btn btn-gold" id="pf-save">${t('profile.save')}</button>
    </div>`, { onClose: () => offAccount() });
  m.el.querySelector('.avatar-grid')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    avatar = b.dataset.a!;
    m.el.querySelectorAll('.avatar-grid button').forEach((x) => x.classList.toggle('on', x === b));
  });
  m.el.querySelector('#pf-save')!.addEventListener('click', () => {
    updateProfile({ name: m.el.querySelector<HTMLInputElement>('#pf-name')!.value, avatar });
    void syncProfile();
    m.close();
    onSave();
  });
  // La sección de cuenta se actualiza sola (vincular, cerrar sesión…)
  bindAccount(m.el);
  let last = JSON.stringify(accountState());
  const off = onAccountChange((st) => {
    const now = JSON.stringify(st);
    if (now === last) return;
    last = now;
    m.el.querySelector('#pf-account')!.innerHTML = accountHtml(st);
    bindAccount(m.el);
  });
  offAccount = off;
}
