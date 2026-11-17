import { Quaternion, Vector3 } from 'three';
import { Pt1 } from './filters';
import { betaflightRate, type Rates } from './rates';
import { MOTOR_LAYOUT } from '../sim/quad';

export type FlightMode = 'acro' | 'angle';

export interface Sticks {
  /** -1..1, positive = roll right */
  roll: number;
  /** -1..1, positive = stick forward (nose down) */
  pitch: number;
  /** -1..1, positive = yaw right */
  yaw: number;
  /** 0..1 */
  throttle: number;
}

export interface AxisPid {
  p: number;
  i: number;
  d: number;
  ff: number;
}

export interface PidProfile {
  roll: AxisPid;
  pitch: AxisPid;
  yaw: AxisPid;
}

/** Betaflight 4.x-like defaults, tuned for the simulated 5" quad. */
export const DEFAULT_PIDS: PidProfile = {
  roll: { p: 45, i: 80, d: 30, ff: 120 },
  pitch: { p: 47, i: 84, d: 34, ff: 125 },
  yaw: { p: 45, i: 80, d: 0, ff: 120 },
};

// Betaflight's internal scale factors, so the gains above read like real ones.
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FF_SCALE = 0.013754 / 100;
const MIXER_SCALE = 1 / 1000;
const ITERM_LIMIT = 400;
const AIRMODE_START_THROTTLE = 0.25;
const ANGLE_LIMIT_DEG = 55;
const ANGLE_STRENGTH = 8; // deg/s of correction per degree of error
const AXES = ['roll', 'pitch', 'yaw'] as const;
type Axis = (typeof AXES)[number];

/** Rate-mode PID loop + Quad-X mixer with airmode, modelled on Betaflight. */
export class FlightController {
  rates: Rates;
  pids: PidProfile;
  mode: FlightMode = 'acro';
  /** Last setpoints in deg/s, for display. */
  readonly setpoint = { roll: 0, pitch: 0, yaw: 0 };
  readonly motorOut = [0, 0, 0, 0];

  private readonly iterm = { roll: 0, pitch: 0, yaw: 0 };
  private readonly prevGyro = { roll: 0, pitch: 0, yaw: 0 };
  private readonly prevSetpoint = { roll: 0, pitch: 0, yaw: 0 };
  private readonly dFilter: Record<Axis, Pt1>;
  private readonly ffFilter: Record<Axis, Pt1>;
  private readonly spLowpass: Record<Axis, Pt1>;
  private airmodeActive = false;

  constructor(
    rates: Rates,
    pids: PidProfile,
    private readonly dt: number,
  ) {
    this.rates = rates;
    this.pids = pids;
    const mk = (hz: number) => ({ roll: new Pt1(hz, dt), pitch: new Pt1(hz, dt), yaw: new Pt1(hz, dt) });
    this.dFilter = mk(110);
    this.ffFilter = mk(40);
    this.spLowpass = mk(15);
  }

  reset(): void {
    for (const a of AXES) {
      this.iterm[a] = 0;
      this.prevGyro[a] = 0;
      this.prevSetpoint[a] = 0;
      this.dFilter[a].reset();
      this.ffFilter[a].reset();
      this.spLowpass[a].reset();
      this.setpoint[a] = 0;
    }
    this.airmodeActive = false;
    this.motorOut.fill(0);
  }

  get isAirmodeActive(): boolean {
    return this.airmodeActive;
  }

