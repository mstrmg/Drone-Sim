import * as THREE from 'three';
import { CylinderCollider, HeightfieldCollider } from '../../sim/colliders';
import { Builder } from '../builder';
import { addLights, decal, groundMesh, makeSky, type Field } from '../env';
import { industrialMaterials, type IndustrialMaterials } from '../materials';
import { fbm2, seededRandom, smoothstep } from '../rand';
import { GRAFFITI_CELLS, graffitiAtlas, grassTexture, tuftTexture } from '../textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

/** Center of the flat lot; hills rise beyond ~130 m from here. */
const LOT = { x: 0, z: -40 };
/** Asphalt rectangle of the lot. */
const LOT_RECT = { x0: -90, x1: 90, z0: -125, z1: 45 };
/** Rail line west of the lot, running along z. */
const RAIL_X = -112;
const SIDING_X = -117;
/** Highway overpass south of the spawn, running along x. */
const OVERPASS_Z = 70;
const DECK_TOP = 9;

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

type M = IndustrialMaterials & {
  graffiti: THREE.MeshStandardMaterial;
  rackOrange: THREE.MeshStandardMaterial;
  signGreen: THREE.MeshStandardMaterial;
  pineDark: THREE.MeshStandardMaterial;
  pineLight: THREE.MeshStandardMaterial;
  leafGreen: THREE.MeshStandardMaterial;
  leafOlive: THREE.MeshStandardMaterial;
  leafAutumn: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
};

/**
 * Freestyle spot: an abandoned brick factory with a skylight gap, catwalk and scaffolding, a second warehouse joined
 * to it by a skybridge, a three-deck parking structure, a tower crane, grain silos with a conveyor gallery, a pipe
 * rack, a container yard, a rail yard with parked freight cars, a highway overpass, a water tower, a chimney and
 * power lines over rolling hills.
 */
