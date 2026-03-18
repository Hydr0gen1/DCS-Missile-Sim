import { KTS_TO_MS, NM_TO_M, airDensity } from './atmosphere';
import type { AircraftData } from '../data/types';

export type ManeuverType =
  | 'none'
  | 'crank'
  | 'notch'
  | 'bunt'
  | 'break'
  | 'custom';

export interface AircraftState {
  x: number;          // m
  y: number;          // m
  vx: number;         // m/s
  vy: number;         // m/s
  vzMs: number;       // m/s (positive = climbing) — implied by maneuver
  altFt: number;
  speedMs: number;
  headingDeg: number;
  maneuver: ManeuverType;
  chaffFlareActive: boolean;
  chaffFlarePkReduction: number; // 0–1
  waypoints: Array<{ x: number; y: number }>;
  waypointIdx: number;
  // Energy state (updated when aircraft config is available)
  specificEnergy: number;       // E_s = alt_m + V²/(2g) [m]
  specificExcessPower: number;  // Ps = dE_s/dt [m/s], + = gaining, - = bleeding
  currentG: number;             // G being pulled this tick
}

/** Create initial aircraft state */
export function createAircraftState(
  x: number,
  y: number,
  speedKts: number,
  headingDeg: number,
  altFt: number,
  maneuver: ManeuverType,
  chaffFlare: boolean,
  chaffPkReduction: number,
  waypoints: Array<{ x: number; y: number }>,
): AircraftState {
  const speedMs = speedKts * KTS_TO_MS;
  const rad = (headingDeg * Math.PI) / 180;
  const G = 9.80665;
  const FT_TO_M = 0.3048;
  const specificEnergy = altFt * FT_TO_M + speedMs * speedMs / (2 * G);
  return {
    x,
    y,
    vx: speedMs * Math.sin(rad),
    vy: speedMs * Math.cos(rad),
    vzMs: 0,
    altFt,
    speedMs,
    headingDeg,
    maneuver,
    chaffFlareActive: chaffFlare,
    chaffFlarePkReduction: chaffPkReduction,
    waypoints,
    waypointIdx: 0,
    specificEnergy,
    specificExcessPower: 0,
    currentG: 1.0,
  };
}

const MAX_G   = 9.0;
const CRANK_G = 3.0;
const NOTCH_G = 4.0;
const G = 9.80665;
const MIN_ALT_FT = 500;
const FT_TO_M = 0.3048;
const RHO_SL = 1.225; // kg/m³ sea-level density

/** G load for each maneuver (used for energy drain) */
function maneuverG(m: ManeuverType, missileActive: boolean): number {
  if (!missileActive) return 1.0;
  switch (m) {
    case 'break':  return MAX_G;
    case 'notch':  return NOTCH_G;
    case 'crank':  return CRANK_G;
    case 'bunt':   return 1.5;  // pushover, moderate load
    default:       return 1.0;
  }
}

