"""The geology desk: well data the player can map from, their saved interpretations (belief), and the staff
auto-interpretation the benchmark uses.

Where mapping control comes from, as in real fields:
- Legacy vertical wells (15-40 per field, irregular, some clustered, some sections with none) that crossed the pay on the
  way to deeper targets. Their vintage decides the curves: before 1970 an electric log (SP and resistivity); 1970-89 gamma
  ray, resistivity and sonic or density; from 1990 gamma ray, density, neutron, deep resistivity and sometimes Pe. Some are
  scout tickets with tops only. Old tools read on their own scale, and a few logs are off depth by several feet.
- Horizontal wells (inherited and yours) have only MWD gamma ray along the lateral (your geosteering data for your own).
Truth is uniform per section (the simulator runs take one rock per section): thickness, porosity, permeability. No log
measures permeability; productivity has to come from production. Structure is flat (top of pay 9,000 ft TVD) with no
faults in this model.
"""
import math
import re

import field
import opecon

TOP_TVD = 9000.0
STEP_FT = 2.0
MARGIN_FT = 60.0
ARCHIE = {"rw": 0.05, "m": 2.0, "n": 2.0}
MATRIX = {"rhob_ma": 2.65, "rhob_fl": 1.0, "rhob_shale": 2.55, "dt_ma": 55.5, "dt_fl": 189.0, "dt_shale": 95.0, "nphi_shale": 0.32}
GR = {"pay": 45.0, "shale": 110.0, "noise": 6.0}
GR_CUTOFF = 77.5
SP_CUTOFF_MV = -20.0
SW_PAY = 0.25
ATTRIBUTES = ("gross_ft", "net_ft", "phi", "sw", "hcpv")      # what the logs support; saved models may add their own
ATTR_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
MAX_GEOMODELS = 12
MAX_STORED_BYTES = 2_000_000
STATUSES = ("p&a", "deeper producer", "swd", "dry hole")
NOTE = ("Legacy vertical wells carry the logs (the curves depend on vintage; some are tops only; old tools read on their own "
        "scale and a few logs are off depth). Horizontal wells have MWD gamma ray along the lateral only. No log measures "
        "permeability: productivity comes from production. Structure is flat (top of pay 9,000 ft TVD) and there are no "
        "faults in this model. Resistivity follows Archie (Rw 0.05, m = n = 2).")


def _rock(truth, section):
    return next(r for r in truth["rock"] if r["section"] == section)