export function buildBando(maxAnisotropy: number): Field {
  const b = new Builder();
  const group = b.group;
  const base = industrialMaterials(maxAnisotropy);
  const color = (c: number, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color: c, roughness, metalness });
  const graffiti = new THREE.MeshStandardMaterial({
    map: graffitiAtlas(),
    alphaTest: 0.45,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m: M = {
    ...base,
    graffiti,
    rackOrange: color(0xd9661f, 0.6, 0.3),
    signGreen: color(0x1f6b3a, 0.5, 0.2),
    pineDark: color(0x2b4a26, 0.95),
    pineLight: color(0x3d5f2c, 0.95),
    leafGreen: color(0x4e7a31, 0.9),
    leafOlive: color(0x6b8434, 0.9),
    leafAutumn: color(0xa07a2c, 0.9),
    bark: color(0x5a4532, 0.95),
  };
  b.noShadowFor(graffiti);

  // Sun low in the south-east, behind the pilot at spawn, for long shadows across the lot.
  const sunDir = V(0.62, 0.5, 0.6).normalize();
  const sky = makeSky({ sunDir, top: 0x3f7cc4, horizon: 0xd3dfe8, ground: 0x9aa48c, sunColor: 0xffe6c4, cloudCover: 0.5 });
  group.add(sky.mesh);
  const sun = addLights(group, sunDir, {
    sunColor: 0xffe3c0,
    sunIntensity: 2.7,
    skyColor: 0xc4dbf5,
    groundColor: 0x7a7258,
    hemi: 0.75,
    ambient: 0.25,
    shadowSize: 4096,
    shadowRange: 80,
  });

  b.colliders.push(new HeightfieldCollider(bandoTerrain));
  group.add(ground(maxAnisotropy));
  surfaces(group, m);

  factory(b, m);
  warehouse(b, m);
  skybridge(b, m);
  parkingStructure(b, m);
  towerCrane(b, m, 38, -70);
  silos(b, m);
  pipeRack(b, m);
  waterTower(b, m, -58, -12);
  chimney(b, m, 28, -88);
  containerYard(b, m);
  railYard(b, m);
  overpass(b, m);
  powerLines(b, m);
  props(b, m);
  graffitiTags(b, m);
  trees(b, m);
  vegetation(group, b, maxAnisotropy);

  b.finish();
  return {
    group,
    colliders: b.colliders,
    spawn: V(0, 0.05, 32),
    spawnYaw: 0,
    sun,
    sunDir,
    sky,
    fog: new THREE.FogExp2(sky.horizon.getHex(), 0.0021),
    groundHeight: bandoTerrain,
  };
}

// ---------------------------------------------------------------- Ground

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** Dirt tracks worn into the grass. */
const PATHS: [number, number][][] = [
  [
    [10, -125],
    [25, -170],
    [10, -215],
    [35, -270],
  ],
  [
    [90, -30],
    [140, -15],
    [190, 25],
    [240, 30],
  ],
  [
    [-90, -60],
    [RAIL_X, -62],
    [-150, -90],
    [-200, -80],
  ],
  [
    [-60, 45],
    [-90, 62],
  ],
];

function pathDistance(x: number, z: number): number {
  let d = Infinity;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, distToSegment(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  return d;
}

function lotDistance(x: number, z: number): number {
  const dx = Math.max(LOT_RECT.x0 - x, 0, x - LOT_RECT.x1);
  const dz = Math.max(LOT_RECT.z0 - z, 0, z - LOT_RECT.z1);
  return Math.hypot(dx, dz);
}

const mix3 = (a: number[], c: number[], t: number): [number, number, number] => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
const DRY = [1.28, 1.08, 0.78];
const LUSH = [0.72, 0.88, 0.7];
const DIRT = [1.3, 0.8, 1.15];
const ROCK = [1.25, 1.0, 1.65];

/** Vertex tint multiplied over the grass texture: dry and lush patches, worn dirt and rocky slopes. */
function groundTint(x: number, z: number, _y: number, slope: number): [number, number, number] {
  let c = mix3([1, 1, 1], DRY, smoothstep(0.45, 0.72, fbm2(x * 0.018, z * 0.018)));
  c = mix3(c, LUSH, 0.6 * smoothstep(0.55, 0.8, fbm2(x * 0.045 + 7, z * 0.045 - 3)));
  const edge = smoothstep(9, 0, lotDistance(x, z)) * (0.6 + 0.4 * fbm2(x * 0.3, z * 0.3));
  const path = smoothstep(3.2, 1.0, pathDistance(x, z) + (fbm2(x * 0.2, z * 0.2) - 0.5) * 2);
  const patch = 0.8 * smoothstep(0.7, 0.8, fbm2(x * 0.035 + 11, z * 0.035 + 5));
  const rail = smoothstep(7, 3, Math.abs(x - (RAIL_X + SIDING_X) / 2)) * (z > -132 && z < 48 ? 1 : 0);
  c = mix3(c, DIRT, Math.min(1, Math.max(edge, path, patch, rail * 0.8)));
  return mix3(c, ROCK, smoothstep(0.03, 0.09, slope));
}

function ground(maxAnisotropy: number): THREE.Mesh {
  return groundMesh(grassTexture(), maxAnisotropy, 10, 2000, bandoTerrain, 200, groundTint);
}

/** Asphalt, road and ballast surfaces lying on the ground. */
function surfaces(group: THREE.Group, m: M): void {
  const lot = decal(m.road.map!, LOT_RECT.x1 - LOT_RECT.x0, LOT_RECT.z1 - LOT_RECT.z0, (LOT_RECT.x0 + LOT_RECT.x1) / 2, (LOT_RECT.z0 + LOT_RECT.z1) / 2, 20);
  const road = decal(m.road.map!, 180, 12, 0, OVERPASS_Z, 20, 0.012);
  const access = decal(m.road.map!, 10, 20, 0, 55, 20, 0.011);
  group.add(lot, road, access);
  for (const [x, w] of [
    [RAIL_X, 4.6],
    [SIDING_X, 4.2],
  ]) {
    const ballast = decal(m.concreteDark.map!, w, 172, x, -42, 3, 0.02, 0, 1);
    (ballast.material as THREE.MeshStandardMaterial).color.set(0x8d8478);
    group.add(ballast);
  }
}

// ---------------------------------------------------------------- Buildings

/** Abandoned brick factory: 44 × 24 m, 11 m tall, windows, big doors, a skylight gap, catwalk, mezzanine. */
function factory(b: Builder, m: M): void {
  const x0 = -22;
  const x1 = 22;
  const z0 = -62;
  const z1 = -38;
  const H = 11;
  const T = 0.4;
  const win = (a: number): [number, number, number, number] => [a, a + 3, 3.5, 6.5];
  const hiWin = (a: number): [number, number, number, number] => [a, a + 3, 8, 9.8];

  // South wall (facing the spawn): loading door in the middle, two rows of windows.
  const south = [win(2.5), win(8.5), win(14.5), [19, 25, 0, 6] as [number, number, number, number], win(28.5), win(34.5), win(40.5), hiWin(5.5), hiWin(11.5), hiWin(31.5), hiWin(37.5)];
  b.wall(x0, z1, x1, z1, H, T, m.brick, south);
  // North wall with a large broken-out hole.
  const north = [win(2.5), win(8.5), [15, 21, 1.2, 7.5] as [number, number, number, number], win(28.5), win(34.5), win(40.5), hiWin(24)];
  b.wall(x0, z0, x1, z0, H, T, m.brick, north);
  // East wall with a roller-door opening; west wall with the skybridge door onto the mezzanine.
  b.wall(x1, z1, x1, z0, H, T, m.concreteWarm, [win(2), [9, 15, 0, 6.5], win(19)]);
  b.wall(x0, z0, x0, z1, H, T, m.concreteWarm, [[4.5, 9.5, 5.3, 8.6], win(13), win(18.5)]);
  // Window sills on the brick walls.
  for (const [a, , y0] of south.filter((o) => o[2] > 0)) b.box(x0 + a + 1.5, y0 - 0.08, z1 + 0.3, 3.3, 0.16, 0.3, m.concrete);
  // Concrete plinth and cornice bands.
  b.box(0, 0.4, z1 + 0.05, 44.6, 0.8, 0.55, m.concreteDark, 0, false);
  b.box(0, 0.4, z0 - 0.05, 44.6, 0.8, 0.55, m.concreteDark, 0, false);

  // Roof in two halves with a 6 m skylight gap along the length, crossed by trusses; parapets around the edge.
  b.box(0, H + 0.15, (z0 + -53) / 2, 44.4, 0.3, 9, m.sheetRust);
  b.box(0, H + 0.15, (-47 + z1) / 2, 44.4, 0.3, 9, m.sheetRust);
  b.box(0, H + 0.5, z1, 44.4, 1, 0.45, m.concrete);
  b.box(0, H + 0.5, z0, 44.4, 1, 0.45, m.concrete);
  for (const x of [x0, x1]) for (const [za, zb] of [[z0, -53], [-47, z1]]) b.box(x, H + 0.5, (za + zb) / 2, 0.45, 1, zb - za, m.concrete);
  for (let x = -18; x <= 18; x += 6) {
    b.beam(V(x, H - 0.4, -53.2), V(x, H - 0.4, -46.8), 0.25, 0.45, m.steel);
    b.beam(V(x, H - 0.75, -50), V(x, H - 0.1, -53.1), 0.1, 0.1, m.steel); // truss diagonals
    b.beam(V(x, H - 0.75, -50), V(x, H - 0.1, -46.9), 0.1, 0.1, m.steel);
  }

  // Roof clutter: HVAC units, vents, an access hut and a sign on legs with a gap underneath.
  const top = H + 0.3;
  for (const [x, z] of [
    [-15, -58],
    [4, -59],
    [13, -42.5],
    [-6, -42],
  ])
    b.block(x, z, 2.6, 1.6, 1.8, m.sheetGrey, 0, top);
  for (const [x, z] of [
    [-10, -60],
    [-9, -57],
    [9, -56.5],
    [17, -43],
  ])
    b.cylinder(x, z, top, top + 1.3, 0.35, m.steel, 10);
  b.block(18, -58.5, 3, 2.6, 3, m.concreteWarm, 0, top);
  for (const x of [-7, 0, 7]) b.box(x, top + 2.9, -40, 0.3, 5.8, 0.3, m.darkSteel);
  b.box(0, top + 4.6, -40.1, 15, 2.6, 0.25, m.paintWhite);
  b.box(0, top + 3.2, -40, 15, 0.2, 0.6, m.darkSteel, 0, false);

  // Interior columns, a mezzanine with railing, a catwalk under the north roof and an overhead crane beam.
  for (const cx of [-11, 0, 11]) for (const cz of [-46, -54]) b.block(cx, cz, 0.6, H, 0.6, m.concreteDark);
  b.box(-14, 5.15, -56, 16, 0.3, 12, m.concrete);
  b.beam(V(-6, 6.1, -62), V(-6, 6.1, -50), 0.08, 0.08, m.steel);
  b.beam(V(-22, 6.1, -50), V(-6, 6.1, -50), 0.08, 0.08, m.steel);
  for (let x = -20; x <= -6; x += 3.5) b.box(x, 5.7, -50, 0.06, 0.9, 0.06, m.steel);
  b.box(7, 7.5, -61.1, 26, 0.12, 1.2, m.rust);
  b.beam(V(-6, 8.5, -60.5), V(20, 8.5, -60.5), 0.06, 0.06, m.steel);
  for (let x = -6; x <= 20; x += 6.5) {
    b.box(x, 8, -60.5, 0.06, 1, 0.06, m.steel);
    b.box(x, 9.3, -61.4, 0.05, 3.4, 0.05, m.steel); // hangers to the roof
  }
  b.box(8, 9.2, -50, 0.6, 0.8, 23.2, m.craneYellow);
  b.beam(V(8, 8.8, -50), V(8, 5.2, -50), 0.04, 0.04, m.cable);
  b.box(8, 4.9, -50, 0.5, 0.6, 0.35, m.darkSteel);

  // Junk inside: crates, an old press, a collapsed girder, a forklift and rubble.
  b.block(8, -58, 2, 1.5, 1.6, m.wood, 0.3);
  b.block(10.4, -57.2, 1.6, 1.2, 1.4, m.wood, -0.2);
  b.block(9.2, -57.8, 1.2, 1, 1.2, m.wood, 0.1, 1.5);
  b.block(15, -44, 3, 2.8, 4, m.darkSteel);
  b.block(15, -44, 1.6, 1.4, 1.6, m.rust, 0, 2.8);
  b.beam(V(3, 0.2, -42), V(7, 4.5, -49), 0.3, 0.5, m.rust);
  b.block(-4, -44, 1.2, 1.2, 2.2, m.craneYellow, 0.4, 0.3);
  b.boxAt(V(-4, 0, -44), 0.4, 0, 1.6, -1.25, 1, 2.6, 0.15, m.darkSteel);
  const rnd = seededRandom(77);
  for (let i = 0; i < 14; i++) {
    const s = 0.3 + rnd() * 0.7;
    b.box(16 + rnd() * 5, s * 0.3, -58 + rnd() * 4, s, s * 0.6, s * 1.2, m.concreteDark, Q(rnd() * 0.5, rnd() * 3, rnd() * 0.5), false);
  }

  // Loading ramp and canopy over the south door.
  b.box(0, 0.5, -33.5, 6, 0.4, 8, m.concreteDark, Q(-0.18, 0, 0));
  for (const x of [-5, 5]) b.box(x, 3.3, -34.2, 0.25, 6.6, 0.25, m.darkSteel);
  b.box(0, 6.75, -36, 10.6, 0.3, 4, m.sheetGrey);

  // Scaffolding on the east wall, leaving the roller door clear.
  scaffold(b, m, x1 + 0.25, -61, -54);
  scaffold(b, m, x1 + 0.25, -46, -39);
}

/** Tube-and-plank scaffold against a wall facing +x, spanning z from za to zb, 12 m tall. */
function scaffold(b: Builder, m: M, xw: number, za: number, zb: number): void {
  const xi = xw + 0.3;
  const xo = xw + 1.9;
  const n = Math.round((zb - za) / 2.33);
  const step = (zb - za) / n;
  const r = 0.03;
  for (let i = 0; i <= n; i++) {
    const z = za + i * step;
    for (const x of [xi, xo]) b.pipe(V(x, 0, z), V(x, 12.6, z), r, m.steel, 6);
    b.box((xi + xo) / 2, 0.08, z, 2, 0.16, 0.35, m.wood, 0, false); // sole board
  }
  for (let y = 2; y <= 12; y += 2) {
    for (const x of [xi, xo]) b.pipe(V(x, y, za), V(x, y, zb), r, m.steel, 6);
    if (y % 4 === 0 || y === 12) b.box((xi + xo) / 2, y + 0.05, (za + zb) / 2, 1.5, 0.06, zb - za, m.wood);
    b.pipe(V(xo, y + 1, za), V(xo, y + 1, zb), r, m.steel, 6); // guard rail
  }
  // Diagonal bracing on the outer face.
  for (let i = 0; i < n; i++) if (i % 2 === 0) b.pipe(V(xo, 0.2, za + i * step), V(xo, 12, za + (i + 1) * step), r, m.steel, 6);
}

/** A second, lower warehouse in green sheeting with a collapsed roof section and pallet racking inside. */
function warehouse(b: Builder, m: M): void {
  const x0 = -62;
  const x1 = -40;
  const z0 = -70;
  const z1 = -44;
  const H = 9;
  const T = 0.3;
  b.wall(x0, z1, x1, z1, H, T, m.sheetGreen, [[7, 15, 0, 6]]);
  b.wall(x0, z0, x1, z0, H, T, m.sheetGreen, [[3, 6, 6.5, 8], [9, 12, 6.5, 8], [16, 19, 6.5, 8]]);
  b.wall(x1, z0, x1, z1, H, T, m.sheetGreen, [[3, 9, 0, 5], [12.5, 17.5, 5.3, 8.6], [20, 23, 6.5, 8]]);
  b.wall(x0, z1, x0, z0, H, T, m.sheetGreen, [[8, 10.5, 0, 2.6]]);
  // Roof around a collapsed 6 × 6 m hole; the fallen panel leans inside.
  const hole = { x0: -56, x1: -50, z0: -62, z1: -56 };
  const y = H + 0.1;
  b.box((x0 + x1) / 2, y, (z0 + hole.z0) / 2, x1 - x0 + 0.4, 0.2, hole.z0 - z0 + 0.2, m.sheetGrey);
  b.box((x0 + x1) / 2, y, (hole.z1 + z1) / 2, x1 - x0 + 0.4, 0.2, z1 - hole.z1 + 0.2, m.sheetGrey);
  b.box((x0 + hole.x0) / 2, y, (hole.z0 + hole.z1) / 2, hole.x0 - x0 + 0.2, 0.2, hole.z1 - hole.z0, m.sheetGrey);
  b.box((hole.x1 + x1) / 2, y, (hole.z0 + hole.z1) / 2, x1 - hole.x1 + 0.2, 0.2, hole.z1 - hole.z0, m.sheetGrey);
  b.box(-53, 4.2, -59, 6, 0.15, 6.4, m.sheetGrey, Q(0.9, 0.3, 0.2));
  for (let x = x0 + 4; x < x1; x += 4.4) b.beam(V(x, H - 0.3, z0), V(x, H - 0.3, z1), 0.2, 0.35, m.darkSteel);

  // Two runs of pallet racking: open bays you can thread at three heights.
  for (const rx of [-57.5, -47]) {
    for (let z = -67.5; z <= -47; z += 2.7) for (const dx of [-0.55, 0.55]) b.box(rx + dx, 3.1, z, 0.1, 6.2, 0.1, m.steel);
    for (const ly of [2, 4.1, 6.2]) for (const dx of [-0.55, 0.55]) b.box(rx + dx, ly, -57.25, 0.08, 0.14, 20.5, m.rackOrange);
    const rnd = seededRandom(rx === -47 ? 5 : 6);
    for (let z = -66.15; z <= -48; z += 2.7) {
      for (const ly of [0, 2.07, 4.17]) {
        if (rnd() < 0.45) continue;
        b.block(rx, z, 1.1, 0.15, 1.2, m.wood, 0, ly);
        if (rnd() < 0.7) b.block(rx, z, 1.0, 0.6 + rnd() * 0.6, 1.0, rnd() < 0.5 ? m.tarp : m.wood, 0, ly + 0.15);
      }
    }
  }
}

/** Enclosed skybridge from the warehouse to the factory mezzanine, with window strips along both sides. */
function skybridge(b: Builder, m: M): void {
  const xa = -39.85;
  const xb = -22.2;
  const zc = -55;
  const y0 = 5.3;
  const len = xb - xa;
  b.box((xa + xb) / 2, y0 - 0.15, zc, len, 0.3, 5.2, m.concrete);
  b.box((xa + xb) / 2, y0 + 3.45, zc, len, 0.3, 5.6, m.sheetGrey);
  for (const z of [zc - 2.5, zc + 2.5]) b.wall(xa, z, xb, z, 3.3, 0.2, m.sheetGrey, [[1.2, len - 1.2, 1.0, 2.6]], y0);
  b.block(-31, zc, 0.9, y0 - 0.3, 0.9, m.concreteDark);
  b.beam(V(-31, 0.5, zc), V(-35.5, y0 - 0.3, zc), 0.25, 0.25, m.darkSteel);
  b.beam(V(-31, 0.5, zc), V(-26.5, y0 - 0.3, zc), 0.25, 0.25, m.darkSteel);
}

/** Three-deck open parking structure with parapets, a lightwell, an entrance ramp, parked cars and lamp posts. */
function parkingStructure(b: Builder, m: M): void {
  const x0 = 50;
  const x1 = 80;
  const z0 = -52;
  const z1 = -8;
  const hole = { x0: 62, x1: 68, z0: -34, z1: -26 };
  const levels = [3.2, 6.4, 9.6];
  const th = 0.35;
  for (const y of levels) {
    const yc = y - th / 2;
    b.box((x0 + x1) / 2, yc, (z0 + hole.z0) / 2, x1 - x0, th, hole.z0 - z0, m.concrete);
    b.box((x0 + x1) / 2, yc, (hole.z1 + z1) / 2, x1 - x0, th, z1 - hole.z1, m.concrete);
    b.box((x0 + hole.x0) / 2, yc, (hole.z0 + hole.z1) / 2, hole.x0 - x0, th, hole.z1 - hole.z0, m.concrete);
    b.box((hole.x1 + x1) / 2, yc, (hole.z0 + hole.z1) / 2, x1 - hole.x1, th, hole.z1 - hole.z0, m.concrete);
    b.box(x0 + 0.15, y + 0.5, (z0 + z1) / 2, 0.3, 1, z1 - z0, m.concreteDark);
    b.box(x1 - 0.15, y + 0.5, (z0 + z1) / 2, 0.3, 1, z1 - z0, m.concreteDark);
    // Lightwell guard rail.
    b.box((hole.x0 + hole.x1) / 2, y + 1, hole.z0 - 0.05, hole.x1 - hole.x0, 0.08, 0.08, m.paintWhite);
    b.box((hole.x0 + hole.x1) / 2, y + 1, hole.z1 + 0.05, hole.x1 - hole.x0, 0.08, 0.08, m.paintWhite);
  }
  for (const cx of [50.4, 57.5, 72.5, 79.6]) {
    for (const cz of [-51.6, -41, -30, -19, -8.4]) b.block(cx, cz, 0.5, 9.6, 0.5, m.concreteDark);
  }
  b.block(83, -10, 5, 12.5, 5, m.concreteWarm);
  b.box(65, 1.6, -7.9, 3, 0.8, 0.05, m.tarp, 0, false);
  // Entrance ramp up to the first deck from the open south end.
  b.box(65, 1.6, -1, 6, 0.3, 14.4, m.concreteDark, Q(Math.atan2(3.05, 14), 0, 0));
  // Parked cars on the decks and lamp posts on the roof.
  const cars: [number, number, number, number, THREE.Material][] = [
    [54, -45, 0, 3.2, m.paintRed],
    [76, -14, 0.1, 3.2, m.rust],
    [54, -20, 0, 6.4, m.containerBlue],
    [76, -45, Math.PI, 6.4, m.paintWhite],
    [75, -40, 0.3, 9.6, m.rust],
    [60, -12, 1.4, 9.6, m.containerGreen],
  ];
  for (const [x, z, yaw, y, mat] of cars) b.car(x, z, yaw, mat, y, m.glassDark);
  for (const [x, z] of [
    [54, -48],
    [76, -48],
    [54, -12],
    [76, -12],
  ]) {
    b.cylinder(x, z, 9.6, 14, 0.1, m.steel, 8);
    b.box(x, 14, z, 1.2, 0.18, 0.4, m.darkSteel);
  }
}

/** Tower crane: a lattice mast, a slewing unit and cab, a 42 m jib with a trolley and a hanging load. */
function towerCrane(b: Builder, m: M, cx: number, cz: number): void {
  const H = 40;
  const s = 0.9;
  b.block(cx, cz, 5, 1, 5, m.concreteDark);
  const corners = [V(cx - s, 0, cz - s), V(cx + s, 0, cz - s), V(cx + s, 0, cz + s), V(cx - s, 0, cz + s)];
  for (const c of corners) b.box(c.x, (H + 1) / 2, c.z, 0.16, H - 1, 0.16, m.craneYellow);
  for (let y = 1; y < H; y += 3) {
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      b.beam(V(a.x, y, a.z), V(c.x, y, c.z), 0.08, 0.08, m.craneYellow);
      b.beam(V(a.x, y, a.z), V(c.x, Math.min(y + 3, H), c.z), 0.06, 0.06, m.craneYellow);
    }
  }
  const top = H;
  b.box(cx, top + 0.75, cz, 2.6, 1.5, 2.6, m.craneYellow);
  b.box(cx + 1.9, top + 2.2, cz + 1, 1.6, 2, 2, m.paintWhite);
  b.box(cx + 1.9, top + 2.5, cz + 2.05, 1.4, 1, 0.08, m.glassDark, 0, false);
  // Jib toward the lot, triangular lattice.
  const jibEnd = cz + 43;
  const y0 = top + 1.6;
  for (const dx of [-0.8, 0.8]) b.beam(V(cx + dx, y0, cz + 1.3), V(cx + dx, y0, jibEnd), 0.12, 0.12, m.craneYellow);
  b.beam(V(cx, y0 + 1.6, cz + 1.3), V(cx, y0 + 1.6, jibEnd), 0.12, 0.12, m.craneYellow);
  for (let z = cz + 1.3; z < jibEnd - 1; z += 3) {
    for (const dx of [-0.8, 0.8]) {
      b.beam(V(cx + dx, y0, z), V(cx, y0 + 1.6, z + 1.5), 0.06, 0.06, m.craneYellow);
      b.beam(V(cx, y0 + 1.6, z + 1.5), V(cx + dx, y0, z + 3), 0.06, 0.06, m.craneYellow);
    }
    b.beam(V(cx - 0.8, y0, z), V(cx + 0.8, y0, z), 0.06, 0.06, m.craneYellow);
  }
  // Counter-jib with concrete counterweights, an A-frame and pendant ties.
  const cjEnd = cz - 14;
  b.box(cx, y0 + 0.1, (cz - 1.3 + cjEnd) / 2, 2, 0.4, 14 - 1.3, m.craneYellow);
  for (let i = 0; i < 3; i++) b.box(cx, y0 + 1.3, cjEnd + 1 + i * 1.1, 2.4, 2, 1, m.concreteDark);
  const apex = V(cx, top + 9, cz);
  for (const dz of [-1, 1]) b.beam(V(cx - 1, top + 1.5, cz + dz), apex, 0.18, 0.18, m.craneYellow);
  for (const dz of [-1, 1]) b.beam(V(cx + 1, top + 1.5, cz + dz), apex, 0.18, 0.18, m.craneYellow);
  b.beam(apex, V(cx, y0 + 1.6, cz + 28), 0.05, 0.05, m.cable);
  b.beam(apex, V(cx, y0 + 0.3, cjEnd + 0.5), 0.05, 0.05, m.cable);
  // Trolley 30 m out, hook line and a hanging bundle of steel beams.
  const tz = cz + 30;
  b.box(cx, y0 - 0.35, tz, 1.4, 0.5, 1.4, m.darkSteel);
  b.beam(V(cx, y0 - 0.6, tz), V(cx, 15.2, tz), 0.04, 0.04, m.cable);
  b.box(cx, 14.9, tz, 0.5, 0.6, 0.5, m.craneYellow);
  b.beam(V(cx, 14.6, tz), V(cx, 13.6, tz - 2.5), 0.03, 0.03, m.cable, false);
  b.beam(V(cx, 14.6, tz), V(cx, 13.6, tz + 2.5), 0.03, 0.03, m.cable, false);
  b.box(cx, 13.2, tz, 1.2, 0.8, 7, m.rust, 0.6);
}

/** Three grain silos on legs with hoppers, a headhouse across their tops and a sloping conveyor gallery. */
function silos(b: Builder, m: M): void {
  const z = -85;
  const r = 4.2;
  const legTop = 4;
  const hopperTop = 7;
  const siloTop = 26;
  for (const x of [58, 68, 78]) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      b.cylinder(x + Math.cos(a) * 3, z + Math.sin(a) * 3, 0, hopperTop, 0.25, m.darkSteel, 8);
    }
    b.cylinder(x, z, legTop, hopperTop, r, m.siloWhite, 24, true, r); // hopper ring (kept cylindrical for collision)
    b.cylinder(x, z, legTop - 1.2, legTop, 0.6, m.steel, 10, true, r * 0.9);
    b.cylinder(x, z, hopperTop, siloTop, r, m.siloWhite, 32);
    b.cylinder(x, z, siloTop - 0.2, siloTop + 0.2, r + 0.15, m.steel, 32);
    // Ladder cage up one side.
    b.box(x + r + 0.45, (hopperTop + siloTop) / 2, z, 0.05, siloTop - hopperTop, 0.6, m.steel);
  }
  b.box(68, siloTop + 2, z, 29, 4, 6, m.sheetGrey);
  b.box(68, siloTop + 4.15, z, 29.4, 0.3, 6.4, m.darkSteel);
  // Conveyor gallery from the headhouse down to a transfer tower: open truss sides you can fly in and out of.
  const a = V(53.6, siloTop + 1.5, z);
  const c = V(29.2, 7, -112);
  const q = Builder.alignQuat(a, c);
  const len = a.distanceTo(c);
  const mid = a.clone().add(c).multiplyScalar(0.5);
  b.boxIn(mid, q, 0, -1.5, 0, 3.4, 0.2, len, m.rust);
  b.boxIn(mid, q, 0, 1.5, 0, 3.6, 0.15, len, m.sheetGrey);
  for (const lx of [-1.65, 1.65]) {
    for (const ly of [-1.35, 1.35]) b.boxIn(mid, q, lx, ly, 0, 0.12, 0.12, len, m.steel);
    for (let lz = -len / 2 + 0.5; lz <= len / 2; lz += 4) b.boxIn(mid, q, lx, 0, lz, 0.1, 2.7, 0.1, m.steel);
  }
  b.boxIn(mid, q, 0.8, -1.1, 0, 0.9, 0.5, len, m.rubber, false); // belt
  // Trestles under the gallery.
  for (const t of [0.3, 0.62]) {
    const p = a.clone().lerp(c, t);
    const top = p.y - 1.7;
    for (const dx of [-1.6, 1.6]) {
      const off = V(dx, 0, 0).applyQuaternion(q);
      b.box(p.x + off.x, top / 2, p.z + off.z, 0.3, top, 0.3, m.steel);
    }
    b.beam(V(p.x - 1.6, top * 0.5, p.z), V(p.x + 1.6, top * 0.5, p.z), 0.12, 0.12, m.steel);
  }
  // Transfer tower: an open steel frame, clad on two sides.
  const tx = 26;
  const tz = -112;
  for (const dx of [-3, 3]) for (const dz of [-3, 3]) b.box(tx + dx, 5.5, tz + dz, 0.3, 11, 0.3, m.steel);
  b.box(tx, 5.3, tz, 6.3, 0.25, 6.3, m.rust);
  b.box(tx, 11.1, tz, 6.8, 0.25, 6.8, m.sheetGrey);
  b.box(tx - 3.05, 5.5, tz, 0.1, 11, 6.2, m.sheetRust);
  b.box(tx, 5.5, tz - 3.05, 6.2, 11, 0.1, m.sheetRust);
}

