import * as THREE from 'three';
import './style.css';
import { FlightController, DEFAULT_PIDS, type Sticks } from './fc/flightController';
import { InputManager, shortName } from './input/inputManager';
import { QuadModel } from './render/quadModel';
import { SETTINGS_KEY, loadSettings } from './settings';
import { FREESTYLE_5IN } from './sim/params';
import { Quad } from './sim/quad';
import { Menu } from './ui/menu';
import { Osd } from './ui/osd';
import { ColliderGrid, type Collider } from './sim/colliders';
import { disposeGroup, type Field } from './world/env';
import { MAPS, type MapId } from './world/maps';

/** Physics and flight controller loop rate. Rendering runs at display rate, decoupled. */
const PHYS_HZ = 1000;
const PHYS_DT = 1 / PHYS_HZ;
const MAX_STEPS_PER_FRAME = 200;
/** Impact speed (m/s) above which a hit counts as a crash. */
const CRASH_SPEED = 7;
const ARM_MAX_THROTTLE = 0.08;
const OUT_OF_BOUNDS = 900;

const app = document.getElementById('app')!;
const settings = loadSettings();
const firstVisit = !localStorage.getItem(SETTINGS_KEY);

// ---------------------------------------------------------------- Rendering setup
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget: THREE.WebGLRenderTarget | null = null;
let field: Field;
let grid: ColliderGrid;
let currentMap: MapId | null = null;

function loadMap(id: MapId): void {
  if (field) {
    scene.remove(field.group);
    disposeGroup(field.group);
  }
  field = MAPS[id].build(renderer.capabilities.getMaxAnisotropy());
  scene.add(field.group);
  scene.fog = field.fog;
  grid = new ColliderGrid(field.colliders);
  // Image-based lighting from the sky, so metal and shaded sides pick up the sky colour.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(field.sky.mesh.geometry, field.sky.mesh.material));
  envTarget?.dispose();
  envTarget = pmrem.fromScene(envScene, 0.04, 0.1, 3000);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.55;
  currentMap = id;
}
loadMap(settings.map);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.03, 1500);

const quad = new Quad(FREESTYLE_5IN);
const model = new QuadModel(FREESTYLE_5IN);
scene.add(model.root);

const fc = new FlightController(settings.rates, structuredClone(DEFAULT_PIDS), PHYS_DT);
const input = new InputManager(settings);
const osd = new Osd(app);
const toast = document.createElement('div');
toast.className = 'toast hidden';
app.appendChild(toast);

const menu = new Menu(app, settings, input, applySettings);

// ---------------------------------------------------------------- Game state
const state = {
  armed: false,
  crashed: false,
  flightTime: 0,
  tookOff: false,
  chase: false,
  warning: '',
  warningUntil: 0,
  /** Turtle mode: 'pending' while selected and disarmed, 'active' while armed and flipping. */
  turtle: 'off' as 'off' | 'pending' | 'active',
};
let prevSticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
let accumulator = 0;
const chasePos = new THREE.Vector3();
const nearby: Collider[] = [];

function applySettings(): void {
  if (settings.map !== currentMap) {
    loadMap(settings.map);
    resetQuad();
  }
  fc.rates = settings.rates;
  fc.mode = settings.flightMode;
  quad.realism = { propWash: settings.realism.propWash, battery: settings.realism.battery, damage: settings.realism.crashes === 'damage' };
  setFov();
}

