import * as THREE from 'three';
import { MOTOR_LAYOUT } from '../sim/quad';
import type { QuadParams } from '../sim/params';

/** Visual model of the 5" quad, built from primitives. Only seen in the chase view. */
export class QuadModel {
  readonly root = new THREE.Group();
  /** Mount point for the FPV camera (rotate about x for uptilt). */
  readonly cameraMount = new THREE.Group();
  private readonly props: THREE.Group[] = [];
  private readonly discs: THREE.Mesh[] = [];
  private readonly angles = [0, 0, 0, 0];

  constructor(params: QuadParams) {
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.45, metalness: 0.3 });
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x8b1e1e, roughness: 0.35, metalness: 0.7 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x14d0e0, roughness: 0.5 });
    const batteryMat = new THREE.MeshStandardMaterial({ color: 0x2a3a6a, roughness: 0.7 });
    const camMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });

    const { x: ox, z: oz } = params.motorOffset;
    const add = (m: THREE.Mesh) => {
      m.castShadow = true;
      this.root.add(m);
      return m;
    };

    // Center plate and two diagonal arms.
    add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.004, 0.11), carbon));
    const armLen = Math.hypot(ox, oz) * 2 + 0.03;
    for (const sgn of [1, -1]) {
      const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.005, armLen), carbon));
      arm.rotation.y = sgn * Math.PI / 4;
    }
    // Stack, top plate and standoffs.
    add(new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.018, 0.032), new THREE.MeshStandardMaterial({ color: 0x1f5a2a })))
      .position.set(0, 0.012, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.003, 0.1), carbon)).position.set(0, 0.026, 0);
    // Battery strapped on top.
    add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.075), batteryMat)).position.set(0, 0.044, 0.005);
    // Camera between side plates at the front.
    const cam = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), camMat));
    cam.position.set(0, 0.014, -0.055);
    const lens = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.01, 12), camMat));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.014, -0.068);

    MOTOR_LAYOUT.forEach((m) => {
      const x = m.x * ox;
      const z = m.z * oz;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 16), motorMat)).position.set(x, 0.011, z);
      const prop = new THREE.Group();
      prop.position.set(x, params.propHeight + 0.004, z);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, 0.012), propMat);
        blade.position.x = 0.03;
        const holder = new THREE.Group();
        holder.rotation.y = (b * Math.PI * 2) / 3;
        holder.add(blade);
        prop.add(holder);
      }
      this.root.add(prop);
      this.props.push(prop);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.0635, 24),
        new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0, depthWrite: false }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(prop.position);
      this.root.add(disc);
      this.discs.push(disc);
    });

    this.cameraMount.position.set(0, 0.014, -0.07);
    this.root.add(this.cameraMount);
  }

  update(motorSpeed: readonly number[], dt: number, omegaMax: number): void {
    for (let i = 0; i < 4; i++) {
      const s = motorSpeed[i];
      // Visually slow the spin down (aliasing) and fade in a blur disc at speed.
      this.angles[i] += MOTOR_LAYOUT[i].spin * Math.min(s * omegaMax * dt, 0.9);
      this.props[i].rotation.y = this.angles[i];
      this.props[i].visible = s < 0.25;
      (this.discs[i].material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, s * 1.2);
    }
  }
}
