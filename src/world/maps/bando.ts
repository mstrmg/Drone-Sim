import * as THREE from 'three';
import { HeightfieldCollider } from '../../sim/colliders';
import { Builder } from '../builder';
import { addLights, asphaltTexture, decal, groundMesh, seededRandom, sky, wildGrassTexture, type Field } from '../env';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Center of the flat lot; hills rise beyond ~130 m from here. */
const LOT = { x: 0, z: -40 };

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Rolling hills around a flat industrial lot. */
export function bandoTerrain(x: number, z: number): number {
  const r = Math.hypot(x - LOT.x, z - LOT.z);
  const m = smoothstep(130, 240, r);
  if (m === 0) return 0;
  const hills =
    16 * (0.55 + 0.45 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.7)) +
    6 * Math.sin(x * 0.027 + z * 0.019) +
    2.5 * Math.sin(x * 0.061 - z * 0.047);
  return m * hills;
}

// Palette
const CONCRETE = 0x9a9890;
const CONCRETE_DARK = 0x7d7b74;
const RUST = 0x8a4b2a;
const STEEL = 0x6f7378;
const BRICK = 0x7a3b2e;

/**
 * Freestyle spot: an abandoned factory with a skylight gap and a mezzanine, a three-deck open parking structure
 * with a lightwell, a water tower, a brick chimney, a container yard and power lines over rolling hills.
 */
export function buildBando(maxAnisotropy: number): Field {
  const b = new Builder();
  const group = b.group;
  b.colliders.push(new HeightfieldCollider(bandoTerrain));
  group.add(groundMesh(wildGrassTexture(), maxAnisotropy, 12, 2000, bandoTerrain, 220));
  const asphalt = asphaltTexture();
  asphalt.anisotropy = maxAnisotropy;
  group.add(decal(asphalt, 180, 170, LOT.x, LOT.z, 20));
  group.add(sky());
  const sun = addLights(group);

  factory(b);
  parkingStructure(b);
  waterTower(b, -58, -12);
  chimney(b, 28, -88);
  containerYard(b);
  powerLines(b);
  props(b);
  trees(b);

  b.finish();
  return {
    group,
    colliders: b.colliders,
    spawn: V(0, 0.05, 32),
    spawnYaw: 0,
    sun,
    groundHeight: bandoTerrain,
  };
}

/** Abandoned factory: 44 × 24 m, 11 m tall, windows, big doors, a skylight gap, columns and a mezzanine. */
function factory(b: Builder): void {
  const x0 = -22;
  const x1 = 22;
  const z0 = -62;
  const z1 = -38;
  const H = 11;
  const T = 0.4;
  const win = (a: number): [number, number, number, number] => [a, a + 3, 3.5, 6.5];
  const hiWin = (a: number): [number, number, number, number] => [a, a + 3, 8, 9.8];

  // South wall (facing the spawn): loading door in the middle, two rows of windows.
  b.wall(x0, z1, x1, z1, H, T, CONCRETE, [
    win(2.5), win(8.5), win(14.5), [19, 25, 0, 6], win(28.5), win(34.5), win(40.5),
    hiWin(5.5), hiWin(11.5), hiWin(31.5), hiWin(37.5),
  ]);
  // North wall with a large broken-out hole.
  b.wall(x0, z0, x1, z0, H, T, CONCRETE, [win(2.5), win(8.5), [15, 21, 1.2, 7.5], win(28.5), win(34.5), win(40.5), hiWin(24)]);
  // East and west walls.
  b.wall(x1, z1, x1, z0, H, T, CONCRETE_DARK, [win(2), [9, 15, 0, 6.5], win(19)]);
  b.wall(x0, z0, x0, z1, H, T, CONCRETE_DARK, [win(3), win(10.5), win(18)]);

  // Roof in two halves with a 6 m skylight gap along the length, crossed by trusses.
  b.box(0, H + 0.15, (z0 + -53) / 2, 44.4, 0.3, 9, RUST);
  b.box(0, H + 0.15, (-47 + z1) / 2, 44.4, 0.3, 9, RUST);
  for (let x = -18; x <= 18; x += 6) b.beam(V(x, H - 0.4, -53), V(x, H - 0.4, -47), 0.25, 0.45, STEEL);

  // Interior columns.
  for (const cx of [-11, 0, 11]) for (const cz of [-46, -54]) b.block(cx, cz, 0.6, H, 0.6, CONCRETE_DARK);

  // Mezzanine over the west end, with a railing.
  b.box(-14, 5.15, -56, 16, 0.3, 12, CONCRETE);
  b.beam(V(-6, 6.1, -62), V(-6, 6.1, -50), 0.08, 0.08, STEEL);
  b.beam(V(-22, 6.1, -50), V(-6, 6.1, -50), 0.08, 0.08, STEEL);

  // Junk inside: crates, a collapsed girder, an old press.
  b.block(8, -58, 2, 1.5, 1.6, 0x6b5a3a, 0.3);
  b.block(10.4, -57.2, 1.6, 1.2, 1.4, 0x6b5a3a, -0.2);
  b.block(15, -44, 3, 2.8, 4, 0x4f5d4f);
  b.beam(V(3, 0.2, -42), V(7, 4.5, -49), 0.3, 0.5, RUST);
}

