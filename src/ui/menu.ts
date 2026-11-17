import type { Sticks } from '../fc/flightController';
import {
  RATE_AXES,
  RATE_PRESETS,
  maxRateFor,
  rateFor,
  type RateAxis,
  type RatesType,
} from '../fc/rates';
import type { InputManager } from '../input/inputManager';
import { shortName } from '../input/inputManager';
import {
  PRESETS,
  describeBinding,
  readCentered,
  readThrottle,
  readThrottleStick,
  throttleCurve,
  type AxisMap,
  type Binding,
  type ControllerProfile,
  type PresetId,
} from '../input/profiles';
import { FREESTYLE_5IN, hoverThrottle } from '../sim/params';
import { defaultSettings, parseSettings, replaceSettings, saveSettings, type Settings } from '../settings';

type Channel = 'throttle' | 'yaw' | 'pitch' | 'roll';
type Action = 'arm' | 'reset' | 'mode' | 'camera';
type Tab = 'controls' | 'rates' | 'camera' | 'flight' | 'help';
const CHANNELS: Channel[] = ['throttle', 'yaw', 'pitch', 'roll'];
const ACTIONS: { key: Action; label: string }[] = [
  { key: 'arm', label: 'Arm' },
  { key: 'reset', label: 'Reset' },
  { key: 'mode', label: 'Angle mode' },
  { key: 'camera', label: 'Chase camera' },
];
const AXIS_COLORS: Record<RateAxis, string> = { roll: '#ff7a59', pitch: '#4fc3f7', yaw: '#c5e85a' };
const HOVER = hoverThrottle(FREESTYLE_5IN);

