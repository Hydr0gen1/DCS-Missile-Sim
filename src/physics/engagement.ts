/**
 * Engagement orchestrator — runs the fixed-timestep simulation loop.
 * dt = 0.05s
 */
import { airDensity, NM_TO_M, M_TO_NM, FT_TO_M } from './atmosphere';
import { dragForce, createMissileState, estimateMaxRangeM, getMissingFields } from './missile';
import type { MissileState } from './missile';
import { proportionalNav, clampAcceleration } from './guidance';
import { createAircraftState, stepAircraft } from './aircraft';
import type { AircraftState, ManeuverType } from './aircraft';
import type { MissileData } from '../data/types';

export const DT = 0.05; // seconds per physics step
const G = 9.80665;

export interface ScenarioConfig {
  // Shooter
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
  fPoleNm: number;
  aPoleNm: number;
  verdict: string;
  missReason?: string;
  chaffSalvosUsed: number;
  flareSalvosUsed: number;
  seductionEvents: CMEvent[];
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

  // Shooter velocity
  const shooterSpeedMs = cfg.shooterSpeed * 0.514444;
  const shooterHeadRad = (cfg.shooterHeading * Math.PI) / 180;

  // Initial missile velocity = shooter velocity (launched from shooter)
  let missileState = createMissileState(
    shooterX,
    shooterY,
    cfg.shooterHeading,
    shooterSpeedMs,
    cfg.shooterAlt,
  );

  let shooterState = createAircraftState(
    shooterX, shooterY,
    cfg.shooterSpeed, cfg.shooterHeading, cfg.shooterAlt,
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

  const burnTime = m.motorBurnTime_s!;
  const thrust = m.thrust_N!;
  const mass = m.mass_kg!;
  const massBurnout = m.massBurnout_kg!;
  const cd = m.dragCoefficient!;
  const area = m.referenceArea_m2!;
  const gLimit = m.gLimit ?? 40;
  const navN = m.guidanceNav ?? 4;
  const seekerRangeM = (m.seekerAcquisitionRange_nm ?? 10) * NM_TO_M;
  const loftAngle = m.loftAngle_deg ?? 0;
  // ccm_k0: lower = more resistant to CM. null treated as 0.3 (moderate).
  const ccmK0 = m.ccm_k0 ?? 0.3;

  const maxTime = 300;
  let time = 0;

  const maxSpeedMs = m.maxSpeed_mach ? m.maxSpeed_mach * 340 : 1500;

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
    const newTarget = stepAircraft(
      targetState, DT,
      missileState.x, missileState.y,
      missileState.active,
    );

    // Track last known target position when seeker is active
    if (missileState.active && !seduced) {
      lastKnownTargetX = newTarget.x;
      lastKnownTargetY = newTarget.y;
    }

    // --- Seeker activation ---
    const dxSk = newTarget.x - missileState.x;
    const dySk = newTarget.y - missileState.y;
    const rangeSk = Math.sqrt(dxSk * dxSk + dySk * dySk);

    if (!missileState.active && (m.type === 'ARH' || m.type === 'IR') && rangeSk <= seekerRangeM) {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        const ssDx = shooterState.x - newTarget.x;
        const ssDy = shooterState.y - newTarget.y;
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

    // Proportional nav
    const guidOut = proportionalNav({
      mx: missileState.x, my: missileState.y,
      mvx: missileState.vx, mvy: missileState.vy,
      tx: guidanceTargetX, ty: guidanceTargetY,
      tvx: seduced ? 0 : newTarget.vx,
      tvy: seduced ? 0 : newTarget.vy,
      navConst: navN,
    });

    const { range, closingVelocity } = seduced
      ? { range: Math.sqrt(dxSk * dxSk + dySk * dySk), closingVelocity: 0 }
      : guidOut;

    // Hit detection (only when not seduced)
    if (!seduced && range < 20) {
      hitDetected = true;
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      frames.push(buildFrame(time, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame));
      break;
    }

    let { ax, ay, limited } = clampAcceleration(guidOut.ax, guidOut.ay, gLimit, missileState.speedMs);
    if (limited && !seduced) {
      missReason = 'insufficient maneuverability';
    }

    const burning = time < burnTime;
    const currentMass = burning
      ? mass - (mass - massBurnout) * (time / burnTime)
      : massBurnout;
    const thrustForce = burning ? thrust : 0;

    const fdrag = dragForce(missileState.speedMs, missileState.altFt, cd, area);

    const speed = missileState.speedMs > 0 ? missileState.speedMs : 0.001;
    const vHatX = missileState.vx / speed;
    const vHatY = missileState.vy / speed;

    const thrustAccX = (thrustForce / currentMass) * vHatX;
    const thrustAccY = (thrustForce / currentMass) * vHatY;
    const dragAccX = -(fdrag / currentMass) * vHatX;
    const dragAccY = -(fdrag / currentMass) * vHatY;

    let altDeltaFt = 0;
    if (burning && loftAngle > 0 && range > 0.6 * maxRangeM) {
      const vertMs = missileState.speedMs * Math.sin((loftAngle * Math.PI) / 180);
      altDeltaFt = vertMs * DT / FT_TO_M;
    }

    const newVx = missileState.vx + (ax + thrustAccX + dragAccX) * DT;
    const newVy = missileState.vy + (ay + thrustAccY + dragAccY) * DT;
    const newSpeed = Math.sqrt(newVx * newVx + newVy * newVy);
    const newAlt = Math.max(0, missileState.altFt + altDeltaFt);
    const energyFrac = Math.min(1, newSpeed / maxSpeedMs);

    if (newSpeed < 50) {
      missReason = 'insufficient energy';
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      frames.push(buildFrame(time, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame));
      break;
    }

    const newTrail = [...missileState.trail, { x: missileState.x, y: missileState.y }];
    if (newTrail.length > 500) newTrail.shift();

    missileState = {
      ...missileState,
      x: missileState.x + newVx * DT,
      y: missileState.y + newVy * DT,
      vx: newVx,
      vy: newVy,
      speedMs: newSpeed,
      altFt: newAlt,
      timeFlight: time + DT,
      motorBurning: burning,
      energy: energyFrac,
      trail: newTrail,
    };

    shooterState = {
      ...shooterState,
      x: shooterState.x + shooterState.vx * DT,
      y: shooterState.y + shooterState.vy * DT,
    };

    targetState = newTarget;
    time += DT;

    frames.push(buildFrame(time, missileState, shooterState, targetState, range, closingVelocity, maxSpeedMs, cmEventThisFrame));
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
  const missDistance = Math.sqrt(mdx * mdx + mdy * mdy);

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
    fPoleNm,
    aPoleNm,
    verdict,
    missReason: hitDetected ? undefined : missReason,
    chaffSalvosUsed,
    flareSalvosUsed,
    seductionEvents,
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
