/**
 * DCS global countermeasure probability coefficients.
 * Source: missiles_prb_coeff.lua (Quaggles datamine)
 *
 * These govern the per-salvo probability that a seeker switches to a
 * countermeasure, as a function of target radial velocity (radar seekers)
 * or target aspect angle (IR seekers).
 */
export const DCS_CM_COEFFS = {
  // Radar seeker chaff model
  k3: 0.00001,  // P(switch) when radial velocity is HIGH (≥k5 m/s) — near-immune
  k4: 0.02,     // P(switch) when radial velocity is LOW (≤k6 m/s) — notch vulnerable
  k5: 100,      // m/s above which seeker is stable (head-on / tail-chase)
  k6: 30,       // m/s below which seeker is fully vulnerable (beam aspect)

  // IR seeker aspect model (k7: front signature factor)
  // front-aspect: k7 (dim), beam: 1.0 (moderate), rear: 2-k7 (bright exhaust)
  k7: 0.5,

  // Screen factors (probability of seduction when CM and target overlap in FOV)
  k8: 0.02,   // Radar, forward hemisphere
  k9: 0.01,   // IR, forward hemisphere
  k10: 0.02,  // Radar, rear hemisphere
  k11: 0.01,  // IR, rear hemisphere
} as const;
