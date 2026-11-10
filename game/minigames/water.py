"""Water logistics: source, move and dispose of water for a 3-month completion programme.

This game is logistics and game rules only. The reservoir model's SPE1 fluid produces little water, so none of these volumes
come from the simulator; volumes and costs are illustrative public-range numbers.

Each month the player chooses how much fresh water to buy (capped by a permit), how much treatment capacity to rent to
recycle produced/flowback water (the actual supply varies around a forecast), how much produced water to inject into the
company's saltwater disposal (SWD) wells (the rest goes to commercial disposal by truck), and whether to move water by truck
or a temporary layflat pipeline (one-off capex, then cheap per barrel). Delivered water fills the month's frac demand; any
surplus is held in a storage pit up to its capacity; a shortfall delays the frac crew and carries a large penalty.

Hidden truth: the produced-water supply each month and a seismicity rule. The regulator has a hidden injection threshold;
injecting above it risks a cut in SWD capacity for the rest of the programme, with the chance rising with the excess.
Score: total controllable cost against a hindsight plan that knew the supply and the regulator rule (a search over simple
plans, not a proven optimum).
"""
import itertools

import opecon
from minigames import base

MONTHS = 3
FRESH_USD_BBL = 0.50              # fresh water purchase
FRESH_CAP_BBL = 1_300_000.0       # permit: fresh water per month
TREAT_RENT_USD_BBL = 0.10         # treatment capacity rented, per bbl of capacity (paid even if unused)
TREAT_USD_BBL = 0.50              # treatment fee per bbl actually recycled
TRUCK_USD_BBL = 1.00              # trucking to the frac site
PIPE_CAPEX_USD = 1_200_000.0      # temporary layflat pipeline: install and remove
PIPE_USD_BBL = 0.10               # pumping through the layflat
PIPE_CAP_BBL = 3_000_000.0        # layflat throughput per month
SWD_USD_BBL = 0.5 * opecon.TERMS["water_disposal_usd_bbl"]   # own SWD by gathering line: about half opecon's all-in rate
COMMERCIAL_USD_BBL = 2.00         # trucked third-party disposal
STORAGE_CAP_BBL = 600_000.0       # frac pit
SHORT_USD_BBL = 4.00              # frac delay per bbl short (~$250k per crew-day at ~60,000 bbl/day)
SHORT_EVENT_USD = 250_000.0       # plus a fixed cost per month with a delay (crew standby, rescheduling)
SUPPLY_SD = 0.20                  # produced-water supply varies about +-20 % around the forecast
CUT_SHARE = 0.5                   # a regulator cut halves SWD capacity for the rest of the programme
LEVELS = {"high": {"wells": (4, 5), "bbl_well": (340_000, 420_000), "produced": (900_000, 1_300_000), "swd": 1_000_000},
          "low": {"wells": (1, 2), "bbl_well": (250_000, 320_000), "produced": (500_000, 800_000), "swd": 700_000}}


def cut_prob(injected, threshold, capacity):
    """Chance the regulator cuts SWD capacity after a month's injection. Zero up to the hidden threshold."""
    if injected <= threshold:
        return 0.0
    return min(0.9, 0.15 + 0.75 * (injected - threshold) / max(1.0, capacity - threshold))


