/** How one stick channel is read from a gamepad axis. Raw values are the Gamepad API's -1..1. */
export interface AxisMap {
  axis: number;
  invert: boolean;
  min: number;
  center: number;
  max: number;
}

/** A button press, or a switch position on an axis (e.g. a radio's arm switch on CH5). */
export type Binding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; threshold: number; above: boolean };

export interface ControllerProfile {
  /** Which preset this profile was based on (for display). */
  preset: PresetId;
  throttle: AxisMap;
  yaw: AxisMap;
  pitch: AxisMap;
  roll: AxisMap;
  /** Deadzone for roll / pitch / yaw, 0..0.3. */
  deadzone: number;
  /** How the throttle stick's travel maps to 0..100% stick. See ThrottleMode. */
  throttleMode: ThrottleMode;
  /** Throttle output at 50% stick, 0.1..0.9. 0.5 is linear. */
  throttleMid: number;
  /** Throttle expo around the mid point, 0..1. Flattens the curve near the middle for finer hover control. */
  throttleExpo: number;
  arm: Binding | null;
  reset: Binding | null;
  mode: Binding | null;
  camera: Binding | null;
  /** Turtle mode (flip over after a crash): a button toggles it, a switch holds it. */
  turtle: Binding | null;
}

export type PresetId = 'ps5' | 'radio' | 'generic';

/**
 * - `center-zero`: spring-loaded gamepad stick. Resting in the middle is 0%, pushing up goes to 100%,
 *   pulling down stays at 0%. Letting go cuts the throttle, like dropping the throttle on a radio.
 * - `center-half`: spring-loaded gamepad stick. Resting in the middle is 50%, up is 100%, down is 0%.
 * - `full`: radio throttle without a spring. The full calibrated travel is 0..100%.
 */
export type ThrottleMode = 'center-zero' | 'center-half' | 'full';
export const THROTTLE_MODES: ThrottleMode[] = ['center-zero', 'center-half', 'full'];

const axis = (index: number, invert = false): AxisMap => ({ axis: index, invert, min: -1, center: 0, max: 1 });

export const PRESETS: Record<PresetId, { label: string; make: () => ControllerProfile }> = {
  ps5: {
    label: 'PS5 DualSense (Mode 2)',
    // Standard mapping: 0 LX, 1 LY, 2 RX, 3 RY. Stick up reads -1, so Y axes are inverted.
    // The left stick springs back to center, which reads as 50% throttle.
    make: () => ({
      preset: 'ps5',
      throttle: axis(1, true),
      yaw: axis(0),
      pitch: axis(3, true),
      roll: axis(2),
      deadzone: 0.05,
      throttleMode: 'center-zero',
      throttleMid: 0.5,
      throttleExpo: 0,
      arm: { kind: 'button', index: 5 }, // R1
      reset: { kind: 'button', index: 0 }, // Cross
      mode: { kind: 'button', index: 3 }, // Triangle
      camera: { kind: 'button', index: 2 }, // Square
      turtle: { kind: 'button', index: 1 }, // Circle
    }),
  },
  radio: {
    label: 'Radio (EdgeTX USB Joystick, AETR)',
    // EdgeTX joystick mode sends CH1..CH4 (Ail, Ele, Thr, Rud) as the first four axes, CH5 as the fifth.
    make: () => ({
      preset: 'radio',
      throttle: axis(2),
      yaw: axis(3),
      pitch: axis(1),
      roll: axis(0),
      deadzone: 0.0,
      throttleMode: 'full',
      throttleMid: 0.5,
      throttleExpo: 0,
      arm: { kind: 'axis', index: 4, threshold: 0, above: true },
      reset: null,
      mode: null,
      camera: null,
      turtle: { kind: 'axis', index: 5, threshold: 0, above: true }, // CH6
    }),
  },
  generic: {
    label: 'Generic gamepad (Mode 2)',
    make: () => ({ ...PRESETS.ps5.make(), preset: 'generic' }),
  },
};

const RADIO_ID = /edgetx|opentx|radiomaster|1209.*4f54|4f54.*1209|jumper|frsky|tbs|betafpv|joystick/i;
const PS_ID = /dualsense|dualshock|054c|playstation/i;

export function detectPreset(pad: Pick<Gamepad, 'id' | 'mapping'>): PresetId {
  if (PS_ID.test(pad.id)) return 'ps5';
  if (RADIO_ID.test(pad.id)) return 'radio';
  if (pad.mapping === 'standard') return 'generic';
  return 'radio';
}

/** Normalize a centered stick channel to -1..1 with calibration and deadzone. */
export function readCentered(raw: number, m: AxisMap, deadzone: number): number {
  let v: number;
  if (raw >= m.center) v = m.max - m.center > 1e-3 ? (raw - m.center) / (m.max - m.center) : 0;
  else v = m.center - m.min > 1e-3 ? (raw - m.center) / (m.center - m.min) : 0;
  v = Math.max(-1, Math.min(1, v));
  if (m.invert) v = -v;
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  return (Math.sign(v) * (a - deadzone)) / (1 - deadzone);
}

