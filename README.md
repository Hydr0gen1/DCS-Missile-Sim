# DCS Missile Sim

A browser-based air-to-air and surface-to-air missile engagement simulator built on physics data extracted directly from DCS World's Lua datamine. Simulate 96 real missiles with accurate drag, thrust, proportional navigation, RWR/MAWS behaviour, countermeasures, and full 3D flight paths — no installation required beyond `npm`.

---

## Quick Start

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Interface Overview

The app has four tabs, selectable from the top navigation bar:

| Tab | Purpose |
|-----|---------|
| **TACTICAL** | Run and replay an engagement, view 2D/3D flight paths, RWR display |
| **ENVELOPE** | Plot the missile's kinematic engagement envelope across all aspect angles |
| **MISSILE EDITOR** | Create, edit, duplicate, and delete missiles |
| **COMPARE** | Multi-engagement comparison table with sortable columns and CSV export |

---

## TACTICAL Tab

### Setting Up a Scenario

**SHOOTER panel (left)**

1. Toggle between **AIRCRAFT** and **GROUND** at the top of the panel.
   - *Aircraft*: choose the shooter aircraft, altitude (ft), speed (kts), and heading.
   - *Ground*: sets shooter speed to 0; configure site altitude (0–2,000 ft) and SAM radar lock time (0–12 s). Heading is auto-aimed at the target.
2. Select the **missile** from the loadout dropdown. Missiles are grouped by type (ARH / IR / SARH).
3. Configure **salvo** options: fire 1–4 missiles at configurable intervals. When salvo count > 1, each additional slot can be assigned a different missile for a mixed salvo.
4. Set a **post-launch shooter maneuver** (aircraft mode only): crank left/right, pump, or drag cold to work the F-pole.
5. Optionally enable **manual loft** and set the loft angle override.

**TARGET panel**

1. Choose the target aircraft type.
2. Set altitude, speed, and heading.
3. Choose a **defensive maneuver**:

   *BVR maneuvers* (missile-referenced):
   - *None* — straight and level
   - *Crank* — 50° off the threat bearing at 3G
   - *Notch* — beam aspect + 100 ft/s descent (defeats Doppler)
   - *Break Turn* — maximum-G turn perpendicular to missile (9G)

   *Dogfight maneuvers* (opponent-referenced — use with **Dogfight Preset**):
   - *Pursuit* — turn toward opponent's 6 o'clock (7G)
   - *Scissors* — alternating 80° reversals every 3 s (9G)
   - *Barrel Roll* — rolling variant of scissors (5G)
   - *Break Into* — hard turn directly toward the opponent (9G)
   - *Extend* — disengage and fly away (2G)

4. Set **chaff** and **flare** salvo counts. IR missiles have a gimbal limit — if the target goes cold and outruns the seeker's FOV, lock is lost.

**GEOMETRY panel**

- **Range** — launch range in nautical miles (0.5 nm minimum, 0.5 nm steps)
- **Aspect** — 0° = target nose-on (hot); 180° = tail-on (cold)
- **Dogfight Preset** button — sets up a short-range, co-altitude, 180° aspect scenario suitable for WVR engagements

### Running the Simulation

Click **LAUNCH** in the playback bar at the bottom. The engagement computes instantly and begins playing back automatically.

**Playback controls:**

| Control | Action |
|---------|--------|
| `Space` | Play / Pause |
| `R` | Reset |
| `+` / `-` | Double / halve playback speed |
| `1×` `2×` `4×` `8×` buttons | Set playback speed |
| Timeline scrubber | Jump to any moment in the engagement |

### Reading the Display

**2D view** shows a top-down tactical picture:
- Blue aircraft / SAM icon = shooter; red aircraft = target
- Orange dot + trail = missile (lead); darker orange = secondary salvo missiles
- Dashed velocity vectors show heading and speed
- Yellow squares = flares; cyan squares = chaff
- Green ring = Rmax, amber dashed ring = NEZ, red ring = Rmin
- Press **P** (or the `[PLAN]` / `[PROFILE]` button) to toggle between plan view (top-down) and profile view (range vs altitude)

**3D view** (toggle with the **2D** / **3D** buttons above the display) — drag to orbit, scroll to zoom, right-drag to pan:
- Aircraft render as spheres with a heading line showing 2.5 s of travel ahead
- Shooter path trail (cyan) and target path trail (magenta) drawn from flight history
- Lead missile trail (bright orange, 2.5 px); secondary salvo missile trails (darker orange, 1.8 px)
- Countermeasure objects rendered as small boxes

