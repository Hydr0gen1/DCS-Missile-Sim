import { KTS_TO_MS, NM_TO_M } from './atmosphere';
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
  };
}

const MAX_G   = 9.0; // structural G for max-g break turn
const CRANK_G = 3.0; // moderate load for crank (extend/cut corners)
const NOTCH_G = 4.0; // aggressive beam turn for doppler notch
const G = 9.80665;
const MIN_ALT_FT = 500; // minimum safe altitude for defensive maneuvers (AGL)

/** Step aircraft state forward by dt seconds */
export function stepAircraft(
  state: AircraftState,
  dt: number,
  missileX: number,
  missileY: number,
  missileActive: boolean,
  threatDetected: boolean = true, // target has detected the threat via RWR/MAWS
): AircraftState {
  let { x, y, vx, vy, altFt, speedMs, headingDeg, maneuver, waypointIdx, waypoints } = state;
  let vzMs = 0; // vertical velocity (m/s); set per-maneuver below

  // Current heading in rad
  let headingRad = (headingDeg * Math.PI) / 180;

  // Vector from aircraft to missile
  const dxM = missileX - x;
  const dyM = missileY - y;
  const rangeMissile = Math.sqrt(dxM * dxM + dyM * dyM);

  if (missileActive && threatDetected && maneuver !== 'none' && maneuver !== 'custom') {
    const missileAngle = Math.atan2(dxM, dyM);

    switch (maneuver) {
      case 'crank': {
        // Turn 50° off missile bearing at moderate G — does NOT snap instantly
        const crankRad = missileAngle + (50 * Math.PI) / 180;
        const crankTurnRate = (CRANK_G * G) / Math.max(speedMs, 50); // rad/s
        const crankDelta = crankTurnRate * dt;
        const crankDiff = normalizeAngle(crankRad - headingRad);
        headingRad += Math.sign(crankDiff) * Math.min(Math.abs(crankDiff), crankDelta);
        break;
      }
      case 'notch': {
        // 90° off missile bearing (beam) at NOTCH_G + descend toward terrain mask
        const notchRad = missileAngle + (90 * Math.PI) / 180;
        const notchTurnRate = (NOTCH_G * G) / Math.max(speedMs, 50); // rad/s
        const notchDelta = notchTurnRate * dt;
        const notchDiff = normalizeAngle(notchRad - headingRad);
        headingRad += Math.sign(notchDiff) * Math.min(Math.abs(notchDiff), notchDelta);
        vzMs = -30.48; // 100 ft/s descent
        altFt = Math.max(MIN_ALT_FT, altFt - 100 * dt); // 100 ft/s ≈ 6,000 fpm
        break;
      }
      case 'bunt': {
        // Bunt: push-over dive + accelerate; heading maintained
        vzMs = -76.2; // 250 ft/s descent
        altFt = Math.max(MIN_ALT_FT, altFt - 250 * dt); // 250 ft/s ≈ 15,000 fpm
        speedMs = Math.min(speedMs * 1.001, 450);
        break;
      }
      case 'break': {
        // Max-G turn perpendicular to missile
        const breakRad = missileAngle + (90 * Math.PI) / 180;
        const breakTurnRate = (MAX_G * G) / Math.max(speedMs, 50); // rad/s
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
    const distWp = Math.sqrt(dwx * dwx + dwy * dwy);
    if (distWp < speedMs * dt * 3) {
      waypointIdx = Math.min(waypointIdx + 1, waypoints.length - 1);
    }
    headingRad = Math.atan2(dwx, dwy);
    headingDeg = (headingRad * 180) / Math.PI;
    vx = speedMs * Math.sin(headingRad);
    vy = speedMs * Math.cos(headingRad);
  }

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
  };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
