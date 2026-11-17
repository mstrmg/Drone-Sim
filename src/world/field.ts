import * as THREE from 'three';
import { BoxCollider, CylinderCollider, GroundCollider, type Collider } from '../sim/colliders';

/** The practice field: ground, sky, lights and obstacles, built from simple shapes. Each mesh gets a matching collider. */
export interface Field {
  group: THREE.Group;
  colliders: Collider[];
  spawn: THREE.Vector3;
  spawnYaw: number;
  sun: THREE.DirectionalLight;
}

class Builder {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [new GroundCollider(0)];
  private readonly mats = new Map<string, THREE.Material>();

  mat(color: number, roughness = 0.9, metalness = 0): THREE.Material {
    const key = `${color}-${roughness}-${metalness}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      this.mats.set(key, m);
    }
    return m;
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, yaw = 0, collide = true): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collide) this.colliders.push(new BoxCollider(new THREE.Vector3(x, y, z), new THREE.Vector3(sx, sy, sz), yaw));
    return mesh;
  }

  /** Box placed on the ground, with a local offset rotated by yaw around an anchor. */
  boxAt(anchor: THREE.Vector3, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.box(anchor.x + lx * c + lz * s, ly, anchor.z - lx * s + lz * c, sx, sy, sz, color, yaw);
  }

  cylinder(x: number, z: number, y0: number, y1: number, r: number, color: number, segments = 16): void {
    const h = y1 - y0;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), this.mat(color, 0.8));
    mesh.position.set(x, y0 + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.colliders.push(new CylinderCollider(x, z, y0, y1, r));
  }

  tree(x: number, z: number, scale: number): void {
    const trunkH = 2.8 * scale;
    this.cylinder(x, z, 0, trunkH + 0.5, 0.22 * scale, 0x5a3d26, 8);
    const foliage = this.mat(0x2f5d2a, 1);
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const r = (2.4 - i * 0.55) * scale;
      const h = (3.2 - i * 0.4) * scale;
      const y = trunkH + i * 1.6 * scale;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), foliage);
      cone.position.set(x, y + h / 2, z);
      cone.castShadow = true;
      cone.receiveShadow = true;
      this.group.add(cone);
    }
    // Foliage collider: a cylinder about 60% of the cone width (gaps through the tips are flyable).
    this.colliders.push(new CylinderCollider(x, z, trunkH, trunkH + 2 * 1.6 * scale + 2.4 * scale, 1.3 * scale));
  }

  /** Race gate: two posts and a top bar, opening w × h, facing along yaw. */
  gate(x: number, z: number, yaw: number, color: number, w = 2.6, h = 2.0): void {
    const t = 0.18;
    const anchor = new THREE.Vector3(x, 0, z);
    this.boxAt(anchor, yaw, -(w / 2 + t / 2), (h + t) / 2, 0, t, h + t, t, color);
    this.boxAt(anchor, yaw, w / 2 + t / 2, (h + t) / 2, 0, t, h + t, t, color);
    this.boxAt(anchor, yaw, 0, h + t / 2, 0, w + 2 * t, t, t, color);
  }

  container(x: number, y: number, z: number, yaw: number, color: number): void {
    this.box(x, y + 1.3, z, 2.44, 2.6, 12.2, color, yaw);
  }
}

function groundTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // Two mowing stripes per tile.
  g.fillStyle = '#4c7a34';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#56853b';
  g.fillRect(0, 0, size / 2, size);
  // Grass noise for motion cues at low altitude.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
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
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2500, 32, 16);
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function buildField(maxAnisotropy: number): Field {
  const b = new Builder();
  const { group } = b;

  // --- Ground
  const tex = groundTexture();
  const tileMeters = 16;
  const groundSize = 2000;
  tex.repeat.set(groundSize / tileMeters, groundSize / tileMeters);
  tex.anisotropy = maxAnisotropy;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Launch pad (visual only).
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0x5a5c62, roughness: 0.95 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.005;
  pad.receiveShadow = true;
  group.add(pad);

  group.add(sky());

  // --- Lights
  group.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 1.1));
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

  // --- Gates: a loose line from the pad out to the bando.
  b.gate(0, -22, 0, 0xff6a13);
  b.gate(12, -45, -0.4, 0x1e90ff);
  b.gate(-6, -70, 0.5, 0xff6a13);
  b.gate(-20, -40, Math.PI / 2, 0xe8e83a, 3, 2.4);

  // --- Container yard with a gap between stacks.
  b.container(-30, 0, -95, 0.3, 0x9c3a26);
  b.container(-26.2, 0, -96.2, 0.3, 0x2d5f8a); // 1.4 m gap to the first stack
  b.container(-30, 2.6, -95, 0.3, 0x2f7d4a);
  b.container(-18, 0, -100, 0.3, 0xb48a2c);
  b.container(-18, 2.6, -100, 0.3, 0x9c3a26);
  b.container(-18, 5.2, -100, 0.3, 0x2d5f8a);
  b.container(-42, 0, -108, Math.PI / 2 + 0.3, 0x707070);

  // --- "Bando": a two-storey concrete frame to dive through.
  const bx = 38;
  const bz = -85;
  const concrete = 0x9a9a96;
  for (const px of [-6, 0, 6]) {
    for (const pz of [-5, 5]) b.box(bx + px, 4, bz + pz, 0.5, 8, 0.5, concrete);
  }
  b.box(bx, 4.15, bz - 2.6, 12.5, 0.3, 5.5, concrete); // half floor at level 1 (open half for dives)
  b.box(bx, 8.15, bz, 12.5, 0.3, 10.5, concrete); // roof
  b.box(bx - 6, 1.2, bz, 0.3, 2.4, 10, 0x8a8a86); // low wall on one side
  b.box(bx + 9, 2.5, bz + 8, 3, 5, 3, 0xa7a49a); // stairwell block

  // --- Arch to fly under.
  b.box(-35, 3, -20, 1.4, 6, 1.4, 0xb0a596);
  b.box(-25, 3, -20, 1.4, 6, 1.4, 0xb0a596);
  b.box(-30, 6.6, -20, 11.4, 1.2, 1.6, 0xb0a596);

  // --- Tall pole for power loops and dives, with a crossbar.
  b.cylinder(10, -130, 0, 32, 0.45, 0x8d8d8d, 20);
  b.box(10, 28, -130, 8, 0.4, 0.4, 0x6d6d6d);

  // --- Slalom poles.
  for (let i = 0; i < 6; i++) b.cylinder(22 + (i % 2) * 3, -15 - i * 7, 0, 3, 0.08, i % 2 ? 0xffffff : 0xff3030, 10);

  // --- Concrete blocks and a low wall for proximity.
  b.box(8, 0.6, -8, 2.4, 1.2, 1.2, 0x8f8f8a, 0.2);
  b.box(10.5, 0.6, -9, 2.4, 1.2, 1.2, 0x8f8f8a, 0.25);
  b.box(9.2, 1.8, -8.5, 2.4, 1.2, 1.2, 0x8f8f8a, 0.22);
  b.box(-12, 1, -60, 20, 2, 0.4, 0xa39a8a, -0.15);

  // --- Trees around the edges, deterministic.
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 70 + rnd() * 110;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist - 60;
    if (Math.hypot(x, z) < 30) continue;
    b.tree(x, z, 0.8 + rnd() * 0.7);
  }
  // A small cluster near the field for tight lines.
  b.tree(-8, -32, 1.0);
  b.tree(-11, -36, 1.2);
  b.tree(-5, -38, 0.9);

  return { group, colliders: b.colliders, spawn: new THREE.Vector3(0, 0.05, 0), spawnYaw: 0, sun };
}
