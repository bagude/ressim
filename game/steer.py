"""Geosteering: drill a lateral through a hidden structure by correlating MWD gamma ray against a typelog.

Coordinates in the vertical plane: md (measured depth along the lateral from the heel, ft), tvd (ft, positive down,
relative), mid(md) = depth of mid-pay, s = tvd - mid(md) (stratigraphic position, positive = below mid-pay).
Pay is |s| <= T/2; outside it the bit is in a barrier at distance d = |s| - T/2.

Truth (structure, exact positions) stays on the server. The player sees the typelog, the survey (md, tvd,
inclination) and noisy gamma at the sensor, 50 ft behind the bit. Production effect of each stage's landing
(agreed with the simulator owner): inside the pay, none (fracture geometry is set by the stress layers); in a
barrier, a choked well-to-pay connection, a GAME APPROXIMATION, simulated by ressim through connection_multiple.
"""
import json
import math
import random
import uuid
from pathlib import Path

GAME = Path(__file__).resolve().parent
STEER = GAME / "steer"
STEP = 10.0                 # ft between survey and log points
INTERVAL = 300.0            # ft drilled per decision
SENSOR_LAG = 50.0           # ft between bit and gamma sensor
DLS_MAX = 3.0               # degrees per 100 ft
FT_PER_DAY = 1500.0
SLIDE_DAYS_PER_DEG = 0.08   # extra rig time per degree of steering (slide drilling)
LOOK_AROUND_DAYS = 0.15
SIDETRACK_DAYS = 1.0
BUCKETS = [(0.0, 0.0), (5.0, 3.0), (10.0, 7.5), (20.0, 15.0), (1e9, 30.0)]   # (max d, representative d) ft into barrier

NOTE = ("Inside the pay, landing height does not change fracture geometry in this model (height is set by the stress "
        "layers); proppant placement relative to the wellbore and laminations are not modelled. A stage landed in a "
        "barrier gets a choked well-to-pay connection: a game approximation, simulated by ressim.")


# ---- truth --------------------------------------------------------------------------------------
def make_structure(seed, lateral_ft, pay_ft):
    r = random.Random(f"{seed}|structure")
    segs, md = [], 0.0
    dip = r.uniform(-1.2, 1.2)
    while md < lateral_ft + INTERVAL:
        length = r.uniform(600, 1500)
        segs.append({"md": md, "dip_deg": dip})
        md += length
        dip = max(-2.5, min(2.5, dip + r.uniform(-1.4, 1.4)))
    fault = None
    if r.random() < 0.6:
        fault = {"md": r.uniform(0.3, 0.8) * lateral_ft, "throw_ft": r.choice([-1, 1]) * r.uniform(0.25, 0.7) * pay_ft}
    return {"segments": segs, "fault": fault, "pay_ft": pay_ft, "lateral_ft": lateral_ft,
            "s0": r.uniform(-0.25, 0.25) * pay_ft, "inc0": None, "typelog_seed": r.randint(0, 10 ** 9)}


def structure_from_profile(seed, lateral_ft, pay_ft, md, top_tvd):
    """A career well's structure from the field's true top of pay along its path (f7's lateral_structure, faults
    included as steps between samples). Depths are relative to mid-pay at the heel, like the generated structures."""
    r = random.Random(f"{seed}|structure")
    mid0 = top_tvd[0] + pay_ft / 2
    prof = {"md": [round(m, 2) for m in md], "mid": [round(t + pay_ft / 2 - mid0, 3) for t in top_tvd]}
    segs = []
    for a in range(0, int(lateral_ft + INTERVAL), int(INTERVAL)):
        b = a + INTERVAL
        za, zb = _interp(prof, a), _interp(prof, b)
        segs.append({"md": float(a), "dip_deg": round(math.degrees(math.atan2(zb - za, INTERVAL)), 3)})
    return {"segments": segs, "fault": None, "profile": prof, "pay_ft": pay_ft, "lateral_ft": lateral_ft,
            "s0": r.uniform(-0.25, 0.25) * pay_ft, "inc0": None, "typelog_seed": r.randint(0, 10 ** 9), "mid0_tvd_abs": mid0}


