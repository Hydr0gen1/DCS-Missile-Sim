/**
 * Shooter post-launch maneuver logic.
 *
 * After missile launch, the shooter can execute tactical maneuvers to:
 * - crank_left / crank_right: open range while keeping target near gimbal limit
 * - pump: crank 10s then swing back toward target to re-close
 * - drag: turn cold (180°) immediately to maximize F-pole
 *
 * Datalink is maintained as long as the target stays within the shooter's
 * radar gimbal limit. Once outside, datalink is lost.
 */
import { normalizeAngle } from './aircraft';
import type { AircraftState } from './aircraft';
import type { AircraftData } from '../data/types';
import type { ShooterManeuverType } from '../data/types';
import { airDensity } from './atmosphere';

const G = 9.80665;
const CRANK_G = 3.0;
const DRAG_G = 4.0;
const PUMP_CRANK_TIME = 10.0; // seconds to hold crank before swinging back

/**
 * Step the shooter aircraft through a post-launch maneuver.
 * Returns the new shooter state with heading/position updated.
 */
export function stepShooterManeuver(
  shooter: AircraftState,
  targetX: number,
  targetY: number,
  dt: number,
  maneuver: ShooterManeuverType,
  timeSinceLaunch: number,
  config?: AircraftData,
): AircraftState {
  if (maneuver === 'none') {
    // Maintain current heading (straight and level)
    return stepHeading(shooter, shooter.headingDeg, 1.0, dt, config);
  }

  const toTargetRad = Math.atan2(targetX - shooter.x, targetY - shooter.y);
  let headingRad = (shooter.headingDeg * Math.PI) / 180;

  switch (maneuver) {
    case 'crank_left': {
      // Turn left to put target at gimbal limit (positive offset)
      const crankTargetRad = toTargetRad + (70 * Math.PI) / 180;
      headingRad = turnToward(headingRad, crankTargetRad, CRANK_G, shooter.speedMs, dt);
      break;
    }
    case 'crank_right': {
      // Turn right to put target at gimbal limit (negative offset)
      const crankTargetRad = toTargetRad - (70 * Math.PI) / 180;
      headingRad = turnToward(headingRad, crankTargetRad, CRANK_G, shooter.speedMs, dt);
      break;
    }
    case 'pump': {
      if (timeSinceLaunch < PUMP_CRANK_TIME) {
        // First 10s: crank right (open range)
        const pumpCrankRad = toTargetRad - (70 * Math.PI) / 180;
        headingRad = turnToward(headingRad, pumpCrankRad, CRANK_G, shooter.speedMs, dt);
      } else {
        // After 10s: swing back toward target heading (recommit)
        headingRad = turnToward(headingRad, toTargetRad, CRANK_G, shooter.speedMs, dt);
      }
      break;
    }
    case 'drag': {
      // Turn 180° from target bearing (go cold)
      const dragRad = toTargetRad + Math.PI;
      headingRad = turnToward(headingRad, dragRad, DRAG_G, shooter.speedMs, dt);
      break;
    }
  }

  const headingDeg = (headingRad * 180) / Math.PI;
  return stepHeading(shooter, headingDeg, CRANK_G, dt, config);
}

/** Compute gimbal angle from shooter to target (radians, 0 = nose, π = tail) */
export function gimbalAngle(
  shooterHeadingDeg: number,
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number,
): number {
  const toTargetRad = Math.atan2(targetX - shooterX, targetY - shooterY);
  const headingRad = (shooterHeadingDeg * Math.PI) / 180;
  return Math.abs(normalizeAngle(toTargetRad - headingRad));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function turnToward(currentRad: number, targetRad: number, gLoad: number, speedMs: number, dt: number): number {
  const turnRate = (gLoad * G) / Math.max(speedMs, 50);
  const maxDelta = turnRate * dt;
  const diff = normalizeAngle(targetRad - currentRad);
  return currentRad + Math.sign(diff) * Math.min(Math.abs(diff), maxDelta);
}

function stepHeading(
  shooter: AircraftState,
  headingDeg: number,
  currentG: number,
  dt: number,
  config?: AircraftData,
): AircraftState {
  const headingRad = (headingDeg * Math.PI) / 180;
  const FT_TO_M = 0.3048;
  const RHO_SL = 1.225;

  let { speedMs, altFt } = shooter;
  let specificExcessPower = 0;

  if (config?.maxThrust_N && config.mass_kg && config.wingArea_m2 &&
      config.Cd0 !== undefined && config.K_induced !== undefined) {
    // Simplified energy model (same as stepAircraft)
    const rho = airDensity(altFt);
    const q = 0.5 * rho * speedMs * speedMs;
    const thrustAvail = config.maxThrust_N * Math.pow(Math.max(rho / RHO_SL, 0.01), 0.7);
    const CL = (config.mass_kg * G * currentG) / Math.max(q * config.wingArea_m2, 1);
    const Cd = config.Cd0 + config.K_induced * CL * CL;
    const drag = q * Cd * config.wingArea_m2;
    specificExcessPower = (thrustAvail - drag) * speedMs / (config.mass_kg * G);
    const accel = (thrustAvail - drag) / config.mass_kg;
    const minSpeedMs = (config.minSpeedKts ?? 155) * 0.514444;
    speedMs = Math.max(minSpeedMs, speedMs + accel * dt);
  }

  const vx = speedMs * Math.sin(headingRad);
  const vy = speedMs * Math.cos(headingRad);
  const specificEnergy = altFt * FT_TO_M + speedMs * speedMs / (2 * G);

  return {
    ...shooter,
    x: shooter.x + vx * dt,
    y: shooter.y + vy * dt,
    vx,
    vy,
    headingDeg,
    speedMs,
    specificEnergy,
    specificExcessPower,
    currentG,
  };
}
