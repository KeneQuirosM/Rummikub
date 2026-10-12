/**
 * Renderer único y persistente. Renderiza bajo demanda (solo cuando algo cambia) y ajusta
 * la calidad automáticamente si detecta fps bajos.
 */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { settings, type QualitySetting } from '../settings';
import { createAtlas } from './textures';
import { TileResources } from './tileset';

export type Quality = 'high' | 'medium' | 'low';

export interface EngineScene {
  /** Dibuja la escena (puede usar varios viewports). */
  render(r: THREE.WebGLRenderer): void;
  /** Llamado cada frame en que se renderiza. */
  update?(dt: number): void;
  resize(w: number, h: number): void;
  /** true mientras necesite animación continua (p. ej. fondo del menú). */
  continuous?(): boolean;
  setQuality?(q: Quality): void;
  dispose(): void;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly res: TileResources;
  private scene: EngineScene | null = null;
  private dirty = true;
  private lastRender = 0;
  quality: Quality = 'high';
  width = 1;
  height = 1;
  private frameTimes: number[] = [];
  private lastDowngrade = 0;
  private consecutive = 0;
  private resizeObs: ResizeObserver;
  onQualityChange: (q: Quality) => void = () => {};
  /** fps medidos (para depuración/HUD). */
  fps = 60;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.res = new TileResources(createAtlas(settings.symbols));
    this.applyQualitySetting(settings.quality);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    gsap.ticker.add(this.tick);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.invalidate());
  }

  setSymbols(on: boolean) {
    this.res.setAtlas(createAtlas(on, this.quality === 'low' ? 96 : 128));
    this.invalidate();
  }

  applyQualitySetting(q: QualitySetting) {
    this.setQuality(q === 'auto' ? (this.isLowEnd() ? 'medium' : 'high') : q);
  }

  private isLowEnd(): boolean {
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return (mem !== undefined && mem <= 3) || (navigator.hardwareConcurrency ?? 8) <= 4;
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(this.width, this.height, false);
    this.scene?.setQuality?.(q);
    this.onQualityChange(q);
    this.invalidate();
  }

  setScene(s: EngineScene | null) {
    if (this.scene && this.scene !== s) this.scene.dispose();
    this.scene = s;
    if (s) {
      s.setQuality?.(this.quality);
      s.resize(this.width, this.height);
    }
    this.invalidate();
  }

  get current(): EngineScene | null {
    return this.scene;
  }

  invalidate = () => {
    this.dirty = true;
  };

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.scene?.resize(w, h);
    this.invalidate();
  }

  private tick = (_time: number, deltaMs: number) => {
    if (!this.scene || document.hidden) return;
    const continuous = this.scene.continuous?.() ?? false;
    const now = performance.now();
    // En modo continuo "ocioso" (menú) limitamos a ~30 fps para ahorrar batería
    if (!this.dirty && !continuous) {
      this.consecutive = 0;
      return;
    }
    if (!this.dirty && continuous && now - this.lastRender < 30) return;
    this.dirty = false;
    this.scene.update?.(Math.min(deltaMs, 50) / 1000);
    this.renderer.clear();
    this.scene.render(this.renderer);
    this.lastRender = now;
    this.measure(deltaMs, continuous);
  };

  /** Detección de fps bajos durante animaciones sostenidas. */
  private measure(deltaMs: number, continuous: boolean) {
    this.consecutive++;
    if (this.consecutive < 3 || continuous) return; // solo medimos frames consecutivos de animación real
    this.frameTimes.push(deltaMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1000 / avg;
    const now = performance.now();
    if (settings.quality === 'auto' && avg > 26 && now - this.lastDowngrade > 4000 && this.quality !== 'low') {
      this.lastDowngrade = now;
      this.frameTimes = [];
      this.setQuality(this.quality === 'high' ? 'medium' : 'low');
    }
  }

  dispose() {
    gsap.ticker.remove(this.tick);
    this.resizeObs.disconnect();
    this.scene?.dispose();
    this.res.dispose();
    this.renderer.dispose();
  }
}
