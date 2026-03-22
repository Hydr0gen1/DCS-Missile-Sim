// ── DCS-fidelity rich schema (optional — present when extracted from datamine) ─

export interface CxCoeffs {
  k0: number;   // subsonic baseline Cd
  k1: number;   // transonic wave-crisis peak height
  k2: number;   // transonic front steepness
  k3: number;   // supersonic baseline shift
  k4: number;   // post-crisis drag decline steepness
}

export interface ThrustPhase {
  name: string;         // "accel", "march", etc.
  duration_s: number;
  thrust_N: number;
  fuelFlow_kg_s: number;
}

export interface PNEntry {
  range_m: number;
  N: number;
}

export interface DLZ {
  headOn_10km_m: number | null;
  tailChase_10km_m: number | null;
  headOn_1km_m: number | null;
  aspectCoeff: number | null;
  lowerHemiSlope: number | null;
  upperHemiSlope: number | null;
  hemiBendAngle: number | null;
  altSlopeModifier: number | null;
}

// ── Flat missile record (simulator-facing) ────────────────────────────────────

export interface MissileData {
  id: string;
  name: string;
  type: 'ARH' | 'SARH' | 'IR';
  seeker: string;                 // display string, e.g. "Active Radar (ARH)"

  // --- Required physics fields (flat legacy) ---
  motorBurnTime_s: number | null;
  thrust_N: number | null;
  mass_kg: number | null;
  massBurnout_kg: number | null;
  /** Subsonic Cx0 (baseline drag coefficient, replaces flat Cd for DCS model) */
  dragCoefficient: number | null;
  /** DCS reference area (m²) used in drag formula: F = 0.5 ρ v² Cx A_ref */
  referenceArea_m2: number | null;
  maxSpeed_mach: number | null;
  maxRange_nm: number | null;
  gLimit: number | null;
  seekerAcquisitionRange_nm: number | null;
  loftAngle_deg: number | null;
  guidanceNav: number | null;

  /**
   * Countermeasure vulnerability factor (DCS ccm_k0).
   * Lower = more resistant. IR missiles: flare susceptibility. Radar: chaff susceptibility.
   */
  ccm_k0: number | null;

  /**
   * True if this radar-guided missile has Inertial/GPS midcourse guidance (IOG),
   * allowing it to home on last-known target if the datalink is lost temporarily.
   * AIM-120C/D (ARH with IOG) and R-27ER (SARH with IOG) set this true.
   * AIM-7E (pure SARH) sets this false — ballistic if illuminator lost.
   */
  hasIOG?: boolean;

  /**
   * True if this IR missile uses INS + datalink mid-course guidance from the shooter's radar.
   * During mid-course, the shooter radar tracks the target → target's RWR sees a track strobe.
   * When the IR seeker activates at terminal phase, the radar goes silent — RWR warning disappears.
   * Examples: R-27ET, R-27T, MICA-IR, R-40TD.
   */
  hasDatalink?: boolean;

  /** DCS KillDistance: proximity fuze lethal radius in meters.
   *  SAMs: 10–60m; large ARH/SARH: 12–20m; IR/dogfight: 5–8m; MANPADs: 1–3m. */
  killDistance_m?: number;

  /** True if this is a synthetic test round, not a real weapon */
  isSynthetic?: boolean;

  /** RWR symbol shown when this missile's active ARH seeker is detected (e.g. "120", "77", "M") */
  rwrSymbol?: string;

  // --- Rich DCS-fidelity fields (optional — from datamine extraction) ---

  /** Mach-dependent 5-coefficient drag model (DCS Cx polar) */
  aerodynamics?: {
    Cx: CxCoeffs;
    Cy?: { k0: number; k1: number; k2: number };
    polar_damping?: number;
    alfa_max_rad?: number;
  };

  /** Multi-phase thrust profile (DCS accurate) */
  propulsion?: {
    phases: ThrustPhase[];
    totalBurnTime_s: number | null;
    totalFuelMass_kg: number | null;
    massAtBurnout_kg: number | null;
  };

  /** Guidance system data */
  guidance?: {
    /** Range-dependent PN gain schedule (null = use flat guidanceNav) */
    pn_schedule: PNEntry[] | null;
    autopilot?: {
      delay_s: number | null;
      loft_active: boolean;
      loft_sin: number | null;
      loft_off_range_m: number | null;
      fins_limit: number | null;
      gload_limit: number | null;
      Knav: number | null;
    } | null;
    controlDelay_s?: number | null;
  };

  /** Loft guidance parameters */
  loft?: {
    triggerRange_m: number | null;
    descentRange_m: number | null;
    elevationSin: number | null;
    elevationDeg: number | null;
  };

  /** Dynamic Launch Zone values (exact DCS HUD data) */
  dlz?: DLZ;

