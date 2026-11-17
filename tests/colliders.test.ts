import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { BoxCollider, HeightfieldCollider } from '../src/sim/colliders';
import { bandoTerrain } from '../src/world/maps/bando';
import { Quad } from '../src/sim/quad';
import { FREESTYLE_5IN } from '../src/sim/params';

describe('colliders', () => {
  it('yaw-only box matches the quaternion form', () => {
    const a = new BoxCollider(new Vector3(0, 1, 0), new Vector3(2, 2, 6), 0.4);
    const b = new BoxCollider(new Vector3(0, 1, 0), new Vector3(2, 2, 6), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4));
    for (const p of [new Vector3(1.05, 1, 0), new Vector3(0.5, 2.02, 2.5), new Vector3(-1, 1, -3)]) {
      const ca = a.test(p, 0.1);
      const cb = b.test(p, 0.1);
      expect(!!ca).toBe(!!cb);
      if (ca && cb) {
        expect(ca.depth).toBeCloseTo(cb.depth);
        expect(ca.normal.distanceTo(cb.normal)).toBeLessThan(1e-9);
      }
    }
  });

  it('tilted box (ramp) pushes out along its tilted face normal', () => {
    const tilt = 0.3;
    const ramp = new BoxCollider(new Vector3(0, 0, 0), new Vector3(4, 0.2, 8), new Quaternion().setFromEuler(new Euler(tilt, 0, 0)));
    const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(tilt, 0, 0)));
    const c = ramp.test(up.clone().multiplyScalar(0.15), 0.1)!;
    expect(c).not.toBeNull();
    expect(c.normal.dot(up)).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.05);
  });

  it('heightfield reports contact on flat ground and on a slope', () => {
    const flat = new HeightfieldCollider(() => 0);
    expect(flat.test(new Vector3(0, 0.05, 0), 0.1)!.depth).toBeCloseTo(0.05);
    expect(flat.test(new Vector3(0, 0.5, 0), 0.1)).toBeNull();
    const slope = new HeightfieldCollider((x) => x * 0.5);
    const c = slope.test(new Vector3(2, 1.05, 0), 0.1)!;
    expect(c.normal.x).toBeLessThan(0);
    expect(c.normal.y).toBeGreaterThan(0.85);
  });

  it('bando terrain is flat on the lot and hilly further out', () => {
    expect(bandoTerrain(0, 30)).toBe(0);
    expect(bandoTerrain(60, -40)).toBe(0);
    let maxH = 0;
    for (let x = -400; x <= 400; x += 20) for (let z = -400; z <= 400; z += 20) maxH = Math.max(maxH, bandoTerrain(x, z));
    expect(maxH).toBeGreaterThan(8);
  });

  it('a quad dropped on a hillside comes to rest on it', () => {
    const quad = new Quad(FREESTYLE_5IN);
    const x = 0;
    const z = -40 - 260;
    quad.reset(new Vector3(x, bandoTerrain(x, z) + 1, z));
    const ground = [new HeightfieldCollider(bandoTerrain)];
    for (let i = 0; i < 4000; i++) quad.step(1 / 1000, null, ground);
    expect(quad.position.y - bandoTerrain(quad.position.x, quad.position.z)).toBeGreaterThan(0);
    expect(quad.position.y - bandoTerrain(quad.position.x, quad.position.z)).toBeLessThan(0.15);
  });
});
