/**
 * Engagement orchestrator — runs the fixed-timestep simulation loop.
 * dt = 0.05s
 */
import { airDensity, speedOfSound, NM_TO_M, M_TO_NM, FT_TO_M } from './atmosphere';
import { dragForce, getCxDCS, getThrustAndMass, createMissileState, estimateMaxRangeM, getMissingFields } from './missile';
import type { MissileState } from './missile';
import { proportionalNav, clampAcceleration, getPNGain } from './guidance';
import { createAircraftState, stepAircraft } from './aircraft';
import type { AircraftState, ManeuverType } from './aircraft';
import { stepShooterManeuver, gimbalAngle } from './shooterManeuver';
import type { MissileData, RWRState, RWRThreat, MAWSSector, AircraftData, DetectionEvent, WEZResult, ShooterManeuverType, CMObject } from '../data/types';
import { computeDLZ } from './missile';
import { DCS_CM_COEFFS } from '../data/dcsConstants';

export const DT = 0.05; // seconds per physics step
const G = 9.80665;
const KILL_RADIUS_M = 12; // proximity fuze lethal radius (m) — increased to account for warhead fragmentation pattern

/**
 * Minimum 3-D distance between two line segments:
 *   Segment A: p0 → p1 (missile path this tick)
 *   Segment B: q0 → q1 (target path this tick)
 * Returns the closest distance in metres.
 * Handles the case where both objects are moving during the timestep,
 * preventing pass-through misses at high combined closing speeds (Mach 6+).
 */
function closestApproachDist(
  p0x: number, p0y: number, p0z: number,  // missile start
  p1x: number, p1y: number, p1z: number,  // missile end
  q0x: number, q0y: number, q0z: number,  // target start
  q1x: number, q1y: number, q1z: number,  // target end
): number {
  // Direction vectors
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z; // missile direction
  const ex = q1x - q0x, ey = q1y - q0y, ez = q1z - q0z; // target direction
  const fx = p0x - q0x, fy = p0y - q0y, fz = p0z - q0z; // start separation

  const a = dx * dx + dy * dy + dz * dz; // |d|²
  const b = dx * ex + dy * ey + dz * ez; // d·e
  const c = ex * ex + ey * ey + ez * ez; // |e|²
  const d = dx * fx + dy * fy + dz * fz; // d·f
  const e = ex * fx + ey * fy + ez * fz; // e·f

  const denom = a * c - b * b;

  let s: number, t: number;
  if (denom < 0.001) {
    // Segments nearly parallel — use midpoint
    s = 0.5;
    t = (b * s - e) / Math.max(c, 0.001);
  } else {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  }

  // Clamp both parameters to [0, 1]
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));

  // Closest points on each segment
  const cx = (p0x + s * dx) - (q0x + t * ex);
  const cy = (p0y + s * dy) - (q0y + t * ey);
  const cz = (p0z + s * dz) - (q0z + t * ez);

  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Fallback Mach-dependent drag multiplier (used when DCS Cx model is unavailable).
 * Models the transonic drag rise (wave drag) that peaks near Mach 1
 * and partially subsides at supersonic speeds.
 */
function machDragMultiplierFallback(mach: number): number {
  if (mach < 0.8) return 1.0;
  if (mach < 1.0) return 1.0 + 1.5 * ((mach - 0.8) / 0.2); // transonic rise → 2.5
  if (mach < 1.2) return 2.5 - 0.5 * ((mach - 1.0) / 0.2);  // peak at M1, decay → 2.0
  if (mach < 3.0) return 2.0 - 0.5 * ((mach - 1.2) / 1.8);  // supersonic decay → 1.5
  return 1.5;
}

export interface ScenarioConfig {
  // Shooter
  shooterRole?: 'aircraft' | 'ground'; // default 'aircraft'
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
  /** Number of chaff salvos (affects ARH/SARH missiles) */
  targetChaffCount: number;
  /** Number of flare salvos (affects IR missiles) */
  targetFlareCount: number;
  targetWaypoints: Array<{ x: number; y: number }>;
  /** True if target aircraft is equipped with MAWS (AN/AAR-47/56/57 etc.) */
  targetHasMaws: boolean;
  /** If true, target only executes maneuver after RWR/MAWS detects the threat */
  targetReactOnDetect?: boolean;
  /** Shooter aircraft data (enables energy model and radar detection timeline) */
  shooterAircraftData?: AircraftData;
  /** Target aircraft data (enables energy model, RCS-based radar detection) */
  targetAircraftData?: AircraftData;
  /** Shooter post-launch maneuver (default 'none') */
  shooterManeuver?: ShooterManeuverType;
  /** Number of missiles in the salvo (default 1) */
  salvoCount?: number;
  /** Time between missile launches in seconds (default 2) */
  salvoInterval_s?: number;
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
  terminalSpeedMach: number;
  fPoleNm: number;
  aPoleNm: number;
  verdict: string;
  missReason?: string;
  chaffSalvosUsed: number;
  flareSalvosUsed: number;
  seductionEvents: CMEvent[];
  maxSpeedMach: number;       // peak missile speed in Mach
  maxGLoad: number;           // peak lateral G-load
  distanceTraveledNm: number; // total missile path length in nm
  targetExitSpeedKts: number;   // target speed at end of engagement (kts)
  shooterExitSpeedKts: number;  // shooter speed at end of engagement (kts)
  detectionTimeline: DetectionEvent[];
}

export type CMEventType = 'chaff_seduced' | 'flare_seduced' | 'cm_defeated' | 'reacquired';

export interface CMEvent {
  type: CMEventType;
  /** Probability that was rolled */
  probability: number;
  /** CM type used */
  cm: 'chaff' | 'flare';
}

