// ISA (International Standard Atmosphere) model

const RHO0 = 1.225;       // kg/m³ sea-level density
const A0 = 340.29;        // m/s sea-level speed of sound
const G = 9.80665;        // m/s²
const FT_TO_M = 0.3048;
const KTS_TO_MS = 0.514444;
const NM_TO_M = 1852;
const M_TO_NM = 1 / 1852;

/** Air density at altitude (ft) using two-layer ISA standard atmosphere model.
 *  Troposphere  (0–36,089 ft / 0–11,000 m): temperature decreases at 6.5 K/km
 *  Stratosphere (36,089–65,617 ft / 11,000–20,000 m): isothermal at 216.65 K
 */
export function airDensity(altFt: number): number {
  const altM = altFt * FT_TO_M;
  const H_TROPO = 11000; // m — tropopause height
  if (altM <= H_TROPO) {
    // Troposphere: ρ = ρ₀·(T/T₀)^(g/LR − 1)  exponent = 4.2559
    // T/T₀ = 1 − (L/T₀)·h, where L/T₀ = 0.0065/288.15 = 2.2558×10⁻⁵ m⁻¹
    const factor = 1 - 2.2558e-5 * altM;
    return factor > 0 ? RHO0 * Math.pow(factor, 4.2559) : 0;
  }
  // Stratosphere: isothermal — exponential decay with scale height H = R·T₁₁/g
  const rho_tropo = RHO0 * Math.pow(1 - 2.2558e-5 * H_TROPO, 4.2559); // ≈ 0.3639 kg/m³
  const scaleHeight = (287.05 * 216.65) / G; // ≈ 6341.6 m
  return rho_tropo * Math.exp(-(altM - H_TROPO) / scaleHeight);
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
