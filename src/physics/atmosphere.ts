// ISA (International Standard Atmosphere) model

const RHO0 = 1.225;       // kg/m³ sea-level density
const A0 = 340.29;        // m/s sea-level speed of sound
const G = 9.80665;        // m/s²
const FT_TO_M = 0.3048;
const KTS_TO_MS = 0.514444;
const NM_TO_M = 1852;
const M_TO_NM = 1 / 1852;

/** Air density at altitude (ft) using ISA model */
export function airDensity(altFt: number): number {
  const altM = altFt * FT_TO_M;
  const factor = 1 - 0.0000068756 * altM;
  return factor > 0 ? RHO0 * Math.pow(factor, 5.2559) : 0;
}

/** Speed of sound at altitude (ft), returns m/s */
export function speedOfSound(altFt: number): number {
  const altM = altFt * FT_TO_M;
  // Temperature lapse rate in troposphere (~0–36,000 ft)
  const T0 = 288.15; // K
  const L = 0.0065;  // K/m
  const T = Math.max(216.65, T0 - L * altM);
  return Math.sqrt(1.4 * 287.05 * T);
}

/** Convert Mach to m/s at given altitude (ft) */
export function machToMs(mach: number, altFt: number): number {
  return mach * speedOfSound(altFt);
}

/** Convert m/s to Mach at given altitude (ft) */
export function msToMach(ms: number, altFt: number): number {
  const sos = speedOfSound(altFt);
  return sos > 0 ? ms / sos : 0;
}

export { FT_TO_M, KTS_TO_MS, NM_TO_M, M_TO_NM, G, A0 };