export interface SimFrame {
  time: number;
  /** All missiles in the salvo (index 0 = lead missile) */
  missiles: MissileState[];
  /** @deprecated Use missiles[0] — kept for backward compat during transition */
  missile: MissileState;
  shooter: AircraftState;
  target: AircraftState;
  range: number;           // missile-to-target (m)
  closingVelocity: number; // m/s
  timeToImpact: number;    // s estimate
  energyFraction: number;  // 0–1
  cmEvent?: CMEvent;       // countermeasure event at this frame (if any)
  rwr?: RWRState;          // RWR/MAWS state for target aircraft
  wez?: WEZResult;         // dynamic launch zone at this frame
  datalinkActive?: boolean; // true when shooter radar still illuminates missile FOV
  countermeasures?: CMObject[]; // CM objects (chaff/flares) in flight
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

/**
 * Compute virtual guidance altitude for loft / SAM steep-launch / terminal phases.
 * Shared by both primary and secondary salvo missiles.
 */
function computeLoftAltitude(
  mzM: number,
  tzActual: number,
  horizDist: number,
  loftAngle: number,
  effectiveTriggerM: number,
  effectiveDescentM: number,
  isSeduced: boolean,
  isGroundLaunched: boolean,
  isBurning: boolean,
  burnTimeFrac: number,
): number {
  if (isGroundLaunched) {
    const altErrLoft = tzActual - mzM;
    if (isBurning && burnTimeFrac < 0.2 && altErrLoft > 0) {
      return mzM + 6000;
    }
    return isSeduced ? mzM : tzActual;
  }
  // Air-launched loft (range-gated)
  const loftSin = Math.sin((loftAngle * Math.PI) / 180);
  if (loftAngle > 0 && horizDist > effectiveDescentM) {
    if (horizDist >= effectiveTriggerM) {
      return tzActual + loftSin * horizDist;
    }
    const blend = (horizDist - effectiveDescentM) / Math.max(1, effectiveTriggerM - effectiveDescentM);
    return tzActual + loftSin * horizDist * blend;
  }
  return isSeduced ? mzM : tzActual;
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

  const isGroundLaunched = cfg.shooterRole === 'ground';

  // ── IR pre-launch seeker validation ────────────────────────────────────────
  // IR missiles require a valid seeker lock before launch. If the target is
  // beyond the seeker acquisition range, the missile cannot be fired.
  if (m.type === 'IR') {
    const seekerMaxRange = (m.seekerAcquisitionRange_nm ?? 10) * NM_TO_M;
    if (rangeM > seekerMaxRange) {
      return {
        frames: [],
        result: {
          hit: false,
          pk: 0,
          timeOfFlight: 0,
          missDistance: rangeM,
          terminalSpeedMs: 0,
          terminalSpeedMach: 0,
          fPoleNm: 0,
          aPoleNm: 0,
          verdict: `Cannot launch — target beyond ${m.name} seeker range (${m.seekerAcquisitionRange_nm?.toFixed(1) ?? '?'} nm)`,
          missReason: 'seeker cannot acquire',
          chaffSalvosUsed: 0,
          flareSalvosUsed: 0,
          seductionEvents: [],
          maxSpeedMach: 0,
          maxGLoad: 0,
          distanceTraveledNm: 0,
          targetExitSpeedKts: cfg.targetSpeed,
          shooterExitSpeedKts: cfg.shooterSpeed,
          detectionTimeline: [],
        },
        maxRangeM: seekerMaxRange,
        minRangeM: seekerMaxRange * 0.05,
        nezM: seekerMaxRange * 0.25,
        shooterStartX: 0,
        shooterStartY: 0,
      };
    }
  }

  // Ground launchers are stationary; heading is auto-aimed toward target
  const shooterSpeedMs = isGroundLaunched ? 0 : cfg.shooterSpeed * 0.514444;
  const initialHeadingDeg = isGroundLaunched
    ? ((Math.atan2(targetX, targetY) * 180) / Math.PI + 360) % 360
    : cfg.shooterHeading;

  // Initial missile velocity = shooter velocity (launched from shooter)
  let missileState = createMissileState(
    shooterX,
    shooterY,
    initialHeadingDeg,
    shooterSpeedMs,
    cfg.shooterAlt,
  );

  let shooterState = createAircraftState(
    shooterX, shooterY,
    isGroundLaunched ? 0 : cfg.shooterSpeed,
    initialHeadingDeg, cfg.shooterAlt,
    'none', false, 0, [],
  );

  let targetState = createAircraftState(
    targetX, targetY,
    cfg.targetSpeed, cfg.targetHeading, cfg.targetAlt,
    cfg.targetManeuver, false, 0,
    cfg.targetWaypoints,
  );

  const initialDlz = computeDLZ(m, cfg.shooterAlt, cfg.shooterSpeed, cfg.targetAlt, cfg.targetSpeed, cfg.aspectAngleDeg);
  const maxRangeM = initialDlz.rmax_m;
  const minRangeM = initialDlz.rmin_m;
  const nezM = initialDlz.nez_m;

  const frames: SimFrame[] = [];
  let hitDetected = false;
  let missReason = '';
  let aPoleNm = 0;
  let fPoleNm = 0;
  let activeRecorded = false;

  // ── Use multi-phase propulsion if available, else fall back to flat fields ─
  const propPhases = m.propulsion?.phases ?? [];
  const useMultiPhase = propPhases.length > 0 &&
    propPhases.every((p) => p.thrust_N != null && p.duration_s != null);
  const burnTime = useMultiPhase
    ? (m.propulsion!.totalBurnTime_s ?? m.motorBurnTime_s!)
    : m.motorBurnTime_s!;
  // Used only in fallback single-phase path:
  const thrust = m.thrust_N!;
  const mass = m.mass_kg!;
  const massBurnout = m.massBurnout_kg ?? (m.propulsion?.massAtBurnout_kg ?? mass * 0.7);
  // ── Use DCS Cx model when available, else flat Cd with transonic multiplier ─
  const cxModel = m.aerodynamics?.Cx ?? null;
  const cd = m.dragCoefficient!;
  const area = m.referenceArea_m2!;
  const gLimit = m.gLimit ?? 40;
  // ── Use range-dependent PN schedule when available ─────────────────────────
  const pnSchedule = m.guidance?.pn_schedule ?? null;
  const navN = m.guidanceNav ?? 4;
  const seekerRangeM = (m.seekerAcquisitionRange_nm ?? 10) * NM_TO_M;
  // Prefer loft from DCS loft block, fall back to flat loftAngle_deg
  const loftAngle = m.loft?.elevationDeg ?? m.loftAngle_deg ?? 0;
  const loftTriggerM = m.loft?.triggerRange_m ?? null;   // DCS ModelData[39]
  const loftDescentM = m.loft?.descentRange_m ?? null;   // DCS ModelData[40]

  // ccm_k0: lower = more resistant to CM. null treated as 0.3 (moderate).
  const ccmK0 = m.ccm_k0 ?? 0.3;
  const hasMaws = cfg.targetHasMaws ?? false;
  const reactOnDetect = cfg.targetReactOnDetect ?? false;
  // DCS ModelData[38]: fins-locked ballistic phase after launch before guidance activates
  const controlDelay = Math.min(m.guidance?.controlDelay_s ?? m.guidance?.autopilot?.delay_s ?? 0, 2.0);

  // MAWS can detect motor plumes within ~6nm (11112m). Real AN/AAR-56/57 spec.
  const MAWS_DETECT_RANGE_M = 11112;

  // Threat detection state (used when reactOnDetect=true)
  // SARH: FCR lock is immediately detectable on RWR
  // ARH: detected when seeker goes active (ARH seeker pings the target)
  // IR: detected by MAWS when missile motor burns within MAWS range, else never
  let threatDetectedByTarget = m.type === 'SARH'; // SARH → detected at launch

  // targetShouldManeuver: decoupled from seeker-active state.
  // - SARH/ARH without reactOnDetect: pilot sees STT/TWS lock on RWR → maneuver starts at launch.
  // - ARH with reactOnDetect: only once ARH seeker goes active (pitbull).
  // - IR without MAWS: pilot can't detect the threat — but if a maneuver is set they're pre-planned.
  // - IR with MAWS + reactOnDetect: only once MAWS detects the plume.
  const maneuverIsPrePlanned = !reactOnDetect;
  let targetShouldManeuver = maneuverIsPrePlanned && m.type !== 'IR'
    ? true  // SARH/ARH: pilot sees radar lock on RWR immediately at launch
    : false; // IR or react-on-detect: wait for detection event

  const maxTime = 300;
  let time = 0;

  const maxSpeedMs = m.maxSpeed_mach ? m.maxSpeed_mach * speedOfSound(cfg.shooterAlt) : 1500;

  // Stat tracking for EngagementResult
  let peakSpeedMs = 0;
  let altAtPeakSpeed = cfg.shooterAlt;
  let peakGLoad = 0;
  let distanceTraveledM = 0;

  // Countermeasure state
  let chaffRemaining = cfg.targetChaffCount;
  let flareRemaining = cfg.targetFlareCount;
  let lastCmDispenseTime = -999; // last time a CM salvo was dispensed
  const CM_INTERVAL = 2.0;       // seconds between salvos
  // Seduction state
  let seduced = false;
  let seductionEndTime = 0;
  // Last known target position (missile flies to this when seduced)
  let lastKnownTargetX = targetX;
  let lastKnownTargetY = targetY;
  const seductionEvents: CMEvent[] = [];
  let chaffSalvosUsed = 0;
  let flareSalvosUsed = 0;

  // Simple deterministic RNG seeded by scenario params (avoids Math.random unpredictability)
  let rngState = (cfg.rangeNm * 1000 + cfg.aspectAngleDeg * 17 + cfg.shooterAlt + cfg.targetAlt) | 0;
  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
    return (rngState >>> 0) / 0xffffffff;
  }

