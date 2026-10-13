import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createFeltTexture, createWoodTexture } from './textures';
import { tableTheme, type TableTheme } from './themes';

/** Mesa de fieltro con borde de madera + iluminación cálida. */
export class TableEnvironment {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private envRT: THREE.WebGLRenderTarget | null = null;
  readonly halfW: number;
  readonly halfD: number;

  private feltMat: THREE.MeshStandardMaterial;
  private felt: THREE.Texture;
  private glowTex: THREE.CanvasTexture;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  theme: TableTheme;

  constructor(halfW = 16, halfD = 12, themeId = 'green') {
    this.halfW = halfW;
    this.halfD = halfD;
    this.theme = tableTheme(themeId);
    const felt = createFeltTexture(this.theme);
    this.applyRepeat(felt, this.theme);
    this.felt = felt;
    const feltMat = new THREE.MeshStandardMaterial({ map: felt, roughness: this.theme.wood ? 0.6 : 0.95, metalness: 0 });
    this.feltMat = feltMat;
    const feltGeo = new THREE.PlaneGeometry(halfW * 2, halfD * 2);
    feltGeo.rotateX(-Math.PI / 2);
    const feltMesh = new THREE.Mesh(feltGeo, feltMat);
    this.group.add(feltMesh);

    // Halo de luz cálida sobre el fieltro (falso spot "baked")
    const glowTex = this.makeGlow(this.theme.glow);
    this.glowTex = glowTex;
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const glowGeo = new THREE.PlaneGeometry(halfW * 1.6, halfD * 1.6);
    glowGeo.rotateX(-Math.PI / 2);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.002;
    glow.renderOrder = -2;
    this.group.add(glow);

    // Borde de madera
    const wood = createWoodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05 });
    const rimH = 0.6, rimW = 1.6;
    const mk = (w: number, d: number, x: number, z: number, rot = false) => {
      const geo = new THREE.BoxGeometry(w, rimH, d);
      const m = new THREE.Mesh(geo, woodMat);
      m.position.set(x, rimH / 2 - 0.1, z);
      if (rot) wood.repeat.set(1, 1);
      this.group.add(m);
      this.disposables.push(geo);
    };
    mk(halfW * 2 + rimW * 2, rimW, 0, -halfD - rimW / 2);
    mk(halfW * 2 + rimW * 2, rimW, 0, halfD + rimW / 2);
    mk(rimW, halfD * 2, -halfW - rimW / 2, 0, true);
    mk(rimW, halfD * 2, halfW + rimW / 2, 0, true);

    // Suelo oscuro más allá de la mesa
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x07090a });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.5;
    this.group.add(floor);

    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x1b2a26, this.theme.hemi);
    const key = new THREE.DirectionalLight(0xffdcae, this.theme.key);
    this.hemi = hemi;
    this.key = key;
    key.position.set(5, 12, 7);
    const fill = new THREE.DirectionalLight(0x9ec8ff, 0.35);
    fill.position.set(-8, 6, -4);
    this.group.add(hemi, key, fill);

    this.disposables.push(feltMat, feltGeo, glowMat, glowGeo, wood, woodMat, floorGeo, floorMat);
    this.glowMat = glowMat;
  }

  private glowMat: THREE.MeshBasicMaterial;

  /** Fieltro: grano fino repetido. Madera: tablones largos (la textura es 4:1). */
  private applyRepeat(tex: THREE.Texture, t: TableTheme) {
    if (t.wood) {
      tex.wrapS = THREE.MirroredRepeatWrapping;
      tex.repeat.set(2.2, 7);
    } else tex.repeat.set(this.halfW / 2, this.halfD / 2);
  }

  private makeGlow(color: string): THREE.CanvasTexture {
    const glowC = document.createElement('canvas');
    glowC.width = glowC.height = 256;
    const g = glowC.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(glowC);
  }

  /** Cambia el color de la mesa en vivo. */
  setTheme(themeId: string, scene?: THREE.Scene) {
    const t = tableTheme(themeId);
    if (t.id === this.theme.id) return;
    this.theme = t;
    this.felt.dispose();
    this.felt = createFeltTexture(t);
    this.applyRepeat(this.felt, t);
    this.feltMat.map = this.felt;
    this.feltMat.roughness = t.wood ? 0.6 : 0.95;
    this.feltMat.needsUpdate = true;
    this.glowTex.dispose();
    this.glowTex = this.makeGlow(t.glow);
    this.glowMat.map = this.glowTex;
    this.glowMat.needsUpdate = true;
    this.hemi.intensity = t.hemi;
    this.key.intensity = t.key;
    if (scene) {
      (scene.background as THREE.Color | null)?.setHex(t.background);
      (scene.fog as THREE.Fog | null)?.color.setHex(t.background);
    }
  }

  /** Reflejos suaves de entorno (solo calidad alta). */
  setEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, on: boolean) {
    if (on && !this.envRT) {
      const pm = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envRT = pm.fromScene(room, 0.04);
      room.dispose();
      pm.dispose();
    }
    scene.environment = on && this.envRT ? this.envRT.texture : null;
    scene.environmentIntensity = 0.35;
  }

  dispose() {
    this.felt.dispose();
    this.glowTex.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.envRT?.dispose();
    this.group.removeFromParent();
  }
}
