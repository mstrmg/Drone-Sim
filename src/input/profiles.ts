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
  arm: Binding | null;
  reset: Binding | null;
  mode: Binding | null;
  camera: Binding | null;
}

export type PresetId = 'ps5' | 'radio' | 'generic';

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
      arm: { kind: 'button', index: 5 }, // R1
      reset: { kind: 'button', index: 0 }, // Cross
      mode: { kind: 'button', index: 3 }, // Triangle
      camera: { kind: 'button', index: 2 }, // Square
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
      arm: { kind: 'axis', index: 4, threshold: 0, above: true },
      reset: null,
      mode: null,
      camera: null,
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

/** Normalize the throttle channel to 0..1 over its full calibrated travel. */
export function readThrottle(raw: number, m: AxisMap): number {
  const span = m.max - m.min;
  let t = span > 1e-3 ? (raw - m.min) / span : 0;
  if (m.invert) t = 1 - t;
  return Math.max(0, Math.min(1, t));
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