  /** Seeker specification (IR gimbal limits, etc.) */
  seekerSpec?: {
    /** Maximum off-boresight angle in radians (half-angle of seeker FOV cone).
     *  AIM-9M: 0.79 rad (±45°), R-73: 1.31 rad (±75°), AIM-9X: 1.57 rad (±90°) */
    gimbalLimit_rad?: number;
  };

  /** DCS source metadata */
  dcsName?: string;
  sourceFile?: string;
  dcsVersion?: string;
}

export interface AircraftData {
  id: string;
  name: string;
  maxSpeedKts: number;
  ceilingFt: number;
  radarGimbalDeg: number;
  hasMaws: boolean;
  // Energy model (optional — falls back to constant-speed if absent)
  maxThrust_N?: number;
  mass_kg?: number;
  wingArea_m2?: number;
  Cd0?: number;
  K_induced?: number;
  maxG?: number;
  cornerSpeedKts?: number;
  minSpeedKts?: number;
  // Radar cross-section of this aircraft (m²)
  rcs_m2?: number;
  // Shooter radar config
  radar?: RadarConfig;
  /** DCS-accurate RWR emitter symbol shown on target's RWR scope (e.g. "16"=F-16, "27"=Su-27) */
  rwrSymbol?: string;
  /** MAWS capability tier: 1=UV motor plume only (AN/AAR-47), 2=persistent UV tracking (DAS) */
  mawsTier?: number;
  /** Missile IDs this aircraft can carry. Undefined = no restriction (shows all missiles). */
  compatibleMissiles?: string[];
}

export interface RadarConfig {
  maxRange_nm: number;
  referenceRCS_m2: number;
  gimbalLimit_deg: number;
  /** Effective detection range (nm) in look-down mode (target below shooter altitude).
   *  Pulse-Doppler clutter limits this below the flat-look maxRange_nm.
   *  If absent, maxRange_nm is used for all geometries. */
  lookDownRange_nm?: number;
  scanTime_s: number;
  twsAccuracy_m: number;
  sttAccuracy_m: number;
  lookdownSpeedGate_mps: number;
}

/** Dynamic Launch Zone result computed per-frame */
export interface WEZResult {
  rmax_m: number;
  nez_m: number;
  rmin_m: number;
}

/** Shooter post-launch maneuver type */
export type ShooterManeuverType = 'none' | 'crank_left' | 'crank_right' | 'pump' | 'drag';

/** Pre-launch radar detection event */
export interface DetectionEvent {
  time: number;
  type: 'search_detected' | 'stt_lock' | 'launch' | 'missile_active' | 'datalink_lost' | 'datalink_restored' | 'lock';
  description: string;
}

/** Countermeasure object tracked per-frame for visual rendering */
export interface CMObject {
  id: number;
  type: 'chaff' | 'flare';
  x: number;
  y: number;
  altFt: number;
  vx: number;      // m/s
  vy: number;      // m/s
  vzMs: number;    // m/s (negative = falling)
  lifetime: number;    // time remaining (s)
  maxLifetime: number;
  opacity: number;
}

// ── RWR / MAWS types ──────────────────────────────────────────────────────────

/** Radar Warning Receiver threat type.
 * RWR only detects RADAR emissions — IR missiles are silent to RWR. */
export type RWRThreatType = 'search' | 'track' | 'launch' | 'active' | 'maws';

export interface RWRThreat {
  /** Degrees relative to target heading (0 = nose, 90 = right, 180 = tail) */
  bearing: number;
  type: RWRThreatType;
  /** Emitter label: shooter's rwrSymbol pre-pitbull, missileData.rwrSymbol post-pitbull */
  label: string;
  /** 0–1, inversely proportional to range */
  intensity: number;
  /** Sim time (s) when this threat was last seen by computeRWR — used for persistence fade */
  lastSeenTime: number;
  /** Unique emitter ID for persistence tracking ("shooter-fcr", "missile-0-seeker", etc.) */
  emitterId: string;
}

/** MAWS sector index 0–7 mapped clockwise from nose
 *  (0=ahead, 1=NE, 2=right, 3=SE, 4=aft, 5=SW, 6=left, 7=NW) */
export interface MAWSSector {
  sectorIdx: number;
  active: boolean;
}

export interface RWRState {
  /** Radar-detected threats only (SARH illumination, ARH active seeker).
   *  IR missiles produce NO entries here. */
  radarThreats: RWRThreat[];
  /** True when MAWS-equipped aircraft detects missile motor plume (any type) */
  mawsWarning: boolean;
  /** Active MAWS sectors (coarse 8-sector bearing, not precise) */
  mawsSectors: MAWSSector[];
  /** True when shooter radar is actively tracking/illuminating (SARH or ARH seeker active) */
  radarWarning: boolean;
  /** True when a radar-guided missile seeker is active */
  launchWarning: boolean;
}
