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
| Arm | R1 (throttle low) | CH5 switch (default) | Space |
| Reset | Cross | bind in Controls | R |
| Acro / angle | Triangle | bind in Controls | M |
| FPV / chase cam | Square | bind in Controls | C |
| Menu | Options | – | Esc |

The PS5 throttle stick springs back to the middle, which reads as exactly 50% stick (also after calibration,
even if the stick's travel is uneven). Hover is around 29% throttle. *Controls → Throttle → Hover at stick center*
bends the throttle curve so the resting stick hovers. Hold the stick low while pressing R1 to arm.

**Radiomaster Pocket:** connect USB-C and choose *USB Joystick (HID)* on the radio. Default mapping is AETR
(axes 0–3) with CH5 as the arm switch. Open *Controls* to run *Calibrate sticks*, use *Detect* to remap a
channel, and *Bind* to put reset, angle mode or the chase camera on a switch.

## Setup screens (Esc)

- **Controls** – live stick view, mapping with Detect, a two-step calibration wizard, deadzone, throttle curve
  (spring-centered toggle, mid point, expo, with a live curve and the hover line), switch/button bindings, raw input.
- **Rates** – Betaflight or Actual rates, presets, per-axis values and a curve preview with live stick dots.
- **Camera** – uptilt and FOV with presets; the panel docks to the side so you see the FPV view change.
- **General** – flight mode, keyboard strength, export / import / reset settings.

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
- `src/world/field.ts` – the practice field built from simple shapes, each with a matching collider.

Hitting something faster than 7 m/s counts as a crash and disarms the quad.

## Deploying

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push to `main`.
It needs Pages turned on once: *Settings → Pages → Source: GitHub Actions*.
