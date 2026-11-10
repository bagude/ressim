"""Geosteering as a level and as part of career mode: production of a steered well from ressim, economics, stars."""
import copy

import field
import opecon
import steer

LEVEL_ROCK = {"perm_md": 0.02, "porosity": 0.08, "pressure_psi": 5000.0}
LEVEL_DESIGN = {"stage_spacing_ft": 250.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
LEVEL_WELLS_PER_SECTION = 3
STAFF_RATING = 0.6           # career geosteerer until the staff system exists
LEVEL_MONTHS = 240


def bucket_spec(rock, design, wells_per_section, bucket_ft):
    spec = field.spec_for(rock, design, wells_per_section)
    if float(bucket_ft) > 0:
        spec["connection_multiple"] = steer.connection_multiple(float(bucket_ft))
    return spec


def well_volumes(truth_sim, rock, design, wells_per_section, counts, months=field.HORIZON, bhp_schedule=None):
    """Monthly oil, gas, water of a steered well: each landing bucket is one simulated repeating stage
    (with the well's month-by-month bottom-hole pressure when a flowback plan set one)."""
    out = {"oil": [0.0] * months, "gas": [0.0] * months, "water": [0.0] * months}
    for b, n in counts.items():
        spec = bucket_spec(rock, design, wells_per_section, b)
        c = (field.stage_curve_schedule(truth_sim.worker, spec, bhp_schedule) if bhp_schedule
             else truth_sim.stage_curve(spec))
        for ph in out:
            for k in range(months):
                out[ph][k] += c[ph][k] * n
    return out


def economics(vol, design, extra_days, months=LEVEL_MONTHS):
    est = opecon.well_estimate(design)
    capex = est["total_usd"] + max(0.0, extra_days) * opecon.COSTS["rig_spread_usd_day"]
    op = [opecon.net_cash(vol["oil"][k], vol["gas"][k], vol["water"][k], 1)["net_usd"] for k in range(months)]
    cap = [capex] + [0.0] * (months - 1)
    m = opecon.measures(op, cap, eur_boe=sum(vol["oil"][:months]) + sum(vol["gas"][:months]) / 6.0)
    m.pop("cum_cash_usd")
    return m, capex


def finish_level(s, truth_sim):
    """Score a standalone well against perfect steering of the same structure."""
    st = s["truth"]
    rock = dict(LEVEL_ROCK, section="L", thickness_ft=st["pay_ft"])
    stages = steer.landing(s, LEVEL_DESIGN["stage_spacing_ft"])
    counts = steer.bucket_counts(stages)
    vol = well_volumes(truth_sim, rock, LEVEL_DESIGN, LEVEL_WELLS_PER_SECTION, counts)
    extra = s["days"] - st["lateral_ft"] / steer.FT_PER_DAY
    meas, capex = economics(vol, LEVEL_DESIGN, extra)
    # reference: an expert geosteerer (rating 1.0) drilling the same structure, extra rig days included
    ref = copy.deepcopy(s)
    ref["path"], ref["gamma"], ref["days"], ref["decisions"], ref["slide_deg"] = ref["path"][:1], [], 0.0, 0, 0.0
    steer.auto_steer(ref, 1.0)
    ref_counts = steer.bucket_counts(steer.landing(ref, LEVEL_DESIGN["stage_spacing_ft"]))
    best_vol = well_volumes(truth_sim, rock, LEVEL_DESIGN, LEVEL_WELLS_PER_SECTION, ref_counts)
    best, _ = economics(best_vol, LEVEL_DESIGN, ref["days"] - st["lateral_ft"] / steer.FT_PER_DAY)
    ratio = meas["npv10_usd"] / best["npv10_usd"] if best["npv10_usd"] > 0 else 0.0
    stars = sum(1 for t in (0.80, 0.90, 0.97) if ratio >= t)
    s["finished"] = True
    s["result"] = {"in_zone_pct": round(steer.in_zone_pct(s), 1), "stages": stages, "bucket_counts": counts,
                   "extra_rig_days": round(extra, 2), "capex_usd": capex, "measures": meas,
                   "oil_bbl_20yr": sum(vol["oil"][:LEVEL_MONTHS]), "expert_oil_bbl_20yr": sum(best_vol["oil"][:LEVEL_MONTHS]),
                   "expert_npv10_usd": best["npv10_usd"], "expert_in_zone_pct": round(steer.in_zone_pct(ref), 1), "value_ratio": ratio, "stars": stars,
                   "stars_rule": "80 / 90 / 97 % of the NPV10 an expert geosteerer gets on the same structure",
                   "design": LEVEL_DESIGN, "note": steer.NOTE}
    return s["result"]


def finish_career_well(s):
    """Landing result for a career well (production is computed by career.py from the bucket counts)."""
    design = s["design"]
    stages = steer.landing(s, design["stage_spacing_ft"])
    s["finished"] = True
    s["result"] = {"in_zone_pct": round(steer.in_zone_pct(s), 1), "stages": stages, "bucket_counts": steer.bucket_counts(stages),
                   "extra_rig_days": round(s["days"] - s["truth"]["lateral_ft"] / steer.FT_PER_DAY, 2), "note": steer.NOTE}
    plan = steer.in_zone_plan_pct(s)
    if plan is not None:
        s["result"]["in_zone_plan_pct"] = round(plan, 1)        # the prognosis line itself: how good the plan was
    return s["result"]
