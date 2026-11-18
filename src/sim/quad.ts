import { Quaternion, Vector3 } from 'three';
import type { Collider } from './colliders';
import { Battery } from './battery';
import { AIR_DENSITY, GRAVITY, type QuadParams } from './params';

/**
 * Motor order (Betaflight Quad-X numbering):
 *   0 = rear right (CW), 1 = front right (CCW), 2 = rear left (CCW), 3 = front left (CW)
 * Spin is +1 for counter-clockwise seen from above (rotor angular momentum along +y).
 * This is Betaflight's default "props in" layout.
 */
export const MOTOR_LAYOUT: ReadonlyArray<{ x: number; z: number; spin: number }> = [
  { x: 1, z: 1, spin: -1 },
  { x: 1, z: -1, spin: 1 },
  { x: -1, z: 1, spin: 1 },
  { x: -1, z: -1, spin: -1 },
];

/** Collision spheres in body coordinates: motors, the stack, the battery and the camera. */
const COLLISION_SPHERES: ReadonlyArray<{ o: Vector3; r: number }> = [
  { o: new Vector3(0.08, 0.005, 0.08), r: 0.035 },
  { o: new Vector3(0.08, 0.005, -0.08), r: 0.035 },
  { o: new Vector3(-0.08, 0.005, 0.08), r: 0.035 },
  { o: new Vector3(-0.08, 0.005, -0.08), r: 0.035 },
  { o: new Vector3(0, 0.0, 0), r: 0.035 },
  { o: new Vector3(0, 0.035, 0.0), r: 0.035 },
  { o: new Vector3(0, 0.01, -0.05), r: 0.025 },
];

/** Radius around the center of mass that contains every collision sphere. */
const QUAD_BOUND = 0.16;

export interface StepResult {
  /** Largest normal impact speed (m/s) of any contact this step. 0 if none. */
  impactSpeed: number;
  /** True if any part of the quad touched something this step. */
  touching: boolean;
}

/** Optional realism effects. All off by default so the core physics can be tested on its own. */
export interface Realism {
  /** Thrust loss and wobble when descending into the props' own wake. */
  propWash: boolean;
  /** Pack voltage sags under load and drains, which limits motor speed. */
  battery: boolean;
  /** Hard hits damage props: less thrust, vibration, and broken props that make no thrust. */
  damage: boolean;
}

/** Prop disc area of a 5.1" prop (m²). */
const PROP_AREA = Math.PI * 0.0648 * 0.0648;
/** Electrical efficiency from battery to prop shaft, and the draw of the flight electronics (W). */
const DRIVE_EFFICIENCY = 0.55;
const AVIONICS_W = 18;
/** Below this health a prop counts as broken and makes no thrust. */
export const PROP_BROKEN = 0.15;

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();

/** 6-DOF rigid body quadcopter with four lagged motors. */
export class Quad {
  readonly position = new Vector3();
  /** World-frame linear velocity (m/s). */
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  /** Body-frame angular velocity (rad/s). */
  readonly omega = new Vector3();
  /** Normalized rotor speed 0..1 per motor. */
  readonly motorSpeed = [0, 0, 0, 0];
  /** Last computed thrust per motor (N), for display and tests. */
  readonly motorThrust = [0, 0, 0, 0];
  /** Prop condition per motor: 1 = new, below PROP_BROKEN = broken. */
  readonly propHealth = [1, 1, 1, 1];
  readonly battery = new Battery();
  realism: Realism = { propWash: false, battery: false, damage: false };
  /** Turtle mode (flip over after a crash): motor commands 0..1 spin the props in reverse, with no idle. */
  turtle = false;
  /** Strongest prop wash felt last step, 0..1. */
  propWash = 0;
  private time = 0;
  private noiseSeed = 1;
  private readonly motorPos: Vector3[];

  constructor(public params: QuadParams) {
    const { x, z } = params.motorOffset;
    this.motorPos = MOTOR_LAYOUT.map((m) => new Vector3(m.x * x, params.propHeight, m.z * z));
  }

