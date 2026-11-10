"""Scripted 60-month careers on a fake simulator, to check the board rewards good play and punishes gaming.
Used by test_career.py and runnable on its own: python game/tests/strategies.py"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import career, steer, typecurve  # noqa: E402


class DesignSim:
    """Per-stage decline that responds to rock, stage spacing, half-length, conductivity, BHP and well spacing."""
    def stage_curve(self, spec):
        hl_eff = min(spec["half_length_ft"], spec["width_ft"] / 2)
        qi = (2600.0 * (spec["perm_md"] / 0.005) ** 0.5 * (spec["spacing_ft"] / 200.0) ** 0.75 * (hl_eff / 300.0) ** 0.7
              * (spec["conductivity_mdft"] / 50.0) ** 0.15 * ((spec["pressure_psi"] - spec["bhp_psi"]) / 3500.0))
        drain = min(1.0, spec["width_ft"] / 1100.0)          # interference: closer wells share the same oil
        di = 2.0 / drain ** 0.5
        oil = [typecurve.arps_rate(k + 0.5, qi, di, 1.1, 0.08 / drain) for k in range(240)]
        return {"oil": oil, "gas": [o * 1.3 for o in oil], "water": [o * 0.01 for o in oil]}


GOOD = {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 60.0, "bhp_psi": 1500.0}
CHEAP = {"stage_spacing_ft": 400.0, "half_length_ft": 100.0, "conductivity_mdft": 5.0, "bhp_psi": 3000.0}


def play(seed, design, wells, pct, rigs=1, headroom=1.10):
    sim = DesignSim()
    st_id = career.new("S", sim, seed=seed, background=False)
    st, truth = career.load(st_id)
    ids = [a["id"] for a in career.analog_list(st, truth, sim) if a["history_months"] >= 6]
    tc, _ = career.build_typecurve(st, truth, sim, ids)
    career.save_typecurve(st, "tc", ids, tc)
    opens = [s["section"] for s in st["sections"] if not s["developed"]]
    trace = []
    while st["status"] == "active":
        y = st["month"] // 12
        raw = {"design": design, "typecurve": "tc", "percentile": pct, "pads": [{"section": s, "wells": wells} for s in opens],
               "rigs": rigs, "crews": 1, "budget_request": {}}
        ev = career.evaluate_plan(st, truth, sim, career.check_plan(st, raw))
        row = next(r for r in ev["budget_by_year"] if r["year_index"] == y)
        # ask for the planned spend plus headroom, capped at what the board funds
        raw["budget_request"] = {str(y): min(row["planned_capex_usd"] * headroom, row["board_limit_usd"])}
        d = career.budget_meeting(st, truth, sim, career.check_plan(st, raw))
        if not d["approved"]:
            trace.append(("rejected", y + 1, d["reasons"]))
            break
        career.advance(st, truth, sim, 12)
        rv = st["board"]["reviews"][-1] if st["board"]["reviews"] else None
        if rv:
            trace.append((rv["year"], round(rv["production_ratio"], 2), round(rv["capex_ratio"], 2), round(rv["confidence"])))
    return st, trace, ev["warnings"] if 'ev' in dir() else []


if __name__ == "__main__":
    tmp = tempfile.TemporaryDirectory(); career.CAREERS = Path(tmp.name); steer.STEER = Path(tmp.name) / 'steer'
    for name, kw in [("good P50", dict(design=GOOD, wells=5, pct="p50")),
                     ("good P10 (over-promise)", dict(design=GOOD, wells=5, pct="p10")),
                     ("good P90 (sandbag)", dict(design=GOOD, wells=5, pct="p90")),
                     ("cheap 10 wells P50", dict(design=CHEAP, wells=10, pct="p50"))]:
        for seed in (1, 2):
            st, tr, warn = play(seed, **kw)
            sc = st["score"]["value_usd"] / 1e6 if st["score"] else None
            print(f"{name:26s} seed {seed}: {st['status']:8s} month {st['month']:2d} value {sc if sc is None else round(sc)} MM  "
                  f"cash {st['cash_usd'] / 1e6:6.1f}  {tr}  warnings={len(warn)}")
