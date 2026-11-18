import { Quaternion, Vector3 } from 'three';

/** Result of a sphere-vs-shape test. `normal` points out of the shape, toward the sphere. */
export interface Contact {
  normal: Vector3;
  depth: number;
}

export interface Collider {
  /** Returns a contact if a sphere at `p` with radius `r` overlaps this shape. */
  test(p: Vector3, r: number): Contact | null;
  /** Cheap bounding sphere for broad-phase rejection. */
  readonly boundCenter: Vector3;
  readonly boundRadius: number;
}

/** Infinite horizontal ground plane at y = height. */
export class GroundCollider implements Collider {
  readonly boundCenter = new Vector3();
  readonly boundRadius = Infinity;
  constructor(public height = 0) {}
  test(p: Vector3, r: number): Contact | null {
    const d = p.y - this.height;
    if (d >= r) return null;
    return { normal: new Vector3(0, 1, 0), depth: r - d };
  }
}

/** Oriented box. `center` is the box center, `size` full extents, `rotation` a yaw angle or a full quaternion. */
export class BoxCollider implements Collider {
  readonly boundCenter: Vector3;
  readonly boundRadius: number;
  private readonly half: Vector3;
  private readonly rot: Quaternion;
  private readonly invRot: Quaternion;

  constructor(center: Vector3, size: Vector3, rotation: number | Quaternion = 0) {
    this.boundCenter = center.clone();
    this.half = size.clone().multiplyScalar(0.5);
    this.boundRadius = this.half.length();
    this.rot =
      typeof rotation === 'number' ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotation) : rotation.clone();
    this.invRot = this.rot.clone().invert();
  }

  test(p: Vector3, r: number): Contact | null {
    const l = p.clone().sub(this.boundCenter).applyQuaternion(this.invRot);
    const h = this.half;
    const cx = Math.max(-h.x, Math.min(h.x, l.x));
    const cy = Math.max(-h.y, Math.min(h.y, l.y));
    const cz = Math.max(-h.z, Math.min(h.z, l.z));
    const dx = l.x - cx;
    const dy = l.y - cy;
    const dz = l.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 1e-12) {
      if (d2 >= r * r) return null;
      const d = Math.sqrt(d2);
      return { normal: new Vector3(dx / d, dy / d, dz / d).applyQuaternion(this.rot), depth: r - d };
    }
    // Center inside the box: push out through the nearest face.
    const px = h.x - Math.abs(l.x);
    const py = h.y - Math.abs(l.y);
    const pz = h.z - Math.abs(l.z);
    const n = new Vector3();
    let depth: number;
    if (px <= py && px <= pz) {
      n.set(Math.sign(l.x) || 1, 0, 0);
      depth = px + r;
    } else if (py <= pz) {
      n.set(0, Math.sign(l.y) || 1, 0);
      depth = py + r;
    } else {
      n.set(0, 0, Math.sign(l.z) || 1);
      depth = pz + r;
    }
    return { normal: n.applyQuaternion(this.rot), depth };
  }
}

/** Smooth terrain given by a height function y = height(x, z). Suited to gentle slopes. */
export class HeightfieldCollider implements Collider {
  readonly boundCenter = new Vector3();
  readonly boundRadius = Infinity;
  constructor(private readonly height: (x: number, z: number) => number) {}

  test(p: Vector3, r: number): Contact | null {
    const h = this.height(p.x, p.z);
    const above = p.y - h;
    if (above > r * 2) return null; // quick reject, slopes are gentle
    const e = 0.05;
    const n = new Vector3(
      this.height(p.x - e, p.z) - this.height(p.x + e, p.z),
      2 * e,
      this.height(p.x, p.z - e) - this.height(p.x, p.z + e),
    ).normalize();
    const dist = above * n.y; // distance to the local tangent plane
    if (dist >= r) return null;
    return { normal: n, depth: r - dist };
  }
}

/** Vertical cylinder from y0 to y1. */
export class CylinderCollider implements Collider {
  readonly boundCenter: Vector3;
  readonly boundRadius: number;
  constructor(
    public x: number,
    public z: number,
    public y0: number,
    public y1: number,
    public radius: number,
  ) {
    this.boundCenter = new Vector3(x, (y0 + y1) / 2, z);
    this.boundRadius = Math.hypot(radius, (y1 - y0) / 2);
  }

  test(p: Vector3, r: number): Contact | null {
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const rad = Math.hypot(dx, dz);
    const cy = Math.max(this.y0, Math.min(this.y1, p.y));
    const radial = Math.min(rad, this.radius);
    // Closest point on the solid cylinder.
    const s = rad > 1e-9 ? radial / rad : 0;
    const qx = this.x + dx * s;
    const qz = this.z + dz * s;
    const vx = p.x - qx;
    const vy = p.y - cy;
    const vz = p.z - qz;
    const d2 = vx * vx + vy * vy + vz * vz;
    if (d2 > 1e-12) {
      if (d2 >= r * r) return null;
      const d = Math.sqrt(d2);
      return { normal: new Vector3(vx / d, vy / d, vz / d), depth: r - d };
    }
    // Inside: choose side wall or cap, whichever is closer.
    const side = this.radius - rad;
    const top = this.y1 - p.y;
    const bottom = p.y - this.y0;
    if (side <= top && side <= bottom) {
      const n = rad > 1e-9 ? new Vector3(dx / rad, 0, dz / rad) : new Vector3(1, 0, 0);
      return { normal: n, depth: side + r };
    }
    return top < bottom
      ? { normal: new Vector3(0, 1, 0), depth: top + r }
      : { normal: new Vector3(0, -1, 0), depth: bottom + r };
  }
}

/**
 * Uniform grid over the ground plane so the physics loop only looks at colliders near the quad. Unbounded colliders
 * (ground, terrain) and very large ones are always returned.
 */
export class ColliderGrid {
  private readonly cells = new Map<number, Collider[]>();
  private readonly always: Collider[] = [];
  private readonly seen = new Set<Collider>();

  constructor(
    colliders: readonly Collider[],
    private readonly cell = 12,
  ) {
    for (const c of colliders) {
      if (!Number.isFinite(c.boundRadius) || c.boundRadius > cell * 8) {
        this.always.push(c);
        continue;
      }
      const r = c.boundRadius;
      const i0 = Math.floor((c.boundCenter.x - r) / cell);
      const i1 = Math.floor((c.boundCenter.x + r) / cell);
      const k0 = Math.floor((c.boundCenter.z - r) / cell);
      const k1 = Math.floor((c.boundCenter.z + r) / cell);
      for (let i = i0; i <= i1; i++) {
        for (let k = k0; k <= k1; k++) {
          const key = ColliderGrid.key(i, k);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(c);
        }
      }
    }
  }

  private static key(i: number, k: number): number {
    return (i + 32768) * 65536 + (k + 32768);
  }

  /** Colliders whose cells overlap the square of half-size `r` around p, without duplicates. */
  query(p: Vector3, r: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    for (const c of this.always) out.push(c);
    this.seen.clear();
    const i0 = Math.floor((p.x - r) / this.cell);
    const i1 = Math.floor((p.x + r) / this.cell);
    const k0 = Math.floor((p.z - r) / this.cell);
    const k1 = Math.floor((p.z + r) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        const list = this.cells.get(ColliderGrid.key(i, k));
        if (!list) continue;
        for (const c of list) {
          if (this.seen.has(c)) continue;
          this.seen.add(c);
          out.push(c);
        }
      }
    }
    return out;
  }
}
