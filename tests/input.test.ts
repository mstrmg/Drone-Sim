import { describe, expect, it } from 'vitest';
import { PRESETS, detectPreset, normalizeProfile, readCentered, readThrottle, readThrottleStick, throttleCurve } from '../src/input/profiles';
import { parseSettings } from '../src/settings';
import { FREESTYLE_5IN, hoverThrottle } from '../src/sim/params';

describe('controller profiles', () => {
  it('detects a DualSense and an EdgeTX radio', () => {
    expect(detectPreset({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', mapping: 'standard' })).toBe('ps5');
    expect(detectPreset({ id: 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)', mapping: '' })).toBe('radio');
    expect(detectPreset({ id: 'EdgeTX Radio', mapping: '' })).toBe('radio');
    expect(detectPreset({ id: 'Xbox Wireless Controller', mapping: 'standard' })).toBe('generic');
  });

  it('reads PS5 throttle as 0% with the spring-centered stick at rest, 100% at full up', () => {
    const p = PRESETS.ps5.make();
    expect(readThrottle(0, p)).toBe(0);
    expect(readThrottle(0.03, p)).toBe(0); // small drift below the deadzone
    expect(readThrottle(-0.03, p)).toBe(0);
    expect(readThrottle(-1, p)).toBeCloseTo(1); // stick up reads -1
    expect(readThrottle(-0.525, p)).toBeCloseTo(0.5);
    expect(readThrottle(1, p)).toBe(0); // pulling down stays at 0%
  });

  it('can still read a PS5 throttle with the middle at 50%', () => {
    const p = { ...PRESETS.ps5.make(), throttleMode: 'center-half' as const };
    expect(readThrottle(0, p)).toBeCloseTo(0.5);
    expect(readThrottle(-1, p)).toBeCloseTo(1);
    expect(readThrottle(1, p)).toBeCloseTo(0);
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
    expect(readThrottleStick(-0.98, t, 'full')).toBeCloseTo(0);
    expect(readThrottleStick(0.97, t, 'full')).toBeCloseTo(1);
  });

  it('keeps a calibrated spring stick exactly at its rest value even with uneven travel', () => {
    // A worn stick: rests at 0.03, reaches -0.92 up and 1.0 down.
    const m = { axis: 1, invert: true, min: -0.92, center: 0.03, max: 1 };
    expect(readThrottleStick(0.03, m, 'center-zero')).toBe(0);
    expect(readThrottleStick(-0.92, m, 'center-zero')).toBeCloseTo(1);
    expect(readThrottleStick(0.03, m, 'center-half')).toBeCloseTo(0.5);
    expect(readThrottleStick(-0.92, m, 'center-half')).toBeCloseTo(1);
    expect(readThrottleStick(1, m, 'center-half')).toBeCloseTo(0);
    // The same stick read as a full-travel radio throttle would not rest at 50%.
    expect(readThrottleStick(0.03, m, 'full')).not.toBeCloseTo(0.5, 2);
  });

  it('throttle curve: mid sets the output at stick center, ends stay at 0 and 100%', () => {
    expect(throttleCurve(0.5, 0.29, 0)).toBeCloseTo(0.29);
    expect(throttleCurve(0, 0.29, 0.6)).toBeCloseTo(0);
    expect(throttleCurve(1, 0.29, 0.6)).toBeCloseTo(1);
    expect(throttleCurve(0.3, 0.5, 0)).toBeCloseTo(0.3);
    // Expo flattens around the mid point.
    expect(Math.abs(throttleCurve(0.55, 0.5, 0.8) - 0.5)).toBeLessThan(Math.abs(throttleCurve(0.55, 0.5, 0) - 0.5));
    // Monotonic.
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = throttleCurve(i / 100, 0.3, 0.7);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('hover throttle matches the physics', () => {
    expect(hoverThrottle(FREESTYLE_5IN)).toBeCloseTo(0.287, 2);
  });

  it('upgrades profiles saved before throttle settings existed', () => {
    const old = { ...PRESETS.ps5.make() } as Record<string, unknown>;
    delete old.throttleMode;
    delete old.throttleMid;
    delete old.throttleExpo;
    const p = normalizeProfile(old)!;
    expect(p.throttleMode).toBe('center-zero');
    expect(normalizeProfile({ ...old, throttleMode: 'center-half' })!.throttleMode).toBe('center-half');
    expect(p.throttleMid).toBe(0.5);
    expect(normalizeProfile('junk')).toBeNull();
  });

  it('parses settings, including the old rates format', () => {
    const s = parseSettings({ rates: { roll: { rcRate: 1.2, superRate: 0.75, expo: 0 }, pitch: { rcRate: 1, superRate: 0.7, expo: 0 }, yaw: { rcRate: 1, superRate: 0.7, expo: 0 } }, camera: { uptilt: 999 } });
    expect(s.rates.type).toBe('betaflight');
    expect(s.rates.betaflight.roll.rcRate).toBe(1.2);
    expect(s.camera.uptilt).toBe(60);
    expect(s.camera.fov).toBe(110);
  });
});
