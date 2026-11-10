"""Hidden truth for a career: the field's rock, the inherited producing wells (the analogs) and every well's
real production, from ressim runs. Nothing in here is sent to the browser except through career.py's views.

A well's production is one simulated repeating stage (width = stage spacing, no-flow at half the well spacing,
i.e. a row of identical wells produced together) scaled by the stage count, then given hidden well-to-well
variability and monthly noise. 20-year runs at monthly time steps.
"""
import hashlib
import json
import math
import random
from pathlib import Path

import economics
import sim

GAME = Path(__file__).resolve().parent
CACHE = GAME / "truthcache"
SECTION_FT = 5280.0
HORIZON = 240
COLS, ROWS = 6, 3


def rng_for(seed, *keys):
    return random.Random(f"{seed}|" + "|".join(str(k) for k in keys))


def make_rock(seed):
    """Smoothly varying hidden rock over a 6 x 3 block of sections. Initial pressure stays above the
    SPE1 oil's 4,014.7 psi bubble point (the deck requires it)."""
    r = rng_for(seed, "rock")
    gx, gy = r.uniform(-0.25, 0.25), r.uniform(-0.3, 0.3)
    base_k = math.exp(r.uniform(math.log(0.003), math.log(0.008)))
    out = []
    for j in range(ROWS):
        for i in range(COLS):
            n = rng_for(seed, "rock", i, j)
            out.append({
                "section": f"{chr(65 + j)}{i + 1}", "col": i, "row": j,
                "perm_md": round(base_k * math.exp(gx * (i - 2.5) + gy * (j - 1) + n.gauss(0, 0.2)), 6),
                "porosity": round(min(0.11, max(0.05, 0.08 + 0.006 * (i - 2.5) * (1 if gx > 0 else -1) + n.gauss(0, 0.006))), 4),
                "thickness_ft": round(min(150, max(60, 100 + 12 * (j - 1) + n.gauss(0, 10))), 1),
                "pressure_psi": round(min(5800, max(4300, 5000 + 110 * (i - 2.5) + n.gauss(0, 120))), 0),
            })
    return out


# ---- the field's hidden rock as grids (f7's synthetic_geology), for new careers ----------------------------------------
GEO = {"cell_ft": 440.0, "range_ft": 12000.0, "phi_mean": 0.08, "phi_sd": 0.012, "perm_median_md": 0.005, "perm_decades": 0.25,
       "gross_mean_ft": 100.0, "gross_sd_ft": 15.0, "ntg_mean": 0.82, "ntg_sd": 0.07, "sw_mean": 0.30, "sw_sd": 0.05}
GEO_PROPS = ("porosity", "perm_md", "net_ft", "sw", "gross_ft")


def make_grid(worker, seed, cols=COLS, rows=ROWS):
    """The career's hidden rock on a grid of nodes covering the field (plus one spare row for land won at auction)."""
    nx = int(cols * SECTION_FT / GEO["cell_ft"]) + 1
    ny = int((rows + 1) * SECTION_FT / GEO["cell_ft"]) + 1
    d = dict(GEO, nx=nx, ny=ny, seed=int(seed % 2_000_000_000))
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        return worker.call("geology", d, t)


STRUCT = {"top_ft": 9000.0, "dip_deg": 0.5, "residual_ft": 20.0, "residual_range_ft": 12000.0}


def structure_params(seed, grid):
    """What rebuilds the career's structure in the worker (same grid frame as the rock)."""
    r = rng_for(seed, "structure")
    return dict(STRUCT, nx=grid["nx"], ny=grid["ny"], cell_ft=grid["dx"], seed=int(seed % 2_000_000_000),
                dip_azimuth_deg=round(r.uniform(0, 360), 1), n_faults=r.randint(2, 5))


def structure_call(worker, params, **kw):
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        return worker.call("structure", dict(params, **kw), t)


def sample(grid, prop, x, y):
    """Bilinear lookup between the grid's nodes, clamped to the grid (as Ressim.sample)."""
    nx, ny = grid["nx"], grid["ny"]
    u = min(max((x - grid["x0"]) / grid["dx"], 0.0), nx - 1.0)
    v = min(max((y - grid["y0"]) / grid["dy"], 0.0), ny - 1.0)
    i, j = min(int(u), nx - 2), min(int(v), ny - 2)
    a, b = u - i, v - j
    z = grid[prop]
    return (1 - a) * (1 - b) * z[j][i] + a * (1 - b) * z[j][i + 1] + (1 - a) * b * z[j + 1][i] + a * b * z[j + 1][i + 1]