/** Pipe rack running north–south between the factory and the parking structure: fly under or between the tiers. */
function pipeRack(b: Builder, m: M): void {
  const xa = 34;
  const xb = 38.4;
  const za = -60;
  const zb = 0;
  for (let z = za; z <= zb; z += 6) {
    for (const x of [xa, xb]) b.block(x, z, 0.3, 7.8, 0.3, m.darkSteel);
    b.box((xa + xb) / 2, 5, z, xb - xa + 0.3, 0.3, 0.3, m.darkSteel);
    b.box((xa + xb) / 2, 7.6, z, xb - xa + 0.3, 0.3, 0.3, m.darkSteel);
    b.block((xa + xb) / 2, z, 1, 0.3, 1, m.concreteDark, 0, 0, false);
  }
  const pipes: [number, number, number, THREE.Material][] = [
    [34.6, 5.15, 0.25, m.steel],
    [35.5, 5.15, 0.35, m.rust],
    [36.6, 5.15, 0.3, m.paintWhite],
    [37.7, 5.15, 0.2, m.steel],
    [35, 7.75, 0.4, m.rust],
    [36.9, 7.75, 0.3, m.steel],
  ];
  for (const [x, y, r, mat] of pipes) b.pipe(V(x, y + r, za - 0.5), V(x, y + r, zb + 0.5), r, mat, 12);
  // The fat pipe drops to the ground at the south end and runs along the lot.
  b.pipe(V(35.5, 5.5, zb + 0.5), V(35.5, 0.6, zb + 0.5), 0.35, m.rust, 12);
  b.pipe(V(35.5, 0.6, zb + 0.5), V(35.5, 0.6, zb + 14), 0.35, m.rust, 12);
}