  // Detection timeline: launch event at t=0, seeker/radar events added during loop
  const detectionTimeline: DetectionEvent[] = [];
  detectionTimeline.push({ time: 0, type: 'launch', description: `${m.name} launched` });
  let searchDetected = false;
  let sttLocked = false;
  let sttLockTime = -1;
  const shooterRadar = cfg.shooterAircraftData?.radar ?? null;
  const targetRcs = cfg.targetAircraftData?.rcs_m2 ?? 3.0;

  // Dynamic WEZ (updated every 10 frames)
  let currentWez: WEZResult | undefined;
  let wezCounter = 0;

  // Shooter maneuver + datalink state
  const shooterManeuverType: ShooterManeuverType = cfg.shooterManeuver ?? 'none';
  const radarGimbalDeg = cfg.shooterAircraftData?.radarGimbalDeg ?? cfg.shooterAircraftData?.radar?.gimbalLimit_deg ?? 70;
  let datalinkActive = true;
  let datalinkWasLost = false;
  // IOG: ARH always has inertial mid-course; SARH depends on hasIOG field
  const hasIOG = m.hasIOG ?? (m.type === 'ARH');
  // Separate flag for SARH datalink-loss ballistic state (avoids overloading the CM seduced flag)
  let sarhDatalinkLost = false;

  // RWR persistence: threats fade over 6 s on disappearance rather than vanishing instantly
  const persistentThreats = new Map<string, RWRThreat>();

  // CM objects in flight (for visual rendering)
  let activeCMObjects: CMObject[] = [];
  let cmObjectIdCounter = 0;

  // ── Salvo secondary missiles (slots 1..N-1) ────────────────────────────────
  interface SalvoSlot {
    launchTime: number;
    state: MissileState;
    tFlight: number;          // time since this missile's launch
    seduced: boolean;
    seductionEndTime: number;
    lastKnownX: number;
    lastKnownY: number;
    activeRecorded: boolean;
    done: boolean;
  }

  const salvoCount = Math.max(1, Math.min(4, cfg.salvoCount ?? 1));
  const salvoInterval = cfg.salvoInterval_s ?? 2.0;
  const secondarySlots: SalvoSlot[] = [];
  for (let i = 1; i < salvoCount; i++) {
    // Create a pre-launch state (will be replaced when slot launches)
    const preLaunchState = createMissileState(
      shooterX, shooterY, initialHeadingDeg, shooterSpeedMs, cfg.shooterAlt,
    );
    secondarySlots.push({
      launchTime: i * salvoInterval,
      state: { ...preLaunchState, motorBurning: false, active: false },
      tFlight: 0,
      seduced: false,
      seductionEndTime: 0,
      lastKnownX: targetX,
      lastKnownY: targetY,
      activeRecorded: false,
      done: false,
    });
  }

  /** Snapshot all salvo missiles for a frame (pre-launch missiles park at origin) */
  function snapshotMissiles(lead: MissileState): MissileState[] {
    return [lead, ...secondarySlots.map((s) =>
      time >= s.launchTime ? s.state : { ...lead, x: shooterState.x, y: shooterState.y, motorBurning: false, active: false, trail: [], energy: 0, speedMs: 0, vx: 0, vy: 0, vz: 0 }
    )];
  }

