"""Career mode: run an operator's asset team month by month.

Belief vs truth. Plans, budgets and forecasts run on the player's type curve and AFE estimates. Actuals run the
same schedule engine on hidden truth: simulated production (ressim) and seeded cost and duration variance.
The browser only ever sees `view()`, which never contains hidden rock, well factors or truth curves of
undrilled wells.
"""
import json
import math
import random
import threading
import time
import uuid
from pathlib import Path

import field
import opecon
import schedule
import steer
import steergame
import career_tasks
from minigames import base as mgbase
import typecurve

GAME = Path(__file__).resolve().parent
CAREERS = GAME / "careers"
MD = opecon.MONTH_DAYS
CAREER_MONTHS = 60
FORECAST_MONTHS = 120
START_CASH = 40e6
CREDIT_LINE = 60e6
CASH_RESERVE = 5e6
START_CONFIDENCE = 60.0
SACK_BELOW = 20.0
PVI_HURDLE = 0.2
STARTING_BATTERY_BBL_D = None    # no hard battery limit: facilities are built as wells come on; the facility task sets their cost
DECLINE_ALLOWANCE = 0.80        # the board accepts guidance down to 80 % of the last 12 months' oil
SHAREHOLDER_RETURN = 0.50       # share of each year's positive free cash flow paid out at year end

DESIGN_RANGES = {"stage_spacing_ft": (150.0, 400.0), "half_length_ft": (100.0, 450.0), "conductivity_mdft": (5.0, 200.0),
                 "bhp_psi": (1000.0, 3000.0)}
LIMITS = {"wells_per_section": (2, 10), "rigs": (1, 3), "crews": (1, 2)}

_locks = {}
_locks_guard = threading.Lock()


def lock_for(cid):
    with _locks_guard:
        return _locks.setdefault(cid, threading.Lock())


class CareerError(Exception):
    pass


# ---- storage --------------------------------------------------------------------------------------
def _dir(cid):
    if not (isinstance(cid, str) and len(cid) == 12 and all(c in "0123456789abcdef" for c in cid)):
        raise CareerError("unknown career")
    d = CAREERS / cid
    if not d.exists():
        raise CareerError("unknown career")
    return d


def load(cid):
    d = _dir(cid)
    st, truth = json.loads((d / "state.json").read_text()), json.loads((d / "truth.json").read_text())
    st["geology"] = field.geology_map(truth["seed"], truth["rock"])      # derived, never stored truth
    return st, truth


def save(state, truth=None):
    d = CAREERS / state["id"]
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "state.json.tmp"
    tmp.write_text(json.dumps(state))
    tmp.replace(d / "state.json")
    if truth is not None:
        (d / "truth.json").write_text(json.dumps(truth))


def list_careers():
    out = []
    for d in sorted(CAREERS.glob("*/state.json")):
        s = json.loads(d.read_text())
        out.append({"id": s["id"], "name": s["name"], "month": s["month"], "status": s["status"], "confidence": s["board"]["confidence"]})
    return out


# ---- creation -------------------------------------------------------------------------------------
def new(name, truth_sim, seed=None, background=True):
    """Create a career. Truth curves for the inherited wells are simulated (about 2 s each) before play starts."""
    seed = seed if seed is not None else random.randrange(10 ** 9)
    cid = uuid.uuid4().hex[:12]
    worker = getattr(truth_sim, "worker", None)
    grid = field.make_grid(worker, seed) if worker is not None else None     # one hidden rock: logs, maps and production
    rock = field.make_rock_from_grid(seed, grid) if grid else field.make_rock(seed)
    developed, analogs = field.make_analogs(seed, rock)
    truth = {"seed": seed, "rock": rock, "developed": developed, "analogs": analogs, **({"grid": grid} if grid else {})}
    state = {
        "id": cid, "name": str(name)[:40] or "Operator", "seed": seed, "created": time.strftime("%Y-%m-%d %H:%M"),
        "status": "generating", "progress": 0.0, "month": 0,
        "sections": [{"section": r["section"], "col": r["col"], "row": r["row"], "developed": r["section"] in developed} for r in rock],
        "cash_usd": START_CASH, "credit_line_usd": CREDIT_LINE,
        "history": {k: [] for k in ("month", "oil", "gas", "water", "op_cash_usd", "capex_usd", "cash_usd", "oil_forecast")},
        "typecurves": {}, "plan": None, "locked": {}, "wells": [],
        "board": {"confidence": START_CONFIDENCE, "approved": {}, "guidance": {}, "forecast": {}, "reviews": []},
        "inbox": [], "score": None, "oil_cap_bbl_d": STARTING_BATTERY_BBL_D,
    }
    CAREERS.mkdir(exist_ok=True)
    save(state, truth)

    def generate():
        try:
            if grid:                                  # structure: faults, tops at the verticals, the inherited laterals
                st, tr = load(cid)
                add_structure(st, tr, worker)                 # slow (about a minute): outside the lock so polling stays live
                with lock_for(cid):
                    st, tr0 = load(cid)
                    tr0["structure"] = tr["structure"]
                    save(st, tr0)
            specs = []
            for a in analogs:
                rs = next(r for r in rock if r["section"] == a["section"])
                specs.append(field.spec_for(rs, a["design"], a["wells_per_section"]))
            uniq = list({json.dumps(s, sort_keys=True): s for s in specs}.values())
            for i, s in enumerate(uniq):
                truth_sim.stage_curve(s)
                with lock_for(cid):
                    st, _ = load(cid)
                    st["progress"] = (i + 1) / len(uniq)
                    save(st)
            with lock_for(cid):
                st, _ = load(cid)
                st["status"] = "active"
                inbox(st, "board", "Welcome to the asset",
                      f"You have taken over {len(analogs)} producing wells in sections {', '.join(developed)} and the undeveloped acreage "
                      f"around them. Build a type curve from the producing wells, plan the development, and bring a capital budget "
                      f"for year 1 to the board. Cash ${START_CASH / 1e6:.0f} MM, credit line ${CREDIT_LINE / 1e6:.0f} MM.")
                save(st)
        except Exception as e:  # noqa: BLE001  reported to the player
            with lock_for(cid):
                st, _ = load(cid)
                st["status"] = "error"
                st["error"] = str(e)
                save(st)

    if background:
        threading.Thread(target=generate, daemon=True).start()
    else:
        generate()
    return cid


def add_structure(state, truth, worker):
    """The field's structure (f7's synthetic_structure and faults) for a grid career: the fault list, the faulted top
    at every legacy vertical, and the top along every inherited lateral. Kept in truth; the worker rebuilds the rest."""
    import geodesk
    prm = field.structure_params(truth["seed"], truth["grid"])
    faults = field.structure_call(worker, prm, mode="faults")["faults"]
    truth["structure"] = {"params": prm, "faults": faults, "vertical_tops": {}, "profiles": {}}
    vs = geodesk.legacy_wells(state, truth)
    if vs:
        tops = field.structure_call(worker, prm, mode="tops", points=[[w["x_ft"], w["y_ft"]] for w in vs])["top_tvd"]
        truth["structure"]["vertical_tops"] = {w["id"]: round(t, 2) for w, t in zip(vs, tops)}
    for h in geodesk.horizontal_rows(state, truth):
        truth["structure"]["profiles"][h["id"]] = lateral_profile(truth, worker, h["heel"]["x_ft"], h["heel"]["y_ft"], h["azimuth_deg"], h["lateral_ft"])


def lateral_profile(truth, worker, x, y, azimuth, length):
    r = field.structure_call(worker, truth["structure"]["params"], mode="lateral", x_ft=x, y_ft=y, azimuth_deg=azimuth,
                             length_ft=length, gross_ft=100.0)
    return {"md": [round(m, 1) for m in r["md"]], "top_tvd": [round(t, 2) for t in r["top_tvd"]],
            "crossings": [{"md": round(c["md"], 1), "throw_ft": round(c["throw_ft"], 1)} for c in r["crossings"]]}


def _mult(mm, m):
    import workover
    return workover.multiplier(mm, m)


def inbox(state, kind, title, body, data=None):
    state["inbox"].append({"month": state["month"], "kind": kind, "title": title, "body": body, **({"data": data} if data else {})})


# ---- truth helpers --------------------------------------------------------------------------------
def rock_of(truth, section):
    return next(r for r in truth["rock"] if r["section"] == section)


def analog_truth_curve(truth, a, truth_sim):
    stage = truth_sim.stage_curve(field.spec_for(rock_of(truth, a["section"]), a["design"], a["wells_per_section"]))
    n = max(1, round(a["lateral_ft"] / a["design"]["stage_spacing_ft"]))
    return field.well_curve(stage, n, a["well_factor"], a["noise_seed"])


def player_well_truth_curve(truth, w, truth_sim):
    """Truth production: one simulated repeating stage per landing bucket (stages landed in a barrier have a choked
    well-to-pay connection), summed, then the well's hidden factor and monthly noise."""
    counts = (w.get("steer") or {}).get("bucket_counts") or {"0.0": w["stages"]}
    vol = steergame.well_volumes(truth_sim, rock_of(truth, w["section"]), w["design"], w["wells_per_section"], counts,
                                 bhp_schedule=w.get("bhp_schedule"))
    return field.well_curve(vol, 1, w["well_factor"], w["noise_seed"])


def visible_history(curve, produced_months):
    k = max(0, min(int(produced_months), len(curve["oil"])))
    return {ph: [round(v, 1) for v in curve[ph][:k]] for ph in curve}


def analog_list(state, truth, truth_sim):
    """Every producing well with the history the player can see now: inherited wells plus the player's own."""
    out = []
    for a in truth["analogs"]:
        c = analog_truth_curve(truth, a, truth_sim)
        h = visible_history(c, state["month"] - a["online_month"])
        out.append({"id": a["id"], "section": a["section"], "owner": "inherited", "lateral_ft": a["lateral_ft"],
                    "wells_per_section": a["wells_per_section"], "well_spacing_ft": field.SECTION_FT / a["wells_per_section"],
                    "design": a["design"], "online_month": a["online_month"], "history_months": len(h["oil"]), **h})
    for w in state["wells"]:
        produced = (state["month"] * MD - w["online_day"]) / MD
        if produced < 1:
            continue
        c = player_well_truth_curve(truth, w, truth_sim)
        h = visible_history(c, math.floor(produced))
        out.append({"id": w["id"], "section": w["section"], "owner": "you", "lateral_ft": w["lateral_ft"],
                    "wells_per_section": w["wells_per_section"], "well_spacing_ft": field.SECTION_FT / w["wells_per_section"],
                    "design": w["design"], "online_month": round(w["online_day"] / MD, 2), "history_months": len(h["oil"]), **h})
    return out


# ---- type curves ----------------------------------------------------------------------------------
def build_typecurve(state, truth, truth_sim, analog_ids, normalise=True, dmin=0.08):
    al = [a for a in analog_list(state, truth, truth_sim) if a["id"] in set(analog_ids)]
    if len(al) < 3:
        raise CareerError("pick at least 3 producing wells with history")
    tc = typecurve.build(al, normalise_lateral=normalise, dmin=dmin)
    return tc, al


GEO_EXP_RANGE = (0.0, 1.5)
GEO_FACTOR_RANGE = (0.25, 4.0)


