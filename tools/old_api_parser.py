#!/usr/bin/env python3
"""
Parse old-API DCS missile Lua files (no ModelData array) and derive flight-model parameters.

These are missiles in datamine/_G/rockets/ that use flat fields (Cx_pil, t_acc, t_marsh,
v_mid, M, Diam, etc.) instead of the 59-element ModelData array used by new-API missiles.

Key differences from new API:
- No ModelData → no 5-coeff Cx polar, no per-phase thrust from ModelData
- May have `fm` block with 6-DOF model data (cx_coeff, caliber)
- May have `march`/`march2`/`booster` blocks with impulse/fuel_mass/work_time
- Otherwise uses t_acc/t_marsh/v_mid to estimate thrust kinematically
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path
from typing import Any

# Ensure tools/ is on path for lua_parser import
sys.path.insert(0, str(Path(__file__).parent))

M_TO_NM = 1 / 1852

# ── Seeker type mapping ────────────────────────────────────────────────────────
A2A_HEAD_TYPES = {1, 2, 6}  # IR, ARH, SARH

SIM_TYPE_MAP = {
    1: 'IR',
    2: 'ARH',
    6: 'SARH',
}

SEEKER_DISPLAY = {
    'IR': 'Infrared (IR)',
    'ARH': 'Active Radar (ARH)',
    'SARH': 'Semi-Active Radar (SARH)',
}


# ── Lua field extraction helpers ───────────────────────────────────────────────

def _try_float(s: str) -> float | None:
    """Try to parse a string as a float (handles Lua numeric formats)."""
    s = s.strip()
    try:
        return float(s)
    except ValueError:
        return None


def _extract_flat_fields(text: str) -> dict[str, Any]:
    """
    Extract top-level key=value fields from old-API Lua.
    Handles string values, numeric values, booleans, and nested table detection.
    Returns flat dict of {field: value}.
    """
    fields: dict[str, Any] = {}
    # Remove comments
    text = re.sub(r'--[^\n]*', '', text)

    # Extract simple key = scalar value pairs (not tables)
    for m in re.finditer(
        r'\b([A-Za-z_]\w*)\s*=\s*'
        r'("(?:[^"\\]|\\.)*"|'    # quoted string
        r"'(?:[^'\\]|\\.)*'|"    # single-quoted string
        r'true|false|'            # booleans
        r'[0-9][0-9e.+\-]*'      # numbers (incl. 1e9, 1e-05, etc.)
        r')',
        text,
    ):
        key = m.group(1)
        val_s = m.group(2)
        if val_s in ('true', 'false'):
            fields[key] = val_s == 'true'
        elif val_s.startswith('"') or val_s.startswith("'"):
            fields[key] = val_s.strip('"\'')
        else:
            v = _try_float(val_s)
            if v is not None:
                fields[key] = v
    return fields


def _extract_block(text: str, block_name: str) -> dict[str, Any] | None:
    """
    Extract a named nested table block as a flat dict.
    Handles nested sub-tables (e.g. nozzle_orientationXYZ = { { 0, 0, 0 } }).
    """
    # Find start of block_name = {
    start_pat = re.compile(r'\b' + re.escape(block_name) + r'\s*=\s*\{', re.DOTALL)
    m = start_pat.search(text)
    if not m:
        return None

    start = m.end() - 1  # position of opening '{'
    depth = 0
    end = start
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                end = i
                break
    else:
        return None  # unmatched brace

    block_content = text[start + 1:end]
    return _extract_flat_fields(block_content)


def _extract_array(text: str, name: str) -> list[float] | None:
    """Extract a 1-D Lua array as a Python list of floats."""
    pattern = re.compile(
        r'\b' + re.escape(name) + r'\s*=\s*\{([^}]*)\}',
    )
    m = pattern.search(text)
    if not m:
        return None
    nums = re.findall(r'-?[0-9][0-9e.+\-]*', m.group(1))
    result = []
    for n in nums:
        v = _try_float(n)
        if v is not None:
            result.append(v)
    return result if result else None


def _extract_pn_coeffs(text: str) -> list[tuple[float, float]] | None:
    """
    Parse PN_coeffs table: { count, r1, N1, r2, N2, ... }
    Returns list of (range_m, N_gain) pairs.
    """
    arr = _extract_array(text, 'PN_coeffs')
    if not arr or len(arr) < 3:
        return None
    count = int(arr[0])
    pairs = []
    for i in range(count):
        idx = 1 + i * 2
        if idx + 1 >= len(arr):
            break
        pairs.append((arr[idx], arr[idx + 1]))
    return pairs if pairs else None


# ── Physics derivation ─────────────────────────────────────────────────────────

def _derive_motor_from_block(
    block: dict[str, Any] | None,
    phase_name: str,
) -> dict | None:
    """
    Derive a ThrustPhase dict from a `march` / `march2` / `booster` DCS motor block.

    DCS motor block fields:
        fuel_mass   (kg) — propellant mass consumed in this phase
        impulse     (s)  — specific impulse (Isp) in seconds
        work_time   (s)  — burn duration

    Thrust = Isp × g × (fuel_mass / work_time)
    """
    if block is None:
        return None
    fuel_mass = block.get('fuel_mass')
    impulse   = block.get('impulse')
    work_time = block.get('work_time')

    if not fuel_mass or not impulse or not work_time or work_time <= 0.01:
        return None
    if fuel_mass <= 0 or impulse <= 0:
        return None

    thrust_n = impulse * fuel_mass * 9.80665 / work_time
    fuel_flow = fuel_mass / work_time

    return {
        'name':           phase_name,
        'duration_s':     round(float(work_time), 3),
        'thrust_N':       round(thrust_n, 1),
        'fuelFlow_kg_s':  round(fuel_flow, 4),
    }


def _derive_cx_from_fm(fm: dict | None, cx_coeff_list: list[float] | None) -> dict | None:
    """
    Extract 5-coeff Cx from `fm.cx_coeff = { k0, k1, k2, k3, k4 }`.
    Returns {'k0':..., 'k1':..., 'k2':..., 'k3':..., 'k4':...} or None.

    IMPORTANT: old-API `fm.cx_coeff` uses a completely different parameterisation
    from the new ModelData Cx polynomial.  In the old format values of 0.5–1.5 are
    normal and DO NOT represent subsonic drag.  ModelData k0 is always < 0.15 for
    any real missile.  Reject old-API coefficients whose first value looks like the
    old format (k0 >= 0.15) so the caller falls through to _cx_from_cx_pil instead.
    """
    if cx_coeff_list and len(cx_coeff_list) >= 5:
        if cx_coeff_list[0] < 0.15:  # ModelData-compatible: accept
            return {
                'k0': cx_coeff_list[0],
                'k1': cx_coeff_list[1],
                'k2': cx_coeff_list[2],
                'k3': cx_coeff_list[3],
                'k4': cx_coeff_list[4],
            }
        # Old-API parameterisation — reject and fall through to _cx_from_cx_pil
    return None


def _cx_from_cx_pil(cx_pil: float) -> dict:
    """
    Estimate 5-coeff Cx model from DCS Cx_pil piloting multiplier.

    Cx_pil=1 → subsonic sleek missile, Cx_pil=5 → very draggy.
    Maps to approximate Cx_k0 (subsonic baseline drag coefficient).
    Reference area is the physical cross-section pi*(Diam/2)^2.
    """
    k0 = 0.015 + (cx_pil - 1.0) * 0.008
    k0 = max(0.01, min(k0, 0.1))
    return {
        'k0': round(k0, 4),
        'k1': round(k0 * 1.8, 4),
        'k2': 0.012,
        'k3': round(-k0 * 0.3, 4),
        'k4': 0.5,
    }


def _estimate_thrust_kinematic(
    mass_kg: float,
    v_mid_ms: float,
    t_acc_s: float,
    t_marsh_s: float,
    cx_k0: float,
    ref_area_m2: float,
    fuel_fraction: float = 0.35,
) -> tuple[list[dict], float]:
    """
    Estimate thrust phases and burnout mass when no motor block data is available.

    Uses the kinematic equation:
        F = m_avg * (v_mid / t_acc) + F_drag_avg

    Returns (phases list, burnout mass).
    """
    RHO_AVG = 0.9   # kg/m³ — average sea-level density during engagement
    G = 9.80665

    total_burn = t_acc_s + t_marsh_s
    if total_burn <= 0:
        return [], mass_kg

    # Fuel mass distribution (accel phase burns more fuel)
    fuel_total = mass_kg * fuel_fraction
    if t_acc_s > 0 and t_marsh_s > 0:
        fuel_acc   = fuel_total * 0.70  # 70% in boost phase
        fuel_marsh = fuel_total * 0.30  # 30% in sustainer
    elif t_acc_s > 0:
        fuel_acc   = fuel_total
        fuel_marsh = 0.0
    else:
        fuel_acc   = 0.0
        fuel_marsh = fuel_total

    burnout_mass = mass_kg - fuel_total

    # ── Accel phase ────────────────────────────────────────────────────────────
    phases = []
    if t_acc_s > 0:
        avg_mass = mass_kg - fuel_acc / 2.0
        accel    = v_mid_ms / max(t_acc_s, 0.1)
        # Drag at half of v_mid (mid-accel speed estimate)
        q_avg    = 0.5 * RHO_AVG * (v_mid_ms * 0.6) ** 2
        drag_avg = q_avg * cx_k0 * ref_area_m2
        thrust_n = avg_mass * accel + drag_avg
        thrust_n = max(thrust_n, mass_kg * G * 2)   # at least 2G net
        flow_acc = fuel_acc / t_acc_s if t_acc_s > 0 else 0.0
        phases.append({
            'name':          'accel',
            'duration_s':    round(t_acc_s, 3),
            'thrust_N':      round(thrust_n, 1),
            'fuelFlow_kg_s': round(flow_acc, 4),
        })

    # ── March / sustainer phase ────────────────────────────────────────────────
    if t_marsh_s > 0:
        # Sustainer thrust ≈ drag at v_mid (keep missile at cruise speed)
        q_vmid    = 0.5 * RHO_AVG * v_mid_ms ** 2
        drag_vmid = q_vmid * cx_k0 * ref_area_m2
        # Add small margin for altitude changes and transonic drag rise
        thrust_marsh = max(drag_vmid * 1.3, mass_kg * G * 0.5)
        flow_marsh   = fuel_marsh / t_marsh_s if t_marsh_s > 0 else 0.0
        phases.append({
            'name':          'march',
            'duration_s':    round(t_marsh_s, 3),
            'thrust_N':      round(thrust_marsh, 1),
            'fuelFlow_kg_s': round(flow_marsh, 4),
        })

    return phases, max(burnout_mass, mass_kg * 0.50)


# ── Warhead extraction ─────────────────────────────────────────────────────────

def _extract_inline_warhead(text: str, base_fields: dict) -> dict | None:
    """
    Extract inline warhead block: `warhead = { expl_mass = X, ... }`
    Returns {explosiveMass_kg, caliber_mm, piercingMass_kg} or None.
    """
    wh_block = _extract_block(text, 'warhead')
    if not wh_block:
        return None

    expl_mass = wh_block.get('expl_mass') or wh_block.get('mass')
    if not expl_mass:
        return None

    return {
        'type':              'blast_frag',
        'explosiveMass_kg':  float(expl_mass),
        'caliber_mm':        wh_block.get('caliber'),
        'piercingMass_kg':   wh_block.get('piercing_mass'),
        'reference':         None,
    }


def _extract_warhead_ref(text: str) -> str | None:
    """Extract warhead file reference string, e.g. '_G/warheads/FIM_92C.lua'."""
    m = re.search(r'warhead\s*=\s*"([^"]+)"', text)
    return m.group(1) if m else None


# ── Main entry point ───────────────────────────────────────────────────────────

def parse_old_api_file(
    lua_path: Path,
    warhead_lookup: dict[str, dict] | None = None,
) -> dict | None:
    """
    Parse a single old-API Lua missile file.

    Returns a missiles.json-compatible dict, or None if:
    - File has ModelData (new API — skip)
    - Head_Type is not in A2A_HEAD_TYPES
    - Parse fails
    """
    try:
        text = lua_path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        print(f'  WARN: cannot read {lua_path.name}: {e}', file=sys.stderr)
        return None

    # Skip new-API files
    if 'ModelData' in text:
        return None

    # ── Extract flat top-level fields ──────────────────────────────────────────
    f = _extract_flat_fields(text)

    head_type = int(f.get('Head_Type', 0))
    if head_type not in A2A_HEAD_TYPES:
        return None

    sim_type  = SIM_TYPE_MAP[head_type]
    mass_kg   = float(f.get('M') or f.get('mass') or 0)
    diam_mm   = float(f.get('Diam') or 0)
    mach_max  = float(f.get('Mach_max') or 2.0)
    nr_max    = float(f.get('Nr_max') or 20)
    d_max_m   = float(f.get('Range_max') or f.get('D_max') or 0)
    ccm_k0    = float(f.get('ccm_k0') or 0.5)
    life_time = float(f.get('Life_Time') or 60)
    kill_dist = float(f.get('KillDistance') or 7)

    # Seeker fields
    fi_excort   = float(f.get('Fi_excort') or 1.0)
    fi_search   = float(f.get('Fi_search') or 99.9)
    seeker_sens = float(f.get('SeekerSensivityDistance') or d_max_m or 10000)
    om_viz_max  = float(f.get('OmViz_max') or 99.9)

    # Burn times (from flat fields)
    t_acc   = float(f.get('t_acc') or 0)
    t_marsh = float(f.get('t_marsh') or 0)
    t_b     = float(f.get('t_b') or 0)
    v_mid   = float(f.get('v_mid') or 400)

    display_name = (
        f.get('display_name')
        or f.get('user_name')
        or f.get('name')
        or lua_path.stem
    )

    dcs_name  = f.get('name') or f.get('_unique_resource_name') or lua_path.stem
    unique_rn = f.get('_unique_resource_name')
    source_file = str(lua_path.name)

    # ── PN schedule ────────────────────────────────────────────────────────────
    pn_coeffs = _extract_pn_coeffs(text)
    pn_schedule = (
        [{'range_m': r, 'N': n} for r, n in pn_coeffs] if pn_coeffs
        else [{'range_m': 0, 'N': 4.0}]
    )

    # ── Motor / thrust derivation ──────────────────────────────────────────────
    # Priority: detailed motor blocks > kinematic estimate from t_acc/v_mid
    booster_block = _extract_block(text, 'booster')
    march_block   = _extract_block(text, 'march')
    march2_block  = _extract_block(text, 'march2')
    boost_block   = _extract_block(text, 'boost')   # Sea Dart uses 'boost'

    phases: list[dict] = []
    total_fuel_kg = 0.0

    # Try boost/booster first (initial ejection or booster motor)
    booster_phase = (_derive_motor_from_block(booster_block, 'boost') or
                     _derive_motor_from_block(boost_block, 'boost'))
    if booster_phase:
        phases.append(booster_phase)
        total_fuel_kg += booster_phase['fuelFlow_kg_s'] * booster_phase['duration_s']

    # Main motor (march)
    march_phase = _derive_motor_from_block(march_block, 'accel')
    if march_phase:
        phases.append(march_phase)
        total_fuel_kg += march_phase['fuelFlow_kg_s'] * march_phase['duration_s']

    # Sustainer (march2)
    march2_phase = _derive_motor_from_block(march2_block, 'march')
    if march2_phase:
        phases.append(march2_phase)
        total_fuel_kg += march2_phase['fuelFlow_kg_s'] * march2_phase['duration_s']

    # ── Aerodynamics ───────────────────────────────────────────────────────────
    fm_block = _extract_block(text, 'fm')
    cx_coeff_list = _extract_array(text, 'cx_coeff')
    fm_caliber = None
    if fm_block:
        fm_caliber = fm_block.get('caliber')  # meters (e.g. 0.072 for 72 mm)

    # Reference area: use fm.caliber if available (meters), else Diam field (mm)
    if fm_caliber and fm_caliber > 0:
        ref_area = math.pi * (fm_caliber / 2.0) ** 2
    elif diam_mm > 0:
        ref_area = math.pi * (diam_mm / 1000.0 / 2.0) ** 2
    else:
        ref_area = 0.01  # fallback

    cx = _derive_cx_from_fm(fm_block, cx_coeff_list)
    cx_pil = float(f.get('Cx_pil') or 2.0)
    if cx is None:
        cx = _cx_from_cx_pil(cx_pil)

    # ── Kinematic thrust estimate if no motor blocks found ─────────────────────
    if not phases:
        total_burn_time = t_acc + t_marsh + t_b
        if total_burn_time > 0 and mass_kg > 0 and v_mid > 0:
            kin_phases, burnout_mass_kin = _estimate_thrust_kinematic(
                mass_kg, v_mid, t_acc + t_b, t_marsh, cx['k0'], ref_area,
            )
            phases = kin_phases
            total_fuel_kg = mass_kg - burnout_mass_kin

    # Compute totals from phases
    total_burn_s = sum(p['duration_s'] for p in phases)
    # If phase data had direct motor blocks, total_fuel_kg was accumulated above
    # For kinematic estimate, it's already set
    burnout_mass = max(mass_kg - total_fuel_kg, mass_kg * 0.50) if total_fuel_kg > 0 else mass_kg * 0.65

    # ── Lead phase for flat thrust_N field ────────────────────────────────────
    thrust_n_flat = None
    if phases:
        # Use the highest-thrust phase (usually the boost/accel phase)
        thrust_n_flat = max(p['thrust_N'] for p in phases)

    # ── Guidance ───────────────────────────────────────────────────────────────
    autopilot_block = _extract_block(text, 'autopilot')
    control_delay = None
    if autopilot_block:
        control_delay = autopilot_block.get('delay')

    # ── Seeker spec ────────────────────────────────────────────────────────────
    # simple_gyrostab_seeker has accurate gimbal_lim
    gyrostab_block = _extract_block(text, 'simple_gyrostab_seeker')
    gimbal_lim = None
    if gyrostab_block:
        gimbal_lim = gyrostab_block.get('gimbal_lim')
    # Fall back to Fi_excort (already extracted)
    if gimbal_lim is None and fi_excort < 10.0:
        gimbal_lim = fi_excort

    # simple_IR_seeker block for IR seekers
    ir_seeker_block = _extract_block(text, 'simple_IR_seeker')
    ir_fov = None
    if ir_seeker_block:
        ir_fov = ir_seeker_block.get('FOV')

    seeker_spec: dict[str, Any] = {
        'type':                 sim_type,
        'acquisitionRange_m':   seeker_sens,
        'gimbalLimit_rad':      gimbal_lim,
        'maxOffBoresight_rad':  float(f.get('Fi_rak') or math.pi),
        'searchLimit_rad':      fi_search if fi_search < 10 else None,
        'maxLOSRate_rad_s':     om_viz_max if om_viz_max < 10 else None,
    }

    # ── Warhead ────────────────────────────────────────────────────────────────
    warhead_info = _extract_inline_warhead(text, f)
    if warhead_info is None:
        wh_ref = _extract_warhead_ref(text)
        if wh_ref and warhead_lookup:
            wh_name = Path(wh_ref).stem
            wh_data = warhead_lookup.get(wh_name)
            if wh_data:
                warhead_info = {
                    'type':             'blast_frag',
                    'explosiveMass_kg': wh_data.get('expl_mass'),
                    'caliber_mm':       wh_data.get('caliber'),
                    'piercingMass_kg':  wh_data.get('piercing_mass'),
                    'reference':        wh_ref,
                }
        if warhead_info is None:
            warhead_info = {
                'type':             'blast_frag',
                'explosiveMass_kg': None,
                'caliber_mm':       None,
                'piercingMass_kg':  None,
                'reference':        _extract_warhead_ref(text),
            }

    # ── Assemble output dict ───────────────────────────────────────────────────
    # ID: prefer DCS internal name field (the raw Lua key like "FIM_92C" or
    # "Igla_1E") which appears as the top-level 'name = "..."' field.
    # Note: _extract_flat_fields() may pick up a nested 'name' from inside
    # shape_table_data. We re-extract using the unique_resource_name which is
    # always top-level, or scan for the FIRST 'name = "..."' occurrence.
    if unique_rn:
        raw_name = unique_rn.split('.')[-1]
    else:
        # Find the first top-level name = "..." in the file
        # (before any nested table uses name)
        first_name_m = re.search(r'(?:^|\t)\s*name\s*=\s*"([^"]+)"', text, re.MULTILINE)
        raw_name = first_name_m.group(1) if first_name_m else (f.get('name') or '')

    if raw_name:
        missile_id = raw_name.lower().replace('_', '-')
        missile_id = re.sub(r'[^a-z0-9-]+', '-', missile_id).strip('-')
    else:
        missile_id = display_name.lower()
        missile_id = re.sub(r'[^a-z0-9]+', '-', missile_id).strip('-')
    # Collapse double hyphens
    while '--' in missile_id:
        missile_id = missile_id.replace('--', '-')

    return {
        # Identifiers
        'id':         missile_id,
        'name':       display_name,
        'dcsName':    dcs_name,
        'type':       sim_type,
        'seeker':     SEEKER_DISPLAY[sim_type],
        'dataSource': 'old_api_estimated',
        'sourceFile': source_file,
        'source':     'dcs-lua-datamine',

        # Physical
        'mass_kg':       mass_kg if mass_kg > 0 else None,
        'diameter_mm':   diam_mm if diam_mm > 0 else None,
        'reference_area_m2': round(ref_area, 6),

        # Seeker
        'seekerSpec': seeker_spec,

        # Propulsion (rich)
        'propulsion': {
            'phases':            phases,
            'totalBurnTime_s':   round(total_burn_s, 2) if total_burn_s > 0 else None,
            'totalFuelMass_kg':  round(total_fuel_kg, 2) if total_fuel_kg > 0 else None,
            'massAtBurnout_kg':  round(burnout_mass, 2),
        },

        # Aerodynamics (rich)
        'aerodynamics': {
            'Cx': {
                'k0': round(cx['k0'], 4),
                'k1': round(cx['k1'], 4),
                'k2': round(cx['k2'], 4),
                'k3': round(cx['k3'], 4),
                'k4': round(cx['k4'], 4),
            },
        },

        # Guidance (rich)
        'guidance': {
            'pn_schedule':  pn_schedule,
            'autopilot':    {'delay_s': control_delay, 'loft_active': False, 'loft_sin': None,
                             'loft_off_range_m': None, 'fins_limit': None,
                             'gload_limit': None, 'Knav': None}
                            if control_delay is not None else None,
            'controlDelay_s': control_delay,
        },

        # Loft (not in old API)
        'loft': {
            'triggerRange_m': None,
            'descentRange_m': None,
            'elevationSin':   None,
            'elevationDeg':   None,
        },

        # Fuze
        'fuze': {
            'proximityRadius_m':   kill_dist if kill_dist > 0 else 7.0,
            'armingAccel':         None,
            'selfDestructTimer_s': life_time if life_time < 1e8 else None,
        },

        # Warhead
        'warhead': warhead_info,

        # Performance
        'performance': {
            'maxSpeed_mach': mach_max,
            'maxRange_nm':   round(d_max_m * M_TO_NM, 2) if d_max_m > 0 else None,
            'gLimit':        nr_max,
            'maxAltitude_m': float(f.get('H_max') or 0) or None,
            'minAltitude_m': float(f.get('H_min') or 0) if float(f.get('H_min') or 0) > 0 else None,
        },

        # CCM
        'ccm_k0': ccm_k0,

        # ── Legacy flat fields (simulator-facing) ──────────────────────────────
        'motorBurnTime_s':            round(total_burn_s, 2) if total_burn_s > 0 else None,
        'thrust_N':                   round(thrust_n_flat, 1) if thrust_n_flat else None,
        'massBurnout_kg':             round(burnout_mass, 2),
        'dragCoefficient':            round(cx['k0'], 4),
        'referenceArea_m2':           round(ref_area, 6),
        'maxSpeed_mach':              mach_max,
        'maxRange_nm':                round(d_max_m * M_TO_NM, 2) if d_max_m > 0 else None,
        'gLimit':                     nr_max,
        'seekerAcquisitionRange_nm':  round(seeker_sens * M_TO_NM, 2),
        'loftAngle_deg':              None,
        'guidanceNav':                pn_schedule[0]['N'] if pn_schedule else 4.0,
    }


def parse_directory(
    rockets_dir: Path,
    warhead_lookup: dict[str, dict] | None = None,
) -> list[dict]:
    """
    Parse all old-API Lua files in a directory.
    Returns list of parsed missile dicts (A2A only).
    """
    results = []
    for lua_file in sorted(rockets_dir.glob('*.lua')):
        entry = parse_old_api_file(lua_file, warhead_lookup)
        if entry is not None:
            results.append(entry)
    return results


# ── CLI (for standalone testing) ───────────────────────────────────────────────

if __name__ == '__main__':
    import json

    if len(sys.argv) < 2:
        print('Usage: python old_api_parser.py <rockets_dir> [--json]')
        sys.exit(1)

    rockets_dir = Path(sys.argv[1])
    results = parse_directory(rockets_dir)

    if '--json' in sys.argv:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            phases = r.get('propulsion', {}).get('phases', [])
            phase_str = ', '.join(
                f"{p['name']}:{p['thrust_N']:.0f}N/{p['duration_s']}s"
                for p in phases
            )
            print(
                f"  {r['name']:40s}  T={r.get('thrust_N') or '?':>8}N  "
                f"Cd={r.get('dragCoefficient') or '?':>6}  "
                f"A={r.get('referenceArea_m2') or '?':>8.5f}m²  "
                f"phases=[{phase_str}]"
            )
