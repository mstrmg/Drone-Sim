import * as THREE from 'three';
import { pbrSet, type PbrName } from './pbr';
import { corrugationNormal } from './textures';

/** Texture tile size in metres, read by the builder's world-space UV mapping. */
export function uvScaleOf(m: THREE.Material): number {
  return (m.userData.uvScale as number | undefined) ?? 4;
}

/** The material library for the industrial map: photo-scanned PBR sets, tinted where variants are needed. */
export function industrialMaterials(maxAnisotropy: number) {
  const corr = corrugationNormal(8);
  corr.wrapS = corr.wrapT = THREE.RepeatWrapping;
  corr.anisotropy = Math.min(8, maxAnisotropy);

  const pbr = (name: PbrName, uvScale: number, opts: THREE.MeshStandardMaterialParameters = {}, normalScale = 1) => {
    const set = pbrSet(name, maxAnisotropy);
    const m = new THREE.MeshStandardMaterial({ ...set, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(normalScale, normalScale), ...opts });
    m.userData.uvScale = uvScale;
    return m;
  };
  /** Corrugated sheet: the scanned metal's colour and roughness with a ridged normal map. */
  const sheet = (color: number, uvScale: number, metalness = 0.35, roughness = 1) => pbr('metal', uvScale, { color, metalness, roughness, normalMap: corr }, 0.7);
  const color = (c: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color: c, roughness, metalness });

  return {
    concrete: pbr('concrete', 3),
    concreteDark: pbr('concrete-dirty', 3, { color: 0xc4c0b8 }),
    concreteWarm: pbr('concrete-smooth', 3, { color: 0xe6dcc8 }),
    brick: pbr('brick', 1.3),
    sheetRust: sheet(0xc98a60, 2.2, 0.3),
    sheetGrey: sheet(0xd6dade, 2.2, 0.5),
    sheetGreen: sheet(0x86b896, 2.2, 0.35),
    containerRed: sheet(0xe0644a, 2.4, 0.35),
    containerBlue: sheet(0x5f95d0, 2.4, 0.35),
    containerGreen: sheet(0x5fb07a, 2.4, 0.35),
    containerYellow: sheet(0xf2c25a, 2.4, 0.35),
    containerGrey: sheet(0xc2c2c2, 2.4, 0.4),
    rust: pbr('metal', 1.5, { color: 0xc07a4c, metalness: 0.4 }),
    wood: pbr('wood', 1.5, { color: 0xc8b49a }),
    woodDark: pbr('wood', 1.5, { color: 0x6e5c4c }),
    road: pbr('asphalt', 4),
    steel: pbr('metal', 2, { color: 0xc0c4ca, metalness: 0.75, roughness: 0.8 }, 0.5),
    darkSteel: pbr('metal', 2, { color: 0x6a6e74, metalness: 0.6, roughness: 0.9 }, 0.5),
    craneYellow: pbr('metal', 2, { color: 0xf5b62a, metalness: 0.3, roughness: 0.8 }, 0.4),
    paintRed: pbr('metal', 2, { color: 0xd8483a, metalness: 0.2, roughness: 0.85 }, 0.4),
    paintWhite: pbr('metal', 2, { color: 0xf6f6f2, metalness: 0.15, roughness: 0.7 }, 0.3),
    cable: color(0x1e1e1e, 0.7, 0.2),
    rubber: color(0x1c1c1c, 0.9, 0),
    glassDark: color(0x23303a, 0.15, 0.6),
    siloWhite: pbr('concrete-smooth', 4, { color: 0xf2ede2 }),
    tarp: color(0x2f5d8a, 0.9, 0),
  };
}

export type IndustrialMaterials = ReturnType<typeof industrialMaterials>;
