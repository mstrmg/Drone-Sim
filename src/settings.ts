import { DEFAULT_RATES, type Rates } from './fc/rates';
import type { FlightMode } from './fc/flightController';
import type { ControllerProfile } from './input/profiles';

export interface Settings {
  rates: Rates;
  camera: {
    /** FPV camera uptilt in degrees. */
    uptilt: number;
    /** Horizontal field of view in degrees. */
    fov: number;
  };
  flightMode: FlightMode;
  /** Controller profiles keyed by Gamepad.id. */
  profiles: Record<string, ControllerProfile>;
  /** Preferred gamepad id, or '' for automatic. */
  preferredPad: string;
  /** Keyboard throttle/stick sensitivity. */
  keyboardStick: number;
}

const KEY = 'fpvsim.settings.v1';

export function defaultSettings(): Settings {
  return {
    rates: structuredClone(DEFAULT_RATES),
    camera: { uptilt: 25, fov: 110 },
    flightMode: 'acro',
    profiles: {},
    preferredPad: '',
    keyboardStick: 0.6,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...d,
      ...s,
      rates: { ...d.rates, ...s.rates },
      camera: { ...d.camera, ...s.camera },
      profiles: s.profiles ?? {},
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}