def _interp(prof, md):
    xs, ys = prof["md"], prof["mid"]
    if md <= xs[0]:
        return ys[0]
    if md >= xs[-1]:
        return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if xs[m] <= md:
            lo = m
        else:
            hi = m
    t = (md - xs[lo]) / (xs[hi] - xs[lo])
    return ys[lo] * (1 - t) + ys[hi] * t


def mid_depth(struct, md):
    """Depth of mid-pay at md (relative to mid-pay at the heel = 0)."""
    if struct.get("profile"):
        return _interp(struct["profile"], md)
    z, segs = 0.0, struct["segments"]
    for i, sg in enumerate(segs):
        end = segs[i + 1]["md"] if i + 1 < len(segs) else math.inf
        if md <= sg["md"]:
            break
        z += math.tan(math.radians(sg["dip_deg"])) * (min(md, end) - sg["md"])
    f = struct["fault"]
    if f and md >= f["md"]:
        z += f["throw_ft"]
    return z


def dip_at(struct, md):
    d = struct["segments"][0]["dip_deg"]
    for sg in struct["segments"]:
        if sg["md"] <= md:
            d = sg["dip_deg"]
    return d


def typelog(struct, pad=60.0):
    """Gamma ray (API) against stratigraphic depth s (ft): barriers hot, pay cooler with a few correlatable beds."""
    r = random.Random(struct["typelog_seed"])
    T = struct["pay_ft"]
    waves = [(r.uniform(2.5, 12.0), r.uniform(0, 6.28), r.uniform(3, 9)) for _ in range(4)]
    beds = [(r.uniform(-0.4, 0.4) * T, r.uniform(1.5, 4.0), r.choice([-22.0, 28.0])) for _ in range(3)]
    s_vals, g_vals = [], []
    s = -T / 2 - pad
    while s <= T / 2 + pad + 1e-9:
        tex = sum(a * math.sin(2 * math.pi * s / w + ph) for w, ph, a in waves)
        if abs(s) <= T / 2:
            g = 55.0 + 0.6 * tex + sum(h * math.exp(-((s - c) / wd) ** 2) for c, wd, h in beds)
        else:
            edge = min(1.0, (abs(s) - T / 2) / 4.0)          # 4 ft transition into the barrier
            g = 55.0 + edge * 70.0 + tex
        s_vals.append(round(s, 1))
        g_vals.append(round(g, 1))
        s += 1.0
    return {"s_ft": s_vals, "gamma_api": g_vals}


