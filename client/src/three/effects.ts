import * as THREE from 'three';

const COLORS = [0xf5c542, 0xd3343b, 0x1f63c6, 0xe58a0c, 0xffffff, 0x3ccf91];

/** Confeti 3D instanciado (un draw call). */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private geo = new THREE.PlaneGeometry(0.16, 0.26);
  private mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life = 0;
  private count: number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(private max = 260) {
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.count = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, c.setHex(COLORS[i % COLORS.length]!));
  }

  get active(): boolean {
    return this.life > 0;
  }

  burst(center: THREE.Vector3, count: number) {
    this.count = Math.min(this.max, count);
    this.mesh.count = this.count;
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      this.pos.set([center.x + (Math.random() - 0.5) * 2, center.y, center.z + (Math.random() - 0.5) * 2], i * 3);
      this.vel.set([Math.cos(a) * sp * 0.6, 7 + Math.random() * 7, Math.sin(a) * sp * 0.6], i * 3);
      this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
    }
    this.life = 3.6;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.vel[k + 1]! -= 14 * dt;
      // rozamiento del aire: cae como papel
      this.vel[k]! *= 1 - 1.6 * dt;
      this.vel[k + 2]! *= 1 - 1.6 * dt;
      if (this.vel[k + 1]! < -2.2) this.vel[k + 1] = -2.2;
      for (let j = 0; j < 3; j++) {
        this.pos[k + j]! += this.vel[k + j]! * dt;
        this.rot[k + j]! += this.spin[k + j]! * dt;
      }
      if (this.pos[k + 1]! < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k] = this.vel[k + 1] = this.vel[k + 2] = 0;
        this.spin[k] = this.spin[k + 1] = this.spin[k + 2] = 0;
      }
      this.q.setFromEuler(this.e.set(this.rot[k]!, this.rot[k + 1]!, this.rot[k + 2]!));
      this.v.set(this.pos[k]!, this.pos[k + 1]!, this.pos[k + 2]!);
      const fade = Math.min(1, this.life / 0.6);
      this.m.compose(this.v, this.q, this.one.setScalar(fade));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.life <= 0) this.mesh.visible = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
