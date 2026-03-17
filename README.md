# DCS Missile Sim

A browser-based air-to-air and surface-to-air missile engagement simulator inspired by DCS World. Simulate real missile parameters, countermeasures, RWR/MAWS behaviour, and 3D flight paths — no installation required beyond `npm`.

---

## Quick Start

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Interface Overview

The app has three tabs, selectable from the top navigation bar:

| Tab | Purpose |
|-----|---------|
| **TACTICAL** | Run and replay an engagement, view 2D/3D flight paths, RWR display |
| **ENVELOPE** | Plot the missile's kinematic engagement envelope across all aspect angles |
| **MISSILE EDITOR** | Create, edit, duplicate, and delete missiles |

---

## TACTICAL Tab

### Setting Up a Scenario

**SHOOTER panel (left)**

1. Toggle between **AIRCRAFT** and **GROUND** at the top of the panel.
   - *Aircraft*: choose the shooter aircraft, altitude (ft), speed (kts), and heading.
   - *Ground*: sets shooter speed to 0; configure site altitude (0–2,000 ft). Heading is auto-aimed at the target.
2. Select the **missile** at the bottom of the left panel.

**TARGET panel**

1. Choose the target aircraft type.
2. Set altitude, speed, and heading.
3. Choose a **defensive maneuver**:
   - *None* — straight and level
   - *Crank* — 40–60° off the threat bearing
   - *Notch* — beam aspect + descend (defeats SARH/ARH doppler)
   - *Bunt & Drag* — dive and accelerate cold
   - *Break Turn* — maximum-G turn perpendicular to missile
   - *Custom Waypoints* — click on the 2D map to set a path

**GEOMETRY panel**

- **Range** — launch range in nautical miles
- **Aspect** — 0° = target flying toward shooter (hot); 180° = tail-on (cold)

**COUNTERMEASURES**

- Set chaff salvos (effective vs ARH/SARH) and flare salvos (effective vs IR).
- Effectiveness is governed by the missile's `ccm_k0` value — lower = more resistant.

### Running the Simulation

Click **LAUNCH** in the playback bar at the bottom. The engagement computes instantly and begins playing back automatically.

**Playback controls:**

| Control | Action |
|---------|--------|
| `SPACE` | Play / Pause |
| `R` | Reset |
| `+` / `-` | Double / halve playback speed |
| Timeline scrubber | Jump to any moment in the engagement |
| `1×` `2×` `4×` `8×` buttons | Set playback speed |

### Reading the Display

**2D view** shows a top-down tactical picture:
- Blue aircraft / SAM icon = shooter
- Red aircraft = target
- Orange dot + trail = missile
- Dashed velocity vectors show where each aircraft is heading
- Green ring = Rmax, amber dashed ring = NEZ, red ring = Rmin

**3D view** (toggle with the 2D/3D buttons above the display) — drag to orbit, scroll to zoom, right-drag to pan.

**RWR display (bottom-right)**:
- SARH missiles show a continuous illumination strobe from the shooter bearing.
- ARH missiles show a dim *SEARCH* strobe before seeker activation, switching to a bright *ACTIVE* strobe from the missile bearing once the seeker goes active.
- IR missiles are **silent** — no RWR indication.
- Aircraft equipped with MAWS (A-10C II) show an additional coarse-sector warning for any missile motor plume.

**Engagement Summary** pops up automatically when the simulation ends. Re-open it at any time with the **RESULTS** button in the top bar. It shows:
- Outcome verdict and Pk
- Max missile speed (Mach), max G-load, distance traveled, time of flight, terminal speed
- A-pole and F-pole distances
- Countermeasure usage and seduction events

---

## ENVELOPE Tab

Plots the missile's kinematic Rmax, NEZ, and Rmin across all aspect angles (0°–180°) for the current shooter/target/altitude/speed configuration. Useful for understanding the weapon's effective employment envelope at a glance.

No simulation playback here — the plot updates whenever you change scenario parameters.

---

## MISSILE EDITOR Tab

### Editing an Existing Missile

Select a missile from the dropdown at the top. All fields are editable in real time:

| Field group | Fields |
|---|---|
| Identity | Name, Type (ARH/SARH/IR), Seeker description |
| Propulsion | Motor Burn Time, Thrust, Launch Mass, Burnout Mass |
| Aerodynamics | Drag Coefficient, Reference Area |
| Performance | Max Speed (Mach), Max Range (nm), G-Limit |
| Guidance | Seeker Acquisition Range, Loft Angle, ProNav Constant (N) |
| Countermeasures | CM Vulnerability (`ccm_k0`) |

Fields highlighted in red are required for simulation. Fields left blank use built-in fallbacks where possible.

### Creating a Custom Missile

1. Click **NEW** (green button).
2. Select a **template** from the dropdown — this pre-populates all fields with sensible defaults for that category:
   - Short/Medium/Long-Range IR AAM
   - Short/Medium/Long-Range ARH AAM
   - SARH AAM
   - MANPAD (IR)
   - Short/Medium/Long-Range SAM
3. Edit the name, type, seeker description, and any numeric parameters you want to change.
4. Click **CREATE** — the missile is added to the list and automatically selected.

### Duplicating a Missile

Select any missile and click **DUPE**. A copy is created with `(Copy)` appended to the name. Edit from there without affecting the original.

### Deleting a Missile

Select the missile and click **DELETE** (red button). A confirmation prompt appears. The DELETE button is disabled when only one missile remains.

### Import / Export

- **EXPORT** downloads the full missile list as `missiles.json`.
- **IMPORT** replaces the missile list from a `missiles.json` file. Custom missiles created in-session are included in exports.

---

## Missile Types

| Type | Seeker | RWR signature | Chaff / Flare effectiveness |
|------|--------|---------------|-----------------------------|
| **ARH** | Active radar (fires and forgets) | Search strobe → Active strobe | Chaff effective; flares ineffective |
| **SARH** | Semi-active radar (requires shooter illumination) | Continuous illumination strobe | Chaff effective (especially in notch); flares ineffective |
| **IR** | Infrared | **Silent** (no RWR) | Flares effective; chaff ineffective |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause playback |
| `R` | Reset simulation |
| `+` or `=` | Increase playback speed (up to 8×) |
| `-` | Decrease playback speed (down to 1×) |

---

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Zustand** — global state management
- **React Three Fiber** / **Three.js** — 3D tactical view
- ISA standard atmosphere model (two-layer troposphere/stratosphere)
- Proportional Navigation guidance law
- Fixed-timestep physics loop (dt = 50 ms)
