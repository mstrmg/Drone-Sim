import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Quad } from '../src/sim/quad';
import { FREESTYLE_5IN } from '../src/sim/params';
import { GroundCollider } from '../src/sim/colliders';
import { Battery, cellOcv } from '../src/sim/battery';
import { FlightController, DEFAULT_PIDS } from '../src/fc/flightController';
import { DEFAULT_RATES } from '../src/fc/rates';

const DT = 1 / 1000;
const ALL_OFF = { propWash: false, battery: false, damage: false };

describe('battery', () => {
  it('has a monotonic discharge curve from 4.2 V to about 3.3 V per cell', () => {
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const v = cellOcv(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(cellOcv(1)).toBeCloseTo(4.2);
    expect(cellOcv(0)).toBeLessThan(3.35);
  });

  it('sags under a punch-out and recovers when the load drops', () => {
    const b = new Battery();
    for (let i = 0; i < 1000; i++) b.step(25, DT);
    const rest = b.voltage;
    for (let i = 0; i < 1500; i++) b.step(2400, DT); // about 100 A
    const loaded = b.voltage;
    expect(b.current).toBeGreaterThan(90);
    expect(rest - loaded).toBeGreaterThan(1.8);
    for (let i = 0; i < 3000; i++) b.step(25, DT);
    expect(b.voltage).toBeGreaterThan(loaded + 1.5);
  });

  it('counts the charge drawn', () => {
    const b = new Battery();
    // About 30 A for 60 s is 0.5 Ah.
    for (let i = 0; i < 60000; i++) b.step(30 * b.voltage, DT);
    expect(b.usedAh * 1000).toBeGreaterThan(470);
    expect(b.usedAh * 1000).toBeLessThan(530);
  });

  it('a drained pack makes less full-throttle thrust than a fresh one', () => {
    const thrustAt = (usedAh: number) => {
      const q = new Quad(FREESTYLE_5IN);
      q.realism = { ...ALL_OFF, battery: true };
      q.reset(new Vector3(0, 100, 0));
      q.battery.usedAh = usedAh;
      for (let i = 0; i < 300; i++) {
        q.step(DT, [1, 1, 1, 1], []);
        q.velocity.set(0, 0, 0);
        q.omega.set(0, 0, 0);
      }
      return q.motorThrust.reduce((a, b) => a + b, 0);
    };
    const fresh = thrustAt(0);
    const drained = thrustAt(1.15);
    expect(drained).toBeLessThan(fresh * 0.85);
  });
});

describe('prop wash', () => {
  const washWhile = (vel: Vector3, on: boolean) => {
    const q = new Quad(FREESTYLE_5IN);
    q.realism = { ...ALL_OFF, propWash: on };
    q.reset(new Vector3(0, 200, 0));
    let maxWash = 0;
    let thrust = 0;
    for (let i = 0; i < 400; i++) {
      q.velocity.copy(vel);
      q.omega.set(0, 0, 0);
      q.orientation.identity();
      q.step(DT, [0.55, 0.55, 0.55, 0.55], []);
      if (i > 200) {
        maxWash = Math.max(maxWash, q.propWash);
        thrust += q.motorThrust.reduce((a, b) => a + b, 0);
      }
    }
    return { maxWash, thrust };
  };

  it('costs thrust when dropping straight into the wake', () => {
    const off = washWhile(new Vector3(0, -12, 0), false);
    const on = washWhile(new Vector3(0, -12, 0), true);
    expect(on.maxWash).toBeGreaterThan(0.5);
    expect(on.thrust).toBeLessThan(off.thrust * 0.9);
  });

  it('mostly goes away with forward speed', () => {
    expect(washWhile(new Vector3(0, -12, -15), true).maxWash).toBeLessThan(0.1);
  });

  it('is absent when climbing', () => {
    expect(washWhile(new Vector3(0, 5, 0), true).maxWash).toBe(0);
  });
});

describe('prop damage', () => {
  const drop = (speed: number, height = 0.3) => {
    const q = new Quad(FREESTYLE_5IN);
    q.realism = { ...ALL_OFF, damage: true };
    q.reset(new Vector3(0, height, 0));
    // Rolled 35° so a motor arm hits first.
    q.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
    q.velocity.set(0, -speed, 0);
    const ground = [new GroundCollider(0)];
    for (let i = 0; i < 400; i++) q.step(DT, [0, 0, 0, 0], ground);
    return q.propHealth;
  };

  it('a gentle touchdown does no damage', () => {
    // Starts just above the ground so it lands at about 2 m/s.
    expect(drop(1.5, 0.1).every((h) => h === 1)).toBe(true);
  });

  it('a hard hit damages the props that hit', () => {
    const h = drop(12);
    expect(Math.min(...h)).toBeLessThan(0.6);
    expect(h.every((x) => x >= 0 && x <= 1)).toBe(true);
  });
});

describe('turtle mode', () => {
  const flip = (sticks: { roll: number; pitch: number }) => {
    const q = new Quad(FREESTYLE_5IN);
    q.reset(new Vector3(0, 0.06, 0));
    q.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI); // upside down
    q.turtle = true;
    const fc = new FlightController(structuredClone(DEFAULT_RATES), structuredClone(DEFAULT_PIDS), DT);
    const ground = [new GroundCollider(0)];
    let rollDeg = 0;
    let pitchDeg = 0;
    for (let i = 0; i < 1500; i++) {
      const up = new Vector3(0, 1, 0).applyQuaternion(q.orientation);
      // Like a pilot: let go of the stick once it is nearly upright.
      const out = up.y < 0.75 ? fc.turtleMix({ ...sticks, yaw: 0, throttle: 0 }, q.orientation) : [0, 0, 0, 0];
      q.step(DT, out, ground);
      const g = q.gyroDegPerSec();
      rollDeg += g.roll * DT;
      pitchDeg += g.pitch * DT;
    }
    const up = new Vector3(0, 1, 0).applyQuaternion(q.orientation);
    return { upY: up.y, rollDeg, pitchDeg };
  };

  it('roll right flips the quad over to the right', () => {
    const r = flip({ roll: 1, pitch: 0 });
    expect(r.upY).toBeGreaterThan(0.8);
    expect(r.rollDeg).toBeGreaterThan(100);
  });

  it('roll left flips it to the left', () => {
    const r = flip({ roll: -1, pitch: 0 });
    expect(r.upY).toBeGreaterThan(0.8);
    expect(r.rollDeg).toBeLessThan(-100);
  });

  it('pitch forward flips it over the nose', () => {
    const r = flip({ roll: 0, pitch: 1 });
    expect(r.upY).toBeGreaterThan(0.8);
    expect(r.pitchDeg).toBeGreaterThan(100);
  });

  it('does nothing with centred sticks', () => {
    expect(flip({ roll: 0, pitch: 0 }).upY).toBeLessThan(-0.9);
  });
});

void Quaternion;