type Task =
  | { kind: 'detect'; channel: Channel; base: number[]; until: number }
  | { kind: 'bind'; action: Action; axes: number[]; buttons: boolean[]; until: number }
  | { kind: 'calibrate'; step: 'range' | 'center'; min: number[]; max: number[] };

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Settings overlay: controller setup and calibration, throttle curve, rates, camera and general options. */
export class Menu {
  readonly el: HTMLElement;
  private open = false;
  private tab: Tab = 'controls';
  private task: Task | null = null;
  private padIdsKey = '';
  private readonly body: HTMLElement;
  /** Latest stick values, for live previews. */
  private sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

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
            <button data-tab="flight">General</button>
            <button data-tab="help">Help</button>
          </nav>
          <button class="close" aria-label="Close menu">Fly ▸</button>
        </header>
        <div class="menu-body"></div>
      </div>`;
    this.body = this.el.querySelector('.menu-body')!;
    this.el.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
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

  showTab(tab: Tab): void {
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
    // The camera tab docks to the side so the FPV view stays visible while adjusting.
    this.el.classList.toggle('side', this.tab === 'camera');
    this.body.innerHTML = '';
    if (this.tab === 'controls') this.renderControls();
    else if (this.tab === 'rates') this.renderRates();
    else if (this.tab === 'camera') this.renderCamera();
    else if (this.tab === 'flight') this.renderGeneral();
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
        </ul>
        <h2>Sticks</h2>
        <div class="gimbals"></div>`;
      this.body.querySelector('.gimbals')!.innerHTML = gimbalsHtml();
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
      <div class="gimbals">${gimbalsHtml()}</div>
      <h2>Stick mapping</h2>
      <table class="map">
        <thead><tr><th>Channel</th><th>Axis</th><th>Invert</th><th>Output</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="row">
        <label>Stick deadzone <input type="range" class="deadzone" min="0" max="0.25" step="0.01"></label>
        <span class="deadzone-val"></span>
      </div>
      <h2>Throttle</h2>
      <div class="throttle-grid">
        <div>
          <label class="check"><input type="checkbox" class="thr-centered"> Throttle stick springs back to the middle (gamepad)</label>
          <p class="muted small thr-centered-note"></p>
          <div class="row"><label>Mid (output at stick center) <input type="range" class="thr-mid" min="0.1" max="0.9" step="0.01"></label><span class="thr-mid-v"></span></div>
          <div class="row"><label>Expo <input type="range" class="thr-expo" min="0" max="1" step="0.01"></label><span class="thr-expo-v"></span></div>
          <div class="row">
            <button class="thr-hover">Hover at stick center</button>
            <button class="thr-linear">Linear</button>
          </div>
          <p class="muted small">This quad hovers at about ${pct(HOVER)} throttle. "Hover at stick center" sets Mid to that,
          so letting go of a spring-loaded stick holds altitude. Expo gives finer control near the middle.</p>
        </div>
        <canvas class="thr-curve" width="240" height="240" aria-label="Throttle curve"></canvas>
      </div>
      <h2>Switches and buttons</h2>
      <table class="binds"><tbody></tbody></table>
      <h2>Raw input</h2>
      <div class="raw-axes"></div>
      <div class="raw-buttons"></div>`;
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
        <td class="ch">${cap(ch)}</td>
        <td><select class="axis" aria-label="${ch} axis"></select></td>
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

    this.slider(wrap, '.deadzone', '.deadzone-val', () => prof.deadzone, (v) => (prof.deadzone = v), pct);

    // Throttle settings.
    const centered = wrap.querySelector<HTMLInputElement>('.thr-centered')!;
    const note = wrap.querySelector<HTMLElement>('.thr-centered-note')!;
    const setNote = () =>
      (note.textContent = prof.throttleCentered
        ? 'The stick at rest is exactly 50% stick. Push up for more, pull down for less.'
        : 'The full stick travel is 0–100% (radio throttle without a spring).');
    centered.checked = prof.throttleCentered;
    setNote();
    centered.addEventListener('change', () => {
      prof.throttleCentered = centered.checked;
      setNote();
      this.commit();
    });
    const mid = this.slider(wrap, '.thr-mid', '.thr-mid-v', () => prof.throttleMid, (v) => (prof.throttleMid = v), pct);
    const expo = this.slider(wrap, '.thr-expo', '.thr-expo-v', () => prof.throttleExpo, (v) => (prof.throttleExpo = v), pct);
    wrap.querySelector('.thr-hover')!.addEventListener('click', () => {
      prof.throttleMid = Math.round(HOVER * 100) / 100;
      mid.sync();
      this.commit();
    });
    wrap.querySelector('.thr-linear')!.addEventListener('click', () => {
      prof.throttleMid = 0.5;
      prof.throttleExpo = 0;
      mid.sync();
      expo.sync();
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

  /** Wires a range input to a numeric setting. Returns a handle to refresh it after outside changes. */
  private slider(
    root: HTMLElement,
    inputSel: string,
    outSel: string,
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string,
  ): { sync: () => void } {
    const inp = root.querySelector<HTMLInputElement>(inputSel)!;
    const out = root.querySelector<HTMLElement>(outSel)!;
    const sync = () => {
      inp.value = String(get());
      out.textContent = fmt(get());
    };
    sync();
    inp.addEventListener('input', () => {
      set(Number(inp.value));
      out.textContent = fmt(get());
      this.commit();
    });
    return { sync };
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
      p.innerHTML = `Move the <b>${t.channel}</b> stick all the way up (or right for yaw and roll), then let go.`;
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
      p.innerHTML =
        '<b>Step 2 of 2:</b> let go of the sticks so they rest in the middle (a radio throttle can stay anywhere), then press Finish.';
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
    const done: string[] = [];
    for (const ch of CHANNELS) {
      const m: AxisMap = prof[ch];
      const lo = t.min[m.axis];
      const hi = t.max[m.axis];
      if (!(hi - lo > 0.3)) continue; // axis not moved: keep previous values
      m.min = lo;
      m.max = hi;
      // A spring-centered throttle rests in the middle, so its rest position becomes exactly 50%.
      const restsCentered = ch !== 'throttle' || prof.throttleCentered;
      m.center = restsCentered ? (pad.axes[m.axis] ?? 0) : (lo + hi) / 2;
      done.push(ch);
    }
    this.task = null;
    this.commit();
    this.render();
    const box = this.body.querySelector<HTMLElement>('.task-box');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = done.length
        ? `<p>Calibrated ${done.join(', ')}.</p>`
        : '<p>No stick movement was detected, so nothing changed. Check the axis mapping and try again.</p>';
    }
  }

  /** Called every frame while the menu is open: live previews and running detection tasks. */
  update(sticks: Sticks): void {
    if (!this.open) return;
    this.sticks = sticks;
    if (this.tab === 'rates') {
      const c = this.body.querySelector<HTMLCanvasElement>('.rate-curve');
      if (c) drawRateCurves(c, this.settings, this.sticks);
      return;
    }
    if (this.tab !== 'controls') return;
    const pads = this.input.pads();
    const key = pads.map((p) => p.id).join('|');
    if (key !== this.padIdsKey) {
      this.render();
      return;
    }
    const pad = this.input.activePad();
    if (!pad) {
      this.updateGimbals(sticks.throttle);
      return;
    }
    const prof = this.input.profileFor(pad);
    const axes = pad.axes;

    this.body.querySelectorAll<HTMLElement>('[data-raw]').forEach((el) => setBar(el, axes[Number(el.dataset.raw)] ?? 0, false));
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
      if (ch === 'throttle') setBar(el, readThrottle(raw, prof), true);
      else setBar(el, readCentered(raw, m, prof.deadzone), false);
    }
    for (const a of ACTIONS) {
      const el = this.body.querySelector<HTMLElement>(`[data-lamp="${a.key}"]`);
      const b = prof[a.key];
      el?.classList.toggle('on', !!b && bindingOn(b, pad));
    }
    const thrStick = readThrottleStick(axes[prof.throttle.axis] ?? 0, prof.throttle, prof.throttleCentered);
    this.updateGimbals(thrStick);
    const curve = this.body.querySelector<HTMLCanvasElement>('.thr-curve');
    if (curve) drawThrottleCurve(curve, prof, thrStick);

    this.runTask(pad, prof);
  }

  /** Mode 2 stick display: left = yaw / throttle, right = roll / pitch. */
  private updateGimbals(throttleStick: number): void {
    const s = this.sticks;
    const place = (sel: string, x: number, y: number) => {
      const dot = this.body.querySelector<HTMLElement>(sel);
      if (dot) {
        dot.style.left = `${50 + x * 50}%`;
        dot.style.top = `${50 - y * 50}%`;
      }
    };
    place('.gimbal-l .dot', s.yaw, throttleStick * 2 - 1);
    place('.gimbal-r .dot', s.roll, s.pitch);
    const lbl = this.body.querySelector<HTMLElement>('.gimbal-readout');
    if (lbl)
      lbl.textContent = `THR ${pct(s.throttle)}  YAW ${fmtStick(s.yaw)}  PIT ${fmtStick(s.pitch)}  ROL ${fmtStick(s.roll)}`;
  }

  private runTask(pad: Gamepad, prof: ControllerProfile): void {
    const t = this.task;
    if (!t) return;
    const axes = pad.axes;
    if (t.kind === 'calibrate') {
      if (t.step === 'range') {
        for (let i = 0; i < axes.length; i++) {
          t.min[i] = Math.min(t.min[i], axes[i]);
          t.max[i] = Math.max(t.max[i], axes[i]);
        }
      }
      return;
    }
    if (performance.now() > t.until) {
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
        // The user was asked to push up (or right), which must read as positive.
        m.invert = axes[best] - t.base[best] < 0;
        this.task = null;
        this.commit();
        this.render();
        const box = this.body.querySelector<HTMLElement>('.task-box');
        if (box) {
          box.classList.remove('hidden');
          box.innerHTML = `<p>${cap(t.channel)} → Axis ${best}${m.invert ? ' (inverted)' : ''}.</p>`;
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
    const r = this.settings.rates;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row">
        <label>Rates type <select class="rtype">
          <option value="betaflight">Betaflight</option>
          <option value="actual">Actual</option>
        </select></label>
        <label>Preset <select class="rpreset"><option value="">Choose…</option></select></label>
      </div>
      <p class="muted small rtype-note"></p>
      <table class="rates">
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table>
      <canvas class="rate-curve" width="560" height="240" aria-label="Rate curves with live stick position"></canvas>
      <p class="muted small">Move the sticks to see where you are on each curve.</p>`;
    const typeSel = wrap.querySelector<HTMLSelectElement>('.rtype')!;
    typeSel.value = r.type;
    typeSel.addEventListener('change', () => {
      r.type = typeSel.value as RatesType;
      this.commit();
      this.render();
    });
    const presetSel = wrap.querySelector<HTMLSelectElement>('.rpreset')!;
    RATE_PRESETS.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = p.label;
      presetSel.appendChild(o);
    });
    presetSel.addEventListener('change', () => {
      const p = RATE_PRESETS[Number(presetSel.value)];
      if (!p) return;
      p.apply(r);
      r.type = p.type;
      this.commit();
      this.render();
    });
    wrap.querySelector('.rtype-note')!.textContent =
      r.type === 'actual'
        ? 'Center sensitivity is the rate near the middle of the stick, Max rate is the rate at full stick, and Expo bends the curve between them.'
        : 'RC Rate sets the overall rate, Super Rate adds more at the ends of the stick, and Expo softens the middle.';

    const head = wrap.querySelector('thead tr')!;
    const fields: { key: string; label: string; min: number; max: number; step: number }[] =
      r.type === 'actual'
        ? [
            { key: 'center', label: 'Center °/s', min: 10, max: 1000, step: 5 },
            { key: 'max', label: 'Max °/s', min: 10, max: 1998, step: 10 },
            { key: 'expo', label: 'Expo', min: 0, max: 1, step: 0.01 },
          ]
        : [
            { key: 'rcRate', label: 'RC Rate', min: 0.01, max: 2.55, step: 0.01 },
            { key: 'superRate', label: 'Super Rate', min: 0, max: 0.99, step: 0.01 },
            { key: 'expo', label: 'Expo', min: 0, max: 1, step: 0.01 },
          ];
    head.innerHTML = `<th></th>${fields.map((f) => `<th>${f.label}</th>`).join('')}<th>Max °/s</th>`;
    const tbody = wrap.querySelector('tbody')!;
    for (const ax of RATE_AXES) {
      const axisRates = (r.type === 'actual' ? r.actual[ax] : r.betaflight[ax]) as unknown as Record<string, number>;
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="ch" style="color:${AXIS_COLORS[ax]}">${cap(ax)}</td>` +
        fields
          .map(
            (f) =>
              `<td><input type="number" min="${f.min}" max="${f.max}" step="${f.step}" data-k="${f.key}" value="${axisRates[f.key]}" aria-label="${ax} ${f.label}"></td>`,
          )
          .join('') +
        `<td class="max">${Math.round(maxRateFor(r, ax))}</td>`;
      tr.querySelectorAll<HTMLInputElement>('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          const v = Number(inp.value);
          if (inp.value === '' || !Number.isFinite(v)) return;
          axisRates[inp.dataset.k!] = Math.max(Number(inp.min), Math.min(Number(inp.max), v));
          tr.querySelector('.max')!.textContent = String(Math.round(maxRateFor(r, ax)));
          presetSel.value = '';
          this.commit();
        }),
      );
      tbody.appendChild(tr);
    }
    this.body.appendChild(wrap);
    drawRateCurves(wrap.querySelector('canvas')!, this.settings, this.sticks);
  }

  // ---------------------------------------------------------------- Camera / general / help

  private renderCamera(): void {
    const c = this.settings.camera;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p class="muted small">The view behind this panel updates as you change the settings.</p>
      <div class="row"><label>Uptilt <input type="range" min="0" max="60" step="1" class="tilt"></label><span class="tilt-v"></span></div>
      <div class="row"><label>Field of view <input type="range" min="70" max="150" step="1" class="fov"></label><span class="fov-v"></span></div>
      <h2>Presets</h2>
      <div class="row wrap">
        <button data-cam="15,100">Cruising · 15°</button>
        <button data-cam="25,110">Freestyle · 25°</button>
        <button data-cam="35,115">Fast freestyle · 35°</button>
        <button data-cam="45,120">Race · 45°</button>
      </div>
      <p class="muted small">Uptilt is how far the camera points up. More uptilt suits faster flying, since the quad tilts forward more
      at speed. Field of view is horizontal; real FPV cameras are about 120–150°, but wide views look stretched on a flat screen.</p>`;
    const tilt = this.slider(wrap, '.tilt', '.tilt-v', () => c.uptilt, (v) => (c.uptilt = v), (v) => `${v}°`);
    const fov = this.slider(wrap, '.fov', '.fov-v', () => c.fov, (v) => (c.fov = v), (v) => `${v}°`);
    wrap.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) =>
      b.addEventListener('click', () => {
        const [u, f] = b.dataset.cam!.split(',').map(Number);
        c.uptilt = u;
        c.fov = f;
        tilt.sync();
        fov.sync();
        this.commit();
      }),
    );
    this.body.appendChild(wrap);
  }

  private renderGeneral(): void {
    const s = this.settings;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>Flight</h2>
      <div class="row"><label>Flight mode <select class="mode">
        <option value="acro">Acro (rate)</option><option value="angle">Angle (self-level)</option></select></label></div>
      <p class="muted">Acro is how freestyle is flown: the sticks set rotation speed and the quad holds its attitude when you let go.
      Angle mode levels the quad for you and is easier with a keyboard.</p>
      <div class="row"><label>Keyboard stick strength <input type="range" min="0.2" max="1" step="0.05" class="kb"></label><span class="kb-v"></span></div>
      <h2>Settings</h2>
      <p class="muted small">Settings are saved in this browser. Copy them to keep a backup or move them to another computer,
      then paste them back here (or load a saved .json file) to restore them.</p>
      <div class="row">
        <button class="copy-settings primary">Copy settings</button>
        <button class="export">Download file</button>
        <button class="paste-settings">Load from text box</button>
        <label class="file-btn"><input type="file" accept="application/json,.json" class="import"> Load file</label>
        <button class="reset-all">Reset everything</button>
      </div>
      <textarea class="settings-json" rows="6" spellcheck="false" aria-label="Settings as text"
        placeholder="Copied settings appear here. Paste settings here and press Load from text box."></textarea>
      <p class="settings-msg small" role="status"></p>`;
    const mode = wrap.querySelector<HTMLSelectElement>('.mode')!;
    mode.value = s.flightMode;
    mode.addEventListener('change', () => {
      s.flightMode = mode.value as Settings['flightMode'];
      this.commit();
    });
    this.slider(wrap, '.kb', '.kb-v', () => s.keyboardStick, (v) => (s.keyboardStick = v), pct);
    const msg = wrap.querySelector<HTMLElement>('.settings-msg')!;
    const box = wrap.querySelector<HTMLTextAreaElement>('.settings-json')!;
    const json = () => JSON.stringify(s, null, 2);
    // Copy works everywhere a click is allowed, including embedded viewers that block file downloads.
    wrap.querySelector('.copy-settings')!.addEventListener('click', async () => {
      box.value = json();
      try {
        await navigator.clipboard.writeText(box.value);
        msg.textContent = 'Settings copied to the clipboard.';
      } catch {
        box.focus();
        box.select();
        msg.textContent = 'Could not reach the clipboard. The settings are selected in the box below: copy them from there.';
      }
    });
    wrap.querySelector('.export')!.addEventListener('click', () => {
      box.value = json();
      try {
        const blob = new Blob([box.value], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fpv-sim-settings.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        msg.textContent = 'If no file was saved, copy the settings from the box below instead.';
      } catch {
        msg.textContent = 'Downloads are blocked here. Copy the settings from the box below instead.';
      }
    });
    const load = (text: string, what: string) => {
      try {
        replaceSettings(s, parseSettings(JSON.parse(text)));
        this.commit();
        this.render();
        this.body.querySelector('.settings-msg')!.textContent = `Settings loaded from ${what}.`;
      } catch {
        msg.textContent = `That ${what} could not be read as FPV Sim settings.`;
      }
    };
    wrap.querySelector('.paste-settings')!.addEventListener('click', () => {
      if (!box.value.trim()) {
        msg.textContent = 'Paste your settings into the box below first.';
        box.focus();
        return;
      }
      load(box.value, 'the text box');
    });
    wrap.querySelector<HTMLInputElement>('.import')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) load(await file.text(), 'file');
    });
    const resetBtn = wrap.querySelector<HTMLButtonElement>('.reset-all')!;
    let armedReset = false;
    resetBtn.addEventListener('click', () => {
      if (!armedReset) {
        armedReset = true;
        resetBtn.textContent = 'Click again to reset';
        resetBtn.classList.add('danger');
        return;
      }
      replaceSettings(s, defaultSettings());
      this.commit();
      this.render();
      this.body.querySelector('.settings-msg')!.textContent = 'All settings reset to defaults.';
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
      <p>The throttle stick springs back to the middle, which is 50% throttle. The quad hovers at about ${pct(HOVER)}, so hold the
      stick a little below the middle to hover, or use <b>Controls → Throttle → Hover at stick center</b> to make the middle hover.
      To arm, hold the throttle stick all the way down and press R1.</p>
      <h2>Radiomaster Pocket</h2>
      <p>Set the radio to USB Joystick mode. The default mapping is AETR with CH5 as the arm switch. Use Detect and Bind in Controls if your channels differ.</p>`;
  }
}

