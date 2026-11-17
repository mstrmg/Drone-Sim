import * as THREE from 'three';
import {
  asphaltTexture,
  brickTexture,
  concreteTexture,
  corrugatedTexture,
  rustTexture,
  woodTexture,
} from './textures';

/** Texture tile size in metres, read by the builder's world-space UV mapping. */
export function uvScaleOf(m: THREE.Material): number {
  return (m.userData.uvScale as number | undefined) ?? 4;
}

function textured(map: THREE.Texture, uvScale: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...opts });
  m.userData.uvScale = uvScale;
  return m;
}

/** The material library for the industrial map. Textures are shared between tinted variants. */
export function industrialMaterials(maxAnisotropy: number) {
  const aniso = (t: THREE.Texture) => ((t.anisotropy = Math.min(8, maxAnisotropy)), t);
  const concrete = aniso(concreteTexture(3));
  const concrete2 = aniso(concreteTexture(31));
  const brick = aniso(brickTexture());
  const corrRust = aniso(corrugatedTexture(true, 9));
  const corrClean = aniso(corrugatedTexture(false, 19));
  const rust = aniso(rustTexture());
  const wood = aniso(woodTexture());
  const asphalt = aniso(asphaltTexture());

  const color = (c: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color: c, roughness, metalness });

  return {
    concrete: textured(concrete, 4),
    concreteDark: textured(concrete2, 4, { color: 0xa39f96 }),
    concreteWarm: textured(concrete2, 4, { color: 0xd8cdb8 }),
    brick: textured(brick, 2.4),
    sheetRust: textured(corrRust, 2, { color: 0xc8a48a, roughness: 0.75, metalness: 0.25 }),
    sheetGrey: textured(corrClean, 2, { color: 0xb8bcc0, roughness: 0.55, metalness: 0.45 }),
    sheetGreen: textured(corrClean, 2, { color: 0x6f9a7c, roughness: 0.65, metalness: 0.3 }),
    containerRed: textured(corrRust, 1.2, { color: 0xb5452e, roughness: 0.7, metalness: 0.3 }),
    containerBlue: textured(corrClean, 1.2, { color: 0x3c6fa3, roughness: 0.7, metalness: 0.3 }),
    containerGreen: textured(corrClean, 1.2, { color: 0x3e8a57, roughness: 0.7, metalness: 0.3 }),
    containerYellow: textured(corrClean, 1.2, { color: 0xd7a530, roughness: 0.7, metalness: 0.3 }),
    containerGrey: textured(corrClean, 1.2, { color: 0x9a9a9a, roughness: 0.6, metalness: 0.35 }),
    rust: textured(rust, 1.5, { roughness: 0.85, metalness: 0.35 }),
    wood: textured(wood, 1.5, { roughness: 0.95 }),
    road: textured(asphalt, 20, { roughness: 0.95 }),
    steel: color(0x80858c, 0.45, 0.7),
    darkSteel: color(0x3b3e42, 0.5, 0.6),
    craneYellow: color(0xe3a21a, 0.5, 0.35),
    paintRed: color(0xb3261e, 0.55, 0.2),
    paintWhite: color(0xe8e6df, 0.6, 0.05),
    cable: color(0x1e1e1e, 0.7, 0.2),
    rubber: color(0x1c1c1c, 0.9, 0),
    glassDark: color(0x23303a, 0.15, 0.6),
    siloWhite: textured(concrete, 4, { color: 0xe6e1d4 }),
    tarp: color(0x2f5d8a, 0.9, 0),
  };
}

export type IndustrialMaterials = ReturnType<typeof industrialMaterials>;
