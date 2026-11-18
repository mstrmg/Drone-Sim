/**
 * LiPo pack model: open-circuit voltage from state of charge, an ohmic internal resistance, and a slower
 * polarisation term so voltage sags under a punch-out and recovers afterwards.
 */
export interface BatteryParams {
  cells: number;
  /** Capacity in amp-hours. */
  capacityAh: number;
  /** Ohmic resistance of the whole pack (Ω). */
  r0: number;
  /** Polarisation resistance (Ω) and its time constant (s). */
  r1: number;
  tau1: number;
}

/** 6S 1300 mAh, a typical 5" freestyle pack. */
export const PACK_6S_1300: BatteryParams = { cells: 6, capacityAh: 1.3, r0: 0.018, r1: 0.012, tau1: 12 };

/** Resting cell voltage by state of charge (0..1), from typical LiPo discharge curves. */
const OCV: ReadonlyArray<[number, number]> = [
  [0, 3.27],
  [0.05, 3.5],
  [0.1, 3.62],
  [0.2, 3.71],
  [0.3, 3.76],
  [0.4, 3.8],
  [0.5, 3.84],
  [0.6, 3.88],
  [0.7, 3.95],
  [0.8, 4.03],
  [0.9, 4.11],
  [1, 4.2],
];

export function cellOcv(soc: number): number {
  const s = Math.max(0, Math.min(1, soc));
  for (let i = 1; i < OCV.length; i++) {
    if (s <= OCV[i][0]) {
      const [s0, v0] = OCV[i - 1];
      const [s1, v1] = OCV[i];
      return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
    }
  }
  return OCV[OCV.length - 1][1];
}

export class Battery {
  /** Charge drawn so far (Ah). */
  usedAh = 0;
  /** Polarisation voltage (V). */
  private vp = 0;
  /** Terminal voltage under the present load (V). */
  voltage: number;
  /** Present current (A). */
  current = 0;

  constructor(readonly p: BatteryParams = PACK_6S_1300) {
    this.voltage = this.fullVoltage;
  }

  get fullVoltage(): number {
    return 4.2 * this.p.cells;
  }

  get soc(): number {
    return Math.max(0, 1 - this.usedAh / this.p.capacityAh);
  }

  get cellVoltage(): number {
    return this.voltage / this.p.cells;
  }

  reset(): void {
    this.usedAh = 0;
    this.vp = 0;
    this.current = 0;
    this.voltage = this.fullVoltage;
  }

  /** Draws `powerW` of electrical power for dt seconds and updates the terminal voltage. */
  step(powerW: number, dt: number): void {
    const ocv = cellOcv(this.soc) * this.p.cells;
    // Solve P = V·I with V = ocv − vp − I·r0 for I (the smaller root is the stable operating point).
    const e = ocv - this.vp;
    const disc = e * e - 4 * this.p.r0 * powerW;
    const i = disc > 0 ? (e - Math.sqrt(disc)) / (2 * this.p.r0) : e / (2 * this.p.r0);
    this.current = i;
    this.vp += ((i * this.p.r1 - this.vp) * dt) / this.p.tau1;
    this.voltage = Math.max(0, e - i * this.p.r0);
    this.usedAh += (i * dt) / 3600;
  }
}