def gamma_at(tl, s):
    ss, gg = tl["s_ft"], tl["gamma_api"]
    if s <= ss[0]:
        return gg[0]
    if s >= ss[-1]:
        return gg[-1]
    i = int((s - ss[0]) // 1.0)
    i = min(i, len(ss) - 2)
    t = (s - ss[i]) / (ss[i + 1] - ss[i])
    return gg[i] * (1 - t) + gg[i + 1] * t


# ---- sessions -----------------------------------------------------------------------------------
def new_session(seed=None, pay_ft=None, lateral_ft=4620.0, noise_api=6.0, link=None, design=None, persist=True, profile=None, geo=None):
    """profile = {md, top_tvd} (absolute): the field's true structure along the well (careers on the geology grid);
    geo = {heel_x_ft, heel_y_ft, azimuth_deg}: where the well is in the field."""
    seed = seed if seed is not None else random.randrange(10 ** 9)
    r = random.Random(f"{seed}|pay")
    pay = pay_ft if pay_ft is not None else round(r.uniform(25.0, 40.0), 1)
    st = structure_from_profile(seed, lateral_ft, pay, profile["md"], profile["top_tvd"]) if profile else make_structure(seed, lateral_ft, pay)
    st["inc0"] = 90.0 - dip_at(st, 0.0) + random.Random(f"{seed}|inc").gauss(0, 0.6)
    tl = typelog(st)
    sid = uuid.uuid4().hex[:12]
    s = {"id": sid, "seed": seed, "truth": st, "typelog": tl, "noise_api": noise_api, "link": link, "design": design,
         "path": [{"md": 0.0, "tvd": st["s0"], "inc": st["inc0"]}], "gamma": [], "days": 0.0, "decisions": 0,
         "slide_deg": 0.0, "interpretation": None, "finished": False, "result": None}
    if geo and profile:
        s["geo"] = dict(geo, heel_mid_pay_tvd_ft=round(st["mid0_tvd_abs"], 2))
        if "gross_top_offset_ft" in geo:
            s["geo"]["target_zone"] = {"top_offset_ft": geo["gross_top_offset_ft"], "thickness_ft": pay,
                                       "note": "the clean net bench below the top of the gross pay; landing outside it chokes the stage"}
    if persist:
        save(s)
    return s


def save(s):
    STEER.mkdir(exist_ok=True)
    (STEER / f"{s['id']}.json").write_text(json.dumps(s))


def load(sid):
    if not (isinstance(sid, str) and len(sid) == 12 and all(c in "0123456789abcdef" for c in sid)):
        raise ValueError("unknown steering session")
    f = STEER / f"{sid}.json"
    if not f.exists():
        raise ValueError("unknown steering session")
    return json.loads(f.read_text())


def bit(s):
    return s["path"][-1]


def drill(s, target_inc, look_around=False, rng=None):
    """Drill the next interval toward a target inclination (capped by the dogleg limit)."""
    if s["finished"]:
        raise ValueError("well already finished")
    st = s["truth"]
    L = st["lateral_ft"]
    b = bit(s)
    if b["md"] >= L - 1e-6:
        raise ValueError("at total depth; finish the well")
    length = min(INTERVAL, L - b["md"])
    cap = DLS_MAX * length / 100.0
    inc_new = b["inc"] + max(-cap, min(cap, float(target_inc) - b["inc"]))
    r = rng or random.Random(f"{s['seed']}|drill|{s['decisions']}|{len(s['path'])}")
    inc_new += r.gauss(0, 0.15)                         # bit walk
    n = max(1, round(length / STEP))
    md, tvd, inc = b["md"], b["tvd"], b["inc"]
    for k in range(1, n + 1):
        inc_k = b["inc"] + (inc_new - b["inc"]) * k / n
        dmd = length / n
        tvd += math.cos(math.radians(0.5 * (inc + inc_k))) * dmd
        md += dmd
        inc = inc_k
        s["path"].append({"md": round(md, 2), "tvd": round(tvd, 3), "inc": round(inc, 3)})
    noise = s["noise_api"] * (0.3 if look_around else 1.0)
    have = s["gamma"][-1]["md"] if s["gamma"] else -1.0
    for p in s["path"]:
        sensor = p["md"] - SENSOR_LAG
        if p["md"] <= have + SENSOR_LAG + 1e-6 or sensor < 0:
            continue
        sp = point_at(s, sensor)
        g = gamma_at(s["typelog"], sp["tvd"] - mid_depth(st, sensor)) + r.gauss(0, noise)
        s["gamma"].append({"md": round(sensor, 2), "tvd": round(sp["tvd"], 3), "gamma_api": round(g, 1)})
    s["days"] += length / FT_PER_DAY + SLIDE_DAYS_PER_DEG * abs(inc_new - b["inc"]) + (LOOK_AROUND_DAYS if look_around else 0.0)
    s["slide_deg"] += abs(inc_new - b["inc"])
    s["decisions"] += 1


def point_at(s, md):
    p = s["path"]
    for i in range(1, len(p)):
        if p[i]["md"] >= md - 1e-9:
            a, b = p[i - 1], p[i]
            t = (md - a["md"]) / max(1e-9, b["md"] - a["md"])
            return {"md": md, "tvd": a["tvd"] + t * (b["tvd"] - a["tvd"]), "inc": a["inc"] + t * (b["inc"] - a["inc"])}
    return dict(p[-1])


def sidetrack(s, to_md):
    """Pull back to an earlier depth and redrill from there (costs days; logs beyond it are discarded)."""
    to_md = float(to_md)
    b = bit(s)
    if not 0 < to_md < b["md"] or b["md"] - to_md > 1500:
        raise ValueError("sidetrack point must be within 1,500 ft behind the bit")
    keep = [p for p in s["path"] if p["md"] <= to_md + 1e-9]
    keep.append(point_at(s, to_md)) if keep[-1]["md"] < to_md - 1e-6 else None
    s["path"] = keep
    s["gamma"] = [g for g in s["gamma"] if g["md"] <= to_md - SENSOR_LAG + 1e-9]
    s["days"] += SIDETRACK_DAYS + (b["md"] - to_md) / FT_PER_DAY * 0.5
    s["decisions"] += 1


# ---- the player's interpretation ----------------------------------------------------------------
def belief_mid(interp, md):
    """interp: [{md, dip_deg, throw_ft?}] sorted by md; mid-pay depth under the player's model (heel mid = 0)."""
    z = 0.0
    for i, seg in enumerate(interp):
        end = interp[i + 1]["md"] if i + 1 < len(interp) else math.inf
        if md < seg["md"]:
            break
        z += float(seg.get("throw_ft", 0.0))
        z += math.tan(math.radians(float(seg["dip_deg"]))) * (min(md, end) - seg["md"])
    return z


def check_interp(interp):
    if not isinstance(interp, list) or not interp:
        raise ValueError("interpretation must be a non-empty list of {md, dip_deg, throw_ft?, thickness_factor?}")
    out = []
    for seg in interp:
        try:
            d = {"md": float(seg["md"]), "dip_deg": float(seg["dip_deg"]), "throw_ft": float(seg.get("throw_ft", 0.0)),
                 "thickness_factor": float(seg.get("thickness_factor", 1.0))}
        except (KeyError, TypeError, ValueError):
            raise ValueError("each interpretation segment needs numeric md and dip_deg")
        if not (-15 <= d["dip_deg"] <= 15 and 0.5 <= d["thickness_factor"] <= 2.0):
            raise ValueError("dip within ±15°, thickness_factor 0.5-2")
        out.append(d)
    out.sort(key=lambda x: x["md"])
    if out[0]["md"] > 0:
        out.insert(0, {"md": 0.0, "dip_deg": out[0]["dip_deg"], "throw_ft": 0.0, "thickness_factor": 1.0})
    return out


def preview(s, interp):
    """Synthetic gamma along the revealed log and the bit's position under the player's interpretation (belief only)."""
    interp = check_interp(interp)
    T = s["truth"]["pay_ft"]

    def tf(md):
        f = 1.0
        for seg in interp:
            if seg["md"] <= md:
                f = seg["thickness_factor"]
        return f

    syn = []
    for g in s["gamma"]:
        sb = (g["tvd"] - belief_mid(interp, g["md"])) / tf(g["md"])
        syn.append({"md": g["md"], "gamma_api": round(gamma_at(s["typelog"], sb), 1), "s_ft": round(sb, 2)})
    b = bit(s)
    sb = (b["tvd"] - belief_mid(interp, b["md"])) / tf(b["md"])
    return {"synthetic": syn, "bit_s_ft": round(sb, 2), "bit_in_pay": abs(sb) <= T / 2,
            "parallel_inclination_deg": round(90.0 - interp[-1]["dip_deg"], 2)}


# ---- staff auto-steer ---------------------------------------------------------------------------
def auto_steer(s, rating, to_end=True):
    """A geosteerer of a given rating (0-1) drills the rest of the well: noisy reads of position and dip, steer to mid-pay."""
    r = random.Random(f"{s['seed']}|auto|{rating}")
    st = s["truth"]
    sig_s = 1.5 + (1.0 - rating) * 10.0
    sig_dip = 0.15 + (1.0 - rating) * 1.1
    lag_ft = 150 + (1.0 - rating) * 400                 # weaker steerers react late to a dip change
    while bit(s)["md"] < st["lateral_ft"] - 1e-6:
        b = bit(s)
        seen = max(0.0, b["md"] - lag_ft)
        s_est = b["tvd"] - mid_depth(st, b["md"]) + r.gauss(0, sig_s)
        dip_est = dip_at(st, seen) + r.gauss(0, sig_dip)
        L = min(INTERVAL, st["lateral_ft"] - b["md"])
        target = 90.0 - dip_est + math.degrees(math.atan(s_est / max(L, 1.0)))
        drill(s, target, rng=r)
        if not to_end:
            break


# ---- result -------------------------------------------------------------------------------------
def landing(s, stage_spacing_ft):
    """Each stage's stratigraphic position on truth, its distance into a barrier and its bucket."""
    st = s["truth"]
    T, L = st["pay_ft"], st["lateral_ft"]
    n = max(1, round(L / stage_spacing_ft))
    sp = L / n
    out = []
    for i in range(n):
        md = sp / 2 + i * sp
        p = point_at(s, md)
        sv = p["tvd"] - mid_depth(st, md)
        d = max(0.0, abs(sv) - T / 2)
        rep = next(rep for mx, rep in BUCKETS if d <= mx)
        out.append({"stage": i + 1, "md_ft": round(md, 1), "s_ft": round(sv, 2), "into_barrier_ft": round(d, 2), "bucket_ft": rep,
                    "connection_multiple": connection_multiple(rep)})
    return out


CHOKE = [(0.0, 30.0), (3.0, 0.3), (7.5, 0.03), (15.0, 0.006), (30.0, 0.002)]   # ft into barrier -> connection multiple


def connection_multiple(d):
    """GAME APPROXIMATION of the narrow, poorly propped neck between a wellbore landed in a barrier and the pay.
    Log-linear between the points in CHOKE; ressim probes showed production is insensitive above about 0.2 and
    loses about two thirds of 20-year oil at 0.002."""
    if d <= 0:
        return CHOKE[0][1]
    for (d0, m0), (d1, m1) in zip(CHOKE, CHOKE[1:]):
        if d <= d1:
            t = (d - d0) / (d1 - d0)
            return math.exp(math.log(m0) * (1 - t) + math.log(m1) * t)
    return CHOKE[-1][1]


def set_prognosis(s, target_ft, top_tvd_along, typelog_from=None):
    """The plan before drilling: expected top of pay (absolute TVD) along md and the landing target below it. With a
    type well, its gamma ray (stretched to this well's pay) replaces the ideal typelog: a poor choice misleads."""
    if len(s["path"]) > 1:
        raise ValueError("the prognosis is set before drilling starts")
    if not s.get("geo"):
        raise ValueError("only career wells on a mapped field take a prognosis")
    pts = sorted(((float(p["md"]), float(p["tvd"])) for p in top_tvd_along), key=lambda t: t[0])
    if len(pts) < 2:
        raise ValueError("top_tvd_along needs at least two {md, tvd} points")
    T = (s.get("geo") or {}).get("gross_ft", s["truth"]["pay_ft"])
    if not 0 <= float(target_ft) <= T:
        raise ValueError(f"target_ft is the landing depth below the top of the gross pay, 0 to {T:.0f} ft")
    s["prognosis"] = {"target_ft": float(target_ft), "top_tvd_along": [{"md": m, "tvd": t} for m, t in pts]}
    if typelog_from:
        s["typelog"] = typelog_from["typelog"]
        s["prognosis"]["type_well"] = typelog_from["well"]
        s["prognosis"]["typelog_source"] = typelog_from["well"]
    return s["prognosis"]


def typelog_from_well(log, picks, pay_ft, pad=60.0):
    """A typelog in this well's stratigraphic frame from an offset well's gamma ray and its pay picks."""
    if not log or "gr" not in log:
        raise ValueError("the type well needs a gamma-ray curve")
    top, base = picks["top_tvd"], picks["base_tvd"]
    if base - top <= 1:
        raise ValueError("the type well's picks are not a pay interval")
    mid, k = (top + base) / 2, pay_ft / (base - top)
    zs, gs = log["tvd_ft"], log["gr"]
    s_vals, g_vals = [], []
    sv = -pay_ft / 2 - pad
    while sv <= pay_ft / 2 + pad + 1e-9:
        z = mid + sv / k
        if z <= zs[0]:
            g = gs[0]
        elif z >= zs[-1]:
            g = gs[-1]
        else:
            i = max(j for j in range(len(zs) - 1) if zs[j] <= z)
            t = (z - zs[i]) / (zs[i + 1] - zs[i])
            g = gs[i] * (1 - t) + gs[i + 1] * t
        s_vals.append(round(sv, 1))
        g_vals.append(round(g, 1))
        sv += 1.0
    return {"s_ft": s_vals, "gamma_api": g_vals}


def in_zone_plan_pct(s):
    """Share of the lateral the prognosis line itself would have kept in the pay (how good the plan was)."""
    p, st = s.get("prognosis"), s["truth"]
    if not p or st.get("mid0_tvd_abs") is None:
        return None
    T = st["pay_ft"]
    pts = p["top_tvd_along"]
    prof = {"md": [q["md"] for q in pts], "mid": [q["tvd"] for q in pts]}
    mds = [m for m in range(30, int(st["lateral_ft"]) + 1, 30)]
    inside = sum(1 for m in mds if abs(_interp(prof, m) + p["target_ft"] - st["mid0_tvd_abs"] - mid_depth(st, m)) <= T / 2)   # T: the bench
    return 100.0 * inside / len(mds)


def in_zone_pct(s):
    st = s["truth"]
    T = st["pay_ft"]
    pts = s["path"][1:]
    if not pts:
        return 0.0
    inside = sum(1 for p in pts if abs(p["tvd"] - mid_depth(st, p["md"])) <= T / 2)
    return 100.0 * inside / len(pts)


def bucket_counts(stages):
    c = {}
    for x in stages:
        c[str(x["bucket_ft"])] = c.get(str(x["bucket_ft"]), 0) + 1
    return c


def lookback(s):
    st = s["truth"]
    T = st["pay_ft"]
    mds = [p["md"] for p in s["path"]]
    out = {"md_ft": mds, "pay_top_tvd_ft": [round(mid_depth(st, m) - T / 2, 2) for m in mds],
           "pay_base_tvd_ft": [round(mid_depth(st, m) + T / 2, 2) for m in mds],
           "segments": st["segments"], "fault": st["fault"], "pay_ft": T}
    if st.get("mid0_tvd_abs") is not None:             # absolute depths and the well's path, for the maps
        out["top_tvd_abs_ft"] = [round(st["mid0_tvd_abs"] + v, 2) for v in out["pay_top_tvd_ft"]]
        g = s.get("geo") or {}
        if g:
            ca, sa = math.cos(math.radians(g["azimuth_deg"])), math.sin(math.radians(g["azimuth_deg"]))
            out["x_ft"] = [round(g["heel_x_ft"] + m * ca, 1) for m in mds]
            out["y_ft"] = [round(g["heel_y_ft"] + m * sa, 1) for m in mds]
    return out


def view(s):
    """What the browser may see. Truth (structure, positions in the pay) only after the well is finished."""
    st = s["truth"]
    v = {"id": s["id"], "link": s["link"], "lateral_ft": st["lateral_ft"], "interval_ft": INTERVAL, "sensor_lag_ft": SENSOR_LAG,
         "dls_max_deg_100ft": DLS_MAX, "typelog": s["typelog"], "pay_ft_on_typelog": st["pay_ft"],
         "heel": {"s_ft": round(st["s0"], 2), "note": "landing position from the curve-section correlation"},
         "survey": s["path"], "gamma": s["gamma"], "bit": bit(s), "days": round(s["days"], 2), "decisions": s["decisions"],
         "finished": s["finished"], "at_td": bit(s)["md"] >= st["lateral_ft"] - 1e-6, "note": NOTE}
    if s.get("geo"):
        v["geo"] = s["geo"]
    if s.get("prognosis"):
        v["prognosis"] = {k: x for k, x in s["prognosis"].items() if k != "typelog_source"}
    if s["finished"]:
        v["result"] = s["result"]
        v["lookback"] = lookback(s)
    return v
