import { maxRate, betaflightRate, type AxisRates } from '../fc/rates';
import type { InputManager } from '../input/inputManager';
import { shortName } from '../input/inputManager';
import {
  PRESETS,
  describeBinding,
  readCentered,
  readThrottle,
  type AxisMap,
  type Binding,
  type PresetId,
} from '../input/profiles';
import { saveSettings, type Settings } from '../settings';

type Channel = 'throttle' | 'yaw' | 'pitch' | 'roll';
type Action = 'arm' | 'reset' | 'mode' | 'camera';
const CHANNELS: Channel[] = ['throttle', 'yaw', 'pitch', 'roll'];
const ACTIONS: { key: Action; label: string }[] = [
  { key: 'arm', label: 'Arm' },
  { key: 'reset', label: 'Reset' },
  { key: 'mode', label: 'Angle mode' },
  { key: 'camera', label: 'Chase camera' },
];

type Task =
  | { kind: 'detect'; channel: Channel; base: number[]; until: number }
  | { kind: 'bind'; action: Action; axes: number[]; buttons: boolean[]; until: number }
  | { kind: 'calibrate'; step: 'range' | 'center'; min: number[]; max: number[] };

/** Settings overlay: controller setup and calibration, rates, camera and flight options. */
export class Menu {
  readonly el: HTMLElement;
  private open = false;
  private tab = 'controls';
  private task: Task | null = null;
  private padIdsKey = '';
  private readonly body: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly input: InputManager,
    private readonly onChange: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menu hidden';
    this.el.innerHTML = `
      <div class="menu-panel" role="dialog" aria-label="Settings">
        <header>
          <h1>FPV Sim</h1>
          <nav>
            <button data-tab="controls">Controls</button>
            <button data-tab="rates">Rates</button>
            <button data-tab="camera">Camera</button>
            <button data-tab="flight">Flight</button>
            <button data-tab="help">Help</button>
          </nav>
          <button class="close" aria-label="Close menu">Fly ▸</button>
        </header>
        <div class="menu-body"></div>
      </div>`;
    this.body = this.el.querySelector('.menu-body')!;
    this.el.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab!;
        this.task = null;
        this.render();
      }),
    );
    this.el.querySelector('.close')!.addEventListener('click', () => this.toggle(false));
    parent.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    this.task = null;
    this.input.suspended = this.open;
    if (this.open) this.render();
    else {
      saveSettings(this.settings);
      this.onChange();
    }
  }

  showTab(tab: string): void {
    this.tab = tab;
    if (!this.open) this.toggle(true);
    else this.render();
  }

  private commit(): void {
    saveSettings(this.settings);
    this.onChange();
  }

  private render(): void {
    this.el.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    this.body.innerHTML = '';
    if (this.tab === 'controls') this.renderControls();
    else if (this.tab === 'rates') this.renderRates();
    else if (this.tab === 'camera') this.renderCamera();
    else if (this.tab === 'flight') this.renderFlight();
    else this.renderHelp();
  }

  // ---------------------------------------------------------------- Controls

  private renderControls(): void {
    const pads = this.input.pads();
    this.padIdsKey = pads.map((p) => p.id).join('|');
    const pad = this.input.activePad();
    if (!pad) {
      this.body.innerHTML = `
        <p class="lead">No controller detected. Plug in your controller and press any button or move a stick.</p>
        <ul class="tips">
          <li><b>PS5 DualSense:</b> USB or Bluetooth. Works in Chrome, Edge and Firefox.</li>
          <li><b>Radiomaster Pocket:</b> plug in USB-C and choose <b>USB Joystick (HID)</b> on the radio.</li>
          <li>Until then you can fly with the keyboard (see Help).</li>
        </ul>`;
      return;
    }
    const prof = this.input.profileFor(pad);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row">
        <label>Controller <select class="pad-select"></select></label>
        <span class="muted">Profile: ${PRESETS[prof.preset].label}</span>
      </div>
      <div class="row">
        <button data-preset="ps5">Load PS5 preset</button>
        <button data-preset="radio">Load radio preset</button>
        <button class="calibrate primary">Calibrate sticks</button>
      </div>
      <div class="task-box hidden"></div>
      <h2>Stick mapping</h2>
      <table class="map">
        <thead><tr><th>Channel</th><th>Axis</th><th>Invert</th><th>Output</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="row">
        <label>Stick deadzone <input type="range" class="deadzone" min="0" max="0.25" step="0.01"></label>
        <span class="deadzone-val"></span>
      </div>
      <h2>Switches and buttons</h2>
      <table class="binds"><tbody></tbody></table>
      <h2>Raw input</h2>
      <div class="raw-axes"></div>
      <div class="raw-buttons"></div>
      <p class="muted small">PS5: the left stick springs back to the middle, which reads as 50% throttle. Hold it low to arm.</p>`;
    this.body.appendChild(wrap);

    const sel = wrap.querySelector<HTMLSelectElement>('.pad-select')!;
    for (const p of pads) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = shortName(p.id);
      o.selected = p.id === pad.id;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      this.settings.preferredPad = sel.value;
      this.commit();
      this.render();
    });

    wrap.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        this.settings.profiles[pad.id] = PRESETS[b.dataset.preset as PresetId].make();
        this.commit();
        this.render();
      }),
    );
    wrap.querySelector('.calibrate')!.addEventListener('click', () => {
      const n = pad.axes.length;
      this.task = { kind: 'calibrate', step: 'range', min: Array(n).fill(Infinity), max: Array(n).fill(-Infinity) };
      this.renderTask();
    });

    const tbody = wrap.querySelector('.map tbody')!;
    for (const ch of CHANNELS) {
      const m = prof[ch];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="ch">${ch[0].toUpperCase() + ch.slice(1)}</td>
        <td><select class="axis"></select></td>
        <td><input type="checkbox" class="inv" ${m.invert ? 'checked' : ''} aria-label="Invert ${ch}"></td>
        <td><div class="bar ${ch === 'throttle' ? 'uni' : ''}"><div class="fill" data-out="${ch}"></div></div></td>
        <td><button class="detect">Detect</button></td>`;
      const axSel = tr.querySelector<HTMLSelectElement>('.axis')!;
      for (let i = 0; i < pad.axes.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `Axis ${i}`;
        o.selected = i === m.axis;
        axSel.appendChild(o);
      }
      axSel.addEventListener('change', () => {
        m.axis = Number(axSel.value);
        this.commit();
      });
      tr.querySelector<HTMLInputElement>('.inv')!.addEventListener('change', (e) => {
        m.invert = (e.target as HTMLInputElement).checked;
        this.commit();
      });
      tr.querySelector('.detect')!.addEventListener('click', () => {
        this.task = { kind: 'detect', channel: ch, base: [...pad.axes], until: performance.now() + 10000 };
        this.renderTask();
      });
      tbody.appendChild(tr);
    }

    const dz = wrap.querySelector<HTMLInputElement>('.deadzone')!;
    const dzVal = wrap.querySelector<HTMLElement>('.deadzone-val')!;
    dz.value = String(prof.deadzone);
    dzVal.textContent = `${Math.round(prof.deadzone * 100)}%`;
    dz.addEventListener('input', () => {
      prof.deadzone = Number(dz.value);
      dzVal.textContent = `${Math.round(prof.deadzone * 100)}%`;
      this.commit();
    });

    const bindBody = wrap.querySelector('.binds tbody')!;
    for (const a of ACTIONS) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="ch">${a.label}</td><td class="bind-desc">${describeBinding(prof[a.key])}</td>
        <td><span class="lamp" data-lamp="${a.key}"></span></td>
        <td><button class="bind">Bind</button> <button class="clear">Clear</button></td>`;
      tr.querySelector('.bind')!.addEventListener('click', () => {
        this.task = {
          kind: 'bind',
          action: a.key,
          axes: [...pad.axes],
          buttons: pad.buttons.map((b) => b.pressed),
          until: performance.now() + 10000,
        };
        this.renderTask();
      });
      tr.querySelector('.clear')!.addEventListener('click', () => {
        prof[a.key] = null;
        this.commit();
        this.render();
      });
      bindBody.appendChild(tr);
    }

    const raw = wrap.querySelector('.raw-axes')!;
    pad.axes.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'raw';
      d.innerHTML = `<span>A${i}</span><div class="bar"><div class="fill" data-raw="${i}"></div></div><span class="num" data-rawnum="${i}"></span>`;
      raw.appendChild(d);
    });
    const rb = wrap.querySelector('.raw-buttons')!;
    pad.buttons.forEach((_, i) => {
      const s = document.createElement('span');
      s.className = 'btn-ind';
      s.dataset.btn = String(i);
      s.textContent = String(i);
      rb.appendChild(s);
    });
    this.renderTask();
  }

  private renderTask(): void {
    const box = this.body.querySelector<HTMLElement>('.task-box');
    if (!box) return;
    const t = this.task;
    box.classList.toggle('hidden', !t);
    if (!t) return;
    box.innerHTML = '';
    const p = document.createElement('p');
    const btns = document.createElement('div');
    btns.className = 'row';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.task = null;
      this.renderTask();
    });
    if (t.kind === 'detect') {
      p.innerHTML = `Move the <b>${t.channel}</b> stick all the way, then let go.`;
    } else if (t.kind === 'bind') {
      p.innerHTML = `Press a button or flip a switch for <b>${ACTIONS.find((a) => a.key === t.action)!.label}</b>.`;
    } else if (t.step === 'range') {
      p.innerHTML = '<b>Step 1 of 2:</b> move both sticks around their full range several times (corners included), then press Next.';
      const next = document.createElement('button');
      next.className = 'primary';
      next.textContent = 'Next';
      next.addEventListener('click', () => {
        t.step = 'center';
        this.renderTask();
      });
      btns.appendChild(next);
    } else {
      p.innerHTML = '<b>Step 2 of 2:</b> let the sticks rest in the middle (throttle can be anywhere), then press Finish.';
      const fin = document.createElement('button');
      fin.className = 'primary';
      fin.textContent = 'Finish';
      fin.addEventListener('click', () => this.finishCalibration(t));
      btns.appendChild(fin);
    }
    btns.appendChild(cancel);
    box.append(p, btns);
  }

  private finishCalibration(t: Extract<Task, { kind: 'calibrate' }>): void {
    const pad = this.input.activePad();
    if (!pad) return;
    const prof = this.input.profileFor(pad);
    for (const ch of CHANNELS) {
      const m: AxisMap = prof[ch];
      const lo = t.min[m.axis];
      const hi = t.max[m.axis];
      if (!(hi - lo > 0.3)) continue; // axis not moved: keep previous values
      m.min = lo;
      m.max = hi;
      m.center = ch === 'throttle' ? (lo + hi) / 2 : pad.axes[m.axis];
    }
    this.task = null;
    this.commit();
    this.render();
  }

  /** Called every frame while the menu is open: live bars and running detection tasks. */
  update(): void {
    if (!this.open) return;
    if (this.tab !== 'controls') return;
    const pads = this.input.pads();
    const key = pads.map((p) => p.id).join('|');
    if (key !== this.padIdsKey) {
      this.render();
      return;
    }
    const pad = this.input.activePad();
    if (!pad) return;
    const prof = this.input.profileFor(pad);
    const axes = pad.axes;

    this.body.querySelectorAll<HTMLElement>('[data-raw]').forEach((el) => {
      const v = axes[Number(el.dataset.raw)] ?? 0;
      setBar(el, v, false);
    });
    this.body.querySelectorAll<HTMLElement>('[data-rawnum]').forEach((el) => {
      el.textContent = (axes[Number(el.dataset.rawnum)] ?? 0).toFixed(2);
    });
    this.body.querySelectorAll<HTMLElement>('[data-btn]').forEach((el) => {
      el.classList.toggle('on', !!pad.buttons[Number(el.dataset.btn)]?.pressed);
    });
    for (const ch of CHANNELS) {
      const el = this.body.querySelector<HTMLElement>(`[data-out="${ch}"]`);
      if (!el) continue;
      const m = prof[ch];
      const raw = axes[m.axis] ?? 0;
      if (ch === 'throttle') setBar(el, readThrottle(raw, m), true);
      else setBar(el, readCentered(raw, m, prof.deadzone), false);
    }
    for (const a of ACTIONS) {
      const el = this.body.querySelector<HTMLElement>(`[data-lamp="${a.key}"]`);
      const b = prof[a.key];
      el?.classList.toggle('on', !!b && bindingOn(b, pad));
    }

    const t = this.task;
    if (!t) return;
    const now = performance.now();
    if (t.kind === 'calibrate') {
      for (let i = 0; i < axes.length; i++) {
        if (t.step === 'range') {
          t.min[i] = Math.min(t.min[i], axes[i]);
          t.max[i] = Math.max(t.max[i], axes[i]);
        }
      }
      return;
    }
    if (now > t.until) {
      this.task = null;
      this.renderTask();
      return;
    }
    if (t.kind === 'detect') {
      let best = -1;
      let bestD = 0;
      axes.forEach((v, i) => {
        const d = Math.abs(v - t.base[i]);
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0 && bestD > 0.5) {
        const m = prof[t.channel];
        m.axis = best;
        // Pushing the stick up/right should give a positive value; the moved direction tells us.
        const moved = axes[best] - t.base[best];
        m.invert = moved < 0;
        this.task = null;
        this.commit();
        this.render();
        const box = this.body.querySelector<HTMLElement>('.task-box');
        if (box) {
          box.classList.remove('hidden');
          box.innerHTML = `<p>${t.channel} → Axis ${best}${m.invert ? ' (inverted)' : ''}. Assumes you pushed the stick <b>up</b> or <b>right</b>; flip Invert if not.</p>`;
        }
      }
    } else if (t.kind === 'bind') {
      let found: Binding | null = null;
      pad.buttons.forEach((b, i) => {
        if (!found && b.pressed && !t.buttons[i]) found = { kind: 'button', index: i };
      });
      if (!found) {
        axes.forEach((v, i) => {
          if (!found && Math.abs(v - t.axes[i]) > 0.6) {
            found = { kind: 'axis', index: i, threshold: (v + t.axes[i]) / 2, above: v > t.axes[i] };
          }
        });
      }
      if (found) {
        prof[t.action] = found;
        this.task = null;
        this.commit();
        this.render();
      }
    }
  }

  // ---------------------------------------------------------------- Rates

  private renderRates(): void {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="muted">Betaflight rates. Max rate is the rotation speed at full stick.</p>
      <table class="rates">
        <thead><tr><th></th><th>RC Rate</th><th>Super Rate</th><th>Expo</th><th>Max °/s</th></tr></thead>
        <tbody></tbody>
      </table>
      <canvas class="rate-curve" width="520" height="220" aria-label="Rate curves"></canvas>
      <div class="row"><button class="reset-rates">Reset to defaults</button></div>`;
    const tbody = wrap.querySelector('tbody')!;
    const canvas = wrap.querySelector<HTMLCanvasElement>('canvas')!;
    const axes = ['roll', 'pitch', 'yaw'] as const;
    for (const ax of axes) {
      const r = this.settings.rates[ax];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="ch">${ax[0].toUpperCase() + ax.slice(1)}</td>
        <td><input type="number" min="0.01" max="2.55" step="0.01" data-k="rcRate" value="${r.rcRate}"></td>
        <td><input type="number" min="0" max="0.99" step="0.01" data-k="superRate" value="${r.superRate}"></td>
        <td><input type="number" min="0" max="1" step="0.01" data-k="expo" value="${r.expo}"></td>
        <td class="max">${Math.round(maxRate(r))}</td>`;
      tr.querySelectorAll<HTMLInputElement>('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          const k = inp.dataset.k as keyof AxisRates;
          const v = Number(inp.value);
          if (!Number.isFinite(v)) return;
          r[k] = Math.max(Number(inp.min), Math.min(Number(inp.max), v));
          tr.querySelector('.max')!.textContent = String(Math.round(maxRate(r)));
          drawCurves(canvas, this.settings);
          this.commit();
        }),
      );
      tbody.appendChild(tr);
    }
    wrap.querySelector('.reset-rates')!.addEventListener('click', () => {
      for (const ax of axes) this.settings.rates[ax] = { rcRate: 1.0, superRate: 0.7, expo: 0 };
      this.commit();
      this.render();
    });
    this.body.appendChild(wrap);
    drawCurves(canvas, this.settings);
  }

  // ---------------------------------------------------------------- Camera / flight / help

  private renderCamera(): void {
    const c = this.settings.camera;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row"><label>Camera uptilt <input type="range" min="0" max="60" step="1" class="tilt"></label><span class="tilt-v"></span></div>
      <div class="row"><label>Field of view (horizontal) <input type="range" min="70" max="150" step="1" class="fov"></label><span class="fov-v"></span></div>
      <p class="muted">Freestyle pilots usually fly 20–35° uptilt. Higher uptilt means faster flying with the camera still looking ahead.</p>`;
    const bind = (cls: string, key: 'uptilt' | 'fov') => {
      const inp = wrap.querySelector<HTMLInputElement>(`.${cls}`)!;
      const out = wrap.querySelector<HTMLElement>(`.${cls}-v`)!;
      inp.value = String(c[key]);
      out.textContent = `${c[key]}°`;
      inp.addEventListener('input', () => {
        c[key] = Number(inp.value);
        out.textContent = `${c[key]}°`;
        this.commit();
      });
    };
    bind('tilt', 'uptilt');
    bind('fov', 'fov');
    this.body.appendChild(wrap);
  }

  private renderFlight(): void {
    const s = this.settings;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row"><label>Flight mode <select class="mode">
        <option value="acro">Acro (rate)</option><option value="angle">Angle (self-level)</option></select></label></div>
      <p class="muted">Acro is how freestyle is flown: the sticks set rotation speed and the quad holds its attitude when you let go.
      Angle mode levels the quad for you and is easier with a keyboard.</p>
      <div class="row"><label>Keyboard stick strength <input type="range" min="0.2" max="1" step="0.05" class="kb"></label><span class="kb-v"></span></div>`;
    const mode = wrap.querySelector<HTMLSelectElement>('.mode')!;
    mode.value = s.flightMode;
    mode.addEventListener('change', () => {
      s.flightMode = mode.value as Settings['flightMode'];
      this.commit();
    });
    const kb = wrap.querySelector<HTMLInputElement>('.kb')!;
    const kbv = wrap.querySelector<HTMLElement>('.kb-v')!;
    kb.value = String(s.keyboardStick);
    kbv.textContent = `${Math.round(s.keyboardStick * 100)}%`;
    kb.addEventListener('input', () => {
      s.keyboardStick = Number(kb.value);
      kbv.textContent = `${Math.round(s.keyboardStick * 100)}%`;
      this.commit();
    });
    this.body.appendChild(wrap);
  }

  private renderHelp(): void {
    this.body.innerHTML = `
      <h2>Getting started</h2>
      <ol>
        <li>Connect your controller and open <b>Controls</b> to check the mapping. Run <b>Calibrate sticks</b> once.</li>
        <li>Lower the throttle and arm (PS5: <b>R1</b>, radio: your arm switch, keyboard: <b>Space</b>).</li>
        <li>Fly. Crash, then reset (PS5: <b>Cross</b>, keyboard: <b>R</b>, radio: bind a switch in Controls).</li>
      </ol>
      <h2>Keyboard</h2>
      <table class="keys">
        <tr><td>W / S</td><td>Throttle up / down (held)</td></tr>
        <tr><td>A / D</td><td>Yaw left / right</td></tr>
        <tr><td>Arrow keys</td><td>Pitch and roll</td></tr>
        <tr><td>Shift</td><td>Finer control</td></tr>
        <tr><td>Space</td><td>Arm / disarm</td></tr>
        <tr><td>R</td><td>Reset to the launch pad</td></tr>
        <tr><td>M</td><td>Toggle acro / angle mode</td></tr>
        <tr><td>C</td><td>Toggle FPV / chase camera</td></tr>
        <tr><td>Esc</td><td>Menu</td></tr>
      </table>
      <h2>PS5 DualSense defaults (Mode 2)</h2>
      <p>Left stick: throttle and yaw. Right stick: pitch and roll. R1 arm, Cross reset, Triangle angle mode, Square chase camera, Options menu.</p>
      <h2>Radiomaster Pocket</h2>
      <p>Set the radio to USB Joystick mode. The default mapping is AETR with CH5 as the arm switch. Use Detect and Bind in Controls if your channels differ.</p>`;
  }
}

function bindingOn(b: Binding, pad: Gamepad): boolean {
  if (b.kind === 'button') return !!pad.buttons[b.index]?.pressed;
  const v = pad.axes[b.index] ?? 0;
  return b.above ? v > b.threshold : v < b.threshold;
}

function setBar(el: HTMLElement, v: number, unipolar: boolean): void {
  if (unipolar) {
    el.style.left = '0%';
    el.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
  } else {
    const c = Math.max(-1, Math.min(1, v));
    el.style.left = `${50 + Math.min(0, c) * 50}%`;
    el.style.width = `${Math.abs(c) * 50}%`;
  }
}

function drawCurves(canvas: HTMLCanvasElement, s: Settings): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  const top = Math.max(200, ...(['roll', 'pitch', 'yaw'] as const).map((a) => maxRate(s.rates[a])));
  const yMax = Math.ceil(top / 200) * 200;
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '11px ui-monospace, monospace';
  for (let v = 0; v <= yMax; v += 200) {
    const y = h - 20 - (v / yMax) * (h - 30);
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(w, y);
    g.stroke();
    g.fillText(String(v), 4, y + 4);
  }
  const colors = { roll: '#ff7a59', pitch: '#4fc3f7', yaw: '#c5e85a' };
  for (const ax of ['roll', 'pitch', 'yaw'] as const) {
    g.strokeStyle = colors[ax];
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const x = 40 + (i / 100) * (w - 50);
      const y = h - 20 - (betaflightRate(i / 100, s.rates[ax]) / yMax) * (h - 30);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = colors[ax];
    g.fillText(ax, w - 50, 14 + ['roll', 'pitch', 'yaw'].indexOf(ax) * 14);
  }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText('stick 0 → 100%', 40, h - 4);
}