/** Three-deck open parking structure with parapets, a lightwell and a stair tower. */
function parkingStructure(b: Builder): void {
  const x0 = 50;
  const x1 = 80;
  const z0 = -52;
  const z1 = -8;
  const hole = { x0: 62, x1: 68, z0: -34, z1: -26 };
  const levels = [3.2, 6.4, 9.6];
  const th = 0.35;
  for (const y of levels) {
    const yc = y - th / 2;
    // Deck in four pieces around the lightwell.
    b.box((x0 + x1) / 2, yc, (z0 + hole.z0) / 2, x1 - x0, th, hole.z0 - z0, CONCRETE);
    b.box((x0 + x1) / 2, yc, (hole.z1 + z1) / 2, x1 - x0, th, z1 - hole.z1, CONCRETE);
    b.box((x0 + hole.x0) / 2, yc, (hole.z0 + hole.z1) / 2, hole.x0 - x0, th, hole.z1 - hole.z0, CONCRETE);
    b.box((hole.x1 + x1) / 2, yc, (hole.z0 + hole.z1) / 2, x1 - hole.x1, th, hole.z1 - hole.z0, CONCRETE);
    // Parapets along the long sides; the short ends stay open to fly through.
    b.box(x0 + 0.15, y + 0.5, (z0 + z1) / 2, 0.3, 1, z1 - z0, CONCRETE_DARK);
    b.box(x1 - 0.15, y + 0.5, (z0 + z1) / 2, 0.3, 1, z1 - z0, CONCRETE_DARK);
  }
  for (const cx of [50.4, 57.5, 72.5, 79.6]) {
    for (const cz of [-51.6, -41, -30, -19, -8.4]) b.block(cx, cz, 0.5, 9.6, 0.5, CONCRETE_DARK);
  }
  // Stair tower on the corner.
  b.block(83, -10, 5, 12.5, 5, 0xa49f92);
  // Faded level signs.
  b.box(65, 1.6, -7.9, 3, 0.8, 0.05, 0x2f5d8a, 0, false);
}

/** Water tower: four legs with cross bracing, a tank and a cone roof. */
function waterTower(b: Builder, cx: number, cz: number): void {
  const legH = 18;
  const s = 3.5;
  const legs = [V(cx - s, 0, cz - s), V(cx + s, 0, cz - s), V(cx + s, 0, cz + s), V(cx - s, 0, cz + s)];
  for (const l of legs) b.cylinder(l.x, l.z, 0, legH + 0.5, 0.3, STEEL, 10);
  for (let i = 0; i < 4; i++) {
    const a = legs[i];
    const c = legs[(i + 1) % 4];
    for (const [y0, y1] of [
      [2, 9],
      [9, 16],
    ]) {
      b.beam(V(a.x, y0, a.z), V(c.x, y1, c.z), 0.12, 0.12, STEEL);
      b.beam(V(a.x, y1, a.z), V(c.x, y0, c.z), 0.12, 0.12, STEEL);
    }
    b.beam(V(a.x, 9, a.z), V(c.x, 9, c.z), 0.2, 0.2, STEEL);
  }
  b.cylinder(cx, cz, legH, legH + 6, 5, 0xb9b6a8, 28);
  b.cylinder(cx, cz, legH - 0.3, legH, 5.4, STEEL, 28); // walkway ring
  b.cone(cx, cz, legH + 6, 2.6, 5.3, 0x8c8a80, 28);
}

function chimney(b: Builder, x: number, z: number): void {
  b.cylinder(x, z, 0, 38, 1.8, BRICK, 20);
  b.cylinder(x, z, 36, 37, 2.1, 0x5c2b22, 20);
  b.block(x, z + 4, 6, 4, 5, BRICK); // boiler house at the base
}

