import type { Sticks } from '../fc/flightController';
import type { Settings } from '../settings';
import {
  PRESETS,
  bindingActive,
  detectPreset,
  readCentered,
  readThrottle,
  type Binding,
  type ControllerProfile,
} from './profiles';

export interface InputFrame {
  sticks: Sticks;
  source: 'gamepad' | 'keyboard';
  sourceName: string;
  /** Level of the arm switch when it is a switch binding, otherwise null. */
  armSwitch: boolean | null;
  /** True on the frame an arm toggle button was pressed. */
  armToggle: boolean;
  reset: boolean;
  modeToggle: boolean;
  /** Level of the mode switch when it is a switch binding (true = angle), otherwise null. */
  modeSwitch: boolean | null;
  cameraToggle: boolean;
  menuToggle: boolean;
  /** True on the frame a turtle-mode button was pressed. */
  turtleToggle: boolean;
  /** Level of the turtle switch when it is a switch binding, otherwise null. */
  turtleSwitch: boolean | null;
}

const KEYS_HANDLED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD',
  'Space', 'KeyR', 'KeyM', 'KeyC', 'KeyT', 'Escape', 'ShiftLeft', 'ShiftRight',
]);

/** Reads the active gamepad (or keyboard) once per frame and turns it into sticks and actions. */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly pressedOnce = new Set<string>();
  private kbThrottle = 0;
  private kbSticks = { roll: 0, pitch: 0, yaw: 0 };
  private lastKeyboardUse = -Infinity;
  private prevBindings = new Map<string, boolean>();
  /** When true (e.g. during calibration), actions are not reported. */
  suspended = false;

  constructor(private readonly settings: Settings) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (KEYS_HANDLED.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** All connected gamepads. */
  pads(): Gamepad[] {
    return Array.from(navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
  }

  /** The gamepad currently used for flying, if any. */
  activePad(): Gamepad | null {
    const pads = this.pads().filter((p) => p.axes.length >= 4);
    if (!pads.length) return null;
    return pads.find((p) => p.id === this.settings.preferredPad) ?? pads[0];
  }

  /** Profile for a pad, created from the detected preset the first time it is seen. */
  profileFor(pad: Gamepad): ControllerProfile {
    let prof = this.settings.profiles[pad.id];
    if (!prof) {
      prof = PRESETS[detectPreset(pad)].make();
      this.settings.profiles[pad.id] = prof;
    }
    return prof;
  }

  setKeyboardThrottle(v: number): void {
    this.kbThrottle = v;
  }

  poll(dt: number): InputFrame {
    const pad = this.activePad();
    const kbActive = this.updateKeyboard(dt);
    const frame: InputFrame = {
      sticks: { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
      source: 'keyboard',
      sourceName: 'Keyboard',
      armSwitch: null,
      armToggle: this.consume('Space'),
      reset: this.consume('KeyR'),
      modeToggle: this.consume('KeyM'),
      modeSwitch: null,
      cameraToggle: this.consume('KeyC'),
      menuToggle: this.consume('Escape'),
      turtleToggle: this.consume('KeyT'),
      turtleSwitch: null,
    };

    if (pad && !kbActive) {
      const prof = this.profileFor(pad);
      const a = pad.axes;
      frame.source = 'gamepad';
      frame.sourceName = shortName(pad.id);
      frame.sticks = {
        roll: readCentered(a[prof.roll.axis] ?? 0, prof.roll, prof.deadzone),
        pitch: readCentered(a[prof.pitch.axis] ?? 0, prof.pitch, prof.deadzone),
        yaw: readCentered(a[prof.yaw.axis] ?? 0, prof.yaw, prof.deadzone),
        throttle: readThrottle(a[prof.throttle.axis] ?? 0, prof),
      };
      // Keep the keyboard throttle in sync so switching sources doesn't jump.
      this.kbThrottle = frame.sticks.throttle;
    } else {
      frame.sticks = { ...this.kbSticks, throttle: this.kbThrottle };
    }

    if (pad && !this.suspended) {
      const prof = this.profileFor(pad);
      const edge = (name: string, b: Binding | null): boolean => {
        if (!b) return false;
        const now = bindingActive(b, pad);
        const before = this.prevBindings.get(name) ?? now;
        this.prevBindings.set(name, now);
        return now && !before;
      };
      if (prof.arm?.kind === 'axis') frame.armSwitch = bindingActive(prof.arm, pad);
      else frame.armToggle ||= edge('arm', prof.arm);
      if (prof.mode?.kind === 'axis') frame.modeSwitch = bindingActive(prof.mode, pad);
      else frame.modeToggle ||= edge('mode', prof.mode);
      frame.reset ||= edge('reset', prof.reset);
      frame.cameraToggle ||= edge('camera', prof.camera);
      if (prof.turtle?.kind === 'axis') frame.turtleSwitch = bindingActive(prof.turtle, pad);
      else frame.turtleToggle ||= edge('turtle', prof.turtle);
      // Options / Start button opens the menu on standard-mapping pads.
      if (pad.mapping === 'standard') frame.menuToggle ||= edge('menu', { kind: 'button', index: 9 });
    }
    if (this.suspended) {
      frame.armToggle = frame.reset = frame.modeToggle = frame.cameraToggle = frame.turtleToggle = false;
      frame.armSwitch = frame.modeSwitch = frame.turtleSwitch = null;
    }
    return frame;
  }

  private consume(code: string): boolean {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  /** Keyboard flying: arrows = pitch/roll, A/D = yaw, W/S = throttle up/down. Returns true if in use. */
  private updateKeyboard(dt: number): boolean {
    const k = this.keys;
    const fine = k.has('ShiftLeft') || k.has('ShiftRight');
    const strength = this.settings.keyboardStick * (fine ? 0.5 : 1);
    const target = {
      roll: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0),
      pitch: (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0),
      yaw: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
    };
    const slew = 5 * dt;
    for (const ax of ['roll', 'pitch', 'yaw'] as const) {
      const t = target[ax] * strength;
      const cur = this.kbSticks[ax];
      this.kbSticks[ax] = cur + Math.max(-slew, Math.min(slew, t - cur));
    }
    const thrRate = fine ? 0.25 : 0.6;
    if (k.has('KeyW')) this.kbThrottle = Math.min(1, this.kbThrottle + thrRate * dt);
    if (k.has('KeyS')) this.kbThrottle = Math.max(0, this.kbThrottle - thrRate * dt);

    const flying = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].some((c) => k.has(c));
    const now = performance.now();
    if (flying) this.lastKeyboardUse = now;
    // Keyboard stays in control for 2 s after the last flying key so stick centering still applies.
    return now - this.lastKeyboardUse < 2000 || !this.activePad();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}

export function shortName(id: string): string {
  const cleaned = id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || id).slice(0, 40);
}
