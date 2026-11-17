import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxCollider, CylinderCollider, type Collider } from '../sim/colliders';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Builds static level geometry from primitives. Every solid piece gets a matching collider, and meshes that share
 * a material are merged into one draw call when the level is finished.
 */
export class Builder {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  mat(color: number, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${color}-${roughness}-${metalness}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Queue a geometry (already in local space) for merging, placed by position and rotation. */
  add(geo: THREE.BufferGeometry, material: THREE.Material, pos: THREE.Vector3, rot?: THREE.Quaternion): void {
    const m = new THREE.Matrix4().compose(pos, rot ?? new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(geo);
  }

  /** Box centered at (x, y, z). `rot` is a yaw angle or a quaternion. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rot: number | THREE.Quaternion = 0, collide = true): void {
    const q = typeof rot === 'number' ? new THREE.Quaternion().setFromAxisAngle(UP, rot) : rot;
    const c = new THREE.Vector3(x, y, z);
    this.add(new THREE.BoxGeometry(sx, sy, sz), this.mat(color), c, q);
    if (collide) this.colliders.push(new BoxCollider(c, new THREE.Vector3(sx, sy, sz), q));
  }

  /** Box resting on y = base, given by its footprint corner-free center. */
  block(x: number, z: number, sx: number, sy: number, sz: number, color: number, yaw = 0, base = 0): void {
    this.box(x, base + sy / 2, z, sx, sy, sz, color, yaw);
  }

  /** Box placed at a local offset from an anchor, rotated by yaw around the anchor. */
  boxAt(anchor: THREE.Vector3, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.box(anchor.x + lx * c + lz * s, anchor.y + ly, anchor.z - lx * s + lz * c, sx, sy, sz, color, yaw);
  }

  /** Square-section beam between two points (girders, cables, ramps, braces). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, color: number, collide = true): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    // Keep the beam's "up" as close to world up as possible so flat ramps stay flat.
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const wantSide = new THREE.Vector3().crossVectors(UP, dir);
    if (wantSide.lengthSq() > 1e-6) {
      wantSide.normalize();
      const twist = Math.atan2(new THREE.Vector3().crossVectors(side, wantSide).dot(dir), side.dot(wantSide));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), twist));
    }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.box(mid.x, mid.y, mid.z, w, h, len, color, q, collide);
  }

  cylinder(x: number, z: number, y0: number, y1: number, r: number, color: number, segments = 16, collide = true): void {
    const h = y1 - y0;
    this.add(new THREE.CylinderGeometry(r, r, h, segments), this.mat(color, 0.8), new THREE.Vector3(x, y0 + h / 2, z));
    if (collide) this.colliders.push(new CylinderCollider(x, z, y0, y1, r));
  }

  cone(x: number, z: number, y0: number, h: number, r: number, color: number, segments = 9): void {
    this.add(new THREE.ConeGeometry(r, h, segments), this.mat(color, 1), new THREE.Vector3(x, y0 + h / 2, z));
  }

  tree(x: number, z: number, scale: number, ground = 0, color = 0x2f5d2a): void {
    const trunkH = 2.8 * scale;
    this.cylinder(x, z, ground, ground + trunkH + 0.5, 0.22 * scale, 0x5a3d26, 7);
    for (let i = 0; i < 3; i++) {
      this.cone(x, z, ground + trunkH + i * 1.6 * scale, (3.2 - i * 0.4) * scale, (2.4 - i * 0.55) * scale, color);
    }
    // Foliage collider: a cylinder about 60% of the cone width, so the tips are flyable.
    this.colliders.push(new CylinderCollider(x, z, ground + trunkH, ground + trunkH + 5.6 * scale, 1.3 * scale));
  }

  /** Leafy deciduous tree: trunk plus a cluster of low-poly spheres. */
  bushyTree(x: number, z: number, scale: number, ground = 0, color = 0x3f6b2e): void {
    const trunkH = 3 * scale;
    this.cylinder(x, z, ground, ground + trunkH + 1, 0.25 * scale, 0x5b4630, 7);
    const leaf = this.mat(color, 1);
    const blobs: [number, number, number, number][] = [
      [0, 1.6, 0, 2.2],
      [1.2, 1.0, 0.4, 1.5],
      [-1.1, 1.1, -0.3, 1.6],
      [0.2, 2.6, -0.5, 1.4],
    ];
    for (const [bx, by, bz, br] of blobs) {
      this.add(new THREE.IcosahedronGeometry(br * scale, 0), leaf, new THREE.Vector3(x + bx * scale, ground + trunkH + by * scale, z + bz * scale));
    }
    this.colliders.push(new CylinderCollider(x, z, ground + trunkH, ground + trunkH + 3.6 * scale, 1.9 * scale));
  }

  /** Race gate: two posts and a top bar, opening w × h, facing along yaw. */
  gate(x: number, z: number, yaw: number, color: number, w = 2.6, h = 2.0): void {
    const t = 0.18;
    const anchor = new THREE.Vector3(x, 0, z);
    this.boxAt(anchor, yaw, -(w / 2 + t / 2), (h + t) / 2, 0, t, h + t, t, color);
    this.boxAt(anchor, yaw, w / 2 + t / 2, (h + t) / 2, 0, t, h + t, t, color);
    this.boxAt(anchor, yaw, 0, h + t / 2, 0, w + 2 * t, t, t, color);
  }

  /** 40 ft shipping container sitting on y, long axis along local z. */
  container(x: number, y: number, z: number, yaw: number, color: number): void {
    this.box(x, y + 1.3, z, 2.44, 2.6, 12.2, color, yaw);
  }

  /**
   * A straight wall from (x0, z0) to (x1, z1) with rectangular openings.
   * Openings are given along the wall as [start, end, bottom, top] in metres from (x0, z0) and the ground.
   */
  wall(x0: number, z0: number, x1: number, z1: number, height: number, thick: number, color: number, openings: [number, number, number, number][] = [], base = 0): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2; // local +x runs along the wall
    const anchor = new THREE.Vector3(x0, base, z0);
    const piece = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
      this.boxAt(anchor, yaw, (a + b) / 2, (y0 + y1) / 2, 0, b - a, y1 - y0, thick, color);
    };
    const ops = [...openings].sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    for (const [a, b, y0, y1] of ops) {
      piece(cursor, a, 0, height);
      piece(a, b, 0, y0);
      piece(a, b, y1, height);
      cursor = b;
    }
    piece(cursor, len, 0, height);
  }

  /** Merge queued geometry into one mesh per material and return the finished group. */
  finish(): THREE.Group {
    for (const [material, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.buckets.clear();
    return this.group;
  }
}
