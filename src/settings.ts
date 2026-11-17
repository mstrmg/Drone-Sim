import { DEFAULT_RATES, normalizeRates, type Rates } from './fc/rates';
import type { FlightMode } from './fc/flightController';
import { normalizeProfile, type ControllerProfile } from './input/profiles';
import { isMapId, type MapId } from './world/maps';

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
  /** Which map to fly. */
  map: MapId;
}

export const SETTINGS_KEY = 'fpvsim.settings.v1';

export function defaultSettings(): Settings {
  return {
    rates: structuredClone(DEFAULT_RATES),
    camera: { uptilt: 25, fov: 110 },
    flightMode: 'acro',
    profiles: {},
    preferredPad: '',
    keyboardStick: 0.6,
    map: 'bando',
  };
}

/** Builds complete settings from saved or imported JSON, filling anything missing with defaults. */
export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw as Partial<Settings>;
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  const profiles: Record<string, ControllerProfile> = {};
  if (s.profiles && typeof s.profiles === 'object') {
    for (const [id, p] of Object.entries(s.profiles)) {
      const prof = normalizeProfile(p);
      if (prof) profiles[id] = prof;
    }
  }
  return {
    rates: normalizeRates(s.rates),
    camera: {
      uptilt: num(s.camera?.uptilt, 0, 60, d.camera.uptilt),
      fov: num(s.camera?.fov, 70, 150, d.camera.fov),
    },
    flightMode: s.flightMode === 'angle' ? 'angle' : 'acro',
    profiles,
    preferredPad: typeof s.preferredPad === 'string' ? s.preferredPad : '',
    keyboardStick: num(s.keyboardStick, 0.2, 1, d.keyboardStick),
    map: isMapId(s.map) ? s.map : d.map,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}

/** Replaces the contents of `target` in place, so everything holding a reference sees the change. */
export function replaceSettings(target: Settings, next: Settings): void {
  Object.assign(target, next);
}