/** Step aircraft state forward by dt seconds */
export function stepAircraft(
  state: AircraftState,
  dt: number,
  missileX: number,
  missileY: number,
  missileActive: boolean,
  threatDetected: boolean = true,
  config?: AircraftData,
): AircraftState {
  let { x, y, vx, vy, altFt, speedMs, headingDeg, maneuver, waypointIdx, waypoints } = state;
  let vzMs = 0;

  let headingRad = (headingDeg * Math.PI) / 180;

  const dxM = missileX - x;
  const dyM = missileY - y;

  const currentG = maneuverG(maneuver, missileActive);

  if (missileActive && threatDetected && maneuver !== 'none' && maneuver !== 'custom') {
    const missileAngle = Math.atan2(dxM, dyM);

    switch (maneuver) {
      case 'crank': {
        const crankRad = missileAngle + (50 * Math.PI) / 180;
        const crankTurnRate = (CRANK_G * G) / Math.max(speedMs, 50);
        const crankDelta = crankTurnRate * dt;
        const crankDiff = normalizeAngle(crankRad - headingRad);
        headingRad += Math.sign(crankDiff) * Math.min(Math.abs(crankDiff), crankDelta);
        break;
      }
      case 'notch': {
        const notchRad = missileAngle + (90 * Math.PI) / 180;
        const notchTurnRate = (NOTCH_G * G) / Math.max(speedMs, 50);
        const notchDelta = notchTurnRate * dt;
        const notchDiff = normalizeAngle(notchRad - headingRad);
        headingRad += Math.sign(notchDiff) * Math.min(Math.abs(notchDiff), notchDelta);
        vzMs = -30.48; // 100 ft/s descent
        altFt = Math.max(MIN_ALT_FT, altFt - 100 * dt);
        break;
      }
      case 'bunt': {
        vzMs = -76.2; // 250 ft/s descent
        altFt = Math.max(MIN_ALT_FT, altFt - 250 * dt);
        speedMs = Math.min(speedMs * 1.001, 450);
        break;
      }
      case 'break': {
        const breakRad = missileAngle + (90 * Math.PI) / 180;
        const breakTurnRate = (MAX_G * G) / Math.max(speedMs, 50);
        const breakDelta = breakTurnRate * dt;
        const breakDiff = normalizeAngle(breakRad - headingRad);
        headingRad += Math.sign(breakDiff) * Math.min(Math.abs(breakDiff), breakDelta);
        break;
      }
    }

    headingDeg = (headingRad * 180) / Math.PI;
    vx = speedMs * Math.sin(headingRad);
    vy = speedMs * Math.cos(headingRad);
  } else if (maneuver === 'custom' && waypoints.length > 0) {
    const wp = waypoints[waypointIdx];
    const dwx = wp.x - x;
    const dwy = wp.y - y;
    if (Math.sqrt(dwx * dwx + dwy * dwy) < speedMs * dt * 3) {
      waypointIdx = Math.min(waypointIdx + 1, waypoints.length - 1);
    }
    headingRad = Math.atan2(dwx, dwy);
    headingDeg = (headingRad * 180) / Math.PI;
    vx = speedMs * Math.sin(headingRad);
    vy = speedMs * Math.cos(headingRad);
  }

  // ── Energy model (when aircraft config is available) ──────────────────────
  let specificExcessPower = 0;
  if (
    config?.maxThrust_N &&
    config.mass_kg &&
    config.wingArea_m2 &&
    config.Cd0 !== undefined &&
    config.K_induced !== undefined
  ) {
    const rho = airDensity(altFt);
    const q = 0.5 * rho * speedMs * speedMs;
    // Thrust decreases with altitude (simplified lapse rate)
    const thrustAvail = config.maxThrust_N * Math.pow(Math.max(rho / RHO_SL, 0.01), 0.7);
    // Lift coefficient from G-load
    const clDenom = Math.max(q * config.wingArea_m2, 1);
    const CL = (config.mass_kg * G * currentG) / clDenom;
    const Cd = config.Cd0 + config.K_induced * CL * CL;
    const drag = q * Cd * config.wingArea_m2;
    // Specific excess power
    specificExcessPower = (thrustAvail - drag) * speedMs / (config.mass_kg * G);
    // Speed change from net force
    const accel = (thrustAvail - drag) / config.mass_kg;
    const minSpeedMs = (config.minSpeedKts ?? 155) * KTS_TO_MS;
    speedMs = Math.max(minSpeedMs, speedMs + accel * dt);
    // Re-compute velocities with updated speed
    vx = speedMs * Math.sin(headingRad);
    vy = speedMs * Math.cos(headingRad);
  }

  const specificEnergy = altFt * FT_TO_M + speedMs * speedMs / (2 * G);

  return {
    ...state,
    x: x + vx * dt,
    y: y + vy * dt,
    vx,
    vy,
    vzMs,
    altFt,
    speedMs,
    headingDeg,
    waypointIdx,
    specificEnergy,
    specificExcessPower,
    currentG,
  };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
