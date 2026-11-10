"""Rig contracts: run a 24-month drilling programme in a cyclical rig market, choosing term contracts or spot rigs.

The hidden truth is a spot day-rate path: mean reversion towards the level of the current regime (a "soft" or a "tight"
market) with random regime switches. Each month the player can sign a term contract (6/12/18 months at an offered fixed rate,
with an early-release fee), hire a spot rig for the month at today's spot rate, or release a rig, then advance the month.
A rig drills about 2.5 wells a month (opecon drilling days plus a pad skid). Rigs work until the target is met; after that a
contracted rig sits on standby and still costs its standby rate. Score: the controllable cost per target well (rig rates,
mobilisation, release fees and a penalty per well short) against a hindsight plan that knew the whole rate path.
"""
import math

import opecon
from minigames import base

MONTHS = 24
HISTORY = 12                      # months of spot history shown before month 1
DESIGN = {"stage_spacing_ft": 250.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
WELL = opecon.well_estimate(DESIGN)
DAYS = opecon.MONTH_DAYS
SKID_DAYS = 0.5 * opecon.COSTS["rig_move_days"]          # pad drilling: a skid is about half a full rig move
DAYS_PER_WELL = WELL["drill_days"] + SKID_DAYS
WELLS_PER_RIG_MONTH = DAYS / DAYS_PER_WELL               # ~2.5

LONG_RUN_USD_DAY = 26_000.0      # long-run mean of the rig day rate (rig only, without crew-independent services)
REGIME_USD_DAY = {"soft": 18_000.0, "tight": 35_000.0}
REVERSION = 0.30                 # monthly pull towards the regime level
VOL_USD_DAY = 1_300.0            # monthly shock
SWITCH_PROB = 0.10               # chance a regime flips in a month
FLOOR_USD_DAY = 10_000.0
# The rest of opecon's rig spread (crew, mud, directional, services) does not move with the rig market.
SERVICES_USD_DAY = opecon.COSTS["rig_spread_usd_day"] - LONG_RUN_USD_DAY
WELL_FIXED_USD = DAYS_PER_WELL * SERVICES_USD_DAY + WELL["drilling"]["tangibles_usd"] + WELL["drilling"]["mobilisation_usd"]

TERMS_MONTHS = (6, 12, 18)
TERM_WEIGHT = {6: 0.85, 12: 0.70, 18: 0.55}              # how much a term offer follows today's spot vs the long-run mean
TERM_PREMIUM_USD_DAY = {6: 500.0, 12: 1_000.0, 18: 1_500.0}
STANDBY = 0.5                    # an idle contracted rig costs this share of its rate
RELEASE_FEE = 0.5                # early release: this share of the rate for every remaining contracted day
MOB_USD = 120_000.0              # mobilisation, per term contract and per spot hire
SHORT_PENALTY_USD = 1_500_000.0  # per well short of target at month 24 (deferred production, missed obligations)
MAX_RIGS = 6
BROKER_SD_USD_DAY = 1_800.0      # broker outlook error grows with sqrt(lead)


# ---- market ------------------------------------------------------------------------------------------------------------
def spot_path(state, start=None):
    """HISTORY months before month 1 plus MONTHS months. start='soft'|'tight' forces the regime over the last few months of
    history so the game opens in that market; after month 1 the cycle runs freely."""
    r = base.rng(state, "market")
    regime = r.choice(("soft", "tight"))
    x = REGIME_USD_DAY[regime] + r.gauss(0.0, 2_000.0)
    rates, regimes = [], []
    for i in range(HISTORY + MONTHS):
        if HISTORY - 4 <= i <= HISTORY and start in REGIME_USD_DAY:
            regime = start
        elif r.random() < SWITCH_PROB:
            regime = "tight" if regime == "soft" else "soft"
        shock = r.gauss(0.0, VOL_USD_DAY)
        x = max(FLOOR_USD_DAY, x + REVERSION * (REGIME_USD_DAY[regime] - x) + shock)
        rates.append(round(x, -2))
        regimes.append(regime)
    return rates, regimes


def term_offer(spot, months):
    w = TERM_WEIGHT[months]
    return round(w * spot + (1.0 - w) * LONG_RUN_USD_DAY + TERM_PREMIUM_USD_DAY[months], -2)


def release_fee(rig, months_left):
    return RELEASE_FEE * rig["usd_day"] * DAYS * months_left if rig["type"] == "term" else 0.0


# ---- one month of drilling, shared by the game and the hindsight benchmark ---------------------------------------------
def drill_month(rigs, need):
    """Rigs drill in order (term first, then spot) until the need is met. Returns wells drilled and cost parts."""
    drilled, rig_usd, standby_usd = 0.0, 0.0, 0.0
    for rig in sorted(rigs, key=lambda g: g["type"] != "term"):
        work = min(WELLS_PER_RIG_MONTH, max(0.0, need - drilled))
        u = work / WELLS_PER_RIG_MONTH
        drilled += work
        if rig["type"] == "term":
            rig_usd += rig["usd_day"] * DAYS * u
            standby_usd += rig["usd_day"] * DAYS * (1.0 - u) * STANDBY
        else:                                                 # a spot rig is paid in full for the month it was hired
            rig_usd += rig["usd_day"] * DAYS
    return drilled, rig_usd, standby_usd


def simulate(plan, spot, target):
    """Cost a plan [(month, 'spot'|term months)] on a known spot path. Used for the hindsight benchmark."""
    rigs, drilled, cost = [], 0.0, {"rig_usd": 0.0, "standby_usd": 0.0, "mob_usd": 0.0, "release_usd": 0.0}
    for m in range(MONTHS):
        s = spot[HISTORY + m]
        for (pm, what) in plan:
            if pm == m:
                cost["mob_usd"] += MOB_USD
                if what == "spot":
                    rigs.append({"type": "spot", "usd_day": s, "end": m})
                else:
                    rigs.append({"type": "term", "usd_day": term_offer(s, what), "end": m + what - 1})
        d, ru, su = drill_month(rigs, target - drilled)
        drilled += d
        cost["rig_usd"] += ru
        cost["standby_usd"] += su
        rigs = [g for g in rigs if g["end"] > m]
    for g in rigs:                                           # contracts running past month 24 are released
        cost["release_usd"] += release_fee(g, g["end"] - (MONTHS - 1))
    short = max(0.0, target - drilled)
    total = sum(cost.values()) + SHORT_PENALTY_USD * short
    return total, drilled


def hindsight(spot, target):
    """Greedy cheapest-rig-month plan with perfect knowledge of the path, costed by simulate(). A strong heuristic, not
    a proven optimum: it adds the unit (a spot month or a term contract) with the lowest cost per useful rig-month."""
    def plan_for(allow_terms):
        need = target / WELLS_PER_RIG_MONTH
        busy = [0] * MONTHS
        plan = []
        while need > 1e-9:
            best = None
            for m in range(MONTHS):
                s = spot[HISTORY + m]
                if busy[m] < MAX_RIGS:
                    useful = min(1.0, need)
                    c = (s * DAYS + MOB_USD) / useful
                    if best is None or c < best[0]:
                        best = (c, m, "spot", [m], useful)
                if not allow_terms:
                    continue
                for t in TERMS_MONTHS:
                    span = list(range(m, min(MONTHS, m + t)))
                    if any(busy[k] >= MAX_RIGS for k in span):
                        continue
                    rate = term_offer(s, t)
                    useful = min(len(span), need)
                    cost = (rate * DAYS * (useful + (len(span) - useful) * STANDBY) + MOB_USD
                            + RELEASE_FEE * rate * DAYS * (m + t - MONTHS if m + t > MONTHS else 0))
                    c = cost / useful
                    if best is None or c < best[0]:
                        best = (c, m, t, span, useful)
            if best is None:
                break
            _, m, what, span, useful = best
            plan.append((m, what))
            for k in span:
                busy[k] += 1
            need -= useful
        return plan
    options = []
    for allow in (True, False):
        p = plan_for(allow)
        options.append((simulate(p, spot, target)[0], p))
    return min(options, key=lambda o: o[0])


def _r(x, nd=0):
    return round(x, nd) if x is not None else None


class RigContracts(base.Game):
    kind = "rig-contracts"
    title = "Rig Contracts"
    blurb = "Term or spot? Drill your programme through a rig-rate cycle without stranding rigs."
    sim = False

    # ---- setup ---------------------------------------------------------------------------------------------------------
    def new(self, state, params, ctx):
        params = params if isinstance(params, dict) else {}
        target = int(base.num(params, "target_wells", 10, 150, 75))
        start = params.get("market")
        if start not in (None, "random", "soft", "tight"):
            raise base.GameError("market must be 'soft', 'tight' or 'random'")
        spot, regimes = spot_path(state, start)
        state["truth"] = {"spot_usd_day": spot, "regime": regimes}
        state.update({"month": 0, "target_wells": target, "wells_drilled": 0.0, "rigs": [], "next_rig": 1,
                      "costs": {"rig_usd": 0.0, "standby_usd": 0.0, "mob_usd": 0.0, "release_usd": 0.0, "well_usd": 0.0},
                      "history": {"rigs": [], "wells": []}, "outlooks": {}})
        self._outlook(state)

    def _spot(self, state, m=None):
        return state["truth"]["spot_usd_day"][HISTORY + (state["month"] if m is None else m)]

    def _outlook(self, state):
        """The broker's noisy 3-month outlook, drawn once per month so it is stable within the month."""
        m = state["month"]
        out = []
        for k in (1, 2, 3):
            if m + k >= MONTHS:
                break
            e = base.rng(state, "broker", m, k).gauss(0.0, BROKER_SD_USD_DAY * math.sqrt(k))
            out.append({"month": m + k + 1, "usd_day": round(max(FLOOR_USD_DAY, self._spot(state, m + k) + e), -2)})
        state["outlooks"][str(m)] = out

    # ---- actions -------------------------------------------------------------------------------------------------------
    def act(self, state, action, args, ctx):
        m, s = state["month"], self._spot(state)
        rigs = state["rigs"]
        if action in ("contract", "hire_spot") and len(rigs) >= MAX_RIGS:
            raise base.GameError(f"you can run at most {MAX_RIGS} rigs")
        if action == "contract":
            t = int(base.num(args, "months", 6, 18))
            if t not in TERMS_MONTHS:
                raise base.GameError(f"months must be one of {list(TERMS_MONTHS)}")
            rate = term_offer(s, t)
            rid = f"R{state['next_rig']}"
            state["next_rig"] += 1
            rigs.append({"id": rid, "type": "term", "usd_day": rate, "start": m, "end": m + t - 1})
            state["costs"]["mob_usd"] += MOB_USD
            return [f"Month {m + 1}: contracted {rid} for {t} months at ${rate:,.0f}/day (mobilisation ${MOB_USD:,.0f})."]
        if action == "hire_spot":
            rid = f"R{state['next_rig']}"
            state["next_rig"] += 1
            rigs.append({"id": rid, "type": "spot", "usd_day": s, "start": m, "end": m})
            return [f"Month {m + 1}: hired spot rig {rid} for this month at ${s:,.0f}/day."]
        if action == "release":
            rid = args.get("rig")
            rig = next((g for g in rigs if g["id"] == rid), None)
            if rig is None:
                raise base.GameError(f"rig must be one of {[g['id'] for g in rigs]}")
            rigs.remove(rig)
            if rig["type"] == "spot":                         # not yet on location: cancelling costs nothing
                return [f"Month {m + 1}: cancelled spot rig {rid}."]
            fee = release_fee(rig, rig["end"] - m + 1)
            state["costs"]["release_usd"] += fee
            return [f"Month {m + 1}: released {rid} early, fee ${fee:,.0f}."]
        if action == "next_month":
            return self._advance(state)
        if action == "finish":
            events = [f"Programme closed after month {m}."]
            for g in list(rigs):
                fee = release_fee(g, g["end"] - m + 1)
                state["costs"]["release_usd"] += fee
                if fee:
                    events.append(f"Released {g['id']}, fee ${fee:,.0f}.")
            state["rigs"] = []
            self._finish(state)
            return events + [state["result"]["headline"]]
        raise base.GameError(f"unknown action '{action}'")

    def _advance(self, state):
        m, rigs = state["month"], state["rigs"]
        need = state["target_wells"] - state["wells_drilled"]
        drilled, rig_usd, standby_usd = drill_month(rigs, need)
        spot_hires = sum(1 for g in rigs if g["type"] == "spot")
        c = state["costs"]
        c["rig_usd"] += rig_usd
        c["standby_usd"] += standby_usd
        c["mob_usd"] += spot_hires * MOB_USD
        c["well_usd"] += drilled * WELL_FIXED_USD
        state["wells_drilled"] += drilled
        state["history"]["rigs"].append(len(rigs))
        state["history"]["wells"].append(round(drilled, 2))
        events = [f"Month {m + 1}: {len(rigs)} rig(s) drilled {drilled:.1f} wells "
                  f"({state['wells_drilled']:.1f} of {state['target_wells']})."]
        state["rigs"] = [g for g in rigs if g["end"] > m]
        state["month"] = m + 1
        if state["month"] >= MONTHS:
            for g in state["rigs"]:
                fee = release_fee(g, g["end"] - (MONTHS - 1))
                c["release_usd"] += fee
                events.append(f"{g['id']} still had {g['end'] - MONTHS + 1} months to run: release fee ${fee:,.0f}.")
            state["rigs"] = []
            self._finish(state)
            events.append(state["result"]["headline"])
        else:
            self._outlook(state)
            events.append(f"Spot rate now ${self._spot(state):,.0f}/day.")
        return events

    # ---- result --------------------------------------------------------------------------------------------------------
    def _finish(self, state):
        c, target = state["costs"], state["target_wells"]
        short = max(0.0, target - state["wells_drilled"])
        controllable = c["rig_usd"] + c["standby_usd"] + c["mob_usd"] + c["release_usd"] + SHORT_PENALTY_USD * short
        spot = state["truth"]["spot_usd_day"]
        bench, plan = hindsight(spot, target)
        ratio = bench / controllable if controllable > 0 else 1.0
        stars = base.stars_for(ratio, (0.65, 0.8, 0.92))
        per_well = controllable / target
        drilled = state["wells_drilled"]
        all_in = (controllable + c["well_usd"]) / drilled if drilled > 0 else None
        headline = (f"Drilled {drilled:.1f} of {target} wells. Rig cost ${per_well / 1e3:,.0f}k per target well "
                    f"against ${bench / target / 1e3:,.0f}k with hindsight ({100 * ratio:.0f}%).")
        state["status"] = "finished"
        state["result"] = {
            "score": round(100.0 * ratio, 1), "stars": stars, "headline": headline,
            "breakdown": {"wells_drilled": round(drilled, 1), "target_wells": target, "wells_short": round(short, 1),
                          "rig_cost_per_target_well_usd": round(per_well), "hindsight_cost_per_target_well_usd": round(bench / target),
                          "rig_day_rates_usd": round(c["rig_usd"]), "standby_usd": round(c["standby_usd"]),
                          "mobilisation_usd": round(c["mob_usd"]), "release_fees_usd": round(c["release_usd"]),
                          "shortfall_penalty_usd": round(SHORT_PENALTY_USD * short),
                          "all_in_cost_per_well_drilled_usd": _r(all_in), "ratio_to_hindsight": round(ratio, 3)},
            "lookback": {"month": list(range(1 - HISTORY, MONTHS + 1)), "spot_usd_day": spot,
                         "regime": state["truth"]["regime"],
                         "hindsight_plan": [{"month": pm + 1, "hire": "spot" if w == "spot" else f"{w}-month term",
                                             "usd_day": spot[HISTORY + pm] if w == "spot" else term_offer(spot[HISTORY + pm], w)}
                                            for pm, w in sorted(plan, key=lambda p: p[0])],
                         "hindsight_cost_usd": round(bench)}}

    # ---- view ----------------------------------------------------------------------------------------------------------
    def view(self, state):
        active = state["status"] == "active"
        m = state["month"]
        shown = HISTORY + min(m + 1, MONTHS) if active else HISTORY + MONTHS   # spot is known up to the current month
        spot = state["truth"]["spot_usd_day"][:shown]
        h = state["history"]
        v = {"month": min(m + 1, MONTHS), "months": MONTHS, "target_wells": state["target_wells"],
             "wells_drilled": round(state["wells_drilled"], 2), "wells_per_rig_month": round(WELLS_PER_RIG_MONTH, 2),
             # average rigs a month still needed to finish on time, counting the current month
             "rigs_needed_per_month": round(max(0.0, state["target_wells"] - state["wells_drilled"]) / WELLS_PER_RIG_MONTH
                                            / max(1, MONTHS - m), 2) if active else 0.0,
             "market": {"month": list(range(1 - HISTORY, 1 - HISTORY + len(spot))), "spot_usd_day": spot,
                        "spot_now_usd_day": spot[-1],
                        "term_offers": [{"months": t, "usd_day": term_offer(spot[-1], t)} for t in TERMS_MONTHS] if active else [],
                        "broker_outlook": state["outlooks"].get(str(m), []) if active else [],
                        "long_run_usd_day": LONG_RUN_USD_DAY},
             "fleet": [{"id": g["id"], "type": g["type"], "until_month": g["end"] + 1, "usd_day": g["usd_day"],
                        "release_fee_usd": round(release_fee(g, g["end"] - m + 1))} for g in state["rigs"]],
             "utilisation": {"month": list(range(1, len(h["rigs"]) + 1)),
                             "used": [round(w / WELLS_PER_RIG_MONTH, 2) for w in h["wells"]], "contracted": h["rigs"]},
             "costs_usd": {k: round(x) for k, x in state["costs"].items()},
             "terms": {"standby_share": STANDBY, "release_fee_share": RELEASE_FEE, "mobilisation_usd": MOB_USD,
                       "short_penalty_usd_well": SHORT_PENALTY_USD, "max_rigs": MAX_RIGS, "well_fixed_usd": round(WELL_FIXED_USD)}}
        actions = []
        if active:
            if len(state["rigs"]) < MAX_RIGS:
                actions.append({"name": "contract", "label": "Contract a rig on term",
                                "args": {"months": base.arg("enum", options=list(TERMS_MONTHS), unit="months")}})
                actions.append({"name": "hire_spot", "label": f"Hire a spot rig for month {m + 1} at ${spot[-1]:,.0f}/day", "args": {}})
            if state["rigs"]:
                actions.append({"name": "release", "label": "Release a rig",
                                "args": {"rig": base.arg("enum", options=[g["id"] for g in state["rigs"]])}})
            actions.append({"name": "next_month", "label": f"Drill month {m + 1}", "args": {}})
            if state["wells_drilled"] >= state["target_wells"] - 1e-9:
                actions.append({"name": "finish", "label": "Close the programme (release remaining rigs)", "args": {}})
        notes = ["Economics are illustrative: rig day rates are a made-up two-regime market around the game's opecon rig spread; "
                 "services, tangibles and per-well mobilisation are a fixed cost per well and do not move with the market.",
                 f"A rig drills about {WELLS_PER_RIG_MONTH:.1f} wells a month (opecon drilling days plus a pad skid), with no NPT, "
                 "weather, crew or permit delays, and no learning curve.",
                 f"Rigs work until the target is met; an idle term rig then costs {STANDBY:.0%} of its rate. Early release costs "
                 f"{RELEASE_FEE:.0%} of the rate for every remaining day; contracts that run past month {MONTHS} are released at the end.",
                 f"Each well short of target at month {MONTHS} costs ${SHORT_PENALTY_USD / 1e6:.1f}MM. The broker outlook is noisy "
                 "and gets worse further out. Score is compared with a hindsight plan (a greedy heuristic, not a proven optimum)."]
        return {"view": v, "actions": actions, "notes": notes}


base.register(RigContracts())