  /**
   * Runs one PID loop iteration.
   * @param gyro body rates in deg/s (Betaflight sign convention)
   * @param attitude current orientation, used by angle mode
   * @returns motor commands 0..1
   */
  update(sticks: Sticks, gyro: Record<Axis, number>, attitude: Quaternion): number[] {
    const dt = this.dt;
    const sp = this.setpoint;
    sp.roll = betaflightRate(sticks.roll, this.rates.roll);
    sp.pitch = betaflightRate(sticks.pitch, this.rates.pitch);
    sp.yaw = betaflightRate(sticks.yaw, this.rates.yaw);
    if (this.mode === 'angle') this.applyAngleMode(sticks, attitude);

    if (sticks.throttle > AIRMODE_START_THROTTLE) this.airmodeActive = true;
    // Before airmode kicks in (sitting on the ground), keep the I-term from winding up.
    const holdIterm = !this.airmodeActive && sticks.throttle < 0.05;

    const pidSum = { roll: 0, pitch: 0, yaw: 0 };
    for (const a of AXES) {
      const g = this.pids[a];
      const err = sp[a] - gyro[a];

      const p = g.p * PTERM_SCALE * err;

      // I-term relax: pause accumulation while the setpoint is moving fast (prevents bounce-back after flips).
      const spHp = Math.abs(sp[a] - this.spLowpass[a].apply(sp[a]));
      const relax = a === 'yaw' ? 1 : Math.max(0, 1 - spHp / 40);
      if (holdIterm) this.iterm[a] = 0;
      else {
        this.iterm[a] += g.i * ITERM_SCALE * err * dt * relax;
        this.iterm[a] = Math.max(-ITERM_LIMIT, Math.min(ITERM_LIMIT, this.iterm[a]));
      }

      // D on measurement, low-pass filtered.
      const dGyro = this.dFilter[a].apply((gyro[a] - this.prevGyro[a]) / dt);
      this.prevGyro[a] = gyro[a];
      const d = -g.d * DTERM_SCALE * dGyro;

      // Feedforward from setpoint rate of change.
      const dSp = this.ffFilter[a].apply((sp[a] - this.prevSetpoint[a]) / dt);
      this.prevSetpoint[a] = sp[a];
      const ff = g.ff * FF_SCALE * dSp;

      pidSum[a] = p + this.iterm[a] + d + ff;
    }
    // Yaw authority is limited in Betaflight (pidsum_limit_yaw = 400).
    pidSum.yaw = Math.max(-400, Math.min(400, pidSum.yaw));
    pidSum.roll = Math.max(-500, Math.min(500, pidSum.roll));
    pidSum.pitch = Math.max(-500, Math.min(500, pidSum.pitch));

    return this.mix(sticks.throttle, pidSum);
  }

  private mix(throttleIn: number, pid: Record<Axis, number>): number[] {
    const mix = [0, 0, 0, 0];
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < 4; i++) {
      const m = MOTOR_LAYOUT[i];
      // Roll right: right side (x>0) down. Pitch nose-down: front (z<0) down. Yaw right: CCW props faster.
      mix[i] = (-m.x * pid.roll + m.z * pid.pitch + m.spin * pid.yaw) * MIXER_SCALE;
      mn = Math.min(mn, mix[i]);
      mx = Math.max(mx, mix[i]);
    }
    const range = mx - mn;
    if (range > 1) {
      for (let i = 0; i < 4; i++) mix[i] /= range;
      mn /= range;
      mx /= range;
    }
    let throttle = throttleIn;
    if (this.airmodeActive) {
      // Airmode: shift throttle so the full correction always fits in 0..1.
      throttle = Math.max(-mn, Math.min(1 - mx, throttle));
    }
    for (let i = 0; i < 4; i++) {
      this.motorOut[i] = Math.max(0, Math.min(1, throttle + mix[i]));
    }
    return this.motorOut;
  }

  /** Angle (self-level) mode: sticks command a tilt angle; yaw stays a rate. */
  private applyAngleMode(sticks: Sticks, q: Quaternion): void {
    const up = new Vector3(0, 1, 0);
    const curUp = up.clone().applyQuaternion(q);
    // Heading frame from the body forward vector projected on the ground.
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1).applyQuaternion(q).projectOnPlane(up);
    const heading = Math.atan2(-fwd.x, -fwd.z);
    const lim = (ANGLE_LIMIT_DEG * Math.PI) / 180;
    const qHeading = new Quaternion().setFromAxisAngle(up, heading);
    const qPitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -sticks.pitch * lim);
    const qRoll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -sticks.roll * lim);
    const desiredUp = up.clone().applyQuaternion(qHeading.multiply(qPitch).multiply(qRoll));
    const errWorld = curUp.clone().cross(desiredUp);
    const angle = Math.atan2(errWorld.length(), curUp.dot(desiredUp));
    // Upside down with no defined axis: pick the roll axis.
    if (errWorld.lengthSq() < 1e-10) errWorld.set(0, 0, -1).applyQuaternion(q);
    const errBody = errWorld.applyQuaternion(q.clone().invert());
    errBody.normalize().multiplyScalar((angle * 180) / Math.PI);
    // errBody is a rotation (deg) in body axes; convert to Betaflight roll/pitch.
    this.setpoint.roll = Math.max(-600, Math.min(600, -errBody.z * ANGLE_STRENGTH));
    this.setpoint.pitch = Math.max(-600, Math.min(600, -errBody.x * ANGLE_STRENGTH));
  }
}
