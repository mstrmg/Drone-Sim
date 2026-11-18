import * as THREE from 'three';

/**
 * Photo-scanned PBR texture sets from ambientCG (CC0), stored as small WebP files and inlined into the build as data
 * URLs, so the app still makes no network requests. Each set has a colour (c), OpenGL normal (n) and roughness (r)
 * map.
 */
const URLS = import.meta.glob('./assets/pbr/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type PbrName = 'grass' | 'asphalt' | 'brick' | 'concrete' | 'concrete-dirty' | 'concrete-smooth' | 'dirt' | 'metal' | 'wood' | 'rock';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

let loader: THREE.TextureLoader | null = null;
const cache = new Map<string, THREE.Texture>();

export function pbrTexture(name: PbrName, kind: 'c' | 'n' | 'r', maxAnisotropy: number): THREE.Texture {
  const key = `${name}_${kind}`;
  let tex = cache.get(key);
  if (!tex) {
    const url = URLS[`./assets/pbr/${key}.webp`];
    if (!url) throw new Error(`Missing texture ${key}`);
    loader ??= new THREE.TextureLoader();
    tex = loader.load(url);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = kind === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    cache.set(key, tex);
  }
  tex.anisotropy = Math.min(kind === 'c' ? 16 : 8, maxAnisotropy);
  return tex;
}

export function pbrSet(name: PbrName, maxAnisotropy: number): PbrSet {
  return {
    map: pbrTexture(name, 'c', maxAnisotropy),
    normalMap: pbrTexture(name, 'n', maxAnisotropy),
    roughnessMap: pbrTexture(name, 'r', maxAnisotropy),
  };
}

/** A 1 × 1 texture of one colour, for layers without a normal or roughness map. */
export function flatTexture(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