  reset(position: Vector3, yaw = 0): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.orientation.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    this.omega.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      this.motorSpeed[i] = 0;
      this.motorThrust[i] = 0;
      this.propHealth[i] = 1;
    }
    this.battery.reset();
    this.propWash = 0;
    this.time = 0;
  }

  /** True when every prop is broken, so the quad cannot fly any more. */
  get allPropsBroken(): boolean {
    return this.propHealth.every((h) => h < PROP_BROKEN);
  }

  private noise(): number {
    this.noiseSeed = (this.noiseSeed * 16807) % 2147483647;
    return (this.noiseSeed / 2147483647) * 2 - 1;
  }

  /**
   * Advance the simulation by dt seconds.
   * @param motorCmd per-motor throttle command 0..1 from the flight controller (after the mixer), or null when disarmed.
   */
  step(dt: number, motorCmd: readonly number[] | null, colliders: readonly Collider[]): StepResult {
    const p = this.params;
    const qInv = tmpQ.copy(this.orientation).invert();
    // Air velocity relative to the body, in body coordinates (still air).
    const vBody = tmpV.copy(this.velocity).applyQuaternion(qInv);
    const w = this.omega;

    const force = new Vector3();
    const torque = new Vector3();
    let rotorMomentum = 0; // along body +y
    const kD = p.rotorDrag;

    const R = this.realism;
    this.time += dt;
    // Motor speed is proportional to ESC duty × pack voltage, so sag limits the top end.
    const vScale = R.battery ? Math.min(1, this.battery.voltage / this.battery.fullVoltage) : 1;
    let shaftPower = 0;
    this.propWash = 0;

    for (let i = 0; i < 4; i++) {
      // --- Motor dynamics: first-order lag toward the ESC target speed. Turtle mode spins backwards with no idle.
      const c = motorCmd ? clamp01(motorCmd[i]) : 0;
      let target = 0;
      if (motorCmd) target = this.turtle ? -c : p.motorIdle + (1 - p.motorIdle) * c;
      target *= vScale;
      const prev = this.motorSpeed[i];
      const tau = Math.abs(target) > Math.abs(prev) ? p.motorTauUp : p.motorTauDown;
      const s = prev + (target - prev) * (1 - Math.exp(-dt / tau));
      this.motorSpeed[i] = s;
      const spin = MOTOR_LAYOUT[i].spin;

      // --- Local air velocity at the prop (includes rotation, which gives natural aero damping).
      const r = this.motorPos[i];
      const vLocal = tmpV2.copy(w).cross(r).add(vBody);

      let thrust: number;
      if (s >= 0) {
        // --- Thrust with axial inflow: T = Tmax (s² - s·v/Vp). Climbing reduces thrust, descending raises it.
        thrust = p.maxThrust * (s * s - (s * vLocal.y) / p.pitchSpeed);
        thrust = Math.max(0, Math.min(thrust, 1.3 * p.maxThrust * s * s));
      } else {
        // A prop spinning backwards is far less efficient.
        thrust = -0.55 * p.maxThrust * s * s;
      }

      if (R.damage) {
        const h = this.propHealth[i];
        thrust *= h < PROP_BROKEN ? 0 : 0.3 + 0.7 * h;
        // An unbalanced prop shakes the frame at high RPM.
        const shake = (1 - h) * s * s * (h < PROP_BROKEN ? 0.3 : 1) * 0.012;
        if (shake > 0) {
          torque.x += this.noise() * shake;
          torque.z += this.noise() * shake;
        }
      }

      if (R.propWash && thrust > 0.05) {
        // Descending into the wake: the inflow ratio against the induced velocity sets the strength (vortex ring
        // state peaks a little below 1), and sideways speed carries the prop out of its own wake.
        const vi = Math.sqrt(thrust / (2 * AIR_DENSITY * PROP_AREA));
        const x = -vLocal.y / vi;
        const bump = smoothstep(0.25, 0.8, x) * (1 - smoothstep(1.6, 2.4, x));
        if (bump > 0) {
          const lateral = Math.hypot(vLocal.x, vLocal.z) / 3;
          const wash = bump / (1 + lateral * lateral);
          const t = this.time;
          const n = 0.6 * Math.sin(2 * Math.PI * 7.3 * t + i * 1.9) + 0.4 * Math.sin(2 * Math.PI * 13.1 * t + i * 4.3);
          thrust *= 1 - wash * (0.22 + 0.18 * n);
          this.propWash = Math.max(this.propWash, wash);
        }
      }
      this.motorThrust[i] = thrust;

      const sa = Math.abs(s);
      const f = new Vector3(-kD * sa * vLocal.x, thrust, -kD * sa * vLocal.z);
      force.add(f);
      torque.add(new Vector3().copy(r).cross(f));

      // --- Yaw: prop drag reaction plus rotor spin-up reaction. Reversed props reverse the drag torque.
      const accel = ((s - prev) / dt) * p.omegaMax;
      const drag = p.torqueRatio * Math.abs(thrust) * Math.sign(s);
      torque.y += -spin * (drag + p.rotorInertia * accel);
      rotorMomentum += spin * p.rotorInertia * s * p.omegaMax;
      shaftPower += p.torqueRatio * Math.abs(thrust) * sa * p.omegaMax;
    }
    if (R.battery) this.battery.step(shaftPower / DRIVE_EFFICIENCY + AVIONICS_W, dt);

    // --- Body drag (quadratic, per body axis).
    const half = 0.5 * AIR_DENSITY;
    force.x -= half * p.dragArea.x * Math.abs(vBody.x) * vBody.x;
    force.y -= half * p.dragArea.y * Math.abs(vBody.y) * vBody.y;
    force.z -= half * p.dragArea.z * Math.abs(vBody.z) * vBody.z;

    // --- Gyroscopic torque from the spinning rotors and light rotational damping.
    const H = new Vector3(0, rotorMomentum, 0);
    torque.sub(new Vector3().copy(w).cross(H));
    torque.addScaledVector(w, -p.angularDamping);

    // --- Linear integration (semi-implicit Euler).
    const accel = force.applyQuaternion(this.orientation).divideScalar(p.mass);
    accel.y -= GRAVITY;
    this.velocity.addScaledVector(accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // --- Angular integration: I·ω̇ = τ − ω × (I·ω)
    const I = p.inertia;
    const Iw = new Vector3(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyro = new Vector3().copy(w).cross(Iw);
    torque.sub(gyro);
    w.x += (torque.x / I.x) * dt;
    w.y += (torque.y / I.y) * dt;
    w.z += (torque.z / I.z) * dt;
    integrateOrientation(this.orientation, w, dt);

    return this.collide(colliders);
  }

  /** World-space inverse inertia applied to a world vector. */
  private applyInvInertiaWorld(v: Vector3): Vector3 {
    const I = this.params.inertia;
    const b = v.clone().applyQuaternion(tmpQ.copy(this.orientation).invert());
    b.set(b.x / I.x, b.y / I.y, b.z / I.z);
    return b.applyQuaternion(this.orientation);
  }

  private collide(colliders: readonly Collider[]): StepResult {
    const result: StepResult = { impactSpeed: 0, touching: false };
    const m = this.params.mass;
    // Broad phase: only shapes whose bounding sphere reaches the quad's (all collision spheres fit within 0.15 m).
    const near: Collider[] = [];
    for (const c of colliders) {
      if (c.boundRadius === Infinity || this.position.distanceTo(c.boundCenter) < c.boundRadius + QUAD_BOUND) near.push(c);
    }
    for (let k = 0; k < COLLISION_SPHERES.length; k++) {
      const sphere = COLLISION_SPHERES[k];
      const r = sphere.o.clone().applyQuaternion(this.orientation);
      const p = new Vector3();
      for (const c of near) {
        p.copy(r).add(this.position);
        if (c.boundRadius !== Infinity && p.distanceTo(c.boundCenter) > c.boundRadius + sphere.r) continue;
        const hit = c.test(p, sphere.r);
        if (!hit) continue;
        result.touching = true;
        const n = hit.normal;
        // Positional correction.
        this.position.addScaledVector(n, hit.depth);

        const wWorld = this.omega.clone().applyQuaternion(this.orientation);
        const vc = wWorld.clone().cross(r).add(this.velocity);
        const vn = vc.dot(n);
        if (vn >= 0) continue;
        result.impactSpeed = Math.max(result.impactSpeed, -vn);
        if (this.realism.damage) this.damageProps(k, -vn);

        const restitution = vn < -1.5 ? 0.25 : 0;
        const rn = r.clone().cross(n);
        const kN = 1 / m + n.dot(this.applyInvInertiaWorld(rn).cross(r));
        const jn = (-(1 + restitution) * vn) / kN;
        const impulse = n.clone().multiplyScalar(jn);

        // Coulomb friction.
        const vt = vc.clone().addScaledVector(n, -vn);
        const vtLen = vt.length();
        if (vtLen > 1e-6) {
          const t = vt.divideScalar(vtLen);
          const rt = r.clone().cross(t);
          const kT = 1 / m + t.dot(this.applyInvInertiaWorld(rt).cross(r));
          const jt = Math.min(vtLen / kT, 0.6 * jn);
          impulse.addScaledVector(t, -jt);
        }

        this.velocity.addScaledVector(impulse, 1 / m);
        const dW = this.applyInvInertiaWorld(r.clone().cross(impulse));
        wWorld.add(dW);
        this.omega.copy(wWorld.applyQuaternion(tmpQ.copy(this.orientation).invert()));
      }
    }
    return result;
  }

  /**
   * Prop damage from a hit on collision sphere k (0–3 are the motors, in motor order). Spinning props break far
   * more easily; body hits only hurt the props when they are hard.
   */
  private damageProps(k: number, speed: number): void {
    if (k < 4) {
      const spinning = 0.3 + 0.7 * Math.min(1, Math.abs(this.motorSpeed[k]) / 0.3);
      this.propHealth[k] = Math.max(0, this.propHealth[k] - (Math.max(0, speed - 3.5) / 8) * spinning);
    } else if (speed > 6) {
      for (let i = 0; i < 4; i++) this.propHealth[i] = Math.max(0, this.propHealth[i] - (speed - 6) / 25);
    }
  }

  /** Body-frame rates in Betaflight convention (deg/s): roll right, pitch nose-down, yaw right are positive. */
  gyroDegPerSec(): { roll: number; pitch: number; yaw: number } {
    const k = 180 / Math.PI;
    return { roll: -this.omega.z * k, pitch: -this.omega.x * k, yaw: -this.omega.y * k };
  }
}

export function integrateOrientation(q: Quaternion, wBody: Vector3, dt: number): void {
  const angle = wBody.length() * dt;
  if (angle < 1e-12) return;
  const axis = wBody.clone().normalize();
  q.multiply(new Quaternion().setFromAxisAngle(axis, angle)).normalize();
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