/**
 * Normalize the throttle channel to 0..1 stick position.
 * Spring-loaded sticks are read from their calibrated center, each half of the travel scaled on its own, so an
 * uneven stick still rests at exactly 0% (center-zero) or 50% (center-half). `deadzone` keeps stick drift at rest
 * from creeping the throttle up in center-zero mode. Radio throttles use the full calibrated travel.
 */
export function readThrottleStick(raw: number, m: AxisMap, mode: ThrottleMode, deadzone = 0): number {
  let t: number;
  if (mode === 'center-zero') {
    t = Math.max(0, readCentered(raw, m, deadzone));
  } else if (mode === 'center-half') {
    t = 0.5 + 0.5 * readCentered(raw, m, 0);
  } else {
    const span = m.max - m.min;
    t = span > 1e-3 ? (raw - m.min) / span : 0;
    if (m.invert) t = 1 - t;
  }
  return Math.max(0, Math.min(1, t));
}

/**
 * Betaflight-style throttle curve, anchored at 50% stick: `mid` is the output at the stick center
 * and `expo` flattens the curve around it. 0% stays 0% and 100% stays 100%.
 */
export function throttleCurve(stick: number, mid: number, expo: number): number {
  const t = Math.max(0, Math.min(1, stick));
  const u = (t - 0.5) / 0.5; // -1..1
  const shaped = u * (1 - expo + expo * u * u);
  return shaped >= 0 ? mid + shaped * (1 - mid) : mid + shaped * mid;
}

/** Throttle 0..1 for a profile: stick reading followed by the throttle curve. */
export function readThrottle(
  raw: number,
  prof: Pick<ControllerProfile, 'throttle' | 'throttleMode' | 'throttleMid' | 'throttleExpo' | 'deadzone'>,
): number {
  const stick = readThrottleStick(raw, prof.throttle, prof.throttleMode, prof.deadzone);
  return throttleCurve(stick, prof.throttleMid, prof.throttleExpo);
}

/** Validates a saved profile and fills in fields added in later versions. Returns null if unusable. */
export function normalizeProfile(raw: unknown): ControllerProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ControllerProfile>;
  const preset: PresetId = p.preset === 'ps5' || p.preset === 'radio' || p.preset === 'generic' ? p.preset : 'generic';
  const base = PRESETS[preset].make();
  const okAxis = (a: unknown): a is AxisMap =>
    !!a && typeof a === 'object' && ['axis', 'min', 'center', 'max'].every((k) => typeof (a as Record<string, unknown>)[k] === 'number');
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const bind = (b: unknown, d: Binding | null): Binding | null => {
    if (b === null) return null;
    if (!b || typeof b !== 'object') return d;
    const x = b as Binding;
    if (x.kind === 'button' && typeof x.index === 'number') return { kind: 'button', index: x.index };
    if (x.kind === 'axis' && typeof x.index === 'number' && typeof x.threshold === 'number')
      return { kind: 'axis', index: x.index, threshold: x.threshold, above: !!x.above };
    return d;
  };
  return {
    preset,
    throttle: okAxis(p.throttle) ? { ...p.throttle, invert: !!p.throttle.invert } : base.throttle,
    yaw: okAxis(p.yaw) ? { ...p.yaw, invert: !!p.yaw.invert } : base.yaw,
    pitch: okAxis(p.pitch) ? { ...p.pitch, invert: !!p.pitch.invert } : base.pitch,
    roll: okAxis(p.roll) ? { ...p.roll, invert: !!p.roll.invert } : base.roll,
    deadzone: num(p.deadzone, 0, 0.3, base.deadzone),
    throttleMode: THROTTLE_MODES.includes(p.throttleMode as ThrottleMode) ? (p.throttleMode as ThrottleMode) : base.throttleMode,
    throttleMid: num(p.throttleMid, 0.1, 0.9, base.throttleMid),
    throttleExpo: num(p.throttleExpo, 0, 1, base.throttleExpo),
    arm: bind(p.arm, base.arm),
    reset: bind(p.reset, base.reset),
    mode: bind(p.mode, base.mode),
    camera: bind(p.camera, base.camera),
    turtle: bind(p.turtle, base.turtle),
  };
}

export function bindingActive(b: Binding, pad: Gamepad): boolean {
  if (b.kind === 'button') {
    const btn = pad.buttons[b.index];
    return !!btn && (btn.pressed || btn.value > 0.5);
  }
  const v = pad.axes[b.index];
  if (v === undefined) return false;
  return b.above ? v > b.threshold : v < b.threshold;
}

export function describeBinding(b: Binding | null): string {
  if (!b) return 'not set';
  if (b.kind === 'button') return `Button ${b.index}`;
  return `Axis ${b.index} ${b.above ? '>' : '<'} ${b.threshold.toFixed(2)}`;
}
