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
  /** True if this is a synthetic test round, not a real weapon */
  isSynthetic?: boolean;
}

export interface AircraftData {
  id: string;
  name: string;
  maxSpeedKts: number;
  ceilingFt: number;
  radarGimbalDeg: number;
}