def section_rock(grid, col, row, n=8):
    """A section's simulated rock from the grid: net, gross, and the averages that govern flow (pore volume of oil
    phi*net*(1-Sw) and kh, both per foot of net)."""
    pts = [sample_all(grid, (col + (i + 0.5) / n) * SECTION_FT, (row + (j + 0.5) / n) * SECTION_FT) for i in range(n) for j in range(n)]
    net = sum(p["net_ft"] for p in pts) / len(pts)
    hcpv = sum(p["porosity"] * p["net_ft"] * (1 - p["sw"]) for p in pts) / len(pts)
    pv = sum(p["porosity"] * p["net_ft"] for p in pts) / len(pts)
    kh = sum(p["perm_md"] * p["net_ft"] for p in pts) / len(pts)
    return {"thickness_ft": round(sum(p["gross_ft"] for p in pts) / len(pts), 1), "net_ft": round(net, 2),
            "porosity": round(pv / net, 5), "sw": round(1 - hcpv / pv, 4), "perm_md": round(kh / net, 7)}


def sample_all(grid, x, y):
    return {p: sample(grid, p, x, y) for p in GEO_PROPS}


def bench(seed, gross_ft, net_ft):
    """The clean net bench the field's wells target: 35 % of net (20-40 ft), at a fixed stratigraphic position (a share
    of the gross below the top, the same across the field, from the seed). Returns (offset below top, thickness), ft."""
    t = min(40.0, max(20.0, 0.35 * net_ft))
    f = rng_for(seed, "bench").uniform(0.25, 0.55)
    return round(f * max(0.0, gross_ft - t), 2), round(t, 2)


def make_rock_from_grid(seed, grid):
    """make_rock's sections with their flow properties from the grid; pressure keeps its own per-section draw."""
    out = make_rock(seed)
    for r in out:
        r.update(section_rock(grid, r["col"], r["row"]))
    return out


MAP_NOISE = {"thickness": 0.08, "perm_log": 0.30, "porosity": 0.006}   # the geologist's map against the hidden rock


def geology_map(seed, rock):
    """The company's geology map: per-section estimates of thickness, porosity and permeability from logs, cores and
    seismic, with honest scatter around the hidden rock. Deterministic from the seed."""
    out = []
    for r in rock:
        n = rng_for(seed, "map", r["section"])
        h = r["thickness_ft"] * math.exp(n.gauss(0, MAP_NOISE["thickness"]))
        k = r["perm_md"] * math.exp(n.gauss(0, MAP_NOISE["perm_log"]))
        out.append({"section": r["section"], "thickness_est_ft": round(h, 0), "porosity_est": round(r["porosity"] + n.gauss(0, MAP_NOISE["porosity"]), 3),
                    "perm_est_md": round(k, 5), "kh_est_md_ft": round(k * h, 4)})
    return out


ANALOG_DESIGNS = [  # inherited completions: older, smaller jobs through to recent, bigger ones
    {"stage_spacing_ft": 300.0, "half_length_ft": 200.0, "conductivity_mdft": 20.0, "bhp_psi": 2000.0},
    {"stage_spacing_ft": 250.0, "half_length_ft": 250.0, "conductivity_mdft": 40.0, "bhp_psi": 1500.0},
    {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 60.0, "bhp_psi": 1500.0},
    {"stage_spacing_ft": 175.0, "half_length_ft": 350.0, "conductivity_mdft": 100.0, "bhp_psi": 1200.0},
]


def make_analogs(seed, rock):
    """Producing wells inherited with the asset: four developed sections, 3-5 wells each, online 4-48 months ago."""
    r = rng_for(seed, "analogs")
    developed = r.sample(range(len(rock)), 4)
    wells = []
    for s in developed:
        n = r.randint(3, 5)
        wps = r.choice([4, 5, 6])            # how densely the previous operator spaced them
        for k in range(n):
            d = dict(r.choice(ANALOG_DESIGNS))
            lateral = r.choice([4620.0, 4620.0, 7260.0, 9900.0])   # 1, 1.5 and 2 sections less setbacks
            wells.append({
                "id": f"{rock[s]['section']}-{k + 1:02d}", "section": rock[s]["section"], "lateral_ft": lateral,
                "wells_per_section": wps, "design": d, "online_month": -r.randint(4, 48),
                "well_factor": math.exp(r.gauss(0, 0.12)),        # hidden geologic and execution variability
                "noise_seed": r.randint(0, 10 ** 9),
            })
    return [rock[s]["section"] for s in developed], wells