function waterTower(b: Builder, m: M, cx: number, cz: number): void {
  const legH = 18;
  const s = 3.5;
  const legs = [V(cx - s, 0, cz - s), V(cx + s, 0, cz - s), V(cx + s, 0, cz + s), V(cx - s, 0, cz + s)];
  for (const l of legs) b.cylinder(l.x, l.z, 0, legH + 0.5, 0.3, m.steel, 10);
  for (let i = 0; i < 4; i++) {
    const a = legs[i];
    const c = legs[(i + 1) % 4];
    for (const [y0, y1] of [
      [2, 9],
      [9, 16],
    ]) {
      b.beam(V(a.x, y0, a.z), V(c.x, y1, c.z), 0.12, 0.12, m.steel);
      b.beam(V(a.x, y1, a.z), V(c.x, y0, c.z), 0.12, 0.12, m.steel);
    }
    b.beam(V(a.x, 9, a.z), V(c.x, 9, c.z), 0.2, 0.2, m.steel);
  }
  b.cylinder(cx, cz, legH, legH + 6, 5, m.siloWhite, 32);
  b.cylinder(cx, cz, legH - 0.3, legH, 5.6, m.darkSteel, 32);
  b.cone(cx, cz, legH + 6, 2.6, 5.3, m.rust, 32);
  b.cylinder(cx, cz, legH + 8.4, legH + 9.2, 0.25, m.steel, 8);
  b.pipe(V(cx, 0, cz), V(cx, legH, cz), 0.45, m.rust, 12);
}

