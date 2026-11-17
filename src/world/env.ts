import * as THREE from 'three';
import type { Collider } from '../sim/colliders';
import { seededRandom } from './rand';
import { canvasTexture } from './textures';

export { seededRandom };

/** A loaded level: everything the main loop needs. */
export interface Field {
  group: THREE.Group;
  colliders: Collider[];
  spawn: THREE.Vector3;
  spawnYaw: number;
  sun: THREE.DirectionalLight;
  /** Unit vector toward the sun; the main loop keeps the shadow camera on the quad along it. */
  sunDir: THREE.Vector3;
  fog: THREE.Fog | THREE.FogExp2;
  /** Sky dome, also used to build the image-based lighting environment. */
  sky: Sky;
  /** Ground height under a point, for the OSD altitude and the chase camera. */
  groundHeight: (x: number, z: number) => number;
}

/** Mown grass with two stripes per tile and noise for motion cues at low altitude. */
export function mowedGrassTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g, rnd) => {
    const size = 512;
    g.fillStyle = '#4c7a34';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#56853b';
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

export interface SkyOptions {
  sunDir: THREE.Vector3;
  top?: number;
  horizon?: number;
  ground?: number;
  sunColor?: number;
  /** 0 = clear, 1 = overcast. */
  cloudCover?: number;
}

export interface Sky {
  mesh: THREE.Mesh;
  /** Advance cloud drift. */
  update(seconds: number): void;
  horizon: THREE.Color;
}

/** Gradient sky with a sun disc and glow, and drifting procedural clouds. */
export function makeSky(o: SkyOptions): Sky {
  const horizon = new THREE.Color(o.horizon ?? 0xc9dcec);
  const uniforms = {
    top: { value: new THREE.Color(o.top ?? 0x3d7cc9) },
    horizon: { value: horizon },
    ground: { value: new THREE.Color(o.ground ?? 0x8fa38a) },
    sunDir: { value: o.sunDir.clone().normalize() },
    sunColor: { value: new THREE.Color(o.sunColor ?? 0xfff1d6) },
    cover: { value: o.cloudCover ?? 0.45 },
    time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
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
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float cover;
      uniform float time;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, ground, min(1.0, -h * 6.0));

        float sd = max(dot(d, normalize(sunDir)), 0.0);
        // Warm haze around the sun near the horizon.
        col += sunColor * pow(sd, 6.0) * 0.25 * (1.0 - smoothstep(0.0, 0.6, h));
        col += sunColor * pow(sd, 64.0) * 0.5;

        if (h > 0.0) {
          // Clouds on a plane above the camera.
          vec2 uv = d.xz / (h + 0.08) * 1.6 + vec2(time * 0.006, time * 0.002);
          float n = fbm(uv);
          float c = smoothstep(1.0 - cover, 1.15 - cover * 0.6, n);
          c *= smoothstep(0.0, 0.18, h);
          float lit = 0.75 + 0.35 * pow(sd, 3.0);
          vec3 cloud = mix(vec3(0.78, 0.8, 0.85), vec3(1.0, 0.98, 0.95), fbm(uv * 1.7 + 3.1)) * lit;
          col = mix(col, cloud, c * 0.9);
        }
        // Sun disc in front of the clouds' thin parts.
        col += sunColor * smoothstep(0.9993, 0.9997, sd) * 4.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    horizon,
    update(seconds: number) {
      uniforms.time.value = seconds;
    },
  };
}

/** Skylight fill plus a shadow-casting sun. The main loop keeps the shadow area centered on the quad. */
export function addLights(
  group: THREE.Group,
  sunDir: THREE.Vector3,
  o: { sunColor?: number; sunIntensity?: number; skyColor?: number; groundColor?: number; hemi?: number; ambient?: number; shadowSize?: number; shadowRange?: number } = {},
): THREE.DirectionalLight {
  group.add(new THREE.HemisphereLight(o.skyColor ?? 0xcfe3ff, o.groundColor ?? 0x6b6f5a, o.hemi ?? 1.1));
  // Bounce light so undersides and interiors (decks, roofs, buildings) are not pitch black.
  if ((o.ambient ?? 0.45) > 0) group.add(new THREE.AmbientLight(0xdfe6ee, o.ambient ?? 0.45));
  const sun = new THREE.DirectionalLight(o.sunColor ?? 0xfff2dd, o.sunIntensity ?? 2.4);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.castShadow = true;
  const size = o.shadowSize ?? 2048;
  sun.shadow.mapSize.set(size, size);
  const r = o.shadowRange ?? 70;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -r;
  sc.right = sc.top = r;
  sc.near = 1;
  sc.far = 450;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);
  return sun;
}

/**
 * Ground mesh, optionally displaced by a height function and tinted per vertex.
 * The texture repeats every `tileMeters`.
 */
export function groundMesh(
  tex: THREE.Texture,
  maxAnisotropy: number,
  tileMeters: number,
  size = 2000,
  height?: (x: number, z: number) => number,
  segments = 200,
  tint?: (x: number, z: number, y: number, slope: number) => [number, number, number],
): THREE.Mesh {
  const seg = height || tint ? segments : 1;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  if (height) {
    for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  if (tint) {
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = tint(pos.getX(i), pos.getZ(i), pos.getY(i), 1 - nor.getY(i));
      colors.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  tex.repeat.set(size / tileMeters, size / tileMeters);
  tex.anisotropy = maxAnisotropy;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, vertexColors: !!tint }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat textured patch lying just above the ground (pads, car parks). Visual only. */
export function decal(tex: THREE.Texture, w: number, d: number, x: number, z: number, tileMeters: number, y = 0.01, yaw = 0, roughness = 0.95): THREE.Mesh {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / tileMeters, d / tileMeters);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness }));
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
