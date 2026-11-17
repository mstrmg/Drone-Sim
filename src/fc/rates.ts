/** Betaflight "BETAFLIGHT" rates type for one axis. */
export interface AxisRates {
  /** RC Rate (0.01 – 2.55). */
  rcRate: number;
  /** Super Rate (0 – 0.99). */
  superRate: number;
  /** RC Expo (0 – 1). */
  expo: number;
}

export interface Rates {
  roll: AxisRates;
  pitch: AxisRates;
  yaw: AxisRates;
}

export const DEFAULT_RATES: Rates = {
  roll: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
  pitch: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
  yaw: { rcRate: 1.0, superRate: 0.7, expo: 0.0 },
};

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

/** Rate at full stick deflection, as shown in the Betaflight configurator. */
export function maxRate(r: AxisRates): number {
  return betaflightRate(1, r);
}
