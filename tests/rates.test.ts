import { describe, expect, it } from 'vitest';
import { actualRate, betaflightRate, maxRate } from '../src/fc/rates';

describe('Betaflight rates', () => {
  it('matches the configurator max rate for common settings', () => {
    // Betaflight configurator: RC 1.00, Super 0.70, Expo 0 -> 667 deg/s
    expect(Math.round(maxRate({ rcRate: 1, superRate: 0.7, expo: 0 }))).toBe(667);
    // RC 1.20, Super 0.75 -> 960 deg/s
    expect(Math.round(maxRate({ rcRate: 1.2, superRate: 0.75, expo: 0 }))).toBe(960);
    // RC 1.00, Super 0 -> 200 deg/s
    expect(Math.round(maxRate({ rcRate: 1, superRate: 0, expo: 0 }))).toBe(200);
  });

  it('is zero at center and symmetric', () => {
    const r = { rcRate: 1.1, superRate: 0.68, expo: 0.2 };
    expect(betaflightRate(0, r)).toBe(0);
    expect(betaflightRate(-0.6, r)).toBeCloseTo(-betaflightRate(0.6, r));
  });

  it('expo softens the center without changing the max', () => {
    const flat = { rcRate: 1, superRate: 0.7, expo: 0 };
    const exp = { rcRate: 1, superRate: 0.7, expo: 0.5 };
    expect(betaflightRate(0.3, exp)).toBeLessThan(betaflightRate(0.3, flat));
    expect(maxRate(exp)).toBeCloseTo(maxRate(flat));
  });

  it('Actual rates hit center sensitivity near center and max at full stick', () => {
    const r = { center: 200, max: 800, expo: 0.5 };
    expect(actualRate(1, r)).toBeCloseTo(800);
    expect(actualRate(-1, r)).toBeCloseTo(-800);
    expect(actualRate(0.001, r) / 0.001).toBeCloseTo(200, 0);
    expect(actualRate(0, r)).toBe(0);
  });
});