def geology_fit(state, al, source=None):
    """How the analogs' early oil scales with a mapped attribute: a log-log least-squares fit of 6-month oil per 1,000 ft
    against the attribute at each well's section. Only what the player can see goes in. source = {"geomodel": name |
    "company map", "attribute": a}; default the company map's kh."""
    import geodesk
    source = source or {"geomodel": "company map", "attribute": "kh"}
    try:
        kh = geodesk.values_for(state, source)
    except ValueError as e:
        raise CareerError(str(e))
    pts = []
    for a in al:
        if a["history_months"] >= 6 and kh.get(a["section"], 0) > 0:
            q = typecurve.align_peak(a["oil"])[:6]
            if len(q) == 6 and sum(q) > 0:
                pts.append({"id": a["id"], "section": a["section"], "value": kh[a["section"]], "kh_est_md_ft": kh[a["section"]],
                            "oil_6m_per_1000ft": sum(q) * 1000.0 / a["lateral_ft"]})
    ref = math.exp(sum(math.log(kh[a["section"]]) for a in al if kh.get(a["section"], 0) > 0) /
                   max(1, sum(1 for a in al if kh.get(a["section"], 0) > 0))) if al else None
    if len({p["section"] for p in pts}) < 2:
        return {"exponent": None, "r2": None, "n": len(pts), "ref_kh_md_ft": ref, "ref_value": ref, "points": pts, "source": source,
                "values": kh, "note": "needs wells in at least two mapped sections"}
    xs = [math.log(p["kh_est_md_ft"]) for p in pts]
    ys = [math.log(p["oil_6m_per_1000ft"]) for p in pts]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx > 0 else 0.0
    ss = sum((y - my) ** 2 for y in ys)
    r2 = 1 - sum((y - (my + slope * (x - mx))) ** 2 for x, y in zip(xs, ys)) / ss if ss > 0 else 0.0
    return {"exponent": max(GEO_EXP_RANGE[0], min(GEO_EXP_RANGE[1], slope)), "raw_slope": slope, "r2": r2, "n": len(pts),
            "ref_kh_md_ft": ref, "ref_value": ref, "points": pts, "source": source, "values": kh,
            "note": "forecast for a pad = type curve x (mapped kh of the pad's section / ref kh) ^ exponent; the exponent is "
                    f"fitted on the analogs (clamped to {GEO_EXP_RANGE[0]:g}-{GEO_EXP_RANGE[1]:g}), the factor to "
                    f"{GEO_FACTOR_RANGE[0]:g}-{GEO_FACTOR_RANGE[1]:g}"}


def geo_factor(state, tc, section):
    g = tc.get("geology")
    if not g or not g.get("exponent"):
        return 1.0
    kh = (g.get("values") or {}).get(section) if g.get("values") else \
        next((m["kh_est_md_ft"] for m in state.get("geology", []) if m["section"] == section), None)
    if not kh or not g.get("ref_kh_md_ft"):
        return 1.0
    return max(GEO_FACTOR_RANGE[0], min(GEO_FACTOR_RANGE[1], (kh / g["ref_kh_md_ft"]) ** g["exponent"]))


def proximity_analogs(state, truth, truth_sim, prox):
    """Auto-forecast's analog pick: the n nearest producing wells (6+ months of history) to a pad's section centre or a
    point, within radius_ft, by distance from the well's mid-lateral. Returns [{id, distance_ft}]."""
    import geodesk
    pos = {s["section"]: (s["col"], s["row"]) for s in state["sections"]}
    if prox.get("pad"):
        if prox["pad"] not in pos:
            raise CareerError("proximity.pad must be a section")
        c, r = pos[prox["pad"]]
        x, y = (c + 0.5) * field.SECTION_FT, (r + 0.5) * field.SECTION_FT
    else:
        try:
            x, y = float(prox["x_ft"]), float(prox["y_ft"])
        except (KeyError, TypeError, ValueError):
            raise CareerError("proximity needs pad, or x_ft and y_ft")
    n = int(prox.get("n", 8))
    radius = float(prox.get("radius_ft", 4 * field.SECTION_FT))
    hist = {a["id"]: a["history_months"] for a in analog_list(state, truth, truth_sim)}
    cand = []
    for h in geodesk.horizontal_rows(state, truth):
        if hist.get(h["id"], 0) < 6:
            continue
        mx, my = (h["heel"]["x_ft"] + h["toe"]["x_ft"]) / 2, (h["heel"]["y_ft"] + h["toe"]["y_ft"]) / 2
        d = math.hypot(mx - x, my - y)
        if d <= radius:
            cand.append({"id": h["id"], "distance_ft": round(d)})
    cand.sort(key=lambda c: c["distance_ft"])
    if len(cand) < 3:
        raise CareerError("fewer than 3 producing wells within the radius: widen it")
    return cand[:max(3, n)]


def save_typecurve(state, name, analog_ids, tc, overrides=None, geology=None):
    fits = {k: dict(v) for k, v in tc["fits"].items() if v}
    for pct, p in (overrides or {}).items():
        if pct in fits:
            for k in ("qi", "di", "b", "dmin"):
                if k in p:
                    fits[pct][k] = float(p[k])
    if "p50" not in fits:
        raise CareerError("not enough overlapping history for a P50 curve")
    state["typecurves"][str(name)[:40]] = {"analogs": list(analog_ids), "fits": fits, "gor_mcf_bbl": tc["gor_mcf_bbl"],
                                            "per_ft": tc["per_ft"], "created_month": state["month"],
                                            "eur_oil_per_1000ft": {k: sum(typecurve.curve(f)) for k, f in fits.items()},
                                            "geology": ({k: geology.get(k) for k in ("exponent", "ref_kh_md_ft", "r2", "n", "source", "values")}
                                                        if geology and geology.get("exponent") is not None else None)}


# ---- plans ----------------------------------------------------------------------------------------
def check_plan(state, plan):
    if not isinstance(plan, dict):
        raise CareerError("plan must be an object")
    d = plan.get("design") or {}
    design = {}
    for k, (lo, hi) in DESIGN_RANGES.items():
        try:
            v = float(d.get(k))
        except (TypeError, ValueError):
            raise CareerError(f"design.{k} must be a number")
        if not lo <= v <= hi:
            raise CareerError(f"design.{k} must be between {lo:g} and {hi:g}")
        design[k] = v
    tcname = plan.get("typecurve")
    if tcname not in state["typecurves"]:
        raise CareerError("choose a saved type curve")
    pct = plan.get("percentile", "p50")
    if pct not in state["typecurves"][tcname]["fits"]:
        raise CareerError(f"type curve has no {pct}")
    open_sections = {s["section"] for s in state["sections"] if not s["developed"]}
    pads, seen = [], set()
    for p in plan.get("pads") or []:
        sec = p.get("section")
        if sec not in open_sections:
            raise CareerError(f"section {sec} is not undeveloped acreage")
        if sec in seen:
            raise CareerError(f"section {sec} appears twice")
        seen.add(sec)
        wps = p.get("wells")
        if not isinstance(wps, int) or not LIMITS["wells_per_section"][0] <= wps <= LIMITS["wells_per_section"][1]:
            raise CareerError(f"pad {sec}: wells must be a whole number from 2 to 10")
        if sec in state["locked"] and wps != len(state["locked"][sec]["wells"]):
            raise CareerError(f"pad {sec} has started; its well count is fixed")
        ptc, ppct = p.get("typecurve", tcname), p.get("percentile", pct)
        if ptc not in state["typecurves"] or ppct not in state["typecurves"][ptc]["fits"]:
            raise CareerError(f"pad {sec}: unknown type curve or percentile")
        mode = p.get("steer", "staff")
        if mode not in ("staff", "manual"):
            raise CareerError(f"pad {sec}: steer must be 'staff' or 'manual'")
        comp, fb = p.get("completion", "standard"), p.get("flowback", "standard")
        if comp not in ("standard", "manual") or fb not in ("standard", "manual"):
            raise CareerError(f"pad {sec}: completion and flowback must be 'standard' or 'manual'")
        pads.append({"id": sec, "section": sec, "wells": wps, "typecurve": ptc, "percentile": ppct, "steer": mode,
                     "completion": comp, "flowback": fb})
    for sec in state["locked"]:                     # started pads cannot be dropped from the plan
        if sec not in seen:
            lp = state["locked"][sec]
            pads.insert(0, {"id": sec, "section": sec, "wells": len(lp["wells"]), "typecurve": tcname, "percentile": pct})
    out = {"design": design, "typecurve": tcname, "percentile": pct, "pads": pads}
    for k in ("rigs", "crews"):
        v = plan.get(k, 1)
        lo, hi = LIMITS[k]
        if not isinstance(v, int) or not lo <= v <= hi:
            raise CareerError(f"{k} must be a whole number from {lo} to {hi}")
        out[k] = v
    req = {}
    for y, v in (plan.get("budget_request") or {}).items():
        try:
            req[int(y)] = float(v)
        except (TypeError, ValueError):
            raise CareerError("budget_request must map year index to USD")
    out["budget_request"] = req
    return out


def expected_cost_factors(state, y):
    """What a year's rig, completion and facility costs are expected to run at: a played contracting job's result once
    it is in, otherwise the staff-typical market (career_tasks.STAFF_COST_FACTOR)."""
    cf = state.get("cost_factors", {}).get(str(y), {})
    decided = str(y) in state["board"]["approved"]          # the year's jobs exist: a factor not set means no job, standard cost
    return {k: cf.get(k, 1.0 if decided else career_tasks.STAFF_COST_FACTOR) for k in ("rig", "completion", "facilities")}


