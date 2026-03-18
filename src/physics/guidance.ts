/**
 * Proportional Navigation guidance + loft logic.
 * a_cmd = N * Vc * LOS_dot
 * where Vc = closing velocity, LOS_dot = line-of-sight rate (rad/s)
 */
import type { PNEntry } from '../data/types';

/**
 * Range-dependent PN gain interpolation.
 * Uses the DCS PN_coeffs schedule: (range_m → N_gain) pairs sorted ascending.
 * Falls back to `defaultN` when schedule is null/empty.
 */
export function getPNGain(rangeM: number, schedule: PNEntry[] | null | undefined, defaultN = 4.0): number {
  if (!schedule || schedule.length === 0) return defaultN;
  if (schedule.length === 1) return schedule[0].N;

  // Handle schedule starting from range_m = 0 (single-point constant)
  const sorted = [...schedule].sort((a, b) => a.range_m - b.range_m);

  if (rangeM <= sorted[0].range_m) return sorted[0].N;
  if (rangeM >= sorted[sorted.length - 1].range_m) return sorted[sorted.length - 1].N;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (rangeM >= sorted[i].range_m && rangeM < sorted[i + 1].range_m) {
      const t = (rangeM - sorted[i].range_m) / (sorted[i + 1].range_m - sorted[i].range_m);
      return sorted[i].N + t * (sorted[i + 1].N - sorted[i].N);
    }
  }
  return defaultN;
}

export interface GuidanceInput {
  /** Missile position (m) */
  mx: number;
  my: number;
  /** Missile velocity (m/s) */
  mvx: number;
  mvy: number;
  /** Target position (m) */
  tx: number;
  ty: number;
  /** Target velocity (m/s) */
  tvx: number;
  tvy: number;
  /** ProNav constant N (from missile data) */
  navConst: number;
}

export interface GuidanceOutput {
  /** Lateral acceleration command (m/s²) in world X */
  ax: number;
  /** Lateral acceleration command (m/s²) in world Y */
  ay: number;
  /** Line-of-sight angle (rad) */
  losAngle: number;
  /** Range to target (m) */
  range: number;
  /** Closing velocity (m/s) */
  closingVelocity: number;
}

export function proportionalNav(input: GuidanceInput): GuidanceOutput {
  const { mx, my, mvx, mvy, tx, ty, tvx, tvy, navConst } = input;

  const dx = tx - mx;
  const dy = ty - my;
  const range = Math.sqrt(dx * dx + dy * dy);

  if (range < 1) {
    return { ax: 0, ay: 0, losAngle: 0, range: 0, closingVelocity: 0 };
  }

  const losAngle = Math.atan2(dx, dy);

  // Relative velocity
  const rvx = tvx - mvx;
  const rvy = tvy - mvy;

  // Closing velocity (positive = closing)
  const losUnitX = dx / range;
  const losUnitY = dy / range;
  const closingVelocity = -(rvx * losUnitX + rvy * losUnitY);

  // LOS rate (rad/s): cross product of LOS unit and relative velocity / range
  const losRate = (losUnitX * rvy - losUnitY * rvx) / range;

  // Commanded lateral acceleration magnitude
  const aCmdMag = navConst * closingVelocity * losRate;

  // Perpendicular to LOS (rotate LOS unit 90°)
  const perpX = -losUnitY;
  const perpY = losUnitX;

  return {
    ax: aCmdMag * perpX,
    ay: aCmdMag * perpY,
    losAngle,
    range,
    closingVelocity,
  };
}

/** Clamp acceleration to missile G limit */
export function clampAcceleration(
  ax: number,
  ay: number,
  maxG: number,
  speedMs: number,
): { ax: number; ay: number; limited: boolean } {
  const G = 9.80665;
  const maxAcc = maxG * G;
  const mag = Math.sqrt(ax * ax + ay * ay);
  if (mag <= maxAcc || mag === 0) return { ax, ay, limited: false };
  const scale = maxAcc / mag;
  return { ax: ax * scale, ay: ay * scale, limited: true };
}

/** Loft: returns a vertical-plane pitch-up acceleration (adds to altitude rate) */
export function loftAcceleration(
  loftAngleDeg: number,
  speedMs: number,
  rangeM: number,
  maxRangeM: number,
  timeFlight: number,
  burnTime: number,
): number {
  // Only loft during motor burn and if range > 60% of max
  const shouldLoft = rangeM > 0.5 * maxRangeM && timeFlight < burnTime;
  if (!shouldLoft || loftAngleDeg === null) return 0;
  // Return vertical velocity component (ft/s)
  const rad = (loftAngleDeg * Math.PI) / 180;
  return speedMs * Math.sin(rad); // m/s vertical
}