function containerYard(b: Builder): void {
  // Two rows of stacks with a narrow gap between them, plus a leaning one.
  b.container(-48, 0, -78, 0, 0x9c3a26);
  b.container(-44.2, 0, -78, 0, 0x2d5f8a); // 1.36 m gap
  b.container(-48, 2.6, -78, 0, 0x2f7d4a);
  b.container(-36, 0, -82, 0, 0xb48a2c);
  b.container(-36, 2.6, -82, 0, 0x9c3a26);
  b.container(-36, 5.2, -82, 0, 0x2d5f8a);
  b.container(-58, 0, -95, Math.PI / 2, 0x707070);
  b.container(-58, 2.6, -95, Math.PI / 2 + 0.08, 0xb48a2c);
  const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0.28));
  b.box(-30, 1.9, -100, 2.44, 2.6, 12.2, 0x2f7d4a, lean);
}

/** A line of pylons across the north hills, with sagging cables that are solid. */
function powerLines(b: Builder): void {
  const z = -150;
  const xs = [-245, -175, -105, -35, 35, 105, 175, 245];
  const armYs = [19, 23];
  const tips: THREE.Vector3[][] = [];
  for (const x of xs) {
    const g = bandoTerrain(x, z);
    b.box(x, g + 13, z, 1.4, 26, 1.4, STEEL);
    b.box(x, g + 2, z, 3.2, 4, 3.2, STEEL); // splayed base
    for (const ay of armYs) b.box(x, g + ay, z, 11, 0.5, 0.6, STEEL);
    tips.push([V(x - 5, g + 22.5, z), V(x + 5, g + 22.5, z), V(x - 5, g + 18.5, z), V(x + 5, g + 18.5, z)]);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = tips[i][k];
      const c = tips[i + 1][k];
      const sag = 3.5;
      const segs = 6;
      let prev = a;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const p = a.clone().lerp(c, t);
        p.y -= sag * 4 * t * (1 - t);
        b.beam(prev, p, 0.06, 0.06, 0x222222);
        prev = p;
      }
    }
  }
}

/** Smaller props around the lot for proximity lines. */
function props(b: Builder): void {
  // Jersey barriers along the lot edge.
  for (let i = 0; i < 9; i++) b.block(-30 + i * 3.4, 12, 3.2, 0.9, 0.6, 0xb7b3a8, 0.05 * (i % 3));
  // Abandoned bus.
  b.block(22, -8, 2.6, 3, 11, 0xc9a227, 0.5);
  // Rusted car.
  b.block(-12, -14, 1.8, 1.4, 4.2, 0x7a4a3a, -0.8);
  // Loading dock ramp up to the factory door.
  const ramp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, 0));
  b.box(0, 0.5, -33.5, 6, 0.4, 8, CONCRETE_DARK, ramp);
  // Light poles around the lot.
  for (const [x, z] of [
    [-40, 5],
    [40, 5],
    [-40, -110],
    [40, -110],
    [90, -60],
    [-90, -60],
  ]) {
    b.cylinder(x, z, 0, 10, 0.15, STEEL, 8);
    b.box(x, 10, z, 1.6, 0.25, 0.5, 0x333333);
  }
  // A billboard on legs to gap under.
  b.cylinder(-80, -10, 0, 7, 0.25, STEEL, 8);
  b.cylinder(-72, -10, 0, 7, 0.25, STEEL, 8);
  b.box(-76, 9, -10, 12, 4, 0.3, 0xd8d2c0);
  // Pallet stacks.
  for (const [x, z] of [
    [12, -30],
    [-20, -28],
    [30, -66],
  ])
    b.block(x, z, 1.2, 1.1, 1.0, 0x9a7b4f);
}

function trees(b: Builder): void {
  const rnd = seededRandom(4242);
  // Woods on the hills all around.
  let placed = 0;
  for (let i = 0; i < 900 && placed < 260; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 140 + rnd() * 220;
    const x = LOT.x + Math.cos(ang) * dist;
    const z = LOT.z + Math.sin(ang) * dist;
    if (Math.abs(z + 150) < 8) continue; // keep the power line corridor clear
    const g = bandoTerrain(x, z);
    const s = 0.8 + rnd() * 0.8;
    if (rnd() < 0.55) b.tree(x, z, s, g);
    else b.bushyTree(x, z, s, g, rnd() < 0.5 ? 0x3f6b2e : 0x56782f);
    placed++;
  }
  // A tree line along the west side of the lot and a tight cluster to weave through.
  for (let i = 0; i < 8; i++) b.bushyTree(-95, 10 - i * 14, 1 + rnd() * 0.3);
  b.tree(32, 6, 1.1);
  b.tree(36, 9, 0.9);
  b.tree(34, 13, 1.2);
  b.bushyTree(-28, -118, 1.2);
  b.bushyTree(-20, -122, 1.0);
}
