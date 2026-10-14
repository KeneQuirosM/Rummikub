/**
 * Escena de juego: mesa 3D (cámara en perspectiva) + atril fijo abajo (cámara ortográfica en px).
 * Gestiona animaciones, arrastrar y soltar, tocar-y-tocar, pan/pinch de cámara y el fantasma del rival.
 */
import * as THREE from 'three';
import { gsap } from 'gsap';
import { analyzeMeld, type DragPayload, type MoveTarget, type PlayerView, type TileId } from '@rummi/shared';
import { sfx, vibrate } from '../audio';
import type { Engine, EngineScene, Quality } from './engine';
import { Confetti } from './effects';
import { TableEnvironment } from './environment';
import { settings } from '../settings';
import { findDropTarget, layoutTable, STEP, type DropTarget, type TableLayout } from './layout';
import { BACK_CELL, cellOf, createWoodTexture } from './textures';
import { opponentSeats } from '../game/seats';
import { TILE_D, TILE_H, TILE_W, TileSet, type TileState } from './tileset';

export interface BoardCallbacks {
  move(tileId: TileId, to: MoveTarget, rackIndex?: number): boolean;
  /** Mover una combinación entera. */
  moveMeld(meldId: string, to: MoveTarget): boolean;
  /** Mover varias fichas del atril juntas (selección múltiple). */
  moveTiles(tileIds: TileId[], to: MoveTarget): boolean;
  /** Reordenar varias fichas del atril juntas. */
  reorderMany(tileIds: TileId[], index: number): void;
  /** Primera vez que se seleccionan varias fichas (para mostrar la ayuda). */
  multiSelectHint?(count: number): void;
  reorder(tileId: TileId, index: number): void;
  drag(d: DragPayload): void;
  notMyTurn(): void;
  selectionChange?(tile: TileId | null): void;
}

export interface BoardInsets {
  /** px tapados arriba por el HUD */
  top: number;
  /** px tapados abajo (barra de acciones) justo encima del atril */
  bottom: number;
  /** safe-area inferior */
  safeBottom: number;
  /** px tapados a la derecha (botones laterales / barra de acciones en landscape) */
  right: number;
  /** px tapados a la izquierda (botones laterales) */
  left: number;
}

type Loc = 'table' | 'rack' | 'none';
type Region = 'rack' | 'main';

interface DragState {
  tileId: TileId;
  origin: 'rack' | 'table';
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  touch: boolean;
  region: Region;
  target: DropTarget | null;
  rackIndex: number;
  lastSent: number;
  /** Arrastre de combinación entera: fichas en orden y combinación de origen. */
  group: TileId[] | null;
  groupMeld: string | null;
  /** Shift en escritorio: arrastrar como grupo desde el primer movimiento. */
  wantGroup: boolean;
  lastX: number;
  lastY: number;
}

/** Tiempo de pulsación para levantar la combinación entera. */
const HOLD_MS = 420;

