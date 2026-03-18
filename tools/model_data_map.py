"""
ModelData index-to-meaning map for DCS missile flight model arrays.

The ModelData array uses 1-based indices (Lua convention).
Index 1 is always the parameter count (usually 58).

Reconstructed from pre-DCS-2.7 source comments and community documentation.
"""

# fmt: off
MODEL_DATA_MAP = {
    1:  "param_count",               # Number of model parameters (usually 58)
    2:  "reference_area_m2",         # Characteristic reference area (m²)

    # --- Cx (drag) polar — parametric Mach-dependent model ---
    3:  "Cx_k0",                     # Subsonic baseline drag (M << 1)
    4:  "Cx_k1",                     # Transonic wave-crisis peak height
    5:  "Cx_k2",                     # Transonic front steepness
    6:  "Cx_k3",                     # Supersonic baseline shift (M >> 1)
    7:  "Cx_k4",                     # Post-crisis drag decline steepness

    8:  "polar_damping_coeff",       # Induced drag polar damping coefficient

    # --- Cy (lift) coefficients — Mach-dependent ---
    9:  "Cy_k0",                     # Subsonic lift coefficient (M << 1)
    10: "Cy_k1",                     # Supersonic lift coefficient (M >> 1)
    11: "Cy_k2",                     # Transonic lift decline steepness

    12: "alfa_max_rad",              # Maximum balancing angle of attack (radians)
    13: "gas_rudder_moment",         # Angular velocity from gas rudder torque

    # --- Thrust timeline — 7 phases (start, boost, accel, march, inertial, brake, end) ---
    # Row 1: Duration of each phase (seconds); -1 = phase not used
    14: "phase_time_start",
    15: "phase_time_boost",          # Separate booster stage (e.g., some SAMs)
    16: "phase_time_accel",          # Main accelerator / single-stage motor burn time
    17: "phase_time_march",          # Sustainer / march phase burn time
    18: "phase_time_inertial",
    19: "phase_time_brake",
    20: "phase_time_end",

    # Row 2: Fuel mass flow per phase (kg/s)
    21: "fuel_flow_start",
    22: "fuel_flow_boost",
    23: "fuel_flow_accel",           # kg/s during accel phase
    24: "fuel_flow_march",           # kg/s during march/sustainer
    25: "fuel_flow_inertial",
    26: "fuel_flow_brake",
    27: "fuel_flow_end",

    # Row 3: Thrust per phase (Newtons)
    28: "thrust_start",
    29: "thrust_boost",
    30: "thrust_accel",              # Booster/accelerator thrust (N)
    31: "thrust_march",              # Sustainer thrust (N)
    32: "thrust_inertial",
    33: "thrust_brake",
    34: "thrust_end",

    35: "self_destruct_timer_s",     # Self-destruction timer (seconds)
    36: "power_system_time_s",       # Power system operation time (seconds)
    37: "prox_fuze_dist_m",          # Proximity fuze trigger distance (m); use KillDistance if 0
    38: "control_delay_s",           # Control system activation delay (seconds)

    # --- Loft guidance parameters ---
    39: "loft_range_trigger_m",      # Range > this: activate loft; 1e9 = disabled
    40: "loft_descent_range_m",      # Range < this: begin loft descent
    41: "loft_elevation_sin",        # sin(climb angle); e.g. 0.524 → ~31.5°

    42: "fuze_arm_accel",            # Longitudinal accel for fuze arming (g)
    43: "reserved_43",               # Reserved / unused

    # --- ACS (Autopilot Control System) filter coefficients ---
    44: "acs_filter_K0",             # 2nd-order ACS filter coefficient K0
    45: "acs_filter_K1",             # 2nd-order ACS filter coefficient K1
    46: "acs_bandwidth",             # Control loop bandwidth (Hz or rad/s)

    # --- Range estimation aids ---
    47: "range_est_p0",              # Range at H=2000m, Navail≥1.0g
    48: "range_est_p1",              # Slope of range vs altitude
    49: "range_est_p2",              # Correction from carrier speed
    50: "guidance_efficiency",       # Dimensionless guidance efficiency (0–1)
    51: "flight_time_forecast_s",    # Predicted total flight time (seconds)

    # --- DLZ (Dynamic Launch Zone) — exact values used by DCS HUD ---
    52: "dlz_head_on_10km_m",        # Rmax head-on, H=10000m, V=1100km/h (meters)
    53: "dlz_tail_chase_10km_m",     # Rmax tail-chase, same conditions (meters)
    54: "dlz_head_on_1km_m",         # Rmax head-on, H=1000m, V=1100km/h (meters)
    55: "dlz_aspect_coeff",          # Range reduction coefficient vs aspect angle
    56: "dlz_lower_hemi_slope",      # Range curve slope — lower hemisphere
    57: "dlz_upper_hemi_slope",      # Range curve slope — upper hemisphere
    58: "dlz_hemi_bend_angle",       # Bend angle (degrees) of upper/lower boundary
    59: "dlz_alt_slope_modifier",    # Altitude modifier for hemisphere slopes
}

# Index set for quick lookup
MODEL_DATA_INDICES = set(MODEL_DATA_MAP.keys())

# DCS seeker type mapping
DCS_SEEKER_TYPE = {
    1: "infrared",
    2: "active_radar",       # ARH
    3: "anti_radiation",     # ARM
    4: "laser_homing",
    5: "autonomous",         # INS/GPS/TV/IIR — not guided by own seeker
    6: "semi_active_radar",  # SARH
    7: "saclos",             # Semi-automatic command to line of sight
    8: "tele_guidance",      # TV/datalink guided
}

# A2A seeker types (the ones our simulator handles)
A2A_SEEKER_TYPES = {1, 2, 6}  # IR, ARH, SARH

# Our simulator's type string mapping
SIM_TYPE_MAP = {
    1: "IR",
    2: "ARH",
    6: "SARH",
}

# Value representing "disabled / infinity" in DCS data
INF_VALUE = 1_000_000_000
