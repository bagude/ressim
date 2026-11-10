"""Level definitions, design validation and the FracWellSpec each design becomes.

Star thresholds (NPV, USD) come from calibrate.py runs and are stored in stars.json; until a level is
calibrated it uses the placeholder thresholds below.
"""
import json
from pathlib import Path

from economics import DEFAULT_COSTS, DEFAULT_PRICES

GAME = Path(__file__).resolve().parent

# Shared reservoir: the SPE1 benchmark live oil (illustrative), 100 ft thick, 5,000 psi, 9,000 ft deep.
BASE_SPEC = {
    "thickness_ft": 100.0, "porosity": 0.08, "pressure_psi": 5000.0, "fluid": "blackoil_spe1",
    "mesh": "coarse",
}

LEVELS = [
    {
        "id": "first-light", "title": "First Light",
        "brief": "A 1,500 ft lateral in 5 microdarcy rock. Choose how many stages and how long to make them.",
        "lesson": "More stages and longer fractures both add oil, but fracture cost climbs with the square of half-length.",
        "lateral_ft": 1500.0, "lease_width_ft": 1000.0, "perm_md": 0.005, "months": 24,
        "budget_usd": None, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 12], "half_length_ft": [100, 450], "conductivity_mdft": [50, 50], "bhp_psi": [1500, 1500], "per_stage": False},
    },
    {
        "id": "sand-and-pressure", "title": "Sand and Pressure",
        "brief": "Same rock, now you also buy proppant (conductivity) and choose the bottom-hole pressure.",
        "lesson": "Conductivity has diminishing returns; drawing pressure down needs artificial lift below 2,500 psi and brings gas out below the 4,015 psi bubble point.",
        "lateral_ft": 1500.0, "lease_width_ft": 1000.0, "perm_md": 0.005, "months": 24,
        "budget_usd": None, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 12], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": False},
    },
    {
        "id": "tight-rock", "title": "Tight Rock",
        "brief": "1 microdarcy shale, produced for ten years. Pressure barely moves between stages.",
        "lesson": "In very tight rock each fracture drains only its own neighbourhood, so close spacing pays.",
        "lateral_ft": 2000.0, "lease_width_ft": 1000.0, "perm_md": 0.001, "months": 120,
        "budget_usd": None, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 20], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": False},
    },
    {
        "id": "fast-rock", "title": "Fast Rock",
        "brief": "50 microdarcy: ten times more permeable than First Light. Stages start competing for the same oil.",
        "lesson": "When fractures interfere, extra stages buy little; spend less and let the rock do the work.",
        "lateral_ft": 1500.0, "lease_width_ft": 1000.0, "perm_md": 0.05, "months": 24,
        "budget_usd": None, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 15], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": False},
    },
    {
        "id": "narrow-lease", "title": "Narrow Lease",
        "brief": "Your lease is only 500 ft wide. Fractures stop at the lease line, but you still pay for every foot you pump.",
        "lesson": "Size fractures to the drainage you own: half-length beyond the lease boundary is wasted money.",
        "lateral_ft": 1500.0, "lease_width_ft": 500.0, "perm_md": 0.005, "months": 24,
        "budget_usd": None, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 15], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": False},
    },
    {
        "id": "facility-cap", "title": "Facility Cap",
        "brief": "The battery can handle only 400 stb/d of oil from this well (shared evenly between stages).",
        "lesson": "A rate limit flattens the early peak; past a point, a bigger completion only adds cost.",
        "lateral_ft": 1500.0, "lease_width_ft": 1000.0, "perm_md": 0.005, "months": 24,
        "budget_usd": None, "facility_cap_stb_d": 400.0,
        "controls": {"stages": [2, 12], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": False},
    },
    {
        "id": "engineers-sandbox", "title": "Engineer's Sandbox",
        "brief": "Full control: set half-length and conductivity stage by stage, with a $7.5 million budget.",
        "lesson": "Outer stages see rock beyond the lateral's end; inner stages share it. Tailor the design.",
        "lateral_ft": 1500.0, "lease_width_ft": 1000.0, "perm_md": 0.005, "months": 24,
        "budget_usd": 7_500_000.0, "facility_cap_stb_d": None,
        "controls": {"stages": [2, 12], "half_length_ft": [100, 450], "conductivity_mdft": [2, 200], "bhp_psi": [1000, 4000], "per_stage": True},
    },
]

