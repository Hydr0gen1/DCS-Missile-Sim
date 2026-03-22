#!/usr/bin/env python3
"""
Parse DCS warhead Lua files and build a lookup table.

Each warhead file has the form:
    _G["warheads"]["WarheadName"] = {
        caliber = 70,
        expl_mass = 1.02,
        mass = 3,
        piercing_mass = 0.6,
        ...
    }

Returns a dict: warhead_name → {expl_mass, caliber, piercing_mass}
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any


def _try_float(s: str) -> float | None:
    try:
        return float(s.strip())
    except ValueError:
        return None


def parse_warhead_file(lua_path: Path) -> tuple[str, dict] | None:
    """
    Parse a single warhead Lua file.
    Returns (warhead_name, data_dict) or None on failure.
    """
    try:
        text = lua_path.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return None

    # Extract warhead name from _G["warheads"]["NAME"] = { ... }
    name_match = re.search(r'_G\["warheads"\]\["([^"]+)"\]', text)
    if not name_match:
        # Some files may use a different pattern
        name_match = re.search(r'warheads\["([^"]+)"\]', text)
    if not name_match:
        # Fall back to filename stem
        wh_name = lua_path.stem
    else:
        wh_name = name_match.group(1)

    # Extract flat key=value fields
    data: dict[str, Any] = {}
    for m in re.finditer(
        r'\b([A-Za-z_]\w*)\s*=\s*(-?[0-9][0-9e.+\-]*)',
        text,
    ):
        val = _try_float(m.group(2))
        if val is not None:
            data[m.group(1)] = val

    if not data:
        return None

    return wh_name, {
        'expl_mass':     data.get('expl_mass') or data.get('mass'),
        'caliber':       data.get('caliber'),
        'piercing_mass': data.get('piercing_mass'),
    }


def build_warhead_lookup(warheads_dir: Path) -> dict[str, dict]:
    """
    Parse all .lua files in warheads_dir.
    Returns {warhead_name: {expl_mass, caliber, piercing_mass}}.
    """
    lookup: dict[str, dict] = {}
    for lua_file in sorted(warheads_dir.glob('*.lua')):
        result = parse_warhead_file(lua_file)
        if result:
            name, data = result
            lookup[name] = data
            # Also index by filename stem (for reference matching)
            if lua_file.stem not in lookup:
                lookup[lua_file.stem] = data
    return lookup


def fill_missing_warhead_data(
    missiles: list[dict],
    lookup: dict[str, dict],
) -> int:
    """
    For each missile with warhead.explosiveMass_kg == null,
    try to fill from the warhead lookup.

    Returns number of missiles updated.
    """
    updated = 0
    for m in missiles:
        wh = m.get('warhead')
        if not wh:
            continue
        if wh.get('explosiveMass_kg') is not None:
            continue  # already populated

        ref = wh.get('reference', '')
        if not ref:
            continue

        # Extract warhead name from path like '_G/warheads/FIM_92C.lua'
        wh_name = Path(ref).stem if ref else None
        if not wh_name:
            continue

        wh_data = lookup.get(wh_name)
        if wh_data and wh_data.get('expl_mass') is not None:
            wh['explosiveMass_kg'] = wh_data['expl_mass']
            if wh.get('caliber_mm') is None and wh_data.get('caliber') is not None:
                wh['caliber_mm'] = wh_data['caliber']
            updated += 1

    return updated


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import json

    if len(sys.argv) < 2:
        print('Usage: python warhead_parser.py <warheads_dir>')
        sys.exit(1)

    warheads_dir = Path(sys.argv[1])
    lookup = build_warhead_lookup(warheads_dir)
    print(json.dumps(lookup, indent=2))