const EL = THREE.MathUtils.degToRad(58); // elevación de la cámara
const FOV = 38;
const LIFT = 0.85;
const JITTER = (id: number) => ((((id * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.03;

const RACK_RX = Math.PI / 2 - 0.3;
/** Dorsos visibles por rival y montones del pozo (capacidad del InstancedMesh de dorsos). */
const BACKS_PER_OPP = 30;
const POOL_PILES = 12;
const BACK_SCALE = 0.62;
const BACK_STEP = BACK_SCALE * TILE_W + 0.06;
const TINT_ACTIVE = [1.3, 1.12, 0.62] as const;

const TINT_NORMAL = [1, 1, 1] as const;
const TINT_PLAYED = [1.0, 0.95, 0.82] as const;
const TINT_INVALID = [1.0, 0.68, 0.66] as const;
const TINT_SELECTED = [1.05, 0.8, 0.3] as const;

export class BoardScene implements EngineScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private env = new TableEnvironment(16, 12, settings.tableTheme);
  readonly tiles: TileSet;
  private backs: TileSet;
  private ghost: TileSet;
  private ghostMats: THREE.Material[] = [];
  private confetti = new Confetti();
  private placeholder: THREE.Mesh;
  private meldHalo: THREE.Mesh;

  private rackScene = new THREE.Scene();
  private rackCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
  readonly rackTiles: TileSet;
  private rackBg: THREE.Mesh;
  private rackWood: THREE.Texture;
  private rackLip: THREE.Mesh;

  private w = 1;
  private h = 1;
  rackH = 160;
  private tileWpx = 48;
  private rackRows = 2;
  private rackPad = 10;
  private rackGap = 5;
  private perRow = 8;
  private scrollX = 0;
  private insets: BoardInsets = { top: 64, bottom: 64, safeBottom: 0, right: 0, left: 0 };

  view: PlayerView | null = null;
  private rackOrder: TileId[] = [];
  private layout: TableLayout = layoutTable([], 12);
  private rowWidth = 12;
  private baseRowWidth = 12;
  private loc = new Map<TileId, Loc>();
  private meldValid = new Map<string, boolean>();
  /** Selección: una ficha de la mesa, o una o varias del atril. */
  private selection: TileId[] = [];
  private drag: DragState | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'pan' | 'pinch' | 'scroll'; lastX: number; lastY: number; dist: number } | null = null;
  private cam = { tx: 0, tz: 0, dist: 18, yaw: 0 };
  private cinema: { tl: gsap.core.Timeline; done: () => void; tiles: TileId[] } | null = null;
  private userCamera = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpV = new THREE.Vector3();
  private quality: Quality = 'high';
  private disposed = false;
  private interactive = true;

  constructor(private engine: Engine, private cb: BoardCallbacks) {
    const res = engine.res;
    this.scene.background = new THREE.Color(this.env.theme.background);
    this.scene.fog = new THREE.Fog(this.env.theme.background, 30, 70);
    this.scene.add(this.env.group);

    this.tiles = new TileSet(106, res, true);
    this.backs = new TileSet(BACKS_PER_OPP * 3 + POOL_PILES, res, true);
    // Fantasma translúcido para el arrastre del rival
    const gBody = res.bodyMat.clone();
    gBody.transparent = true;
    gBody.opacity = 0.45;
    gBody.depthWrite = false;
    const gFace = res.faceMat.clone();
    gFace.transparent = true;
    gFace.opacity = 0.45;
    gFace.depthWrite = false;
    gFace.onBeforeCompile = res.faceMat.onBeforeCompile;
    gFace.customProgramCacheKey = () => 'tileface-ghost';
    this.ghostMats.push(gBody, gFace);
    this.ghost = new TileSet(1, { ...res, bodyGeo: res.bodyGeo, faceGeo: res.faceGeo, shadowGeo: res.shadowGeo, bodyMat: gBody, faceMat: gFace, shadowMat: res.shadowMat }, true);
    for (const s of [this.tiles, this.backs, this.ghost]) {
      s.onDirty = engine.invalidate;
      this.scene.add(s.group);
    }
    this.scene.add(this.confetti.mesh);

    const phGeo = new THREE.PlaneGeometry(TILE_W * 1.02, TILE_D * 1.02);
    phGeo.rotateX(-Math.PI / 2);
    this.placeholder = new THREE.Mesh(
      phGeo,
      new THREE.MeshBasicMaterial({ color: 0xf2c75c, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.placeholder.position.y = 0.01;
    this.placeholder.visible = false;
    this.scene.add(this.placeholder);
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    haloGeo.rotateX(-Math.PI / 2);
    this.meldHalo = new THREE.Mesh(
      haloGeo,
      new THREE.MeshBasicMaterial({ color: 0xf2c75c, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.meldHalo.position.y = 0.006;
    this.meldHalo.visible = false;
    this.scene.add(this.meldHalo);

    // Atril
    this.rackWood = createWoodTexture();
    this.rackWood.wrapS = THREE.MirroredRepeatWrapping;
    this.rackWood.repeat.set(2, 1);
    this.rackBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: this.rackWood, roughness: 0.6 }));
    this.rackBg.position.z = -200;
    this.rackLip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe0b45a }));
    this.rackLip.position.z = -150;
    this.rackScene.add(this.rackBg, this.rackLip);
    this.rackScene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2a1a, 1.4));
    const rk = new THREE.DirectionalLight(0xffe2b8, 1.6);
    rk.position.set(-0.3, 1, 2);
    this.rackScene.add(rk);
    this.rackTiles = new TileSet(106, res, false);
    this.rackTiles.onDirty = engine.invalidate;
    this.rackScene.add(this.rackTiles.group);
    this.rackCam.position.z = 500;

    this.bindInput();
  }

  // ---------------------------------------------------------------- layout & camera

  /** Se llama tras cada cambio de tamaño/insets (el HUD ajusta el CSS del atril). */
  onLayout: () => void = () => {};

  setInsets(i: BoardInsets) {
    const same = (Object.keys(i) as (keyof BoardInsets)[]).every((k) => Math.abs(i[k] - this.insets[k]) < 0.5);
    // Leer el tamaño REAL del canvas: tras girar el teléfono, el evento resize de la ventana
    // puede llegar antes de que el motor 3D se haya redimensionado
    this.engine.resize();
    if (same && this.w === this.engine.width && this.h === this.engine.height) return;
    this.insets = { ...i };
    this.resize(this.engine.width, this.engine.height);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    // Métrica del atril
    const pad = this.rackPad, gap = this.rackGap;
    const landscapeShort = w > h && h < 560;
    const byW = (w - 2 * pad + gap) / 7.2 - gap;
    const maxH = landscapeShort ? h * 0.24 : h * 0.3;
    let rows = 2;
    let byH = (maxH - 18 - gap) / 2 / 1.36;
    let tw = Math.max(34, Math.min(byW, byH, 60));
    // En pantallas anchas cabe una sola fila
    const oneRowCap = Math.floor((w - 2 * pad + gap) / (Math.min(60, (maxH - 18) / 1.36) + gap));
    if (landscapeShort || oneRowCap >= 18) {
      rows = 1;
      byH = (maxH - 18) / 1.36;
      tw = Math.max(36, Math.min(byH, 60, byW));
    }
    this.rackRows = rows;
    this.tileWpx = Math.round(tw);
    const th = this.tileWpx * 1.36;
    this.rackH = Math.round(12 + rows * th + (rows - 1) * gap + 8 + this.insets.safeBottom);
    this.rackCam.left = 0;
    this.rackCam.right = w;
    this.rackCam.top = this.rackH;
    this.rackCam.bottom = 0;
    this.rackCam.updateProjectionMatrix();
    this.rackBg.scale.set(w, this.rackH, 1);
    this.rackBg.position.set(w / 2, this.rackH / 2, -200);
    this.rackLip.scale.set(w, 2, 1);
    this.rackLip.position.set(w / 2, this.rackH - 1, -150);

    // Ancho de filas de la mesa según orientación
    const mainH = Math.max(1, h - this.rackH);
    const aspect = w / mainH;
    this.baseRowWidth = aspect < 0.9 ? 10.8 : aspect < 1.4 ? 14 : 18;
    this.rowWidth = this.baseRowWidth;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (this.view) this.sync(this.view, this.rackOrder, false);
    else this.applyCamera();
    this.engine.invalidate();
    this.onLayout();
  }

  /**
   * Elige el ancho de fila que mejor aprovecha la pantalla: en vertical, cuando la mesa crece,
   * conviene ensanchar las filas en vez de apilar una columna altísima de combinaciones.
   */
  private chooseRowWidth(view: PlayerView): number {
    // Coste = distancia de cámara necesaria (menor = fichas más grandes en pantalla)
    const cost = (rw: number) => {
      const L = layoutTable(view.table, rw);
      return this.computeFit(L, rw, this.backsExtents(view, L, rw)).dist;
    };
    let best = this.baseRowWidth;
    let bestCost = cost(best);
    // Probar filas más angostas (rivales a los lados) y más anchas (mesa muy alta)
    for (let rw = 7; rw <= 28; rw += 1.2) {
      const c = cost(rw);
      if (c < bestCost * 0.97) {
        best = rw;
        bestCost = c;
      }
    }
    // Histéresis: mantener el ancho actual si es casi igual de bueno (evita que la mesa se reacomode sin parar)
    if (this.rowWidth !== best && cost(this.rowWidth) <= bestCost * 1.06) return this.rowWidth;
    return best;
  }

  get mainH() {
    return Math.max(1, this.h - this.rackH);
  }

  /** Encaja la cámara para ver todo el contenido. */
  fitCamera(animate = true) {
    const fit = this.view
      ? this.computeFit(this.layout, this.rowWidth, this.backsExtents(this.view, this.layout, this.rowWidth))
      : { tx: 0, tz: 0, dist: 18 };
    this.placeCamera(this.cam.tx, this.cam.tz, this.cam.dist, this.cam.yaw);
    if (this.cinema) return; // durante la cinemática manda la cinemática
    if (animate) {
      gsap.to(this.cam, { ...fit, yaw: 0, duration: 0.5, ease: 'power2.inOut', onUpdate: () => this.applyCamera() });
    } else {
      Object.assign(this.cam, fit, { yaw: 0 });
      this.applyCamera();
    }
  }

  /**
   * Cámara que muestra toda la mesa (combinaciones + atriles rivales + pozo) dentro de la zona libre
   * del HUD: búsqueda binaria de la distancia proyectando las esquinas. No mueve la cámara real.
   */
  private computeFit(L: TableLayout, rw: number, ext: { halfW: number; minZ: number; maxZ: number }): { tx: number; tz: number; dist: number } {
    const oppZ = this.opponentZ(L);
    const minW = this.w < this.mainH ? 9 : 13;
    const half = Math.max(minW / 2, -L.minX + 0.5, L.maxX + 0.5, rw / 2 - 0.4, ext.halfW);
    const minX = -half, maxX = half;
    const minZ = Math.min(L.minZ, oppZ - 1.2, ext.minZ) - 0.3;
    const maxZ = Math.max(L.maxZ, 2.2, ext.maxZ) + 0.5;
    const tx = 0, tz = (minZ + maxZ) / 2;
    const { top, bottom, right, left } = this.insets;
    const corners = [
      [minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ],
    ];
    const saved = { ...this.cam };
    const fits = (dist: number) => {
      this.placeCamera(tx, tz, dist);
      for (const [x, z] of corners) {
        this.tmpV.set(x!, TILE_H, z!).project(this.camera);
        const sx = ((this.tmpV.x + 1) / 2) * this.w;
        const sy = ((1 - this.tmpV.y) / 2) * this.mainH;
        if (sx < left + 6 || sx > this.w - right - 6 || sy < top || sy > this.mainH - bottom - 4) return false;
      }
      return true;
    };
    let lo = 5, hi = 120;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.placeCamera(saved.tx, saved.tz, saved.dist, saved.yaw);
    return { tx, tz, dist: hi };
  }

  /** Espacio que ocupan los atriles rivales para un layout dado (mismo cálculo que syncBacks). */
  private backsExtents(view: PlayerView, L: TableLayout, rw: number): { halfW: number; minZ: number; maxZ: number } {
    const topZ = this.opponentZ(L);
    const cz = (L.minZ + L.maxZ) / 2;
    const colLen = Math.max(5.5, L.maxZ - L.minZ + 1.5);
    const sideX = this.contentHalfW(L, rw) + 1.4;
    const lineDepth = TILE_D * BACK_SCALE + 0.08;
    let halfW = 0, minZ = 0, maxZ = 0;
    for (const o of opponentSeats(view)) {
      const n = Math.min(view.players[o.seat]?.rackCount ?? 0, BACKS_PER_OPP);
      if (n === 0) continue;
      if (o.side === 'top') {
        const perLine = Math.max(1, Math.floor(Math.max(5, rw - 3.2) / BACK_STEP));
        minZ = Math.min(minZ, topZ - (Math.ceil(n / perLine) - 1) * lineDepth - 0.6);
      } else {
        const perLine = Math.max(1, Math.floor(colLen / BACK_STEP));
        halfW = Math.max(halfW, sideX + (Math.ceil(n / perLine) - 1) * lineDepth + 0.7);
        minZ = Math.min(minZ, cz - colLen / 2 - 0.3);
        maxZ = Math.max(maxZ, cz + colLen / 2 + 0.3);
      }
    }
    return { halfW, minZ, maxZ };
  }

  recenter() {
    this.userCamera = false;
    this.fitCamera(true);
  }

  private placeCamera(tx: number, tz: number, dist: number, yaw = 0) {
    // La niebla acompaña a la cámara: la mesa nunca se oscurece al alejarse
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist + 12;
    fog.far = dist + 50;
    // yaw = giro alrededor de la mesa (solo en la cámara cinemática)
    const ground = Math.cos(EL) * dist;
    this.camera.position.set(tx + Math.sin(yaw) * ground, Math.sin(EL) * dist, tz + Math.cos(yaw) * ground);
    this.camera.lookAt(tx, 0, tz);
    // Centrar el contenido en la zona libre entre el HUD superior y la barra inferior
    const shiftY = (this.insets.top - this.insets.bottom) / 2;
    const shiftX = (this.insets.right - this.insets.left) / 2;
    this.camera.setViewOffset(this.w, this.mainH, shiftX, -shiftY, this.w, this.mainH);
    this.camera.updateMatrixWorld();
  }

  private applyCamera() {
    this.placeCamera(this.cam.tx, this.cam.tz, this.cam.dist, this.cam.yaw);
    this.engine.invalidate();
  }

  private opponentZ(L: TableLayout = this.layout) {
    return Math.min(L.minZ, -2.5) - 1.8;
  }

  /** Mitad del ancho ocupado por las combinaciones (sin rivales laterales). */
  private contentHalfW(L: TableLayout = this.layout, rw = this.rowWidth) {
    return Math.max(-L.minX, L.maxX, rw / 2 - 0.4, 3);
  }

  /** Punto de su lado de la mesa desde donde "salen" las fichas de un rival. */
  private seatAnchor(seat: number): { x: number; z: number } {
    const v = this.view;
    const side = v ? opponentSeats(v).find((o) => o.seat === seat)?.side ?? 'top' : 'top';
    const cz = (this.layout.minZ + this.layout.maxZ) / 2;
    const sx = this.contentHalfW() + 1.4;
    if (side === 'left') return { x: -sx, z: cz };
    if (side === 'right') return { x: sx, z: cz };
    return { x: -1.4, z: this.opponentZ() };
  }

  // ---------------------------------------------------------------- sync

  setInteractive(on: boolean) {
    this.interactive = on;
    if (!on) this.cancelDrag();
  }

  /** Sincroniza la escena con una vista nueva (anima solo lo que cambió). */
  sync(view: PlayerView, rackOrder: TileId[], animate = true) {
    const prevView = this.view;
    const newGame = !prevView || (prevView.status === 'ended' && view.status === 'playing');
    this.view = view;
    this.rackOrder = rackOrder;
    const previewMeld = this.drag?.started && this.drag.target?.kind === 'meld' ? this.drag.target : null;
    // Al cambiar de turno la cámara vuelve a encuadrar toda la mesa
    if (prevView && prevView.turn !== view.turn) this.userCamera = false;
    // No cambiar el ancho de filas mientras se arrastra (la mesa "saltaría" bajo el dedo)
    if (!this.drag?.started) this.rowWidth = this.chooseRowWidth(view);
    this.layout = layoutTable(view.table, this.rowWidth);

    if (newGame) {
      this.loc.clear();
      this.meldValid.clear();
      this.tiles.hideAll();
      this.rackTiles.hideAll();
      this.selection = [];
      this.seenAtMyTurnEnd = new Set();
    }
    const nextLoc = new Map<TileId, Loc>();
    for (const m of view.table) for (const t of m.tiles) nextLoc.set(t, 'table');
    for (const t of view.rack) nextLoc.set(t, 'rack');

    // Combinaciones que se volvieron válidas -> brillo
    const glow = new Set<TileId>();
    const nextValid = new Map<string, boolean>();
    for (const m of view.table) {
      const ok = analyzeMeld(m.tiles).valid;
      nextValid.set(m.id, ok);
      const was = this.meldValid.get(m.id);
      if (ok && was !== true && !newGame && prevView) {
        const prevMeld = prevView.table.find((p) => p.id === m.id);
        if (!prevMeld || prevMeld.tiles.length !== m.tiles.length || !was) m.tiles.forEach((t) => glow.add(t));
      }
    }
    this.meldValid = nextValid;
    if (glow.size && animate) sfx.valid();

    // Fichas de la mesa
    // Los atriles rivales primero: la cámara los necesita para encuadrar
    this.syncBacks(view, animate);
    // La cámara nunca se mueve sola mientras se arrastra una ficha
    if (!this.userCamera && !this.drag?.started) this.fitCamera(animate && !newGame);
    const from = this.seatAnchor(view.turn);
    let oppIdx = 0;
    for (const m of view.table) {
      const box = this.layout.melds.find((b) => b.id === m.id)!;
      m.tiles.forEach((t, i) => {
        if (this.isDragged(t)) return;
        let x = box.x0 + i * STEP;
        if (previewMeld && previewMeld.meldId === m.id) {
          const others = m.tiles.filter((tt) => !this.isDragged(tt));
          const idx = others.indexOf(t);
          // Hueco "magnético" del tamaño de lo que se arrastra (1 ficha o el grupo entero)
          const gap = (STEP * (this.drag?.group?.length ?? 1)) / 2;
          x = box.x0 + idx * STEP + (idx >= (previewMeld.index ?? 0) ? gap : -gap);
        }
        const target = { x, y: TILE_H / 2, z: box.z, rx: 0, ry: JITTER(t), rz: 0, s: 1, shadow: -1 };
        const prev = this.loc.get(t) ?? 'none';
        const st = this.tiles.get(t);
        if (prev === 'table' && st.visible) {
          this.tweenTile(this.tiles, t, target, animate ? 0.3 : 0);
        } else if (prev === 'rack') {
          this.rackTiles.set(t, { visible: false });
          const p = this.rackToWorld(this.rackTiles.get(t));
          this.tiles.set(t, { ...p, y: LIFT, rx: 0, ry: 0, rz: 0, s: 1, visible: true, cell: cellOf(t) });
          this.tweenTile(this.tiles, t, target, animate ? 0.32 : 0, 'back.out(1.4)');
        } else {
          // Viene del atril rival: vuela desde su lado y se voltea
          const spread = (oppIdx++ - 1) * 0.6;
          this.tiles.set(t, { x: from.x + spread, y: 0.9, z: from.z, rx: 0, ry: 0, rz: animate ? Math.PI : 0, s: 1, visible: true, cell: cellOf(t) });
          this.tweenTile(this.tiles, t, target, animate ? 0.6 : 0, 'power3.out', oppIdx * 0.06);
        }
      });
    }
    // Atril propio
    const slots = this.rackSlots(rackOrder.filter((t) => !this.isDragged(t)), this.drag?.started && this.drag.region === 'rack' ? this.drag.rackIndex : -1);
    let dealIdx = 0;
    const dealing = newGame;
    for (const [t, slot] of slots) {
      const prev = this.loc.get(t) ?? 'none';
      const lifted = prevView && this.selection.includes(t) && this.loc.get(t) === 'rack' ? this.tileWpx * 0.16 : 0;
      const target = { x: slot.x, y: slot.y + lifted, z: 0, rx: RACK_RX, ry: 0, rz: 0, s: this.tileWpx };
      if (prev === 'rack' && this.rackTiles.get(t).visible) {
        this.tweenTile(this.rackTiles, t, target, animate ? 0.26 : 0);
      } else if (prev === 'table') {
        this.tiles.set(t, { visible: false });
        const p = this.worldToRack(this.tiles.get(t));
        this.rackTiles.set(t, { ...p, z: 0, rx: RACK_RX, ry: 0, rz: 0, s: this.tileWpx, visible: true, cell: cellOf(t) });
        this.tweenTile(this.rackTiles, t, target, animate ? 0.3 : 0);
      } else {
        // Repartir / robar: cae desde arriba y se voltea
        this.rackTiles.set(t, { x: this.w / 2, y: this.rackH + this.tileWpx * 2, z: 0, rx: RACK_RX, ry: animate ? Math.PI : 0, rz: 0, s: this.tileWpx, visible: true, cell: cellOf(t) });
        this.tweenTile(this.rackTiles, t, target, animate ? 0.55 : 0, 'power3.out', dealing ? dealIdx++ * 0.045 : 0.05);
      }
    }
    // Ocultar lo que ya no está
    for (const [t, l] of this.loc) {
      if (nextLoc.has(t)) continue;
      if (l === 'table') this.tiles.set(t, { visible: false });
      if (l === 'rack') this.rackTiles.set(t, { visible: false });
    }
    // La selección solo sobrevive si sus fichas siguen donde estaban
    const keep = this.selection.filter((t) => nextLoc.has(t) && nextLoc.get(t) === this.loc.get(t));
    this.loc = nextLoc;
    if (keep.length !== this.selection.length) this.setSelection(keep);
    this.refreshTints(glow);
    // Empieza mi turno: resaltar lo que jugaron los demás desde mi último turno
    const myTurnNow = view.status === 'playing' && view.turn === view.you;
    const myTurnBefore = !!prevView && prevView.status === 'playing' && prevView.turn === prevView.you;
    if (myTurnNow && !myTurnBefore && !newGame && animate) {
      const fresh = view.table.flatMap((m) => m.tiles).filter((t) => !this.seenAtMyTurnEnd.has(t));
      if (fresh.length) this.highlightNew(fresh);
    }
    if (!myTurnNow && myTurnBefore) this.seenAtMyTurnEnd = new Set(view.table.flatMap((m) => m.tiles));
    this.clampScroll();
    this.engine.invalidate();
  }

  /** Fichas que había en la mesa cuando terminó mi último turno. */
  private seenAtMyTurnEnd = new Set<TileId>();

  /** Pulso dorado sobre las fichas que acaba de jugar el rival (3 latidos, ~2 s). */
  private highlightNew(tiles: TileId[]) {
    for (const t of tiles) {
      if (this.loc.get(t) !== 'table') continue;
      const st = this.tiles.get(t);
      gsap.to(st, {
        r: 1.55, g: 1.32, b: 0.62, y: TILE_H / 2 + 0.12,
        duration: 0.33, yoyo: true, repeat: 5, ease: 'sine.inOut', delay: 0.35,
        onUpdate: () => this.tiles.markDirty(t),
        onComplete: () => this.refreshTints(),
      });
    }
  }

  private tweenTile(set: TileSet, t: TileId, target: Partial<TileState>, duration: number, ease = 'power3.out', delay = 0) {
    const st = set.get(t);
    gsap.killTweensOf(st);
    if (duration <= 0) {
      set.set(t, { ...target, visible: true });
      return;
    }
    st.visible = true;
    gsap.to(st, { ...target, duration, delay, ease, onUpdate: () => set.markDirty(t), onComplete: () => set.markDirty(t) });
  }

  private baseTint(t: TileId): readonly [number, number, number] {
    if (this.selection.includes(t)) return TINT_SELECTED;
    if (this.loc.get(t) !== 'table') return TINT_NORMAL;
    const m = this.view?.table.find((mm) => mm.tiles.includes(t));
    if (m && !this.meldValid.get(m.id)) return TINT_INVALID;
    if (this.view?.playedThisTurn.includes(t)) return TINT_PLAYED;
    return TINT_NORMAL;
  }

  private refreshTints(glow: Set<TileId> = new Set()) {
    for (const [t, l] of this.loc) {
      const set = l === 'table' ? this.tiles : this.rackTiles;
      const [r, g, b] = this.baseTint(t);
      const st = set.get(t);
      if (glow.has(t)) {
        Object.assign(st, { r: 1.7, g: 1.5, b: 0.95 });
        gsap.to(st, { r, g, b, duration: 0.9, ease: 'power2.out', onUpdate: () => set.markDirty(t) });
      } else if (st.r !== r || st.g !== g || st.b !== b) {
        gsap.to(st, { r, g, b, duration: 0.2, onUpdate: () => set.markDirty(t) });
      }
    }
  }

  /**
   * Atriles rivales (dorsos boca abajo) alrededor de la mesa y el pozo.
   * Enfrente: fila arriba. Izquierda/derecha: columnas a los lados (fichas giradas 90°).
   * El atril del jugador en turno brilla en dorado.
   */
  private syncBacks(view: PlayerView, animate: boolean) {
    const L = this.layout;
    const topZ = this.opponentZ();
    const cz = (L.minZ + L.maxZ) / 2;
    const colLen = Math.max(5.5, L.maxZ - L.minZ + 1.5);
    const sideX = this.contentHalfW() + 1.4;
    const used = new Set<number>();
    opponentSeats(view).forEach((o, k) => {
      const p = view.players[o.seat];
      if (!p) return;
      const n = Math.min(p.rackCount, BACKS_PER_OPP);
      const base = k * BACKS_PER_OPP;
      const active = view.status === 'playing' && view.turn === o.seat;
      const [r, g, b] = active ? TINT_ACTIVE : TINT_NORMAL;
      const maxPerLine = o.side === 'top' ? Math.max(1, Math.floor(Math.max(5, this.rowWidth - 3.2) / BACK_STEP)) : Math.max(1, Math.floor(colLen / BACK_STEP));
      // Repartir parejo entre líneas (9 fichas -> 5 + 4, no 8 + 1)
      const perLine = Math.ceil(n / Math.max(1, Math.ceil(n / maxPerLine)));
      for (let i = 0; i < n; i++) {
        const line = Math.floor(i / perLine);
        const inLine = Math.min(perLine, n - line * perLine);
        const off = (i % perLine - (inLine - 1) / 2) * BACK_STEP;
        const depth = line * (TILE_D * BACK_SCALE + 0.08);
        let target: Partial<TileState>;
        if (o.side === 'top') target = { x: -1.4 + off, z: topZ - depth, ry: 0 };
        else if (o.side === 'left') target = { x: -sideX - depth, z: cz + off, ry: Math.PI / 2 };
        else target = { x: sideX + depth, z: cz + off, ry: -Math.PI / 2 };
        Object.assign(target, { y: (TILE_H / 2) * BACK_SCALE, rx: 0, rz: 0, s: BACK_SCALE, r, g, b });
        const idx = base + i;
        used.add(idx);
        const st = this.backs.get(idx);
        if (!st.visible) this.backs.set(idx, { ...target, y: 2, visible: true, cell: BACK_CELL, shadow: -1 });
        this.tweenTile(this.backs, idx, target, animate ? 0.35 : 0, 'power2.out', animate ? i * 0.01 : 0);
      }
    });
    for (let i = 0; i < BACKS_PER_OPP * 3; i++) {
      const st = this.backs.get(i);
      if (!used.has(i) && st.visible) {
        gsap.killTweensOf(st);
        this.backs.set(i, { visible: false });
      }
    }
    // Pozo: montones de fichas boca abajo arriba a la derecha
    const piles = Math.min(POOL_PILES, Math.ceil(view.poolCount / 7));
    const px = this.rowWidth / 2 - 1.2;
    for (let i = 0; i < POOL_PILES; i++) {
      const idx = BACKS_PER_OPP * 3 + i;
      if (i < piles) {
        const col = i % 2, lvl = Math.floor(i / 2);
        this.backs.set(idx, {
          x: px + col * 0.75,
          y: (TILE_H / 2) * 0.7 + lvl * TILE_H * 0.7,
          z: topZ + JITTER(i * 13) * 3,
          rx: 0,
          ry: JITTER(i * 7) * 5,
          rz: 0,
          s: 0.7,
          visible: true,
          cell: BACK_CELL,
          shadow: -1,
        });
      } else if (this.backs.get(idx).visible) this.backs.set(idx, { visible: false });
    }
  }

  // ---------------------------------------------------------------- rack geometry

  private rackSlots(order: TileId[], gapIndex: number): Map<TileId, { x: number; y: number }> {
    const n = order.length + (gapIndex >= 0 ? 1 : 0);
    const step = this.tileWpx + this.rackGap;
    const cap = Math.max(1, Math.floor((this.w - 2 * this.rackPad + this.rackGap) / step));
    this.perRow = this.rackRows === 1 ? Math.max(cap, n) : Math.max(cap, Math.ceil(n / 2));
    const th = this.tileWpx * 1.36;
    const top = this.rackH - this.insets.safeBottom - 12;
    const out = new Map<TileId, { x: number; y: number }>();
    let slot = 0;
    const pos = (s: number) => {
      const row = Math.floor(s / this.perRow);
      const col = s % this.perRow;
      return {
        x: this.rackPad + col * step + this.tileWpx / 2 - this.scrollX,
        y: top - th / 2 - row * (th + this.rackGap),
      };
    };
    for (const t of order) {
      if (slot === gapIndex) slot++;
      out.set(t, pos(slot));
      slot++;
    }
    return out;
  }

  private contentWidth() {
    return this.perRow * (this.tileWpx + this.rackGap) - this.rackGap;
  }

  private clampScroll() {
    const max = Math.max(0, this.contentWidth() - (this.w - 2 * this.rackPad));
    const s = Math.max(0, Math.min(max, this.scrollX));
    if (s !== this.scrollX) {
      this.scrollX = s;
      if (this.view) this.sync(this.view, this.rackOrder, false);
    }
  }

  scrollRack(dx: number) {
    this.scrollX += dx;
    const max = Math.max(0, this.contentWidth() - (this.w - 2 * this.rackPad));
    this.scrollX = Math.max(0, Math.min(max, this.scrollX));
    if (this.view) {
      const slots = this.rackSlots(this.rackOrder.filter((t) => !this.isDragged(t)), -1);
      for (const [t, s] of slots) this.rackTiles.set(t, { x: s.x, y: s.y });
    }
  }

  get canScrollRack(): { left: boolean; right: boolean } {
    const max = Math.max(0, this.contentWidth() - (this.w - 2 * this.rackPad));
    return { left: this.scrollX > 1, right: this.scrollX < max - 1 };
  }

  private rackIndexAt(rx: number, ry: number): number {
    const step = this.tileWpx + this.rackGap;
    const th = this.tileWpx * 1.36;
    const top = this.rackH - this.insets.safeBottom - 12;
    const row = this.rackRows === 1 ? 0 : Math.max(0, Math.min(1, Math.floor((top - ry) / (th + this.rackGap))));
    const col = Math.max(0, Math.min(this.perRow, Math.round((rx + this.scrollX - this.rackPad - this.tileWpx / 2) / step)));
    const n = this.rackOrder.filter((t) => !this.isDragged(t) && t !== this.drag?.tileId).length;
    return Math.max(0, Math.min(n, row * this.perRow + col));
  }

  // Conversión entre espacios (px del atril <-> mundo de la mesa)
  private rackToWorld(st: TileState): { x: number; z: number } {
    const sx = st.x, sy = this.h - st.y; // px de pantalla
    return this.screenToTable(sx, sy) ?? { x: 0, z: this.layout.maxZ + 2 };
  }

  private worldToRack(st: TileState): { x: number; y: number } {
    this.tmpV.set(st.x, st.y, st.z).project(this.camera);
    const sx = ((this.tmpV.x + 1) / 2) * this.w;
    const sy = ((1 - this.tmpV.y) / 2) * this.mainH;
    return { x: sx, y: this.h - sy };
  }

  private screenToTable(sx: number, sy: number, height = 0): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.mainH) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -height;
    const p = this.ray.ray.intersectPlane(this.plane, this.tmpV);
    return p ? { x: p.x, z: p.z } : null;
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const c = this.engine.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.prevent);
  }

  private unbindInput() {
    const c = this.engine.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.prevent);
  }

  private prevent = (e: Event) => e.preventDefault();

  private local(e: PointerEvent | WheelEvent) {
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private regionAt(y: number): Region {
    return y > this.h - this.rackH ? 'rack' : 'main';
  }

  private hitRack(x: number, y: number): TileId | null {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, ((this.h - y) / this.rackH) * 2 - 1);
    this.ray.setFromCamera(ndc, this.rackCam);
    return this.rackTiles.raycast(this.ray);
  }

  private hitTable(x: number, y: number): TileId | null {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.mainH) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.tiles.raycast(this.ray);
  }

  /** ¿Esta ficha se está arrastrando (sola o como parte de un grupo)? */
  private isDragged(t: TileId): boolean {
    const d = this.drag;
    if (!d?.started) return false;
    return d.group ? d.group.includes(t) : d.tileId === t;
  }

  /** ¿Puedo levantar esta combinación entera? (todas sus fichas deben poder moverse) */
  canMoveMeld(meldId: string): boolean {
    const m = this.view?.table.find((mm) => mm.id === meldId);
    return !!m && m.tiles.every((t) => this.canMoveTableTile(t));
  }

  canMoveTableTile(t: TileId): boolean {
    const v = this.view;
    if (!v || v.status !== 'playing' || v.turn !== v.you) return false;
    return v.players[v.you]!.opened || v.playedThisTurn.includes(t);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.interactive || !this.view) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.engine.canvas.setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 2 && !this.drag?.started) {
      // pinch
      this.clearHold();
      this.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', lastX: 0, lastY: 0, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      return;
    }
    if (this.pointers.size > 1) return;
    const region = this.regionAt(p.y);
    const hit = region === 'rack' ? this.hitRack(p.x, p.y) : this.hitTable(p.x, p.y);
    if (hit !== null && (region === 'rack' || this.canMoveTableTile(hit))) {
      this.drag = {
        tileId: hit, origin: region === 'rack' ? 'rack' : 'table', pointerId: e.pointerId,
        startX: p.x, startY: p.y, started: false, touch: e.pointerType !== 'mouse', region,
        target: null, rackIndex: -1, lastSent: 0,
        group: null, groupMeld: null, wantGroup: region === 'main' && e.shiftKey, lastX: p.x, lastY: p.y,
      };
      this.gesture = null;
      // Mantener presionada una ficha de la mesa levanta toda su combinación
      if (region === 'main') {
        const d = this.drag;
        this.holdTimer = setTimeout(() => {
          if (this.drag === d && !d.started) this.startGroupDrag(d);
        }, HOLD_MS);
      }
    } else {
      this.drag = null;
      this.gesture = { kind: region === 'rack' ? 'scroll' : 'pan', lastX: p.x, lastY: p.y, dist: 0 };
      (this.gesture as { downX?: number; downY?: number; tapHit?: TileId | null }).downX = p.x;
      (this.gesture as { downX?: number; downY?: number; tapHit?: TileId | null }).downY = p.y;
      (this.gesture as { tapHit?: TileId | null }).tapHit = hit;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (g?.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (g.dist > 0) {
        this.cam.dist = Math.max(6, Math.min(70, (this.cam.dist * g.dist) / d));
        this.userCamera = true;
        this.applyCamera();
      }
      g.dist = d;
      return;
    }
    if (g?.kind === 'pan') {
      // Umbral: un roce o un toque no cuenta como mover la cámara
      const gg = g as { downX?: number; downY?: number; panning?: boolean };
      if (!gg.panning) {
        if (Math.hypot(p.x - (gg.downX ?? p.x), p.y - (gg.downY ?? p.y)) < 12) return;
        gg.panning = true;
        g.lastX = p.x;
        g.lastY = p.y;
        return;
      }
      const dx = p.x - g.lastX, dy = p.y - g.lastY;
      g.lastX = p.x;
      g.lastY = p.y;
      const worldPerPx = (2 * this.cam.dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / this.mainH;
      this.cam.tx = Math.max(-30, Math.min(30, this.cam.tx - dx * worldPerPx));
      this.cam.tz = Math.max(-30, Math.min(30, this.cam.tz - (dy * worldPerPx) / Math.sin(EL)));
      this.userCamera = true;
      this.applyCamera();
      return;
    }
    if (g?.kind === 'scroll') {
      const dx = p.x - g.lastX;
      g.lastX = p.x;
      this.scrollRack(-dx);
      return;
    }
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    d.lastX = p.x;
    d.lastY = p.y;
    if (!d.started) {
      if (Math.hypot(p.x - d.startX, p.y - d.startY) < 8) return;
      this.clearHold();
      if (d.wantGroup && this.startGroupDrag(d)) {
        this.updateDrag(p.x, p.y);
        return;
      }
      // Arrastrar una ficha seleccionada del atril mueve TODAS las seleccionadas
      if (d.origin === 'rack' && this.selection.length > 1 && this.selection.includes(d.tileId)) {
        d.group = this.rackOrder.filter((t) => this.selection.includes(t));
        d.groupMeld = null;
      }
      d.started = true;
      this.select(null);
      sfx.pick();
      vibrate(8);
    }
    this.updateDrag(p.x, p.y);
  };

  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private clearHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  /** Convierte el arrastre en arrastre de grupo (combinación entera). */
  private startGroupDrag(d: DragState): boolean {
    this.clearHold();
    const meld = this.view?.table.find((m) => m.tiles.includes(d.tileId));
    if (!meld || meld.tiles.length < 2 || !this.canMoveMeld(meld.id)) return false;
    d.group = [...meld.tiles];
    d.groupMeld = meld.id;
    d.started = true;
    this.select(null);
    sfx.pick();
    vibrate([15, 30, 25]);
    this.updateDrag(d.lastX, d.lastY);
    return true;
  }

  private updateDrag(x: number, y: number) {
    const d = this.drag!;
    const region = this.regionAt(y);
    const lift = d.touch ? 44 : 0; // la ficha se ve por encima del dedo
    d.region = region;
    const group = d.group ?? [d.tileId];
    const anchor = group.indexOf(d.tileId);
    if (region === 'rack') {
      // Mostrar en el atril
      const step = this.tileWpx * 1.12 + this.rackGap;
      group.forEach((t, i) => {
        if (this.tiles.get(t).visible) this.tiles.set(t, { visible: false });
        gsap.killTweensOf(this.rackTiles.get(t));
        this.rackTiles.set(t, {
          x: x + (i - anchor) * step, y: this.h - y + lift * 0.6, z: 50, rx: RACK_RX + 0.15, ry: 0, rz: -0.06, s: this.tileWpx * 1.12, visible: true, cell: cellOf(t),
        });
      });
      const idx = this.rackIndexAt(x, this.h - y);
      d.target = null;
      this.placeholder.visible = false;
      this.meldHalo.visible = false;
      if (idx !== d.rackIndex) {
        d.rackIndex = idx;
        this.layoutRackPreview();
      }
      if (d.lastSent) {
        this.cb.drag({ tileId: null, x: 0, z: 0, active: false });
        d.lastSent = 0;
      }
    } else {
      if (d.rackIndex !== -1) {
        d.rackIndex = -1;
        this.layoutRackPreview();
      }
      const wp = this.screenToTable(x, y - lift, LIFT) ?? { x: 0, z: 0 };
      group.forEach((t, i) => {
        if (this.rackTiles.get(t).visible) this.rackTiles.set(t, { visible: false });
        gsap.killTweensOf(this.tiles.get(t));
        this.tiles.set(t, { x: wp.x + (i - anchor) * STEP, y: LIFT, z: wp.z, rx: -0.12, ry: 0, rz: -0.05, s: 1.06, visible: true, cell: cellOf(t), shadow: LIFT });
      });
      // Para un grupo, el destino se calcula con su ficha central
      const cx = wp.x + ((group.length - 1) / 2 - anchor) * STEP;
      const target = findDropTarget(this.layout, d.group ? cx : wp.x, wp.z, d.group ?? d.tileId);
      const changed = JSON.stringify(target) !== JSON.stringify(d.target);
      d.target = target;
      if (changed) this.showDropPreview(target);
      const now = performance.now();
      if (now - d.lastSent > 50) {
        d.lastSent = now;
        const isPublic = this.loc.get(d.tileId) === 'table';
        this.cb.drag({ tileId: isPublic ? d.tileId : null, x: wp.x, z: wp.z, active: true });
      }
    }
  }

  private layoutRackPreview() {
    if (!this.view) return;
    const d = this.drag;
    const order = this.rackOrder.filter((t) => !this.isDragged(t) && t !== d?.tileId);
    const slots = this.rackSlots(order, d && d.region === 'rack' ? d.rackIndex : -1);
    for (const [t, s] of slots) this.tweenTile(this.rackTiles, t, { x: s.x, y: s.y }, 0.15);
  }

  private showDropPreview(target: DropTarget) {
    if (!this.view) return;
    // Re-sincroniza la mesa con el hueco de previsualización
    this.sync(this.view, this.rackOrder, true);
    if (target.kind === 'new') {
      this.meldHalo.visible = false;
      const g = this.drag?.group?.length ?? 1;
      this.placeholder.scale.set(g, 1, 1);
      this.placeholder.visible = true;
      // El grupo ocupa g fichas a partir de la posición libre
      this.placeholder.position.set(this.layout.next.x + ((g - 1) / 2) * STEP, 0.01, this.layout.next.z);
    } else {
      const box = this.layout.melds.find((b) => b.id === target.meldId);
      if (!box) return;
      const others = box.tiles.filter((t) => !this.isDragged(t));
      const idx = target.index ?? 0;
      const g = this.drag?.group?.length ?? 1;
      const x = box.x0 + idx * STEP - STEP / 2;
      this.placeholder.visible = true;
      this.placeholder.position.set(x, 0.01, box.z);
      this.placeholder.scale.set(g, 1, 1);
      this.meldHalo.visible = true;
      const width = others.length * STEP + STEP * g + 0.3;
      this.meldHalo.scale.set(width, 1, TILE_D + 0.4);
      this.meldHalo.position.set(box.x0 - TILE_W / 2 - STEP / 2 - 0.15 + width / 2, 0.006, box.z);
    }
    this.engine.invalidate();
  }

  private onUp = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g) {
      if (this.pointers.size === 0) {
        const gg = g as { downX?: number; downY?: number; tapHit?: TileId | null };
        const moved = gg.downX !== undefined ? Math.hypot(p.x - gg.downX, p.y - (gg.downY ?? 0)) : 99;
        if ((g.kind === 'pan' || g.kind === 'scroll') && moved < 8) this.onTap(p.x, p.y, gg.tapHit ?? null);
        this.gesture = null;
      } else if (g.kind === 'pinch') {
        g.dist = 0;
      }
      return;
    }
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    this.clearHold();
    this.drag = null;
    if (!d.started) {
      this.onTap(p.x, p.y, d.tileId);
      return;
    }
    this.finishDrag(d);
  };

  private onCancel = (e: PointerEvent) => {
    this.clearHold();
    this.pointers.delete(e.pointerId);
    this.gesture = null;
    this.cancelDrag();
  };

  private cancelDrag() {
    const d = this.drag;
    this.drag = null;
    this.placeholder.visible = false;
    this.meldHalo.visible = false;
    this.clearHold();
    if (d?.started) {
      this.cb.drag({ tileId: null, x: 0, z: 0, active: false });
      this.restoreTile(d.group ?? d.tileId);
    }
  }

  /** Soltar varias fichas del atril: a la mesa (juntas) o reordenarlas en el atril. */
  private finishRackGroupDrag(d: DragState, group: TileId[]) {
    this.placeholder.scale.set(1, 1, 1);
    if (d.region === 'rack') {
      sfx.rack();
      this.cb.reorderMany(group, d.rackIndex >= 0 ? d.rackIndex : this.rackOrder.length);
      this.restoreTile(group);
      return;
    }
    const v = this.view;
    if (!v || v.status !== 'playing' || v.turn !== v.you) {
      this.cb.notMyTurn();
      this.restoreTile(group);
      return;
    }
    sfx.drop();
    const target = d.target ?? { kind: 'new' };
    const to: MoveTarget = target.kind === 'meld' ? { kind: 'meld', meldId: target.meldId!, index: target.index ?? 0 } : { kind: 'new' };
    for (const t of group) {
      this.loc.set(t, 'table');
      this.rackTiles.set(t, { visible: false });
    }
    if (!this.cb.moveTiles(group, to)) {
      sfx.invalid();
      vibrate([20, 40, 20]);
    }
    this.restoreTile(group);
  }

  /** Soltar una combinación entera: unir, mover a espacio libre o devolver al atril. */
  private finishGroupDrag(d: DragState, group: TileId[], meldId: string) {
    this.placeholder.scale.set(1, 1, 1);
    const v = this.view;
    if (!v || v.status !== 'playing' || v.turn !== v.you) {
      this.cb.notMyTurn();
      this.restoreTile(group);
      return;
    }
    let to: MoveTarget;
    if (d.region === 'rack') {
      sfx.rack();
      to = { kind: 'rack' };
      for (const t of group) {
        this.loc.set(t, 'rack');
        this.tiles.set(t, { visible: false });
      }
    } else {
      sfx.drop();
      const target = d.target ?? { kind: 'new' };
      to = target.kind === 'meld' ? { kind: 'meld', meldId: target.meldId!, index: target.index ?? 0 } : { kind: 'new' };
      for (const t of group) {
        this.loc.set(t, 'table');
        this.rackTiles.set(t, { visible: false });
      }
    }
    if (!this.cb.moveMeld(meldId, to)) {
      sfx.invalid();
      vibrate([20, 40, 20]);
    }
    this.restoreTile(group);
  }

  /** Devuelve una o varias fichas a su sitio según la vista actual. */
  private restoreTile(t: TileId | TileId[]) {
    for (const x of Array.isArray(t) ? t : [t]) {
      const where = this.loc.get(x);
      // Si se ve en el conjunto equivocado, el sync la trasladará
      if (where === 'rack' && this.tiles.get(x).visible) this.loc.set(x, 'table');
      if (where === 'table' && this.rackTiles.get(x).visible) this.loc.set(x, 'rack');
    }
    if (this.view) this.sync(this.view, this.rackOrder, true);
  }

  private finishDrag(d: DragState) {
    this.placeholder.visible = false;
    this.meldHalo.visible = false;
    this.cb.drag({ tileId: null, x: 0, z: 0, active: false });
    vibrate(12);
    if (d.group && d.groupMeld) {
      this.finishGroupDrag(d, d.group, d.groupMeld);
      return;
    }
    if (d.group) {
      this.finishRackGroupDrag(d, d.group);
      return;
    }
    if (d.region === 'rack') {
      sfx.rack();
      const idx = d.rackIndex >= 0 ? d.rackIndex : this.rackOrder.length;
      if (d.origin === 'rack') {
        // la ficha se ve en el atril: marcar como tal y reordenar
        this.cb.reorder(d.tileId, idx);
      } else {
        // Tabla -> atril: solo fichas propias de este turno
        this.loc.set(d.tileId, 'rack');
        this.tiles.set(d.tileId, { visible: false });
        const ok = this.cb.move(d.tileId, { kind: 'rack' }, idx);
        if (!ok) this.loc.set(d.tileId, 'rack');
      }
      this.restoreTile(d.tileId);
      return;
    }
    sfx.drop();
    const v = this.view;
    if (!v || v.status !== 'playing' || v.turn !== v.you) {
      this.cb.notMyTurn();
      this.restoreTile(d.tileId);
      return;
    }
    const target = d.target ?? { kind: 'new' };
    // La ficha ya está visible en la mesa: registrarla como "table" para que el sync la anime desde ahí
    this.loc.set(d.tileId, 'table');
    this.rackTiles.set(d.tileId, { visible: false });
    const to: MoveTarget = target.kind === 'meld' ? { kind: 'meld', meldId: target.meldId!, index: target.index ?? 0 } : { kind: 'new' };
    const ok = this.cb.move(d.tileId, to);
    if (!ok) {
      // Se rechazó (p. ej. sin abrir): vuelve con un "rebote"
      sfx.invalid();
      vibrate([20, 40, 20]);
      this.loc.set(d.tileId, 'table');
      this.restoreTile(d.tileId);
    }
  }

  private onTap(x: number, y: number, hit: TileId | null) {
    const region = this.regionAt(y);
    const sel = this.selection;
    if (sel.length === 0) {
      if (hit !== null && (region === 'rack' || this.canMoveTableTile(hit))) {
        this.select(hit);
        sfx.pick();
      }
      return;
    }
    // Tocar una ficha ya seleccionada la quita de la selección
    if (hit !== null && sel.includes(hit)) {
      this.setSelection(sel.filter((t) => t !== hit));
      sfx.rack();
      return;
    }
    const selLoc = this.loc.get(sel[0]!);
    if (region === 'rack') {
      if (hit !== null && this.loc.get(hit) === 'rack') {
        // Selección múltiple en el atril: tocar suma fichas
        if (selLoc === 'rack') {
          if (sel.length < 13) {
            this.setSelection([...sel, hit]);
            if (sel.length === 1) this.cb.multiSelectHint?.(2);
          }
        } else this.select(hit);
        sfx.pick();
        return;
      }
      // Tocar un hueco del atril: llevar ahí la selección
      const idx = this.rackIndexAt(x, this.h - y);
      this.select(null);
      if (selLoc === 'rack') this.cb.reorderMany(sel, idx);
      else this.cb.move(sel[0]!, { kind: 'rack' }, idx);
      sfx.rack();
      return;
    }
    // Destino en la mesa
    const v = this.view;
    if (!v || v.turn !== v.you || v.status !== 'playing') {
      this.cb.notMyTurn();
      return;
    }
    let target: DropTarget;
    if (hit !== null && this.loc.get(hit) === 'table') {
      const box = this.layout.melds.find((b) => b.tiles.includes(hit))!;
      const p = this.screenToTable(x, y, TILE_H) ?? { x: 0, z: 0 };
      const tp = this.layout.pos.get(hit)!;
      const others = box.tiles.filter((t) => !sel.includes(t));
      const i = others.indexOf(hit);
      target = { kind: 'meld', meldId: box.id, index: p.x > tp.x ? i + 1 : i };
    } else {
      const p = this.screenToTable(x, y);
      target = p ? findDropTarget(this.layout, p.x, p.z, sel) : { kind: 'new' };
    }
    const moving = this.rackOrder.filter((t) => sel.includes(t));
    this.select(null);
    const to: MoveTarget = target.kind === 'meld' ? { kind: 'meld', meldId: target.meldId!, index: target.index ?? 0 } : { kind: 'new' };
    sfx.drop();
    vibrate(12);
    const ok = sel.length > 1 && selLoc === 'rack' ? this.cb.moveTiles(moving, to) : this.cb.move(sel[0]!, to);
    if (!ok) sfx.invalid();
  }

  private select(t: TileId | null) {
    this.setSelection(t === null ? [] : [t]);
  }

  /** Cambia la selección y levanta/baja las fichas afectadas. */
  private setSelection(next: TileId[]) {
    const prev = this.selection;
    this.selection = next;
    for (const id of new Set([...prev, ...next])) {
      const on = next.includes(id);
      const l = this.loc.get(id);
      if (l === 'table') this.tweenTile(this.tiles, id, { y: on ? TILE_H / 2 + 0.35 : TILE_H / 2 }, 0.15);
      else if (l === 'rack' && this.view) {
        const slot = this.rackSlots(this.rackOrder, -1).get(id);
        if (slot) this.tweenTile(this.rackTiles, id, { y: slot.y + (on ? this.tileWpx * 0.16 : 0) }, 0.15);
      }
    }
    this.refreshTints();
    this.cb.selectionChange?.(next[0] ?? null);
  }

  clearSelection() {
    this.select(null);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    if (this.regionAt(p.y) === 'rack') {
      this.scrollRack(e.deltaY + e.deltaX);
      return;
    }
    this.cam.dist = Math.max(6, Math.min(70, this.cam.dist * (1 + e.deltaY * 0.0012)));
    this.userCamera = true;
    this.applyCamera();
  };

  // ---------------------------------------------------------------- efectos

  /** Fantasma de la ficha que arrastra el rival. */
  showGhost(d: DragPayload) {
    const st = this.ghost.get(0);
    if (!d.active) {
      gsap.killTweensOf(st);
      if (st.visible) this.ghost.set(0, { visible: false });
      return;
    }
    const cell = d.tileId !== null ? cellOf(d.tileId) : BACK_CELL;
    if (!st.visible) {
      this.ghost.set(0, { x: d.x, y: LIFT, z: d.z, rx: -0.1, ry: 0, rz: 0.05, s: 1.04, visible: true, cell, shadow: LIFT });
    } else {
      st.cell = cell;
      gsap.to(st, { x: d.x, z: d.z, duration: 0.09, ease: 'none', onUpdate: () => this.ghost.markDirty(0) });
    }
  }

  /** Sacudida roja de las combinaciones inválidas (al intentar terminar el turno). */
  shakeInvalid() {
    if (!this.view) return;
    for (const m of this.view.table) {
      if (this.meldValid.get(m.id)) continue;
      for (const t of m.tiles) {
        const st = this.tiles.get(t);
        const x = st.x;
        gsap.fromTo(st, { x: x - 0.12 }, { x, duration: 0.45, ease: 'elastic.out(1.2, 0.25)', onUpdate: () => this.tiles.markDirty(t) });
        Object.assign(st, { r: 1.6, g: 0.45, b: 0.45 });
        gsap.to(st, { r: TINT_INVALID[0], g: TINT_INVALID[1], b: TINT_INVALID[2], duration: 0.8, onUpdate: () => this.tiles.markDirty(t) });
      }
    }
  }

  celebrate() {
    const count = this.quality === 'high' ? 240 : this.quality === 'medium' ? 140 : 60;
    this.confetti.burst(new THREE.Vector3(this.cam.tx, 1, this.cam.tz), count);
  }

  /**
   * Cámara cinemática de fin de partida: gira alrededor de la mesa acercándose un poco,
   * con la jugada ganadora brillando en dorado. Se resuelve al terminar o al saltarla.
   */
  playCinematic(tiles: TileId[], opts: { confetti: boolean }): Promise<void> {
    this.skipCinematic();
    this.setInteractive(false);
    const low = this.quality === 'low';
    const seconds = low ? 1.6 : 3.2;
    if (opts.confetti) this.celebrate();
    return new Promise((resolve) => {
      const start = { ...this.cam };
      const tl = gsap.timeline({ onUpdate: () => this.applyCamera(), onComplete: () => this.skipCinematic() });
      tl.to(this.cam, { yaw: low ? 0.6 : 1.25, dist: start.dist * 0.82, duration: seconds, ease: 'sine.inOut' });
      // Brillo pulsante de las fichas de la jugada ganadora
      for (const t of tiles) {
        if (this.loc.get(t) !== 'table') continue;
        const st = this.tiles.get(t);
        tl.to(st, { r: 1.75, g: 1.45, b: 0.7, y: TILE_H / 2 + 0.25, duration: 0.45, yoyo: true, repeat: Math.max(1, Math.round(seconds / 0.45) - 1), ease: 'sine.inOut', onUpdate: () => this.tiles.markDirty(t) }, 0);
      }
      this.cinema = { tl, tiles, done: resolve };
    });
  }

  /** Termina la cinemática (al tocar la pantalla) y devuelve la cámara a su sitio. */
  skipCinematic() {
    const c = this.cinema;
    if (!c) return;
    this.cinema = null;
    c.tl.kill();
    for (const t of c.tiles) {
      const st = this.tiles.get(t);
      if (this.loc.get(t) === 'table') this.tweenTile(this.tiles, t, { y: TILE_H / 2 }, 0.3);
      void st;
    }
    this.refreshTints();
    this.setInteractive(true);
    this.userCamera = false;
    this.fitCamera(true);
    c.done();
  }

  get inCinematic(): boolean {
    return this.cinema !== null;
  }

  setTableTheme(id: string) {
    this.env.setTheme(id, this.scene);
    this.engine.invalidate();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const shadows = q !== 'low';
    this.tiles.setShadowsVisible(shadows);
    this.backs.setShadowsVisible(shadows);
    this.ghost.setShadowsVisible(shadows);
    this.env.setEnvironment(this.scene, this.engine.renderer, q === 'high');
    this.engine.invalidate();
  }

  continuous(): boolean {
    return this.confetti.active || this.cinema !== null;
  }

  update(dt: number) {
    if (this.confetti.active) this.confetti.update(dt);
  }

  render(r: THREE.WebGLRenderer) {
    this.tiles.flush();
    this.backs.flush();
    this.ghost.flush();
    this.rackTiles.flush();
    const w = this.w, h = this.h;
    r.setScissorTest(true);
    r.setViewport(0, this.rackH, w, h - this.rackH);
    r.setScissor(0, this.rackH, w, h - this.rackH);
    r.render(this.scene, this.camera);
    r.setViewport(0, 0, w, this.rackH);
    r.setScissor(0, 0, w, this.rackH);
    r.clearDepth();
    r.render(this.rackScene, this.rackCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
  }

  /** Posición en pantalla (px) de una ficha de la mesa (depuración / tests e2e). */
  screenPosOfTile(t: TileId): { x: number; y: number } | null {
    const where = this.loc.get(t);
    if (where === 'rack') {
      const r = this.rackTiles.get(t);
      return { x: r.x, y: this.h - r.y };
    }
    if (where !== 'table') return null;
    const st = this.tiles.get(t);
    this.tmpV.set(st.x, st.y, st.z).project(this.camera);
    return { x: ((this.tmpV.x + 1) / 2) * this.w, y: ((1 - this.tmpV.y) / 2) * this.mainH };
  }

  /** Posición en pantalla de la mesa (para HUD/tutorial). */
  screenOfTableCenter(): { x: number; y: number } {
    this.tmpV.set(this.cam.tx, 0, this.cam.tz).project(this.camera);
    return { x: ((this.tmpV.x + 1) / 2) * this.w, y: ((1 - this.tmpV.y) / 2) * this.mainH };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHold();
    this.unbindInput();
    for (const s of [this.tiles, this.backs, this.ghost, this.rackTiles]) {
      s.states.forEach((st) => gsap.killTweensOf(st));
      s.dispose();
    }
    this.cinema?.tl.kill();
    this.cinema = null;
    gsap.killTweensOf(this.cam);
    this.ghostMats.forEach((m) => m.dispose());
    this.confetti.dispose();
    this.env.dispose();
    (this.placeholder.material as THREE.Material).dispose();
    this.placeholder.geometry.dispose();
    (this.meldHalo.material as THREE.Material).dispose();
    this.meldHalo.geometry.dispose();
    this.rackBg.geometry.dispose();
    (this.rackBg.material as THREE.Material).dispose();
    this.rackLip.geometry.dispose();
    (this.rackLip.material as THREE.Material).dispose();
    this.rackWood.dispose();
    this.scene.clear();
    this.rackScene.clear();
  }
}
