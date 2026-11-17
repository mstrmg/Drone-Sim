import * as THREE from 'three';
import { GroundCollider } from '../../sim/colliders';
import { Builder } from '../builder';
import { addLights, grassTexture, groundMesh, seededRandom, sky, type Field } from '../env';

/** The open practice field from milestone 1: gates, containers, a small concrete frame, poles and trees. */
export function buildPracticeField(maxAnisotropy: number): Field {
  const b = new Builder();
  b.colliders.push(new GroundCollider(0));
  const group = b.group;
  group.add(groundMesh(grassTexture(), maxAnisotropy, 16));
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0x5a5c62, roughness: 0.95 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.005;
  pad.receiveShadow = true;
  group.add(pad, sky());
  const sun = addLights(group);

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
  const rnd = seededRandom(1234);
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

  b.finish();
  return { group, colliders: b.colliders, spawn: new THREE.Vector3(0, 0.05, 0), spawnYaw: 0, sun, groundHeight: () => 0 };
}
