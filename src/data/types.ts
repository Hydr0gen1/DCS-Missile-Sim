export interface MissileData {
  id: string;
  name: string;
  type: 'ARH' | 'SARH' | 'IR';
  seeker: string;
  motorBurnTime_s: number | null;
  thrust_N: number | null;
  mass_kg: number | null;
  massBurnout_kg: number | null;
  dragCoefficient: number | null;
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
   * Sourced from DCS Lua datamine where available.
   */
  ccm_k0: number | null;
  /** True if this is a synthetic test round, not a real weapon */
  isSynthetic?: boolean;
}

export interface AircraftData {
  id: string;
  name: string;
  maxSpeedKts: number;
  ceilingFt: number;
  radarGimbalDeg: number;
  /**
   * True if this aircraft is equipped with a Missile Approach Warning System (MAWS).
   * In DCS, the A-10C II uses the AN/AAR-47 MAWS, which detects IR/UV missile plumes
   * and provides coarse sector warnings for ALL missile types including IR.
   * The F-16C and F/A-18C do not have a simulated MAWS in DCS.
   * Standard RWR cannot detect IR missiles — only MAWS can.
   */
  hasMaws: boolean;
}

// ── RWR / MAWS types ──────────────────────────────────────────────────────────

/** Radar Warning Receiver threat type.
 * RWR only detects RADAR emissions — IR missiles are silent to RWR. */
export type RWRThreatType = 'search' | 'track' | 'launch' | 'active';

export interface RWRThreat {
  /** Degrees relative to target heading (0 = nose, 90 = right, 180 = tail) */
  bearing: number;
  type: RWRThreatType;
  /** Short missile label, e.g. "120C", "27ER", "9M" */
  label: string;
  /** 0–1, inversely proportional to range */
  intensity: number;
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