def run_month(m, dec, truth, st):
    """Apply one month's decisions to the running state st (storage, pipeline, swd capacity, cut). Shared by play and the
    hindsight benchmark. dec = {fresh, recycle, swd, transport}. Returns a record with the month's costs."""
    demand = truth["demand"][m]
    produced = truth["produced"][m]
    recycled = min(dec["recycle"], produced)
    delivered = dec["fresh"] + recycled
    cost = {"fresh": dec["fresh"] * FRESH_USD_BBL,
            "treatment": dec["recycle"] * TREAT_RENT_USD_BBL + recycled * TREAT_USD_BBL,
            "pipeline_capex": 0.0, "transport": 0.0, "swd": 0.0, "commercial_disposal": 0.0, "delay_penalty": 0.0}
    if dec["transport"] == "pipeline":
        if not st["pipeline"]:
            st["pipeline"] = True
            cost["pipeline_capex"] = PIPE_CAPEX_USD
        piped = min(delivered, PIPE_CAP_BBL)
        cost["transport"] = piped * PIPE_USD_BBL + (delivered - piped) * TRUCK_USD_BBL
    else:
        cost["transport"] = delivered * TRUCK_USD_BBL
    available = st["storage"] + delivered
    used = min(available, demand)
    short = demand - used
    overflow = max(0.0, available - used - STORAGE_CAP_BBL)
    st["storage"] = available - used - overflow
    if short > 1.0:
        cost["delay_penalty"] = short * SHORT_USD_BBL + SHORT_EVENT_USD
    to_dispose = produced - recycled
    injected = min(to_dispose, dec["swd"], st["swd_cap"])
    cost["swd"] = injected * SWD_USD_BBL
    cost["commercial_disposal"] = (to_dispose - injected) * COMMERCIAL_USD_BBL
    cut = False
    if not st["cut"] and truth["u_regulator"][m] < cut_prob(injected, truth["threshold"], truth["swd_permit"]):
        st["cut"], cut = True, True
        st["swd_cap"] = truth["swd_permit"] * CUT_SHARE
    return {"month": m + 1, "demand_bbl": demand, "fresh_bbl": dec["fresh"], "treatment_capacity_bbl": dec["recycle"],
            "produced_bbl": produced, "recycled_bbl": recycled, "transport": dec["transport"], "used_bbl": used,
            "short_bbl": short, "overflow_bbl": overflow, "storage_end_bbl": st["storage"], "swd_injected_bbl": injected,
            "commercial_disposal_bbl": to_dispose - injected, "regulator_cut": cut, "cost_usd": cost,
            "total_usd": sum(cost.values())}


def start_state(truth):
    return {"storage": 0.0, "pipeline": False, "swd_cap": truth["swd_permit"], "cut": False}


def hindsight(truth):
    """Search simple plans with the truth known: pipeline from month 1, 2, 3 or never; per month recycle nothing, all the
    supply, or just what the frac needs; fresh to cover the need or to the permit; SWD at capacity or just under the hidden
    threshold. Returns (cost, plan)."""
    best = None
    swd_opts = (None, truth["threshold"] - 1.0)
    for pipe_from in (0, 1, 2, None):
        for rec in itertools.product((0, 1, 2), repeat=MONTHS):
            for fr in itertools.product((0, 1), repeat=MONTHS):
                for sw in itertools.product((0, 1), repeat=MONTHS):
                    st, total, plan = start_state(truth), 0.0, []
                    for m in range(MONTHS):
                        need = max(0.0, truth["demand"][m] - st["storage"])
                        produced = truth["produced"][m]
                        recycle = (0.0, produced, min(produced, need))[rec[m]]
                        fresh = min(FRESH_CAP_BBL, max(0.0, need - recycle)) if fr[m] == 0 else FRESH_CAP_BBL
                        swd = truth["swd_permit"] if swd_opts[sw[m]] is None else swd_opts[sw[m]]
                        dec = {"fresh": fresh, "recycle": recycle, "swd": max(0.0, swd),
                               "transport": "pipeline" if pipe_from is not None and m >= pipe_from else "trucks"}
                        total += run_month(m, dec, truth, st)["total_usd"]
                        plan.append(dec)
                        if best is not None and total >= best[0]:
                            break
                    else:
                        best = (total, plan)
    return best


