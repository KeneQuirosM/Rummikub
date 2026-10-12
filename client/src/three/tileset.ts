/**
 * Fichas renderizadas con InstancedMesh: cuerpo biselado + cara con atlas + sombra de contacto.
 * 3 draw calls por conjunto, sin importar cuántas fichas haya.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ATLAS_COLS, ATLAS_ROWS, cellOffset } from './textures';

export const TILE_W = 1;
export const TILE_D = 1.36;
export const TILE_H = 0.26;

export interface TileState {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
  visible: boolean;
  cell: number;
  /** Multiplicador de color (>1 = brillo). */
  r: number;
  g: number;
  b: number;
  /** Altura usada para la sombra (por defecto y). */
  shadow: number;
}

/** Recursos compartidos por todos los conjuntos (geometrías y materiales). */
export class TileResources {
  bodyGeo: THREE.BufferGeometry;
  faceGeo: THREE.PlaneGeometry;
  shadowGeo: THREE.PlaneGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  faceMat: THREE.MeshStandardMaterial;
  shadowMat: THREE.ShaderMaterial;
  atlas: THREE.Texture;

  constructor(atlas: THREE.Texture) {
    this.atlas = atlas;
    this.bodyGeo = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 3, 0.09);
    this.faceGeo = new THREE.PlaneGeometry(TILE_W * 0.9, TILE_D * 0.92);
    this.faceGeo.rotateX(-Math.PI / 2);
    this.faceGeo.translate(0, TILE_H / 2 + 0.002, 0);
    this.shadowGeo = new THREE.PlaneGeometry(1, 1);
    this.shadowGeo.rotateX(-Math.PI / 2);

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xf3ecd9, roughness: 0.42, metalness: 0.0 });
    this.faceMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.38, metalness: 0.0 });
    const cw = (1 / ATLAS_COLS).toFixed(6), ch = (1 / ATLAS_ROWS).toFixed(6);
    this.faceMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2(aCell.x + uv.x * ${cw}, aCell.y + (1.0 - uv.y) * ${ch});\n#endif`,
        );
    };
    this.faceMat.customProgramCacheKey = () => 'tileface';

    this.shadowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aOpacity;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vec2 p = abs(vUv - 0.5) * 2.0;
          vec2 q = max(p - vec2(0.45, 0.5), 0.0);
          float d = length(q) / 0.5;
          float a = (1.0 - smoothstep(0.0, 1.0, d)) * vOpacity;
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
    });
  }

  setAtlas(atlas: THREE.Texture) {
    this.atlas.dispose();
    this.atlas = atlas;
    this.faceMat.map = atlas;
    this.faceMat.needsUpdate = true;
  }

  dispose() {
    this.bodyGeo.dispose();
    this.faceGeo.dispose();
    this.shadowGeo.dispose();
    this.bodyMat.dispose();
    this.faceMat.dispose();
    this.shadowMat.dispose();
    this.atlas.dispose();
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export type TileMaterials = Pick<TileResources, 'bodyGeo' | 'faceGeo' | 'shadowGeo' | 'bodyMat' | 'faceMat' | 'shadowMat'>;

export class TileSet {
  readonly group = new THREE.Group();
  readonly body: THREE.InstancedMesh;
  readonly face: THREE.InstancedMesh;
  readonly shadow: THREE.InstancedMesh | null;
  readonly states: TileState[];
  private faceGeo: THREE.BufferGeometry;
  private shadowGeo: THREE.BufferGeometry | null = null;
  private cellAttr: THREE.InstancedBufferAttribute;
  private opacityAttr: THREE.InstancedBufferAttribute | null = null;
  private dirty = new Set<number>();
  onDirty: () => void = () => {};

  constructor(readonly capacity: number, res: TileMaterials, withShadows: boolean) {
    this.states = Array.from({ length: capacity }, () => ({
      x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, visible: false, cell: 0, r: 1, g: 1, b: 1, shadow: -1,
    }));
    this.body = new THREE.InstancedMesh(res.bodyGeo, res.bodyMat, capacity);
    this.faceGeo = res.faceGeo.clone();
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.faceGeo.setAttribute('aCell', this.cellAttr);
    this.face = new THREE.InstancedMesh(this.faceGeo, res.faceMat, capacity);
    for (const m of [this.body, this.face]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      for (let i = 0; i < capacity; i++) {
        m.setMatrixAt(i, ZERO);
        m.setColorAt(i, _c.setRGB(1, 1, 1));
      }
      this.group.add(m);
    }
    this.face.renderOrder = 1;
    if (withShadows) {
      this.shadowGeo = res.shadowGeo.clone();
      this.opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      this.shadowGeo.setAttribute('aOpacity', this.opacityAttr);
      this.shadow = new THREE.InstancedMesh(this.shadowGeo, res.shadowMat, capacity);
      this.shadow.frustumCulled = false;
      this.shadow.renderOrder = -1;
      for (let i = 0; i < capacity; i++) this.shadow.setMatrixAt(i, ZERO);
      this.group.add(this.shadow);
    } else {
      this.shadow = null;
    }
  }

  get(i: number): TileState {
    return this.states[i]!;
  }

  markDirty(i: number) {
    this.dirty.add(i);
    this.onDirty();
  }

  /** Atajo para actualizar varias propiedades y marcar sucio. */
  set(i: number, patch: Partial<TileState>) {
    Object.assign(this.states[i]!, patch);
    this.markDirty(i);
  }

  hideAll() {
    for (let i = 0; i < this.capacity; i++) {
      if (this.states[i]!.visible) this.set(i, { visible: false });
    }
  }

  setShadowsVisible(v: boolean) {
    if (this.shadow) this.shadow.visible = v;
  }

  /** Aplica las instancias sucias a las matrices de GPU. */
  flush(): boolean {
    if (this.dirty.size === 0) return false;
    for (const i of this.dirty) {
      const st = this.states[i]!;
      if (!st.visible || st.s <= 0) {
        this.body.setMatrixAt(i, ZERO);
        this.face.setMatrixAt(i, ZERO);
        this.shadow?.setMatrixAt(i, ZERO);
        continue;
      }
      _p.set(st.x, st.y, st.z);
      _q.setFromEuler(_e.set(st.rx, st.ry, st.rz));
      _s.setScalar(st.s);
      _m.compose(_p, _q, _s);
      this.body.setMatrixAt(i, _m);
      this.face.setMatrixAt(i, _m);
      _c.setRGB(st.r, st.g, st.b);
      this.body.setColorAt(i, _c);
      this.face.setColorAt(i, _c);
      const [u, v] = cellOffset(st.cell);
      this.cellAttr.setXY(i, u, v);
      if (this.shadow && this.opacityAttr) {
        const h = Math.max(0, (st.shadow >= 0 ? st.shadow : st.y) - TILE_H / 2);
        const spread = 1 + h * 0.5;
        _p.set(st.x + h * 0.25, 0.004, st.z + h * 0.3);
        _q.setFromEuler(_e.set(0, st.ry, 0));
        _s.set(TILE_W * 1.35 * spread * st.s, 1, TILE_D * 1.3 * spread * st.s);
        _m.compose(_p, _q, _s);
        this.shadow.setMatrixAt(i, _m);
        this.opacityAttr.setX(i, Math.max(0.12, 0.85 - h * 0.35));
      }
    }
    this.dirty.clear();
    // Forzar recálculo de los volúmenes para que el raycast no use datos viejos
    this.body.boundingSphere = null;
    this.body.boundingBox = null;
    this.body.instanceMatrix.needsUpdate = true;
    this.face.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.face.instanceColor) this.face.instanceColor.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
    if (this.shadow) {
      this.shadow.instanceMatrix.needsUpdate = true;
      this.opacityAttr!.needsUpdate = true;
    }
    return true;
  }

  /** Raycast: devuelve el índice de instancia visible más cercano. */
  raycast(ray: THREE.Raycaster): number | null {
    const hits = ray.intersectObject(this.body, false);
    for (const h of hits) {
      if (h.instanceId !== undefined && this.states[h.instanceId]!.visible) return h.instanceId;
    }
    return null;
  }

  dispose() {
    this.faceGeo.dispose();
    this.shadowGeo?.dispose();
    this.body.dispose();
    this.face.dispose();
    this.shadow?.dispose();
    this.group.removeFromParent();
  }
}
