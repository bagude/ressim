"""Land auction ("transfer market"): a sealed-bid, first-price lease sale against three AI rival operators.

Four rounds, two or three tracts a round. A tract is a one-mile section with a known well count (public spacing rules) and a
hidden EUR per well. Everyone sees only a noisy analog estimate; the player can pay for appraisal to narrow it. Rivals bid a
shaded fraction of the value of their own noisy estimate, so whoever wins a tract is likely the most optimistic bidder:
the winner's curse. Values come from opecon (price deck, terms, AFE capex) on an Arps-shaped profile scaled to the EUR.
Money in USD internally; bids are entered in USD millions.
"""
import math
from functools import lru_cache

import opecon
from minigames import base

ROUNDS = 4
BUDGET_USD = 60e6
APPRAISAL_USD = 150_000.0
ANALOG_SIGMA = 0.25              # log-sd of the analog EUR estimate everyone starts from
APPRAISAL_SIGMA = 0.08           # log-sd after appraisal
Z90 = 1.2816                     # P10/P90 sit 1.28 sd from the median
EUR_MEDIAN_BOE = 650_000.0
EUR_SIGMA = 0.30                 # spread of true EUR across tracts
OIL_FRACTION = 0.65              # share of BOE that is oil; the rest is gas at 6 Mcf/BOE
WATER_OIL_RATIO = 1.5
MONTHS = 360
ARPS_B, ARPS_DI = 1.1, 0.12      # hyperbolic exponent and initial monthly nominal decline
DESIGN = {"stage_spacing_ft": 250.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
BENCH_FRACTION = 0.8             # perfect-information benchmark bids true value x 0.8 on positive tracts
RIVALS = ["Caprock Energy", "Mesa Ridge Oil", "Two Forks Resources"]
PLAYER = "You"
SLOTS = "abc"
MM = 1e6


def _unit_cash():
    """opecon.net_cash is linear in volumes, so one BOE of this stream and one producing well give the monthly cash exactly."""
    oil = OIL_FRACTION
    per_boe = opecon.net_cash(oil, (1.0 - OIL_FRACTION) * opecon.TERMS["boe_mcf"], oil * WATER_OIL_RATIO, 0)["net_usd"]
    per_well = opecon.net_cash(0.0, 0.0, 0.0, 1)["net_usd"]
    return per_boe, per_well


PER_BOE_USD, PER_WELL_MONTH_USD = _unit_cash()
SHAPE = [(1.0 + ARPS_B * ARPS_DI * (m + 0.5)) ** (-1.0 / ARPS_B) for m in range(MONTHS)]
SHAPE_SUM = sum(SHAPE)
CAPEX_USD = opecon.well_estimate(DESIGN)["total_usd"]
DISC = [opecon.disc_factor(m, opecon.TERMS["discount_rate"]) for m in range(MONTHS)]


@lru_cache(maxsize=8192)
def _npv_per_well(eur_rounded):
    op = []
    for sh in SHAPE:
        cash = PER_BOE_USD * eur_rounded * sh / SHAPE_SUM + PER_WELL_MONTH_USD
        if cash <= 0.0:          # the well is shut in at its economic limit
            break
        op.append(cash)
    # NPV10 as opecon.measures computes it (mid-month discounting, capex in month 0), without its IRR search
    return sum(c * d for c, d in zip(op, DISC)) - CAPEX_USD * DISC[0]


def npv_per_well(eur_boe):
    """NPV10 of one well: Arps-shaped monthly profile scaled to the EUR, cut at the economic limit, AFE capex in month 0."""
    return _npv_per_well(round(eur_boe, -2))


def tract_value(eur_boe, wells):
    return wells * npv_per_well(eur_boe)


def _r(x, nd=0):
    return round(x, nd) if x is not None else None


class LandAuction(base.Game):
    kind = "land-auction"
    title = "Land Auction"
    blurb = "Sealed-bid lease sale against three rival operators. Bid on noisy estimates and beware the winner's curse."
    sim = False

    # ---- setup ---------------------------------------------------------------------------------------------------------
    def new(self, state, params, ctx):
        r = base.rng(state, "tracts")
        rivals = []
        for name in RIVALS:
            rr = base.rng(state, "rival", name)
            rivals.append({"name": name, "noise": rr.uniform(0.10, 0.25), "shade": rr.uniform(0.40, 0.65),
                           "sit_out": rr.uniform(0.05, 0.20)})
        tracts, truth, n = [], {"rivals": rivals, "tracts": {}}, 0
        for rd in range(ROUNDS):
            for k in range(r.choice((2, 3))):
                n += 1
                tid = f"T{n}"
                eur = EUR_MEDIAN_BOE * math.exp(r.gauss(0.0, EUR_SIGMA))
                wells = r.randint(4, 8)
                analog = eur * math.exp(r.gauss(0.0, ANALOG_SIGMA))
                rbids = {}
                for rv in rivals:      # each rival values the tract on its own noisy read and shades its bid
                    rr = base.rng(state, "rivalbid", rv["name"], tid)
                    est = eur * math.exp(rr.gauss(0.0, rv["noise"]))
                    val = tract_value(est, wells)
                    bid = rv["shade"] * val if val > 0 and rr.random() >= rv["sit_out"] else 0.0
                    rbids[rv["name"]] = {"estimate_eur_boe": est, "bid_usd": round(bid, -3)}
                truth["tracts"][tid] = {"eur_boe": eur, "npv_per_well_usd": npv_per_well(eur),
                                        "value_usd": tract_value(eur, wells), "rival_bids": rbids}
                tracts.append({"id": tid, "round": rd, "slot": SLOTS[k], "wells": wells, "analog_eur_boe": analog,
                               "appraised_eur_boe": None, "winner": None, "price_usd": None, "bids": None})
        state.update({"truth": truth, "tracts": tracts, "round": 0, "budget_usd": BUDGET_USD, "paid_usd": 0.0,
                      "appraisal_usd": 0.0})

    # ---- helpers -------------------------------------------------------------------------------------------------------
    def _round_tracts(self, state):
        return [t for t in state["tracts"] if t["round"] == state["round"]]

    def _estimate(self, t):
        """What the player knows: median EUR and P90/P10 range, with the per-well and tract value at the median."""
        mid, sig = (t["appraised_eur_boe"], APPRAISAL_SIGMA) if t["appraised_eur_boe"] else (t["analog_eur_boe"], ANALOG_SIGMA)
        lo, hi = mid * math.exp(-Z90 * sig), mid * math.exp(Z90 * sig)
        return {"eur_p50_boe": _r(mid), "eur_p90_boe": _r(lo), "eur_p10_boe": _r(hi), "source": "appraisal" if t["appraised_eur_boe"] else "analogs",
                "value_p50_usd": _r(tract_value(mid, t["wells"]), -3), "value_p90_usd": _r(tract_value(lo, t["wells"]), -3),
                "value_p10_usd": _r(tract_value(hi, t["wells"]), -3)}

    # ---- actions -------------------------------------------------------------------------------------------------------
    def act(self, state, action, args, ctx):
        cur = self._round_tracts(state)
        if action == "appraise":
            tid = args.get("tract")
            t = next((x for x in cur if x["id"] == tid), None)
            if t is None:
                raise base.GameError(f"tract must be one of {[x['id'] for x in cur]}")
            if t["appraised_eur_boe"]:
                raise base.GameError(f"{tid} has already been appraised")
            if state["budget_usd"] < APPRAISAL_USD:
                raise base.GameError("not enough budget for an appraisal")
            eur = state["truth"]["tracts"][tid]["eur_boe"]
            t["appraised_eur_boe"] = eur * math.exp(base.rng(state, "appraisal", tid).gauss(0.0, APPRAISAL_SIGMA))
            state["budget_usd"] -= APPRAISAL_USD
            state["appraisal_usd"] += APPRAISAL_USD
            e = self._estimate(t)
            return [f"Appraisal of {tid}: EUR {e['eur_p90_boe'] / 1e3:.0f}-{e['eur_p10_boe'] / 1e3:.0f} kBOE per well "
                    f"(P50 {e['eur_p50_boe'] / 1e3:.0f}), cost ${APPRAISAL_USD / MM:.2f}MM."]
        if action == "bid":
            bids = {}
            for t in cur:
                bids[t["id"]] = base.num(args, f"bid_{t['slot']}", 0.0, BUDGET_USD / MM, 0.0) * MM
            total = sum(bids.values())
            if total > state["budget_usd"] + 1.0:
                raise base.GameError(f"your bids total ${total / MM:.1f}MM but only ${state['budget_usd'] / MM:.1f}MM of budget is left "
                                     "(you could win every tract, so the total must fit)")
            return self._resolve(state, cur, bids)
        raise base.GameError(f"unknown action '{action}'")

    def _resolve(self, state, cur, bids):
        events = [f"Round {state['round'] + 1} bids opened."]
        for t in cur:
            book = {name: b["bid_usd"] for name, b in state["truth"]["tracts"][t["id"]]["rival_bids"].items()}
            book[PLAYER] = round(bids[t["id"]], -3)
            t["bids"] = book                                   # lease sales publish every bid once opened
            best = max(book.values())
            if best <= 0:
                events.append(f"{t['id']}: no bids, the tract stays unleased.")
                continue
            # Rivals win ties: the player has to beat the field, not match it.
            winner = next(n for n in RIVALS + [PLAYER] if book[n] == best)
            t["winner"], t["price_usd"] = winner, best
            if winner == PLAYER:
                state["budget_usd"] -= best
                state["paid_usd"] += best
            events.append(f"{t['id']}: won by {winner} at ${best / MM:.2f}MM.")
        state["round"] += 1
        if state["round"] >= ROUNDS:
            self._finish(state)
            events.append(f"Sale closed. {state['result']['headline']}")
        return events

    # ---- result --------------------------------------------------------------------------------------------------------
    def _finish(self, state):
        truth = state["truth"]["tracts"]
        won = [t for t in state["tracts"] if t["winner"] == PLAYER]
        value_won = sum(truth[t["id"]]["value_usd"] for t in won)
        created = value_won - state["paid_usd"] - state["appraisal_usd"]

        # Perfect-information benchmark: round by round, bid 0.8 x true value on positive tracts against the same rival bids,
        # under the same budget rule as the player (the round's bids must fit the budget left).
        bench, bench_won, bench_budget = 0.0, [], BUDGET_USD
        for rd in range(ROUNDS):
            bids = {t["id"]: BENCH_FRACTION * truth[t["id"]]["value_usd"] for t in state["tracts"]
                    if t["round"] == rd and truth[t["id"]]["value_usd"] > 0}
            total = sum(bids.values())
            if total > bench_budget:
                bids = {k: b * bench_budget / total for k, b in bids.items()}
            for tid, b in bids.items():
                if b > max(x["bid_usd"] for x in truth[tid]["rival_bids"].values()):
                    bench += truth[tid]["value_usd"] - b
                    bench_budget -= b
                    bench_won.append(tid)

        # Winner's curse across every leased tract, whoever won it.
        sold = [t for t in state["tracts"] if t["winner"]]
        overpaid = [t for t in sold if t["price_usd"] > truth[t["id"]]["value_usd"]]
        rival_sold = [t for t in sold if t["winner"] != PLAYER]
        bias = [truth[t["id"]]["rival_bids"][t["winner"]]["estimate_eur_boe"] / truth[t["id"]]["eur_boe"] for t in rival_sold]
        winner_gain = sum(truth[t["id"]]["value_usd"] - t["price_usd"] for t in sold)

        if bench > 0:
            ratio = created / bench
            stars = base.stars_for(ratio, (0.15, 0.4, 0.7)) if created > 0 else 0
        else:                                    # nothing was worth winning: staying out of trouble is a perfect score
            ratio = 1.0 if created >= 0 else 0.0
            stars = 3 if created >= 0 else 0
        headline = (f"You leased {len(won)} tract(s) and created ${created / MM:.1f}MM of value "
                    f"({100 * ratio:.0f}% of the perfect-information benchmark ${bench / MM:.1f}MM). "
                    f"Winners overpaid on {len(overpaid)} of {len(sold)} tracts.")
        # Lookback keyed by tract id. paid_usd is what the winner paid (0 if unleased), so true_value_usd - paid_usd is the
        # winner's gain: negative gains are the winner's curse.
        lookback = {t["id"]: {"round": t["round"] + 1, "wells": t["wells"], "winner": t["winner"],
                              "paid_usd": t["price_usd"] or 0.0, "your_bid_usd": (t["bids"] or {}).get(PLAYER),
                              "true_value_usd": _r(truth[t["id"]]["value_usd"], -3),
                              "true_eur_boe": _r(truth[t["id"]]["eur_boe"]),
                              "npv_per_well_usd": _r(truth[t["id"]]["npv_per_well_usd"], -3),
                              "analog_eur_boe": _r(t["analog_eur_boe"]), "appraised_eur_boe": _r(t["appraised_eur_boe"]),
                              "bids_usd": t["bids"],
                              "rival_estimates_eur_boe": {n: _r(b["estimate_eur_boe"]) for n, b in truth[t["id"]]["rival_bids"].items()},
                              "benchmark_won": t["id"] in bench_won} for t in state["tracts"]}
        profiles = "; ".join(f"{rv['name']}: estimate noise {100 * rv['noise']:.0f}%, bids {100 * rv['shade']:.0f}% of its value"
                             for rv in state["truth"]["rivals"])
        state["status"] = "finished"
        state["result"] = {"score": round(100.0 * ratio, 1), "stars": stars, "headline": headline,
                           "breakdown": {"value_won_usd": _r(value_won, -3), "paid_usd": _r(state["paid_usd"], -3),
                                         "appraisal_usd": _r(state["appraisal_usd"]), "value_created_usd": _r(created, -3),
                                         "benchmark_usd": _r(bench, -3), "ratio_to_benchmark": _r(ratio, 3),
                                         "tracts_won": len(won), "tracts_sold": len(sold), "winners_overpaid": len(overpaid),
                                         "all_winners_net_value_usd": _r(winner_gain, -3),
                                         "rival_winner_eur_bias": _r(sum(bias) / len(bias), 3) if bias else None,
                                         "rival_profiles": profiles},
                           "lookback": lookback}

    # ---- view ----------------------------------------------------------------------------------------------------------
    def view(self, state):
        active = state["status"] == "active"
        cur = self._round_tracts(state) if active else []
        tracts = []
        for t in state["tracts"]:
            if t["round"] > state["round"]:
                continue                                      # later rounds are not announced yet
            bids = t["bids"]
            e = self._estimate(t)
            appraisal = (f"{e['eur_p90_boe'] / 1e3:.0f}-{e['eur_p10_boe'] / 1e3:.0f} kBOE/well" if t["appraised_eur_boe"] else None)
            tracts.append({"id": t["id"], "round": t["round"] + 1, "slot": t["slot"], "acres": 640, "wells": t["wells"],
                           "open": active and t["round"] == state["round"], "appraised": bool(t["appraised_eur_boe"]),
                           "estimate": e, "hint": {"analog_eur_bbl": _r(t["analog_eur_boe"]), "appraisal": appraisal},
                           "your_bid_usd": bids[PLAYER] if bids else None, "winner": t["winner"], "winning_bid_usd": t["price_usd"],
                           "rival_bids_usd": [bids[n] for n in RIVALS] if bids else None, "bids": bids})
        v = {"round": min(state["round"] + 1, ROUNDS), "rounds": ROUNDS, "budget_usd": round(state["budget_usd"]),
             "start_budget_usd": BUDGET_USD, "paid_usd": round(state["paid_usd"]), "appraisal_usd": state["appraisal_usd"],
             "appraisal_cost_usd": APPRAISAL_USD, "rivals": RIVALS, "tracts": tracts,
             "won": [t["id"] for t in state["tracts"] if t["winner"] == PLAYER]}
        actions = []
        if active:
            left = [t["id"] for t in cur if not t["appraised_eur_boe"]]
            if left and state["budget_usd"] >= APPRAISAL_USD:
                actions.append({"name": "appraise", "label": f"Buy appraisal (${APPRAISAL_USD / MM:.2f}MM)",
                                "args": {"tract": base.arg("enum", options=left)}})
            cap = round(state["budget_usd"] / MM, 1)
            actions.append({"name": "bid", "label": "Submit sealed bids",
                            "args": {f"bid_{t['slot']}": base.arg("number", min=0, max=cap, step=0.1, unit="USD MM",
                                                                   label=f"{t['id']} ({t['wells']} wells)")
                                     for t in cur}})
        notes = ["Economics are illustrative: one price deck, fixed terms and an AFE-style well cost from the game's opecon model, "
                 "an Arps-shaped profile scaled to EUR, NPV10 at the mid-month convention.",
                 "Tract value = wells x NPV10 per well. Bonus is paid up front; no royalty negotiation, lease terms, "
                 "drilling obligations, timing of development or price risk.",
                 "Rivals bid on their own noisy estimates with hidden accuracy and shading. Highest bid wins and pays its bid; "
                 "rivals win ties. All bids are published once a round is opened.",
                 f"Estimates show P90-P50-P10 EUR per well; appraisal (${APPRAISAL_USD / MM:.2f}MM, once per tract) narrows the "
                 "range but is still not the truth."]
        return {"view": v, "actions": actions, "notes": notes}


base.register(LandAuction())