  while (time < maxTime) {
    // --- Seeker activation (before stepAircraft so detection can gate maneuver) ---
    const dxSk = targetState.x - missileState.x;
    const dySk = targetState.y - missileState.y;
    const rangeSk = Math.sqrt(dxSk * dxSk + dySk * dySk);

    // IR: seeker is already locked before launch — activate immediately on first tick
    if (!missileState.active && m.type === 'IR') {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        const ssDx = shooterState.x - targetState.x;
        const ssDy = shooterState.y - targetState.y;
        aPoleNm = Math.sqrt(ssDx * ssDx + ssDy * ssDy) * M_TO_NM;
        activeRecorded = true;
        detectionTimeline.push({ time, type: 'missile_active', description: `${m.name} IR seeker locked at launch (${(rangeSk * M_TO_NM).toFixed(1)} nm)` });
      }
    }
    if (!missileState.active && m.type === 'ARH' && rangeSk <= seekerRangeM) {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        const ssDx = shooterState.x - targetState.x;
        const ssDy = shooterState.y - targetState.y;
        aPoleNm = Math.sqrt(ssDx * ssDx + ssDy * ssDy) * M_TO_NM;
        activeRecorded = true;
        detectionTimeline.push({ time, type: 'missile_active', description: `${m.name} seeker active at ${(rangeSk * M_TO_NM).toFixed(1)} nm` });
      }
    }
    if (m.type === 'SARH' && !missileState.active) {
      missileState = { ...missileState, active: true };
      if (!activeRecorded) {
        aPoleNm = cfg.rangeNm;
        activeRecorded = true;
        detectionTimeline.push({ time, type: 'missile_active', description: `${m.name} SARH seeker active` });
      }
    }

    // --- IR lock loss: target opened range beyond 1.5× seeker acquisition range ---
    // IR seekers cannot reacquire at long range; missile goes ballistic if outrun.
    if (missileState.active && m.type === 'IR') {
      const irMaxTrackRange = seekerRangeM * 1.5;
      if (rangeSk > irMaxTrackRange && !seduced) {
        missileState = { ...missileState, active: false };
        lastKnownTargetX = targetState.x;
        lastKnownTargetY = targetState.y;
        seduced = true;
        seductionEndTime = time + 9999; // permanent ballistic — no reacquire at range
        detectionTimeline.push({ time, type: 'launch', description: `${m.name} seeker lost lock — target outran at ${(rangeSk * M_TO_NM).toFixed(1)} nm` });
      }
    }

    // --- Radar detection timeline (shooter radar → target search & lock) ---
    if (shooterRadar && !searchDetected) {
      const s2tRange = Math.hypot(targetState.x - shooterState.x, targetState.y - shooterState.y);
      const detectRange = shooterRadar.maxRange_nm * NM_TO_M *
        Math.pow(Math.max(targetRcs / shooterRadar.referenceRCS_m2, 0.01), 0.25);
      if (s2tRange <= detectRange) {
        searchDetected = true;
        sttLockTime = time + shooterRadar.scanTime_s;
        detectionTimeline.push({
          time,
          type: 'search_detected',
          description: `Target detected at ${(s2tRange * M_TO_NM).toFixed(1)} nm`,
        });
      }
    }
    if (shooterRadar && searchDetected && !sttLocked && time >= sttLockTime) {
      sttLocked = true;
      detectionTimeline.push({ time, type: 'stt_lock', description: 'STT lock achieved' });
    }

    // --- Threat detection (for react-on-detect feature) ---
    if (!threatDetectedByTarget) {
      if (m.type === 'ARH' && missileState.active) {
        // ARH seeker pings target → RWR spike
        threatDetectedByTarget = true;
      } else if (m.type === 'IR' && hasMaws && missileState.motorBurning && rangeSk <= MAWS_DETECT_RANGE_M) {
        // MAWS detects UV/IR motor plume within 6nm — coasting missiles have no plume
        threatDetectedByTarget = true;
      }
    }

    // --- Update maneuver gate based on detection events ---
    if (!targetShouldManeuver) {
      if (reactOnDetect) {
        // Only maneuver once the target has detected the specific threat
        if (m.type === 'IR') {
          // IR: MAWS detection gates maneuver (already latched in threatDetectedByTarget)
          targetShouldManeuver = hasMaws && threatDetectedByTarget;
        } else {
          // ARH/SARH: seeker active = RWR active spike → maneuver
          targetShouldManeuver = missileState.active;
        }
      } else if (m.type === 'IR') {
        // IR without reactOnDetect: maneuver immediately (pre-planned defensive posture)
        targetShouldManeuver = true;
      }
    }

    // --- Step target aircraft (with threat-gated maneuvering + energy model) ---
    const newTarget = stepAircraft(
      targetState, DT,
      missileState.x, missileState.y,
      targetShouldManeuver,
      !reactOnDetect || threatDetectedByTarget,
      cfg.targetAircraftData,
    );

    // Track last known target position when seeker is active
    if (missileState.active && !seduced) {
      lastKnownTargetX = newTarget.x;
      lastKnownTargetY = newTarget.y;
    }

    // --- Countermeasure dispensing & seduction check (DCS missiles_prb_coeff.lua model) ---
    let cmEventThisFrame: CMEvent | undefined;

    if (missileState.active && !seduced && time - lastCmDispenseTime >= CM_INTERVAL) {
      const isIR = m.type === 'IR';
      const isRadar = m.type === 'ARH' || m.type === 'SARH';

      // Missile→target closing rate (m/s) — used by radar chaff Doppler model
      const mtDx = newTarget.x - missileState.x;
      const mtDy = newTarget.y - missileState.y;
      const mtRange = Math.sqrt(mtDx * mtDx + mtDy * mtDy);
      const radialVel = mtRange > 1
        ? ((newTarget.vx - missileState.vx) * mtDx + (newTarget.vy - missileState.vy) * mtDy) / mtRange
        : 0;
      const absClosingRate = Math.abs(radialVel);

      // Ticks per CM salvo (CM_INTERVAL / DT = 40 ticks at DT=0.05s)
      const ticksPerSalvo = CM_INTERVAL / DT;

      if (isIR && flareRemaining > 0) {
        // DCS IR flare model (k7, k9, k11):
        // Aspect factor: front hemisphere = k7 (dim plume), rear = 2−k7 (bright exhaust)
        const missAngle = Math.atan2(missileState.x - newTarget.x, missileState.y - newTarget.y);
        const tgtHeadRad = (newTarget.headingDeg * Math.PI) / 180;
        const aspectDiffIR = Math.abs(normalizeAngleRad(missAngle - tgtHeadRad));
        const isFrontHemi = aspectDiffIR < Math.PI / 2;
        const aspectFactor = isFrontHemi ? DCS_CM_COEFFS.k7 : (2.0 - DCS_CM_COEFFS.k7);
        const screenFactor = isFrontHemi ? DCS_CM_COEFFS.k9 : DCS_CM_COEFFS.k11;
        // Convert per-tick P to per-salvo P: P_salvo = 1 − (1 − p_tick)^N
        const pPerTick = screenFactor * aspectFactor;
        const pSeduced = Math.min(0.95, ccmK0 * (1 - Math.pow(Math.max(0, 1 - pPerTick), ticksPerSalvo)));

        const roll = nextRng();
        flareRemaining--;
        flareSalvosUsed++;
        lastCmDispenseTime = time;

        // Spawn flare object (falls at 15 m/s, 3s lifetime)
        activeCMObjects.push({
          id: cmObjectIdCounter++,
          type: 'flare',
          x: newTarget.x, y: newTarget.y, altFt: newTarget.altFt,
          vx: newTarget.vx * 0.3, vy: newTarget.vy * 0.3, vzMs: -15,
          lifetime: 3.0, maxLifetime: 3.0, opacity: 1.0,
        });

        if (roll < pSeduced) {
          seduced = true;
          seductionEndTime = time + 2.0 + nextRng() * 2.0;
          cmEventThisFrame = { type: 'flare_seduced', probability: pSeduced, cm: 'flare' };
          seductionEvents.push(cmEventThisFrame);
        } else {
          cmEventThisFrame = { type: 'cm_defeated', probability: pSeduced, cm: 'flare' };
        }
      } else if (isRadar && chaffRemaining > 0) {
        // DCS radar chaff model (k3, k4, k5, k6):
        // Interpolate P per tick between k4 (beam, low Vr) and k3 (head-on, high Vr)
        const vrClamped = Math.max(DCS_CM_COEFFS.k6, Math.min(DCS_CM_COEFFS.k5, absClosingRate));
        const vrFrac = (vrClamped - DCS_CM_COEFFS.k6) / (DCS_CM_COEFFS.k5 - DCS_CM_COEFFS.k6);
        const pPerTick = DCS_CM_COEFFS.k4 - vrFrac * (DCS_CM_COEFFS.k4 - DCS_CM_COEFFS.k3);
        const pSeduced = Math.min(0.92, ccmK0 * (1 - Math.pow(Math.max(0, 1 - pPerTick), ticksPerSalvo)));

        const roll = nextRng();
        chaffRemaining--;
        chaffSalvosUsed++;
        lastCmDispenseTime = time;

        // Spawn chaff cloud (drifts at 2 m/s, 8s lifetime)
        activeCMObjects.push({
          id: cmObjectIdCounter++,
          type: 'chaff',
          x: newTarget.x, y: newTarget.y, altFt: newTarget.altFt,
          vx: newTarget.vx * 0.05, vy: newTarget.vy * 0.05, vzMs: -2,
          lifetime: 8.0, maxLifetime: 8.0, opacity: 1.0,
        });

        if (roll < pSeduced) {
          seduced = true;
          seductionEndTime = time + 1.5 + nextRng() * 2.5;
          cmEventThisFrame = { type: 'chaff_seduced', probability: pSeduced, cm: 'chaff' };
          seductionEvents.push(cmEventThisFrame);
        } else {
          cmEventThisFrame = { type: 'cm_defeated', probability: pSeduced, cm: 'chaff' };
        }
      }
    }

    // --- Step CM objects (physics + decay) ---
    activeCMObjects = activeCMObjects
      .map((cm) => ({
        ...cm,
        x: cm.x + cm.vx * DT,
        y: cm.y + cm.vy * DT,
        altFt: Math.max(0, cm.altFt + (cm.vzMs * DT) / FT_TO_M),
        lifetime: cm.lifetime - DT,
        opacity: cm.lifetime / cm.maxLifetime,
      }))
      .filter((cm) => cm.lifetime > 0 && cm.altFt > 0);

    // --- Re-acquisition after seduction ---
    if (seduced && time >= seductionEndTime && rangeSk <= seekerRangeM * 1.5) {
      seduced = false;
      cmEventThisFrame = { type: 'reacquired', probability: 1.0, cm: m.type === 'IR' ? 'flare' : 'chaff' };
    }

    // Seduced missile homes on last known position (or flies blind)
    const guidanceTargetX = seduced ? lastKnownTargetX : newTarget.x;
    const guidanceTargetY = seduced ? lastKnownTargetY : newTarget.y;

    // ── Thrust and mass: multi-phase if available, else linear burnout model ─
    const burning = time < burnTime;
    let currentMass: number;
    let thrustForce: number;
    if (useMultiPhase) {
      const [thr, mss] = getThrustAndMass(time, propPhases, mass);
      thrustForce = thr;
      currentMass = mss;
    } else {
      currentMass = burning ? mass - (mass - massBurnout) * (time / burnTime) : massBurnout;
      thrustForce = burning ? thrust : 0;
    }

    // ── Virtual target altitude: loft / SAM steep launch / terminal ──────────
    const mzM = missileState.altFt * FT_TO_M;
    const tzActual = newTarget.altFt * FT_TO_M;
    const horizDistE = Math.hypot(guidanceTargetX - missileState.x, guidanceTargetY - missileState.y);
    const effectiveTriggerM = loftTriggerM ?? maxRangeM * 0.5;
    const effectiveDescentM = loftDescentM ?? maxRangeM * 0.25;
    const tzGuide = computeLoftAltitude(
      mzM, tzActual, horizDistE,
      loftAngle, effectiveTriggerM, effectiveDescentM,
      seduced, isGroundLaunched, burning, burnTime > 0 ? time / burnTime : 1,
    );

    // ── Proportional nav — 3D; PN gain on actual 3D range to real target ─────
    const range3DActual = Math.sqrt(
      (newTarget.x - missileState.x) ** 2 +
      (newTarget.y - missileState.y) ** 2 +
      (tzActual - mzM) ** 2,
    );
    const currentNavN = getPNGain(range3DActual, pnSchedule, navN);
    const guidOut = proportionalNav({
      mx: missileState.x, my: missileState.y, mz: mzM,
      mvx: missileState.vx, mvy: missileState.vy, mvz: missileState.vz,
      tx: guidanceTargetX, ty: guidanceTargetY, tz: tzGuide,
      tvx: seduced ? 0 : newTarget.vx,
      tvy: seduced ? 0 : newTarget.vy,
      tvz: seduced ? 0 : (newTarget.vzMs ?? 0),
      navConst: currentNavN,
    });

    const { range, closingVelocity } = seduced
      ? { range: Math.sqrt(dxSk * dxSk + dySk * dySk), closingVelocity: 0 }
      : guidOut;

    let ax: number, ay: number, az: number, limited: boolean;
    if (time < controlDelay) {
      // Ballistic phase: fins locked — no PN commands.
      ax = 0; ay = 0; az = 0; limited = false;
    } else if (sarhDatalinkLost) {
      // Pure SARH without IOG: illuminator lost → no PN commands.
      ax = 0; ay = 0; az = 0; limited = false;
    } else {
      ({ ax, ay, az, limited } = clampAcceleration(guidOut.ax, guidOut.ay, guidOut.az, gLimit, missileState.speedMs));
      if (limited && !seduced) {
        missReason = 'insufficient maneuverability';
      }
    }
    // Gravity bias: autopilot always cancels gravity in the vertical channel.
    // Combined with the -G in the integrator, net vertical force is zero at baseline.
    // PN then provides corrections relative to this level-flight reference.
    az += G;
    // Track peak lateral G-load from guidance commands
    const gLoad = Math.sqrt(ax * ax + ay * ay + az * az) / G;
    if (gLoad > peakGLoad) peakGLoad = gLoad;

    // ── 3D speed and drag ─────────────────────────────────────────────────────
    const speed3D = Math.sqrt(
      missileState.vx * missileState.vx +
      missileState.vy * missileState.vy +
      missileState.vz * missileState.vz,
    );
    const mach3D = speed3D / speedOfSound(missileState.altFt);
    const effectiveCd = cxModel
      ? getCxDCS(mach3D, cxModel)
      : cd * machDragMultiplierFallback(mach3D);
    const fdrag3D = dragForce(speed3D, missileState.altFt, effectiveCd, area);

    // ── Thrust acts along the current velocity vector (body = velocity) ───────
    const invMass = 1 / currentMass;
    const safeDenom = Math.max(speed3D, 0.001);
    let vhx3D: number, vhy3D: number, vhz3D: number;
    if (speed3D < 1.0) {
      const launchRad = (initialHeadingDeg * Math.PI) / 180;
      vhx3D = Math.sin(launchRad);
      vhy3D = Math.cos(launchRad);
      vhz3D = 0;
    } else {
      vhx3D = missileState.vx / safeDenom;
      vhy3D = missileState.vy / safeDenom;
      vhz3D = missileState.vz / safeDenom;
    }
    const thrustAccX = thrustForce * invMass * vhx3D;
    const thrustAccY = thrustForce * invMass * vhy3D;
    const thrustAccZ = thrustForce * invMass * vhz3D;

    // ── Drag acts opposite to full 3D velocity ────────────────────────────────
    const dragAccX = -(fdrag3D * invMass) * (missileState.vx / safeDenom);
    const dragAccY = -(fdrag3D * invMass) * (missileState.vy / safeDenom);
    const dragAccZ = -(fdrag3D * invMass) * (missileState.vz / safeDenom);

    // ── Integrate (3D PN az replaces the old decoupled elevCmd) ──────────────
    const newVz = missileState.vz + (az + thrustAccZ + dragAccZ - G) * DT;
    const newVx = missileState.vx + (ax + thrustAccX + dragAccX) * DT;
    const newVy = missileState.vy + (ay + thrustAccY + dragAccY) * DT;
    const newSpeed3D = Math.sqrt(newVx * newVx + newVy * newVy + newVz * newVz);
    const newAlt = Math.max(0, missileState.altFt + (newVz * DT) / FT_TO_M);

    // Energy fraction uses current-altitude speed of sound for accurate Mach display
    const maxSpeedMsNow = m.maxSpeed_mach
      ? m.maxSpeed_mach * speedOfSound(newAlt)
      : 1500;
    const energyFrac = Math.min(1, newSpeed3D / maxSpeedMsNow);

    // Check total 3D speed (not just horizontal) to avoid false termination
    // during steep climb phase of SAMs
    if (newSpeed3D < 50) {
      missReason = 'insufficient energy';
      const fdx = shooterState.x - newTarget.x;
      const fdy = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      const allMsls = [{ state: missileState, done: false }, ...secondarySlots.filter(s => s.tFlight > 0).map(s => ({ state: s.state, done: s.done }))];
      const rawRwrEnergy = computeRWR(newTarget, shooterState, allMsls, m, seekerRangeM, hasMaws, time, cfg.shooterAircraftData);
      const rwrEnergy = persistRWR(rawRwrEnergy, persistentThreats, time);
      frames.push(buildFrame(time, snapshotMissiles(missileState), shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrEnergy, currentWez, datalinkActive, activeCMObjects));
      break;
    }

    // ── CPA hit detection: segment-vs-segment catches pass-through ───────────
    const newMx = missileState.x + newVx * DT;
    const newMy = missileState.y + newVy * DT;
    const cpa = closestApproachDist(
      missileState.x, missileState.y, missileState.altFt * FT_TO_M,  // missile start
      newMx, newMy, newAlt * FT_TO_M,                                 // missile end
      targetState.x, targetState.y, targetState.altFt * FT_TO_M,     // target start (pre-step)
      newTarget.x, newTarget.y, newTarget.altFt * FT_TO_M,            // target end (post-step)
    );
    if (!seduced && cpa < KILL_RADIUS_M) {
      hitDetected = true;
      const fdxH = shooterState.x - newTarget.x;
      const fdyH = shooterState.y - newTarget.y;
      fPoleNm = Math.sqrt(fdxH * fdxH + fdyH * fdyH) * M_TO_NM;
      if (!activeRecorded) aPoleNm = fPoleNm;
      const allMslsHit = [{ state: missileState, done: false }, ...secondarySlots.filter(s => s.tFlight > 0).map(s => ({ state: s.state, done: s.done }))];
      const rawRwrHit = computeRWR(newTarget, shooterState, allMslsHit, m, seekerRangeM, hasMaws, time, cfg.shooterAircraftData);
      const rwrHit = persistRWR(rawRwrHit, persistentThreats, time);
      frames.push(buildFrame(time + DT, snapshotMissiles(missileState), shooterState, newTarget, cpa, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrHit, currentWez, datalinkActive, activeCMObjects));
      break;
    }

    // ── Ground-strike check (missile hit terrain after boost) ─────────────────
    if (newAlt <= 0 && newVz < 0 && time > burnTime + 1.0) {
      missReason = 'ground strike';
      frames.push(buildFrame(time + DT, snapshotMissiles(missileState), shooterState, newTarget, range, closingVelocity, maxSpeedMs, cmEventThisFrame, undefined, currentWez, datalinkActive, activeCMObjects));
      break;
    }

    const newTrail = [...missileState.trail, { x: missileState.x, y: missileState.y, alt: missileState.altFt }];
    if (newTrail.length > 500) newTrail.shift();

    missileState = {
      ...missileState,
      x: newMx,
      y: newMy,
      vx: newVx,
      vy: newVy,
      vz: newVz,
      speedMs: newSpeed3D,   // true 3D airspeed (not horizontal-only)
      altFt: newAlt,
      timeFlight: time + DT,
      motorBurning: burning,
      energy: energyFrac,
      trail: newTrail,
    };

    // Track peak speed and distance traveled
    distanceTraveledM += newSpeed3D * DT;
    if (newSpeed3D > peakSpeedMs) {
      peakSpeedMs = newSpeed3D;
      altAtPeakSpeed = newAlt;
    }

    // --- Step shooter (post-launch maneuver) ---
    if (isGroundLaunched) {
      // Ground launchers are stationary — no step needed
    } else {
      shooterState = stepShooterManeuver(
        shooterState,
        newTarget.x, newTarget.y,
        DT,
        shooterManeuverType,
        time,
        cfg.shooterAircraftData,
      );
    }

    // --- Datalink gate: is target within shooter radar gimbal? ---
    const gimbalRad = gimbalAngle(
      shooterState.headingDeg,
      shooterState.x, shooterState.y,
      newTarget.x, newTarget.y,
    );
    const gimbalDeg = gimbalRad * 180 / Math.PI;
    const newDatalinkActive = gimbalDeg <= radarGimbalDeg;

    if (!newDatalinkActive && datalinkActive && !datalinkWasLost) {
      datalinkWasLost = true;
      detectionTimeline.push({ time, type: 'datalink_lost', description: `Datalink lost (gimbal ${gimbalDeg.toFixed(0)}° > ${radarGimbalDeg}°)` });
    } else if (newDatalinkActive && !datalinkActive) {
      datalinkWasLost = false;
      detectionTimeline.push({ time, type: 'datalink_restored', description: 'Datalink restored' });
    }
    datalinkActive = newDatalinkActive;

    // Apply datalink loss to guidance for next tick:
    // - ARH with IOG: continues on last known target position (already handled by lastKnownTargetX/Y)
    // - SARH pure (no IOG): goes ballistic when illuminator lost, resumes when restored
    // - SARH with IOG: dead-reckon mid-course (same as ARH with IOG)
    if (m.type === 'SARH' && !hasIOG) {
      sarhDatalinkLost = !datalinkActive;
    }

    // --- Per-frame WEZ update (every 10 frames) ---
    if (wezCounter % 10 === 0) {
      const bearingTargetToShooter = Math.atan2(shooterState.x - newTarget.x, shooterState.y - newTarget.y);
      const wezTargetHeadRad = (newTarget.headingDeg * Math.PI) / 180;
      const wezAspect = Math.abs(normalizeAngleRad(wezTargetHeadRad - bearingTargetToShooter)) * 180 / Math.PI;
      currentWez = computeDLZ(
        m, shooterState.altFt, shooterState.speedMs / 0.514444,
        newTarget.altFt, newTarget.speedMs / 0.514444, wezAspect,
      );
    }
    wezCounter++;

    // --- Step secondary salvo missiles ---
    for (const slot of secondarySlots) {
      if (slot.done) continue;

      if (time >= slot.launchTime && slot.tFlight === 0) {
        // Launch this slot now
        slot.state = createMissileState(
          shooterState.x, shooterState.y, shooterState.headingDeg, shooterState.speedMs, shooterState.altFt,
        );
        slot.lastKnownX = newTarget.x;
        slot.lastKnownY = newTarget.y;
      }

      if (time >= slot.launchTime) {
        slot.tFlight += DT;
        const sFlight = slot.tFlight;

        // Seeker activation
        const sdx = newTarget.x - slot.state.x;
        const sdy = newTarget.y - slot.state.y;
        const sRange = Math.sqrt(sdx * sdx + sdy * sdy);
        if (!slot.state.active && (m.type === 'ARH' || m.type === 'IR') && sRange <= seekerRangeM) {
          slot.state = { ...slot.state, active: true };
        }
        if (m.type === 'SARH' && !slot.state.active) {
          slot.state = { ...slot.state, active: true };
        }

        if (!slot.seduced && slot.state.active) {
          slot.lastKnownX = newTarget.x;
          slot.lastKnownY = newTarget.y;
        }

        // Re-acquisition
        if (slot.seduced && time >= slot.seductionEndTime && sRange <= seekerRangeM * 1.5) {
          slot.seduced = false;
        }

        const sBurning = sFlight < burnTime;
        let sCurrentMass: number;
        let sThrustForce: number;
        if (useMultiPhase) {
          const [thr, mss] = getThrustAndMass(sFlight, propPhases, mass);
          sThrustForce = thr;
          sCurrentMass = mss;
        } else {
          sCurrentMass = sBurning ? mass - (mass - massBurnout) * (sFlight / burnTime) : massBurnout;
          sThrustForce = sBurning ? thrust : 0;
        }

        const sMz = slot.state.altFt * FT_TO_M;
        const sTz = newTarget.altFt * FT_TO_M;
        const sGuidX = slot.seduced ? slot.lastKnownX : newTarget.x;
        const sGuidY = slot.seduced ? slot.lastKnownY : newTarget.y;
        const sHorizDist = Math.hypot(sGuidX - slot.state.x, sGuidY - slot.state.y);
        const sTzGuide = computeLoftAltitude(
          sMz, sTz, sHorizDist,
          loftAngle, effectiveTriggerM, effectiveDescentM,
          slot.seduced, isGroundLaunched, sFlight < burnTime, burnTime > 0 ? sFlight / burnTime : 1,
        );

        const sGuidOut = proportionalNav({
          mx: slot.state.x, my: slot.state.y, mz: sMz,
          mvx: slot.state.vx, mvy: slot.state.vy, mvz: slot.state.vz,
          tx: sGuidX, ty: sGuidY, tz: sTzGuide,
          tvx: slot.seduced ? 0 : newTarget.vx,
          tvy: slot.seduced ? 0 : newTarget.vy,
          tvz: slot.seduced ? 0 : (newTarget.vzMs ?? 0),
          navConst: getPNGain(sRange, pnSchedule, navN),
        });

        let sAx: number, sAy: number, sAz: number;
        if (sFlight < controlDelay) {
          sAx = 0; sAy = 0; sAz = 0; // no PN during fins-locked phase
        } else {
          ({ ax: sAx, ay: sAy, az: sAz } = clampAcceleration(sGuidOut.ax, sGuidOut.ay, sGuidOut.az, gLimit, slot.state.speedMs));
        }
        sAz += G; // gravity bias: universal gravity compensation for all phases

        const sSpeed3D = Math.sqrt(slot.state.vx ** 2 + slot.state.vy ** 2 + slot.state.vz ** 2);
        const sMach = sSpeed3D / speedOfSound(slot.state.altFt);
        const sECd = cxModel ? getCxDCS(sMach, cxModel) : cd * machDragMultiplierFallback(sMach);
        const sFDrag = dragForce(sSpeed3D, slot.state.altFt, sECd, area);
        const sInvMass = 1 / sCurrentMass;
        const sSafe = Math.max(sSpeed3D, 0.001);
        const sTAx = sThrustForce * sInvMass * (slot.state.vx / sSafe);
        const sTAy = sThrustForce * sInvMass * (slot.state.vy / sSafe);
        const sTAz = sThrustForce * sInvMass * (slot.state.vz / sSafe);
        const sDAx = -(sFDrag * sInvMass) * (slot.state.vx / sSafe);
        const sDAy = -(sFDrag * sInvMass) * (slot.state.vy / sSafe);
        const sDAz = -(sFDrag * sInvMass) * (slot.state.vz / sSafe);

        const sNewVz = slot.state.vz + (sAz + sTAz + sDAz - G) * DT;
        const sNewVx = slot.state.vx + (sAx + sTAx + sDAx) * DT;
        const sNewVy = slot.state.vy + (sAy + sTAy + sDAy) * DT;
        const sNewSpeed = Math.sqrt(sNewVx ** 2 + sNewVy ** 2 + sNewVz ** 2);
        const sNewAlt = Math.max(0, slot.state.altFt + (sNewVz * DT) / FT_TO_M);
        const sNewMx = slot.state.x + sNewVx * DT;
        const sNewMy = slot.state.y + sNewVy * DT;

        // Hit/miss check — segment-vs-segment CPA
        const sCpa = closestApproachDist(
          slot.state.x, slot.state.y, slot.state.altFt * FT_TO_M,  // missile start
          sNewMx, sNewMy, sNewAlt * FT_TO_M,                        // missile end
          targetState.x, targetState.y, targetState.altFt * FT_TO_M, // target start
          newTarget.x, newTarget.y, newTarget.altFt * FT_TO_M,       // target end
        );
        if (!slot.seduced && sCpa < KILL_RADIUS_M) {
          slot.done = true;
        }
        if (sNewSpeed < 50 || (sNewAlt <= 0 && sNewVz < 0)) {
          slot.done = true;
        }

        const sTrail = [...slot.state.trail, { x: slot.state.x, y: slot.state.y, alt: slot.state.altFt }];
        if (sTrail.length > 500) sTrail.shift();

        const sEnergyFrac = Math.min(1, sNewSpeed / maxSpeedMs);
        slot.state = {
          ...slot.state,
          x: sNewMx, y: sNewMy, vx: sNewVx, vy: sNewVy, vz: sNewVz,
          speedMs: sNewSpeed, altFt: sNewAlt,
          timeFlight: sFlight,
          motorBurning: sBurning,
          active: slot.state.active,
          energy: sEnergyFrac,
          trail: sTrail,
        };
      }
    }

    targetState = newTarget;
    time += DT;

    const allMslsFrame = [{ state: missileState, done: false }, ...secondarySlots.filter(s => s.tFlight > 0).map(s => ({ state: s.state, done: s.done }))];
    const rawRwrFrame = computeRWR(targetState, shooterState, allMslsFrame, m, seekerRangeM, hasMaws, time, cfg.shooterAircraftData);
    const rwrFrame = persistRWR(rawRwrFrame, persistentThreats, time);
    frames.push(buildFrame(time, snapshotMissiles(missileState), shooterState, targetState, range, closingVelocity, maxSpeedMs, cmEventThisFrame, rwrFrame, currentWez, datalinkActive, activeCMObjects));
  }

  if (time >= maxTime && !hitDetected) {
    missReason = 'timeout';
    const fdx = shooterState.x - targetState.x;
    const fdy = shooterState.y - targetState.y;
    fPoleNm = Math.sqrt(fdx * fdx + fdy * fdy) * M_TO_NM;
    if (!activeRecorded) aPoleNm = fPoleNm;
  }

  // If seduced at end of engagement, that's a miss
  if (seduced && !hitDetected && !missReason) {
    missReason = seductionEvents[0]?.cm === 'flare' ? 'defeated by flares' : 'defeated by chaff';
  }

  const lastMissile = missileState;
  const mdx = lastMissile.x - targetState.x;
  const mdy = lastMissile.y - targetState.y;
  const mdAltM = (lastMissile.altFt - targetState.altFt) * FT_TO_M;
  const missDistance = Math.sqrt(mdx * mdx + mdy * mdy + mdAltM * mdAltM);

  const pk = computePk({
    hit: hitDetected,
    missDistance,
    terminalSpeedMs: lastMissile.speedMs,
    targetManeuver: cfg.targetManeuver,
    missileType: m.type,
    gLimit,
    seduced,
    closingVelocity: frames.length > 0 ? frames[frames.length - 1].closingVelocity : 0,
  });

  const verdict = buildVerdict(pk, hitDetected, missReason);

  const result: EngagementResult = {
    hit: hitDetected,
    pk,
    timeOfFlight: time,
    missDistance: hitDetected ? 0 : missDistance,
    terminalSpeedMs: lastMissile.speedMs,
    terminalSpeedMach: lastMissile.speedMs / speedOfSound(lastMissile.altFt),
    fPoleNm,
    aPoleNm,
    verdict,
    missReason: hitDetected ? undefined : missReason,
    chaffSalvosUsed,
    flareSalvosUsed,
    seductionEvents,
    maxSpeedMach: peakSpeedMs / speedOfSound(altAtPeakSpeed),
    maxGLoad: peakGLoad,
    distanceTraveledNm: distanceTraveledM * M_TO_NM,
    targetExitSpeedKts: targetState.speedMs / 0.514444,
    shooterExitSpeedKts: shooterState.speedMs / 0.514444,
    detectionTimeline,
  };

  return { frames, result, maxRangeM, minRangeM, nezM, shooterStartX: shooterX, shooterStartY: shooterY };
}