function chimney(b: Builder, m: M, x: number, z: number): void {
  b.cylinder(x, z, 0, 38, 1.8, m.brick, 24, true, 1.4);
  b.cylinder(x, z, 36, 37.2, 1.65, m.darkSteel, 24);
  for (const y of [10, 20, 30]) b.cylinder(x, z, y, y + 0.3, 2.0 - y * 0.012, m.darkSteel, 24, false);
  b.block(x, z + 4, 6, 4, 5, m.brick);
  b.block(x, z + 4, 6.4, 0.3, 5.4, m.concreteDark, 0, 4);
}

function containerYard(b: Builder, m: M): void {
  const c = m;
  b.container(-48, 0, -80, 0, c.containerRed);
  b.container(-44.2, 0, -80, 0, c.containerBlue); // 1.36 m gap
  b.container(-48, 2.6, -80, 0, c.containerGreen);
  // Tunnel: two stacks bridged by a container on top.
  b.container(-36, 0, -84, 0, c.containerYellow);
  b.container(-30, 0, -84, 0, c.containerGrey);
  b.container(-33, 2.6, -84, Math.PI / 2, c.containerRed);
  // A four-high stack and a slightly shifted pair.
  for (let i = 0; i < 4; i++) b.container(-56, i * 2.6, -97, Math.PI / 2 + (i === 3 ? 0.06 : 0), [c.containerBlue, c.containerGreen, c.containerGrey, c.containerYellow][i]);
  b.container(-40, 0, -104, 0.25, c.containerYellow);
  b.box(-30, 1.9, -100, 2.44, 2.6, 12.2, c.containerGreen, Q(0, 0.4, 0.28));
}

