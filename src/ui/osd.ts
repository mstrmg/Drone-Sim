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
}

export class Osd {
  private readonly el: HTMLElement;
  private readonly f: Record<string, HTMLElement> = {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'osd';
    this.el.innerHTML = `
      <div class="osd-tl"><span data-f="mode"></span><span data-f="air"></span></div>
      <div class="osd-tr"><span data-f="time"></span></div>
      <div class="osd-center"><div class="osd-cross"></div></div>
      <div class="osd-msg" data-f="msg"></div>
      <div class="osd-warn" data-f="warn"></div>
      <div class="osd-bl"><div data-f="thr"></div><div data-f="spd"></div><div data-f="alt"></div></div>
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
    let msg = '';
    if (s.crashed) msg = 'CRASHED · PRESS RESET';
    else if (!s.armed) msg = 'DISARMED';
    this.f.msg.textContent = msg;
    this.f.msg.classList.toggle('blink', s.crashed);
    this.f.warn.textContent = s.warning;
    this.el.querySelector('.osd-center')!.classList.toggle('hidden', s.chase);
  }
}