function buildFrame(
  time: number,
  missiles: MissileState[],
  shooter: AircraftState,
  target: AircraftState,
  range: number,
  cv: number,
  maxSpeedMs: number,
  cmEvent?: CMEvent,
  rwr?: RWRState,
  wez?: WEZResult,
  datalinkActive?: boolean,
  countermeasures?: CMObject[],
): SimFrame {
  const tti = cv > 0 ? range / cv : 9999;
  const lead = missiles[0];
  return {
    time,
    missiles: missiles.map((m) => ({ ...m })),
    missile: { ...lead },   // backward compat alias
    shooter: { ...shooter },
    target: { ...target },
    range,
    closingVelocity: cv,
    timeToImpact: tti,
    energyFraction: lead.energy,
    cmEvent,
    rwr,
    wez,
    datalinkActive,
    countermeasures: countermeasures ? [...countermeasures] : [],
  };
}

interface PkInput {
  hit: boolean;
  missDistance: number;
  terminalSpeedMs: number;
  targetManeuver: ManeuverType;
  missileType: string;
  gLimit: number;
  seduced: boolean;
  closingVelocity: number;
}

function computePk(i: PkInput): number {
  if (i.seduced) return 0;
  if (i.hit && i.terminalSpeedMs > 200) {
    let pk = 0.95;
    if (i.targetManeuver === 'break') pk *= 0.75;
    else if (i.targetManeuver === 'notch') {
      // Notch is most effective vs radar seekers
      if (i.missileType === 'SARH') pk *= 0.5;
      else if (i.missileType === 'ARH') pk *= 0.7;
      else pk *= 0.85;
    }
    else if (i.targetManeuver === 'crank') pk *= 0.88;
    return Math.max(0, Math.min(1, pk));
  }
  if (i.hit && i.terminalSpeedMs <= 200) return 0.3;
  if (i.missDistance < 50) return 0.4;
  if (i.missDistance < 200) return 0.1;
  return 0;
}