def _section_at(state, x, y):
    c, r = int(x // field.SECTION_FT), int(y // field.SECTION_FT)
    return next((s["section"] for s in state["sections"] if s["col"] == c and s["row"] == r), None)


# ---- legacy vertical wells ------------------------------------------------------------------------------------------
def legacy_wells(state, truth):
    """The field's old vertical wells, deterministic from the seed."""
    r = field.rng_for(truth["seed"], "verticals")
    cols = max(s["col"] for s in state["sections"]) + 1
    rows = max(s["row"] for s in state["sections"] if s["row"] < field.ROWS) + 1
    W, H = cols * field.SECTION_FT, rows * field.SECTION_FT
    n = r.randint(15, 40)
    centres = [(r.uniform(0, W), r.uniform(0, H)) for _ in range(r.randint(2, 4))]
    out = []
    for i in range(n):
        if r.random() < 0.5:                                  # clustered around old discoveries
            cx, cy = r.choice(centres)
            x, y = cx + r.gauss(0, 2500), cy + r.gauss(0, 2500)
        else:
            x, y = r.uniform(0, W), r.uniform(0, H)
        x, y = min(W - 50, max(50, x)), min(H - 50, max(50, y))
        year = r.choice([r.randint(1952, 1969), r.randint(1970, 1989), r.randint(1990, 2018)])
        out.append({"id": f"V{i + 1:02d}", "type": "vertical", "x_ft": round(x), "y_ft": round(y), "section": _section_at(state, x, y),
                    "status": r.choice(STATUSES), "year_drilled": year, "vintage": "pre-1970" if year < 1970 else "1970-89" if year < 1990 else "1990+",
                    "td_tvd_ft": round(TOP_TVD + 300 + r.uniform(200, 3000), -1), "tops_only": r.random() < 0.1,
                    "depth_shift_ft": r.choice([0.0] * 8 + [r.uniform(-10, 10)]), "gr_scale": r.uniform(0.8, 1.2) if year < 1990 else 1.0,
                    "curves": _curves(year, r)})
    return [w for w in out if w["section"]]


def _curves(year, r):
    if year < 1970:
        return ["sp", "rt"] + (["dt"] if r.random() < 0.3 else [])
    if year < 1990:
        return ["gr", "rt", "dt" if r.random() < 0.5 else "rhob"]
    return ["gr", "rhob", "nphi", "rt"] + (["pe"] if r.random() < 0.5 else [])


def _smooth_step(z, edge, width=3.0):
    return 1.0 / (1.0 + math.exp(-(z - edge) / width))


def vertical_log(seed, w, rock, point=None, top_tvd=TOP_TVD):
    """The curves this well has, through the pay and 60 ft either side. With the career's grid, the rock at the well's
    own location (point): gross pay with shale streaks making up gross - net, its porosity and Sw. Otherwise the
    section's uniform rock."""
    r = field.rng_for(seed, "log", w["id"])
    if point:
        h, net, phi_pt, sw0 = point["gross_ft"], point["net_ft"], point["porosity"], point["sw"]
    else:
        h, net, phi_pt, sw0 = rock["thickness_ft"], rock["thickness_ft"], rock["porosity"], min(0.6, max(0.1, SW_PAY + r.gauss(0, 0.03)))
    top, base = top_tvd, top_tvd + h
    streaks = []                                            # shale beds inside the gross pay: net = gross - their thickness
    shale = max(0.0, h - net)
    b_off, b_t = field.bench(seed, h, net) if point else (0.0, 0.0)
    b0, b1 = top + b_off, top + b_off + b_t                 # the clean bench: no streaks there
    if shale > 1.0:
        k = max(1, round(shale / 5.0))
        for _ in range(k):
            for _try in range(20):
                c = r.uniform(top + 3, base - 3)
                a, b = c - shale / (2 * k), c + shale / (2 * k)
                if b < b0 or a > b1:
                    break
            streaks.append((a, b))
    sp_drift = r.uniform(-8, 8)
    log = {"md_ft": [], "tvd_ft": []}
    for c in w["curves"]:
        log[c] = []
    z = top - MARGIN_FT
    while z <= base + MARGIN_FT + 1e-9:
        pay = _smooth_step(z, top) * (1.0 - _smooth_step(z, base))
        for a, b in streaks:
            pay *= 1.0 - _smooth_step(z, a, 1.0) * (1.0 - _smooth_step(z, b, 1.0))
        phi = max(0.005, phi_pt * pay + r.gauss(0, 0.006))
        sw = min(1.0, max(0.05, 1.0 + (sw0 - 1.0) * pay + r.gauss(0, 0.03 * pay)))
        vals = {
            "gr": (GR["shale"] + (GR["pay"] - GR["shale"]) * pay) * w["gr_scale"] + r.gauss(0, GR["noise"]),
            "sp": sp_drift + (-45.0 * pay) + r.gauss(0, 3.0),
            "rt": (ARCHIE["rw"] / (max(phi, 0.01) ** ARCHIE["m"] * sw ** ARCHIE["n"]) * pay + 4.0 * (1 - pay)) * math.exp(r.gauss(0, 0.1)),
            "rhob": (MATRIX["rhob_ma"] - phi * (MATRIX["rhob_ma"] - MATRIX["rhob_fl"])) * pay + MATRIX["rhob_shale"] * (1 - pay) + r.gauss(0, 0.015),
            "nphi": phi * pay + MATRIX["nphi_shale"] * (1 - pay) + r.gauss(0, 0.012),
            "dt": (MATRIX["dt_ma"] + phi * (MATRIX["dt_fl"] - MATRIX["dt_ma"])) * pay + MATRIX["dt_shale"] * (1 - pay) + r.gauss(0, 2.0),
            "pe": 1.8 * pay + 3.2 * (1 - pay) + r.gauss(0, 0.1),
        }
        zz = z + w["depth_shift_ft"]                           # the log as recorded: off depth on a few old wells
        log["md_ft"].append(round(zz, 1))
        log["tvd_ft"].append(round(zz, 1))
        for c in w["curves"]:
            log[c].append(round(vals[c], 4))
        z += STEP_FT
    return log


# ---- horizontals ----------------------------------------------------------------------------------------------------
def slot(section_rc, i, wps, lateral_ft):
    """The well path rule every lateral follows: N-S, heel 300 ft inside the section's north line, slot i of wps across."""
    c, r = section_rc
    x = round(c * field.SECTION_FT + (i + 0.5) * field.SECTION_FT / wps)
    y0 = r * field.SECTION_FT + 300
    return {"x_ft": x, "y_ft": y0, "heel": {"x_ft": x, "y_ft": y0}, "toe": {"x_ft": x, "y_ft": y0 + min(lateral_ft, field.SECTION_FT - 600)},
            "azimuth_deg": 90.0}             # f7's convention: (cos, sin) in the x-east, y-south frame, so 90 = south


def planned(state):
    """Every well on the active plan that has not been drilled yet, on the same slot rule."""
    if not state.get("plan"):
        return []
    pos = {s["section"]: (s["col"], s["row"]) for s in state["sections"]}
    out = []
    for p in state["plan"]["pads"]:
        if p["id"] in state["locked"] or p["section"] not in pos:
            continue
        for i in range(p["wells"]):
            g = slot(pos[p["section"]], i, p["wells"], opecon.LATERAL_FT)
            out.append({"id": f"{p['id']}-{i + 1:02d}", "pad": p["id"], "section": p["section"], "heel": g["heel"], "toe": g["toe"],
                        "azimuth_deg": g["azimuth_deg"], "lateral_ft": opecon.LATERAL_FT})
    return out


def horizontal_rows(state, truth):
    pos = {s["section"]: (s["col"], s["row"]) for s in state["sections"]}
    rows = [(a["id"], a["section"], "inherited", a["wells_per_section"], a["lateral_ft"]) for a in truth["analogs"]]
    now = state["month"] * opecon.MONTH_DAYS
    rows += [(w["id"], w["section"], "you", w["wells_per_section"], w["lateral_ft"]) for w in state["wells"] if w.get("spud_day", 0.0) <= now]
    out = []
    for wid, sec, owner, wps, lat in rows:
        if sec not in pos:
            continue
        try:
            i = int(wid.rsplit("-", 1)[1]) - 1
        except (IndexError, ValueError):
            i = 0
        g = slot(pos[sec], i, wps, lat)
        out.append({"id": wid, "type": "horizontal", "section": sec, "owner": owner, "x_ft": g["x_ft"], "y_ft": g["y_ft"],
                    "heel": g["heel"], "toe": g["toe"], "azimuth_deg": g["azimuth_deg"], "lateral_ft": lat})
    return out


def mwd_log(seed, w, rock, profile=None):
    """MWD gamma ray along the lateral: in the pay most of the way, with excursions near the edges. With the field's
    structure, TVD follows the true top along the well."""
    r = field.rng_for(seed, "mwd", w["id"])
    import steer
    prof = {"md": profile["md"], "mid": profile["top_tvd"]} if profile else None
    h = rock["thickness_ft"]
    log = {"md_ft": [], "tvd_ft": [], "gr": []}
    s = h / 2 + r.gauss(0, h / 8)
    md = 0.0
    while md <= w["lateral_ft"] + 1e-9:
        s = min(h + 15, max(-15, s + r.gauss(0, 1.5)))
        if s < 3 or s > h - 3:
            s += (h / 2 - s) * 0.2                              # the steerer brings it back
        pay = _smooth_step(s, 0.0, 2.0) * (1.0 - _smooth_step(s, h, 2.0))
        log["md_ft"].append(round(9500.0 + md, 1))
        log["tvd_ft"].append(round((steer._interp(prof, md) if prof else TOP_TVD) + s, 2))
        log["gr"].append(round(GR["shale"] + (GR["pay"] - GR["shale"]) * pay + r.gauss(0, GR["noise"]), 2))
        md += 30.0
    return log


def _derived(lg):
    """Petrophysical curves a log analyst would deliver with the raw ones: porosity from density (or sonic), and Sw
    from Archie where resistivity exists. Same matrix and Archie constants as everywhere in the desk."""
    out = {}
    if "rhob" in lg:
        out["phi"] = [round(max(0.0, (MATRIX["rhob_ma"] - v) / (MATRIX["rhob_ma"] - MATRIX["rhob_fl"])), 4) for v in lg["rhob"]]
    elif "dt" in lg:
        out["phi"] = [round(max(0.0, (v - MATRIX["dt_ma"]) / (MATRIX["dt_fl"] - MATRIX["dt_ma"])), 4) for v in lg["dt"]]
    if "phi" in out and "rt" in lg:
        out["sw"] = [round(min(1.0, (ARCHIE["rw"] / (max(p, 0.01) ** ARCHIE["m"] * max(r, 0.01))) ** (1 / ARCHIE["n"])), 4)
                     for p, r in zip(out["phi"], lg["rt"])]
    return out


def _steered_gamma(sid):
    """Your own well's MWD gamma: what was recorded while it was steered, in absolute TVD."""
    if not sid:
        return None
    import steer
    try:
        s = steer.load(sid)
    except Exception:  # noqa: BLE001  sessions of old careers may be gone
        return None
    g = s.get("gamma") or []
    if not g:
        return None
    st = s.get("truth") or {}
    mid0 = st.get("mid0_tvd_abs", TOP_TVD + st.get("pay_ft", 0.0) / 2)
    return {"md_ft": [x["md"] for x in g], "tvd_ft": [round(mid0 + x["tvd"], 2) for x in g], "gr": [x["gamma_api"] for x in g]}


# ---- what the player sees -------------------------------------------------------------------------------------------
def auto_picks(log):
    """The software's auto-pick: the pay between the first and last samples past the gamma-ray (or SP) cutoff."""
    if "gr" in log:
        idx = [i for i, g in enumerate(log["gr"]) if g < GR_CUTOFF]
    elif "sp" in log:
        base = sorted(log["sp"])[len(log["sp"]) * 3 // 4]          # shale baseline
        idx = [i for i, v in enumerate(log["sp"]) if v < base + SP_CUTOFF_MV]
    else:
        return None
    if not idx:
        return None
    return {"top_tvd": log["tvd_ft"][idx[0]], "base_tvd": log["tvd_ft"][idx[-1]] + STEP_FT}


def wells(state, truth):
    seed = truth["seed"]
    out = []
    grid = truth.get("grid")
    for w in legacy_wells(state, truth):
        rock = _rock(truth, w["section"])
        point = field.sample_all(grid, w["x_ft"], w["y_ft"]) if grid else None
        pub = {k: w[k] for k in ("id", "type", "x_ft", "y_ft", "section", "status", "year_drilled", "vintage", "td_tvd_ft")}
        pub["kb_ft"] = 0.0
        top = ((truth.get("structure") or {}).get("vertical_tops") or {}).get(w["id"], TOP_TVD)
        lg = vertical_log(seed, w, rock, point, top)
        if w["tops_only"]:
            p = auto_picks(lg) or {"top_tvd": top, "base_tvd": top + (point or rock)["gross_ft" if point else "thickness_ft"]}
            r = field.rng_for(seed, "scout", w["id"])
            pub.update(curves=[], log=None, tops={"Pay top": round(p["top_tvd"] + r.gauss(0, 3)), "Pay base": round(p["base_tvd"] + r.gauss(0, 3))},
                       picks_auto={"top_tvd": round(p["top_tvd"] + r.gauss(0, 3)), "base_tvd": round(p["base_tvd"] + r.gauss(0, 3))})
        else:
            derived = _derived(lg)
            lg.update(derived)
            pub.update(curves=list(w["curves"]), derived_curves=sorted(derived), log=lg, picks_auto=auto_picks(lg))
        out.append(pub)
    steered = {w["id"]: (w.get("steer") or {}).get("session") for w in state["wells"]}
    for w in horizontal_rows(state, truth):
        lg = _steered_gamma(steered.get(w["id"])) if w["owner"] == "you" else None
        lg = lg or mwd_log(seed, w, _rock(truth, w["section"]), ((truth.get("structure") or {}).get("profiles") or {}).get(w["id"]))
        out.append({**w, "kb_ft": 0.0, "curves": ["gr"], "log": lg, "picks_auto": None})
    return out


def interpret(lg, picks, curves):
    """Attributes from one vertical log and its picks: gross and net thickness, and porosity, Sw, HCPV where the curves allow."""
    top, base = picks["top_tvd"], picks["base_tvd"]
    out = {"gross_ft": base - top}
    if not lg:
        return out
    rows = [i for i, z in enumerate(lg["tvd_ft"]) if top <= z < base]
    if not rows:
        return out
    if "gr" in lg:
        net = [i for i in rows if lg["gr"][i] < GR_CUTOFF]
    else:
        net = rows
    out["net_ft"] = len(net) * STEP_FT
    use = net or rows
    phis = None
    if "rhob" in lg:
        phis = [(MATRIX["rhob_ma"] - lg["rhob"][i]) / (MATRIX["rhob_ma"] - MATRIX["rhob_fl"]) for i in use]
    elif "dt" in lg:
        phis = [(lg["dt"][i] - MATRIX["dt_ma"]) / (MATRIX["dt_fl"] - MATRIX["dt_ma"]) for i in use]
    if phis:
        phi = max(0.001, sum(phis) / len(phis))
        out["phi"] = phi
        if "rt" in lg:
            rt = math.exp(sum(math.log(max(0.01, lg["rt"][i])) for i in use) / len(use))
            out["sw"] = min(1.0, (ARCHIE["rw"] / (phi ** ARCHIE["m"] * rt)) ** (1 / ARCHIE["n"]))
            out["hcpv"] = phi * out["net_ft"] * (1 - out["sw"])
    return out


def auto_geomodel(state, truth):
    """The staff interpretation: auto-picks on every vertical, attributes where the curves allow, then each section's
    centre by inverse distance from the wells that have that attribute."""
    pts = []
    for w in wells(state, truth):
        if w["type"] != "vertical" or not w.get("picks_auto"):
            continue
        pts.append((w["x_ft"], w["y_ft"], interpret(w.get("log"), w["picks_auto"], w.get("curves") or [])))
    out = {}
    for s in state["sections"]:
        cx, cy = (s["col"] + 0.5) * field.SECTION_FT, (s["row"] + 0.5) * field.SECTION_FT
        row = {}
        for a in ATTRIBUTES:
            vals = [(x, y, v[a]) for x, y, v in pts if a in v]
            if not vals:
                continue
            wts = [(1.0 / max(1.0, (x - cx) ** 2 + (y - cy) ** 2), v) for x, y, v in vals]
            row[a] = sum(w * v for w, v in wts) / sum(w for w, _ in wts)
        if row:
            out[s["section"]] = row
    return {"name": "staff auto-map", "sections": out, "created_month": state["month"], "source": "auto-picks on verticals, inverse distance"}


def check_geomodel(state, body):
    import json
    name = str(body.get("name") or "").strip()[:40]
    if not name or name in ("company map", "staff auto-map"):
        raise ValueError("name the interpretation (not 'company map' or 'staff auto-map')")
    secs = body.get("sections")
    if not isinstance(secs, dict) or not secs:
        raise ValueError("sections must map section names to attribute values")
    known = {s["section"] for s in state["sections"]}
    clean = {}
    for sec, vals in secs.items():
        if sec not in known:
            raise ValueError(f"unknown section {sec}")
        if not isinstance(vals, dict):
            raise ValueError(f"section {sec}: values must be an object")
        row = {}
        for a, v in vals.items():
            if not isinstance(a, str) or not ATTR_RE.match(a):
                raise ValueError(f"section {sec}: attribute names are lower-case words (e.g. {', '.join(ATTRIBUTES)})")
            try:
                x = float(v)
            except (TypeError, ValueError):
                raise ValueError(f"section {sec}: {a} must be a number")
            if not math.isfinite(x) or x < 0:
                raise ValueError(f"section {sec}: {a} must be a non-negative number")
            row[a] = x
        clean[sec] = row
    extra = {k: body[k] for k in ("picks", "grids", "faults", "cutoffs") if k in body}
    if len(json.dumps(extra)) > MAX_STORED_BYTES:
        raise ValueError("picks and grids are too large to store (2 MB)")
    gms = state.setdefault("geomodels", {})
    if name not in gms and len(gms) >= MAX_GEOMODELS:
        raise ValueError(f"at most {MAX_GEOMODELS} saved interpretations: overwrite one")
    gms[name] = {"name": name, "sections": clean, "created_month": state["month"], **extra}
    return gms[name]


def faults_known(truth):
    """Faults the field's legacy 2D seismic resolves: throw of 25 ft or more, traces with a few hundred feet of error."""
    out = []
    for i, f in enumerate((truth.get("structure") or {}).get("faults") or []):
        if abs(f["throw_ft"]) < 25:
            continue
        r = field.rng_for(truth["seed"], "seismic", i)
        out.append({"id": f"F{i + 1}", "trace": [[round(x + r.gauss(0, 250)), round(y + r.gauss(0, 250))] for x, y in f["trace"]],
                    "throw_ft": round(abs(f["throw_ft"]) * r.uniform(0.7, 1.3), -1), "source": "seismic",
                    "note": "throw is the largest offset, mid-trace; the sense (which side is down) is not interpreted"})
    return out


def values_for(state, source):
    """{section: value} for a normalisation source: {"geomodel": name | "company map", "attribute": a}."""
    gm, attr = source.get("geomodel"), source.get("attribute")
    if gm == "company map":
        key = {"kh": "kh_est_md_ft", "net_ft": "thickness_est_ft", "gross_ft": "thickness_est_ft", "phi": "porosity_est",
               "k_md": "perm_est_md"}.get(attr)
        if key is None:
            raise ValueError(f"the company map has no {attr} (use kh, net_ft, gross_ft, phi or k_md)")
        return {g["section"]: g[key] for g in state.get("geology", [])}
    model = (state.get("geomodels") or {}).get(gm)
    if model is None:
        raise ValueError(f"no saved interpretation named {gm}")
    vals = {s: v[attr] for s, v in model["sections"].items() if attr in v}
    if not vals:
        raise ValueError(f"interpretation {gm} has no {attr}")
    return vals
