# DCS Missile Sim

A browser-based air-to-air and surface-to-air missile engagement simulator built on physics data extracted directly from DCS World's Lua datamine. Simulate 97 real missiles with accurate drag, thrust, proportional navigation, RWR/MAWS behaviour, countermeasures, and full 3D flight paths — no installation required beyond `npm`.

Works on desktop and on iPhone (portrait, 375 px+).

---

## Quick Start

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Interface Overview

The app has four tabs selectable from the top navigation bar (desktop) or the compact header (mobile):

| Tab | Purpose |
|-----|---------|
| **TACTICAL** | Run and replay an engagement, view 2D/3D flight paths, RWR/MAWS display |
| **ENVELOPE** | Plot the missile's kinematic engagement envelope across all aspect angles |
| **MISSILE EDITOR** | Create, edit, duplicate, and delete missiles |
| **COMPARE** | Multi-engagement comparison table with sortable columns and CSV export |

On phones (≤ 768 px wide) the TACTICAL tab is further divided into three sub-tabs: **SETUP**, **VIEW**, and **DATA**. The sim auto-switches to VIEW when you press LAUNCH.

---

## TACTICAL Tab

### Setting Up a Scenario

**SHOOTER panel**

1. Toggle between **AIRCRAFT** and **GROUND** at the top of the panel.
   - *Aircraft*: choose shooter aircraft, altitude (ft), speed (kts), and heading.
   - *Ground*: shooter speed is 0; configure site altitude (0–2,000 ft) and SAM radar lock time (0–12 s, simulates radar acquisition before launch). Heading is auto-aimed at the target.
2. Select the **missile** from the loadout dropdown. Missiles are grouped by type (ARH / SARH / IR).
3. Configure **salvo** options: fire 1–4 missiles at configurable intervals. Each slot can be assigned a different missile for a mixed salvo.
4. Set a **post-launch shooter maneuver** (aircraft mode only): crank left/right, pump, or drag cold to work the F-pole.
5. Optionally enable **manual loft angle** to override the missile's default loft.

**TARGET panel**

1. Choose the target aircraft type.
2. Set altitude, speed, and heading.
3. Choose a **defensive maneuver**:

   *BVR maneuvers* (missile-referenced):
   - *None* — straight and level
   - *Crank* — 50° off the threat bearing at 3G
   - *Notch* — beam aspect + 100 ft/s descent (defeats Doppler)
   - *Break Turn* — maximum-G turn perpendicular to the missile (9G)

   *Dogfight maneuvers* (opponent-referenced — use with **Dogfight Preset**):
   - *Pursuit* — turn toward opponent's 6 o'clock (7G)
   - *Scissors* — alternating 80° reversals every 3 s (9G)
   - *Barrel Roll* — rolling variant of scissors (5G)
   - *Break Into* — hard turn directly toward the opponent (9G)
   - *Extend* — disengage and fly away (2G)

4. Set **chaff** and **flare** salvo counts.
5. Enable **React on Detect** to have the target wait for an RWR/MAWS cue before maneuvering (ARH: react at pitbull; SARH: react at STT lock; IR + MAWS: react on motor plume detection).

**GEOMETRY panel**

- **Range** — launch range in nautical miles
- **Aspect** — 0° = target nose-on (hot); 180° = tail-on (cold)
- **Dogfight Preset** button — short-range, co-altitude, 180° aspect, suitable for WVR engagements

### Running the Simulation

Click **LAUNCH** in the playback bar. The engagement computes instantly and begins replaying automatically.

**Playback controls (desktop):**

| Control | Action |
|---------|--------|
| `Space` | Play / Pause |
| `R` | Reset |
| `+` / `-` | Double / halve playback speed |
| `1×` `2×` `4×` `8×` buttons | Set playback speed |
| Timeline scrubber | Jump to any moment in the engagement |

**Playback controls (mobile):** LAUNCH, play/pause, reset, and a speed drop-down in the top row; full-width scrubber + elapsed time in the row below.

### Reading the 2D Display

Top-down tactical picture (north up):

- Blue aircraft / SAM icon = shooter; red aircraft = target
- Orange dot + trail = missile (lead); darker orange = secondary salvo missiles
- Dashed velocity vectors show 5 s of projected travel
- Yellow squares = flares; cyan squares = chaff
- Green ring = Rmax, amber dashed ring = NEZ, red ring = Rmin (centred on the target)

Press **P** (or the `[PLAN]` / `[PROFILE]` button) to toggle between **plan view** (top-down) and **profile view** (range-from-shooter vs altitude). Profile view shows loft trajectories, SAM climb profiles, and altitude differentials.

### Reading the 3D Display

Switch with the **2D** / **3D** buttons. Drag to orbit, scroll to zoom, right-drag to pan.

- Aircraft render as coloured spheres with a heading line showing 2.5 s of travel ahead
- Shooter trail (cyan) and target trail (magenta) drawn from flight history
- Lead missile trail (bright orange, 2.5 px); secondary salvo missile trails (darker, 1.8 px)
- Countermeasure objects rendered as small boxes (yellow = flares, cyan = chaff)

### RWR / MAWS Display

The RWR scope shows radar-guided threats from the target's perspective. On desktop it sits in the bottom-right panel; on mobile it appears as a compact row below the tactical display.

| Threat type | Appearance | Audio |
|-------------|-----------|-------|
| SARH continuous illumination | Amber strobe from shooter bearing | Repeating lock tone |
| ARH pre-pitbull (shooter FCR) | Dim search strobe | Periodic ping |
| ARH post-pitbull (missile seeker) | Bright blinking active strobe from missile bearing | Launch warble |
| IR with datalink mid-course | Track strobe during mid-course only | Lock tone |
| MAWS motor plume (equipped aircraft) | Orange sector flash in MAWS ring | MAWS alarm |

