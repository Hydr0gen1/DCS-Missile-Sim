/**
 * Engagement orchestrator — runs the fixed-timestep simulation loop.
 * dt = 0.05s
 */
import { airDensity, speedOfSound, NM_TO_M, M_TO_NM, FT_TO_M } from './atmosphere';
import { dragForce, getCxDCS, getThrustAndMass, createMissileState, estimateMaxRangeM, getMissingFields } from './missile';
import type { MissileState } from './missile';
import { proportionalNav, clampAcceleration, getPNGain } from './guidance';
import { createAircraftState, stepAircraft } from './aircraft';
import type { AircraftState, ManeuverType } from './aircraft';
import type { MissileData, RWRState, RWRThreat, MAWSSector } from '../data/types';

export const DT = 0.05; // seconds per physics step
const G = 9.80665;
const KILL_RADIUS_M = 8; // proximity fuze lethal radius (m)

/**
 * Minimum 3-D distance between missile flight-segment [p0→p1] and target point T.
 * All inputs in metres. Returns metres.
 * Detects pass-through at any closing speed.
 */
function closestApproachDist(
  mx0: number, my0: number, mz0: number,
  mx1: number, my1: number, mz1: number,
  tx: number,  ty: number,  tz: number,
): number {
  const dx = mx1 - mx0, dy = my1 - my0, dz = mz1 - mz0;
  const fx = tx - mx0,  fy = ty - my0,  fz = tz - mz0;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0.001 ? Math.max(0, Math.min(1, (fx * dx + fy * dy + fz * dz) / len2)) : 0;
  const ex = mx0 + t * dx - tx;
  const ey = my0 + t * dy - ty;
  const ez = mz0 + t * dz - tz;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * Fallback Mach-dependent drag multiplier (used when DCS Cx model is unavailable).
 * Models the transonic drag rise (wave drag) that peaks near Mach 1
 * and partially subsides at supersonic speeds.
 */
function machDragMultiplierFallback(mach: number): number {
  if (mach < 0.8) return 1.0;
  if (mach < 1.0) return 1.0 + 1.5 * ((mach - 0.8) / 0.2); // transonic rise → 2.5
  if (mach < 1.2) return 2.5 - 0.5 * ((mach - 1.0) / 0.2);  // peak at M1, decay → 2.0
  if (mach < 3.0) return 2.0 - 0.5 * ((mach - 1.2) / 1.8);  // supersonic decay → 1.5
  return 1.5;
}

export interface ScenarioConfig {
  // Shooter
  shooterRole?: 'aircraft' | 'ground'; // default 'aircraft'
  shooterType: string;
  shooterAlt: number;       // ft
  shooterSpeed: number;     // kts
  shooterHeading: number;   // deg
  // Target
  targetType: string;
  targetAlt: number;        // ft
  targetSpeed: number;      // kts
  targetHeading: number;    // deg
  targetManeuver: ManeuverType;
  /** Number of chaff salvos (affects ARH/SARH missiles) */
  targetChaffCount: number;
  /** Number of flare salvos (affects IR missiles) */
  targetFlareCount: number;
  targetWaypoints: Array<{ x: number; y: number }>;
  /** True if target aircraft is equipped with MAWS (AN/AAR-47/56/57 etc.) */
  targetHasMaws: boolean;
  /** If true, target only executes maneuver after RWR/MAWS detects the threat */
  targetReactOnDetect?: boolean;
  // Initial geometry
  rangeNm: number;
  aspectAngleDeg: number;   // 0=hot, 180=cold
  // Missile
  missile: MissileData;
}

export interface EngagementResult {
  hit: boolean;
  pk: number;               // 0–1
  timeOfFlight: number;     // s
  missDistance: number;     // m
  terminalSpeedMs: number;
  terminalSpeedMach: number;
  fPoleNm: number;
  aPoleNm: number;
  verdict: string;
  missReason?: string;
  chaffSalvosUsed: number;
  flareSalvosUsed: number;
  seductionEvents: CMEvent[];
  maxSpeedMach: number;       // peak missile speed in Mach
  maxGLoad: number;           // peak lateral G-load
  distanceTraveledNm: number; // total missile path length in nm
}

export type CMEventType = 'chaff_seduced' | 'flare_seduced' | 'cm_defeated' | 'reacquired';

export interface CMEvent {
  type: CMEventType;
  /** Probability that was rolled */
  probability: number;
  /** CM type used */
  cm: 'chaff' | 'flare';
}

export interface SimFrame {
  time: number;
  missile: MissileState;
  shooter: AircraftState;
  target: AircraftState;
  range: number;           // missile-to-target (m)
  closingVelocity: number; // m/s
  timeToImpact: number;    // s estimate
  energyFraction: number;  // 0–1
  cmEvent?: CMEvent;       // countermeasure event at this frame (if any)
  rwr?: RWRState;          // RWR/MAWS state for target aircraft
}

export type SimStatus = 'idle' | 'running' | 'hit' | 'miss' | 'error';

export interface SimState {
  status: SimStatus;
  frames: SimFrame[];
  currentFrameIdx: number;
  result: EngagementResult | null;
  errorMessage: string | null;
  maxRangeM: number;
  minRangeM: number;
  nezM: number;
  // Shooter start position (for F/A-pole calc)
  shooterStartX: number;
  shooterStartY: number;
}

/** Validate scenario before running */
export function validateScenario(cfg: ScenarioConfig): string | null {
  const missing = getMissingFields(cfg.missile);
  if (missing.length > 0) {
    return `Cannot simulate ${cfg.missile.name}: missing fields: ${missing.join(', ')}`;
  }
  return null;
}

/** Run full engagement simulation, returns all frames */
export function runSimulation(cfg: ScenarioConfig): {
  frames: SimFrame[];
  result: EngagementResult;
  maxRangeM: number;
  minRangeM: number;
  nezM: number;
  shooterStartX: number;
  shooterStartY: number;
} {
  const m = cfg.missile;

  // Place shooter at origin; target at range/aspect
  const rangeM = cfg.rangeNm * NM_TO_M;
  const aspectRad = (cfg.aspectAngleDeg * Math.PI) / 180;

  const shooterX = 0;
  const shooterY = 0;

  // Target starts along the line of sight at rangeM
  const targetX = rangeM * Math.sin(aspectRad);
  const targetY = rangeM * Math.cos(aspectRad);

  const isGroundLaunched = cfg.shooterRole === 'ground';

  // Ground launchers are stationary; heading is auto-aimed toward target
  const shooterSpeedMs = isGroundLaunched ? 0 : cfg.shooterSpeed * 0.514444;
  const initialHeadingDeg = isGroundLaunched
    ? ((Math.atan2(targetX, targetY) * 180) / Math.PI + 360) % 360
    : cfg.shooterHeading;

  // Initial missile velocity = shooter velocity (launched from shooter)
  let missileState = createMissileState(
    shooterX,
    shooterY,
    initialHeadingDeg,
    shooterSpeedMs,
    cfg.shooterAlt,
  );

  let shooterState = createAircraftState(
    shooterX, shooterY,
    isGroundLaunched ? 0 : cfg.shooterSpeed,
    initialHeadingDeg, cfg.shooterAlt,
    'none', false, 0, [],
  );

  let targetState = createAircraftState(
    targetX, targetY,
    cfg.targetSpeed, cfg.targetHeading, cfg.targetAlt,
    cfg.targetManeuver, false, 0,
    cfg.targetWaypoints,
  );

  const maxRangeM = estimateMaxRangeM(m, cfg.shooterAlt);
  const minRangeM = maxRangeM * 0.05;
  const nezM = maxRangeM * 0.25;

  const frames: SimFrame[] = [];
  let hitDetected = false;
  let missReason = '';
  let aPoleNm = 0;
  let fPoleNm = 0;
  let activeRecorded = false;

  // ── Use multi-phase propulsion if available, else fall back to flat fields ─
  const propPhases = m.propulsion?.phases ?? [];
  const useMultiPhase = propPhases.length > 0 &&
    propPhases.every((p) => p.thrust_N != null && p.duration_s != null);
  const burnTime = useMultiPhase
    ? (m.propulsion!.totalBurnTime_s ?? m.motorBurnTime_s!)
    : m.motorBurnTime_s!;
  // Used only in fallback single-phase path:
  const thrust = m.thrust_N!;
  const mass = m.mass_kg!;
  const massBurnout = m.massBurnout_kg ?? (m.propulsion?.massAtBurnout_kg ?? mass * 0.7);
  // ── Use DCS Cx model when available, else flat Cd with transonic multiplier ─
  const cxModel = m.aerodynamics?.Cx ?? null;
  const cd = m.dragCoefficient!;
  const area = m.referenceArea_m2!;
  const gLimit = m.gLimit ?? 40;
  // ── Use range-dependent PN schedule when available ─────────────────────────
  const pnSchedule = m.guidance?.pn_schedule ?? null;
  const navN = m.guidanceNav ?? 4;
  const seekerRangeM = (m.seekerAcquisitionRange_nm ?? 10) * NM_TO_M;
  // Prefer loft from DCS loft block, fall back to flat loftAngle_deg
  const loftAngle = m.loft?.elevationDeg ?? m.loftAngle_deg ?? 0;
  // ccm_k0: lower = more resistant to CM. null treated as 0.3 (moderate).
  const ccmK0 = m.ccm_k0 ?? 0.3;
  const hasMaws = cfg.targetHasMaws ?? false;
  const reactOnDetect = cfg.targetReactOnDetect ?? false;

  // MAWS can detect motor plumes within ~6nm (11112m). Real AN/AAR-56/57 spec.
  const MAWS_DETECT_RANGE_M = 11112;

  // Threat detection state (used when reactOnDetect=true)
  // SARH: FCR lock is immediately detectable on RWR
  // ARH: detected when seeker goes active (ARH seeker pings the target)
  // IR: detected by MAWS when missile motor burns within MAWS range, else never
  let threatDetectedByTarget = m.type === 'SARH'; // SARH → detected at launch

  const maxTime = 300;
  let time = 0;

  const maxSpeedMs = m.maxSpeed_mach ? m.maxSpeed_mach * speedOfSound(cfg.shooterAlt) : 1500;

  // Stat tracking for EngagementResult
  let peakSpeedMs = 0;
  let altAtPeakSpeed = cfg.shooterAlt;
  let peakGLoad = 0;
  let distanceTraveledM = 0;

  // Countermeasure state
  let chaffRemaining = cfg.targetChaffCount;
  let flareRemaining = cfg.targetFlareCount;
  let lastCmDispenseTime = -999; // last time a CM salvo was dispensed
  const CM_INTERVAL = 2.0;       // seconds between salvos
  // Seduction state
  let seduced = false;
  let seductionEndTime = 0;
  // Last known target position (missile flies to this when seduced)
  let lastKnownTargetX = targetX;
  let lastKnownTargetY = targetY;
  const seductionEvents: CMEvent[] = [];
  let chaffSalvosUsed = 0;
  let flareSalvosUsed = 0;

  // Simple deterministic RNG seeded by scenario params (avoids Math.random unpredictability)
  let rngState = (cfg.rangeNm * 1000 + cfg.aspectAngleDeg * 17 + cfg.shooterAlt + cfg.targetAlt) | 0;
  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
    return (rngState >>> 0) / 0xffffffff;
  }

  while (time < maxTime) {
    // --- Seeker activation (before stepAircraft so detection can gate maneuver) ---
    const dxSk = targetState.x - missileState.x;
    const dySk = targetState.y - missileState.y;
    const rangeSk = Math.sqrt(dxSk * dxSk + dySk * dySk);

    if (!missileState.active && (m.type === 'ARH' || m.type === 'IR') && rangeSk <= seekerRangeM) {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        const ssDx = shooterState.x - targetState.x;
        const ssDy = shooterState.y - targetState.y;
        aPoleNm = Math.sqrt(ssDx * ssDx + ssDy * ssDy) * M_TO_NM;
        activeRecorded = true;
      }
    }
    if (m.type === 'SARH' && !missileState.active) {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        aPoleNm = cfg.rangeNm;
        activeRecorded = true;
      }
    }

    // --- Threat detection (for react-on-detect feature) ---
    if (!threatDetectedByTarget) {
      if (m.type === 'ARH' && missileState.active) {
        // ARH seeker pings target → RWR spike
        threatDetectedByTarget = true;
      } else if (m.type === 'IR' && hasMaws && rangeSk <= MAWS_DETECT_RANGE_M) {
        // MAWS detects motor plume within 6nm
        threatDetectedByTarget = true;
      }
    }

    // --- Step target aircraft (with threat-gated maneuvering) ---
    const newTarget = stepAircraft(
      targetState, DT,
      missileState.x, missileState.y,
      missileState.active,
      !reactOnDetect || threatDetectedByTarget,
    );

    // Track last known target position when seeker is active
    if (missileState.active && !seduced) {
      lastKnownTargetX = newTarget.x;
      lastKnownTargetY = newTarget.y;
    }

    // --- Countermeasure dispensing & seduction check ---
    let cmEventThisFrame: CMEvent | undefined;

    if (missileState.active && !seduced && time - lastCmDispenseTime >= CM_INTERVAL) {
      const isIR = m.type === 'IR';
      const isRadar = m.type === 'ARH' || m.type === 'SARH';

      if (isIR && flareRemaining > 0) {
        // Flare seduction check
        // Base P per salvo for flares: 0.35 (DCS community tests: 1-2 salvos give ~30-40% defeat)
        // SARH chaff has extra aspect penalty (only works in notch), but IR flares work regardless
        const pSeduced = Math.min(0.92, 0.35 * ccmK0);
        const roll = nextRng();
        flareRemaining--;
        flareSalvosUsed++;
        lastCmDispenseTime = time;

        if (roll < pSeduced) {
          seduced = true;
          seductionEndTime = time + 2.0 + nextRng() * 2.0; // 2–4s seduced window
          cmEventThisFrame = { type: 'flare_seduced', probability: pSeduced, cm: 'flare' };
          seductionEvents.push(cmEventThisFrame);
        } else {
          cmEventThisFrame = { type: 'cm_defeated', probability: pSeduced, cm: 'flare' };
        }
      } else if (isRadar && chaffRemaining > 0) {
        // Chaff seduction check
        // Base P per salvo: 0.25 for ARH, higher for SARH (0.35)
        // SARH is more susceptible to chaff (breaks CW illumination lock)
        // Additional notch aspect bonus: if target is roughly beaming the missile (+/- 30°),
        // chaff is more effective against SARH (doppler notch + chaff cloud overlap)
        const basePChaff = m.type === 'SARH' ? 0.35 : 0.25;
        let aspectBonus = 1.0;
        if (m.type === 'SARH') {
          // Check if target is in notch aspect relative to missile
          const missileAngle = Math.atan2(
            missileState.x - newTarget.x,
            missileState.y - newTarget.y,
          );
          const targetHeadRad = (newTarget.headingDeg * Math.PI) / 180;
          const aspectDiff = Math.abs(normalizeAngleRad(targetHeadRad - missileAngle));
          // Within 30° of 90° (beam aspect) = notch
          if (Math.abs(aspectDiff - Math.PI / 2) < (30 * Math.PI / 180)) {
            aspectBonus = 1.8; // notch + chaff very effective vs SARH
          }
        }
        const pSeduced = Math.min(0.88, basePChaff * ccmK0 * aspectBonus);
        const roll = nextRng();
        chaffRemaining--;
        chaffSalvosUsed++;
        lastCmDispenseTime = time;

        if (roll < pSeduced) {
          seduced = true;
          seductionEndTime = time + 1.5 + nextRng() * 2.5; // 1.5–4s seduced window
          cmEventThisFrame = { type: 'chaff_seduced', probability: pSeduced, cm: 'chaff' };
          seductionEvents.push(cmEventThisFrame);
        } else {
          cmEventThisFrame = { type: 'cm_defeated', probability: pSeduced, cm: 'chaff' };
        }
      }
    }

    // --- Re-acquisition after seduction ---
    if (seduced && time >= seductionEndTime && rangeSk <= seekerRangeM * 1.5) {
      seduced = false;
      cmEventThisFrame = { type: 'reacquired', probability: 1.0, cm: missileState.active ? 'chaff' : 'flare' };
    }

    // Seduced missile homes on last known position (or flies blind)
    const guidanceTargetX = seduced ? lastKnownTargetX : newTarget.x;
    const guidanceTargetY = seduced ? lastKnownTargetY : newTarget.y;

    // ── Thrust and mass: multi-phase if available, else linear burnout model ─
    const burning = time < burnTime;
    let currentMass: number;
    let thrustForce: number;
    if (useMultiPhase) {
      const [thr, mss] = getThrustAndMass(time, propPhases, mass);
      thrustForce = thr;
      currentMass = mss;
    } else {
      currentMass = burning ? mass - (mass - massBurnout) * (time / burnTime) : massBurnout;
      thrustForce = burning ? thrust : 0;
    }

    // ── Virtual target altitude: loft / SAM steep launch / terminal ──────────
    const mzM = missileState.altFt * FT_TO_M;
    const tzActual = newTarget.altFt * FT_TO_M;
    const altErrLoft = tzActual - mzM;
    const horizDistE = Math.hypot(guidanceTargetX - missileState.x, guidanceTargetY - missileState.y);
    let tzGuide: number;
    if (isGroundLaunched) {
      // SAM steep launch: guide toward a point 6 km above current altitude for the first 20% of burn
      if (burning && time < burnTime * 0.2 && altErrLoft > 0) {
        tzGuide = mzM + 6000;
      } else {
        tzGuide = seduced ? mzM : tzActual;
      }
    } else {
      // Air-launched: loft during boost at long range, else guide to actual target altitude
      if (burning && loftAngle > 0 && horizDistE > maxRangeM * 0.25) {
        tzGuide = tzActual + Math.sin((loftAngle * Math.PI) / 180) * horizDistE;
      } else {
        tzGuide = seduced ? mzM : tzActual;
      }
    }

    // ── Proportional nav — 3D; PN gain on actual 3D range to real target ─────
    const range3DActual = Math.sqrt(
      (newTarget.x - missileState.x) ** 2 +
      (newTarget.y - missileState.y) ** 2 +
      (tzActual - mzM) ** 2,
    );
    const currentNavN = getPNGain(range3DActual, pnSchedule, navN);
    const guidOut = proportionalNav({
      mx: missileState.x, my: missileState.y, mz: mzM,
      mvx: missileState.vx, mvy: missileState.vy, mvz: missileState.vz,
      tx: guidanceTargetX, ty: guidanceTargetY, tz: tzGuide,
      tvx: seduced ? 0 : newTarget.vx,
      tvy: seduced ? 0 : newTarget.vy,
      tvz: seduced ? 0 : (newTarget.vzMs ?? 0),
      navConst: currentNavN,
    });

    const { range, closingVelocity } = seduced
      ? { range: Math.sqrt(dxSk * dxSk + dySk * dySk), closingVelocity: 0 }
      : guidOut;

    let { ax, ay, az, limited } = clampAcceleration(guidOut.ax, guidOut.ay, guidOut.az, gLimit, missileState.speedMs);
    if (limited && !seduced) {
      missReason = 'insufficient maneuverability';
    }
    // Track peak lateral G-load from guidance commands
    const gLoad = Math.sqrt(ax * ax + ay * ay + az * az) / G;
    if (gLoad > peakGLoad) peakGLoad = gLoad;

    // ── 3D speed and drag ─────────────────────────────────────────────────────
    const speed3D = Math.sqrt(
      missileState.vx * missileState.vx +
      missileState.vy * missileState.vy +
      missileState.vz * missileState.vz,
    );
    const mach3D = speed3D / speedOfSound(missileState.altFt);
    const effectiveCd = cxModel
      ? getCxDCS(mach3D, cxModel)
      : cd * machDragMultiplierFallback(mach3D);
    const fdrag3D = dragForce(speed3D, missileState.altFt, effectiveCd, area);

    // ── Thrust acts along the current velocity vector (body = velocity) ───────
    const invMass = 1 / currentMass;
    const safeDenom = Math.max(speed3D, 0.001);
    let vhx3D: number, vhy3D: number, vhz3D: number;
    if (speed3D < 1.0) {
      const launchRad = (initialHeadingDeg * Math.PI) / 180;
      vhx3D = Math.sin(launchRad);
      vhy3D = Math.cos(launchRad);
      vhz3D = 0;
    } else {
      vhx3D = missileState.vx / safeDenom;
      vhy3D = missileState.vy / safeDenom;
      vhz3D = missileState.vz / safeDenom;
    }
    const thrustAccX = thrustForce * invMass * vhx3D;
    const thrustAccY = thrustForce * invMass * vhy3D;
    const thrustAccZ = thrustForce * invMass * vhz3D;

    // ── Drag acts opposite to full 3D velocity ────────────────────────────────
    const dragAccX = -(fdrag3D * invMass) * (missileState.vx / safeDenom);
    const dragAccY = -(fdrag3D * invMass) * (missileState.vy / safeDenom);
    const dragAccZ = -(fdrag3D * invMass) * (missileState.vz / safeDenom);

    // ── Integrate (3D PN az replaces the old decoupled elevCmd) ──────────────
    const newVz = missileState.vz + (az + thrustAccZ + dragAccZ - G) * DT;
    const newVx = missileState.vx + (ax + thrustAccX + dragAccX) * DT;
    const newVy = missileState.vy + (ay + thrustAccY + dragAccY) * DT;
    const newSpeed = Math.sqrt(newVx * newVx + newVy * newVy);
    const newSpeed3D = Math.sqrt(newVx * newVx + newVy * newVy + newVz * newVz);
    const newAlt = Math.max(0, missileState.altFt + (newVz * DT) / FT_TO_M);

    // Energy fraction uses current-altitude speed of sound for accurate Mach display
    const maxSpeedMsNow = m.maxSpeed_mach
      ? m.maxSpeed_mach * speedOfSound(newAlt)
      : 1500;
    const energyFrac = Math.min(1, newSpeed3D / maxSpeedMsNow);

    // Check total 3D speed (not just horizontal) to avoid false termination
    // during steep climb phase of SAMs
    if (newSpeed3D < 50) {
      missReason = 'insufficient energy';
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      const rwrEnergy = computeRWR(newTarget, shooterState, missileState, m, seekerRangeM, hasMaws);
      frames.push(buildFrame(time, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrEnergy));
      break;
    }

    // ── CPA hit detection: catches pass-through at any closing speed ──────────
    const newMx = missileState.x + newVx * DT;
    const newMy = missileState.y + newVy * DT;
    const cpa = closestApproachDist(
      missileState.x, missileState.y, missileState.altFt * FT_TO_M,
      newMx, newMy, newAlt * FT_TO_M,
      newTarget.x, newTarget.y, newTarget.altFt * FT_TO_M,
    );
    if (!seduced && cpa < KILL_RADIUS_M) {
      hitDetected = true;
      const fdxH = shooterState.x - newTarget.x;
      const fdyH = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdxH * fdxH + fdyH * fdyH) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      const rwrHit = computeRWR(newTarget, shooterState, missileState, m, seekerRangeM, hasMaws);
      const rHit = Math.hypot(newTarget.x - newMx, newTarget.y - newMy);
      frames.push(buildFrame(time + DT, missileState, shooterState, newTarget, isGroundLaunched ? cpa : rHit, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrHit));
      break;
    }

    // ── Ground-strike check (missile hit terrain after boost) ─────────────────
    if (newAlt <= 0 && newVz < 0 && time > burnTime + 1.0) {
      missReason = 'ground strike';
      frames.push(buildFrame(time + DT, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame));
      break;
    }

    const newTrail = [...missileState.trail, { x: missileState.x, y: missileState.y, alt: missileState.altFt }];
    if (newTrail.length > 500) newTrail.shift();

    missileState = {
      ...missileState,
      x: newMx,
      y: newMy,
      vx: newVx,
      vy: newVy,
      vz: newVz,
      speedMs: newSpeed,
      altFt: newAlt,
      timeFlight: time + DT,
      motorBurning: burning,
      energy: energyFrac,
      trail: newTrail,
    };

    // Track peak speed and distance traveled
    distanceTraveledM += newSpeed3D * DT;
    if (newSpeed > peakSpeedMs) {
      peakSpeedMs = newSpeed;
      altAtPeakSpeed = newAlt;
    }

    shooterState = {
      ...shooterState,
      x: shooterState.x + shooterState.vx * DT,
      y: shooterState.y + shooterState.vy * DT,
    };

    targetState = newTarget;
    time += DT;

    const rwrFrame = computeRWR(targetState, shooterState, missileState, m, seekerRangeM, hasMaws);
    frames.push(buildFrame(time, missileState, shooterState, targetState, range, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrFrame));
  }

  if (time >= maxTime && !hitDetected) {
    missReason = 'timeout';
    const fdx = shooterState.x - targetState.x;
    const fdy = shooterState.y - targetState.y;
    fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
    if (!activeRecorded) aPoleNm = fPoleNm;
  }

  // If seduced at end of engagement, that's a miss
  if (seduced && !hitDetected && !missReason) {
    missReason = seductionEvents[0]?.cm === 'flare' ? 'defeated by flares' : 'defeated by chaff';
  }

  const lastMissile = missileState;
  const mdx = lastMissile.x - targetState.x;
  const mdy = lastMissile.y - targetState.y;
  const mdAltM = (lastMissile.altFt - targetState.altFt) * FT_TO_M;
  const missDistance = Math.sqrt(mdx * mdx + mdy * mdy + (isGroundLaunched ? mdAltM * mdAltM : 0));

  const pk = computePk({
    hit: hitDetected,
    missDistance,
    terminalSpeedMs: lastMissile.speedMs,
    targetManeuver: cfg.targetManeuver,
    missileType: m.type,
    gLimit,
    seduced,
    closingVelocity: frames.length > 0 ? frames[frames.length - 1].closingVelocity : 0,
  });

  const verdict = buildVerdict(pk, hitDetected, missReason);

  const result: EngagementResult = {
    hit: hitDetected,
    pk,
    timeOfFlight: time,
    missDistance: hitDetected ? 0 : missDistance,
    terminalSpeedMs: lastMissile.speedMs,
    terminalSpeedMach: lastMissile.speedMs / speedOfSound(lastMissile.altFt),
    fPoleNm,
    aPoleNm,
    verdict,
    missReason: hitDetected ? undefined : missReason,
    chaffSalvosUsed,
    flareSalvosUsed,
    seductionEvents,
    maxSpeedMach: peakSpeedMs / speedOfSound(altAtPeakSpeed),
    maxGLoad: peakGLoad,
    distanceTraveledNm: distanceTraveledM * M_TO_NM,
  };

  return { frames, result, maxRangeM, minRangeM, nezM, shooterStartX: shooterX, shooterStartY: shooterY };
}

