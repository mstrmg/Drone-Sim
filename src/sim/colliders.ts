import { Vector3 } from 'three';

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

/** Box rotated about the vertical axis only. `center` is the box center, `size` full extents. */
export class BoxCollider implements Collider {
  readonly boundCenter: Vector3;
  readonly boundRadius: number;
  private readonly half: Vector3;
  private readonly cos: number;
  private readonly sin: number;

  constructor(center: Vector3, size: Vector3, yaw = 0) {
    this.boundCenter = center.clone();
    this.half = size.clone().multiplyScalar(0.5);
    this.boundRadius = this.half.length();
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  /** World -> local (undo yaw rotation about +y). */
  private toLocal(p: Vector3): Vector3 {
    const dx = p.x - this.boundCenter.x;
    const dz = p.z - this.boundCenter.z;
    // three.js rotation about +y by yaw: x' = x cos + z sin, z' = -x sin + z cos. Inverse:
    return new Vector3(dx * this.cos - dz * this.sin, p.y - this.boundCenter.y, dx * this.sin + dz * this.cos);
  }

  private toWorldDir(v: Vector3): Vector3 {
    return new Vector3(v.x * this.cos + v.z * this.sin, v.y, -v.x * this.sin + v.z * this.cos);
  }

  test(p: Vector3, r: number): Contact | null {
    const l = this.toLocal(p);
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
      return { normal: this.toWorldDir(new Vector3(dx / d, dy / d, dz / d)), depth: r - d };
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
    return { normal: this.toWorldDir(n), depth };
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