**RWR display (bottom-right)**:
- SARH: continuous illumination strobe from the shooter bearing
- ARH: dim *SEARCH* strobe before pitbull; bright *ACTIVE* strobe from the missile bearing once the seeker is active
- IR: normally silent; IR missiles with datalink show a track strobe during mid-course guidance
- Aircraft with MAWS (e.g., A-10C II) show an orange sector warning for motor plume detections
- Fading contacts remain visible for 6 s after the emitter disappears
- Click the mute button to silence RWR audio tones

**Results panel** (right side, live during playback):
- Live: elapsed time, range, closure rate, TTI, missile speed/G, target altitude/speed
- After impact: verdict, Pk, max G, max speed, distance traveled, time of flight, terminal Mach, miss distance

**Engagement Summary** modal pops up when the simulation ends. Re-open it at any time with the **RESULTS** button. It includes exit conditions, detection timeline, and full outcome details.

---

## ENVELOPE Tab

Plots the missile's kinematic Rmax, NEZ, and Rmin across all aspect angles (0°–180°) for the current shooter/target/altitude/speed configuration. Updates whenever you change scenario parameters.

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

Fields highlighted in red are required. Fields left blank use built-in fallbacks where possible.

### Creating / Duplicating / Deleting

- **NEW** — choose a template (short/medium/long-range IR/ARH/SARH/SAM/MANPAD), edit, then click **CREATE**
- **DUPE** — copies the selected missile (appends `(Copy)`)
- **DELETE** — confirmation prompt; disabled when only one missile remains

### Import / Export

- **EXPORT** downloads the full missile list as `missiles.json`
- **IMPORT** replaces the list from a `missiles.json` file

---

## COMPARE Tab

Add engagements to the comparison table with the **Add Current** button. Columns include missile, maneuver, range, aspect, Pk, hit, TOF, terminal Mach, miss distance, F-pole, and verdict. Click any column header to sort. **Export CSV** downloads the full table.

---

## Missile Types

| Type | Seeker | RWR signature | Chaff / Flare effectiveness |
|------|--------|---------------|-----------------------------|
| **ARH** | Active radar (fire-and-forget) | Search → Active strobe at pitbull | Chaff effective; flares ineffective |
| **SARH** | Semi-active radar (requires illumination) | Continuous illumination strobe | Chaff effective (especially in notch); flares ineffective |
| **IR** | Infrared | Silent (no RWR) — or track strobe if datalink-equipped | Flares effective; chaff ineffective |

IR missiles have a seeker gimbal limit. If the target maneuvers outside the seeker's field of view (±45° for AIM-9M, ±75° for R-73, ±90° for AIM-9X), the missile loses lock and goes ballistic. Wide-angle imaging seekers (AIM-9X, Python-5) get a 1.5 s grace period before lock breaks.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause playback |
| `R` | Reset simulation |
| `+` or `=` | Increase playback speed |
| `-` | Decrease playback speed |
| `P` | Toggle plan / profile view (2D tactical display) |

---

## Physics Model

- **Drag**: Mach-dependent 5-coefficient DCS Cx polar (`k0`–`k4`) with wave-crisis transonic peak
- **Thrust**: multi-phase motor model (boost + sustain from DCS ModelData propulsion phases)
- **Guidance**: true 3D proportional navigation with LOS angular velocity vector `Ω = (R×V_rel)/|R|²`; range-dependent PN gains for some missiles (e.g., SD-10)
- **Loft**: range-gated loft trajectory using DCS trigger/descent ranges; SAMs use a steep vertical-launch profile for the first 20% of burn
- **Atmosphere**: two-layer ISA model (troposphere + stratosphere) for air density and speed of sound
- **Hit detection**: segment-vs-segment closest point of approach (CPA) across both missile and target paths; 12 m kill radius
- **Countermeasures**: DCS k3–k11 Doppler seduction model for chaff/flares

## Data Source

Missile parameters are extracted from the [Quaggles DCS Lua Datamine](https://github.com/Quaggles/dcs-lua-datamine) using `tools/dcs_data_extractor.py`. The resulting `src/data/missiles.json` contains 96 A2A and SAM missiles with full DCS-accurate aerodynamics, propulsion, guidance, and seeker data.

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Zustand** — global state management
- **React Three Fiber** / **Three.js** + **@react-three/drei** — 3D tactical view
- Fixed-timestep physics loop (dt = 50 ms)
