/**
 * Sonidos sintetizados con WebAudio: cero archivos que descargar.
 */
import { settings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!settings.sound) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Desbloquea el audio en el primer gesto del usuario (iOS/Android). */
export function unlockAudio(): void {
  const once = () => {
    ac();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

function noise(c: AudioContext, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.3, dur + 0.05);
}

function tone(c: AudioContext, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  /** Clic de ficha al levantarla */
  pick() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.04, 3200, 4, 0.5);
    tone(c, t, 1800, 0.03, 0.08, 'triangle');
  },
  /** Ficha que cae sobre la mesa */
  drop() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.07, 1400, 2.5, 0.9);
    tone(c, t, 220, 0.09, 0.25, 'sine', 120);
    noise(c, t + 0.035, 0.03, 2400, 5, 0.25);
  },
  /** Ficha que se acomoda en el atril */
  rack() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.05, 2000, 3, 0.5);
  },
  draw() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    noise(c, t, 0.18, 900, 1.2, 0.35, 'lowpass');
    noise(c, t + 0.16, 0.05, 2200, 3, 0.5);
  },
  turn() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 784, 0.35, 0.18, 'sine');
    tone(c, t + 0.12, 1175, 0.5, 0.15, 'sine');
    tone(c, t + 0.12, 2350, 0.3, 0.03, 'triangle');
  },
  valid() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 1318, 0.25, 0.08, 'sine');
    tone(c, t + 0.06, 1760, 0.3, 0.06, 'sine');
  },
  invalid() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 220, 0.18, 0.12, 'triangle', 180);
    tone(c, t + 0.1, 196, 0.2, 0.1, 'triangle', 160);
  },
  win() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(c, t + i * 0.11, f, 0.6, 0.16, 'triangle');
      tone(c, t + i * 0.11, f * 2, 0.4, 0.04, 'sine');
    });
    tone(c, t + 0.6, 1047, 1.2, 0.12, 'sine');
  },
  lose() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    [392, 349, 311].forEach((f, i) => tone(c, t + i * 0.18, f, 0.5, 0.12, 'triangle'));
  },
  pop() {
    const c = ac();
    if (!c) return;
    tone(c, c.currentTime, 900, 0.12, 0.1, 'sine', 1400);
  },
};

export function vibrate(pattern: number | number[]): void {
  if (!settings.vibration) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
}
