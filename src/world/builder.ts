import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxCollider, CylinderCollider, type Collider } from '../sim/colliders';
import { uvScaleOf } from './materials';

const UP = new THREE.Vector3(0, 1, 0);

/** A material, or a plain color for an untextured material. */
export type Mat = number | THREE.Material;

/**
 * Builds static level geometry from primitives. Every solid piece gets a matching collider, textured pieces get
 * world-space UVs (so textures keep their real-world size on any box), and meshes that share a material are merged
 * into one draw call when the level is finished.
 */
export class Builder {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly noShadow = new Set<THREE.Material>();

  mat(color: number, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${color}-${roughness}-${metalness}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.mats.set(key, m);
    }
    return m;
  }

  resolve(m: Mat): THREE.Material {
    return typeof m === 'number' ? this.mat(m) : m;
  }

  /** Materials whose merged mesh should not cast shadows (tiny or semi-transparent detail). */
  noShadowFor(m: THREE.Material): void {
    this.noShadow.add(m);
  }

  /**
   * Queue a geometry for merging, placed by position and rotation.
   * `uv`: 'world' projects UVs from world position (boxes), 'keep' keeps the geometry's own UVs.
   */
  add(geo: THREE.BufferGeometry, m: Mat, pos: THREE.Vector3, rot?: THREE.Quaternion, uv: 'world' | 'keep' = 'world'): void {
    const material = this.resolve(m);
    const mtx = new THREE.Matrix4().compose(pos, rot ?? new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(mtx);
    if (uv === 'world' && (material as THREE.MeshStandardMaterial).map) worldUVs(geo, uvScaleOf(material));
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(geo);
  }

  /** Box centered at (x, y, z). `rot` is a yaw angle or a quaternion. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, m: Mat, rot: number | THREE.Quaternion = 0, collide = true): void {
    const q = typeof rot === 'number' ? new THREE.Quaternion().setFromAxisAngle(UP, rot) : rot;
    const c = new THREE.Vector3(x, y, z);
    this.add(new THREE.BoxGeometry(sx, sy, sz), m, c, q);
    if (collide) this.colliders.push(new BoxCollider(c, new THREE.Vector3(sx, sy, sz), q));
  }

  /** Box resting on y = base. */
  block(x: number, z: number, sx: number, sy: number, sz: number, m: Mat, yaw = 0, base = 0, collide = true): void {
    this.box(x, base + sy / 2, z, sx, sy, sz, m, yaw, collide);
  }

  /** Box placed at a local offset from an anchor, rotated by yaw around the anchor. */
  boxAt(anchor: THREE.Vector3, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, m: Mat, collide = true): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.box(anchor.x + lx * c + lz * s, anchor.y + ly, anchor.z - lx * s + lz * c, sx, sy, sz, m, yaw, collide);
  }

  /** Box at a local offset inside a rotated frame (origin + q·local), sharing the frame's rotation. */
  boxIn(origin: THREE.Vector3, q: THREE.Quaternion, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, m: Mat, collide = true): void {
    const c = new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(origin);
    this.box(c.x, c.y, c.z, sx, sy, sz, m, q, collide);
  }

  /**
   * Hollow round tube between two points (culvert pipes, tank shells) that can be flown through.
   * It collides as a ring of boxes, so the inside stays open.
   */
  tube(a: THREE.Vector3, b: THREE.Vector3, r: number, wall: number, m: Mat, segments = 20, collide = true): void {
    const material = this.resolve(m);
    const s = uvScaleOf(material);
    const len = a.distanceTo(b);
    const q = Builder.alignQuat(a, b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const shell = (radius: number, inward: boolean) => {
      const g = new THREE.CylinderGeometry(radius, radius, len, segments, 1, true);
      g.rotateX(Math.PI / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * radius) / s, (uv.getY(i) * len) / s);
      if (inward) flipFaces(g);
      this.add(g, material, mid, q, 'keep');
    };
    shell(r, false);
    shell(r - wall, true);
    for (const end of [1, -1]) {
      const ring = new THREE.RingGeometry(r - wall, r, segments);
      if (end < 0) ring.rotateY(Math.PI);
      ring.translate(0, 0, (end * len) / 2);
      this.add(ring, material, mid, q, 'keep');
    }
    if (!collide) return;
    const n = 10;
    const chord = 2 * r * Math.tan(Math.PI / n);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const qi = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), th + Math.PI / 2));
      const c = new THREE.Vector3(Math.cos(th) * (r - wall / 2), Math.sin(th) * (r - wall / 2), 0).applyQuaternion(q).add(mid);
      this.colliders.push(new BoxCollider(c, new THREE.Vector3(chord, wall, len), qi));
    }
  }

  /**
   * Flat quad facing along yaw (its normal is (sin yaw, 0, cos yaw)), textured from the rectangle
   * [u0, v0, u1, v1] of an atlas. Visual only: used for graffiti and signs.
   */
  sticker(x: number, y: number, z: number, yaw: number, w: number, h: number, m: Mat, rect: [number, number, number, number]): void {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
    this.add(geo, m, new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), 'keep');
  }

  /** Rotation that points local +z along a→b while keeping local +y as close to world up as possible. */
  static alignQuat(a: THREE.Vector3, b: THREE.Vector3): THREE.Quaternion {
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const wantSide = new THREE.Vector3().crossVectors(UP, dir);
    if (wantSide.lengthSq() > 1e-6) {
      wantSide.normalize();
      const twist = Math.atan2(new THREE.Vector3().crossVectors(side, wantSide).dot(dir), side.dot(wantSide));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), twist));
    }
    return q;
  }

  /** Rectangular-section beam between two points (girders, braces, ramps, cables). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, m: Mat, collide = true): void {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.box(mid.x, mid.y, mid.z, w, h, a.distanceTo(b), m, Builder.alignQuat(a, b), collide);
  }

  /** Round pipe between two points. Collides as a square beam of the same width. */
  pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, m: Mat, segments = 10, collide = true): void {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, segments, 1, true);
    geo.rotateX(Math.PI / 2); // along +z
    const q = Builder.alignQuat(a, b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.add(geo, m, mid, q);
    if (collide) this.colliders.push(new BoxCollider(mid, new THREE.Vector3(2 * r, 2 * r, len), q));
  }

  /** Vertical cylinder with UVs wrapped at real-world scale. */
  cylinder(x: number, z: number, y0: number, y1: number, r: number, m: Mat, segments = 16, collide = true, rTop = r): void {
    const h = y1 - y0;
    const geo = new THREE.CylinderGeometry(rTop, r, h, segments);
    const material = this.resolve(m);
    const s = uvScaleOf(material);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / s, (uv.getY(i) * h) / s);
    this.add(geo, material, new THREE.Vector3(x, y0 + h / 2, z), undefined, 'keep');
    if (collide) this.colliders.push(new CylinderCollider(x, z, y0, y1, Math.max(r, rTop)));
  }

  cone(x: number, z: number, y0: number, h: number, r: number, m: Mat, segments = 9): void {
    this.add(new THREE.ConeGeometry(r, h, segments), m, new THREE.Vector3(x, y0 + h / 2, z), undefined, 'keep');
  }

  /** Conifer: trunk and stacked cones. Foliage collides as a cylinder about 60% of its width. */
  pine(x: number, z: number, scale: number, ground: number, foliage: Mat, trunk: Mat = 0x5a3d26): void {
    const trunkH = 2.2 * scale;
    const tiers = 4;
    this.cylinder(x, z, ground, ground + trunkH + 4 * scale, 0.22 * scale, trunk, 6, true, 0.12 * scale);
    for (let i = 0; i < tiers; i++) {
      const r = (2.6 - i * 0.55) * scale;
      const h = (3.2 - i * 0.45) * scale;
      this.cone(x, z, ground + trunkH + i * 1.45 * scale, h, r, foliage, 8);
    }
    this.colliders.push(new CylinderCollider(x, z, ground + trunkH, ground + trunkH + 6.5 * scale, 1.4 * scale));
  }

  /** Deciduous tree: trunk, a couple of branches and a crown of low-poly blobs. */
  leafy(x: number, z: number, scale: number, ground: number, foliage: Mat, rnd: () => number, trunk: Mat = 0x5b4630): void {
    const trunkH = 3 * scale;
    this.cylinder(x, z, ground, ground + trunkH + 1.2 * scale, 0.28 * scale, trunk, 7, true, 0.16 * scale);
    const crown = new THREE.Vector3(x, ground + trunkH + 1.8 * scale, z);
    for (let i = 0; i < 2; i++) {
      const ang = rnd() * Math.PI * 2;
      const tip = crown.clone().add(new THREE.Vector3(Math.cos(ang) * 1.3 * scale, 0.4 * scale, Math.sin(ang) * 1.3 * scale));
      this.beam(new THREE.Vector3(x, ground + trunkH * 0.8, z), tip, 0.14 * scale, 0.14 * scale, trunk, false);
    }
    const n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd();
      const d = (i === 0 ? 0 : 1.1 + rnd() * 0.6) * scale;
      const r = (1.3 + rnd() * 0.9) * scale;
      const p = crown.clone().add(new THREE.Vector3(Math.cos(a) * d, (rnd() - 0.3) * 1.4 * scale + (i === 0 ? 0.9 * scale : 0), Math.sin(a) * d));
      this.add(new THREE.IcosahedronGeometry(r, 1), foliage, p, undefined, 'keep');
    }
    this.colliders.push(new CylinderCollider(x, z, ground + trunkH, ground + trunkH + 4 * scale, 2.1 * scale));
  }

  /** Simple car: body, cabin, wheels. */
  car(x: number, z: number, yaw: number, body: Mat, base = 0, glass: Mat = 0x23303a): void {
    const a = new THREE.Vector3(x, base, z);
    this.boxAt(a, yaw, 0, 0.75, 0, 1.8, 0.7, 4.3, body);
    this.boxAt(a, yaw, 0, 1.35, 0.25, 1.6, 0.55, 2.2, glass);
    for (const [wx, wz] of [
      [-0.85, -1.35],
      [0.85, -1.35],
      [-0.85, 1.4],
      [0.85, 1.4],
    ]) this.boxAt(a, yaw, wx, 0.33, wz, 0.25, 0.66, 0.66, 0x1c1c1c, false);
  }

  /** Race gate: two posts and a top bar, opening w × h, facing along yaw. */
  gate(x: number, z: number, yaw: number, m: Mat, w = 2.6, h = 2.0): void {
    const t = 0.18;
    const anchor = new THREE.Vector3(x, 0, z);
    this.boxAt(anchor, yaw, -(w / 2 + t / 2), (h + t) / 2, 0, t, h + t, t, m);
    this.boxAt(anchor, yaw, w / 2 + t / 2, (h + t) / 2, 0, t, h + t, t, m);
    this.boxAt(anchor, yaw, 0, h + t / 2, 0, w + 2 * t, t, t, m);
  }

  /** 40 ft shipping container sitting on y, long axis along local z, with door bars on one end. */
  container(x: number, y: number, z: number, yaw: number | THREE.Quaternion, m: Mat): void {
    this.box(x, y + 1.3, z, 2.44, 2.6, 12.2, m, yaw);
    if (typeof yaw === 'number') {
      const a = new THREE.Vector3(x, y, z);
      for (const lx of [-0.7, -0.25, 0.25, 0.7]) this.boxAt(a, yaw, lx, 1.3, 6.12, 0.05, 2.4, 0.06, 0x555555, false);
    }
  }

  /**
   * A straight wall from (x0, z0) to (x1, z1) with rectangular openings.
   * Openings are [start, end, bottom, top] in metres along the wall from (x0, z0) and up from its base.
   */
  wall(x0: number, z0: number, x1: number, z1: number, height: number, thick: number, m: Mat, openings: [number, number, number, number][] = [], base = 0): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2; // local +x runs along the wall
    const anchor = new THREE.Vector3(x0, base, z0);
    const piece = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
      this.boxAt(anchor, yaw, (a + b) / 2, (y0 + y1) / 2, 0, b - a, y1 - y0, thick, m);
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
      const merged = mergeGeometries(geos.map(normalizeAttributes), false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !this.noShadow.has(material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.buckets.clear();
    return this.group;
  }
}

/** Turns a surface inside out: reverses triangle winding and normals. */
function flipFaces(g: THREE.BufferGeometry): void {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const t = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, t);
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

/** Box-projected UVs from world position, picking the plane from the dominant normal axis. */
function worldUVs(geo: THREE.BufferGeometry, scale: number): void {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  let uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv.setXY(i, u / scale, v / scale);
  }
  uv.needsUpdate = true;
}

/** mergeGeometries needs every geometry indexed alike and with the same attributes. */
function normalizeAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g;
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out.index ? out : out.setIndex([...Array(out.attributes.position.count).keys()]);
}
