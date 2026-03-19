# DCS Missile Sim — Audit Report
Date: 2026-03-18
Codebase version: 7c64697 (Fix missile gravity dive during control delay phase)

## Summary
- 2 critical bugs found
- 3 high-severity issues
- 5 medium issues
- 5 low issues

---

## Critical Bugs

### [BUG-001] Supersonic drag collapses to near-zero for 26 missiles (27% of database)
**File:** `src/physics/missile.ts` lines 46-58
**Code:**
```typescript
const Cx_sup = k0 + k3;
// ...
if (mach < 0.8) return k0;
if (mach < 1.2) return k0 + Cx_wave;
return Math.max(0.001, Cx_sup + Cx_wave * Cx_decline);
```
**Problem:** For 26 missiles including AIM-120B/C, AIM-54 series, MICA-RF/IR, R-60/M, SM-1/2/6, and several others, the `k3` coefficient is negative and its magnitude exceeds `k0`. This makes `k0 + k3 < 0`, and since the wave-crisis term decays rapidly at high Mach, the total `Cx` expression goes negative. The `Math.max(0.001, ...)` clamp catches this but produces an absurdly low drag coefficient.

**Worked example (AIM-120C):**
- Coefficients: k0=0.029, k1=0.06, k2=0.01, k3=-0.245, k4=0.08
- k0 + k3 = -0.216
- At M=0.5: Cx = 0.029 (subsonic)
- At M=1.0: Cx = 0.089 (transonic peak, correct behavior)
- At M=1.2: Cx = 0.001 (clamped! Should be ~0.03-0.05)
- At M=4.0: Cx = 0.001 (effectively zero drag)

The drag at Mach 4 is **29x lower** than at subsonic speeds. A real missile at Mach 4 should have Cx in the 0.02-0.05 range.

**Affected missiles (26):** AIM-120B/C, AIM-54A/C (all variants), MICA-RF/IR, R-24T/R, R-27ET/T/ER/R, R-33, R-60/M, S530D/F, SM-1/2/2ER/6, 9M338K, MIM-23K Hawk

**Impact:** These missiles experience almost no drag at supersonic speeds, making them fly much farther and faster than they should. The AIM-120C and all SM-series missiles are severely affected. Engagement ranges and terminal speeds will be significantly overestimated.

**Expected:** DCS likely interprets k3 differently in its internal C++ drag model. Possibilities: (1) The formula may use `|k3|` rather than a signed k3 for the supersonic shift. (2) k3 may be a slope `k0 + k3*(M-1.2)` rather than a flat offset `k0 + k3`. (3) The DCS formula may add k3 only to the wave-crisis amplitude, not the baseline. Without access to the DCS source code, the correct interpretation is uncertain, but the current result (Cx=0.001 at Mach 4) is physically impossible and clearly wrong.

### [BUG-002] SARH missiles without IOG can never resume guidance after datalink restoration
**File:** `src/physics/engagement.ts` lines 807-827
**Code:**
```typescript
// Lines 810-812: datalink restoration
} else if (newDatalinkActive && !datalinkActive) {
  datalinkWasLost = false;  // ← resets flag HERE
  detectionTimeline.push({ time, type: 'datalink_restored', ... });
}
datalinkActive = newDatalinkActive;  // line 814

// Lines 820-827: SARH guidance control
if (!datalinkActive && m.type === 'SARH' && !hasIOG) {
  seduced = true;
  seductionEndTime = time + 9999;
} else if (newDatalinkActive && m.type === 'SARH' && !hasIOG && seduced && datalinkWasLost) {
  seduced = false;  // ← NEVER REACHED because datalinkWasLost is already false
}
```
**Problem:** When datalink is restored (line 810-812), `datalinkWasLost` is set to `false` before the SARH resume check on line 824 evaluates it. The condition `seduced && datalinkWasLost` is always false at that point, so `seduced` is never cleared.