function buildFrame(
  time: number,
  missile: MissileState,
  shooter: AircraftState,
  target: AircraftState,
  range: number,
  cv: number,
  maxSpeedMs: number,
  cmEvent?: CMEvent,
  rwr?: RWRState,
): SimFrame {
  const tti = cv > 0 ? range / cv : 9999;
  return {
    time,
    missile: { ...missile },
    shooter: { ...shooter },
    target: { ...target },
    range,
    closingVelocity: cv,
    timeToImpact: tti,
    energyFraction: missile.energy,
    cmEvent,
    rwr,
  };
}

interface PkInput {
  hit: boolean;
  missDistance: number;
  terminalSpeedMs: number;
  targetManeuver: ManeuverType;
  missileType: string;
  gLimit: number;
  seduced: boolean;
  closingVelocity: number;
}

function computePk(i: PkInput): number {
  if (i.seduced) return 0;
  if (i.hit && i.terminalSpeedMs > 200) {
    let pk = 0.95;
    if (i.targetManeuver === 'break') pk *= 0.75;
    else if (i.targetManeuver === 'notch') {
      // Notch is most effective vs radar seekers
      if (i.missileType === 'SARH') pk *= 0.5;
      else if (i.missileType === 'ARH') pk *= 0.7;
      else pk *= 0.85;
    }
    else if (i.targetManeuver === 'crank') pk *= 0.88;
    return Math.max(0, Math.min(1, pk));
  }
  if (i.hit && i.terminalSpeedMs <= 200) return 0.3;
  if (i.missDistance < 50) return 0.4;
  if (i.missDistance < 200) return 0.1;
  return 0;
}

