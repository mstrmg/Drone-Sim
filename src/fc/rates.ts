export type RateAxis = 'roll' | 'pitch' | 'yaw';
export const RATE_AXES: readonly RateAxis[] = ['roll', 'pitch', 'yaw'];

/** Betaflight "BETAFLIGHT" rates type for one axis. */
export interface AxisRates {
  /** RC Rate (0.01 – 2.55). */
  rcRate: number;
  /** Super Rate (0 – 0.99). */
  superRate: number;
  /** RC Expo (0 – 1). */
  expo: number;
}

/** Betaflight "ACTUAL" rates type for one axis (the Betaflight 4.3+ default). */
export interface ActualAxisRates {
  /** Center sensitivity in deg/s (rate per unit stick near center). */
  center: number;
  /** Max rate in deg/s at full stick. */
  max: number;
  /** Expo (0 – 1). */
  expo: number;
}

export type RatesType = 'betaflight' | 'actual';

export interface Rates {
  type: RatesType;
  betaflight: Record<RateAxis, AxisRates>;
  actual: Record<RateAxis, ActualAxisRates>;
}

const bf = (rcRate: number, superRate: number, expo: number): AxisRates => ({ rcRate, superRate, expo });
const act = (center: number, max: number, expo: number): ActualAxisRates => ({ center, max, expo });

export const DEFAULT_RATES: Rates = {
  type: 'betaflight',
  betaflight: { roll: bf(1, 0.7, 0), pitch: bf(1, 0.7, 0), yaw: bf(1, 0.7, 0) },
  actual: { roll: act(70, 670, 0), pitch: act(70, 670, 0), yaw: act(70, 670, 0) },
};

export interface RatePreset {
  label: string;
  type: RatesType;
  apply: (r: Rates) => void;
}

const setAll = <T>(rec: Record<RateAxis, T>, v: () => T, yaw?: () => T) => {
  rec.roll = v();
  rec.pitch = v();
  rec.yaw = (yaw ?? v)();
};

export const RATE_PRESETS: RatePreset[] = [
  { label: 'Betaflight classic (667°/s)', type: 'betaflight', apply: (r) => setAll(r.betaflight, () => bf(1, 0.7, 0)) },
  { label: 'Betaflight 4.3+ default (Actual 670°/s)', type: 'actual', apply: (r) => setAll(r.actual, () => act(70, 670, 0)) },
  {
    label: 'Smooth freestyle (Actual 750°/s)',
    type: 'actual',
    apply: (r) => setAll(r.actual, () => act(200, 750, 0.54), () => act(200, 600, 0.4)),
  },
  {
    label: 'Snappy freestyle (Actual 900°/s)',
    type: 'actual',
    apply: (r) => setAll(r.actual, () => act(250, 900, 0.45), () => act(220, 650, 0.35)),
  },
  { label: 'Beginner (Actual 400°/s)', type: 'actual', apply: (r) => setAll(r.actual, () => act(120, 400, 0.3)) },
];

/**
 * Maps a stick deflection (-1..1) to a rotation rate in deg/s, using the same
 * formula as Betaflight's applyBetaflightRates().
 */
export function betaflightRate(stick: number, r: AxisRates): number {
  const x = Math.max(-1, Math.min(1, stick));
  const abs = Math.abs(x);
  let cmd = x;
  if (r.expo > 0) cmd = x * abs * abs * abs * r.expo + x * (1 - r.expo);
  let rcRate = r.rcRate;
  if (rcRate > 2) rcRate += 14.54 * (rcRate - 2);
  let angleRate = 200 * rcRate * cmd;
  if (r.superRate > 0) {
    const factor = 1 / Math.max(0.01, Math.min(1, 1 - abs * r.superRate));
    angleRate *= factor;
  }
  return Math.max(-1998, Math.min(1998, angleRate));
}

/** Betaflight's applyActualRates(). */
export function actualRate(stick: number, r: ActualAxisRates): number {
  const x = Math.max(-1, Math.min(1, stick));
  const abs = Math.abs(x);
  const expof = abs * (Math.pow(x, 5) * r.expo + x * (1 - r.expo));
  const stickMovement = Math.max(0, r.max - r.center);
  return Math.max(-1998, Math.min(1998, x * r.center + stickMovement * expof));
}

/** Rate (deg/s) for a stick value on one axis with the active rates type. */
export function rateFor(stick: number, rates: Rates, axis: RateAxis): number {
  return rates.type === 'actual' ? actualRate(stick, rates.actual[axis]) : betaflightRate(stick, rates.betaflight[axis]);
}

/** Rate at full stick deflection, as shown in the Betaflight configurator. */
export function maxRate(r: AxisRates): number {
  return betaflightRate(1, r);
}

export function maxRateFor(rates: Rates, axis: RateAxis): number {
  return rateFor(1, rates, axis);
}

/** Fills in missing fields and upgrades settings saved before rate types existed. */
export function normalizeRates(saved: unknown): Rates {
  const d = structuredClone(DEFAULT_RATES);
  if (!saved || typeof saved !== 'object') return d;
  const s = saved as Partial<Rates> & Partial<Record<RateAxis, AxisRates>>;
  if (s.roll && s.pitch && s.yaw && !s.betaflight) {
    d.betaflight = { roll: { ...s.roll }, pitch: { ...s.pitch }, yaw: { ...s.yaw } };
    return d;
  }
  if (s.type === 'actual' || s.type === 'betaflight') d.type = s.type;
  for (const a of RATE_AXES) {
    if (s.betaflight?.[a]) d.betaflight[a] = { ...d.betaflight[a], ...s.betaflight[a] };
    if (s.actual?.[a]) d.actual[a] = { ...d.actual[a], ...s.actual[a] };
  }
  return d;
}
