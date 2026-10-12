/** Fondo 3D del menú: mesa y fichas flotando suavemente. */
import * as THREE from 'three';
import type { Engine, EngineScene, Quality } from './engine';
import { TableEnvironment } from './environment';
import { cellOf } from './textures';
import { TILE_H, TileSet } from './tileset';

const SHOW = [
  [0, 1], [0, 2], [0, 3], [1, 7], [2, 7], [3, 7], [2, 10], [2, 11], [2, 12], [2, 13], [1, 1], [3, 5],
];

export class HomeScene implements EngineScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private env = new TableEnvironment(16, 12);
  private tiles: TileSet;
  private t = 0;
  private items: { x: number; z: number; phase: number; ry: number; float: boolean }[] = [];

  constructor(private engine: Engine) {
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.Fog(0x07090a, 18, 45);
    this.scene.add(this.env.group);
    this.tiles = new TileSet(SHOW.length + 2, engine.res, true);
    this.scene.add(this.tiles.group);
    const ids = SHOW.map(([c, n]) => c! * 13 + n! - 1);
    ids.push(104, 105);
    ids.forEach((id, i) => {
      const meld = i < 3 ? 0 : i < 6 ? 1 : i < 10 ? 2 : 3;
      const x = meld === 0 ? -4 + i * 1.06 : meld === 1 ? 1 + (i - 3) * 1.06 : meld === 2 ? -3.5 + (i - 6) * 1.06 : (Math.random() - 0.5) * 9;
      const z = meld === 0 ? -1.5 : meld === 1 ? -1.5 : meld === 2 ? 0.8 : 2.8 + Math.random() * 1.5;
      const float = meld === 3;
      this.items.push({ x, z, phase: Math.random() * 6, ry: float ? (Math.random() - 0.5) * 1.2 : 0, float });
      this.tiles.set(i, { x, y: TILE_H / 2, z, s: 1, visible: true, cell: cellOf(id), ry: this.items[i]!.ry });
    });
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  continuous() {
    return true;
  }

  update(dt: number) {
    this.t += dt;
    const r = 13;
    const a = Math.sin(this.t * 0.08) * 0.35;
    this.camera.position.set(Math.sin(a) * r * 0.5, 9.5, Math.cos(a) * r);
    this.camera.lookAt(0, 0, 0.5);
    this.items.forEach((it, i) => {
      if (!it.float) return;
      const y = 0.9 + Math.sin(this.t * 0.9 + it.phase) * 0.35;
      this.tiles.set(i, { y, rx: Math.sin(this.t * 0.5 + it.phase) * 0.4, ry: it.ry + this.t * 0.2, rz: Math.cos(this.t * 0.4 + it.phase) * 0.3 });
    });
  }

  setQuality(q: Quality) {
    this.tiles.setShadowsVisible(q !== 'low');
    this.env.setEnvironment(this.scene, this.engine.renderer, q === 'high');
  }

  render(r: THREE.WebGLRenderer) {
    this.tiles.flush();
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.tiles.dispose();
    this.env.dispose();
    this.scene.clear();
  }
}
