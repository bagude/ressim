"""Find a good design per level by coarse search and set star thresholds from it (writes stars.json).

    python game/calibrate.py [level_id ...]

Uniform designs only (also for the per-stage level, so a tailored design can beat the reference).
Stars: 1 at 50 %, 2 at 85 %, 3 at 97 % of the best NPV found. Results also land in calibration.json.
"""
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import economics as eco  # noqa: E402
import engine  # noqa: E402
import levels as lv  # noqa: E402
import sim  # noqa: E402

GAME = Path(__file__).resolve().parent


def npv_of(worker, level, design):
    d, err = lv.normalise(level, design)
    if err:
        return None
    cap = eco.capex(d, level["lateral_ft"], eco.DEFAULT_COSTS)["total_usd"]
    if level["budget_usd"] is not None and cap > level["budget_usd"]:
        return None
    out, _, _ = engine.simulate(worker, level, d)
    return engine.evaluate(level, d, out)["npv_usd"]


def snap(c, key, x):
    lo, hi = c[key]
    return min(max(x, lo), hi)


def search(worker, level, log):
    c = level["controls"]
    seen = {}

    def f(n, hl, cd, bhp):
        k = (n, hl, cd, bhp)
        if k not in seen:
            seen[k] = npv_of(worker, level, {"stages": n, "half_length_ft": hl, "conductivity_mdft": cd, "bhp_psi": bhp})
            log(f"  {level['id']}: n={n} hl={hl} c={cd} bhp={bhp} -> " + ("over budget" if seen[k] is None else f"{seen[k] / 1e6:.3f} MM"))
        return seen[k]

    def best():
        ok = [(v, k) for k, v in seen.items() if v is not None]
        return max(ok) if ok else (None, None)

    smin, smax = c["stages"]
    ns = sorted({smin, round(smin + (smax - smin) / 3), round(smin + 2 * (smax - smin) / 3), smax})
    hls = sorted({snap(c, "half_length_ft", h) for h in (150, 300, 450)})
    cd0 = snap(c, "conductivity_mdft", 50.0)
    bhp0 = snap(c, "bhp_psi", 1500.0)
    for n, hl in itertools.product(ns, hls):
        f(n, float(hl), cd0, bhp0)
    # coordinate refinement around the best point
    for _ in range(2):
        _, (n, hl, cd, bhp) = best()
        if n is None:
            break
        for dn in (-2, -1, 1, 2):
            if smin <= n + dn <= smax:
                f(n + dn, hl, cd, bhp)
        _, (n, hl, cd, bhp) = best()
        for dh in (-75, -40, 40, 75):
            f(n, snap(c, "half_length_ft", hl + dh), cd, bhp)
        _, (n, hl, cd, bhp) = best()
        if c["conductivity_mdft"][0] != c["conductivity_mdft"][1]:
            for x in (5.0, 15.0, 30.0, 100.0, 200.0):
                f(n, hl, snap(c, "conductivity_mdft", x), bhp)
        _, (n, hl, cd, bhp) = best()
        if c["bhp_psi"][0] != c["bhp_psi"][1]:
            for x in (1000.0, 2000.0, 2500.0, 3000.0, 4000.0):
                f(n, hl, cd, snap(c, "bhp_psi", x))
    return best(), len(seen)


def main():
    ids = sys.argv[1:] or [l["id"] for l in lv.LEVELS]
    w = sim.Worker()
    w.start()
    if not w.ready.wait(900):
        sys.exit(f"simulator did not start: {w.error}")
    stars_path, cal_path = GAME / "stars.json", GAME / "calibration.json"
    stars = json.loads(stars_path.read_text()) if stars_path.exists() else {}
    cal = json.loads(cal_path.read_text()) if cal_path.exists() else {}
    log = lambda s: print(s, flush=True)
    try:
        for lid in ids:
            level = lv.get_level(lid)
            (npv, k), runs = search(w, level, log)
            if npv is None or npv <= 0:
                log(f"{lid}: best NPV {npv} -- economics need adjusting, no stars written")
                continue
            stars[lid] = [round(npv * f, -3) for f in (0.5, 0.85, 0.97)]
            cal[lid] = {"best_npv_usd": npv, "design": dict(zip(("stages", "half_length_ft", "conductivity_mdft", "bhp_psi"), k)), "runs": runs}
            stars_path.write_text(json.dumps(stars, indent=1))
            cal_path.write_text(json.dumps(cal, indent=1))
            log(f"{lid}: best {npv / 1e6:.3f} MM with {cal[lid]['design']} after {runs} runs; stars {stars[lid]}")
    finally:
        w.stop()


if __name__ == "__main__":
    main()