- Contacts fade over 6 s after the emitter goes silent (persistence)
- A diamond outline marks the highest-priority contact
- Click the mute button (🔊 / 🔇) to silence RWR audio tones

### Results Panel

Live telemetry during playback (range, closure, TTI, missile speed/G, altitudes) plus final outcome: verdict, Pk, max G, max speed, time of flight, terminal Mach, miss distance, F-pole, A-pole.

The **Engagement Summary** modal pops up automatically when the simulation ends. Re-open it with the **RESULTS** button.

---

## ENVELOPE Tab

Plots Rmax, NEZ, and Rmin across all aspect angles (0°–180°) for the current shooter/target/altitude/speed configuration. Updates whenever scenario parameters change.

---

## MISSILE EDITOR Tab

Select a missile from the dropdown to edit its parameters in real time:

| Field group | Fields |
|---|---|
| Identity | Name, type (ARH/SARH/IR), seeker description |
| Propulsion | Motor burn time, thrust, launch mass, burnout mass |
| Aerodynamics | Drag coefficient, reference area |
| Performance | Max speed (Mach), max range (nm), G-limit |
| Guidance | Seeker acquisition range, loft angle, ProNav constant (N) |
| Countermeasures | CM vulnerability (`ccm_k0`) |

- **NEW** — choose a template (short/medium/long-range IR/ARH/SARH/SAM/MANPAD), edit, click **CREATE**
- **DUPE** — copies the selected missile (appends `(Copy)`)
- **DELETE** — confirmation prompt
- **EXPORT** — downloads the full missile list as `missiles.json`
- **IMPORT** — replaces the list from a `missiles.json` file

---

## COMPARE Tab

Add the current engagement with **Add Current**. Columns: missile, maneuver, range, aspect, Pk, hit, TOF, terminal Mach, miss distance, F-pole, A-pole, verdict. Click any column header to sort. **Export CSV** downloads the full table.

---

## Missile Types

| Type | Seeker | RWR signature | Countermeasures |
|------|--------|---------------|-----------------|
| **ARH** | Active radar — fire and forget | Search strobe → Active strobe at pitbull | Chaff effective; flares ineffective |
| **SARH** | Semi-active — requires continuous illumination | Illumination strobe throughout flight | Chaff effective (especially in notch); flares ineffective |
| **IR** | Infrared heat seeker | Silent — or track strobe if datalink-equipped | Flares effective; chaff ineffective |

**IR seeker limits:** if the target maneuvers outside the seeker FOV (AIM-9M ±45°, R-73 ±75°, AIM-9X ±90°), the missile loses lock and goes ballistic. Wide-angle imaging seekers (AIM-9X, Python-5) get a 1.5 s grace period and can re-acquire if the target returns to FOV.

---

## Keyboard Shortcuts (Desktop)

| Key | Action |
|-----|--------|
| `Space` | Play / Pause playback |
| `R` | Reset simulation |
| `+` or `=` | Increase playback speed |
| `-` | Decrease playback speed |
| `P` | Toggle plan / profile view (2D tactical display) |

---

## Physics Model

| System | Implementation |
|--------|---------------|
| **Drag** | Mach-dependent 5-coefficient DCS Cx polar (k0–k4) with transonic wave-crisis peak |
| **Thrust** | Multi-phase motor model (boost + sustain) extracted from DCS ModelData propulsion tables |
| **Guidance** | True 3D proportional navigation: `Ω = (R×V_rel)/|R|²`, `a_cmd = −N·Vc·(V̂×Ω)`; range-dependent PN gains (e.g., SD-10, PL-12) |
| **Loft** | Range-gated using DCS trigger/descent ranges; SAMs use a steep vertical-launch phase for the first 20% of burn |
| **Atmosphere** | Two-layer ISA model (troposphere + stratosphere) for air density and speed of sound |
| **Hit detection** | Segment-vs-segment CPA across both missile and target paths each tick; 12 m kill radius |
| **Countermeasures** | DCS k3–k11 Doppler seduction model for chaff/flares |
| **Gravity bias** | Autopilot adds +G to the vertical channel every tick so the missile holds altitude at baseline; PN provides corrections relative to level flight |
| **Battery life** | Each missile expires at its DCS `Life_Time` (e.g., AIM-120C 90 s, AIM-54C 200 s, AIM-174B 720 s); guidance and seeker die at that point — verdict reads "Miss — battery expired" |

---

## Data Source

Missile parameters are extracted from the [Quaggles DCS Lua Datamine](https://github.com/Quaggles/dcs-lua-datamine) using `tools/dcs_data_extractor.py`. The resulting `src/data/missiles.json` contains 97 A2A and SAM missiles with DCS-accurate aerodynamics, propulsion, guidance, seeker, DLZ, and battery-life data. The AIM-174B entry is sourced from the Currenthill mod.

To update after a DCS patch:

```bash
cd datamine && git pull && cd ..
python tools/dcs_data_extractor.py --datamine-path ./datamine --output ./src/data/missiles.json --update --diff
npm run build
```

---

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Zustand** — global state management
- **React Three Fiber** / **Three.js** + **@react-three/drei** — 3D tactical view
- Fixed-timestep physics loop (dt = 50 ms)
- Responsive layout: desktop 3-column + mobile tab-based (≤ 768 px)
