#!/usr/bin/env python3
"""
Full DCS data pipeline — processes all data from the datamine and updates:
  1. src/data/missiles.json    — fills null physics fields for old-API missiles
  2. src/data/aircraft.json   — updates radar ranges from DCS sensor files
  3. src/data/dcsConstants.ts — updates CM coefficients from prbCoeff.lua

Usage:
    python tools/process_dcs_dump.py \\
        --datamine ./datamine \\
        --missiles ./src/data/missiles.json \\
        --aircraft ./src/data/aircraft.json \\
        --constants ./src/data/dcsConstants.ts
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from old_api_parser import parse_old_api_file
from warhead_parser import build_warhead_lookup, fill_missing_warhead_data


M_TO_NM = 1 / 1852


# ── Helpers ────────────────────────────────────────────────────────────────────

def _try_float(s: str) -> float | None:
    try:
        return float(s.strip())
    except (ValueError, AttributeError):
        return None


def _extract_flat_fields(text: str) -> dict:
    """Extract key=numeric_value pairs from Lua text."""
    fields = {}
    text = re.sub(r'--[^\n]*', '', text)
    for m in re.finditer(
        r'\b([A-Za-z_]\w*)\s*=\s*(-?[0-9][0-9e.+\-]*)',
        text,
    ):
        v = _try_float(m.group(2))
        if v is not None:
            fields[m.group(1)] = v
    return fields


# ── Part 1: Update missiles.json with old-API data ────────────────────────────

def _merge_old_api_into_missile(existing: dict, derived: dict) -> bool:
    """
    Merge derived old-API data into an existing missile record.
    Only fills null/missing fields — never overwrites non-null values.
    Returns True if any field was updated.
    """
    changed = False

    # Flat physics fields to fill if null
    FLAT_FILL = [
        'thrust_N', 'massBurnout_kg', 'dragCoefficient', 'referenceArea_m2',
        'motorBurnTime_s',
    ]
    for field in FLAT_FILL:
        if existing.get(field) is None and derived.get(field) is not None:
            existing[field] = derived[field]
            changed = True

    # Propulsion phases: fill if all phase thrust_N are null
    existing_phases = (existing.get('propulsion') or {}).get('phases') or []
    derived_phases  = (derived.get('propulsion') or {}).get('phases') or []

    if derived_phases:
        all_null = all(p.get('thrust_N') is None for p in existing_phases)
        if all_null and derived_phases:
            if 'propulsion' not in existing or not existing['propulsion']:
                existing['propulsion'] = {}
            existing['propulsion']['phases'] = derived_phases
            existing['propulsion']['totalBurnTime_s'] = derived['propulsion'].get('totalBurnTime_s')
            existing['propulsion']['totalFuelMass_kg'] = derived['propulsion'].get('totalFuelMass_kg')
            existing['propulsion']['massAtBurnout_kg'] = derived['propulsion'].get('massAtBurnout_kg')
            changed = True

    # Aerodynamics Cx (5-coeff): fill if missing
    existing_cx = (existing.get('aerodynamics') or {}).get('Cx') or {}
    derived_cx  = (derived.get('aerodynamics') or {}).get('Cx') or {}
    if derived_cx and existing_cx.get('k0') is None:
        if 'aerodynamics' not in existing or not existing['aerodynamics']:
            existing['aerodynamics'] = {}
        existing['aerodynamics']['Cx'] = derived_cx
        changed = True

    # reference_area_m2 in root (used by extractor for aerodynamics context)
    if existing.get('reference_area_m2') is None and derived.get('reference_area_m2') is not None:
        existing['reference_area_m2'] = derived['reference_area_m2']
        changed = True

    # seekerSpec: fill gimbalLimit_rad if missing
    existing_spec = existing.get('seekerSpec') or {}
    derived_spec  = derived.get('seekerSpec') or {}
    if (existing_spec.get('gimbalLimit_rad') is None
            and derived_spec.get('gimbalLimit_rad') is not None):
        if not existing.get('seekerSpec'):
            existing['seekerSpec'] = {}
        existing['seekerSpec']['gimbalLimit_rad'] = derived_spec['gimbalLimit_rad']
        changed = True

    # warhead explosiveMass_kg
    existing_wh = existing.get('warhead') or {}
    derived_wh  = derived.get('warhead') or {}
    if (existing_wh.get('explosiveMass_kg') is None
            and derived_wh.get('explosiveMass_kg') is not None):
        if not existing.get('warhead'):
            existing['warhead'] = {}
        existing['warhead']['explosiveMass_kg'] = derived_wh['explosiveMass_kg']
        changed = True

    # dataSource field
    if existing.get('dataSource') is None:
        existing['dataSource'] = derived.get('dataSource', 'old_api_estimated')
        changed = True

    return changed


def update_missiles(
    missiles_path: Path,
    datamine: Path,
) -> None:
    """
    1. Build warhead lookup from datamine warheads directory.
    2. Parse all old-API A2A missiles from datamine rockets directory.
    3. Merge into existing missiles.json, filling null physics fields.
    4. Fill missing warhead explosive mass from lookup.
    """
    print('\n── Updating missiles.json ──────────────────────────────────────')

    # Load existing missiles.json
    missiles: list[dict] = json.loads(missiles_path.read_text())
    missiles_by_id = {m['id']: m for m in missiles}

    # Build warhead lookup
    warheads_dir = datamine / '_G' / 'warheads'
    warhead_lookup = {}
    if warheads_dir.exists():
        warhead_lookup = build_warhead_lookup(warheads_dir)
        print(f'  Loaded {len(warhead_lookup)} warhead entries')

    # Parse old-API rockets
    rockets_dir = datamine / '_G' / 'rockets'
    filled_count = 0
    skipped_count = 0

    for lua_file in sorted(rockets_dir.glob('*.lua')):
        derived = parse_old_api_file(lua_file, warhead_lookup)
        if derived is None:
            continue

        # Match against existing missiles by id
        mid = derived['id']
        existing = missiles_by_id.get(mid)

        if existing is None:
            # Try to find by dcsName or name
            for m in missiles:
                dcs_name = m.get('dcsName', '').lower().replace('_', '-').replace(' ', '-')
                derived_name = derived.get('dcsName', '').lower().replace('_', '-').replace(' ', '-')
                if dcs_name and derived_name and dcs_name == derived_name:
                    existing = m
                    break

        if existing is None:
            print(f'  NOT IN DB: {derived["name"]} (id={mid}) — skipping')
            skipped_count += 1
            continue

        changed = _merge_old_api_into_missile(existing, derived)
        if changed:
            filled_count += 1
            print(f'  UPDATED: {existing["name"]}')
        else:
            print(f'  OK (no changes): {existing["name"]}')

    # Fill missing warhead data for ALL missiles in json
    wh_filled = fill_missing_warhead_data(missiles, warhead_lookup)
    print(f'  Warhead explosive mass filled for {wh_filled} missiles')

    print(f'\n  Filled physics for {filled_count} missiles')
    print(f'  Skipped {skipped_count} missiles (not in database)')

    # Write back
    missiles_path.write_text(json.dumps(missiles, indent=2))
    print(f'  Wrote {len(missiles)} missiles to {missiles_path}')


# ── Part 2: Parse Lua sensor file (DCS radar) ─────────────────────────────────

def _parse_sensor_file(sensor_path: Path) -> dict | None:
    """
    Parse a DCS radar sensor Lua file and extract key parameters.
    Returns dict with radar metrics or None on parse failure.
    """
    try:
        text = sensor_path.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return None

    # Remove comments
    text = re.sub(r'--[^\n]*', '', text)

    result = {}

    # Detection distance: find the maximum numeric value in detection_distance block
    det_match = re.search(
        r'detection_distance\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}',
        text, re.DOTALL,
    )
    if det_match:
        block_text = det_match.group(1)
        nums = [float(n) for n in re.findall(r'\b(\d{4,7})\b', block_text)]
        if nums:
            result['detection_distance_m'] = max(nums)

    # Lock-on coefficient
    lock_m = re.search(r'lock_on_distance_coeff\s*=\s*([0-9.]+)', text)
    if lock_m:
        result['lock_on_distance_coeff'] = float(lock_m.group(1))

    # Scan period
    scan_m = re.search(r'scan_period\s*=\s*([0-9.]+)', text)
    if scan_m:
        result['scan_period_s'] = float(scan_m.group(1))

    # TWS max targets
    tws_m = re.search(r'TWS_max_targets\s*=\s*([0-9]+)', text)
    if tws_m:
        result['tws_max_targets'] = int(tws_m.group(1))

    # Azimuth scan volume
    az_m = re.search(r'azimuth\s*=\s*\{[^}]*(-?\d+)[^}]*,\s*(\d+)', text)
    if az_m:
        result['gimbal_limit_deg'] = abs(float(az_m.group(1)))

    # Velocity gate (notch speed)
    vel_m = re.search(r'radial_velocity_min\s*=\s*([0-9.]+)', text)
    if vel_m:
        result['velocity_gate_mps'] = float(vel_m.group(1))

    # Max measuring distance
    mmd_m = re.search(r'max_measuring_distance\s*=\s*([0-9]+)', text)
    if mmd_m:
        result['max_measuring_distance_m'] = float(mmd_m.group(1))

    return result if result else None


# ── Part 3: Update aircraft.json radar data ───────────────────────────────────

# Mapping: aircraft id → sensor filename (without path)
AIRCRAFT_SENSOR_MAP = {
    'f-16':   'ANAPG-68.lua',
    'f-14':   'ANAPG-71.lua',
    'fa-18':  'ANAPG-73.lua',
    'f-15':   'ANAPG-63.lua',
    'mirage': 'RDY.lua',
}


def update_aircraft(
    aircraft_path: Path,
    datamine: Path,
) -> None:
    """Update aircraft.json radar fields from DCS sensor files."""
    print('\n── Updating aircraft.json ──────────────────────────────────────')

    sensors_dir = datamine / '_G' / 'db' / 'Sensors' / 'Sensor'
    aircraft_list: list[dict] = json.loads(aircraft_path.read_text())
    aircraft_by_id = {a['id']: a for a in aircraft_list}

    updated = 0
    for ac_id, sensor_file in AIRCRAFT_SENSOR_MAP.items():
        sensor_path = sensors_dir / sensor_file
        if not sensor_path.exists():
            print(f'  WARN: sensor not found: {sensor_path}')
            continue

        ac = aircraft_by_id.get(ac_id)
        if not ac:
            print(f'  WARN: aircraft not found in json: {ac_id}')
            continue

        sensor_data = _parse_sensor_file(sensor_path)
        if not sensor_data:
            print(f'  WARN: failed to parse {sensor_file}')
            continue

        det_m = sensor_data.get('detection_distance_m')
        if det_m is None:
            print(f'  WARN: no detection_distance in {sensor_file}')
            continue

        det_nm = round(det_m * M_TO_NM, 1)
        lock_coeff = sensor_data.get('lock_on_distance_coeff', 0.85)
        scan_s = sensor_data.get('scan_period_s', 5.0)
        tws = sensor_data.get('tws_max_targets')
        gimbal = sensor_data.get('gimbal_limit_deg', 60.0)
        vel_gate = sensor_data.get('velocity_gate_mps', 27.78)

        # Build updated radar block
        old_radar = ac.get('radar') or {}
        new_radar = {
            'maxRange_nm':           det_nm,
            'referenceRCS_m2':       old_radar.get('referenceRCS_m2', 5.0),
            'gimbalLimit_deg':       gimbal,
            'scanTime_s':            scan_s,
            'twsAccuracy_m':         old_radar.get('twsAccuracy_m', 150),
            'sttAccuracy_m':         old_radar.get('sttAccuracy_m', 15),
            'lookdownSpeedGate_mps': round(vel_gate, 2),
        }
        if tws is not None:
            new_radar['twsMaxTargets'] = tws
        new_radar['lockOnCoeff'] = lock_coeff

        old_nm = old_radar.get('maxRange_nm', '?')
        print(f'  {ac["name"]:15s}  radar {old_nm}nm → {det_nm}nm'
              f'  (lock={lock_coeff}, scan={scan_s}s, TWS={tws})')
        ac['radar'] = new_radar
        updated += 1

    aircraft_path.write_text(json.dumps(aircraft_list, indent=2))
    print(f'  Updated {updated} aircraft radar configs → {aircraft_path}')


# ── Part 4: Update dcsConstants.ts ────────────────────────────────────────────

def update_dcs_constants(
    constants_path: Path,
    datamine: Path,
) -> None:
    """
    Parse prbCoeff.lua and update CM coefficients in dcsConstants.ts.
    """
    print('\n── Updating dcsConstants.ts ────────────────────────────────────')

    prb_path = datamine / '_G' / 'prbCoeff.lua'
    if not prb_path.exists():
        print(f'  WARN: prbCoeff.lua not found at {prb_path}')
        return

    prb_text = prb_path.read_text(encoding='utf-8', errors='replace')
    prb_fields = {}
    for m in re.finditer(r'\b(k\d+)\s*=\s*([0-9e.+\-]+)', prb_text):
        v = _try_float(m.group(2))
        if v is not None:
            prb_fields[m.group(1)] = v

    if not prb_fields:
        print('  WARN: could not parse prbCoeff.lua')
        return

    print(f'  Parsed {len(prb_fields)} coefficients from prbCoeff.lua')

    # Build the new dcsConstants.ts content
    # We keep the existing comments but update numeric values
    ts_text = constants_path.read_text()

    def replace_k(match: re.Match) -> str:
        k_name = match.group(1)
        new_val = prb_fields.get(k_name)
        if new_val is None:
            return match.group(0)
        # Format: preserve small numbers as-is, use scientific for tiny values
        if abs(new_val) > 0 and abs(new_val) < 0.001:
            val_str = f'{new_val:.2e}'
        elif new_val == int(new_val):
            val_str = str(int(new_val))
        else:
            val_str = str(new_val)
        original = match.group(0)
        # Replace just the numeric value
        return re.sub(
            r':\s*[0-9e.+\-]+',
            f': {val_str}',
            original,
            count=1,
        )

    new_ts_text = re.sub(
        r'\b(k\d+)\s*:\s*[0-9e.+\-]+',
        replace_k,
        ts_text,
    )

    # Also add k12-k19 if not present
    needs_k12 = 'k12' not in ts_text
    if needs_k12 and any(f'k{i}' in prb_fields for i in range(12, 20)):
        extra_coeffs = []
        for i in range(12, 20):
            ki = f'k{i}'
            if ki in prb_fields:
                v = prb_fields[ki]
                if v == 0:
                    val_str = '0'
                elif v == int(v):
                    val_str = str(int(v))
                else:
                    val_str = str(v)
                extra_coeffs.append(f'  {ki}: {val_str},')

        if extra_coeffs:
            # Insert before the closing `} as const`
            insertion = '\n  // Timing/geometry coefficients\n' + '\n'.join(extra_coeffs) + '\n'
            new_ts_text = re.sub(
                r'(\} as const;)',
                insertion + r'\1',
                new_ts_text,
            )

    if new_ts_text != ts_text:
        constants_path.write_text(new_ts_text)
        print(f'  Updated {constants_path}')
    else:
        print('  No changes needed in dcsConstants.ts')


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Process DCS datamine: update missiles.json, aircraft.json, dcsConstants.ts',
    )
    parser.add_argument('--datamine', required=True, type=Path,
                        help='Path to Quaggles/dcs-lua-datamine clone')
    parser.add_argument('--missiles', required=True, type=Path,
                        help='Path to src/data/missiles.json')
    parser.add_argument('--aircraft', required=True, type=Path,
                        help='Path to src/data/aircraft.json')
    parser.add_argument('--constants', default=None, type=Path,
                        help='Path to src/data/dcsConstants.ts')
    args = parser.parse_args()

    datamine = args.datamine.resolve()
    if not datamine.exists():
        print(f'ERROR: datamine not found: {datamine}', file=sys.stderr)
        sys.exit(1)

    # 1. Missiles
    update_missiles(args.missiles, datamine)

    # 2. Aircraft
    update_aircraft(args.aircraft, datamine)

    # 3. Constants
    if args.constants and args.constants.exists():
        update_dcs_constants(args.constants, datamine)
    else:
        print('\n── Skipping dcsConstants.ts (not provided or not found) ────')

    print('\n✓ Pipeline complete')


if __name__ == '__main__':
    main()