**Impact:** AIM-7E and other pure SARH missiles (hasIOG=false) permanently lose guidance if the datalink is interrupted even momentarily (e.g., shooter cranks past gimbal limit). The missile flies ballistic for the remainder of the engagement with no possibility of recovery. This makes the pump maneuver permanently destructive for SARH guidance rather than temporarily disrupting it.

**Expected:** The `datalinkWasLost` flag should be reset AFTER the SARH resume check, or the resume condition should check `newDatalinkActive && !datalinkActive` directly (same condition used on line 810).

---

## High Severity

### [HIGH-001] Verdict contradicts hit status for low-terminal-speed impacts
**File:** `src/physics/engagement.ts` lines 1073-1091, 1192-1205
**Code:**
```typescript
// computePk (line 1087):
if (i.hit && i.terminalSpeedMs <= 200) return 0.3;

// buildVerdict (line 1204):
if (pk >= 0.35) return 'Marginal';
return 'Miss — insufficient terminal energy';  // ← reached when pk=0.3 AND hit=true
```
**Problem:** When a missile achieves a geometric hit (CPA < 8m) but with terminal speed below 200 m/s, `computePk` returns 0.3. The `buildVerdict` function then returns "Miss -- insufficient terminal energy" because 0.3 < 0.35. However, `EngagementResult.hit` is still `true`.

**Impact:** The UI displays contradictory information: `hit=true` but `verdict="Miss"`. The comparison table shows "Y" in the Hit column but "Miss" in the Verdict column. The binary-search envelope plot uses `result.hit` to determine Rmax, so it counts these marginal hits as kills, inflating the envelope.

### [HIGH-002] Secondary salvo missiles receive no loft guidance
**File:** `src/physics/engagement.ts` lines 891-899
**Code:**
```typescript
const sMz = slot.state.altFt * FT_TO_M;
const sTz = newTarget.altFt * FT_TO_M;
const sGuidX = slot.seduced ? slot.lastKnownX : newTarget.x;
const sGuidY = slot.seduced ? slot.lastKnownY : newTarget.y;

const sGuidOut = proportionalNav({
  // ...
  tz: slot.seduced ? sMz : sTz,  // ← always guides to target altitude, never lofts
  // ...
});
```
**Problem:** The primary missile receives full loft guidance via the `tzGuide` virtual altitude computation (lines 604-634), including DCS trigger/descent range-gated lofting. Secondary salvo missiles (indices 1-3) always guide directly to target altitude (`sTz`) with no loft logic.

**Impact:** At long range, secondary missiles fly low, flat trajectories while the lead missile lofts for energy efficiency. Secondary missiles will have significantly less range and lower terminal speed. In salvo mode at long range, only the lead missile has a realistic chance of reaching the target.

### [HIGH-003] Inconsistent atmosphere model between shooter and target energy calculations
**File:** `src/physics/shooterManeuver.ts` line 118 vs `src/physics/aircraft.ts` line 172
**Code:**
```typescript
// shooterManeuver.ts (shooter energy model):
const rho = 1.225 * Math.exp(-altFt * FT_TO_M / 8500);  // simple exponential

// aircraft.ts (target energy model):
const rho = airDensity(altFt);  // proper ISA two-layer model
```
**Problem:** The shooter uses a simple exponential density approximation while the target uses the correct ISA atmosphere model. At 25,000 ft, the exponential gives 0.500 kg/m^3 while ISA gives 0.549 kg/m^3 -- an 8.9% difference. This grows larger at higher altitudes.

**Impact:** Shooter drag/thrust calculations are systematically incorrect. The shooter bleeds speed differently than the target at the same altitude and G-load. This affects F-pole computations and shooter exit speed accuracy.

---

## Medium Severity