PLACEHOLDER_STARS = [0.0, 2_000_000.0, 4_000_000.0]


def load_stars():
    p = GAME / "stars.json"
    return json.loads(p.read_text()) if p.exists() else {}


def public_levels():
    """Levels as served by GET /api/levels."""
    st = load_stars()
    out = []
    for lv in LEVELS:
        d = dict(lv)
        d["thickness_ft"] = BASE_SPEC["thickness_ft"]
        d["porosity"] = BASE_SPEC["porosity"]
        d["top_depth_ft"] = 9000.0             # FracWellSpec default top_ft; the well runs at mid-thickness
        d["initial_pressure_psi"] = BASE_SPEC["pressure_psi"]
        d["prices"] = DEFAULT_PRICES
        d["costs"] = DEFAULT_COSTS
        d["stars"] = st.get(lv["id"], PLACEHOLDER_STARS)
        out.append(d)
    return out


def get_level(level_id):
    for lv in LEVELS:
        if lv["id"] == level_id:
            return lv
    return None


def normalise(level, design):
    """Check a player's design against the level's controls. Returns (design, errors).

    design: {stages, half_length_ft: number|[...], conductivity_mdft: number|[...], bhp_psi}
    Out-of-range values are errors, not silently clamped. Fixed controls (min == max) are filled in.
    """
    c = level["controls"]
    errors = []
    if not isinstance(design, dict):
        return None, ["design must be an object"]
    try:
        n = int(design.get("stages"))
        if n != design.get("stages"):
            raise ValueError
    except (TypeError, ValueError):
        return None, ["stages must be a whole number"]
    if not c["stages"][0] <= n <= c["stages"][1]:
        errors.append(f"stages must be between {c['stages'][0]} and {c['stages'][1]}")

    def per_stage(key):
        lo, hi = c[key]
        v = design.get(key, lo if lo == hi else None)
        if isinstance(v, list):
            if not c["per_stage"]:
                errors.append(f"{key}: this level takes one value for all stages")
                return None
            if len(v) != n:
                errors.append(f"{key}: give one value per stage ({n})")
                return None
        else:
            v = [v] * n
        try:
            v = [float(x) for x in v]
        except (TypeError, ValueError):
            errors.append(f"{key} must be numbers")
            return None
        if any(not lo <= x <= hi for x in v):
            errors.append(f"{key} must be between {lo} and {hi}")
        return v

    hl = per_stage("half_length_ft")
    cd = per_stage("conductivity_mdft")
    lo, hi = c["bhp_psi"]
    try:
        bhp = float(design.get("bhp_psi", lo if lo == hi else None))
        if not lo <= bhp <= hi:
            errors.append(f"bhp_psi must be between {lo} and {hi}")
    except (TypeError, ValueError):
        errors.append("bhp_psi must be a number")
        bhp = None
    if errors:
        return None, errors
    return {"stages": n, "half_length_ft": hl, "conductivity_mdft": cd, "bhp_psi": bhp}, []


def to_spec(level, design, name="player"):
    """The FracWellSpec (as a TOML-ready dict) for a validated design: stages evenly spaced along the lateral."""
    n = design["stages"]
    spacing = level["lateral_ft"] / n
    return dict(BASE_SPEC, name=name, perm_md=level["perm_md"], width_ft=level["lease_width_ft"], months=level["months"],
                positions_ft=[spacing / 2 + i * spacing for i in range(n)], edge_ft=spacing / 2,
                half_length_ft=design["half_length_ft"], conductivity_mdft=design["conductivity_mdft"], bhp_psi=design["bhp_psi"],
                **({"dt_max_days": 30.0} if level["months"] > 36 else {}))   # monthly steps keep long runs to seconds


def per_stage_rate_target(level, design):
    cap = level["facility_cap_stb_d"]
    return None if cap is None else cap / design["stages"]