/** Rail line with sleepers and a siding: boxcars, an open gondola to dive into, a tank car and a derailed car. */
function railYard(b: Builder, m: M): void {
  for (const [x, z0, z1] of [
    [RAIL_X, -127, 43],
    [SIDING_X, -110, 30],
  ]) {
    for (let z = z0; z < z1; z += 0.75) b.box(x, 0.06, z, 2.6, 0.14, 0.24, m.wood, 0, false);
    for (const dx of [-0.72, 0.72]) for (let z = z0; z < z1; z += 34) {
        const len = Math.min(34, z1 - z);
        b.box(x + dx, 0.2, z + len / 2, 0.08, 0.16, len, m.steel, 0, false);
      }
  }
  const gap = 1.6;
  let z = -112;
  const kinds: ('box' | 'gondola' | 'tank')[] = ['box', 'box', 'gondola', 'tank', 'box', 'gondola'];
  const bodies = [m.containerRed, m.sheetRust, m.containerBlue, m.paintWhite, m.containerYellow, m.sheetRust];
  kinds.forEach((k, i) => {
    railCar(b, m, RAIL_X, z + 7.5, k, bodies[i]);
    z += 15 + gap;
  });
  railCar(b, m, SIDING_X, -60, 'box', m.containerGreen);
  railCar(b, m, SIDING_X, -43.4, 'gondola', m.sheetRust);
  // Derailed boxcar tipped against the siding.
  b.box(SIDING_X - 2.2, 2.4, -18, 3, 4.2, 15, m.containerGrey, Q(0, 0.12, 0.42));
}

function railCar(b: Builder, m: M, x: number, zc: number, kind: 'box' | 'gondola' | 'tank', body: THREE.Material): void {
  for (const dz of [-5.2, 5.2]) b.block(x, zc + dz, 2.3, 0.85, 2.6, m.darkSteel, 0, 0.2);
  b.box(x, 1.15, zc, 2.8, 0.25, 15.4, m.darkSteel);
  for (const dz of [-7.9, 7.9]) b.box(x, 1.0, zc + dz, 0.3, 0.3, 0.6, m.darkSteel, 0, false);
  if (kind === 'box') {
    b.box(x, 3.35, zc, 3.0, 4.2, 15, body);
    b.box(x, 5.5, zc, 0.5, 0.1, 15, m.darkSteel, 0, false);
    for (const side of [-1, 1]) b.box(x + side * 1.53, 3, zc, 0.06, 3, 3, m.darkSteel, 0, false); // door
  } else if (kind === 'gondola') {
    b.box(x, 1.4, zc, 3.0, 0.25, 15, body);
    for (const side of [-1, 1]) b.box(x + side * 1.45, 2.4, zc, 0.1, 2, 15, body);
    for (const end of [-1, 1]) b.box(x, 2.4, zc + end * 7.45, 3.0, 2, 0.1, body);
  } else {
    b.tube(V(x, 2.9, zc - 7), V(x, 2.9, zc + 7), 1.45, 0.08, body, 22);
    for (const end of [-1, 1]) {
      const cap = new THREE.CircleGeometry(1.45, 22);
      if (end < 0) cap.rotateY(Math.PI);
      b.add(cap, body, V(x, 2.9, zc + end * 7), undefined, 'keep');
    }
    b.cylinder(x, zc, 4.3, 4.8, 0.5, m.darkSteel, 12);
  }
}

/** Elevated highway across the south edge: wall piers to carve around, girders to fly under, a sign gantry on top. */
function overpass(b: Builder, m: M): void {
  const z = OVERPASS_Z;
  const span = 32;
  const xs: number[] = [];
  for (let x = -144; x <= 144; x += span) xs.push(x);
  const deckH = 1.0;
  const deckY = DECK_TOP - deckH / 2;
  for (let i = 0; i <= xs.length; i++) {
    const xa = i === 0 ? -176 : xs[i - 1];
    const xb = i === xs.length ? 176 : xs[i];
    const cx = (xa + xb) / 2;
    const L = xb - xa;
    b.box(cx, deckY, z, L, deckH, 14, m.concrete);
    for (const dz of [-6.6, 6.6]) b.box(cx, DECK_TOP + 0.45, z + dz, L, 0.9, 0.5, m.concreteWarm);
    for (const dz of [-4.5, -1.5, 1.5, 4.5]) b.box(cx, DECK_TOP - deckH - 0.45, z + dz, L, 0.9, 0.35, m.concreteDark);
  }
  for (const x of xs) {
    const g = bandoTerrain(x, z);
    const capY = DECK_TOP - deckH - 0.9;
    if (capY - g < 1.5) continue;
    b.box(x, capY - 0.5, z, 1.8, 1, 14, m.concreteDark);
    if (Math.abs(x) < 50) {
      b.box(x, (g + capY - 1) / 2, z, 1.4, capY - 1 - g + 0.5, 9, m.concrete); // wall pier
    } else {
      for (const dz of [-4, 4]) b.cylinder(x, z + dz, g - 0.5, capY - 1, 0.8, m.concrete, 16);
    }
  }
  // Abandoned cars and a sign gantry on the deck.
  b.car(-30, z - 3, Math.PI / 2 + 0.2, m.paintWhite, DECK_TOP, m.glassDark);
  b.car(14, z + 3.5, -Math.PI / 2, m.rust, DECK_TOP, m.glassDark);
  b.car(55, z - 2.5, Math.PI / 2 - 0.4, m.containerBlue, DECK_TOP, m.glassDark);
  const gx = 30;
  for (const dz of [-6.6, 6.6]) b.box(gx, DECK_TOP + 3.4, z + dz, 0.4, 6.8, 0.4, m.steel);
  b.box(gx, DECK_TOP + 6.6, z, 0.6, 0.6, 13.6, m.steel);
  b.box(gx + 0.1, DECK_TOP + 5.1, z - 2.8, 0.2, 2.2, 5.5, m.signGreen);
  b.box(gx + 0.1, DECK_TOP + 5.1, z + 3.3, 0.2, 2.2, 4.5, m.signGreen);
}