### [MED-001] Crank/notch/break maneuvers always offset to the same rotational side
**File:** `src/physics/aircraft.ts` lines 114-142
**Code:**
```typescript
case 'crank': {
  const crankRad = missileAngle + (50 * Math.PI) / 180;  // always +50°
  // ...
}
case 'notch': {
  const notchRad = missileAngle + (90 * Math.PI) / 180;  // always +90°
  // ...
}
case 'break': {
  const breakRad = missileAngle + (90 * Math.PI) / 180;  // always +90°
  // ...
}
```
**Problem:** All defensive maneuvers add a fixed positive angular offset to the missile bearing. The target always turns to the same rotational direction regardless of its current heading relative to the missile.

**Impact:** In some geometries, this forces the target into a longer turn arc (turning away from the shorter path to the desired beam/perpendicular heading). A real pilot would choose the shorter turn direction. This can produce overly pessimistic results for the defender in certain engagement geometries, and overly optimistic in others.

### [MED-002] RNG seed does not include missile ID
**File:** `src/physics/engagement.ts` line 322
**Code:**
```typescript
let rngState = (cfg.rangeNm * 1000 + cfg.aspectAngleDeg * 17 + cfg.shooterAlt + cfg.targetAlt) | 0;
```
**Problem:** The deterministic RNG seed depends only on geometry parameters, not on the missile type. Different missiles fired at the same geometry produce identical random number sequences for countermeasure seduction rolls.

**Impact:** When comparing missiles in the comparison table at identical geometry, CM outcomes are determined by the same random rolls, making comparisons between missile types with different `ccm_k0` values appear more similar than they should be. A missile with ccm_k0=0.1 and one with ccm_k0=0.5 get the exact same random roll sequence, and only the probability threshold differs.

### [MED-003] CPA uses target position at t+dt but missile segment from t to t+dt
**File:** `src/physics/engagement.ts` lines 734-740
**Code:**
```typescript
const newMx = missileState.x + newVx * DT;
const newMy = missileState.y + newVy * DT;
const cpa = closestApproachDist(
  missileState.x, missileState.y, missileState.altFt * FT_TO_M,  // missile at time t
  newMx, newMy, newAlt * FT_TO_M,                                 // missile at time t+dt
  newTarget.x, newTarget.y, newTarget.altFt * FT_TO_M,            // target at time t+dt
);
```
**Problem:** `stepAircraft` is called before missile physics (line 468), so `newTarget` is at time t+dt. The CPA function checks the missile's segment from t to t+dt against a fixed target point at t+dt. Ideally it should check missile segment vs target segment (both from t to t+dt).

**Impact:** At high closing speeds (Mach 4+ head-on), the target moves ~12m per timestep. Using a point target at t+dt instead of a segment introduces up to ~12m positional error in the CPA check. Given the 8m kill radius, this could cause occasional false misses or false hits. The error is bounded by target displacement per timestep (~12m at 250 m/s * 0.05s).

### [MED-004] Turn rate formula uses n*g/V instead of g*sqrt(n^2-1)/V
**File:** `src/physics/aircraft.ts` line 116, `src/physics/shooterManeuver.ts` line 95
**Code:**
```typescript
const crankTurnRate = (CRANK_G * G) / Math.max(speedMs, 50);
```
**Problem:** For a coordinated level turn, the correct instantaneous turn rate is `omega = g*sqrt(n^2 - 1)/V`, not `omega = n*g/V`. The latter overestimates turn rate.

**Impact:** At 3G (crank), the error is 6.1%. At 4G (notch), 3.3%. At 9G (break), only 0.6%. The crank and notch maneuvers turn slightly faster than they should, making defensive maneuvers marginally more effective than realistic. For a DCS-fidelity simulator this is acceptable but worth noting.

### [MED-005] SAM steep launch only triggers when target is above missile
**File:** `src/physics/engagement.ts` lines 610-616
**Code:**
```typescript
if (isGroundLaunched) {
  if (burning && time < burnTime * 0.2 && altErrLoft > 0) {
    tzGuide = mzM + 6000;
  } else {
    tzGuide = seduced ? mzM : tzActual;
  }
}
```
**Problem:** `altErrLoft = tzActual - mzM`. The steep launch phase requires `altErrLoft > 0`, meaning it only activates when the target is above the missile. For a ground-launched SAM against a target at 500 ft (while the missile is still on the launcher at ground level), this works. But once the missile climbs above the target, steep launch terminates and the missile immediately pitches over to target altitude, even if still in the first 20% of burn time.