function normalizeAngleRad(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ── RWR / MAWS computation ────────────────────────────────────────────────────

/**
 * Compute RWR and MAWS state from the target aircraft's perspective.
 *
 * RWR detects RADAR emissions only:
 *   - SARH: continuous illumination strobe from shooter bearing
 *   - ARH:  'search' from shooter before seeker active; 'active' from missile bearing after
 *   - IR:   SILENT — IR missiles produce no radar return, RWR cannot detect them
 *
 * MAWS detects UV/IR motor plumes (all missile types) only if hasMaws===true.
 * MAWS gives coarse 8-sector direction, NOT a precise bearing.
 */
function computeRWR(
  target: AircraftState,
  shooter: AircraftState,
  missile: MissileState,
  missileData: MissileData,
  seekerRangeM: number,
  hasMaws: boolean,
): RWRState {
  const radarThreats: RWRThreat[] = [];
  const targetHeadRad = (target.headingDeg * Math.PI) / 180;

  /** Bearing from target to point (px,py), relative to target heading, 0–360 */
  function relBearing(px: number, py: number): number {
    const absRad = Math.atan2(px - target.x, py - target.y); // atan2(dx,dy) = azimuth from north
    return ((absRad - targetHeadRad) * 180 / Math.PI + 360) % 360;
  }

  const shooterRangeM = Math.hypot(shooter.x - target.x, shooter.y - target.y);
  const missileRangeM = Math.hypot(missile.x - target.x, missile.y - target.y);
  // Short label: first 5 chars without spaces, e.g. "AIM-9" "R-27E" "120C"
  const shortLabel = missileData.name.replace(/\s+/g, '').slice(0, 5);

  // Is missile still closing on target? (gate all threats once missile has passed)
  const mtx = target.x - missile.x, mty = target.y - missile.y;
  const closingRate = missileRangeM > 1
    ? (missile.vx * mtx + missile.vy * mty) / missileRangeM
    : 0;
  const missileApproaching = closingRate > -50; // allow small negative (terminal proximity)

  // --- RWR: radar threats only (IR missiles have no entry here) ---
  if (missileData.type === 'SARH') {
    // Shooter continuously illuminates target with CW radar — always detectable
    radarThreats.push({
      bearing: relBearing(shooter.x, shooter.y),
      type: missile.active ? 'launch' : 'track',
      label: shortLabel,
      intensity: Math.min(1, 50000 / Math.max(shooterRangeM, 1000)),
    });
  } else if (missileData.type === 'ARH') {
    if (!missile.active) {
      // Pre-active: FCR is in STT/TWS tracking mode to provide mid-course guidance.
      // Target RWR sees the tracking radar from shooter bearing (track, not launch).
      radarThreats.push({
        bearing: relBearing(shooter.x, shooter.y),
        type: 'track',
        label: shortLabel,
        intensity: Math.min(0.7, 30000 / Math.max(shooterRangeM, 1000)),
      });
    } else if (missileApproaching) {
      // Seeker active AND missile still closing: ACTIVE spike from missile bearing
      radarThreats.push({
        bearing: relBearing(missile.x, missile.y),
        type: 'active',
        label: shortLabel,
        intensity: Math.min(1, seekerRangeM / Math.max(missileRangeM, 100)),
      });
    }
  }
  // IR missiles: no radar signature — radarThreats stays empty

  // --- MAWS: UV/IR plume detection only within realistic sensor range (~6nm) ---
  const MAWS_RANGE_M = 11112; // ~6nm, AN/AAR-56/57 spec
  const mawsActive: MAWSSector[] = [];
  const mawsWarning = hasMaws && missile.motorBurning && missileRangeM <= MAWS_RANGE_M && missileApproaching;
  if (mawsWarning) {
    const missileBearing = relBearing(missile.x, missile.y);
    // 8 sectors of 45° each, sector 0 = forward arc
    const sectorIdx = Math.round(missileBearing / 45) % 8;
    mawsActive.push({ sectorIdx, active: true });
  }

  return {
    radarThreats,
    mawsWarning,
    mawsSectors: mawsActive,
    radarWarning: missileData.type === 'SARH' || (missileData.type === 'ARH' && missile.active),
    launchWarning: missile.active && missileData.type === 'ARH' && missileApproaching,
  };
}

function buildVerdict(pk: number, hit: boolean, missReason: string): string {
  if (!hit) {
    if (missReason === 'insufficient energy') return 'Miss — insufficient energy';
    if (missReason === 'insufficient maneuverability') return 'Miss — defeated by maneuver';
    if (missReason === 'defeated by flares') return 'Miss — seduced by flares';
    if (missReason === 'defeated by chaff') return 'Miss — seduced by chaff';
    if (missReason === 'timeout') return 'Miss — engagement timeout';
    return `Miss — ${missReason || 'unknown'}`;
  }
  if (pk >= 0.85) return 'Kill';
  if (pk >= 0.65) return 'Probable Kill';
  if (pk >= 0.35) return 'Marginal';
  return 'Miss — insufficient terminal energy';
}
