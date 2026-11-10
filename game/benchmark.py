"""The staff benchmark: the same field and seed run by staff on autopilot, as a yardstick for a career's value.

Staff policy (standard practice, no player skill):
- each year, a P50 type curve from every analog with 6+ months of history (inherited wells and the wells drilled so far);
- the company's standard design, 4 wells per section, one rig and one crew;
- open sections are added nearest the developed area first, one at a time, until the board approves; the request is the
  plan's capex for the year (at least the first pad's), never above the board limit;
- every job is delegated, every well staff-steered, guidance is the plan's forecast, no mid-year revisions.

It runs in memory on the career's own truth (nothing is written but careers/<id>/benchmark.json) and takes the
simulator for any pad the player's career has not already simulated.
"""
import copy
import json
import threading

import career
import career_tasks
import field

STAFF_DESIGN = {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
STAFF_WELLS = 4
STAFF_GEO_MIN_R2 = 0.2
_running = set()
_guard = threading.Lock()


def path(cid):
    return career.CAREERS / cid / "benchmark.json"


def load(cid):
    p = path(cid)
    return json.loads(p.read_text()) if p.exists() else None


def _order(state):
    """Open sections, nearest the developed area first (then by name, so it is deterministic)."""
    dev = [s for s in state["sections"] if s["developed"]]
    opens = [s for s in state["sections"] if not s["developed"]]
    return [s["section"] for s in sorted(opens, key=lambda s: (min((abs(s["col"] - d["col"]) + abs(s["row"] - d["row"]) for d in dev),
                                                                     default=0), s["section"]))]


def _year(st, truth, ts):
    y = st["month"] // 12
    ids = [a["id"] for a in career.analog_list(st, truth, ts) if a["history_months"] >= 6]
    tc, al = career.build_typecurve(st, truth, ts, ids)
    import geodesk                                     # staff: auto-picks, inverse distance, kh; used when the fit explains something
    st.setdefault("geomodels", {})["staff auto-map"] = geodesk.auto_geomodel(st, truth)
    g = career.geology_fit(st, al, {"geomodel": "staff auto-map", "attribute": "hcpv"})
    career.save_typecurve(st, "staff", ids, tc, geology=g if (g.get("r2") or 0) >= STAFF_GEO_MIN_R2 else None)
    locked = [{"section": s, "wells": len(st["locked"][s]["wells"])} for s in st["locked"]]
    queue = [s for s in _order(st) if s not in st["locked"]]
    pads = list(locked)
    tried = []
    while True:
        raw = {"design": STAFF_DESIGN, "typecurve": "staff", "percentile": "p50", "rigs": 1, "crews": 1, "budget_request": {}, "pads": pads}
        plan = career.check_plan(st, raw)
        ev = career.evaluate_plan(st, truth, ts, dict(plan, budget_request={y: 1e12}))
        row = next(r for r in ev["budget_by_year"] if r["year_index"] == y)
        lim = career.board_limit(st, row["op_cash_forecast_usd"])
        raw["budget_request"] = {str(y): min(lim, max(row["planned_capex_usd"] * 1.10, 1.0))}     # 10 % contingency
        plan = career.check_plan(st, raw)
        conds = career.board_conditions(st, truth, ts, plan)
        if all(c["passes"] is not False for c in conds):
            return career.budget_meeting(st, truth, ts, plan)
        if not queue:
            tried.append(conds)
            raw["budget_request"] = {str(y): lim}             # out of inventory: take what the board will fund
            d = career.budget_meeting(st, truth, ts, career.check_plan(st, raw))
            if d["approved"]:
                return d
            # rejected with nothing left to add: drill nothing new, produce what is there, guide to that
            hold = career.check_plan(st, dict(raw, budget_request={str(y): 0.0}, pads=locked))
            ev0 = career.evaluate_plan(st, truth, ts, hold)
            r0 = next(r for r in ev0["budget_by_year"] if r["year_index"] == y)
            st["board"]["approved"][str(y)] = 0.0
            st["board"]["guidance"][str(y)] = r0["oil_forecast_bbl"]
            st["board"]["forecast"][str(y)] = [a + b for a, b in zip(ev0["_pdp"][12 * y:12 * (y + 1)], ev0["_dev_oil"][12 * y:12 * (y + 1)])]
            st["plan"] = hold
            return {"approved": False}
        pads.append({"section": queue.pop(0), "wells": STAFF_WELLS})


def run(state, truth, ts):
    """Play the whole career on autopilot from its starting state. Returns the benchmark dict."""
    st = copy.deepcopy(state)
    tr = copy.deepcopy(truth)
    st.update(id=state["id"] + "-staff", autopilot=True, month=0, status="active", inbox=[], tasks=[], score=None)
    while st["status"] == "active" and st["month"] < career.CAREER_MONTHS:
        if str(st["month"] // 12) not in st["board"]["approved"]:
            _year(st, tr, ts)
        career.advance(st, tr, ts, 12 - st["month"] % 12)
    if st.get("score") is None:
        career.final_score(st, tr, ts)
    sc = st["score"]
    return {"value_usd": sc["value_usd"], "realised_pv10_usd": sc["realised_pv10_usd"], "remaining_pv10_usd": sc["remaining_pv10_usd"],
            "confidence": st["board"]["confidence"], "status": st["status"], "months": st["month"],
            "wells": len(st["wells"]), "pads": len(st["locked"]),
            "by_year": career.value_by_year(st),
            "reviews": [{k: r[k] for k in ("year", "production_ratio", "capex_ratio", "confidence_change", "confidence")} for r in st["board"]["reviews"]],
            "note": "Staff on autopilot on the same field, seed and oil price: a P50 type curve from all analogs each year, "
                    "normalised to the staff auto-map (auto-picks on the legacy verticals, inverse distance, HCPV) when its fit has r2 >= 0.2, the "
                    "standard design (200 ft stages, 300 ft half-length, 50 md-ft, 1,500 psi), 4 wells per section, one rig, pads "
                    "nearest the developed area added until the board approves, every job delegated, no revisions."}


def compute(cid, truth_sim):
    """Run the staff benchmark for a career now and store it."""
    st, truth = career.load(cid)
    st0 = copy.deepcopy(st)
    original = [x for x in st["sections"] if x["row"] < field.ROWS]          # before any land won at auction
    # back to the starting position: the field as it was handed over, before any decision
    st0.update(month=0, cash_usd=career.START_CASH, history={k: [] for k in st["history"]}, typecurves={}, plan=None,
               locked={}, wells=[], tasks=[], hedge_books=[], costs_pending=[], cost_factors={}, notified=[],
               board={"confidence": career.START_CONFIDENCE, "approved": {}, "guidance": {}, "forecast": {}, "reviews": []},
               sections=original, oil_cap_bbl_d=career.STARTING_BATTERY_BBL_D)
    truth0 = copy.deepcopy(truth)
    truth0["rock"] = [r for r in truth["rock"] if r["section"] in {s["section"] for s in st0["sections"]}]
    truth0["analogs"] = [dict(a, multipliers=[]) for a in truth["analogs"]]
    b = run(st0, truth0, truth_sim)
    tmp = path(cid).with_suffix(".tmp")
    tmp.write_text(json.dumps(b))
    tmp.replace(path(cid))
    return b


def ensure(cid, truth_sim):
    """Start the benchmark for a career in the background if it has none yet. Safe to call on every request."""
    if truth_sim is None or truth_sim.worker is None or path(cid).exists() or path(cid).with_suffix(".err").exists():
        return
    with _guard:
        if cid in _running:
            return
        _running.add(cid)

    def work():
        try:
            compute(cid, truth_sim)
        except Exception as e:  # noqa: BLE001  the benchmark is optional; record why it is missing
            path(cid).with_suffix(".err").write_text(str(e)[:2000])
        finally:
            with _guard:
                _running.discard(cid)

    threading.Thread(target=work, daemon=True).start()


def grade(value, bench):
    """Your value against staff: A beats them by 20 %+, B beats them, C within 20 % below, D further below."""
    from minigames import base
    r = base.relative(value, bench, 5e6)
    return {"ratio": r, "grade": "A" if r >= 1.2 else "B" if r >= 1.0 else "C" if r >= 0.8 else "D"}


_ = career_tasks  # imported for the autopilot hooks it uses through career
