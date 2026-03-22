#!/usr/bin/env python3
"""
DCS Missile Data Extractor
Parses Quaggles/dcs-lua-datamine Lua files and generates missiles.json
for the DCS Missile Simulator.

Usage:
    python tools/dcs_data_extractor.py --datamine-path ./datamine --output ./src/data/missiles.json
    python tools/dcs_data_extractor.py --datamine-path ./datamine --missile AIM_120C
    python tools/dcs_data_extractor.py --datamine-path ./datamine --report
    python tools/dcs_data_extractor.py --datamine-path ./datamine --output ./src/data/missiles.json --update --diff
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure tools/ directory is on sys.path
sys.path.insert(0, str(Path(__file__).parent))

from lua_parser import (
    get_autopilot_new_api, get_display_name, get_model_data, get_name,
    get_pn_coeffs, get_scalar, get_warhead_name, is_new_api, parse_file,
)
from model_data_map import (
    A2A_SEEKER_TYPES, INF_VALUE, MODEL_DATA_MAP, SIM_TYPE_MAP,
)
from schema_validator import print_report, validate

# ── Constants ─────────────────────────────────────────────────────────────────

M_TO_NM = 1 / 1852


def _none_if_inf(v: float | None, threshold: float = 1e8) -> float | None:
    """Replace DCS 'disabled' sentinel values with None."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and (abs(v) >= threshold or math.isnan(v) or math.isinf(v)):
        return None
    return float(v)