function setFov(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const hfov = state.chase ? 90 : settings.camera.fov;
  camera.fov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function resetQuad(): void {
  quad.reset(field.spawn, field.spawnYaw);
  fc.reset();
  state.armed = false;
  state.crashed = false;
  state.flightTime = 0;
  state.tookOff = false;
  state.turtle = 'off';
  quad.turtle = false;
  chasePos.set(0, 1.2, 3);
}

function warn(text: string): void {
  state.warning = text;
  state.warningUntil = performance.now() + 1500;
}

function showToast(text: string, ms = 3000): void {
  toast.textContent = text;
  toast.classList.remove('hidden');
  window.clearTimeout((showToast as unknown as { t?: number }).t);
  (showToast as unknown as { t?: number }).t = window.setTimeout(() => toast.classList.add('hidden'), ms);
}

function tryArm(throttle: number): void {
  if (state.crashed) return warn('RESET FIRST');
  if (throttle > ARM_MAX_THROTTLE) return warn('THROTTLE HIGH · LOWER TO ARM');
  state.armed = true;
  if (state.turtle === 'pending') state.turtle = 'active';
  quad.turtle = state.turtle === 'active';
  fc.reset();
}

function disarm(turtleSwitchOn: boolean | null): void {
  state.armed = false;
  if (state.turtle === 'active') state.turtle = turtleSwitchOn ? 'pending' : 'off';
  quad.turtle = false;
}

// ---------------------------------------------------------------- Main loop
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const inp = input.poll(dt);
  if (inp.menuToggle) menu.toggle();
  menu.update(inp.sticks);

  if (!menu.isOpen) {
    if (inp.reset) resetQuad();
    if (inp.cameraToggle) {
      state.chase = !state.chase;
      setFov();
    }
    if (inp.modeSwitch !== null) settings.flightMode = inp.modeSwitch ? 'angle' : 'acro';
    else if (inp.modeToggle) settings.flightMode = settings.flightMode === 'acro' ? 'angle' : 'acro';
    fc.mode = settings.flightMode;

    // Turtle mode is selected while disarmed: a switch holds it, a button or key toggles it.
    if (inp.turtleSwitch !== null) {
      if (!state.armed) state.turtle = inp.turtleSwitch ? 'pending' : 'off';
    } else if (inp.turtleToggle && !state.armed) {
      state.turtle = state.turtle === 'off' ? 'pending' : 'off';
    }

    if (inp.armSwitch !== null) {
      if (inp.armSwitch && !state.armed && !state.crashed) {
        if (inp.sticks.throttle <= ARM_MAX_THROTTLE) tryArm(inp.sticks.throttle);
        else if (performance.now() > state.warningUntil) warn('THROTTLE HIGH · LOWER TO ARM');
      } else if (!inp.armSwitch && state.armed) disarm(inp.turtleSwitch);
    } else if (inp.armToggle) {
      if (state.armed) disarm(inp.turtleSwitch);
      else tryArm(inp.sticks.throttle);
    }

    // Fixed-step physics; sticks are interpolated across sub-steps so setpoints stay smooth.
    accumulator += dt;
    let steps = Math.floor(accumulator / PHYS_DT);
    accumulator -= steps * PHYS_DT;
    steps = Math.min(steps, MAX_STEPS_PER_FRAME);
    grid.query(quad.position, 2 + quad.velocity.length() * Math.max(dt, steps * PHYS_DT) * 1.5, nearby);
    const s0 = prevSticks;
    const s1 = inp.sticks;
    const sticks: Sticks = { ...s1 };
    for (let i = 0; i < steps; i++) {
      const a = (i + 1) / steps;
      sticks.roll = s0.roll + (s1.roll - s0.roll) * a;
      sticks.pitch = s0.pitch + (s1.pitch - s0.pitch) * a;
      sticks.yaw = s0.yaw + (s1.yaw - s0.yaw) * a;
      sticks.throttle = s0.throttle + (s1.throttle - s0.throttle) * a;
      let out: number[] | null = null;
      if (state.armed) out = state.turtle === 'active' ? fc.turtleMix(sticks, quad.orientation) : fc.update(sticks, quad.gyroDegPerSec(), quad.orientation);
      const res = quad.step(PHYS_DT, out, nearby);
      if (settings.realism.crashes === 'classic' && res.impactSpeed > CRASH_SPEED && !state.crashed) {
        state.crashed = true;
        state.armed = false;
      }
      if (state.armed) {
        if (!res.touching) state.tookOff = true;
        if (state.tookOff) state.flightTime += PHYS_DT;
      }
    }
    prevSticks = { ...s1 };
    if (state.armed && settings.realism.battery && quad.battery.cellVoltage < 3.4 && performance.now() > state.warningUntil) warn('LOW BATTERY · LAND');
    if (quad.position.length() > OUT_OF_BOUNDS || quad.position.y < field.groundHeight(quad.position.x, quad.position.z) - 5 || !Number.isFinite(quad.position.y)) resetQuad();
  } else {
    prevSticks = { ...inp.sticks };
  }

  // ---- Render
  model.root.position.copy(quad.position);
  model.root.quaternion.copy(quad.orientation);
  model.update(quad.motorSpeed, dt, FREESTYLE_5IN.omegaMax);
  model.cameraMount.rotation.x = (settings.camera.uptilt * Math.PI) / 180;

  if (state.chase) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quad.orientation);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const target = quad.position.clone().addScaledVector(fwd, -2.4).add(new THREE.Vector3(0, 0.9, 0));
    target.y = Math.max(target.y, field.groundHeight(target.x, target.z) + 0.3);
    chasePos.lerp(target, 1 - Math.exp(-dt * 6));
    camera.position.copy(chasePos);
    camera.lookAt(quad.position);
    model.root.visible = true;
  } else {
    model.root.updateMatrixWorld(true);
    model.cameraMount.getWorldPosition(camera.position);
    model.cameraMount.getWorldQuaternion(camera.quaternion);
    model.root.visible = false;
  }

  // Keep the shadow area centered on the quad.
  field.sun.position.copy(quad.position).addScaledVector(field.sunDir, 150);
  field.sun.target.position.copy(quad.position);
  field.sky.mesh.position.copy(camera.position);
  field.sky.update(now / 1000);

  if (performance.now() > state.warningUntil) state.warning = '';
  osd.update({
    armed: state.armed,
    crashed: state.crashed,
    throttle: inp.sticks.throttle,
    flightTime: state.flightTime,
    mode: settings.flightMode,
    airmode: state.armed && fc.isAirmodeActive,
    speedKmh: quad.velocity.length() * 3.6,
    altitude: Math.max(0, quad.position.y - field.groundHeight(quad.position.x, quad.position.z) - 0.035),
    source: inp.sourceName,
    warning: state.warning,
    chase: state.chase,
    battery: settings.realism.battery ? { voltage: quad.battery.voltage, cells: quad.battery.p.cells, mah: quad.battery.usedAh * 1000 } : null,
    props: settings.realism.crashes === 'damage' ? quad.propHealth : null,
    turtle: state.turtle,
    propsBroken: settings.realism.crashes === 'damage' && quad.allPropsBroken,
  });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  setFov();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && !(e.target instanceof HTMLInputElement)) menu.showTab('help');
});
window.addEventListener('gamepadconnected', (e) => showToast(`Controller connected: ${shortName(e.gamepad.id)}`));
window.addEventListener('gamepaddisconnected', (e) => showToast(`Controller disconnected: ${shortName(e.gamepad.id)}`));

applySettings();
resetQuad();
if (firstVisit) menu.showTab('help');
else showToast('Press any button on your controller to connect it · Esc for menu', 4000);
requestAnimationFrame(frame);

// Handle for automated browser tests and debugging.
(window as unknown as { __sim: unknown }).__sim = { quad, fc, state, settings, input, menu, renderer, scene, camera, get field() { return field; } };
