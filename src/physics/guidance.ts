/**
 * Proportional Navigation guidance + loft logic.
 * a_cmd = N * Vc * LOS_dot
 * where Vc = closing velocity, LOS_dot = line-of-sight rate (rad/s)
 */

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
