import { airDensity, speedOfSound, NM_TO_M, M_TO_NM, FT_TO_M } from './atmosphere';
import type { MissileData } from '../data/types';

export interface MissileState {
  x: number;          // m (world coords)
  y: number;          // m (world coords)
  vx: number;         // m/s (horizontal east)
  vy: number;         // m/s (horizontal north)
  vz: number;         // m/s (vertical, positive = climbing)
  altFt: number;      // ft
  speedMs: number;    // m/s (horizontal magnitude)
  timeFlight: number; // s
  motorBurning: boolean;
  active: boolean;    // seeker gone active
  energy: number;     // 0–1 normalized energy remaining
  trail: Array<{ x: number; y: number; alt: number }>;
}

export interface MissingFields {
  fields: string[];
}

/** Check whether a missile record has all required physics fields */
export function getMissingFields(m: MissileData): string[] {
  const required: Array<keyof MissileData> = [
    'motorBurnTime_s',
    'thrust_N',
    'mass_kg',
    'massBurnout_kg',
    'dragCoefficient',
    'referenceArea_m2',
    'guidanceNav',
  ];
  return required.filter((k) => m[k] === null || m[k] === undefined);
}

/** Drag force (N) */
export function dragForce(
  speedMs: number,
  altFt: number,
  cd: number,
  areaM2: number,
): number {
  const rho = airDensity(altFt);
  return 0.5 * rho * speedMs * speedMs * cd * areaM2;
}

/** Create initial missile state from shooter position and heading */
export function createMissileState(
  shooterX: number,
  shooterY: number,
  headingDeg: number,
  speedMs: number,
  altFt: number,
): MissileState {
  const rad = (headingDeg * Math.PI) / 180;
  return {
    x: shooterX,
    y: shooterY,
    vx: speedMs * Math.sin(rad),
    vy: speedMs * Math.cos(rad),
    vz: 0,
    altFt,
    speedMs,
    timeFlight: 0,
    motorBurning: true,
    active: false,
    energy: 1,
    trail: [{ x: shooterX, y: shooterY, alt: altFt }],
  };
}

/** Returns max range estimate in meters for the given missile (rough kinematic) */
export function estimateMaxRangeM(m: MissileData, altFt: number): number {
  if (m.maxRange_nm !== null) return m.maxRange_nm * NM_TO_M;
  // Fallback: burn time * max speed (very rough)
  if (m.motorBurnTime_s !== null && m.maxSpeed_mach !== null) {
    const sos = speedOfSound(altFt);
    return m.motorBurnTime_s * m.maxSpeed_mach * sos * 2;
  }
  return 40 * NM_TO_M; // last resort placeholder
}

/** Altitude gain during loft (simple pitch-up logic) */
export function loftAltitudeDelta(
  loftAngleDeg: number,
  speedMs: number,
  dt: number,
): number {
  const rad = (loftAngleDeg * Math.PI) / 180;
  return speedMs * Math.sin(rad) * dt * (1 / FT_TO_M); // ft
}

export { NM_TO_M, M_TO_NM };
