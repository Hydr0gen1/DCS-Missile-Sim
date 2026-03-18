import { airDensity, speedOfSound, NM_TO_M, M_TO_NM, FT_TO_M } from './atmosphere';
import type { MissileData, CxCoeffs, ThrustPhase } from '../data/types';

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

/**
 * DCS 5-coefficient Mach-dependent drag model.
 * Reconstructed from DCS Lua datamine ModelData indices 3–7.
 *
 * Cx(M) ≈ Cx_sub + Cx_wave_crisis × peak_factor
 *   Subsonic:    Cx_k0
 *   Transonic:   rises sharply by Cx_k1 peaking near M=1
 *   Supersonic:  shifts by Cx_k3, wave crisis decays by Cx_k4
 */
export function getCxDCS(mach: number, cx: CxCoeffs): number {
  const { k0, k1, k2, k3, k4 } = cx;
  // Wave-crisis peak (Gaussian centered near M=1)
  const Cx_wave = k1 * Math.exp(-k2 * (mach - 1.0) ** 2);
  // Post-crisis supersonic decline
  const Cx_decline = k4 > 0 ? Math.exp(-k4 * Math.max(0, mach - 1.2)) : 1.0;
  // Supersonic baseline
  const Cx_sup = k0 + k3;

  if (mach < 0.8) return k0;
  if (mach < 1.2) return k0 + Cx_wave;
  return Math.max(0.001, Cx_sup + Cx_wave * Cx_decline);
}

/** Drag force (N) — uses DCS Cx model when available, falls back to flat Cd */
export function dragForce(
  speedMs: number,
  altFt: number,
  cd: number,
  areaM2: number,
): number {
  const rho = airDensity(altFt);
  return 0.5 * rho * speedMs * speedMs * cd * areaM2;
}

/**
 * Multi-phase thrust — returns [thrustN, currentMassKg] for time t.
 * Falls back to flat motorBurnTime_s/thrust_N if no phases.
 */
export function getThrustAndMass(
  t: number,
  phases: ThrustPhase[],
  initialMassKg: number,
): [number, number] {
  let mass = initialMassKg;
  let elapsed = 0;
  for (const phase of phases) {
    if (t < elapsed + phase.duration_s) {
      // Currently in this phase
      const timeInPhase = t - elapsed;
      mass -= phase.fuelFlow_kg_s * timeInPhase;
      return [phase.thrust_N, Math.max(mass, 0.1)];
    }
    mass -= phase.fuelFlow_kg_s * phase.duration_s;
    elapsed += phase.duration_s;
  }
  return [0, Math.max(mass, 0.1)]; // coast phase
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
