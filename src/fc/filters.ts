/** First-order low-pass filter (Betaflight's PT1). */
export class Pt1 {
  private y = 0;
  private k = 1;
  constructor(cutoffHz: number, dt: number) {
    this.setCutoff(cutoffHz, dt);
  }
  setCutoff(cutoffHz: number, dt: number): void {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.k = dt / (rc + dt);
  }
  apply(x: number): number {
    this.y += this.k * (x - this.y);
    return this.y;
  }
  reset(v = 0): void {
    this.y = v;
  }
  get value(): number {
    return this.y;
  }
}
