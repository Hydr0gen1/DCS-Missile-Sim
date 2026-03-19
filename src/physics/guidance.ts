/**
 * Proportional Navigation guidance — true 3D formulation.
 *
 * a_cmd = -N · Vc · (V̂_missile × Ω)     ← NOTE NEGATIVE SIGN
 *
 * where:
 *   Vc  = closing velocity  = −(R̂ · V_rel)   (positive when closing)
 *   Ω   = LOS angular velocity = (R × V_rel) / |R|²
 *   V̂   = missile velocity unit vector
 *
 * The negative sign ensures the missile steers TOWARD the LOS rotation
 * (i.e., toward the intercept point), not away from it.
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
  mx: number; my: number; mz: number;
  /** Missile velocity (m/s) */
  mvx: number; mvy: number; mvz: number;
  /** Target (or virtual loft point) position (m) */
  tx: number; ty: number; tz: number;
  /** Target velocity (m/s) */
  tvx: number; tvy: number; tvz: number;
  /** ProNav constant N */
  navConst: number;
}

export interface GuidanceOutput {
  /** 3D acceleration command (m/s²) — perpendicular to missile velocity */
  ax: number;
  ay: number;
  az: number;
  /** Horizontal LOS angle (rad) */
  losAngle: number;
  /** 3D range to guidance target (m) */
  range: number;
  /** Closing velocity (m/s, positive = closing) */
  closingVelocity: number;
}

export function proportionalNav(input: GuidanceInput): GuidanceOutput {
  const { mx, my, mz, mvx, mvy, mvz, tx, ty, tz, tvx, tvy, tvz, navConst } = input;

  const dx = tx - mx;
  const dy = ty - my;
  const dz = tz - mz;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const losAngle = Math.atan2(dx, dy);

  if (range < 1) {
    return { ax: 0, ay: 0, az: 0, losAngle, range: 0, closingVelocity: 0 };
  }

  // LOS unit vector
  const losX = dx / range;
  const losY = dy / range;
  const losZ = dz / range;

  // Relative velocity (target − missile)
  const rvx = tvx - mvx;
  const rvy = tvy - mvy;
  const rvz = tvz - mvz;

  // Closing velocity: positive = closing
  const closingVelocity = -(rvx * losX + rvy * losY + rvz * losZ);

  // LOS angular velocity: Ω = (R × V_rel) / |R|²
  const r2 = range * range;
  const ox = (dy * rvz - dz * rvy) / r2;
  const oy = (dz * rvx - dx * rvz) / r2;
  const oz = (dx * rvy - dy * rvx) / r2;

  // Missile velocity unit vector
  const speed3D = Math.sqrt(mvx * mvx + mvy * mvy + mvz * mvz);
  if (speed3D < 1) {
    return { ax: 0, ay: 0, az: 0, losAngle, range, closingVelocity };
  }
  const vhx = mvx / speed3D;
  const vhy = mvy / speed3D;
  const vhz = mvz / speed3D;

  // a_cmd = -N · Vc · (V̂ × Ω)
  // Negative sign: without it steering is inverted (missile flies away from target)
  const scale = -navConst * closingVelocity;
  const ax = scale * (vhy * oz - vhz * oy);
  const ay = scale * (vhz * ox - vhx * oz);
  const az = scale * (vhx * oy - vhy * ox);

  return { ax, ay, az, losAngle, range, closingVelocity };
}

/** Clamp 3D acceleration command to missile G limit */
export function clampAcceleration(
  ax: number,
  ay: number,
  az: number,
  maxG: number,
  _speedMs: number,
): { ax: number; ay: number; az: number; limited: boolean } {
  const G = 9.80665;
  const maxAcc = maxG * G;
  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  if (mag <= maxAcc || mag === 0) return { ax, ay, az, limited: false };
  const scale = maxAcc / mag;
  return { ax: ax * scale, ay: ay * scale, az: az * scale, limited: true };
}
