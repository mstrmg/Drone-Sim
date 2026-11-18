import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Quad } from '../src/sim/quad';
import { FREESTYLE_5IN } from '../src/sim/params';
import { GroundCollider } from '../src/sim/colliders';
import { FlightController, DEFAULT_PIDS, type Sticks } from '../src/fc/flightController';
import { DEFAULT_RATES } from '../src/fc/rates';

const DT = 1 / 1000;

function makeSim(height = 50) {
  const quad = new Quad(FREESTYLE_5IN);
  quad.reset(new Vector3(0, height, 0));
  const fc = new FlightController(structuredClone(DEFAULT_RATES), structuredClone(DEFAULT_PIDS), DT);
  return { quad, fc };
}

function run(sim: ReturnType<typeof makeSim>, seconds: number, sticks: Sticks | ((t: number) => Sticks), onStep?: (t: number) => void, colliders = [] as GroundCollider[]) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const s = typeof sticks === 'function' ? sticks(t) : sticks;
    const out = sim.fc.update(s, sim.quad.gyroDegPerSec(), sim.quad.orientation);
    sim.quad.step(DT, out, colliders);
    onStep?.(t);
  }
}

describe('quad physics', () => {
  it('free falls under gravity when disarmed', () => {
    const quad = new Quad(FREESTYLE_5IN);
    quad.reset(new Vector3(0, 100, 0));
    for (let i = 0; i < 500; i++) quad.step(DT, null, []);
    expect(quad.velocity.y).toBeLessThan(-4.5);
    expect(quad.velocity.y).toBeGreaterThan(-4.95);
  });

  it('hovers at a realistic throttle and stays level', () => {
    // Find hover throttle by bisection.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      const sim = makeSim();
      run(sim, 2, { roll: 0, pitch: 0, yaw: 0, throttle: mid });
      if (sim.quad.velocity.y > 0) hi = mid;
      else lo = mid;
    }
    console.log('hover throttle', lo.toFixed(3));
    expect(lo).toBeGreaterThan(0.18);
    expect(lo).toBeLessThan(0.4);
  });

  it('has a realistic thrust-to-weight ratio', () => {
    const p = FREESTYLE_5IN;
    const tw = (4 * p.maxThrust) / (p.mass * 9.81);
    expect(tw).toBeGreaterThan(7);
    expect(tw).toBeLessThan(12);
  });

  it('tracks a roll rate step quickly and without large overshoot', () => {
    const sim = makeSim();
    let peak = 0;
    let t90 = -1;
    const rates: number[] = [];
    run(sim, 0.4, (t) => ({ roll: t > 0.05 ? 0.5 : 0, pitch: 0, yaw: 0, throttle: 0.35 }), (t) => {
      const r = sim.quad.gyroDegPerSec().roll;
      rates.push(r);
      peak = Math.max(peak, r);
      if (t > 0.05 && t90 < 0 && r > 0.9 * sim.fc.setpoint.roll) t90 = t - 0.05;
    });
    const target = sim.fc.setpoint.roll;
    const final = rates[rates.length - 1];
    console.log('roll step target', target.toFixed(0), 'final', final.toFixed(0), 'peak', peak.toFixed(0), 't90 ms', (t90 * 1000).toFixed(0));
    expect(t90).toBeGreaterThan(0);
    expect(t90).toBeLessThan(0.08);
    expect(peak).toBeLessThan(target * 1.15);
    expect(Math.abs(final - target)).toBeLessThan(target * 0.05);
  });

  it('tracks yaw rate', () => {
    const sim = makeSim();
    run(sim, 0.6, { roll: 0, pitch: 0, yaw: 0.5, throttle: 0.35 });
    const g = sim.quad.gyroDegPerSec();
    console.log('yaw target', sim.fc.setpoint.yaw.toFixed(0), 'actual', g.yaw.toFixed(0));
    expect(Math.abs(g.yaw - sim.fc.setpoint.yaw)).toBeLessThan(sim.fc.setpoint.yaw * 0.1);
  });

  it('does a full-stick flip and returns to level with sticks centered', () => {
    const sim = makeSim();
    run(sim, 1.2, (t) => ({ roll: t < 0.4 ? 1 : 0, pitch: 0, yaw: 0, throttle: t < 0.4 ? 0.1 : 0.35 }));
    const g = sim.quad.gyroDegPerSec();
    expect(Math.abs(g.roll)).toBeLessThan(10);
    expect(Math.abs(g.pitch)).toBeLessThan(10);
  });

  it('reaches a plausible forward speed at full tilt', () => {
    const sim = makeSim(500);
    sim.fc.mode = 'angle';
    run(sim, 8, { roll: 0, pitch: 1, yaw: 0, throttle: 0.8 });
    const v = sim.quad.velocity;
    const horiz = Math.hypot(v.x, v.z) * 3.6;
    console.log('horizontal km/h', horiz.toFixed(0), 'vertical m/s', v.y.toFixed(1));
    expect(horiz).toBeGreaterThan(80);
    expect(horiz).toBeLessThan(200);
  });

  it('rests on the ground without jitter when disarmed', () => {
    const quad = new Quad(FREESTYLE_5IN);
    quad.reset(new Vector3(0, 0.2, 0));
    const ground = [new GroundCollider(0)];
    for (let i = 0; i < 3000; i++) quad.step(DT, null, ground);
    expect(quad.velocity.length()).toBeLessThan(0.05);
    expect(quad.position.y).toBeGreaterThan(0.02);
    expect(quad.position.y).toBeLessThan(0.05);
  });

  it('idles on the ground armed at zero throttle without flipping', () => {
    const sim = makeSim(0.04);
    const ground = [new GroundCollider(0)];
    run(sim, 2, { roll: 0, pitch: 0, yaw: 0, throttle: 0 }, undefined, ground);
    const up = new Vector3(0, 1, 0).applyQuaternion(sim.quad.orientation);
    expect(up.y).toBeGreaterThan(0.99);
    expect(sim.quad.position.y).toBeLessThan(0.1);
  });
});