function gimbalsHtml(): string {
  return `
    <div class="gimbal gimbal-l" aria-label="Left stick: throttle and yaw"><div class="dot"></div><span>THR / YAW</span></div>
    <div class="gimbal gimbal-r" aria-label="Right stick: pitch and roll"><div class="dot"></div><span>PIT / ROL</span></div>
    <div class="gimbal-readout"></div>`;
}

function fmtStick(v: number): string {
  const n = Math.round(v * 100);
  return `${n >= 0 ? '+' : ''}${n}`.padStart(4, ' ');
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

function drawRateCurves(canvas: HTMLCanvasElement, s: Settings, sticks: Sticks): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  const left = 44;
  const bottom = 22;
  g.clearRect(0, 0, w, h);
  const top = Math.max(200, ...RATE_AXES.map((a) => maxRateFor(s.rates, a)));
  const yMax = Math.ceil(top / 200) * 200;
  const X = (u: number) => left + u * (w - left - 12);
  const Y = (v: number) => h - bottom - (v / yMax) * (h - bottom - 10);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '11px ui-monospace, monospace';
  g.lineWidth = 1;
  for (let v = 0; v <= yMax; v += 200) {
    g.beginPath();
    g.moveTo(left, Y(v));
    g.lineTo(w, Y(v));
    g.stroke();
    g.fillText(String(v), 4, Y(v) + 4);
  }
  g.fillText('stick 0 → 100%', left, h - 5);
  RATE_AXES.forEach((ax, idx) => {
    g.strokeStyle = AXIS_COLORS[ax];
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const y = Y(rateFor(i / 100, s.rates, ax));
      if (i === 0) g.moveTo(X(0), y);
      else g.lineTo(X(i / 100), y);
    }
    g.stroke();
    // Live stick position.
    const st = Math.min(1, Math.abs(sticks[ax]));
    const rate = rateFor(st, s.rates, ax);
    g.fillStyle = AXIS_COLORS[ax];
    g.beginPath();
    g.arc(X(st), Y(rate), 5, 0, Math.PI * 2);
    g.fill();
    g.fillText(`${ax} ${Math.round(rate)}°/s`, w - 120, 16 + idx * 15);
  });
}