def _safe(v: Any) -> float | None:
    """Safely convert to float, returning None on failure."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _m_to_nm(v: float | None) -> float | None:
    return round(v * M_TO_NM, 2) if v is not None else None


# ── Warhead cache ──────────────────────────────────────────────────────────────

_warhead_cache: dict[str, dict] = {}


def _load_warhead(datamine: Path, ref: str) -> dict | None:
    """
    Load a warhead file by its DCS reference string, e.g. '_G/warheads/P_77.lua'.
    Returns the parsed warhead table or None.
    """
    if ref in _warhead_cache:
        return _warhead_cache[ref]

    # Convert reference to filesystem path
    rel_path = ref.replace("_G/", "").strip("/")
    wh_path = datamine / "_G" / Path(rel_path)

    if not wh_path.exists():
        # Try just the base name in the warheads directory
        name = Path(rel_path).stem
        wh_path = datamine / "_G" / "warheads" / f"{name}.lua"

    if not wh_path.exists():
        _warhead_cache[ref] = None
        return None

    try:
        parsed = parse_file(wh_path)
        _warhead_cache[ref] = parsed["data"]
        return parsed["data"]
    except Exception:
        _warhead_cache[ref] = None
        return None


# ── Phase extraction ───────────────────────────────────────────────────────────

def _extract_phases(md: list) -> list[dict]:
    """
    Extract thrust phases from ModelData.
    Returns list of phase dicts: {name, duration_s, thrust_N, fuelFlow_kg_s}
    Only includes phases with positive duration AND positive thrust.
    """
    phase_names = ["start", "boost", "accel", "march", "inertial", "brake", "end"]
    phases = []

    for i, phase_name in enumerate(phase_names):
        t_idx = 14 + i       # phase_time_* indices 14–20
        ff_idx = 21 + i      # fuel_flow_* indices 21–27
        thrust_idx = 28 + i  # thrust_* indices 28–34

        if t_idx >= len(md) or thrust_idx >= len(md):
            break

        duration = _safe(md[t_idx])
        thrust = _safe(md[thrust_idx])
        fuel_flow = _safe(md[ff_idx]) if ff_idx < len(md) else 0.0

        # Skip disabled phases (duration ≤ 0 or thrust ≤ 0)
        if duration is None or duration <= 0:
            continue
        if thrust is None or thrust <= 0:
            continue

        phases.append({
            "name": phase_name,
            "duration_s": round(duration, 3),
            "thrust_N": round(thrust, 1),
            "fuelFlow_kg_s": round(fuel_flow or 0.0, 4),
        })

    return phases


# ── ID generation ──────────────────────────────────────────────────────────────

def _make_id(key_path: list[str], name: str) -> str:
    """Generate a stable, URL-safe ID from the missile name."""
    n = name.lower()
    n = n.replace(" ", "-").replace("_", "-")
    # Remove non-alphanumeric except hyphens
    n = "".join(c if c.isalnum() or c == "-" else "" for c in n)
    # Collapse multiple hyphens
    while "--" in n:
        n = n.replace("--", "-")
    return n.strip("-")


# ── Main extraction ────────────────────────────────────────────────────────────

def extract_missile(
    path: Path,
    datamine: Path,
    source_version: str = "unknown",
) -> dict | None:
    """
    Extract a single missile from a Lua datamine file.
    Returns the structured missile dict, or None if not an A2A missile.
    """
    try:
        parsed = parse_file(path)
    except Exception as e:
        print(f"  PARSE ERROR {path.name}: {e}", file=sys.stderr)
        return None

    data = parsed["data"]
    key_path = parsed["key_path"]

    # Get the parameter table (new API: under 'client', old API: top-level)
    params = data.get("client", data)

    # Check seeker type — only extract A2A missiles
    head_type = params.get("Head_Type")
    if head_type not in A2A_SEEKER_TYPES:
        return None  # Not an air-to-air guided missile

    # Basic identifiers
    raw_name = get_name(data, key_path)
    display_name = get_display_name(data, key_path)
    missile_id = _make_id(key_path, raw_name)

    # Determine type string for simulator
    sim_type = SIM_TYPE_MAP.get(head_type, "ARH")

    # ModelData (1-indexed list)
    md = get_model_data(data)
    if md is None:
        print(f"  WARN {path.name}: no ModelData found", file=sys.stderr)
        md = [None] * 60

    def md_val(idx: int) -> float | None:
        if idx < len(md):
            return _none_if_inf(_safe(md[idx]))
        return None

    # ── Physical parameters ───────────────────────────────────────────────────
    mass_kg = _safe(params.get("M"))
    diameter_mm = _safe(params.get("Diam"))
    ref_area = _none_if_inf(md_val(2))

    # ── Propulsion ────────────────────────────────────────────────────────────
    phases = _extract_phases(md)
    total_burn_s = sum(p["duration_s"] for p in phases)
    total_fuel_kg = sum(p["fuelFlow_kg_s"] * p["duration_s"] for p in phases)
    mass_burnout = (mass_kg - total_fuel_kg) if mass_kg and total_fuel_kg else None

    # If no phases found from ModelData, try old API top-level t_acc / t_marsh
    if not phases:
        t_acc = _safe(params.get("t_acc") or data.get("t_acc"))
        t_marsh = _safe(params.get("t_marsh") or data.get("t_marsh"))
        # These lack thrust data — estimate thrust from v_mid if available
        # This is a fallback; ModelData is preferred
        if t_acc and t_acc > 0:
            phases.append({
                "name": "accel",
                "duration_s": t_acc,
                "thrust_N": None,  # Unknown — needs calibration
                "fuelFlow_kg_s": None,
            })
        if t_marsh and t_marsh > 0:
            phases.append({
                "name": "march",
                "duration_s": t_marsh,
                "thrust_N": None,
                "fuelFlow_kg_s": None,
            })
        total_burn_s = sum(p["duration_s"] for p in phases if p["duration_s"])

    # ── Aerodynamics ─────────────────────────────────────────────────────────
    cx = {
        "k0": md_val(3),
        "k1": md_val(4),
        "k2": md_val(5),
        "k3": md_val(6),
        "k4": md_val(7),
    }
    cy = {
        "k0": md_val(9),
        "k1": md_val(10),
        "k2": md_val(11),
    }
    polar_damping = md_val(8)
    alfa_max_rad = md_val(12)

    # ── Seeker ────────────────────────────────────────────────────────────────
    seeker_acq_range_m = _none_if_inf(_safe(params.get("SeekerSensivityDistance"))) or \
                         _none_if_inf(_safe(params.get("D_max")))
    # triggers_control.default_sensor_tg_dist is in the new API's client table
    trig = params.get("triggers_control", {}) or {}
    triggers_seeker_m = _none_if_inf(_safe(trig.get("default_sensor_tg_dist")))

    seeker_type_str = SIM_TYPE_MAP.get(head_type, "ARH")
    # Display string for UI (legacy field 'seeker')
    seeker_display = {
        "ARH": "Active Radar (ARH)",
        "SARH": "Semi-Active Radar (SARH)",
        "IR": "Infrared (IR)",
    }.get(seeker_type_str, seeker_type_str)

    seeker_spec = {
        "type": seeker_type_str,
        "acquisitionRange_m": triggers_seeker_m or seeker_acq_range_m,
        "gimbalLimit_rad": _safe(params.get("Fi_excort")),
        "maxOffBoresight_rad": _safe(params.get("Fi_rak")),
        "searchLimit_rad": _safe(params.get("Fi_search")),
        "maxLOSRate_rad_s": _safe(params.get("OmViz_max")),
    }

    # ── Guidance — PN schedule ────────────────────────────────────────────────
    # PN_gain is the terminal (close-range) proportional navigation constant.
    # PN_coeffs provides a range-dependent schedule for mid-course guidance.
    # When both are present, prepend a terminal entry {range_m:0, N:pn_gain}
    # so the missile steers hard in the last few km regardless of the schedule.
    pn_gain = _safe(params.get("PN_gain"))
    pn_schedule = None
    pn_coeffs = get_pn_coeffs(data)
    if pn_coeffs:
        pn_schedule = [{"range_m": r, "N": n} for r, n in pn_coeffs]
        if pn_gain:
            # Prepend terminal entry if not already present (first entry has range_m=0)
            if pn_schedule[0]["range_m"] != 0:
                pn_schedule = [{"range_m": 0, "N": pn_gain}] + pn_schedule
    elif pn_gain:
        pn_schedule = [{"range_m": 0, "N": pn_gain}]

    # ── Guidance — Autopilot ─────────────────────────────────────────────────
    autopilot_raw = get_autopilot_new_api(data)
    autopilot_out = None
    if autopilot_raw:
        autopilot_out = {
            "delay_s": _safe(autopilot_raw.get("delay")),
            "loft_active": bool(autopilot_raw.get("loft_active", 0)),
            "loft_sin": _safe(autopilot_raw.get("loft_sin")),
            "loft_off_range_m": _none_if_inf(_safe(autopilot_raw.get("loft_off_range"))),
            "loft_min_range_m": _none_if_inf(_safe(autopilot_raw.get("loft_min_range"))),
            "fins_limit": _safe(autopilot_raw.get("fins_limit")),
            "gload_limit": _safe(autopilot_raw.get("gload_limit")),
            "Knav": _safe(autopilot_raw.get("Knav")),
        }

    # ── Loft from ModelData ───────────────────────────────────────────────────
    loft_trigger_m = md_val(39)  # 1e9 = disabled
    loft_descent_m = md_val(40)
    loft_sin = md_val(41)
    # Also check autopilot block for loft
    if autopilot_raw and not loft_sin:
        loft_sin = _safe(autopilot_raw.get("loft_sin"))

    loft = {
        "triggerRange_m": loft_trigger_m,
        "descentRange_m": loft_descent_m,
        "elevationSin": loft_sin,
        "elevationDeg": round(math.degrees(math.asin(min(1.0, max(-1.0, loft_sin)))), 1)
                        if loft_sin is not None else None,
    }

    # ── ACS filter ────────────────────────────────────────────────────────────
    acs = {
        "filter_K0": md_val(44),
        "filter_K1": md_val(45),
        "bandwidth": md_val(46),
    }

    # ── Triggers ─────────────────────────────────────────────────────────────
    triggers = {
        "seekerActivation_m": triggers_seeker_m or _none_if_inf(seeker_acq_range_m),
        "terminalManeuver_m": _none_if_inf(_safe(trig.get("default_final_maneuver_tg_dist"))),
        "straightNav_m":      _none_if_inf(_safe(trig.get("default_straight_nav_tg_dist"))),
        "selfDestruct_m":     _none_if_inf(_safe(trig.get("default_destruct_tg_dist"))),
    }

    # ── Fuze & warhead ────────────────────────────────────────────────────────
    kill_dist = _safe(params.get("KillDistance"))
    prox_fuze_md = md_val(37)
    prox_radius = kill_dist or prox_fuze_md  # KillDistance preferred

    warhead_ref = get_warhead_name(data)
    warhead_data = _load_warhead(datamine, warhead_ref) if warhead_ref else None
    expl_mass = None
    if warhead_data:
        expl_mass = _safe(warhead_data.get("expl_mass"))

    fuze = {
        "proximityRadius_m": prox_radius,
        "armingAccel": md_val(42),
        "selfDestructTimer_s": _none_if_inf(_safe(params.get("Life_Time"))),
    }

    warhead = {
        "type": "blast_frag",
        "explosiveMass_kg": expl_mass,
        "reference": warhead_ref,
    }

    # ── DLZ (Dynamic Launch Zone) ─────────────────────────────────────────────
    dlz = {
        "headOn_10km_m":     md_val(52),
        "tailChase_10km_m":  md_val(53),
        "headOn_1km_m":      md_val(54),
        "aspectCoeff":       md_val(55),
        "lowerHemiSlope":    md_val(56),
        "upperHemiSlope":    md_val(57),
        "hemiBendAngle":     md_val(58),
        "altSlopeModifier":  md_val(59),
    }

    # ── Performance summary ───────────────────────────────────────────────────
    max_range_m = _safe(params.get("Range_max"))
    performance = {
        "maxSpeed_mach": _safe(params.get("Mach_max")),
        "maxRange_nm": _m_to_nm(max_range_m),
        "maxRange_head_on_nm": _m_to_nm(md_val(52)),
        "maxRange_tail_nm": _m_to_nm(md_val(53)),
        "gLimit": _safe(params.get("Nr_max")),
        "maxAltitude_m": _none_if_inf(_safe(params.get("H_max"))),
        "minAltitude_m": _none_if_inf(_safe(params.get("H_min"))),
        "flightTime_s": _none_if_inf(md_val(51)),
    }

    # ── CCM resistance ────────────────────────────────────────────────────────
    ccm_k0 = _safe(params.get("ccm_k0") or data.get("ccm_k0"))

    # ── Assemble final entry ──────────────────────────────────────────────────
    entry = {
        "id": missile_id,
        "name": display_name,
        "dcsName": raw_name,
        "type": sim_type,
        "source": "dcs-lua-datamine",
        "sourceFile": str(path.relative_to(datamine)),
        "dcsVersion": source_version,
        "extractedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),

        # Physical
        "mass_kg": mass_kg,
        "diameter_mm": diameter_mm,
        "reference_area_m2": ref_area,

        # Seeker (legacy display string + rich spec)
        "seeker": seeker_display,   # display string used by UI components
        "seekerSpec": seeker_spec,  # rich DCS-fidelity data

        # Propulsion
        "propulsion": {
            "phases": phases,
            "totalBurnTime_s": round(total_burn_s, 2) if total_burn_s else None,
            "totalFuelMass_kg": round(total_fuel_kg, 2) if total_fuel_kg else None,
            "massAtBurnout_kg": round(mass_burnout, 2) if mass_burnout else None,
        },

        # Aerodynamics
        "aerodynamics": {
            "Cx": cx,
            "Cy": cy,
            "polar_damping": polar_damping,
            "alfa_max_rad": alfa_max_rad,
        },

        # Guidance
        "guidance": {
            "pn_schedule": pn_schedule,
            "autopilot": autopilot_out,
            "acs": acs,
            "controlDelay_s": md_val(38),
            "guidanceEfficiency": md_val(50),
        },

        # Loft
        "loft": loft,

        # Triggers
        "triggers": triggers,

        # Fuze & warhead
        "fuze": fuze,
        "warhead": warhead,

        # DLZ
        "dlz": dlz,

        # Performance
        "performance": performance,

        # CCM
        "ccm_k0": ccm_k0,

        # Legacy flat fields for simulator compatibility
        # These are the fields consumed by missile.ts / engagement.ts
        "motorBurnTime_s": round(total_burn_s, 2) if total_burn_s else None,
        "thrust_N": phases[0]["thrust_N"] if phases else None,
        "massBurnout_kg": round(mass_burnout, 2) if mass_burnout else None,
        "dragCoefficient": cx.get("k0"),  # subsonic Cx0 (used as Cd baseline in drag formula)
        "referenceArea_m2": ref_area,     # DCS reference area for drag formula (m²)
        "gLimit": _safe(params.get("Nr_max")),
        # guidanceNav = terminal PN gain (PN_gain when available, else first schedule entry)
        "guidanceNav": pn_gain or (pn_schedule[0]["N"] if pn_schedule else None) or 4.0,
        # Seeker activation range: prefer active_radar_lock_dist (pitbull trigger) over the
        # raw seeker detection capability (acquisitionRange_m), which is typically much larger.
        "seekerAcquisitionRange_nm": _m_to_nm(
            _none_if_inf(_safe(params.get("active_radar_lock_dist")))
            or triggers.get("seekerActivation_m")
            or seeker_spec.get("acquisitionRange_m")
        ),
        "loftAngle_deg": loft.get("elevationDeg"),
        "maxSpeed_mach": _safe(params.get("Mach_max")),
        "maxRange_nm": _m_to_nm(max_range_m),
        # DCS KillDistance: proximity fuze lethal radius (m)
        "killDistance_m": kill_dist if kill_dist else None,
    }

    return entry


# ── Batch extraction ───────────────────────────────────────────────────────────

def extract_all(
    datamine: Path,
    source_version: str = "unknown",
) -> list[dict]:
    """
    Extract all air-to-air missiles from both API directories.
    Returns sorted list of missile dicts.
    """
    missiles: dict[str, dict] = {}  # keyed by ID to deduplicate

    search_dirs = [
        datamine / "_G" / "weapons_table" / "weapons" / "missiles",
        datamine / "_G" / "rockets",
    ]

    for search_dir in search_dirs:
        if not search_dir.exists():
            print(f"  WARN: directory not found: {search_dir}", file=sys.stderr)
            continue

        for lua_file in sorted(search_dir.glob("*.lua")):
            entry = extract_missile(lua_file, datamine, source_version)
            if entry is None:
                continue

            mid = entry["id"]
            # Prefer new API (weapons_table) over old API (rockets) for duplicates
            if mid in missiles:
                existing_src = missiles[mid].get("sourceFile", "")
                new_src = entry.get("sourceFile", "")
                if "weapons_table" in new_src and "rockets" in existing_src:
                    missiles[mid] = entry  # Upgrade to new API
                # Otherwise keep existing
            else:
                missiles[mid] = entry

    # Sort by type (ARH, IR, SARH) then name
    sorted_missiles = sorted(
        missiles.values(),
        key=lambda m: (m.get("type", ""), m.get("name", "")),
    )
    return sorted_missiles


# ── Diff mode ─────────────────────────────────────────────────────────────────

def diff_against(existing_path: Path, new_entries: list[dict]) -> None:
    """Print a human-readable diff between new and existing missiles.json."""
    try:
        existing = {m["id"]: m for m in json.loads(existing_path.read_text())}
    except Exception:
        print("  (no existing missiles.json to diff against)")
        return

    new_map = {m["id"]: m for m in new_entries}

    print("\n" + "=" * 60)
    print("DIFF vs EXISTING missiles.json")
    print("=" * 60)

    DIFF_FIELDS = [
        "motorBurnTime_s", "thrust_N", "massBurnout_kg",
        "gLimit", "maxSpeed_mach", "maxRange_nm",
        "referenceArea_m2", "guidanceNav", "loftAngle_deg",
    ]

    for mid, new in sorted(new_map.items()):
        old = existing.get(mid)
        if not old:
            print(f"\nNEW: {new.get('name', mid)}")
            continue

        changes = []
        for field in DIFF_FIELDS:
            ov = old.get(field)
            nv = new.get(field)
            if ov != nv:
                changes.append(f"  {field}: {ov} → {nv}")

        name = new.get("name", mid)
        if changes:
            print(f"\n{name}:")
            print("\n".join(changes))
        else:
            print(f"  {name}: (no changes in key fields)")

    removed = set(existing) - set(new_map)
    for mid in removed:
        print(f"\nREMOVED: {existing[mid].get('name', mid)}")


# ── Git pull helper ────────────────────────────────────────────────────────────

def git_pull(path: Path) -> str:
    """Pull latest datamine. Returns version string from git log."""
    try:
        subprocess.run(["git", "pull"], cwd=path, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"  git pull failed: {e.stderr.decode()}", file=sys.stderr)

    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%H %ai"],
            cwd=path, capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="DCS Lua Datamine → missiles.json extractor")
    parser.add_argument("--datamine-path", required=True, type=Path,
                        help="Path to cloned Quaggles/dcs-lua-datamine repo")
    parser.add_argument("--output", type=Path,
                        help="Output path for missiles.json")
    parser.add_argument("--missile", type=str,
                        help="Extract a single missile by name (for debugging)")
    parser.add_argument("--report", action="store_true",
                        help="Print validation report only (no output file)")
    parser.add_argument("--update", action="store_true",
                        help="Git pull the datamine before extracting")
    parser.add_argument("--diff", action="store_true",
                        help="Diff new extraction against existing output file")
    args = parser.parse_args()

    datamine = args.datamine_path.resolve()
    if not datamine.exists():
        print(f"ERROR: datamine path not found: {datamine}", file=sys.stderr)
        sys.exit(1)

    source_version = "unknown"
    if args.update:
        print("Pulling latest datamine…")
        source_version = git_pull(datamine)
        print(f"  Datamine at: {source_version}")
    else:
        try:
            result = subprocess.run(
                ["git", "log", "-1", "--format=%h %ai"],
                cwd=datamine, capture_output=True, text=True, check=True,
            )
            source_version = result.stdout.strip()
        except Exception:
            pass

    # Single missile debug mode
    if args.missile:
        for search_dir in [
            datamine / "_G" / "weapons_table" / "weapons" / "missiles",
            datamine / "_G" / "rockets",
        ]:
            for lua_file in search_dir.glob("*.lua"):
                if args.missile.lower().replace("-", "_") in lua_file.stem.lower().replace("-", "_"):
                    print(f"\nParsing: {lua_file}")
                    entry = extract_missile(lua_file, datamine, source_version)
                    if entry:
                        print(json.dumps(entry, indent=2, default=str))
                        issues = validate(entry)
                        if issues:
                            print(f"\nValidation issues: {issues}")
                        else:
                            print("\nValidation: OK")
                    else:
                        print("Not an A2A missile or parse failed.")
                    return
        print(f"Missile '{args.missile}' not found in datamine.")
        return

    # Full extraction
    print(f"Extracting all A2A missiles from {datamine}…")
    missiles = extract_all(datamine, source_version)
    print(f"  Extracted {len(missiles)} missiles")

    # Validation report
    if args.report or True:  # Always show report
        print_report(missiles)

    # Diff
    if args.diff and args.output and args.output.exists():
        diff_against(args.output, missiles)

    # Write output
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(missiles, indent=2, default=str))
        print(f"\nWrote {len(missiles)} missiles to {args.output}")
    elif not args.report:
        # Print to stdout if no output file
        print(json.dumps(missiles, indent=2, default=str))


if __name__ == "__main__":
    main()
