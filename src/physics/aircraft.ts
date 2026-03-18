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

const MAX_G = 9.0; // structural G for maneuvering
const G = 9.80665;

/** Step aircraft state forward by dt seconds */
export function stepAircraft(
  state: AircraftState,
  dt: number,
  missileX: number,
  missileY: number,
  missileActive: boolean,
): AircraftState {
  let { x, y, vx, vy, altFt, speedMs, headingDeg, maneuver, waypointIdx, waypoints } = state;

  // Current heading in rad
  let headingRad = (headingDeg * Math.PI) / 180;

  // Vector from aircraft to missile
  const dxM = missileX - x;
  const dyM = missileY - y;
  const rangeMissile = Math.sqrt(dxM * dxM + dyM * dyM);

  if (missileActive && maneuver !== 'none' && maneuver !== 'custom') {
    const missileAngle = Math.atan2(dxM, dyM);

    switch (maneuver) {
      case 'crank': {
        // Turn 50° off missile bearing
        const crankRad = missileAngle + (50 * Math.PI) / 180;
        headingRad = crankRad;
        break;
      }
      case 'notch': {
        // 90° off missile bearing (beam) + descend
        const notchRad = missileAngle + (90 * Math.PI) / 180;
        headingRad = notchRad;
        altFt = Math.max(200, altFt - 100 * dt); // 100 ft/s ≈ 6,000 fpm
        break;
      }
      case 'bunt': {
        // Dive and increase speed
        altFt = Math.max(200, altFt - 250 * dt); // 250 ft/s ≈ 15,000 fpm
        speedMs = Math.min(speedMs * 1.001, 450);
        break;
      }
      case 'break': {
        // Max-G turn perpendicular to missile
        const breakRad = missileAngle + (90 * Math.PI) / 180;
        const turnRate = (MAX_G * G) / speedMs; // rad/s
        const dHeading = turnRate * dt;
        // Snap to break direction
        const diff = normalizeAngle(breakRad - headingRad);
        headingRad += Math.sign(diff) * Math.min(Math.abs(diff), dHeading);
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