/** A line of pylons across the north hills, with sagging cables that are solid. */
function powerLines(b: Builder, m: M): void {
  const z = -150;
  const xs = [-245, -175, -105, -35, 35, 105, 175, 245];
  const tips: THREE.Vector3[][] = [];
  for (const x of xs) {
    const g = bandoTerrain(x, z);
    // Tapered lattice-look tower: four legs leaning in, cross braces, two arms.
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      b.beam(V(x + dx * 2.2, g - 0.5, z + dz * 2.2), V(x + dx * 0.6, g + 26, z + dz * 0.6), 0.25, 0.25, m.steel);
    for (let y = 4; y < 24; y += 5) {
      const w = 2.2 - (1.6 * y) / 26.5;
      for (const dz of [-w, w]) b.beam(V(x - w, g + y, z + dz), V(x + w, g + y + 5 * 0.6, z + dz), 0.1, 0.1, m.steel);
      for (const dx of [-w, w]) b.beam(V(x + dx, g + y, z - w), V(x + dx, g + y + 3, z + w), 0.1, 0.1, m.steel);
    }
    for (const ay of [19, 23]) b.box(x, g + ay, z, 11, 0.5, 0.6, m.steel);
    tips.push([V(x - 5, g + 22.5, z), V(x + 5, g + 22.5, z), V(x - 5, g + 18.5, z), V(x + 5, g + 18.5, z)]);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = tips[i][k];
      const c = tips[i + 1][k];
      const segs = 6;
      let prev = a;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const p = a.clone().lerp(c, t);
        p.y -= 3.5 * 4 * t * (1 - t);
        b.beam(prev, p, 0.06, 0.06, m.cable);
        prev = p;
      }
    }
  }
}

/** Smaller props around the lot for proximity lines. */
function props(b: Builder, m: M): void {
  for (let i = 0; i < 9; i++) b.block(-30 + i * 3.4, 12, 3.2, 0.9, 0.6, m.concreteWarm, 0.05 * (i % 3));
  // Abandoned bus with a window band.
  b.block(22, -8, 2.6, 2.6, 11, m.craneYellow, 0.5, 0.5);
  b.boxAt(V(22, 0, -8), 0.5, 0, 2.5, 0, 2.66, 0.9, 10, m.glassDark, false);
  for (const dz of [-3.6, 3.6]) b.boxAt(V(22, 0, -8), 0.5, 0, 0.5, dz, 2.4, 1, 1, m.rubber, false);
  // Rusted cars.
  b.car(-12, -14, -0.8, m.rust);
  b.car(-19, -9, 0.3, m.containerGrey);
  b.car(10, -22, 1.2, m.rust);
  b.car(-60, 20, 2.4, m.paintRed);
  // Culvert pipes to fly through: a pair with one stacked on top, and a loner.
  const r = 1.2;
  for (const x of [-34, -31.5]) b.tube(V(x, r, -24), V(x, r, -18), r, 0.14, m.concreteWarm);
  b.tube(V(-32.75, r * 2.73, -24), V(-32.75, r * 2.73, -18), r, 0.14, m.concreteWarm);
  b.tube(V(24, r, 22), V(30, r, 24), r, 0.14, m.concreteWarm);
  // Cable spools, drums and tyre stacks.
  for (const [x, z] of [
    [-26, -30],
    [30, -30],
    [42, -64],
  ]) {
    b.cylinder(x, z, 0, 1.6, 1.1, m.wood, 16);
    b.cylinder(x, z, 1.6, 1.75, 1.25, m.wood, 16);
  }
  const rnd = seededRandom(91);
  for (const [x, z] of [
    [-20, -34],
    [26, -40],
    [46, -12],
    [-36, -40],
  ]) {
    for (let i = 0; i < 5; i++) b.cylinder(x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, 0, 0.9, 0.3, rnd() < 0.5 ? m.paintRed : m.tarp, 12);
  }
  for (const [x, z] of [
    [-8, 4],
    [44, -36],
  ]) {
    for (let i = 0; i < 5; i++) b.cylinder(x, z, i * 0.26, i * 0.26 + 0.26, 0.36, m.rubber, 12);
  }
  // Dumpsters and pallet stacks.
  b.block(-18, -34.5, 4, 1.5, 2, m.sheetGreen, 0.05);
  b.block(40, -56, 4, 1.5, 2, m.containerBlue, -0.1);
  for (const [x, z] of [
    [12, -30],
    [-20, -28],
    [30, -66],
    [-66, -40],
  ]) {
    for (let i = 0; i < 4; i++) b.block(x, z, 1.2, 0.15, 1, m.wood, 0.05 * i, i * 0.15);
  }
  // Light poles around the lot.
  for (const [x, z] of [
    [-40, 5],
    [42, 5],
    [-40, -110],
    [45, -112],
    [90, -60],
    [-90, -60],
  ]) {
    b.cylinder(x, z, 0, 10, 0.15, m.steel, 8);
    b.box(x, 10, z, 1.6, 0.25, 0.5, m.darkSteel);
  }
  // A billboard on legs to gap under.
  b.cylinder(-80, -10, 0, 7, 0.25, m.steel, 8);
  b.cylinder(-72, -10, 0, 7, 0.25, m.steel, 8);
  b.box(-76, 9, -10, 12, 4, 0.3, m.paintWhite);
  b.box(-76, 7, -10.6, 12, 0.1, 1, m.steel, 0, false);
}

/** Graffiti from the shared atlas: [x, y, z, yaw, width, cell]. Yaw points the tag's face outward. */
const TAGS: [number, number, number, number, number, number][] = [
  [-14, 2, -37.77, 0, 5, 0],
  [12, 1.8, -37.77, 0, 4, 1],
  [-8, 8.9, -37.77, 0, 3.5, 2],
  [8, 2.2, -62.23, Math.PI, 5, 3],
  [-22.23, 2.3, -44, -Math.PI / 2, 4, 4],
  [-55, 2, -43.83, 0, 4.5, 5],
  [-62.18, 3, -60, -Math.PI / 2, 5, 6],
  [83, 6, -7.47, 0, 4, 7],
  [47.28, 2.5, OVERPASS_Z, -Math.PI / 2, 5, 8],
  [-15.28, 2.6, OVERPASS_Z, Math.PI / 2, 5, 9],
  [16.72, 3, OVERPASS_Z + 2, Math.PI / 2, 5, 10],
  [RAIL_X + 1.52, 3.4, -99.5, Math.PI / 2, 5, 11],
  [RAIL_X + 1.52, 3.4, -33.5, Math.PI / 2, 5, 2],
  [-49.2, 1.3, -80, -Math.PI / 2, 4, 0],
  [28, 2.2, -81.47, 0, 4, 5],
  [-76, 9, -9.83, 0, 6, 7],
];

