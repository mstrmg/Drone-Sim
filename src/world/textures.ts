import * as THREE from 'three';
import { seededRandom } from './rand';

/**
 * Procedural canvas textures. Everything is generated at load time, so the build stays a single bundle with no
 * image files to fetch.
 */

type Draw = (g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number) => void;

export function canvasTexture(w: number, h: number, draw: Draw, seed = 7, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, seededRandom(seed), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, rgb: [number, number, number], spread: number, alpha: number, size = 2): void {
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * spread;
    g.fillStyle = `rgba(${rgb[0] + v},${rgb[1] + v},${rgb[2] + v},${alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * size, 1 + rnd() * size);
  }
}

function blotches(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, color: string, minR: number, maxR: number): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, minR + rnd() * (maxR - minR), minR + rnd() * (maxR - minR), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
}

/** Water streaks running down from the top of a panel. */
function streaks(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, color: string): void {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const len = h * (0.2 + rnd() * 0.7);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 2 + rnd() * 10, len);
  }
}

/** Board-formed concrete: grey noise, stains, form-panel seams and tie holes. One tile is 4 m. */
export function concreteTexture(seed = 3): THREE.CanvasTexture {
  return canvasTexture(
    512,
    512,
    (g, rnd, w, h) => {
      g.fillStyle = '#b9b6ae';
      g.fillRect(0, 0, w, h);
      blotches(g, rnd, w, h, 60, 'rgba(120,115,105,0.08)', 20, 90);
      blotches(g, rnd, w, h, 40, 'rgba(230,228,220,0.08)', 15, 70);
      speckle(g, rnd, w, h, 30000, [170, 167, 160], 60, 0.35, 2);
      streaks(g, rnd, w, h, 26, 'rgba(70,65,55,0.22)');
      // Form panel seams every 1 m (128 px) and tie holes.
      g.fillStyle = 'rgba(80,78,72,0.35)';
      for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 2);
      for (let x = 0; x < w; x += 256) g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(50,48,44,0.55)';
      for (let y = 32; y < h; y += 64) for (let x = 32; x < w; x += 128) g.fillRect(x - 2, y - 2, 5, 5);
      // Cracks.
      g.strokeStyle = 'rgba(40,38,34,0.45)';
      g.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        let x = rnd() * w;
        let y = rnd() * h;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 10; k++) {
          x += (rnd() - 0.5) * 30;
          y += rnd() * 22;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    },
    seed,
  );
}

/** Weathered red brick with mortar lines. One tile is 2.4 m. */
export function brickTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    512,
    (g, rnd, w, h) => {
      g.fillStyle = '#8c8578';
      g.fillRect(0, 0, w, h);
      const bh = 16; // 7.5 cm courses at 2.4 m / 512 px
      const bw = 48;
      for (let row = 0; row * bh < h; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < w + bw; x += bw) {
          const r = 120 + rnd() * 50;
          const gg = 50 + rnd() * 25;
          const b = 38 + rnd() * 20;
          g.fillStyle = `rgb(${r},${gg},${b})`;
          g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        }
      }
      speckle(g, rnd, w, h, 15000, [90, 60, 50], 50, 0.25, 2);
      streaks(g, rnd, w, h, 20, 'rgba(30,25,20,0.25)');
      blotches(g, rnd, w, h, 20, 'rgba(40,40,40,0.12)', 30, 90); // soot
    },
    5,
  );
}

/** Corrugated sheet metal, greyscale so a material color can tint it. One tile is 2 m. */
export function corrugatedTexture(rusty: boolean, seed = 9): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (g, rnd, w, h) => {
      for (let x = 0; x < w; x++) {
        const s = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 14);
        const v = 150 + s * 90;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, 0, 1, h);
      }
      speckle(g, rnd, w, h, 4000, [120, 120, 120], 60, 0.2, 2);
      if (rusty) {
        blotches(g, rnd, w, h, 30, 'rgba(140,70,30,0.35)', 6, 30);
        streaks(g, rnd, w, h, 30, 'rgba(120,55,20,0.45)');
      } else {
        streaks(g, rnd, w, h, 14, 'rgba(60,55,50,0.25)');
      }
      // Panel seam.
      g.fillStyle = 'rgba(30,30,30,0.5)';
      g.fillRect(0, h - 3, w, 3);
    },
    seed,
  );
}

/** Rusted steel plate. One tile is 1.5 m. */
export function rustTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (g, rnd, w, h) => {
      g.fillStyle = '#7a4326';
      g.fillRect(0, 0, w, h);
      blotches(g, rnd, w, h, 50, 'rgba(160,90,40,0.3)', 5, 30);
      blotches(g, rnd, w, h, 40, 'rgba(50,30,20,0.3)', 5, 25);
      speckle(g, rnd, w, h, 8000, [110, 60, 35], 70, 0.4, 2);
    },
    13,
  );
}

/** Grey weathered wood planks. One tile is 1.5 m. */
export function woodTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (g, rnd, w, h) => {
      const pw = 32;
      for (let x = 0; x < w; x += pw) {
        const v = 110 + rnd() * 40;
        g.fillStyle = `rgb(${v},${v * 0.9},${v * 0.75})`;
        g.fillRect(x, 0, pw - 2, h);
        g.strokeStyle = 'rgba(60,50,40,0.25)';
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          const gx = x + 3 + rnd() * (pw - 8);
          g.moveTo(gx, 0);
          g.bezierCurveTo(gx + 4, h * 0.3, gx - 4, h * 0.6, gx + 2, h);
          g.stroke();
        }
      }
      g.fillStyle = 'rgba(30,25,20,0.8)';
      for (let x = 0; x < w; x += pw) g.fillRect(x + pw - 2, 0, 2, h);
    },
    17,
  );
}

/** Weathered asphalt with cracks, patches and faded parking lines. One tile is 20 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(
    1024,
    1024,
    (g, rnd, w, h) => {
      g.fillStyle = '#525357';
      g.fillRect(0, 0, w, h);
      blotches(g, rnd, w, h, 40, 'rgba(70,72,76,0.35)', 30, 140); // patch repairs
      blotches(g, rnd, w, h, 25, 'rgba(25,25,28,0.25)', 10, 50); // oil stains
      speckle(g, rnd, w, h, 90000, [88, 89, 93], 60, 0.5, 2);
      g.strokeStyle = 'rgba(25,25,25,0.6)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) {
        let x = rnd() * w;
        let y = rnd() * h;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 10; k++) {
          x += (rnd() - 0.5) * 60;
          y += (rnd() - 0.5) * 60;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      // Faded parking bays: 2.5 m wide, 5 m deep.
      g.fillStyle = 'rgba(225,222,205,0.2)';
      for (let i = 0; i < 8; i++) g.fillRect(i * 128 + 2, 0, 5, 256);
      g.fillRect(0, 256, w, 5);
      for (let i = 0; i < 8; i++) g.fillRect(i * 128 + 2, 768, 5, 256);
      g.fillRect(0, 768, w, 5);
      // Weeds in cracks.
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `rgba(${60 + rnd() * 30},${90 + rnd() * 30},40,${0.3 + rnd() * 0.4})`;
        g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 6, 3 + rnd() * 6);
      }
    },
    23,
  );
}

/** Grass with soft variation. Tinted further by ground vertex colors. One tile is 10 m. */
export function grassTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    512,
    (g, rnd, w, h) => {
      g.fillStyle = '#6f8f47';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 30000; i++) {
        const v = (rnd() - 0.5) * 60;
        g.fillStyle = `rgba(${90 + v},${125 + v},${55 + v / 2},0.5)`;
        const x = rnd() * w;
        const y = rnd() * h;
        g.fillRect(x, y, 1.5, 3 + rnd() * 4); // blade-ish strokes
      }
      blotches(g, rnd, w, h, 60, 'rgba(140,120,70,0.12)', 6, 26);
      blotches(g, rnd, w, h, 40, 'rgba(40,70,30,0.12)', 10, 40);
    },
    11,
  );
}

/** Grass blades with transparency, for instanced tufts. */
export function tuftTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    128,
    (g, rnd, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        const x = 10 + rnd() * (w - 20);
        const top = h * (0.05 + rnd() * 0.45);
        const lean = (rnd() - 0.5) * 30;
        const v = rnd() * 40;
        g.strokeStyle = `rgb(${90 + v},${120 + v},${50 + v / 2})`;
        g.lineWidth = 2 + rnd() * 2;
        g.beginPath();
        g.moveTo(x, h);
        g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top);
        g.stroke();
      }
    },
    29,
  );
}

const TAGS = ['SEND IT', 'FPV', 'BANDO', 'RIP PROPS', 'GAP IT', 'DIVE', 'PROPS OUT', 'ACRO', 'NO LOS', 'YAW SPIN', 'SPLIT S', 'FLOW'];
const TAG_COLORS = ['#ff4f7b', '#ffd23f', '#3ad1ff', '#7cff6b', '#ff8a1f', '#c27bff', '#ffffff'];

/** Draws one graffiti piece into a w × h cell: a bold tag with outline and drop shadow, and drips. */
function drawTag(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, text: string): void {
  const fill = TAG_COLORS[Math.floor(rnd() * TAG_COLORS.length)];
  let outline = TAG_COLORS[Math.floor(rnd() * TAG_COLORS.length)];
  if (outline === fill) outline = '#111111';
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((rnd() - 0.5) * 0.25);
  g.transform(1, 0, (rnd() - 0.5) * 0.5, 1, 0, 0);
  const size = Math.min(h * 0.6, (w * 1.6) / text.length);
  g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillText(text, size * 0.05, size * 0.05);
  g.lineWidth = size * 0.1;
  g.strokeStyle = outline;
  g.strokeText(text, 0, 0);
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.lineWidth = Math.max(2, size * 0.02);
  g.strokeStyle = '#111';
  g.strokeText(text, 0, 0);
  g.restore();
  g.fillStyle = fill;
  for (let i = 0; i < 8; i++) {
    const x = w * 0.15 + rnd() * w * 0.7;
    const y = h * 0.6 + rnd() * h * 0.1;
    g.fillRect(x, y, 3, h * (0.08 + rnd() * 0.2));
  }
}

/** Number of graffiti pieces in the atlas, laid out in 2 columns of 512 × 256 cells. */
export const GRAFFITI_CELLS = 12;

/** All graffiti pieces in one transparent texture, so every tag on the map shares one material. */
export function graffitiAtlas(): THREE.CanvasTexture {
  const tex = canvasTexture(
    1024,
    256 * (GRAFFITI_CELLS / 2),
    (g, rnd) => {
      g.clearRect(0, 0, g.canvas.width, g.canvas.height);
      for (let i = 0; i < GRAFFITI_CELLS; i++) {
        g.save();
        g.translate((i % 2) * 512, Math.floor(i / 2) * 256);
        g.beginPath();
        g.rect(0, 0, 512, 256);
        g.clip();
        drawTag(g, rnd, 512, 256, TAGS[i % TAGS.length]);
        g.restore();
      }
    },
    41,
  );
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Soft round shadow blob for contact shadows under props. */
export function blobTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    128,
    (g, _rnd, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.45)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    },
    1,
  );
}
