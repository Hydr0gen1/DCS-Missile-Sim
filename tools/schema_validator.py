"""
Validates extracted missile entries against the DCS-fidelity schema.
Returns a list of validation warnings/errors for each missile.
"""
from __future__ import annotations

import math
from typing import Any


def validate(entry: dict[str, Any]) -> list[str]:
    """
    Validate a single missile entry.
    Returns a list of warning/error strings (empty = valid).
    """
    issues: list[str] = []
    name = entry.get("name", "?")

    # --- Required fields ---
    if not entry.get("mass_kg") or entry["mass_kg"] <= 0:
        issues.append(f"mass_kg missing or ≤0")

    ref_area = entry.get("reference_area_m2")
    if not ref_area or ref_area <= 0:
        issues.append("reference_area_m2 missing or ≤0")

    # --- Propulsion ---
    prop = entry.get("propulsion", {})
    phases = prop.get("phases", [])
    if not phases:
        issues.append("no propulsion phases found")
    else:
        for i, ph in enumerate(phases):
            thrust = ph.get("thrust_N")
            if thrust is None or thrust <= 0:
                issues.append(f"phase[{i}].thrust_N missing or ≤0")
            dur = ph.get("duration_s")
            if dur is None or dur <= 0:
                issues.append(f"phase[{i}].duration_s missing or ≤0")

    # --- Aerodynamics ---
    aero = entry.get("aerodynamics", {})
    cx = aero.get("Cx", {})
    cx_k0 = cx.get("k0")
    if cx_k0 is None:
        issues.append("aerodynamics.Cx.k0 missing")
    elif not (0.001 <= cx_k0 <= 2.0):
        issues.append(f"aerodynamics.Cx.k0={cx_k0} outside expected range [0.001, 2.0]")

    # --- G-limit ---
    glimit = entry.get("performance", {}).get("gLimit")
    if glimit is not None and not (1 <= glimit <= 100):
        issues.append(f"gLimit={glimit} outside plausible range [1, 100]")

    # --- No NaN/Inf ---
    def check_no_nan(obj: Any, path: str) -> None:
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            issues.append(f"{path} contains NaN or Inf")
        elif isinstance(obj, dict):
            for k, v in obj.items():
                check_no_nan(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                check_no_nan(v, f"{path}[{i}]")

    check_no_nan(entry, name)

    return issues


def print_report(entries: list[dict], field_count: int = 30) -> None:
    """Print a human-readable validation report for all entries."""
    print("\n" + "=" * 60)
    print("EXTRACTION VALIDATION REPORT")
    print("=" * 60)

    total_ok = 0
    total_warn = 0
    total_err = 0

    for entry in entries:
        name = entry.get("displayName") or entry.get("name", "?")
        issues = validate(entry)

        # Count populated fields
        populated = _count_populated(entry)

        if not issues:
            status = "✓"
            total_ok += 1
        elif any("missing" in i or "≤0" in i for i in issues):
            status = "✗"
            total_err += 1
        else:
            status = "⚠"
            total_warn += 1

        issue_str = f" — {', '.join(issues[:2])}" if issues else ""
        print(f"  {status} {name:<32} {populated:>3}/{field_count} fields{issue_str}")

    print(f"\n  Total: {total_ok} OK, {total_warn} warnings, {total_err} errors")
    print("=" * 60)


def _count_populated(obj: Any) -> int:
    """Count non-None leaf values in nested structure."""
    if obj is None:
        return 0
    if isinstance(obj, dict):
        return sum(_count_populated(v) for v in obj.values())
    if isinstance(obj, list):
        return sum(_count_populated(v) for v in obj)
    return 1
