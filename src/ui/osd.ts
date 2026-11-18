/** Minimal Betaflight-style on-screen display drawn with HTML on top of the canvas. */
export interface OsdState {
  armed: boolean;
  crashed: boolean;
  throttle: number;
  flightTime: number;
  mode: string;
  airmode: boolean;
  speedKmh: number;
  altitude: number;
  source: string;
  warning: string;
  chase: boolean;
  /** Pack voltage, cell count and mAh drawn, or null when battery sag is off. */
  battery: { voltage: number; cells: number; mah: number } | null;
  /** Prop health 0..1 per motor, or null when damage is off. */
  props: number[] | null;
  /** 'pending' = turtle selected while disarmed, 'active' = flipping. */
  turtle: 'off' | 'pending' | 'active';
  propsBroken: boolean;
}

export class Osd {
  private readonly el: HTMLElement;
  private readonly f: Record<string, HTMLElement> = {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'osd';
    this.el.innerHTML = `
      <div class="osd-tl"><span data-f="mode"></span><span data-f="air"></span></div>
      <div class="osd-tr"><div data-f="time"></div><div data-f="props"></div></div>
      <div class="osd-center"><div class="osd-cross"></div></div>
      <div class="osd-msg" data-f="msg"></div>
      <div class="osd-warn" data-f="warn"></div>
      <div class="osd-bl"><div data-f="bat"></div><div data-f="thr"></div><div data-f="spd"></div><div data-f="alt"></div></div>
      <div class="osd-br"><div data-f="src"></div><div class="osd-hint">Esc menu · H help</div></div>`;
    this.el.querySelectorAll<HTMLElement>('[data-f]').forEach((n) => (this.f[n.dataset.f!] = n));
    parent.appendChild(this.el);
  }

  update(s: OsdState): void {
    const t = s.flightTime;
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = (t % 60).toFixed(1).padStart(4, '0');
    this.f.mode.textContent = s.mode.toUpperCase();
    this.f.air.textContent = s.airmode ? ' AIR' : '';
    this.f.time.textContent = `⏱ ${mm}:${ss}`;
    this.f.thr.textContent = `THR ${Math.round(s.throttle * 100).toString().padStart(3, ' ')}%`;
    this.f.spd.textContent = `${Math.round(s.speedKmh).toString().padStart(3, ' ')} KM/H`;
    this.f.alt.textContent = `ALT ${s.altitude.toFixed(1)} M`;
    this.f.src.textContent = s.source + (s.chase ? ' · CHASE' : '');
    if (s.battery) {
      const cell = s.battery.voltage / s.battery.cells;
      this.f.bat.textContent = `${s.battery.voltage.toFixed(1)}V ${Math.round(s.battery.mah).toString().padStart(4, ' ')}MAH`;
      this.f.bat.classList.toggle('osd-low', cell < 3.5);
    } else this.f.bat.textContent = '';
    if (s.props && s.props.some((h) => h < 0.999)) {
      // Motor order on screen: front left, front right / rear left, rear right.
      const p = (i: number) => (s.props![i] < 0.15 ? 'XX' : Math.round(s.props![i] * 99).toString().padStart(2, '0'));
      this.f.props.textContent = `PROPS ${p(3)} ${p(1)} ${p(2)} ${p(0)}`;
    } else this.f.props.textContent = '';
    let msg = '';
    if (s.crashed) msg = 'CRASHED · PRESS RESET';
    else if (s.turtle === 'active') msg = 'TURTLE';
    else if (s.turtle === 'pending') msg = 'TURTLE · ARM, THEN PUSH A STICK TO FLIP';
    else if (s.propsBroken) msg = 'PROPS BROKEN · PRESS RESET';
    else if (!s.armed) msg = 'DISARMED';
    this.f.msg.textContent = msg;
    this.f.msg.classList.toggle('blink', s.crashed || s.propsBroken || s.turtle !== 'off');
    this.f.warn.textContent = s.warning;
    this.el.querySelector('.osd-center')!.classList.toggle('hidden', s.chase);
  }
}
