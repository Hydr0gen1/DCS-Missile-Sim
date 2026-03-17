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
  targetChaffFlare: boolean;
  targetChaffPkReduction: number; // 0–1
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
    cfg.targetManeuver, cfg.targetChaffFlare, cfg.targetChaffPkReduction,
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

  const maxTime = 300; // simulation time cap (s)
  let time = 0;
  let prevMissileX = missileState.x;
  let prevMissileY = missileState.y;

  // Initial max speed estimate for energy tracking
  const maxSpeedMs = m.maxSpeed_mach ? m.maxSpeed_mach * 340 : 1500;

  while (time < maxTime) {
    // Step target
    const newTarget = stepAircraft(
      targetState, DT,
      missileState.x, missileState.y,
      missileState.active,
    );

    // Check seeker activation
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
    // SARH always active once launched (shooter illuminates)
    if (m.type === 'SARH' && !missileState.active) {
      missileState = { ...missileState, active: true };
    }

    // Proportional nav guidance
    const guidOut = proportionalNav({
      mx: missileState.x, my: missileState.y,
      mvx: missileState.vx, mvy: missileState.vy,
      tx: newTarget.x, ty: newTarget.y,
      tvx: newTarget.vx, tvy: newTarget.vy,
      navConst: navN,
    });

    const { range, closingVelocity } = guidOut;

    // Hit detection
    const hitRadius = 20; // m — proximity fuse
    if (range < hitRadius) {
      hitDetected = true;
      // Compute F-pole
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      frames.push(buildFrame(time, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs));
      break;
    }

    // Limit guidance acceleration to missile G limit
    let { ax, ay, limited } = clampAcceleration(guidOut.ax, guidOut.ay, gLimit, missileState.speedMs);
    if (limited) {
      missReason = 'insufficient maneuverability';
    }

    // Propulsion
    const burning = time < burnTime;
    const currentMass = burning
      ? mass - (mass - massBurnout) * (time / burnTime)
      : massBurnout;
    const thrustForce = burning ? thrust : 0;

    // Drag
    const fdrag = dragForce(missileState.speedMs, missileState.altFt, cd, area);

    // Net acceleration in direction of velocity
    const speed = missileState.speedMs > 0 ? missileState.speedMs : 0.001;
    const vHatX = missileState.vx / speed;
    const vHatY = missileState.vy / speed;

    const thrustAccX = (thrustForce / currentMass) * vHatX;
    const thrustAccY = (thrustForce / currentMass) * vHatY;
    const dragAccX = -(fdrag / currentMass) * vHatX;
    const dragAccY = -(fdrag / currentMass) * vHatY;

    // Loft: add vertical altitude change (simplified — affects alt only)
    let altDeltaFt = 0;
    if (burning && loftAngle > 0 && range > 0.6 * maxRangeM) {
      const vertMs = missileState.speedMs * Math.sin((loftAngle * Math.PI) / 180);
      altDeltaFt = vertMs * DT / FT_TO_M;
    }

    const newVx = missileState.vx + (ax + thrustAccX + dragAccX) * DT;
    const newVy = missileState.vy + (ay + thrustAccY + dragAccY) * DT;
    const newSpeed = Math.sqrt(newVx * newVx + newVy * newVy);
    const newAlt = Math.max(0, missileState.altFt + altDeltaFt);

    // Energy: normalized relative to max speed
    const energyFrac = Math.min(1, newSpeed / maxSpeedMs);

    // Missile ran out of energy
    if (newSpeed < 50) {
      missReason = 'insufficient energy';
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      frames.push(buildFrame(time, missileState, shooterState, newTarget, range, closingVelocity, maxSpeedMs));
      break;
    }

    const newTrail = [...missileState.trail, { x: missileState.x, y: missileState.y }];
    // Cap trail length
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

    // Step shooter forward (straight and level for now)
    shooterState = {
      ...shooterState,
      x: shooterState.x + shooterState.vx * DT,
      y: shooterState.y + shooterState.vy * DT,
    };

    targetState = newTarget;
    time += DT;

    const tti = closingVelocity > 0 ? range / closingVelocity : 9999;
    frames.push(buildFrame(time, missileState, shooterState, targetState, range, closingVelocity, maxSpeedMs));
  }

  if (time >= maxTime && !hitDetected) {
    missReason = 'timeout';
    const fdx = shooterState.x - targetState.x;
    const fdy = shooterState.y - targetState.y;
    fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
    if (!activeRecorded) aPoleNm = fPoleNm;
  }

  // Compute final miss distance
  const lastMissile = missileState;
  const mdx = lastMissile.x - targetState.x;
  const mdy = lastMissile.y - targetState.y;
  const missDistance = Math.sqrt(mdx * mdx + mdy * mdy);

  // Pk estimation
  const pk = computePk({
    hit: hitDetected,
    missDistance,
    terminalSpeedMs: lastMissile.speedMs,
    targetManeuver: cfg.targetManeuver,
    chaffFlare: cfg.targetChaffFlare,
    chaffPkReduction: cfg.targetChaffPkReduction,
    missileType: m.type,
    gLimit,
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
  };
}

interface PkInput {
  hit: boolean;
  missDistance: number;
  terminalSpeedMs: number;
  targetManeuver: ManeuverType;
  chaffFlare: boolean;
  chaffPkReduction: number;
  missileType: string;
  gLimit: number;
  closingVelocity: number;
}

function computePk(i: PkInput): number {
  if (i.hit && i.terminalSpeedMs > 200) {
    let pk = 0.95;
    if (i.targetManeuver === 'break') pk *= 0.75;
    else if (i.targetManeuver === 'notch') pk *= 0.65;
    else if (i.targetManeuver === 'crank') pk *= 0.85;
    if (i.chaffFlare) pk *= (1 - i.chaffPkReduction);
    // look-down/shoot-down not modeled in 2D; placeholder -5%
    return Math.max(0, Math.min(1, pk));
  }
  if (i.hit && i.terminalSpeedMs <= 200) return 0.3;
  // Near miss
  if (i.missDistance < 50) return 0.4;
  if (i.missDistance < 200) return 0.1;
  return 0;
}

function buildVerdict(pk: number, hit: boolean, missReason: string): string {
  if (!hit) {
    if (missReason === 'insufficient energy') return 'Miss — insufficient energy';
    if (missReason === 'insufficient maneuverability') return 'Miss — defeated by maneuver';
    if (missReason === 'timeout') return 'Miss — engagement timeout';
    return `Miss — ${missReason || 'unknown'}`;
  }
  if (pk >= 0.85) return 'Kill';
  if (pk >= 0.65) return 'Probable Kill';
  if (pk >= 0.35) return 'Marginal';
  return 'Miss — insufficient terminal energy';
}