function graffitiTags(b: Builder, m: M): void {
  const rows = GRAFFITI_CELLS / 2;
  for (const [x, y, z, yaw, w, cell] of TAGS) {
    const col = cell % 2;
    const row = Math.floor(cell / 2);
    b.sticker(x, y, z, yaw, w, w / 2, m.graffiti, [col / 2, 1 - (row + 1) / rows, (col + 1) / 2, 1 - row / rows]);
  }
}

// ---------------------------------------------------------------- Vegetation

/** True where trees and rocks must not go: corridors, roads, the rail line and the lot. */
function blocked(x: number, z: number, margin: number): boolean {
  if (Math.abs(z + 150) < 9 + margin) return true; // power line corridor
  if (Math.abs(z - OVERPASS_Z) < 10 + margin && Math.abs(x) < 182) return true;
  if (x > SIDING_X - 6 - margin && x < RAIL_X + 5 + margin && z > -132 && z < 48) return true;
  return lotDistance(x, z) < 4 + margin;
}

function trees(b: Builder, m: M): void {
  const rnd = seededRandom(4242);
  const foliage = [m.leafGreen, m.leafOlive, m.leafGreen, m.leafAutumn];
  let placed = 0;
  for (let i = 0; i < 2000 && placed < 320; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 125 + Math.pow(rnd(), 0.8) * 260;
    const x = LOT.x + Math.cos(ang) * dist;
    const z = LOT.z + Math.sin(ang) * dist;
    if (blocked(x, z, 3)) continue;
    // Clump: skip spots where the noise says meadow.
    if (fbm2(x * 0.02 + 3, z * 0.02 - 8) < 0.42) continue;
    const g = bandoTerrain(x, z);
    const s = 0.75 + rnd() * 0.75;
    if (rnd() < 0.5) b.pine(x, z, s, g, rnd() < 0.5 ? m.pineDark : m.pineLight, m.bark);
    else b.leafy(x, z, s, g, foliage[Math.floor(rnd() * foliage.length)], rnd, m.bark);
    placed++;
  }
  // A row of trees behind the spawn and a tight cluster to weave through east of it.
  for (let i = 0; i < 7; i++) b.leafy(-70 + i * 9 + rnd() * 2, 54 + rnd() * 2, 0.8 + rnd() * 0.3, 0, foliage[i % 3], rnd, m.bark);
  b.pine(46, 8, 1.1, 0, m.pineDark, m.bark);
  b.pine(50, 12, 0.9, 0, m.pineLight, m.bark);
  b.pine(47, 17, 1.2, 0, m.pineDark, m.bark);
  b.leafy(-28, -118, 1.2, 0, m.leafGreen, rnd, m.bark);
  b.leafy(-20, -122, 1.0, 0, m.leafOlive, rnd, m.bark);
}

/** Instanced grass tufts and rocks. Tufts are visual only; big rocks collide. */
function vegetation(group: THREE.Group, b: Builder, maxAnisotropy: number): void {
  const rnd = seededRandom(515);
  const tuftTex = tuftTexture();
  tuftTex.anisotropy = Math.min(4, maxAnisotropy);
  const tuftGeo = mergeCrossed(1.2, 0.8);
  const tuftMat = new THREE.MeshStandardMaterial({ map: tuftTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const N = 9000;
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, N);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < N * 4 && n < N; i++) {
    let x: number;
    let z: number;
    let scale: number;
    if (n < 900) {
      // Weeds pushing through the lot near its edges and walls.
      x = LOT_RECT.x0 + rnd() * (LOT_RECT.x1 - LOT_RECT.x0);
      z = LOT_RECT.z0 + rnd() * (LOT_RECT.z1 - LOT_RECT.z0);
      const edge = Math.min(x - LOT_RECT.x0, LOT_RECT.x1 - x, z - LOT_RECT.z0, LOT_RECT.z1 - z);
      if (edge > 12 && rnd() < 0.85) continue;
      scale = 0.4 + rnd() * 0.5;
    } else {
      const ang = rnd() * Math.PI * 2;
      const dist = Math.pow(rnd(), 0.7) * 300;
      x = LOT.x + Math.cos(ang) * dist;
      z = LOT.z + Math.sin(ang) * dist;
      if (lotDistance(x, z) < 0.5 || (Math.abs(z - OVERPASS_Z) < 6.5 && Math.abs(x) < 90) || (Math.abs(x) < 5.5 && z > 44 && z < 66)) continue;
      if (x > SIDING_X - 2.4 && x < RAIL_X + 2.4 && z > -128 && z < 44) continue;
      scale = 0.6 + rnd() * 0.9;
    }
    p.set(x, bandoTerrain(x, z) - 0.05, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    s.set(scale, scale * (0.7 + rnd() * 0.6), scale);
    tufts.setMatrixAt(n, mtx.compose(p, q, s));
    const dry = fbm2(x * 0.018, z * 0.018);
    tufts.setColorAt(n, col.setRGB(1.05 + dry * 0.45 + rnd() * 0.1, 1.1 + rnd() * 0.15, 0.85 + rnd() * 0.15));
    n++;
  }
  tufts.count = n;
  tufts.receiveShadow = true;
  tufts.frustumCulled = false;
  group.add(tufts);

  // Rocks: a jittered icosahedron shared by all instances, scaled and rotated per instance.
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  const jr = seededRandom(3);
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.75 + jr() * 0.45);
    const k = jitter.get(key)!;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8e8a82, roughness: 0.95, flatShading: true });
  const R = 260;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, R);
  let k = 0;
  for (let i = 0; i < R * 6 && k < R; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 95 + rnd() * 260;
    const x = LOT.x + Math.cos(ang) * dist;
    const z = LOT.z + Math.sin(ang) * dist;
    if (blocked(x, z, 1)) continue;
    const sc = 0.3 + Math.pow(rnd(), 2.5) * 2.4;
    const g = bandoTerrain(x, z);
    p.set(x, g - sc * 0.15, z);
    q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4));
    s.set(sc * (0.8 + rnd() * 0.5), sc, sc * (0.8 + rnd() * 0.5));
    rocks.setMatrixAt(k, mtx.compose(p, q, s));
    rocks.setColorAt(k, col.setRGB(0.85 + rnd() * 0.2, 0.85 + rnd() * 0.2, 0.85 + rnd() * 0.15));
    if (sc > 0.9) b.colliders.push(new CylinderCollider(x, z, g - 1, g + sc * 0.6, sc * 0.85));
    k++;
  }
  rocks.count = k;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  group.add(rocks);
}

/** Two crossed vertical quads with their base at y = 0, for grass tufts. */
function mergeCrossed(w: number, h: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const c = a.clone().rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const posA = a.attributes.position.array as Float32Array;
  const posC = c.attributes.position.array as Float32Array;
  const pos = new Float32Array(posA.length * 2);
  pos.set(posA);
  pos.set(posC, posA.length);
  const uvA = a.attributes.uv.array as Float32Array;
  const uv = new Float32Array(uvA.length * 2);
  uv.set(uvA);
  uv.set(uvA, uvA.length);
  // Normals point up so the double-sided cards light like the ground they stand on.
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1;
  const idxA = Array.from(a.index!.array);
  const offset = posA.length / 3;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex([...idxA, ...idxA.map((i) => i + offset)]);
  return geo;
}
