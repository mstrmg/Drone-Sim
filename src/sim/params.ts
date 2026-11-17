/**
 * Physical parameters for a typical 5" freestyle quad:
 * 2207 1750KV motors on 6S, 5.1x4.3x3 props, ~650 g all-up weight with battery.
 *
 * Body frame (same as three.js): +x right, +y up, +z back (the nose points at -z).
 */
export interface QuadParams {
  /** All-up mass in kg. */
  mass: number;
  /** Principal moments of inertia in kg·m² about body x (pitch), y (yaw), z (roll). */
  inertia: { x: number; y: number; z: number };
  /** Motor offsets from the center of mass, in metres (X frame, so |x| = |z|). */
  motorOffset: { x: number; z: number };
  /** Height of the prop plane above the center of mass, in metres. */
  propHeight: number;
  /** Static thrust of one motor at full throttle, in newtons. */
  maxThrust: number;
  /** Effective pitch speed of the prop at full RPM (m/s). Thrust drops to 0 when inflow reaches it. */
  pitchSpeed: number;
  /** Motor first-order time constants in seconds. */
  motorTauUp: number;
  motorTauDown: number;
  /** ESC idle (DShot idle value, 0..1). */
  motorIdle: number;
  /** Rotor speed at full throttle (rad/s). */
  omegaMax: number;
  /** Inertia of one rotor (bell + prop) in kg·m². */
  rotorInertia: number;
  /** Prop drag torque per newton of thrust (m). */
  torqueRatio: number;
  /** Quadratic body drag Cd·A per body axis (m²). */
  dragArea: { x: number; y: number; z: number };
  /** Rotor in-plane (H-force) drag coefficient per motor at full speed, N per m/s. */
  rotorDrag: number;
  /** Linear angular damping (N·m per rad/s). */
  angularDamping: number;
}

export const FREESTYLE_5IN: QuadParams = {
  mass: 0.65,
  inertia: { x: 0.0025, y: 0.0042, z: 0.0021 },
  motorOffset: { x: 0.08, z: 0.08 },
  propHeight: 0.02,
  maxThrust: 15,
  pitchSpeed: 60,
  motorTauUp: 0.022,
  motorTauDown: 0.03,
  motorIdle: 0.055,
  omegaMax: 2800,
  rotorInertia: 4.5e-6,
  torqueRatio: 0.014,
  dragArea: { x: 0.012, y: 0.03, z: 0.011 },
  rotorDrag: 0.06,
  angularDamping: 3e-4,
};

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;

/** Throttle (0..1, before the ESC idle offset) at which the quad hovers in still air. */
export function hoverThrottle(p: QuadParams): number {
  const w = Math.sqrt((p.mass * GRAVITY) / (4 * p.maxThrust));
  return (w - p.motorIdle) / (1 - p.motorIdle);
}
