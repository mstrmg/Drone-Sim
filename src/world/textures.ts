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

function blotches(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, n: number, color: string, minR: number, maxR: number): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, minR + rnd() * (maxR - minR), minR + rnd() * (maxR - minR), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
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

/** Railway ballast and loose gravel: packed grey-brown stones. One tile is 3 m. */
export function gravelTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    512,
    (g, rnd, w, h) => {
      g.fillStyle = '#6b665e';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7000; i++) {
        const v = 80 + rnd() * 90;
        const warm = rnd() * 18;
        g.fillStyle = `rgb(${v + warm},${v + warm * 0.5},${v - 4})`;
        g.beginPath();
        const r = 2 + rnd() * 5;
        g.ellipse(rnd() * w, rnd() * h, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(30,28,25,0.35)';
        g.lineWidth = 1;
        g.stroke();
      }
      blotches(g, rnd, w, h, 30, 'rgba(70,55,40,0.2)', 10, 40); // rust and oil
    },
    71,
  );
}

/** Normal map of corrugated sheet: `waves` ridges across one tile, running along v. Linear data, not colour. */
export function corrugationNormal(waves = 12): THREE.CanvasTexture {
  return canvasTexture(
    256,
    4,
    (g, _rnd, w, h) => {
      const img = g.createImageData(w, h);
      for (let x = 0; x < w; x++) {
        const slope = -Math.cos((2 * Math.PI * waves * x) / w) * 0.9;
        const len = Math.hypot(slope, 1);
        const nx = slope / len;
        const nz = 1 / len;
        for (let y = 0; y < h; y++) {
          const k = (y * w + x) * 4;
          img.data[k] = (nx * 0.5 + 0.5) * 255;
          img.data[k + 1] = 128;
          img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
          img.data[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    1,
    false,
  );
}