function normalizeAngleRad(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ── RWR / MAWS computation ────────────────────────────────────────────────────

/**
 * Deterministic bearing noise that drifts slowly (changes every 0.5 s).
 * Degrades accuracy at long range: ±0° at ≤5 km, ±10° at 150 km+.
 * Uses a hash of emitterId + time-bucket so noise is stable frame-to-frame.
 */
function bearingNoise(bearing: number, rangeM: number, emitterId: string, time: number): number {
  const maxNoiseDeg = Math.min(10, Math.max(0, (rangeM - 5000) / 145000 * 10));
  if (maxNoiseDeg < 0.01) return bearing;
  const bucket = Math.floor(time * 2); // 0.5 s buckets
  let h = 5381;
  for (let i = 0; i < emitterId.length; i++) h = (((h << 5) + h) ^ emitterId.charCodeAt(i)) | 0;
  h = ((h * 1664525 + bucket * 22695477 + 1013904223) | 0) >>> 0;
  const jitter = (h / 0x100000000 - 0.5) * 2 * maxNoiseDeg;
  return (bearing + jitter + 360) % 360;
}

/**
 * Merge a fresh per-tick RWR snapshot into the persistent threat map.
 * Active threats are refreshed; absent threats fade over 6 seconds then expire.
 */
function persistRWR(
  raw: RWRState,
  persistent: Map<string, RWRThreat>,
  time: number,
): RWRState {
  const FADE_S = 6.0;
  const activeIds = new Set<string>();

  for (const t of raw.radarThreats) {
    activeIds.add(t.emitterId);
    persistent.set(t.emitterId, t); // refresh with latest data (lastSeenTime = time)
  }

  const threats: RWRThreat[] = [];
  for (const [id, t] of persistent) {
    if (activeIds.has(id)) {
      threats.push(t);
    } else {
      const age = time - t.lastSeenTime;
      if (age > FADE_S) { persistent.delete(id); continue; }
      threats.push({ ...t, intensity: t.intensity * Math.max(0, 1 - age / FADE_S) });
    }
  }
  return { ...raw, radarThreats: threats };
}

/**
 * Compute RWR and MAWS state from the target aircraft's perspective.
 *
 * RWR detects RADAR emissions only:
 *   - SARH: continuous CW illumination from shooter — label = shooter's rwrSymbol
 *   - ARH pre-pitbull: FCR TWS/STT from shooter bearing — label = shooter's rwrSymbol
 *   - ARH post-pitbull: active seeker from missile bearing — label = missile's rwrSymbol ("M")
 *   - IR: SILENT — no radar return, RWR cannot detect them
 *
 * Accepts an array of missiles to support salvo engagements.
 * Each in-flight missile produces its own MAWS sector and ARH active-seeker threat.
 * Shooter FCR appears as a single entry regardless of salvo count.
 *
 * MAWS detects UV/IR motor plumes (all types) if hasMaws===true; tier 2 also tracks coasting.
 */
function computeRWR(
  target: AircraftState,
  shooter: AircraftState,
  missiles: Array<{ state: MissileState; done: boolean }>,
  missileData: MissileData,
  seekerRangeM: number,
  hasMaws: boolean,
  time: number,
  shooterAircraftData?: AircraftData,
): RWRState {
  const radarThreats: RWRThreat[] = [];
  const targetHeadRad = (target.headingDeg * Math.PI) / 180;

  /** Bearing from target to point (px,py), relative to target heading, 0–360 */
  function relBearing(px: number, py: number): number {
    const absRad = Math.atan2(px - target.x, py - target.y);
    return ((absRad - targetHeadRad) * 180 / Math.PI + 360) % 360;
  }

  const shooterRangeM = Math.hypot(shooter.x - target.x, shooter.y - target.y);
  // Emitter labels: shooter's radar designator pre-pitbull, missile seeker designator post-pitbull
  const shooterRwrLabel = shooterAircraftData?.rwrSymbol ?? 'U';
  const missileRwrLabel = missileData.rwrSymbol ?? 'M';

  // ── SARH: shooter continuously illuminates with CW radar — single emitter ──
  if (missileData.type === 'SARH') {
    const primaryMsl = missiles.find(m => !m.done);
    if (primaryMsl) {
      radarThreats.push({
        bearing: bearingNoise(relBearing(shooter.x, shooter.y), shooterRangeM, 'shooter-fcr', time),
        type: primaryMsl.state.active ? 'launch' : 'track',
        label: shooterRwrLabel,
        intensity: Math.min(1, 50000 / Math.max(shooterRangeM, 1000)),
        lastSeenTime: time,
        emitterId: 'shooter-fcr',
      });
    }
  }

  // ── ARH: pre-pitbull = shooter FCR (one entry); post-pitbull = each missile seeker ──
  if (missileData.type === 'ARH') {
    const anyPrePitbull = missiles.some(m => !m.done && !m.state.active);
    if (anyPrePitbull) {
      radarThreats.push({
        bearing: bearingNoise(relBearing(shooter.x, shooter.y), shooterRangeM, 'shooter-fcr', time),
        type: 'track',
        label: shooterRwrLabel,
        intensity: Math.min(0.7, 30000 / Math.max(shooterRangeM, 1000)),
        lastSeenTime: time,
        emitterId: 'shooter-fcr',
      });
    }
    for (let mi = 0; mi < missiles.length; mi++) {
      const msl = missiles[mi];
      if (msl.done || !msl.state.active) continue;
      const mRangeM = Math.hypot(msl.state.x - target.x, msl.state.y - target.y);
      const mtx = target.x - msl.state.x, mty = target.y - msl.state.y;
      const cr = mRangeM > 1 ? (msl.state.vx * mtx + msl.state.vy * mty) / mRangeM : 0;
      if (cr <= -50) continue; // passed target
      const eid = `missile-${mi}-seeker`;
      radarThreats.push({
        bearing: bearingNoise(relBearing(msl.state.x, msl.state.y), mRangeM, eid, time),
        type: 'active',
        label: missileRwrLabel,
        intensity: Math.min(1, seekerRangeM / Math.max(mRangeM, 100)),
        lastSeenTime: time,
        emitterId: eid,
      });
    }
  }
  // IR: no radar signature

  // ── MAWS: UV/IR detection for each in-flight missile ────────────────────────
  const MAWS_RANGE_MOTOR = 11112; // 6 nm — motor plume
  const MAWS_RANGE_COAST = 5556;  // 3 nm — body UV (tier 2 only)
  const mawsTier = shooterAircraftData?.mawsTier ?? 1;
  const mawsActive: MAWSSector[] = [];
  let mawsWarning = false;

  for (const msl of missiles) {
    if (msl.done) continue;
    const mRangeM = Math.hypot(msl.state.x - target.x, msl.state.y - target.y);
    const mtx2 = target.x - msl.state.x, mty2 = target.y - msl.state.y;
    const cr2 = mRangeM > 1 ? (msl.state.vx * mtx2 + msl.state.vy * mty2) / mRangeM : 0;
    if (cr2 <= -50) continue;
    const canDetectMotor = hasMaws && msl.state.motorBurning && mRangeM <= MAWS_RANGE_MOTOR;
    const canDetectCoast = hasMaws && mawsTier >= 2 && !msl.state.motorBurning && mRangeM <= MAWS_RANGE_COAST;
    if (canDetectMotor || canDetectCoast) {
      mawsWarning = true;
      const sectorIdx = Math.round(relBearing(msl.state.x, msl.state.y) / 45) % 8;
      if (!mawsActive.some(s => s.sectorIdx === sectorIdx)) {
        mawsActive.push({ sectorIdx, active: true });
      }
    }
  }

  const anyActiveApproaching = missileData.type === 'ARH' &&
    missiles.some(m => !m.done && m.state.active);

  return {
    radarThreats,
    mawsWarning,
    mawsSectors: mawsActive,
    radarWarning: missileData.type === 'SARH' || anyActiveApproaching,
    launchWarning: anyActiveApproaching,
  };
}

function buildVerdict(pk: number, hit: boolean, missReason: string): string {
  if (!hit) {
    if (missReason === 'insufficient energy') return 'Miss — insufficient energy';
    if (missReason === 'insufficient maneuverability') return 'Miss — defeated by maneuver';
    if (missReason === 'defeated by flares') return 'Miss — seduced by flares';
    if (missReason === 'defeated by chaff') return 'Miss — seduced by chaff';
    if (missReason === 'timeout') return 'Miss — engagement timeout';
    return `Miss — ${missReason || 'unknown'}`;
  }
  if (pk >= 0.85) return 'Kill';
  if (pk >= 0.65) return 'Probable Kill';
  if (pk >= 0.35) return 'Marginal';
  return 'Kill — low terminal energy';
}