**Impact:** For SAMs engaging low-altitude targets, the steep launch may cut short as soon as the missile reaches target altitude (potentially within seconds), preventing the missile from gaining sufficient altitude for a proper attack profile. The missile would then guide near-level for the remainder of the burn.

---

## Low Severity / Cosmetic

### [LOW-001] MissileState.speedMs type comment says "horizontal magnitude"
**File:** `src/physics/missile.ts` line 11
**Code:**
```typescript
speedMs: number;    // m/s (horizontal magnitude)
```
**Problem:** Comment says "horizontal magnitude" but the actual value assigned in `engagement.ts` line 769 is `newSpeed3D` (full 3D speed including vertical component). The comment is stale from before the 3D physics upgrade.

### [LOW-002] ResultsPanel terminal speed hardcodes 340 for Mach conversion
**File:** `src/ui/ResultsPanel.tsx` line 76
**Code:**
```typescript
<Row label="TERM SPD" value={`M${(simResult.terminalSpeedMs / 340).toFixed(2)}`} />
```
**Problem:** Uses a fixed 340 m/s for Mach conversion instead of `simResult.terminalSpeedMach` which is already computed correctly using altitude-dependent speed of sound. At 40,000 ft where speed of sound is ~295 m/s, this understates the terminal Mach number by ~13%.

### [LOW-003] Secondary missile energy fraction uses sea-level maxSpeedMs
**File:** `src/physics/engagement.ts` line 950
**Code:**
```typescript
const sEnergyFrac = Math.min(1, sNewSpeed / maxSpeedMs);
```
**Problem:** `maxSpeedMs` is computed at shooter altitude at launch (line 298), while the primary missile uses altitude-corrected `maxSpeedMsNow` (line 715-718). Secondary missiles at different altitudes display incorrect energy fractions.

### [LOW-004] `targetAircraftId` stored as numeric index, not string ID
**File:** `src/store/simStore.ts` line 45
**Code:**
```typescript
targetAircraftId: number;  // numeric array index
```
**Problem:** `shooterAircraftId` is a string (e.g., "f-16") but `targetAircraftId` is a numeric array index. This creates fragility: if the aircraft.json array order changes, saved scenarios would reference the wrong aircraft. Also inconsistent API design.

### [LOW-005] F/A-18C maxThrust_N appears low relative to other aircraft
**File:** `src/data/aircraft.json` line 10
**Data:** F/A-18C maxThrust_N = 98,000 N (combined), mass_kg = 14,500 kg.

**Observation:** The F/A-18C has two F404-GE-402 engines producing ~48,900 N each in afterburner (total ~97,800 N). The listed 98,000 N is consistent with military thrust, not max A/B. Compare with F-16 single engine at 76,300 N (F110 afterburner is ~76,300 N -- correct). The F/A-18C value may or may not include afterburner depending on the data source. Not technically wrong, but worth verifying.

---

## Physics Fidelity Assessment

### Drag Model: 4/10
The 5-coefficient Cx model is a faithful reconstruction of DCS's ModelData structure, but the interpretation of the k3 coefficient produces near-zero drag at supersonic speeds for 27% of missiles (BUG-001). This fundamentally breaks the drag model for the most commonly used missiles (AIM-120C, AIM-54, R-27ER, SM series). The transonic region (M 0.8-1.2) looks physically reasonable. The subsonic region is correct. The supersonic region is catastrophically wrong for affected missiles.