function drawThrottleCurve(canvas: HTMLCanvasElement, prof: ControllerProfile, stick: number): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  const pad = 20;
  const X = (u: number) => pad + u * (w - 2 * pad);
  const Y = (v: number) => h - pad - v * (h - 2 * pad);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1;
  g.strokeRect(X(0), Y(1), X(1) - X(0), Y(0) - Y(1));
  g.beginPath();
  g.moveTo(X(0.5), Y(0));
  g.lineTo(X(0.5), Y(1));
  g.stroke();
  // Hover line.
  g.setLineDash([4, 4]);
  g.strokeStyle = 'rgba(255,210,63,0.6)';
  g.beginPath();
  g.moveTo(X(0), Y(HOVER));
  g.lineTo(X(1), Y(HOVER));
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,210,63,0.8)';
  g.font = '11px ui-monospace, monospace';
  g.fillText('hover', X(0) + 4, Y(HOVER) - 4);
  g.strokeStyle = '#ff7a1a';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 100; i++) {
    const y = Y(throttleCurve(i / 100, prof.throttleMid, prof.throttleExpo));
    if (i === 0) g.moveTo(X(0), y);
    else g.lineTo(X(i / 100), y);
  }
  g.stroke();
  const out = throttleCurve(stick, prof.throttleMid, prof.throttleExpo);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(X(stick), Y(out), 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText(`stick ${pct(stick)} → ${pct(out)}`, X(0) + 4, Y(1) + 14);
}

