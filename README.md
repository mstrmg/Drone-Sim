# Drone-Sim

A browser FPV freestyle drone simulator. One 5" freestyle quad with sim-grade physics, a Betaflight-style
flight controller, and support for a PS5 DualSense, a Radiomaster Pocket (EdgeTX USB joystick) or the keyboard.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics, rates and input tests
npm run build    # static build in dist/
```

Chrome or Edge recommended. Controllers only appear after you press a button or move a stick on them (browser privacy rule).

## Controls

| | PS5 DualSense (Mode 2) | Radiomaster Pocket | Keyboard |
|---|---|---|---|
| Throttle / yaw | Left stick | Left stick | W / S (held), A / D |
| Pitch / roll | Right stick | Right stick | Arrow keys |
| Arm | R1 (stick resting) | CH5 switch (default) | Space |
| Reset | Cross | bind in Controls | R |
| Acro / angle | Triangle | bind in Controls | M |
| FPV / chase cam | Square | bind in Controls | C |
| Menu | Options | – | Esc |

The PS5 throttle stick springs back to the middle, and **the middle is 0% throttle**: push up for 0–100%,
let go to cut the throttle (the lower half does nothing). The quad hovers at about 29% of the upward travel.
Press R1 with the stick resting to arm. *Controls → Throttle* also offers "middle = 50%" and full-travel radio modes.

**Radiomaster Pocket:** connect USB-C and choose *USB Joystick (HID)* on the radio. Default mapping is AETR
(axes 0–3) with CH5 as the arm switch. Open *Controls* to run *Calibrate sticks*, use *Detect* to remap a
channel, and *Bind* to put reset, angle mode or the chase camera on a switch.

## Maps

- **Industrial bando** (default) – a freestyle spot on a flat industrial lot ringed by rolling, wooded hills:
  an abandoned factory (windows, big doors, a skylight gap with trusses, columns, a mezzanine), a three-deck open
  parking structure with a lightwell, a water tower with cross-braced legs, a 38 m brick chimney, a container yard
  with a gap and a leaning container, power lines with solid sagging cables, a billboard, a bus, barriers and trees.
- **Practice field** – the open field from the first version.

Pick the map in *Esc → General*. All geometry is built in code (`src/world/maps/`); meshes sharing a material
are merged into one draw call, and every solid piece has a matching collider (boxes with any rotation,
vertical cylinders, and a heightfield for the hills).

## Setup screens (Esc)

- **Controls** – live stick view, mapping with Detect, a two-step calibration wizard, deadzone, throttle curve
  (spring stick: middle = 0% or 50%, or full-travel radio; mid point, expo, live curve and hover line), switch/button bindings, raw input.
- **Rates** – Betaflight or Actual rates, presets, per-axis values and a curve preview with live stick dots.
- **Camera** – uptilt and FOV with presets; the panel docks to the side so you see the FPV view change.
- **General** – map, flight mode, keyboard strength, copy / paste / download / load / reset settings.

## How it works

```
input (Gamepad API / keyboard, calibration, deadzones)
  -> flight controller (Betaflight rates, rate PID, airmode, Quad-X mixer)      1 kHz
  -> physics (6-DOF rigid body, 4 lagged motors, prop torque, drag, contacts)    1 kHz
  -> rendering (three.js, FPV camera with uptilt/FOV, chase camera, OSD)         display rate
```

- `src/sim/params.ts` – the quad: 650 g, 4 × 15 N static thrust (≈9:1 thrust-to-weight), motor time
  constants, prop pitch speed, drag areas, rotor inertia.
- `src/sim/quad.ts` – rigid body integration. Thrust falls off with axial inflow, each prop sees the local air
  velocity (so rotation is aerodynamically damped), rotor in-plane drag, yaw from prop drag and motor
  spin-up, gyroscopic torque, and sphere-based contacts with friction and restitution.
- `src/fc/` – Betaflight rate formula, PID with Betaflight scale factors, I-term relax, D on measurement,
  feedforward, airmode with a 25% start threshold, and an optional angle mode.
- `src/input/` – controller presets, calibration math and keyboard flying.
- `src/world/` – level builder, environment (sky, light, procedural textures) and the maps.

Hitting something faster than 7 m/s counts as a crash and disarms the quad.

## Deploying

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push to `main`.
It needs Pages turned on once: *Settings → Pages → Source: GitHub Actions*.