### Guidance Law: 8/10
The 3D proportional navigation implementation is mathematically correct. The cross product order `V_hat x Omega` is right, the closing velocity sign convention is correct, and the G-clamping preserves the direction vector properly. The control delay gravity compensation (`az=G`) is a good physical approximation. The only issue is that secondary salvo missiles lack loft guidance (HIGH-002). The PN gain interpolation (getPNGain) handles edge cases well.

### Energy Model: 6/10
The aircraft energy model uses a proper parabolic drag polar (Cd0 + K*CL^2) with altitude-dependent thrust lapse, which is physically sound. However, the inconsistent atmosphere models between shooter and target (HIGH-003) reduce confidence. The turn rate formula overestimates by up to 6% at moderate G. The model does not account for speed-dependent turn rate limits, Mach-dependent Cd0, or compressibility effects, but these are reasonable simplifications for a DCS-fidelity sim.

### Countermeasures: 7/10
The DCS k3-k11 coefficient model is implemented faithfully. The Doppler-dependent chaff model correctly makes beam-aspect chaff more effective (low radial velocity) and head-on/tail chaff less effective. The IR flare aspect model correctly accounts for rear-hemisphere IR signature. The per-salvo probability aggregation from per-tick probabilities is mathematically sound. The seduction state machine timing is reasonable. The main issue is the deterministic RNG seed that doesn't include missile type (MED-002), and the SARH datalink restoration bug (BUG-002) which can interact with CM seduction state.

### Launch Envelopes: 6/10
The envelope plot uses a correct binary search for Rmax and NEZ at each aspect angle. However, envelope accuracy depends entirely on the simulation accuracy, and the drag model bug (BUG-001) means computed Rmax values are significantly overestimated for affected missiles. The computeDLZ function for per-frame WEZ display uses reasonable interpolation between DCS DLZ coefficients. The Rmin estimation as 5% of Rmax is very rough but acceptable for a display aid.

### Overall: 5/10
The architecture is well-structured and the 3D PN guidance law is correctly implemented. The simulation loop follows a sound integration order (Symplectic Euler). However, the supersonic drag bug affects the most important missiles in the database and fundamentally compromises range and speed predictions. The SARH datalink bug breaks a core feature for an entire guidance category. Once these two critical bugs are fixed, the overall rating would likely improve to 7/10.

---

## Recommendations (Priority Ordered)

1. **Fix BUG-001 (supersonic drag):** Investigate the DCS source or datamine community to determine the correct interpretation of negative k3 values. Likely candidates: use `abs(k3)`, or implement k3 as a decay slope `k0 + k3*(M-1.2)` capped at zero. This is the highest-impact fix because it affects 26 missiles including all the most commonly simulated ones.

2. **Fix BUG-002 (SARH datalink):** Move the `datalinkWasLost = false` reset to after the SARH resume check, or change the resume condition to `newDatalinkActive && !datalinkActive` (matching line 810's condition). Simple one-line fix with significant impact on SARH missile behavior.

3. **Fix HIGH-001 (verdict contradiction):** Either make `buildVerdict` aware of `hit` status (e.g., return "Kill -- marginal terminal energy" when hit=true and pk < 0.35), or align the Pk thresholds so that a geometric hit always produces a non-"Miss" verdict.

4. **Implement loft guidance for salvo secondaries (HIGH-002):** Extract the loft virtual-target-altitude computation into a shared function and call it for both primary and secondary missiles.

5. **Unify atmosphere model (HIGH-003):** Replace the exponential approximation in `shooterManeuver.ts` with the `airDensity()` function from `atmosphere.ts`.

6. **Add missile ID to RNG seed (MED-002):** Include a hash of the missile ID string in the RNG seed to differentiate CM outcomes across missile types at the same geometry.

7. **Fix ResultsPanel Mach display (LOW-002):** Use `simResult.terminalSpeedMach` instead of dividing by constant 340.

8. **Choose optimal turn direction for defensive maneuvers (MED-001):** Compare the angular distance for both +90 and -90 offsets and choose the shorter path.
