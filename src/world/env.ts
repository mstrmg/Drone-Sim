import * as THREE from 'three';
import type { Collider } from '../sim/colliders';

/** A loaded level: everything the main loop needs. */
export interface Field {
  group: THREE.Group;
  colliders: Collider[];
  spawn: THREE.Vector3;
  spawnYaw: number;
  sun: THREE.DirectionalLight;
  /** Ground height under a point, for the OSD altitude. */
  groundHeight: (x: number, z: number) => number;
}

export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed = 7): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, seededRandom(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mown grass with two stripes per tile and noise for motion cues at low altitude. */
export function grassTexture(base = '#4c7a34', stripe = '#56853b'): THREE.CanvasTexture {
  return canvasTexture(512, (g, rnd) => {
    const size = 512;
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    g.fillStyle = stripe;
    g.fillRect(0, 0, size / 2, size);
    for (let i = 0; i < 14000; i++) {
      const v = Math.floor(rnd() * 40) - 20;
      g.fillStyle = `rgba(${60 + v},${110 + v},${40 + v / 2},0.55)`;
      g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(120,100,60,${0.15 + rnd() * 0.2})`;
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, 2 + rnd() * 6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Rough, unkempt grass without mowing stripes. */
export function wildGrassTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (g, rnd) => {
      g.fillStyle = '#5b7a3a';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 22000; i++) {
        const v = Math.floor(rnd() * 50) - 25;
        g.fillStyle = `rgba(${80 + v},${110 + v},${45 + v / 2},0.5)`;
        g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 4, 2 + rnd() * 4);
      }
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(${130 + rnd() * 30},${110 + rnd() * 20},70,${0.12 + rnd() * 0.2})`;
        g.beginPath();
        g.arc(rnd() * 512, rnd() * 512, 3 + rnd() * 10, 0, Math.PI * 2);
        g.fill();
      }
    },
    11,
  );
}

/** Weathered asphalt with cracks and faded parking lines. */
export function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (g, rnd) => {
      g.fillStyle = '#4a4b4e';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 26000; i++) {
        const v = Math.floor(rnd() * 40) - 20;
        g.fillStyle = `rgba(${75 + v},${76 + v},${80 + v},0.6)`;
        g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      g.strokeStyle = 'rgba(25,25,25,0.6)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 18; i++) {
        let x = rnd() * 512;
        let y = rnd() * 512;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (rnd() - 0.5) * 40;
          y += (rnd() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      // Faded parking bay lines.
      g.fillStyle = 'rgba(220,220,200,0.35)';
      for (let i = 0; i < 4; i++) g.fillRect(i * 128 + 2, 0, 5, 200);
      g.fillRect(0, 200, 512, 5);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(60,90,40,${0.2 + rnd() * 0.3})`; // weeds through cracks
        g.fillRect(rnd() * 512, rnd() * 512, 3 + rnd() * 5, 3 + rnd() * 5);
      }
    },
    23,
  );
}

export function sky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d7cc9) },
      horizon: { value: new THREE.Color(0xc9dcec) },
      ground: { value: new THREE.Color(0x8fa38a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 6.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Hemisphere fill plus a shadow-casting sun. The main loop keeps the shadow area centered on the quad. */
export function addLights(group: THREE.Group): THREE.DirectionalLight {
  group.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b6f5a, 1.1));
  // Bounce light so undersides and interiors (decks, roofs, the factory) are not pitch black.
  group.add(new THREE.AmbientLight(0xdfe6ee, 0.45));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);
  return sun;
}

/** Ground mesh, optionally displaced by a height function. Texture repeats every `tileMeters`. */
export function groundMesh(
  tex: THREE.Texture,
  maxAnisotropy: number,
  tileMeters: number,
  size = 2000,
  height?: (x: number, z: number) => number,
  segments = 200,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, height ? segments : 1, height ? segments : 1);
  geo.rotateX(-Math.PI / 2);
  if (height) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
  }
  tex.repeat.set(size / tileMeters, size / tileMeters);
  tex.anisotropy = maxAnisotropy;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat textured patch lying just above the ground (pads, car parks). Visual only. */
export function decal(tex: THREE.Texture, w: number, d: number, x: number, z: number, tileMeters: number, y = 0.01, yaw = 0): THREE.Mesh {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / tileMeters, d / tileMeters);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  mesh.rotation.set(-Math.PI / 2, 0, yaw);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Frees GPU memory held by a level that is being unloaded. */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