def spec_for(rock_s, design, wells_per_section):
    return {
        "name": "truth", "thickness_ft": rock_s["thickness_ft"], "perm_md": rock_s["perm_md"], "porosity": rock_s["porosity"],
        "pressure_psi": rock_s["pressure_psi"], "fluid": "blackoil_spe1", "mesh": "coarse", "months": HORIZON, "dt_max_days": 30.0,
        "stages": 1, "spacing_ft": design["stage_spacing_ft"], "width_ft": SECTION_FT / wells_per_section,
        "half_length_ft": design["half_length_ft"], "conductivity_mdft": design["conductivity_mdft"], "bhp_psi": design["bhp_psi"],
        **({"net_ft": rock_s["net_ft"], "sw": rock_s["sw"]} if "net_ft" in rock_s else {}),   # grid careers: the map path, exact
    }


class TruthSim:
    """Per-stage monthly volumes for a (rock, design, spacing), simulated once and cached on disk."""

    def __init__(self, worker):
        self.worker = worker

    @staticmethod
    def key(spec):
        return hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]

    def stage_curve(self, spec):
        key = self.key(spec)
        f = CACHE / f"{key}.json"
        if f.exists():
            return json.loads(f.read_text())
        out = CACHE / key
        out.mkdir(parents=True, exist_ok=True)
        maps = {k: spec[k] for k in ("net_ft", "sw") if k in spec}      # constant maps: the worker builds them (maps.txt)
        sim.write_spec(out / "spec.toml", {k: v for k, v in spec.items() if k not in maps})
        if maps:
            (out / "maps.txt").write_text(f"{maps['net_ft']} {maps['sw']}")
        self.worker.run(str(out / "spec.toml"), str(out))
        t, o, g, w = sim.read_summary(str(out))
        vol = economics.monthly_volumes(t, o, g, w, HORIZON)
        res = {"oil": vol["oil_stb"], "gas": vol["gas_mscf"], "water": vol["water_stb"]}
        f.write_text(json.dumps(res))
        return res


def stage_curve_schedule(worker, spec, monthly_bhp):
    """Per-stage monthly volumes with a month-by-month bottom-hole pressure (flowback plans), cached on disk."""
    key = TruthSim.key({"spec": spec, "bhp": [round(x, 1) for x in monthly_bhp]})
    f = CACHE / f"s{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    sched = list(monthly_bhp) + [monthly_bhp[-1]] * (spec["months"] - len(monthly_bhp))
    m = worker.call("bhpsched", {"spec": spec_with_positions(spec),
                                 "monthly_bhp_psi": sched[:spec["months"]]}, CACHE / f"s{key}")["monthly"]
    res = {"oil": m["oil"], "gas": m["gas"], "water": m["water"]}
    f.write_text(json.dumps(res))
    return res


def spec_with_positions(spec):
    """spec_for uses stages/spacing_ft (load_fracwell's shorthand); the CALL path needs explicit positions."""
    s = {k: v for k, v in spec.items() if k not in ("stages", "spacing_ft")}
    sp = spec["spacing_ft"]
    s.update(positions_ft=[sp / 2], edge_ft=sp / 2, half_length_ft=[spec["half_length_ft"]], conductivity_mdft=[spec["conductivity_mdft"]])
    return s


def well_curve(stage, stages, well_factor, noise_seed, months=HORIZON, downtime=True):
    """A well's monthly truth volumes: stage curve x stages x hidden factor, with monthly noise and downtime."""
    r = random.Random(noise_seed)
    out = {"oil": [], "gas": [], "water": []}
    for k in range(months):
        f = well_factor * math.exp(r.gauss(0, 0.06))
        if downtime and k > 0 and r.random() < 0.08:
            f *= r.uniform(0.3, 0.9)
        for ph in out:
            out[ph].append(stage[ph][k] * stages * f)
    return out
