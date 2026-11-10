"""Probabilistic EUR (#2): a history match by sampling, on f7's fast screening mesh.

For one of your wells: draw its uncertain rock and fracture (permeability around the company map's estimate, net pay
around the map's thickness, half-length around the design) from priors, simulate each draw on the screening mesh,
score it against the well's actual monthly oil, keep the best matches, and read P10 / P50 / P90 EUR and a forecast fan
from them. The screening mesh reads a few percent low (f7's measurement: about -5 % in year one, -1 to -3 % later);
the history match absorbs a uniform bias because every draw shares it, and each kept draw is scaled to the well's
cumulative to date.
"""
import math
import threading

import career
import field
import opecon

SAMPLES = 24
KEEP = 8
FAN_MONTHS = 120
_jobs = {}
_guard = threading.Lock()


def _prior(state, w, k):
    r = field.rng_for(state["seed"], "eurprior", w["id"], k)
    est = next((g for g in state.get("geology", []) if g["section"] == w["section"]), None)
    perm0 = est["perm_est_md"] if est else 0.005
    sigma = 0.5
    tested = [v for wid, v in (state.get("well_tests") or {}).items() if wid.split("-")[0] == w["section"]]
    if tested:                                       # your well test in this section anchors the prior
        perm0, sigma = tested[-1]["k_md"], 0.25
    h0 = est["thickness_est_ft"] if est else 100.0
    return {"perm_md": perm0 * math.exp(r.gauss(0, sigma)), "thickness_ft": max(30.0, h0 * math.exp(r.gauss(0, 0.15))),
            "half_length_ft": w["design"]["half_length_ft"] * r.uniform(0.5, 1.2)}


def _spec(truth, w, p):
    rock = dict(career.rock_of(truth, w["section"]))
    rock.pop("net_ft", None)
    rock.pop("sw", None)
    rock.update(perm_md=p["perm_md"], thickness_ft=p["thickness_ft"], porosity=0.08 * 0.7 / 0.88,   # nothing hidden: priors only
                pressure_psi=5000.0)
    design = dict(w["design"], half_length_ft=p["half_length_ft"])
    s = field.spec_for(rock, design, w["wells_per_section"])
    s.update(mesh="screening", dt_max_days=30.0)
    return s


def run(state, truth, truth_sim, well_id):
    w = next((w for w in state["wells"] if w["id"] == well_id), None)
    if w is None:
        raise career.CareerError("probabilistic EUR works on your own drilled wells")
    h = w.get("oil_hist")
    if not h or len(h["oil"]) < 3:
        raise career.CareerError("needs at least 3 producing months to match")
    actual = h["oil"]
    n = len(actual)
    draws = []
    for k in range(SAMPLES):
        p = _prior(state, w, k)
        stage = truth_sim.stage_curve(_spec(truth, w, p))["oil"]
        well = [x * w["stages"] for x in stage]
        sim_hist = well[:n]
        err = math.sqrt(sum((math.log(max(a, 1.0)) - math.log(max(s, 1.0))) ** 2 for a, s in zip(actual, sim_hist)) / n)
        draws.append((err, p, well))
    draws.sort(key=lambda d: d[0])
    kept = draws[:KEEP]
    cum = sum(actual)
    fans, eurs = [], []
    for err, p, well in kept:
        scale = cum / max(1.0, sum(well[:n]))
        fut = [x * scale for x in well[n:n + FAN_MONTHS]]
        fans.append(fut)
        eurs.append(cum + sum(x * scale for x in well[n:]))
    eurs.sort()
    q = lambda f: eurs[min(len(eurs) - 1, int(f * (len(eurs) - 1) + 0.5))]
    fan = {"month": list(range(state["month"], state["month"] + FAN_MONTHS))}
    for name, f in (("p90", 0.1), ("p50", 0.5), ("p10", 0.9)):
        fan[name] = [round(sorted(c[i] for c in fans)[min(len(fans) - 1, int(f * (len(fans) - 1) + 0.5))], 1) for i in range(FAN_MONTHS)]
    return {"well": well_id, "months_matched": n, "cum_oil_bbl": round(cum),
            "eur_oil_bbl": {"p90": round(q(0.1)), "p50": round(q(0.5)), "p10": round(q(0.9))},
            "fan": fan, "kept": [{"match_error_log": round(e, 3), "perm_md": round(p["perm_md"], 5), "thickness_ft": round(p["thickness_ft"]),
                                  "half_length_ft": round(p["half_length_ft"])} for e, p, _ in kept],
            "samples": SAMPLES, "notes": [__doc__.split("\n\n")[1].replace("\n", " "),
                                          "P90 is the low case (90 % chance of more), P10 the high case, as reserves are quoted."]}


def start(cid, well_id, month, truth_sim):
    key = (cid, well_id, month)
    with _guard:
        j = _jobs.get(key)
        if j and j["status"] in ("running", "done"):
            return j
        j = _jobs[key] = {"status": "running", "well": well_id, "month": month}

    def work():
        try:
            st, truth = career.load(cid)
            j["result"] = run(st, truth, truth_sim, well_id)
            j["status"] = "done"
        except Exception as e:  # noqa: BLE001
            j["status"], j["error"] = "failed", str(e)[:500]

    threading.Thread(target=work, daemon=True).start()
    return j


def status(cid, well_id, month):
    return _jobs.get((cid, well_id, month)) or {"status": "none"}


_ = opecon
