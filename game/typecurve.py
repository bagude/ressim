"""Type curves the way planning tools build them: select analogs, normalise, align to peak, fit a
multi-segment Arps decline (hyperbolic switching to a terminal exponential), take P10/P50/P90.
Monthly volumes throughout; time in months from the aligned peak. P10 is the high case (industry convention)."""
import math

MONTH_DAYS = 30.4375
HORIZON = 240


def arps_rate(t, qi, di, b, dmin):
    """Rate (volume per month) at t months. di, dmin are nominal annual decline rates (1/yr)."""
    d = di / 12.0
    dm = dmin / 12.0
    if b <= 1e-6:
        return qi * math.exp(-d * t)
    # switch when the instantaneous decline d/(1+b d t) falls to dm
    ts = (d / dm - 1.0) / (b * d) if d > dm else 0.0
    if t <= ts:
        return qi / (1.0 + b * d * t) ** (1.0 / b)
    qs = qi / (1.0 + b * d * ts) ** (1.0 / b)
    return qs * math.exp(-dm * (t - ts))


def curve(p, months=HORIZON):
    """Monthly volumes for months 0..months-1 (rate at mid-month; the rate is already volume per month)."""
    return [arps_rate(k + 0.5, p["qi"], p["di"], p["b"], p["dmin"]) for k in range(months)]


def fit(series, dmin=0.08, b_max=2.0):
    """Least-squares fit in log space to positive monthly volumes (aligned at peak). Returns params and the fit error."""
    pts = [(k, v) for k, v in enumerate(series) if v and v > 0]
    if len(pts) < 3:
        return None
    logs = [math.log(v) for _, v in pts]
    best = None
    bs = [i / 10.0 for i in range(0, int(b_max * 10) + 1)]
    dis = [0.05 * (1.15 ** i) for i in range(45)]           # 0.05 .. ~25 per year
    for b in bs:
        for di in dis:
            shape = [arps_rate(k + 0.5, 1.0, di, b, dmin) for k, _ in pts]
            if any(s <= 0 for s in shape):
                continue
            ls = [math.log(s) for s in shape]
            lqi = sum(a - c for a, c in zip(logs, ls)) / len(ls)
            err = sum((a - c - lqi) ** 2 for a, c in zip(logs, ls))
            if best is None or err < best[0]:
                best = (err, {"qi": math.exp(lqi), "di": di, "b": b, "dmin": dmin})
    err, p = best
    p["rmse_log"] = math.sqrt(err / len(pts))
    return p


def align_peak(history, search=6):
    """Drop months before the peak (peak looked for in the first `search` producing months)."""
    if not history:
        return []
    k = max(range(min(search, len(history))), key=lambda i: history[i])
    return history[k:]


def normalise(history, lateral_ft, per_ft=1000.0):
    return [v * per_ft / lateral_ft for v in history]


def percentile(vals, p):
    """p in [0,1] of the sorted values, linear interpolation."""
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    x = p * (len(s) - 1)
    i = int(math.floor(x))
    j = min(i + 1, len(s) - 1)
    return s[i] + (s[j] - s[i]) * (x - i)


def build(analogs, normalise_lateral=True, min_wells=3, dmin=0.08):
    """analogs: [{id, lateral_ft, oil[], gas[]}] (monthly history). Returns aligned series, per-well fits and
    P10/P50/P90 curves (fitted), all per 1,000 ft of lateral when normalised."""
    wells = []
    for a in analogs:
        h = normalise(a["oil"], a["lateral_ft"]) if normalise_lateral else list(a["oil"])
        al = align_peak(h)
        k0 = len(h) - len(al)
        g = normalise(a["gas"], a["lateral_ft"]) if normalise_lateral else list(a["gas"])
        wells.append({"id": a["id"], "aligned_oil": al, "aligned_gas": g[k0:], "fit": fit(al, dmin=dmin)})
    n = max((len(w["aligned_oil"]) for w in wells), default=0)
    pct = {"p10": [], "p50": [], "p90": []}
    for k in range(n):
        vals = [w["aligned_oil"][k] for w in wells if len(w["aligned_oil"]) > k]
        if len(vals) < min_wells:
            break
        pct["p10"].append(percentile(vals, 0.9))     # P10 = 10 % chance of exceeding: the high case
        pct["p50"].append(percentile(vals, 0.5))
        pct["p90"].append(percentile(vals, 0.1))
    fits = {k: fit(v, dmin=dmin) for k, v in pct.items()}
    oil = sum(sum(w["aligned_oil"]) for w in wells)
    gas = sum(sum(w["aligned_gas"]) for w in wells)
    gor = gas / oil if oil > 0 else 0.0                     # Mcf/bbl, cumulative across the analogs
    out = {"wells": wells, "percentile_series": pct, "fits": fits, "gor_mcf_bbl": gor,
           "per_ft": 1000.0 if normalise_lateral else None, "months_with_enough_wells": len(pct["p50"])}
    out["eur_oil"] = {k: (sum(curve(f)) if f else None) for k, f in fits.items()}
    return out