class Water(base.Game):
    kind = "water"
    title = "Water Logistics"
    blurb = "Source, move and dispose of frac water: permits, recycling, layflat vs trucks, and a twitchy regulator."
    sim = False

    # ---- setup ---------------------------------------------------------------------------------------------------------
    def new(self, state, params, ctx):
        params = params if isinstance(params, dict) else {}
        level = params.get("volume", "random")
        if level not in ("random", "high", "low"):
            raise base.GameError("volume must be 'high', 'low' or 'random'")
        r = base.rng(state, "setup")
        if level == "random":
            level = r.choice(("high", "low"))
        L = LEVELS[level]
        schedule, demand, forecast, produced = [], [], [], []
        for m in range(MONTHS):
            wells = r.randint(*L["wells"])
            per = round(r.uniform(*L["bbl_well"]), -3)
            schedule.append({"month": m + 1, "wells": wells, "bbl_per_well": per, "demand_bbl": wells * per})
            demand.append(wells * per)
            f = round(r.uniform(*L["produced"]), -3)
            forecast.append(f)
        rs = base.rng(state, "supply")
        for m in range(MONTHS):
            produced.append(round(forecast[m] * min(1.5, max(0.5, 1.0 + rs.gauss(0.0, SUPPLY_SD))), -3))
        rr = base.rng(state, "regulator")
        permit = float(L["swd"])
        state["truth"] = {"demand": demand, "produced": produced, "swd_permit": permit,
                          "threshold": round(permit * rr.uniform(0.55, 0.85), -3),
                          "u_regulator": [rr.random() for _ in range(MONTHS)]}
        state.update({"month": 0, "level": level, "schedule": schedule, "forecast": forecast, "st": start_state(state["truth"]),
                      "history": []})

    # ---- actions -------------------------------------------------------------------------------------------------------
    def act(self, state, action, args, ctx):
        if action != "plan_month":
            raise base.GameError(f"unknown action '{action}'")
        st, m = state["st"], state["month"]
        fresh = base.num(args, "fresh_bbl", 0, FRESH_CAP_BBL, 0)
        recycle = base.num(args, "recycle_bbl", 0, 3_000_000, 0)
        swd = base.num(args, "swd_bbl", 0, st["swd_cap"], st["swd_cap"])
        transport = args.get("transport", "trucks")
        if transport not in ("trucks", "pipeline"):
            raise base.GameError("transport must be 'trucks' or 'pipeline'")
        rec = run_month(m, {"fresh": fresh, "recycle": recycle, "swd": swd, "transport": transport}, state["truth"], st)
        state["history"].append(rec)
        events = [f"Month {m + 1}: delivered {rec['fresh_bbl'] + rec['recycled_bbl']:,.0f} bbl "
                  f"({rec['fresh_bbl']:,.0f} fresh, {rec['recycled_bbl']:,.0f} recycled) by {transport}; "
                  f"produced water came in at {rec['produced_bbl']:,.0f} bbl. Cost ${rec['total_usd']:,.0f}."]
        if rec["cost_usd"]["pipeline_capex"]:
            events.append(f"Layflat pipeline installed (${PIPE_CAPEX_USD:,.0f}).")
        if rec["short_bbl"] > 1.0:
            events.append(f"Water ran short by {rec['short_bbl']:,.0f} bbl: frac delayed "
                          f"(${rec['cost_usd']['delay_penalty']:,.0f}).")
        if rec["overflow_bbl"] > 1.0:
            events.append(f"Storage full: {rec['overflow_bbl']:,.0f} bbl of surplus water wasted.")
        if rec["commercial_disposal_bbl"] > 1.0:
            events.append(f"{rec['commercial_disposal_bbl']:,.0f} bbl trucked to commercial disposal.")
        if rec["regulator_cut"]:
            events.append(f"Regulator: seismic activity near your SWD wells; disposal capacity cut to "
                          f"{st['swd_cap']:,.0f} bbl/month for the rest of the programme.")
        state["month"] = m + 1
        if state["month"] >= MONTHS:
            self._finish(state)
            events.append(state["result"]["headline"])
        return events

    # ---- result --------------------------------------------------------------------------------------------------------
    def _finish(self, state):
        truth, hist = state["truth"], state["history"]
        cost = sum(h["total_usd"] for h in hist)
        bench, plan = hindsight(truth)
        ratio = min(1.0, bench / cost) if cost > 0 else 1.0
        stars = base.stars_for(ratio, (0.6, 0.8, 0.92))
        short = sum(h["short_bbl"] for h in hist)
        headline = (f"Water programme cost ${cost / 1e6:,.2f}MM against ${bench / 1e6:,.2f}MM with hindsight ({100 * ratio:.0f}%)"
                    + (f"; {short:,.0f} bbl short." if short > 1.0 else "; no frac delays."))
        cats = {}
        for h in hist:
            for k, x in h["cost_usd"].items():
                cats[k] = cats.get(k, 0.0) + x
        state["status"] = "finished"
        state["result"] = {
            "score": round(100.0 * ratio, 1), "stars": stars, "headline": headline,
            "breakdown": {"total_cost_usd": round(cost), "hindsight_cost_usd": round(bench), "ratio_to_hindsight": round(ratio, 3),
                          "short_bbl": round(short), **{f"{k}_usd": round(x) for k, x in cats.items()},
                          "recycled_bbl": round(sum(h["recycled_bbl"] for h in hist)),
                          "fresh_bbl": round(sum(h["fresh_bbl"] for h in hist))},
            "lookback": {"produced_bbl": truth["produced"], "forecast_bbl": state["forecast"],
                         "regulator_threshold_bbl_month": truth["threshold"], "swd_permit_bbl_month": truth["swd_permit"],
                         "regulator_cut_chance": [round(cut_prob(h["swd_injected_bbl"], truth["threshold"], truth["swd_permit"]), 3)
                                                  for h in hist],
                         "hindsight_plan": [{"month": m + 1, "fresh_bbl": round(d["fresh"]), "recycle_bbl": round(d["recycle"]),
                                             "swd_bbl": round(d["swd"]), "transport": d["transport"]} for m, d in enumerate(plan)],
                         "hindsight_cost_usd": round(bench)}}

    # ---- view ----------------------------------------------------------------------------------------------------------
    def view(self, state):
        active = state["status"] == "active"
        st, m = state["st"], state["month"]
        hist = [{**{k: (round(x) if isinstance(x, float) else x) for k, x in h.items() if k != "cost_usd"},
                 "cost_usd": {k: round(x) for k, x in h["cost_usd"].items()}} for h in state["history"]]
        costs = {}
        for h in state["history"]:
            for k, x in h["cost_usd"].items():
                costs[k] = costs.get(k, 0.0) + x
        v = {"month": min(m + 1, MONTHS), "months": MONTHS, "volume": state["level"],
             "schedule": state["schedule"], "produced_water_forecast_bbl": state["forecast"],
             "storage_bbl": round(st["storage"]), "storage_cap_bbl": STORAGE_CAP_BBL,
             "fresh_permit_bbl_month": FRESH_CAP_BBL,
             "swd": {"capacity_bbl_month": st["swd_cap"], "permitted_bbl_month": state["truth"]["swd_permit"], "cut": st["cut"]},
             "pipeline": {"installed": st["pipeline"], "capex_usd": PIPE_CAPEX_USD, "capacity_bbl_month": PIPE_CAP_BBL,
                          "usd_bbl": PIPE_USD_BBL},
             "prices": {"fresh_usd_bbl": FRESH_USD_BBL, "treatment_rent_usd_bbl": TREAT_RENT_USD_BBL,
                        "treatment_usd_bbl": TREAT_USD_BBL, "truck_usd_bbl": TRUCK_USD_BBL, "swd_usd_bbl": SWD_USD_BBL,
                        "commercial_disposal_usd_bbl": COMMERCIAL_USD_BBL, "short_usd_bbl": SHORT_USD_BBL,
                        "short_event_usd": SHORT_EVENT_USD},
             "history": hist, "costs_usd": {k: round(x) for k, x in costs.items()},
             "total_cost_usd": round(sum(costs.values()))}
        actions = []
        if active:
            need = max(0.0, state["schedule"][m]["demand_bbl"] - st["storage"])
            actions.append({"name": "plan_month", "label": f"Run month {m + 1}", "args": {
                "fresh_bbl": base.arg("number", min=0, max=FRESH_CAP_BBL, step=10_000, unit="bbl fresh water",
                                      default=min(FRESH_CAP_BBL, round(need, -4))),
                "recycle_bbl": base.arg("number", min=0, max=3_000_000, step=10_000,
                                        unit="bbl treatment capacity rented (recycled = min(capacity, actual supply))", default=0),
                "swd_bbl": base.arg("number", min=0, max=st["swd_cap"], step=10_000,
                                    unit="bbl max into own SWD (the rest goes to commercial disposal)", default=st["swd_cap"]),
                "transport": base.arg("enum", options=["trucks", "pipeline"], default="pipeline" if st["pipeline"] else "trucks")}})
        notes = ["Honesty note: water volumes and costs are illustrative logistics; the reservoir model's fluid produces little "
                 "water, so these volumes are not from the simulator.",
                 "Produced-water supply for recycling varies around the forecast (about +-20 %); you pay for the treatment "
                 "capacity you rent even if the supply falls short. Unrecycled produced water must be disposed of.",
                 "Seismicity rule (a game rule): the regulator has an injection level for your SWD wells that it does not publish. "
                 "Above it, there is a chance - rising with the volume - that it cuts your disposal capacity "
                 f"to {CUT_SHARE:.0%} for the rest of the programme.",
                 f"Water short of the month's frac demand delays the crew: ${SHORT_USD_BBL:.2f}/bbl short plus "
                 f"${SHORT_EVENT_USD:,.0f} per month with a delay. Surplus goes to a {STORAGE_CAP_BBL:,.0f} bbl pit; overflow is wasted.",
                 "Score compares your cost with a hindsight plan that knew the supply and the regulator rule (a search over simple "
                 "plans, not a proven optimum)."]
        return {"view": v, "actions": actions, "notes": notes}


base.register(Water())
