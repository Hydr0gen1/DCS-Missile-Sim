"""
Lua table parser for the Quaggles DCS datamine.

The datamine files are serialized Lua table assignments:
    _G["table"]["key"]["subkey"] = { ... }

This module strips the assignment prefix and uses slpp to decode
the Lua table into a Python dict/list.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from slpp import slpp as lua

# Matches the LHS of the assignment: _G["a"]["b"]...  =
_ASSIGN_RE = re.compile(r'^_G(?:\[".+?"\])+\s*=\s*', re.DOTALL)

# Extracts the dotted key path from the assignment LHS, e.g. "rockets", "AIM_9"
_KEY_RE = re.compile(r'\["(.+?)"\]', re.DOTALL)


def _strip_lua_comments(text: str) -> str:
    """Remove Lua single-line comments (-- ...) from text."""
    # Remove full-line comments and inline comments
    # Keep strings safe by not stripping inside quoted strings (best-effort)
    result = []
    for line in text.splitlines():
        # Find -- outside of strings (simplified: just strip trailing --)
        in_string = False
        quote_char = None
        i = 0
        while i < len(line):
            ch = line[i]
            if not in_string and ch in ('"', "'"):
                in_string = True
                quote_char = ch
            elif in_string and ch == quote_char and (i == 0 or line[i-1] != '\\'):
                in_string = False
                quote_char = None
            elif not in_string and ch == '-' and i + 1 < len(line) and line[i+1] == '-':
                line = line[:i]
                break
            i += 1
        result.append(line)
    return '\n'.join(result)


def parse_file(path: str | Path) -> dict[str, Any]:
    """
    Parse a DCS datamine Lua file and return:
        {
            "key_path": ["rockets", "P_77"],   # Lua key path from _G[...][...]
            "data": { ... }                     # Parsed table contents
        }
    Raises ValueError on parse errors.
    """
    path = Path(path)
    text = path.read_text(encoding='utf-8', errors='replace')

    # Strip comments
    text = _strip_lua_comments(text)

    # Find the assignment
    m = _ASSIGN_RE.match(text.strip())
    if not m:
        raise ValueError(f"No _G assignment found in {path.name}")

    # Extract key path
    key_path = _KEY_RE.findall(m.group(0))

    # Extract the table body (everything after the = sign)
    table_text = text.strip()[m.end():].strip()

    # Remove trailing semicolon if present
    if table_text.endswith(';'):
        table_text = table_text[:-1].strip()

    # Parse with slpp
    try:
        data = lua.decode(table_text)
    except Exception as exc:
        raise ValueError(f"slpp failed on {path.name}: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"Expected table, got {type(data).__name__} in {path.name}")

    return {"key_path": key_path, "data": data}


def get_model_data(data: dict) -> list[float] | None:
    """
    Extract ModelData as a 1-indexed Python list (index 0 is unused/None).
    Handles both old API (flat) and new API (under 'client' key).
    """
    params = _get_client_params(data)
    raw = params.get("ModelData")
    if raw is None:
        return None

    # slpp returns dicts for mixed tables; pure arrays are returned as lists
    if isinstance(raw, dict):
        # Convert {1: v1, 2: v2, ...} to list
        max_idx = max(raw.keys()) if raw else 0
        arr = [None] + [raw.get(i) for i in range(1, max_idx + 1)]
        return arr
    elif isinstance(raw, list):
        # slpp returns 0-indexed list; prepend None for 1-indexing
        return [None] + list(raw)
    return None


def _get_client_params(data: dict) -> dict:
    """Return the missile parameter dict (new API: data['client'], old API: data)."""
    if "client" in data:
        return data["client"]
    return data


def get_scalar(data: dict, key: str, default=None):
    """Get a scalar value from either the client sub-table or top-level."""
    params = _get_client_params(data)
    return params.get(key, default)


def is_new_api(data: dict) -> bool:
    """True if this is the new weapons_table API (has a 'client' sub-table)."""
    return "client" in data


def get_warhead_name(data: dict) -> str | None:
    """
    Return the warhead file reference string, e.g. '_G/warheads/P_77.lua'.
    May be in top-level or client.
    """
    params = _get_client_params(data)
    wh = params.get("warhead") or data.get("warhead")
    if isinstance(wh, str):
        return wh
    return None


def get_pn_coeffs(data: dict) -> list[tuple[float, float]] | None:
    """
    Parse PN_coeffs into a list of (range_m, N_gain) pairs.
    Format: { count, r1, N1, r2, N2, ... }
    Returns None if not present.
    """
    params = _get_client_params(data)
    raw = params.get("PN_coeffs")
    if raw is None:
        return None

    if isinstance(raw, dict):
        vals = [raw[i] for i in sorted(raw.keys())]
    elif isinstance(raw, list):
        vals = list(raw)
    else:
        return None

    if len(vals) < 3:
        return None

    count = int(vals[0])
    pairs = []
    for i in range(count):
        r = vals[1 + i * 2]
        n = vals[2 + i * 2]
        pairs.append((float(r), float(n)))
    return pairs


def get_autopilot_new_api(data: dict) -> dict | None:
    """Extract autopilot block from new API client table."""
    params = _get_client_params(data)
    return params.get("autopilot")


def get_display_name(data: dict, key_path: list[str]) -> str:
    """Best-effort display name extraction."""
    params = _get_client_params(data)

    # New API: check display_name in client
    if dn := params.get("display_name"):
        return str(dn)
    # Old API top-level
    if dn := data.get("display_name"):
        return str(dn)
    # user_name
    if un := params.get("user_name") or data.get("user_name"):
        return str(un)
    # Fall back to key path last element
    if key_path:
        return key_path[-1].replace("_", " ").replace("-", "-")
    return "Unknown"


def get_name(data: dict, key_path: list[str]) -> str:
    """Internal DCS name."""
    params = _get_client_params(data)
    for key in ("name", "Name"):
        if n := params.get(key) or data.get(key):
            if isinstance(n, str) and n != "Redacted":
                return n
    # Fall back to unique_resource_name
    urn = params.get("_unique_resource_name") or data.get("_unique_resource_name")
    if urn:
        # weapons.missiles.AIM_120C → AIM_120C
        return urn.split(".")[-1]
    if key_path:
        return key_path[-1]
    return "Unknown"