def belief_well_plan(design, state=None):
    """The AFE the plan uses: the design's estimate at the expected contracting costs of the year the pad starts."""
    est = opecon.well_estimate(design)

    def wp(pad, i, start_day=None):
        f = expected_cost_factors(state, int((start_day if start_day is not None else state["month"] * MD) // (12 * MD))) if state else \
            {"rig": 1.0, "completion": 1.0, "facilities": 1.0}
        spread = est["drilling"]["rig_spread_usd"] * f["rig"]
        return {"drill_days": est["drill_days"], "frac_days": est["frac_days"],
                "drilling_usd": est["drilling_usd"] - est["drilling"]["rig_spread_usd"] + spread,
                "completion_usd": est["completion_usd"] * f["completion"], "facilities_usd": est["facilities_usd"] * f["facilities"],
                "rig_spread_usd": spread}
    return wp


def truth_well_plan(state, design):
    est = opecon.well_estimate(design)
    cf = state.get("cost_factors", {}).get(str(state["month"] // 12), {})     # this year's rig and water contracting results
    rig_f, comp_f, fac_f = cf.get("rig", 1.0), cf.get("completion", 1.0), cf.get("facilities", 1.0)

    def wp(pad, i):
        r = field.rng_for(state["seed"], "exec", pad["id"], i)
        npt = r.uniform(0.1, 0.6) if r.random() < 0.2 else 0.0             # non-productive time
        screen = r.random() < 0.04 + 0.0004 * design["conductivity_mdft"]  # screen-out risk rises with proppant loading
        drill_days = est["drill_days"] * (1.0 + npt) * r.uniform(0.92, 1.08)
        spread = est["drilling"]["rig_spread_usd"] * drill_days / est["drill_days"] * rig_f
        price = math.exp(r.gauss(0.02, 0.06))                               # service and steel prices move
        return {"drill_days": drill_days, "frac_days": est["frac_days"] * r.uniform(0.95, 1.25) + (1.0 if screen else 0.0),
                "drilling_usd": (spread + est["drilling"]["tangibles_usd"] * price + est["drilling"]["mobilisation_usd"]),
                "rig_spread_usd": spread, "completion_usd": est["completion_usd"] * price * (1.08 if screen else 1.0) * comp_f,
                "facilities_usd": est["facilities_usd"] * price * fac_f, "npt": npt, "screen_out": screen}
    return wp


DELAY = {"chance": 0.25, "days": (7.0, 40.0), "causes": ("permit", "weather", "frac crew late", "pad construction")}


def pad_delay(seed, pad_id, r=None):
    """A pad's hidden start delay (truth): a quarter of pads slip 7-40 days. Fixed per pad, so re-scheduling each month
    keeps it."""
    r = r or field.rng_for(seed, "delay", pad_id)
    if r.random() < DELAY["chance"]:
        return round(r.uniform(*DELAY["days"]), 1), r.choice(DELAY["causes"])
    return 0.0, None


def with_delays(state, pads):
    """Truth: a delayed pad cannot start before its first scheduled start plus its delay (fixed once, so re-scheduling
    each month does not push it again)."""
    nb = state.setdefault("pad_not_before", {})
    return [dict(p, not_before_day=nb[p["id"]]) if p["id"] in nb and p["id"] not in state["locked"] else p for p in pads]


def fix_delays(state, res):
    """After a truth schedule: pads seen for the first time get their not-before day. Returns True if any changed."""
    nb = state.setdefault("pad_not_before", {})
    new = False
    for p in res["pads"]:
        if p["id"] in state["locked"] or p["id"] in nb:
            continue
        d, _ = pad_delay(state["seed"], p["id"])
        nb[p["id"]] = p["drill_start"] + d
        new = new or d > 0
    return new


def pop_bands(state, plan, n=60):
    """Point-of-production risk on belief: each pad's online month at P10 / P50 / P90 over sampled delays (the odds are
    known, the draws are not)."""
    import random as _r
    rng = _r.Random(f"{state['seed']}|popband|{state['month']}")
    ons = {}
    for k in range(n):
        pads = []
        for p in plan["pads"]:
            d, _ = pad_delay(None, None, rng) if p["id"] not in state["locked"] else (0.0, None)
            pads.append(dict(p, delay_days=d))
        res = schedule.run(pads, plan["rigs"], plan["crews"], belief_well_plan(plan["design"], state), budget=budgets(state, plan),
                           start_day=state["month"] * MD, locked=locked_for_schedule(state))
        for p in res["pads"]:
            ons.setdefault(p["id"], []).append(p["online"] / MD)
    out = {}
    for pid, xs in ons.items():
        xs.sort()
        out[pid] = {"online_month_p10": round(xs[int(0.1 * len(xs))], 2), "online_month_p50": round(xs[len(xs) // 2], 2),
                    "online_month_p90": round(xs[min(len(xs) - 1, int(0.9 * len(xs)))], 2)}
    return out


def budgets(state, plan, use_request=True):
    b = {int(k): v for k, v in state["board"]["approved"].items()}
    if use_request:
        for y, v in plan["budget_request"].items():
            b.setdefault(y, v)
    return b


def locked_for_schedule(state):
    return {k: v for k, v in state["locked"].items()}


def evaluate_plan(state, truth, truth_sim, plan):
    """The plan on belief: schedule, forecast, capex against budget, field measures. Fast (no simulation)."""
    now = state["month"] * MD
    tc = state["typecurves"][plan["typecurve"]]
    fitp = tc["fits"][plan["percentile"]]
    per_ft = tc["per_ft"] or 1000.0
    n_months = state["month"] + FORECAST_MONTHS
    res = schedule.run(plan["pads"], plan["rigs"], plan["crews"], belief_well_plan(plan["design"], state), budget=budgets(state, plan),
                       start_day=now, locked=locked_for_schedule(state))
    lateral = opecon.LATERAL_FT
    well_oil = [v * lateral / per_ft for v in typecurve.curve(fitp)]
    gor = tc["gor_mcf_bbl"]
    by_id = {p["id"]: p for p in plan["pads"]}

    def curve_for(pid):
        pp = by_id.get(pid, {})
        t = state["typecurves"][pp.get("typecurve", plan["typecurve"])]
        f = t["fits"][pp.get("percentile", plan["percentile"])]
        g = geo_factor(state, t, pp.get("section", pid))
        return [v * lateral / (t["per_ft"] or 1000.0) * g for v in typecurve.curve(f)], t["gor_mcf_bbl"]

    dev_oil = [0.0] * n_months
    dev_gas = [0.0] * n_months
    dev_wells = [0] * n_months
    new_oil, new_gas, new_wells = [0.0] * n_months, [0.0] * n_months, [0] * n_months     # pads not started yet
    pad_rows = []
    for p in res["pads"]:
        well_oil_p, gor_p = curve_for(p["id"])
        pad_oil = [0.0] * n_months
        for w in p["wells"]:
            placed = schedule.place(well_oil_p, w["online"], n_months)
            pad_oil = [a + b for a, b in zip(pad_oil, placed)]
            m0 = int(w["online"] // MD)
            for m in range(max(0, m0), n_months):
                dev_wells[m] += 1
        dev_oil = [a + b for a, b in zip(dev_oil, pad_oil)]
        dev_gas = [a + b * gor_p for a, b in zip(dev_gas, pad_oil)]
        if p["id"] not in state["locked"]:
            new_oil = [a + b for a, b in zip(new_oil, pad_oil)]
            new_gas = [a + b * gor_p for a, b in zip(new_gas, pad_oil)]
            for w in p["wells"]:
                for m in range(max(0, int(w["online"] // MD)), n_months):
                    new_wells[m] += 1
        pad_cap, _ = schedule.monthly_capex([tuple(e) for e in p["capex_events"]], n_months)
        nw = len(p["wells"])
        op = [opecon.net_cash(o, o * gor_p, 0.0, nw if o > 0 else 0)["net_usd"] for o in pad_oil]
        pm = opecon.measures(op[state["month"]:], pad_cap[state["month"]:], eur_boe=sum(pad_oil) * (1 + gor_p / 6.0))
        pp = by_id.get(p["id"], {})
        pad_rows.append({"pad": p["id"], "section": p["section"], "wells": nw,
                         "geology_factor": geo_factor(state, state["typecurves"][pp.get("typecurve", plan["typecurve"])], p["section"]) if pp else 1.0,
                         "typecurve": pp.get("typecurve", plan["typecurve"]), "percentile": pp.get("percentile", plan["percentile"]),
                         "well_spacing_ft": field.SECTION_FT / nw, "started": p["id"] in state["locked"],
                         "drill_start_month": round(p["drill_start"] / MD, 2), "online_month": round(p["online"] / MD, 2),
                         "capex_usd": p["planned_cost_usd"], "npv10_usd": pm["npv10_usd"], "pvi": pm["pvi"], "irr": pm["irr"]})
    capex, by_cat = schedule.monthly_capex(res["capex_events"], n_months)
    cap = state.get("oil_cap_bbl_d")
    curtailed_months = 0
    if cap:                                       # the battery limit curtails new wells on belief too, as it will on truth
        for k in range(n_months):
            if dev_oil[k] > cap * MD:
                f = cap * MD / dev_oil[k]
                dev_oil[k] *= f
                dev_gas[k] *= f
                curtailed_months += 1 if k >= state["month"] else 0
    # inherited wells (PDP) on belief: each well's own decline fit, continued from its age today
    pdp = [0.0] * n_months
    pdp_wells = 0
    for a in analog_list(state, truth, truth_sim):
        if a["owner"] != "inherited":
            continue
        al = typecurve.align_peak(a["oil"])
        f = typecurve.fit(al)
        if not f:
            continue
        pdp_wells += 1
        age = len(al)
        for m in range(state["month"], n_months):
            pdp[m] += typecurve.arps_rate(age + (m - state["month"]) + 0.5, f["qi"], f["di"], f["b"], f["dmin"])
    m0 = state["month"]
    pdp_gor = gor                                   # inherited wells: the plan's main type curve GOR
    dev_op = [opecon.net_cash(o, dev_gas[m], 0.0, dev_wells[m])["net_usd"] for m, o in enumerate(dev_oil)]
    eur = sum(dev_oil[m0:]) + sum(dev_gas[m0:]) / 6.0
    meas = opecon.measures(dev_op[m0:], capex[m0:], eur_boe=eur)
    years = sorted({y for y in range(m0 // 12, n_months // 12)})
    bud = budgets(state, plan)
    budget_rows = []
    for y in years[:6]:
        sl = slice(12 * y, 12 * (y + 1))
        yr_op = sum(opecon.net_cash(pdp[m] + dev_oil[m], pdp[m] * pdp_gor + dev_gas[m], 0.0, dev_wells[m] + pdp_wells)["net_usd"]
                    for m in range(max(12 * y, m0), min(12 * (y + 1), n_months)))
        budget_rows.append({"year": y + 1, "year_index": y, "planned_capex_usd": sum(capex[sl]),
                            "requested_usd": plan["budget_request"].get(y), "approved_usd": state["board"]["approved"].get(str(y)),
                            "committed_usd": res["committed_by_year"].get(y, 0.0),
                            "oil_forecast_bbl": sum(dev_oil[sl]) + sum(pdp[sl]), "op_cash_forecast_usd": yr_op,
                            "board_limit_usd": board_limit(state, yr_op) if y == m0 // 12 else None})
    est = opecon.well_estimate(plan["design"])
    return {
        "units": opecon.UNITS,
        "warnings": analog_warnings(state, truth, truth_sim, plan) + (
            [f"the {cap:,.0f} bbl/d battery limit curtails your new wells in {curtailed_months} forecast months; "
             f"the facility task can expand it"] if cap and curtailed_months else []),
        "battery_limit_bbl_d": cap, "curtailed_months": curtailed_months,
        "unscheduled": res.get("unscheduled", []),
        "afe_estimate_per_well": est,
        "type_curve": {"name": plan["typecurve"], "percentile": plan["percentile"], "params": fitp,
                       "eur_oil_per_well_bbl": sum(well_oil), "gor_mcf_bbl": gor},
        "gantt": schedule.gantt(res, n_months), "delays": res["delays"],
        "unbudgeted_years": [y + 1 for y in res["unbudgeted_years"]],
        "pads": pad_rows,
        "forecast": {"month": list(range(m0, n_months)), "oil_pdp": pdp[m0:], "oil_dev": dev_oil[m0:],
                     "gas": [a * pdp_gor + b for a, b in zip(pdp[m0:], dev_gas[m0:])],
                     "capex_usd": capex[m0:], "capex_by_category_usd": {k: v[m0:] for k, v in by_cat.items()},
                     "dev_op_cash_usd": dev_op[m0:], "dev_cum_cash_usd": meas.pop("cum_cash_usd")},
        "budget_by_year": budget_rows,
        "measures": meas,
        "_schedule": res, "_pdp": pdp, "_dev_oil": dev_oil, "_dev": {"oil": dev_oil, "gas": dev_gas, "wells": dev_wells, "capex": capex,
                                                                     "new_oil": new_oil, "new_gas": new_gas, "new_wells": new_wells},
    }


MAX_SCENARIOS = 10


def scenarios(state, ev, specs):
    """The plan's development economics under up to 10 cases: a flat oil and gas price (or factors on the deck), a capex
    factor, and a delay that pushes every not-yet-started pad's production and spend later. Volumes are the plan's own
    forecast (belief); nothing is re-simulated."""
    if not isinstance(specs, list) or not specs:
        raise CareerError("scenarios must be a non-empty list")
    if len(specs) > MAX_SCENARIOS:
        raise CareerError(f"at most {MAX_SCENARIOS} scenarios")
    d, m0 = ev["_dev"], state["month"]
    started = set(state["locked"])
    out = []
    base = None
    for i, sc in enumerate([{"name": "plan"}] + specs):
        if not isinstance(sc, dict):
            raise CareerError("each scenario is an object")
        try:
            deck = dict(opecon.PRICE_DECK)
            if sc.get("oil_usd_bbl") is not None:
                deck["oil_usd_bbl"] = float(sc["oil_usd_bbl"])
            deck["oil_usd_bbl"] *= float(sc.get("oil_price_factor", 1.0))
            if sc.get("gas_usd_mcf") is not None:
                deck["gas_usd_mcf"] = float(sc["gas_usd_mcf"])
            deck["gas_usd_mcf"] *= float(sc.get("gas_price_factor", 1.0))
            cf = float(sc.get("capex_factor", 1.0))
            delay = int(sc.get("delay_months", 0))
        except (TypeError, ValueError):
            raise CareerError(f"scenario {i}: numbers expected")
        if not (0 <= delay <= 24 and 0.3 <= cf <= 3.0):
            raise CareerError(f"scenario {i}: delay_months 0-24, capex_factor 0.3-3")
        n = len(d["oil"])
        if delay:                                     # only unstarted pads slip: shift the part not committed by locked pads
            locked_cap = [0.0] * n
            for p in state["locked"].values():
                for e in p["capex_events"]:
                    k = int(e[0] // MD)
                    if 0 <= k < n:
                        locked_cap[k] += e[1]
            free = [c - lc for c, lc in zip(d["capex"], locked_cap)]
            shift = lambda xs: [0.0] * delay + xs[:n - delay]
            cap = [lc + f for lc, f in zip(locked_cap, shift(free))]
            # only pads not started slip: started pads keep their volumes
            oil = [a - b + c for a, b, c in zip(d["oil"], d["new_oil"], shift(d["new_oil"]))]
            gas = [a - b + c for a, b, c in zip(d["gas"], d["new_gas"], shift(d["new_gas"]))]
            wells = [a - b + c for a, b, c in zip(d["wells"], d["new_wells"], shift(d["new_wells"]))]
        else:
            cap, oil, gas, wells = d["capex"], d["oil"], d["gas"], d["wells"]
        cap = [c * cf for c in cap]
        op = [opecon.net_cash(o, g, 0.0, w, deck=deck)["net_usd"] for o, g, w in zip(oil, gas, wells)]
        meas = opecon.measures(op[m0:], cap[m0:], eur_boe=sum(oil[m0:]) + sum(gas[m0:]) / 6.0)
        meas.pop("cum_cash_usd", None)
        row = {"name": str(sc.get("name") or f"case {i}")[:40], "oil_usd_bbl": deck["oil_usd_bbl"], "gas_usd_mcf": deck["gas_usd_mcf"],
               "capex_factor": cf, "delay_months": delay, **meas}
        if base is None:
            base = row
        else:
            row["npv10_change_usd"] = row["npv10_usd"] - base["npv10_usd"]
        out.append(row)
    return {"cases": out, "notes": ["Development pads on your forecast. A delay slips the pads not started yet: their volumes "
                                    "and the spend not committed by started pads. Started pads are unchanged.",
                                    "Prices are flat for the whole forecast; the deck's regional differentials still apply."]}


def analog_warnings(state, truth, truth_sim, plan):
    """Flag a plan whose completion or spacing lies outside what its type curve's analogs were drilled with."""
    tc = state["typecurves"][plan["typecurve"]]
    al = [a for a in analog_list(state, truth, truth_sim) if a["id"] in set(tc["analogs"])]
    if not al:
        return []
    out = []
    for k, label in (("stage_spacing_ft", "stage spacing"), ("half_length_ft", "half-length"), ("conductivity_mdft", "conductivity"),
                     ("bhp_psi", "bottom-hole pressure")):
        lo, hi = min(a["design"][k] for a in al), max(a["design"][k] for a in al)
        v = plan["design"][k]
        if v < lo * 0.9 or v > hi * 1.1:
            out.append(f"{label} {v:g} is outside the type curve's analogs ({lo:g}-{hi:g}); the curve may not apply")
    pos = {s["section"]: (s["col"], s["row"]) for s in state["sections"]}
    for p in plan["pads"]:
        if p["section"] in state["locked"] or p["section"] not in pos:
            continue
        c, r = pos[p["section"]]
        ptc = state["typecurves"].get(p.get("typecurve", plan["typecurve"]), tc)
        near = [pos[a["section"]] for a in al if a["id"] in set(ptc["analogs"]) and a["section"] in pos]
        d = min((abs(c - x) + abs(r - y) for x, y in near), default=None)
        if d is not None and d >= 2:
            if not ptc.get("geology"):
                out.append(f"pad {p['section']} is a step-out, {d} sections from the nearest well in its type curve: the rock there is "
                           f"unproven, so the curve may not apply (normalise the type curve to the geology map, use a lower "
                           f"percentile, or build one from nearer wells)")
    lo, hi = min(a["wells_per_section"] for a in al), max(a["wells_per_section"] for a in al)
    for p in plan["pads"]:
        if not lo <= p["wells"] <= hi:
            out.append(f"pad {p['section']}: {p['wells']} wells per section is outside the analogs' {lo}-{hi}; closer spacing "
                       f"means more interference than the type curve shows")
    return out


def strip_private(ev):
    return {k: v for k, v in ev.items() if not k.startswith("_")}


# ---- board ----------------------------------------------------------------------------------------
def capital_limit(state):
    """Hard ceiling: cash plus the undrawn credit line, less a reserve."""
    return max(0.0, state["cash_usd"] + state["credit_line_usd"] - CASH_RESERVE)


def board_limit(state, year_op_cash):
    """What the board will fund this year: forecast operating cash flow plus half the cash on hand, never above the
    hard ceiling. Operators are held to spending within cash flow."""
    return max(0.0, min(capital_limit(state), year_op_cash + 0.5 * max(0.0, state["cash_usd"])))


def trailing_oil(state, truth, truth_sim):
    """Actual oil over the 12 months before now (inherited wells before you arrived count)."""
    h = state["history"]
    if state["month"] >= 12:
        return sum(h["oil"][-12:])
    tot = sum(h["oil"])
    for a in truth["analogs"]:
        c = analog_truth_curve(truth, a, truth_sim)
        for m in range(state["month"] - 12, 0):
            k = m - a["online_month"]
            if 0 <= k < len(c["oil"]):
                tot += c["oil"][k]
    return tot


def budget_meeting(state, truth, truth_sim, plan):
    """Pitch this year's capital budget. The board approves it if it fits the capital limit and the plan
    clears the hurdle on your own forecast; approval fixes the year's budget and production guidance."""
    y = state["month"] // 12
    if str(y) in state["board"]["approved"]:
        raise CareerError(f"year {y + 1} budget is already approved")
    if y not in plan["budget_request"]:
        raise CareerError(f"budget_request has no amount for year index {y}")
    ev = evaluate_plan(state, truth, truth_sim, plan)
    req = plan["budget_request"][y]
    row = next(r for r in ev["budget_by_year"] if r["year_index"] == y)
    conds = board_conditions(state, truth, truth_sim, plan, ev)
    reasons = [c["label"] for c in conds if c["passes"] is False]
    if reasons:
        rej = state["board"].setdefault("rejected_years", [])
        if y not in rej:                     # only the first rejection in a budget cycle costs confidence
            rej.append(y)
            state["board"]["confidence"] = max(0.0, state["board"]["confidence"] - 3.0)
        inbox(state, "board", f"Year {y + 1} budget rejected", "The board sent the budget back: " + "; ".join(reasons) + ".")
        return {"approved": False, "reasons": reasons, "conditions": conds, "confidence": state["board"]["confidence"]}
    state["board"]["approved"][str(y)] = req
    state["board"]["guidance"][str(y)] = row["oil_forecast_bbl"]
    if y == 0:
        import reserves                                   # the opening booking the year-end roll-forward starts from
        state["plan"] = plan
        reserves.opening(state, truth, truth_sim)
    state["board"].setdefault("original", {})[str(y)] = {"approved_usd": req, "guidance_bbl": row["oil_forecast_bbl"]}
    sl = slice(12 * y, 12 * (y + 1))
    state["board"]["forecast"][str(y)] = [a + b for a, b in zip(ev["_pdp"][sl], ev["_dev_oil"][sl])]
    state["plan"] = plan
    try:
        career_tasks.on_budget(state, truth, mgbase.Ctx(getattr(truth_sim, "worker", None), truth_sim),
                               [a + b for a, b in zip(ev["_pdp"], ev["_dev_oil"])])
    except Exception as e:  # noqa: BLE001  optional tasks must never block the budget
        inbox(state, "task", "Optional tasks unavailable this year", str(e)[:200])
    inbox(state, "board", f"Year {y + 1} budget approved",
          f"Capital ${req / 1e6:.1f} MM approved. Production guidance {row['oil_forecast_bbl'] / 1e3:.0f} kbbl oil for the year. "
          f"The board will hold you to both at year end.")
    return {"approved": True, "reasons": [], "conditions": conds, "approved_usd": req, "guidance_oil_bbl": row["oil_forecast_bbl"],
            "confidence": state["board"]["confidence"]}


GROWTH_OVER_BASE = 1.05


def board_check(state, truth, truth_sim, plan):
    """What the board will require this year, and whether it can be met within what it will fund.
    Floor = this year's oil from wells already producing or started (no new pads) plus 5 %. It is waived when
    no undeveloped section is left to start."""
    y = state["month"] // 12
    started = [p for p in plan["pads"] if p["id"] in state["locked"]]
    base_plan = dict(plan, pads=started, budget_request={**plan["budget_request"], y: 0.0})
    base = next(r for r in evaluate_plan(state, truth, truth_sim, base_plan)["budget_by_year"] if r["year_index"] == y)
    floor = GROWTH_OVER_BASE * base["oil_forecast_bbl"]
    full = evaluate_plan(state, truth, truth_sim, dict(plan, budget_request={**plan["budget_request"], y: 1e12}))
    row_full = next(r for r in full["budget_by_year"] if r["year_index"] == y)
    blim = board_limit(state, row_full["op_cash_forecast_usd"])
    funded = evaluate_plan(state, truth, truth_sim, dict(plan, budget_request={**plan["budget_request"], y: blim}))
    row = next(r for r in funded["budget_by_year"] if r["year_index"] == y)
    inventory_left = any(not s["developed"] and s["section"] not in state["locked"] for s in state["sections"])
    return {"year": y + 1, "floor_applies": inventory_left, "base_oil_bbl": base["oil_forecast_bbl"],
            "guidance_floor_bbl": floor if inventory_left else 0.0, "board_limit_usd": blim,
            "max_guidance_bbl": row["oil_forecast_bbl"],
            "floor_reachable": (not inventory_left) or row["oil_forecast_bbl"] >= floor,
            "rejection_costs_confidence": y not in state["board"].get("rejected_years", [])}


def board_conditions(state, truth, truth_sim, plan, ev=None, bc=None):
    """The board's verdict on each condition for this year's request, as the budget meeting will apply it.
    passes: True / False, or None when the condition does not apply (or no amount has been requested yet)."""
    y = state["month"] // 12
    ev = ev or evaluate_plan(state, truth, truth_sim, plan)
    bc = bc or board_check(state, truth, truth_sim, plan)
    req = plan["budget_request"].get(y)
    row = next(r for r in ev["budget_by_year"] if r["year_index"] == y)
    cap = min(capital_limit(state), bc["board_limit_usd"])
    out = []
    if req is None:
        out.append({"key": "limit", "passes": None, "value": None, "threshold": cap,
                    "label": f"no request yet; the board will fund up to ${cap / 1e6:.1f} MM"})
    else:
        why = ("the capital limit (cash + credit line - reserve)" if capital_limit(state) <= bc["board_limit_usd"]
               else "what the board will fund (this year's forecast operating cash flow + half the cash on hand)")
        out.append({"key": "limit", "passes": req <= cap + 1e-6, "value": req, "threshold": cap,
                    "label": f"request ${req / 1e6:.1f} MM against {why}, ${cap / 1e6:.1f} MM"})
    m = ev["measures"]
    new_pads = [p for p in plan["pads"] if p["id"] not in state["locked"]]
    if m["capex_usd"] > 0 and new_pads:
        ok = m["npv10_usd"] > 0 and (m["pvi"] or 0) >= PVI_HURDLE
        out.append({"key": "economics", "passes": ok, "value": m["pvi"], "threshold": PVI_HURDLE, "npv10_usd": m["npv10_usd"],
                    "label": f"development PV10/I {0 if m['pvi'] is None else m['pvi']:.2f} against the {PVI_HURDLE} hurdle, "
                             f"NPV10 ${m['npv10_usd'] / 1e6:.1f} MM (must be positive), on your own forecast"})
    else:
        out.append({"key": "economics", "passes": None, "value": None, "threshold": PVI_HURDLE,
                    "label": "no new development in the plan; the economics hurdle does not apply"})
    if bc["floor_applies"]:
        out.append({"key": "floor", "passes": row["oil_forecast_bbl"] >= bc["guidance_floor_bbl"], "value": row["oil_forecast_bbl"],
                    "threshold": bc["guidance_floor_bbl"],
                    "label": f"guidance {row['oil_forecast_bbl'] / 1e3:.0f} kbbl against the floor of {bc['guidance_floor_bbl'] / 1e3:.0f} kbbl "
                             f"(the producing base plus {100 * (GROWTH_OVER_BASE - 1):.0f} %)"})
    else:
        out.append({"key": "floor", "passes": None, "value": row["oil_forecast_bbl"], "threshold": None,
                    "label": "every open section has been started; the board accepts decline"})
    return out


def review_parts(oil, guide, capex, appr, orig_guide=None, orig_appr=None):
    """The board's year-end scoring: production against guidance and capex against the approved budget (both as
    revised mid-year, if they were). The 'delivered' bonus is only for meeting the original promise."""
    r = oil / guide if guide > 0 else 1.0
    c = capex / appr if appr > 0 else (1.0 if capex == 0 else 2.0)
    r0 = oil / orig_guide if orig_guide else r
    c0 = capex / orig_appr if orig_appr else c
    parts = {
        # beating a lowered guidance earns nothing the original promise would not have: no lowball-then-beat
        "production_vs_guidance": max(-25.0, min(6.0, 40.0 * ((r if r < 1.0 else min(r, max(1.0, r0))) - 1.0))),
        "sandbagging": -min(15.0, 60.0 * max(0.0, r - 1.10)),     # far above guidance: the board stops trusting your forecasts
        "capex_vs_budget": -30.0 * max(0.0, c - 1.05),
        "delivered_both": 5.0 if (r0 >= 0.95 and c0 <= 1.05 and r >= 0.95 and c <= 1.05) else 0.0,
    }
    return r, c, parts


def projection(state):
    """Where this year is heading at today's pace, scored with the year-end review's own formula.
    Oil: year-to-date oil against the year-to-date board forecast, applied to the full-year guidance.
    Capex: spent so far plus what locked pads and task outcomes have already committed for the rest of the year."""
    y = state["month"] // 12
    n = state["month"] - 12 * y
    guide = state["board"]["guidance"].get(str(y))
    appr = state["board"]["approved"].get(str(y))
    if n == 0 or not guide:
        return None
    h = state["history"]
    idx = [i for i, m in enumerate(h["month"]) if 12 * y <= m < 12 * (y + 1)]
    oil = sum(h["oil"][i] for i in idx)
    fc = sum(h["oil_forecast"][i] or 0.0 for i in idx)
    since = (state["board"].get("revised_month") or {}).get(str(y), 12 * y)
    j = [i for i in idx if h["month"][i] >= since]
    a_s, f_s = sum(h["oil"][i] for i in j), sum(h["oil_forecast"][i] or 0.0 for i in j)
    ratio = a_s / f_s if f_s > 0 else 1.0
    remaining = sum((state["board"]["forecast"].get(str(y)) or [0.0] * 12)[n:])
    pace = oil + remaining * ratio
    t0, t1 = state["month"] * MD, 12 * (y + 1) * MD
    committed = sum(e[1] for p in state["locked"].values() for e in p["capex_events"] if t0 <= e[0] < t1)
    committed += sum(c["usd"] for c in state.get("costs_pending", []) if c["day"] < t1)
    capex = sum(h["capex_usd"][i] for i in idx) + committed
    orig = state["board"].get("original", {}).get(str(y)) or {}
    r, c, parts = review_parts(pace, guide, capex, appr or 0.0, orig.get("guidance_bbl"), orig.get("approved_usd"))
    d = sum(parts.values())
    conf = state["board"]["confidence"]
    return {"year": y + 1, "months_done": n, "oil_ytd_bbl": oil, "oil_forecast_ytd_bbl": fc, "oil_pace_bbl": pace,
            "guidance_bbl": guide, "production_ratio": r, "capex_projected_usd": capex, "capex_committed_usd": committed,
            "approved_usd": appr, "capex_ratio": c, "confidence_change": d, "parts": parts,
            "confidence_after": max(0.0, min(100.0, conf + d)), "sack_below": SACK_BELOW,
            "original_guidance_bbl": orig.get("guidance_bbl"), "original_approved_usd": orig.get("approved_usd"),
            "note": "Oil pace: year-to-date actual plus the rest of the board forecast, scaled by actual over forecast since the "
                    "last guidance revision (or the year start). Capex counts "
                    "money spent plus what locked pads and task outcomes have committed; pads not yet started are not included."}


def belief_well_oil(state, plan, pid):
    """The plan's forecast for one well of a pad: its type curve and percentile, scaled to the lateral."""
    pp = next((q for q in plan["pads"] if q["id"] == pid), {})
    t = state["typecurves"][pp.get("typecurve", plan["typecurve"])]
    f = t["fits"][pp.get("percentile", plan["percentile"])]
    g = geo_factor(state, t, pp.get("section", pid))
    return [round(v * opecon.LATERAL_FT / (t["per_ft"] or 1000.0) * g, 1) for v in typecurve.curve(f)]


# ---- mid-year revision --------------------------------------------------------------------------------
TOPUP_BASE_CONF = 2.0          # going back to the board for more money
TOPUP_SLOPE_CONF = 20.0        # plus this x the share above 5 % of the original approval
GUIDANCE_CONF = 40.0           # same slope as the year-end production score
GUIDANCE_BASE_CONF = 1.0


def _year_start_cash(state, y):
    h = state["history"]
    i = next((i for i, m in enumerate(h["month"]) if m == 12 * y - 1), None)
    return h["cash_usd"][i] if i is not None else START_CASH


def revision(state, truth, truth_sim, plan, revise_guidance=False, budget_usd=None, apply=False):
    """Change the plan mid-year. Plan changes inside the approved budget are free; locked pads stay as they are.
    A budget increase and a guidance revision each go to the board and cost confidence up front:
      top-up:   2 + 20 x (increase / original approval - 5 %), only up to what the board will fund this year;
      guidance: 1 + 40 x (shortfall share) x (0.5 + 0.5 x months done / 12), so an early, honest warning is cheaper than
                a year-end miss and a late one is not. Raising guidance is free. One guidance revision per quarter.
    The 'delivered' bonus at year end still needs the original guidance and budget."""
    y = state["month"] // 12
    n = state["month"] - 12 * y
    if state["status"] != "active":
        raise CareerError(f"career is {state['status']}")
    if str(y) not in state["board"]["approved"]:
        raise CareerError("this year has no approved budget yet: take the plan to the budget meeting")
    ev = evaluate_plan(state, truth, truth_sim, plan)
    h = state["history"]
    idx = [i for i, m in enumerate(h["month"]) if 12 * y <= m < 12 * (y + 1)]
    oil_ytd = sum(h["oil"][i] for i in idx)
    spent = sum(h["capex_usd"][i] for i in idx)
    op_ytd = sum(h["op_cash_usd"][i] for i in idx)
    m0, m1 = state["month"], 12 * (y + 1)
    rest = [ev["_pdp"][m] + ev["_dev_oil"][m] for m in range(m0, m1)]
    new_guide = oil_ytd + sum(rest)
    row = next(r for r in ev["budget_by_year"] if r["year_index"] == y)
    orig = state["board"].setdefault("original", {}).setdefault(
        str(y), {"approved_usd": state["board"]["approved"][str(y)], "guidance_bbl": state["board"]["guidance"].get(str(y), 0.0)})
    appr = state["board"]["approved"][str(y)]
    guide = state["board"]["guidance"].get(str(y), 0.0)
    limit = min(spent + capital_limit(state), op_ytd + row["op_cash_forecast_usd"] + 0.5 * max(0.0, _year_start_cash(state, y)))
    want = appr if budget_usd is None else float(budget_usd)
    reasons, cost_b, cost_g = [], 0.0, 0.0
    if want > appr:
        if want > limit:
            reasons.append(f"the board will fund at most ${limit / 1e6:.1f} MM this year")
        cost_b = min(100.0, TOPUP_BASE_CONF + TOPUP_SLOPE_CONF * max(0.0, (want - appr) / max(1.0, orig["approved_usd"]) - 0.05))
    quarter = n // 3
    revised_q = (state["board"].get("revised_quarter") or {}).get(str(y))
    if revise_guidance:
        if revised_q == quarter:
            reasons.append("guidance was already revised this quarter")
        short = max(0.0, 1.0 - new_guide / guide) if guide > 0 else 0.0
        cost_g = GUIDANCE_BASE_CONF + GUIDANCE_CONF * short * (0.5 + 0.5 * n / 12.0) if new_guide < guide else 0.0
    out = {"year": y + 1, "months_done": n, "allowed": not reasons, "reasons": reasons,
           "guidance_bbl": guide, "original_guidance_bbl": orig["guidance_bbl"], "new_guidance_bbl": new_guide,
           "revise_guidance": bool(revise_guidance), "guidance_confidence": -cost_g,
           "approved_usd": appr, "original_approved_usd": orig["approved_usd"], "budget_usd": want, "board_limit_usd": limit,
           "budget_confidence": -cost_b, "confidence_change": -(cost_b + cost_g),
           "planned_capex_year_usd": spent + sum(ev["forecast"]["capex_usd"][:m1 - m0]),
           "guidance_revised_this_quarter": revised_q == quarter}
    if not apply or reasons:
        return out
    b = state["board"]
    b["confidence"] = max(0.0, b["confidence"] - cost_b - cost_g)
    b["approved"][str(y)] = want
    if revise_guidance:
        b["guidance"][str(y)] = new_guide
        fc = list(b["forecast"].get(str(y)) or [0.0] * 12)
        b["forecast"][str(y)] = fc[:n] + rest
        b.setdefault("revised_month", {})[str(y)] = state["month"]
        b.setdefault("revised_quarter", {})[str(y)] = quarter
    plan = dict(plan, budget_request={**plan["budget_request"], y: want})
    state["plan"] = plan
    b.setdefault("revisions", []).append({k: out[k] for k in ("year", "months_done", "guidance_bbl", "new_guidance_bbl", "revise_guidance",
                                                              "approved_usd", "budget_usd", "confidence_change")} | {"month": state["month"]})
    parts = ["Plan revised."]
    if want != appr:
        parts.append(f"Budget ${appr / 1e6:.1f} MM to ${want / 1e6:.1f} MM.")
    if revise_guidance:
        parts.append(f"Guidance {guide / 1e3:,.0f} to {new_guide / 1e3:,.0f} kbbl.")
    if cost_b + cost_g:
        parts.append(f"Board confidence {-(cost_b + cost_g):+.1f}.")
    inbox(state, "board", f"Year {y + 1} plan revised", " ".join(parts), out)
    return out


def diagnostics(state, truth, truth_sim):
    """Actual against forecast for every well you have drilled that has produced a full month: the pad report card's
    split per well, a unity plot and outliers. Forecast = the plan's type curve and percentile for the well's pad at
    lock (with any geology factor), on the well's real online day."""
    now = state["month"]
    rows = []
    for w in state["wells"]:
        p = state["locked"].get(w["pad"]) or {}
        h = w.get("oil_hist")
        if not p.get("belief_well_oil") or not h or not h["oil"]:
            continue
        fc_cal = schedule.place(p["belief_well_oil"], w["online_day"], now)
        v = steergame.well_volumes(truth_sim, rock_of(truth, w["section"]), p["design"], w["wells_per_section"], {"0.0": w["stages"]})
        ex_cal = schedule.place(v["oil"], w["online_day"], now)
        m0 = h["from_month"]
        act = h["oil"]
        fc = [round(x, 1) for x in fc_cal[m0:m0 + len(act)]]
        A, F, E = sum(act), sum(fc), sum(ex_cal[m0:m0 + len(act)])
        rows.append({"id": w["id"], "pad": w["pad"], "section": w["section"], "months": len(act), "from_month": m0,
                     "actual_oil_bbl": round(A), "forecast_oil_bbl": round(F), "ratio": round(A / F, 3) if F > 0 else None,
                     "split": {"type_curve_vs_rock_bbl": round(E - F), "execution_bbl": round(A - E)},
                     "in_zone_pct": (w.get("steer") or {}).get("in_zone_pct"),
                     "monthly": {"actual_oil_bbl": act, "forecast_oil_bbl": fc}})
    rs = sorted(r["ratio"] for r in rows if r["ratio"])
    q = (lambda f: rs[min(len(rs) - 1, int(f * len(rs)))]) if rs else (lambda f: None)
    lr = [math.log(r) for r in rs]
    mu = sum(lr) / len(lr) if lr else 0.0
    sd = (sum((x - mu) ** 2 for x in lr) / max(1, len(lr) - 1)) ** 0.5 if len(lr) > 1 else 0.0
    out_ids = [r["id"] for r in rows if r["ratio"] and (abs(math.log(r["ratio"]) - mu) > 2 * sd if sd > 0 else False)
               or (r["ratio"] and not 0.7 <= r["ratio"] <= 1.3)]
    tot_tc = sum(r["split"]["type_curve_vs_rock_bbl"] for r in rows)
    tot_ex = sum(r["split"]["execution_bbl"] for r in rows)
    return {"wells": rows,
            "summary": {"wells": len(rows), "actual_oil_bbl": sum(r["actual_oil_bbl"] for r in rows),
                        "forecast_oil_bbl": sum(r["forecast_oil_bbl"] for r in rows), "ratio_p10": q(0.9), "ratio_p50": q(0.5), "ratio_p90": q(0.1),
                        "type_curve_vs_rock_bbl": tot_tc, "execution_bbl": tot_ex,
                        "bigger_gap": "type curve" if abs(tot_tc) >= abs(tot_ex) else "execution", "outliers": out_ids},
            "notes": ["Forecast: the plan's type curve and percentile for the well's pad when it locked (geology factor included), "
                      "placed on the well's real online day. P10/P90 ratios: 10 % of wells did better than ratio_p10.",
                      "Type curve vs rock: the simulator's expectation for the well's design in its section (in pay, average "
                      "well luck) minus the forecast. Execution: everything else (steering, completion and flowback results, "
                      "frac hits, lift, well-to-well luck).",
                      "Outliers: ratio outside 0.7-1.3, or more than two standard deviations (in log ratio) from the rest."]}


PAD_REPORT_MONTHS = 3


def pad_reports(state, truth, truth_sim):
    """Once every well on a pad has produced PAD_REPORT_MONTHS months: actual oil against the plan's forecast, split
    into the type curve's miss on this rock (simulator expectation for the pad's design, no well luck) and execution
    (steering, completion and flowback results, frac hits, lift, well-to-well luck)."""
    now = state["month"]
    for p in state["locked"].values():
        if p.get("reported") or not p.get("belief_well_oil"):
            continue
        ws = [w for w in state["wells"] if w["pad"] == p["id"]]
        if not ws or now * MD - max(w["online_day"] for w in ws) < PAD_REPORT_MONTHS * MD:
            continue
        p["reported"] = True
        actual = sum(w.get("cum_oil", 0.0) for w in ws)
        forecast = sum(sum(schedule.place(p["belief_well_oil"], w["online_day"], now)) for w in ws)
        exp = 0.0
        for w in ws:
            v = steergame.well_volumes(truth_sim, rock_of(truth, w["section"]), p["design"], w["wells_per_section"], {"0.0": w["stages"]})
            exp += sum(schedule.place(v["oil"], w["online_day"], now))
        months = int(now - min(w["online_day"] for w in ws) / MD)      # full months since the first well came on
        ratio = actual / forecast if forecast > 0 else None
        data = {"kind": "pad_report", "pad": p["id"], "section": p["section"], "wells": [w["id"] for w in ws], "months": months,
                "actual_oil_bbl": round(actual), "forecast_oil_bbl": round(forecast), "ratio": None if ratio is None else round(ratio, 3),
                "gap_bbl": round(actual - forecast),
                "split": {"type_curve_vs_rock_bbl": round(exp - forecast), "execution_bbl": round(actual - exp)},
                "split_note": "Type curve vs rock: the simulator's expectation for this pad's design in this section, landed in pay "
                              "with average well luck, minus your forecast. Execution: everything else (steering, the frac and "
                              "flowback you or staff ran, frac hits, lift, and well-to-well luck)."}
        tc_part, ex_part = exp - forecast, actual - exp
        bigger = "your type curve" if abs(tc_part) >= abs(ex_part) else "execution"
        inbox(state, "operations", f"Pad {p['id']} report card: {100 * ratio:.0f} % of forecast" if ratio else f"Pad {p['id']} report card",
              f"{len(ws)} wells, {months:.0f} months: {actual / 1e3:,.1f} kbbl against {forecast / 1e3:,.1f} kbbl forecast. "
              f"Type curve vs rock {tc_part / 1e3:+,.1f} kbbl; execution {ex_part / 1e3:+,.1f} kbbl. Most of the gap: {bigger}.", data)


def year_review(state, y, truth=None, truth_sim=None):
    h = state["history"]
    idx = [i for i, m in enumerate(h["month"]) if 12 * y <= m < 12 * (y + 1)]
    oil = sum(h["oil"][i] for i in idx)
    capex = sum(h["capex_usd"][i] for i in idx)
    guide = state["board"]["guidance"].get(str(y), 0.0)
    appr = state["board"]["approved"].get(str(y), 0.0)
    orig = state["board"].get("original", {}).get(str(y)) or {}
    r, c, parts = review_parts(oil, guide, capex, appr, orig.get("guidance_bbl"), orig.get("approved_usd"))
    res_rec = None
    if truth is not None:                       # year-end reserves: replacement, revisions, audit
        import reserves
        if (state.get("reserves") or {}).get("books"):
            rparts, res_rec = reserves.year_end(state, truth, truth_sim, y)
            parts.update(rparts)
        else:                                   # a career from before reserves: book an opening now, score from next year
            reserves.opening(state, truth, truth_sim)
    d = sum(parts.values())
    state["board"]["confidence"] = max(0.0, min(100.0, state["board"]["confidence"] + d))
    fcf = sum(h["op_cash_usd"][i] - h["capex_usd"][i] for i in idx)
    payout = SHAREHOLDER_RETURN * max(0.0, fcf)
    state["cash_usd"] -= payout
    state.setdefault("shareholder_returns_usd", 0.0)
    state["shareholder_returns_usd"] += payout
    rev = {"year": y + 1, "oil_bbl": oil, "free_cash_flow_usd": fcf, "shareholder_return_usd": payout, "guidance_bbl": guide, "capex_usd": capex, "approved_usd": appr,
           "production_ratio": r, "capex_ratio": c, "confidence_change": d, "parts": parts, "confidence": state["board"]["confidence"]}
    if res_rec:
        rev["reserves"] = {k: res_rec.get(k) for k in ("proved_bbl", "pdp_bbl", "pdnp_bbl", "pud_bbl", "reserve_replacement",
                                                       "audit_developed_bbl", "audit_over_pct", "roll_forward")}
    state["board"]["reviews"].append(rev)
    inbox(state, "board", f"Year {y + 1} review",
          f"Oil {oil / 1e3:.0f} kbbl against guidance {guide / 1e3:.0f} kbbl ({100 * r:.0f} %). Capex ${capex / 1e6:.1f} MM against "
          f"${appr / 1e6:.1f} MM approved ({100 * c:.0f} %). Board confidence {d:+.0f} to {state['board']['confidence']:.0f}. "
          f"Free cash flow ${fcf / 1e6:.1f} MM; ${payout / 1e6:.1f} MM returned to shareholders.", rev)


# ---- the clock --------------------------------------------------------------------------------------
STOP_ON = {  # inbox messages that stop a run-until-event advance, by reason
    "task_new": lambda m: m["kind"] == "task" and (m.get("data") or {}).get("session") and not m["title"].endswith(" done"),
    "pad_online": lambda m: m["kind"] == "operations" and m["title"].startswith("Pad ") and " online: " in m["title"],
    "pad_report": lambda m: (m.get("data") or {}).get("kind") == "pad_report",
    "battery_full": lambda m: m["title"].startswith("Battery full"),
    "cost_overrun": lambda m: m["title"].startswith("Supplemental AFE"),
    "board": lambda m: m["kind"] == "board",
    "budget_hold": lambda m: m["title"].endswith("held for budget") or m["title"].endswith("cannot be scheduled"),
}


def _blocker(state, t1):
    """Why time cannot pass t1 (a hard stop), or None."""
    y = state["month"] // 12
    if str(y) not in state["board"]["approved"]:
        return {"reason": "budget_needed", "message": f"year {y + 1} needs a board-approved budget before time can advance"}
    if state["plan"] is None:
        return {"reason": "no_plan", "message": "no approved plan"}
    pending = [w["id"] for w in state["wells"] if not w.get("steer", {}).get("finished", True) and w.get("spud_day", 0.0) < t1]
    if pending:
        return {"reason": "steer", "wells": pending, "message": "steer these wells before time can pass their spud: " + ", ".join(pending)}
    tasks = career_tasks.blocking_pending(state, t1)
    if tasks:
        return {"reason": "task_blocking", "tasks": [t["id"] for t in tasks],
                "message": "finish these tasks before time can pass them: "
                           + "; ".join(f"{t['label']} (task {t['id']}, due month {t['due_month']:.1f})" for t in tasks)}
    return None


def advance(state, truth, truth_sim, months=1, until_event=False):
    """Run months on truth. Plain mode raises on a hard stop. until_event mode runs up to `months` months and returns
    early, without error, at a hard stop, before an optional task lapses (once per task), or after a month that
    produced a stop-worthy message. Returns {"months": [...], "stop": {...} or None}."""
    if state["status"] != "active":
        raise CareerError(f"career is {state['status']}")
    done, stop = [], None
    for _ in range(int(months)):
        t1 = (state["month"] + 1) * MD
        b = _blocker(state, t1)
        if b:
            if not until_event:
                raise CareerError(b["message"])
            stop = b
            break
        if until_event:
            lapsing = [t for t in state.get("tasks", []) if t["status"] == "open" and not t["blocking"]
                       and t["due_day"] is not None and t["due_day"] <= t1 and not t.get("warned")]
            if lapsing:
                for t in lapsing:
                    t["warned"] = True
                stop = {"reason": "task_due", "tasks": [t["id"] for t in lapsing],
                        "message": "these optional jobs lapse this month (staff take the standard outcome) unless you play them: "
                                   + "; ".join(t["label"] for t in lapsing)}
                break
        before = len(state["inbox"])
        step_month(state, truth, truth_sim)
        done.append(state["month"])
        if state["status"] != "active":
            stop = {"reason": state["status"], "message": f"career {state['status']}"}
            break
        if until_event:
            new = state["inbox"][before:]
            reasons = [k for k, f in STOP_ON.items() if any(f(m) for m in new)]
            pr = projection(state)
            key = f"warn|{state['month'] // 12}"
            if pr and pr["confidence_after"] < SACK_BELOW + 10 and key not in state.setdefault("notified", []):
                state["notified"].append(key)
                reasons.append("budget_warning")
            if reasons:
                stop = {"reason": reasons[0], "reasons": reasons, "message": "; ".join(m["title"] for m in new if m["kind"] != "report")
                        or "the board is on track to cut your confidence close to the sack line"}
                break
    return {"months": done, "stop": stop}


def step_month(state, truth, truth_sim):
    plan = state["plan"]
    m = state["month"]
    t0, t1 = m * MD, (m + 1) * MD
    # 1. execute the schedule on truth; pads that start this month are locked with their actual timings and costs
    ctx = mgbase.Ctx(getattr(truth_sim, "worker", None), truth_sim)
    run = lambda: schedule.run(with_delays(state, plan["pads"]), plan["rigs"], plan["crews"], truth_well_plan(state, plan["design"]),
                               budget=budgets(state, plan, use_request=False), start_day=t0, locked=locked_for_schedule(state))
    res = run()
    if fix_delays(state, res):
        res = run()
    est = opecon.well_estimate(plan["design"])
    for p in res["pads"]:
        if p["id"] in state["locked"] or p["pad_build_start"] >= t1:
            continue
        p["design"] = plan["design"]
        p["afe_usd"] = opecon.COSTS["pad_usd"] + est["total_usd"] * len(p["wells"])
        p["actual_usd"] = sum(e[1] for e in p["capex_events"])
        p["belief_well_oil"] = belief_well_oil(state, plan, p["id"])
        state["locked"][p["id"]] = p
        dly, why = pad_delay(state["seed"], p["id"])
        if dly:
            inbox(state, "operations", f"Pad {p['id']} started {dly:.0f} days late", f"Cause: {why}. Its wells come on later than planned.",
                  {"pad": p["id"], "delay_days": dly, "cause": why})
        for w in p["wells"]:
            r = field.rng_for(state["seed"], "well", p["id"], w["index"])
            wid = f"{p['id']}-{w['index'] + 1:02d}"
            mode = next((q.get("steer", "staff") for q in plan["pads"] if q["id"] == p["id"]), "staff")
            auto = bool(state.get("autopilot"))                 # the staff benchmark runs in memory: no files
            prof = geo = None
            if truth.get("structure") and getattr(truth_sim, "worker", None) is not None:   # the field's true structure
                import geodesk
                sec = next(s for s in state["sections"] if s["section"] == p["section"])
                g = geodesk.slot((sec["col"], sec["row"]), w["index"], len(p["wells"]), opecon.LATERAL_FT)
                prof = truth["structure"]["profiles"].get(wid) or lateral_profile(truth, truth_sim.worker, g["x_ft"], g["y_ft"],
                                                                                   g["azimuth_deg"], opecon.LATERAL_FT)
                truth["structure"]["profiles"][wid] = prof
                geo = {"heel_x_ft": g["x_ft"], "heel_y_ft": g["y_ft"], "azimuth_deg": g["azimuth_deg"]}
            rk = rock_of(truth, p["section"])
            pay, prof_s = rk["thickness_ft"], prof
            if prof and "net_ft" in rk:                      # steer the clean net bench, not the whole gross
                off, pay = field.bench(truth["seed"], rk["thickness_ft"], rk["net_ft"])
                prof_s = dict(prof, top_tvd=[t + off for t in prof["top_tvd"]])
                geo = dict(geo, gross_top_offset_ft=off, gross_ft=rk["thickness_ft"])
            ss = steer.new_session(seed=f"{state['seed']}|{wid}", pay_ft=pay,
                                   lateral_ft=opecon.LATERAL_FT, link={"career": state["id"], "well": wid}, design=plan["design"],
                                   persist=not auto, profile=prof_s, geo=geo)
            wrec = {"id": wid, "pad": p["id"], "section": p["section"],
                    "lateral_ft": opecon.LATERAL_FT, "stages": est["stages"], "design": plan["design"],
                    "wells_per_section": len(p["wells"]), "online_day": w["online"], "spud_day": w["spud"],
                    "well_factor": math.exp(r.gauss(0, 0.12)), "noise_seed": r.randint(0, 10 ** 9),
                    "steer": {"mode": mode, "session": ss["id"], "finished": False}}
            if mode == "staff":
                steer.auto_steer(ss, steergame.STAFF_RATING)
                sres = steergame.finish_career_well(ss)
                if not auto:
                    steer.save(ss)
                wrec["steer"].update(finished=True, in_zone_pct=sres["in_zone_pct"], bucket_counts=sres["bucket_counts"])
            state["wells"].append(wrec)
        manual = [w["id"] for w in state["wells"] if w["pad"] == p["id"] and w.get("steer", {}).get("mode") == "manual"]
        if manual:
            inbox(state, "operations", f"Pad {p['id']}: geosteering is yours",
                  f"You took over steering for {', '.join(manual)}. Time stops before each spud until you have drilled it.",
                  {"pad": p["id"], "wells": manual,
                   "sessions": {w["id"]: w["steer"]["session"] for w in state["wells"] if w["id"] in manual}})
        inbox(state, "operations", f"Rig {p['rig'] + 1} started pad {p['id']}",
              f"{len(p['wells'])} wells; online expected month {p['online'] / MD:.1f}. AFE ${p['afe_usd'] / 1e6:.1f} MM.",
              {"pad": p["id"], "wells": [w["id"] for w in state["wells"] if w["pad"] == p["id"]], "rig": p["rig"],
               "online_month": round(p["online"] / MD, 2), "afe_usd": p["afe_usd"]})
        career_tasks.on_lock(state, truth, p, next((q for q in plan["pads"] if q["id"] == p["id"]), {}), ctx)
        over = p["actual_usd"] / p["afe_usd"] - 1.0
        if over > 0.10:
            inbox(state, "finance", f"Supplemental AFE: pad {p['id']}",
                  f"Actual cost ${p['actual_usd'] / 1e6:.1f} MM is {100 * over:.0f} % over the ${p['afe_usd'] / 1e6:.1f} MM AFE "
                  f"(non-productive time, screen-outs or service prices). A supplemental AFE was raised.",
                  {"pad": p["id"], "afe_usd": p["afe_usd"], "actual_usd": p["actual_usd"]})
            state["board"]["confidence"] = max(0.0, state["board"]["confidence"] - 2.0)
    seen = state.setdefault("notified", [])
    for d in res["delays"]:
        key = f"delay|{d['pad']}|{int(d['to_day'])}"
        if key not in seen and d["from_day"] < t1 + 400:
            seen.append(key)
            inbox(state, "finance", f"Pad {d['pad']} held for budget", d["reason"] + f". Earliest start now month {d['to_day'] / MD:.1f}.",
                  {"pad": d["pad"], "earliest_start_month": round(d["to_day"] / MD, 2)})
    for pid in res.get("unscheduled", []):
        key = f"unsched|{pid}|{m // 12}"
        if key not in seen:
            seen.append(key)
            inbox(state, "finance", f"Pad {pid} cannot be scheduled", "It does not fit any approved budget year.", {"pad": pid})
    # 2. this month's capex from locked pads
    capex = sum(e[1] for p in state["locked"].values() for e in p["capex_events"] if t0 <= e[0] < t1)
    capex += sum(e[1] for p in state["locked"].values() for e in p["capex_events"] if e[0] < 0 and m == 0)
    due = [c for c in state.get("costs_pending", []) if c["day"] < t1]            # task outcomes: kicks, pump jobs, batteries
    capex += sum(c["usd"] for c in due)
    state["costs_pending"] = [c for c in state.get("costs_pending", []) if c["day"] >= t1]
    # 3. production on truth: inherited wells and online player wells
    oil = gas = water = 0.0
    producing = 0
    for a in truth["analogs"]:
        k = m - a["online_month"]
        c = analog_truth_curve(truth, a, truth_sim)
        if 0 <= k < len(c["oil"]):
            f = 1.0
            for mm in a.get("multipliers", []):                  # frac hits on inherited wells
                f *= _mult(mm, m)
            oil += c["oil"][k] * f; gas += c["gas"][k] * f; water += c["water"][k] * f; producing += 1
    own_oil = own_gas = own_water = 0.0
    month_oil = {}
    online_now = {}
    for w in state["wells"]:
        if w["online_day"] >= t1:
            continue
        c = player_well_truth_curve(truth, w, truth_sim)
        mult = 1.0
        for mm in w.get("multipliers", []):
            mult *= _mult(mm, m)
        if mult != 1.0:
            c = {ph: [x * mult for x in c[ph]] for ph in c}
        placed_from = w["online_day"] / MD
        k = m - math.floor(placed_from)
        frac = 1.0 - (placed_from - math.floor(placed_from))
        vol = lambda ph: (c[ph][k] * frac if k < len(c[ph]) else 0.0) + (c[ph][k - 1] * (1 - frac) if k >= 1 and k - 1 < len(c[ph]) else 0.0)
        month_oil[w["id"]] = vol("oil")
        own_oil += vol("oil"); own_gas += vol("gas"); own_water += vol("water"); producing += 1
        if 0 == k:
            online_now.setdefault(w["pad"], []).append(w["id"])
    for pid, ids in online_now.items():
        n = sum(1 for w in state["wells"] if w["pad"] == pid)
        inbox(state, "operations", f"Pad {pid} online: {len(ids)} well{'s' if len(ids) > 1 else ''}" + (f" of {n}" if len(ids) < n else ""),
              f"{', '.join(ids)} producing.", {"pad": pid, "wells": ids})
    cap = state.get("oil_cap_bbl_d")
    if cap and own_oil > cap * MD:                                   # battery limit: new wells are curtailed pro rata
        f = cap * MD / own_oil
        inbox(state, "operations", f"Battery full in month {m + 1}", f"New wells curtailed to {100 * f:.0f} % by the {cap:,.0f} bbl/d limit.")
        own_oil, own_gas, own_water = own_oil * f, own_gas * f, own_water * f
        month_oil = {k: v * f for k, v in month_oil.items()}
    for w in state["wells"]:
        if w["id"] in month_oil:
            w["cum_oil"] = w.get("cum_oil", 0.0) + month_oil[w["id"]]
            h = w.setdefault("oil_hist", {"from_month": m, "oil": []})        # calendar months, from the first producing one
            h["oil"].append(round(month_oil[w["id"]], 1))
    oil += own_oil; gas += own_gas; water += own_water
    wti = career_tasks.price_at(state, truth, m)
    deck = dict(opecon.PRICE_DECK, oil_usd_bbl=wti)
    op = opecon.net_cash(oil, gas, water, producing, deck=deck)["net_usd"]
    hedge = career_tasks.hedge_settlement(state, m, wti)
    op += hedge
    for key in ("wti_usd_bbl", "hedge_usd"):
        arr = state["history"].setdefault(key, [])
        arr.extend([None] * (len(state["history"]["month"]) - len(arr)))     # older careers: pad to line up with month[]
    state["history"]["wti_usd_bbl"].append(wti)
    state["history"]["hedge_usd"].append(hedge)
    state["cash_usd"] += op - capex
    h = state["history"]
    y = m // 12
    fc = state["board"]["forecast"].get(str(y))
    for k, v in (("month", m), ("oil", oil), ("gas", gas), ("water", water), ("op_cash_usd", op), ("capex_usd", capex),
                 ("cash_usd", state["cash_usd"]), ("oil_forecast", fc[m - 12 * y] if fc else None)):
        h[k].append(v)
    state["month"] = m + 1
    if fc:
        inbox(state, "report", f"Month {m + 1} report",
              f"Oil {oil:,.0f} bbl against {fc[m - 12 * y]:,.0f} forecast; capex ${capex / 1e6:.2f} MM; cash ${state['cash_usd'] / 1e6:.1f} MM.")
    career_tasks.expire(state, t1, truth)
    career_tasks.on_month(state, truth, ctx)
    pad_reports(state, truth, truth_sim)
    # 4. year end, solvency, career end
    if state["month"] % 12 == 0:
        year_review(state, y, truth, truth_sim)
    if state["cash_usd"] < -state["credit_line_usd"]:
        state["status"] = "sacked"
        inbox(state, "board", "Credit line breached", "Cash fell below the credit line. The board has replaced you.")
        final_score(state, truth, truth_sim)
    elif state["board"]["confidence"] < SACK_BELOW:
        state["status"] = "sacked"
        inbox(state, "board", "You have been relieved", f"Board confidence fell to {state['board']['confidence']:.0f}.")
        final_score(state, truth, truth_sim)
    elif state["month"] >= CAREER_MONTHS:
        state["status"] = "finished"
        final_score(state, truth, truth_sim)


def value_by_year(state):
    """Realised PV10 (operating cash less capex, discounted to the career start) for each career year so far."""
    rate = opecon.TERMS["discount_rate"]
    h = state["history"]
    out = {}
    for m, o, c in zip(h["month"], h["op_cash_usd"], h["capex_usd"]):
        out[m // 12] = out.get(m // 12, 0.0) + (o - c) * opecon.disc_factor(m, rate)
    return [{"year": y + 1, "realised_pv10_usd": v} for y, v in sorted(out.items())]


def final_score(state, truth, truth_sim):
    """Value created: discounted cash over the career plus PV10 of every well's remaining truth production."""
    rate = opecon.TERMS["discount_rate"]
    h = state["history"]
    realised = sum((o - c) * opecon.disc_factor(m, rate) for m, o, c in zip(h["month"], h["op_cash_usd"], h["capex_usd"]))
    m0 = state["month"]
    rem = [0.0] * (field.HORIZON - m0)
    gas = [0.0] * len(rem)
    wells = [0] * len(rem)
    for a in truth["analogs"]:
        c = analog_truth_curve(truth, a, truth_sim)
        for i in range(len(rem)):
            k = m0 + i - a["online_month"]
            if 0 <= k < len(c["oil"]):
                rem[i] += c["oil"][k]; gas[i] += c["gas"][k]; wells[i] += 1
    for w in state["wells"]:
        c = player_well_truth_curve(truth, w, truth_sim)
        for i in range(len(rem)):
            k = m0 + i - round(w["online_day"] / MD)
            if 0 <= k < len(c["oil"]):
                rem[i] += c["oil"][k]; gas[i] += c["gas"][k]; wells[i] += 1
    remaining = sum(opecon.net_cash(o, g, 0.0, n)["net_usd"] * opecon.disc_factor(m0 + i, rate) for i, (o, g, n) in enumerate(zip(rem, gas, wells)))
    state["score"] = {"realised_pv10_usd": realised, "remaining_pv10_usd": remaining, "value_usd": realised + remaining,
                      "confidence": state["board"]["confidence"], "status": state["status"], "months": state["month"],
                      "by_year": value_by_year(state)}
    inbox(state, "board", "Career complete" if state["status"] == "finished" else "Career over: final value",
          f"Value created ${(realised + remaining) / 1e6:.1f} MM (cash so far ${realised / 1e6:.1f} MM + remaining wells ${remaining / 1e6:.1f} MM, PV10).")


def well_field(state, truth, well_id):
    """Pressure field of the simulated repeating stage behind a well, cut to the months the player has seen.
    All wells on a pad (and inherited wells sharing section, design and spacing) share one field."""
    a = next((a for a in truth["analogs"] if a["id"] == well_id), None)
    if a is not None:
        spec = field.spec_for(rock_of(truth, a["section"]), a["design"], a["wells_per_section"])
        produced = state["month"] - a["online_month"]
        stages = max(1, round(a["lateral_ft"] / a["design"]["stage_spacing_ft"]))
        lateral = a["lateral_ft"]
    else:
        w = next((w for w in state["wells"] if w["id"] == well_id), None)
        if w is None:
            raise CareerError("unknown well")
        spec = field.spec_for(rock_of(truth, w["section"]), w["design"], w["wells_per_section"])
        produced = (state["month"] * MD - w["online_day"]) / MD
        stages, lateral = w["stages"], w["lateral_ft"]
    if produced < 0:
        raise CareerError("well not online yet")
    f = field.CACHE / field.TruthSim.key(spec) / "field.json"
    if not f.exists():
        raise CareerError("no field for this well")
    d = json.loads(f.read_text())
    keep = [i for i, m in enumerate(d["months"]) if m <= produced + 1e-9]
    d["months"] = [d["months"][i] for i in keep]
    d["pressure_psi"] = [d["pressure_psi"][i] for i in keep]
    if "sg" in d:
        d["sg"] = [d["sg"][i] for i in keep]
    d.update({"well": well_id, "unit": "one repeating stage", "stages": stages, "lateral_ft": lateral,
              "stage_spacing_ft": spec["spacing_ft"], "well_spacing_ft": spec["width_ft"],
              "note": "One fracture's share of the well: x spans one stage spacing, y spans the gap to the neighbouring wells "
                      "(no-flow at half the well spacing). Tile it along the lateral and across the pad."})
    return d


# ---- what the browser sees ------------------------------------------------------------------------
def view(state):
    s = {k: v for k, v in state.items() if k not in ("seed", "locked", "wells")}
    s["pads_started"] = [{"pad": p["id"], "section": p["section"], "wells": len(p["wells"]), "well_spacing_ft": field.SECTION_FT / len(p["wells"]),
                          "rig": p["rig"], "drill_start_month": round(p["drill_start"] / MD, 2), "online_month": round(p["online"] / MD, 2),
                          "afe_usd": p["afe_usd"], "actual_usd": p["actual_usd"]} for p in state["locked"].values()]
    s["wells"] = [{k: w[k] for k in ("id", "pad", "section", "lateral_ft", "stages", "design", "wells_per_section")} |
                  {"online_month": round(w["online_day"] / MD, 2), "spud_month": round(w.get("spud_day", 0.0) / MD, 2),
                   "steer": {k: v for k, v in (w.get("steer") or {}).items() if k != "bucket_counts"}} for w in state["wells"]]
    s["steer_pending"] = [w["id"] for w in state["wells"] if w.get("steer") and not w["steer"]["finished"]]
    s["tasks"] = [career_tasks.task_view(t) for t in state.get("tasks", [])]
    s["projection"] = projection(state) if state["status"] == "active" else None
    import benchmark                         # the staff run on the same field (computed in the background)
    bm = benchmark.load(state["id"]) if not state.get("autopilot") else None
    if bm and state["status"] == "active":
        done = len(state["board"]["reviews"])
        s["benchmark"] = {"status": "ready", "note": "shown when the career ends; staff reviews only up to yours",
                          "reviews_so_far": [{k: r[k] for k in ("year", "confidence", "production_ratio")} for r in bm.get("reviews", [])[:done]]}
    else:
        s["benchmark"] = bm or {"status": "computing" if not benchmark.path(state["id"]).with_suffix(".err").exists() else "failed"}
    s["board"] = dict(s["board"], start_confidence=START_CONFIDENCE)
    if state.get("score") and bm:
        s["score"] = dict(state["score"], benchmark=bm, **benchmark.grade(state["score"]["value_usd"], bm["value_usd"]))
    s["sack_below"] = SACK_BELOW
    import reserves
    s["reserves"] = reserves.view(state)
    s["geology"] = {"sections": state.get("geology", []), "noise": field.MAP_NOISE,
                    "note": "The geologist's map: estimates from logs, cores and seismic, scattered around the true rock "
                            "(thickness about ±8 %, permeability about ±30 %, porosity ±0.006)."}
    s["oil_cap_bbl_d"] = state.get("oil_cap_bbl_d")
    s["hedge_books"] = state.get("hedge_books", [])
    s["capital_limit_usd"] = capital_limit(state)
    s["year"] = state["month"] // 12 + 1
    s["budget_needed"] = state["status"] == "active" and str(state["month"] // 12) not in state["board"]["approved"]
    s["career_months"] = CAREER_MONTHS
    s["units"] = opecon.UNITS
    s["limits"] = {"design": DESIGN_RANGES, **LIMITS}
    s["section_ft"] = field.SECTION_FT
    s["reservoir"] = {"top_ft": 9000.0, "thickness_ft": 100.0, "tvd_ft": 9050.0,   # top is what every run uses (FracWellSpec top_ft)
                      "note": "Top depth is exact. Thickness varies by section (about 60-150 ft) and is part of the hidden rock; "
                              "100 ft is the field's nominal value and the well is landed mid-zone."}
    s["lateral_ft"] = opecon.LATERAL_FT
    return s
