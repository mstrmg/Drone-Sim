import { describe, expect, it } from 'vitest';
import { PRESETS, detectPreset, readCentered, readThrottle } from '../src/input/profiles';

describe('controller profiles', () => {
  it('detects a DualSense and an EdgeTX radio', () => {
    expect(detectPreset({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', mapping: 'standard' })).toBe('ps5');
    expect(detectPreset({ id: 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)', mapping: '' })).toBe('radio');
    expect(detectPreset({ id: 'EdgeTX Radio', mapping: '' })).toBe('radio');
    expect(detectPreset({ id: 'Xbox Wireless Controller', mapping: 'standard' })).toBe('generic');
  });

  it('reads PS5 throttle with the spring-centered stick at 50%', () => {
    const p = PRESETS.ps5.make();
    expect(readThrottle(0, p.throttle)).toBeCloseTo(0.5);
    expect(readThrottle(-1, p.throttle)).toBeCloseTo(1); // stick up reads -1
    expect(readThrottle(1, p.throttle)).toBeCloseTo(0);
  });

  it('reads PS5 pitch forward as positive', () => {
    const p = PRESETS.ps5.make();
    expect(readCentered(-1, p.pitch, p.deadzone)).toBeCloseTo(1);
  });

  it('applies deadzone and rescales the rest of the travel', () => {
    const m = { axis: 0, invert: false, min: -1, center: 0, max: 1 };
    expect(readCentered(0.04, m, 0.05)).toBe(0);
    expect(readCentered(1, m, 0.05)).toBeCloseTo(1);
    expect(readCentered(0.525, m, 0.05)).toBeCloseTo(0.5);
  });

  it('uses calibrated ranges with an off-center stick', () => {
    const m = { axis: 0, invert: false, min: -0.9, center: 0.1, max: 0.95 };
    expect(readCentered(0.1, m, 0)).toBeCloseTo(0);
    expect(readCentered(0.95, m, 0)).toBeCloseTo(1);
    expect(readCentered(-0.9, m, 0)).toBeCloseTo(-1);
    const t = { axis: 2, invert: false, min: -0.98, center: 0, max: 0.97 };
    expect(readThrottle(-0.98, t)).toBeCloseTo(0);
    expect(readThrottle(0.97, t)).toBeCloseTo(1);
  });
});
