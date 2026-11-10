"""Acquisition (#4, A&D): an operator is selling a package of sections with producing wells and some undeveloped
inventory. You get the data room (every well's real monthly production), the seller's case, and one sealed bid against
three rivals. Win, and the sections and wells join your field.

Physics: the package's wells are simulated by ressim on the package's own hidden rock, like your inherited wells (one
repeating stage per well, the career's rock where the package sits). Game rules (labelled): the seller's case is built
the way sellers build them (decline fits with the hyperbolic tail uncapped, inventory at the data room's best wells); the
rivals each bid a shaded share of their own noisy estimate of the true value; the inventory is valued at 4 standard
wells per undeveloped section.
"""
import math

import field
import opecon
import typecurve
from minigames import base

PRICE_USD_BBL = 70.0
RIVALS = ["Caprock Energy", "Mesa Ridge Oil", "Two Forks Resources"]
RIVAL_SIGMA = 0.25
RIVAL_SHADE = (0.70, 0.90)
INVENTORY_WELLS = 4
STD_DESIGN = {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
LIFE = 240
NOTES = [__doc__.split("\n\n")[1].replace("\n", " "),
         "Values are NPV10 at a flat $70 oil price, before tax, gross volumes as everywhere in the career.",
         "Your bid is final. Winning at a price above the package's true value destroys value: the winner's curse."]


def _gor():
    return 1.0


def _pv(oil, start=0):
    deck = dict(opecon.PRICE_DECK, oil_usd_bbl=PRICE_USD_BBL)
    v = 0.0
    for k, q in enumerate(oil):
        c = opecon.net_cash(q, q * _gor(), 0.0, 1, deck=deck)["net_usd"]
        if c <= 0:
            break
        v += c * opecon.disc_factor(start + k + 1, opecon.TERMS["discount_rate"])
    return v


def _headline(won, bid, created, bench, top_name, top, true_value):
    if won:
        return f"You won at ${bid / 1e6:.1f} MM; value created ${created / 1e6:.1f} MM, " + base.versus(created, bench, "the perfect-information bid")
    if bench <= 0:
        return (f"The best play was to walk away: {top_name} won at ${top / 1e6:.1f} MM and overpaid by "
                f"${(top - true_value) / 1e6:.1f} MM.")
    return f"{top_name} won at ${top / 1e6:.1f} MM; a bid just above it would have created ${bench / 1e6:.1f} MM."


class Acquisition(base.Game):
    kind = "acquisition"
    title = "Acquisition"
    blurb = "A package of producing sections is for sale: read the data room, discount the seller's case, bid once."
    sim = False                                           # bidding needs no simulator; building the data room does (checked)

    def new(self, state, params, ctx):
        if ctx.truth_sim is None:
            raise base.GameError("the data room needs the simulator; the server was started with --no-sim")
        r = base.rng(state, "package")
        if params.get("career"):
            pkg = params["package"]                      # {sections: [{section, col, row, rock, developed}], wells: [...]}
        else:
            rock = field.make_rock(state["seed"])
            picks = r.sample(rock, 3)
            secs = [{"section": f"X{i + 1}", "col": i, "row": 9, "rock": dict(p, section=f"X{i + 1}"), "developed": i < 2} for i, p in enumerate(picks)]
            wells = []
            for s in secs:
                if not s["developed"]:
                    continue
                for k in range(r.randint(3, 4)):
                    wells.append({"id": f"{s['section']}-{k + 1:02d}", "section": s["section"], "lateral_ft": opecon.LATERAL_FT,
                                  "wells_per_section": 4, "design": dict(field.ANALOG_DESIGNS[r.randrange(len(field.ANALOG_DESIGNS))]),
                                  "age_months": r.randint(6, 36), "well_factor": math.exp(r.gauss(0, 0.12)), "noise_seed": r.randint(0, 10 ** 9)})
            pkg = {"sections": secs, "wells": wells}
        rock_of = {s["section"]: s["rock"] for s in pkg["sections"]}
        room, true_pdp = [], 0.0
        seller_pdp = 0.0
        for w in pkg["wells"]:
            stage = ctx.truth_sim.stage_curve(field.spec_for(rock_of[w["section"]], w["design"], w["wells_per_section"]))
            n = max(1, round(w["lateral_ft"] / w["design"]["stage_spacing_ft"]))
            curve = field.well_curve(stage, n, w["well_factor"], w["noise_seed"])["oil"]
            hist = [round(x, 1) for x in curve[:w["age_months"]]]
            room.append({"id": w["id"], "section": w["section"], "lateral_ft": w["lateral_ft"], "design": w["design"],
                         "wells_per_section": w["wells_per_section"], "months": len(hist), "oil_bbl": hist})
            true_pdp += _pv(curve[w["age_months"]:LIFE])
            f = typecurve.fit(typecurve.align_peak(hist), b_max=2.0)       # the seller's fit: tail uncapped
            if f:
                age = len(typecurve.align_peak(hist))
                seller_pdp += _pv([typecurve.arps_rate(age + k + 0.5, f["qi"], f["di"], f["b"], f["dmin"]) for k in range(LIFE - w["age_months"])])
        capex = opecon.well_estimate(STD_DESIGN)["total_usd"]
        true_inv = seller_inv = 0.0
        best = sorted((sum(x["oil_bbl"][:6]) / max(1, min(6, x["months"])) for x in room), reverse=True)
        for s in pkg["sections"]:
            if s["developed"]:
                continue
            stage = ctx.truth_sim.stage_curve(field.spec_for(s["rock"], STD_DESIGN, INVENTORY_WELLS))
            n = round(opecon.LATERAL_FT / STD_DESIGN["stage_spacing_ft"])
            curve = [x * n for x in stage["oil"]]
            true_inv += INVENTORY_WELLS * (_pv(curve[:LIFE], 6) - capex)
            if best:                                     # the seller: inventory at the best data-room wells' early rate
                scale = best[0] / max(1.0, sum(curve[:6]) / 6)
                seller_inv += INVENTORY_WELLS * (_pv([x * scale for x in curve[:LIFE]], 6) - capex)
        true_value = true_pdp + max(0.0, true_inv)
        bids = {}
        for nm in RIVALS:
            est = true_value * math.exp(r.gauss(0, RIVAL_SIGMA))
            bids[nm] = max(0.0, est * r.uniform(*RIVAL_SHADE))
        state["truth"] = {"true_value_usd": true_value, "true_pdp_usd": true_pdp, "true_inventory_usd": true_inv, "rival_bids": bids,
                          "package": pkg}
        state["room"] = room
        state["seller_case"] = {"pdp_npv10_usd": round(seller_pdp), "inventory_npv10_usd": round(max(0.0, seller_inv)),
                                "asking_usd": round(seller_pdp + max(0.0, seller_inv)), "price_usd_bbl": PRICE_USD_BBL,
                                "note": "the seller's engineers: hyperbolic tails uncapped; inventory at the best wells' rates"}
        state["sections"] = [{"section": s["section"], "developed": s["developed"]} for s in pkg["sections"]]
        state["phase"] = "data room"
        if params.get("max_affordable_usd") is not None:       # career: what the company can finance (cash + credit line - reserve)
            state["max_affordable_usd"] = float(params["max_affordable_usd"])

    def view(self, state):
        v = {"phase": state["phase"], "sections": state["sections"], "data_room": state["room"], "seller_case": state["seller_case"],
             "rivals": RIVALS, "price_usd_bbl": PRICE_USD_BBL, "inventory_wells_per_section": INVENTORY_WELLS,
             "max_affordable_usd": state.get("max_affordable_usd")}
        if state["status"] == "finished":
            v["outcome"] = state.get("outcome")
        acts = []
        if state["status"] == "active":
            acts = [{"name": "bid", "label": "Submit a sealed bid", "args": {"bid_mm": base.arg("number", min=0, max=500, step=0.5, unit="$ MM")}},
                    {"name": "pass", "label": "Walk away", "args": {}}]
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        t = state["truth"]
        if action == "bid":
            bid = base.num(args, "bid_mm", 0, 500) * 1e6
            cap = state.get("max_affordable_usd")
            if cap is not None and bid > cap:
                raise base.GameError(f"the company can finance at most ${cap / 1e6:.1f} MM (cash and credit line, less the "
                                     f"reserve and committed costs): bid less or walk away")
        elif action == "pass":
            bid = 0.0
        else:
            raise base.GameError("unknown action")
        top_name, top = max(t["rival_bids"].items(), key=lambda kv: kv[1])
        won = bid > top and bid > 0
        created = (t["true_value_usd"] - bid) if won else 0.0
        bench = max(0.0, t["true_value_usd"] - top * 1.01) if t["true_value_usd"] > top else 0.0   # win just above the top rival, only if it pays
        ratio = base.relative(created, bench, 5e6)
        state["outcome"] = {"won": won, "your_bid_usd": bid, "winner": "You" if won else top_name, "winning_bid_usd": bid if won else top}
        state["status"] = "finished"
        state["phase"] = "closed"
        state["result"] = {"score": round(created), "stars": base.stars_for(ratio, (0.5, 0.9, 1.0)),
                           "headline": _headline(won, bid, created, bench, top_name, top, t["true_value_usd"]),
                           "breakdown": {"won": won, "bid_usd": bid, "value_created_usd": round(created), "benchmark_usd": round(bench),
                                         "true_value_usd": round(t["true_value_usd"]), "seller_asking_usd": state["seller_case"]["asking_usd"],
                                         "rival_bids_usd": {k: round(v) for k, v in t["rival_bids"].items()}},
                           "lookback": {"true_pdp_usd": round(t["true_pdp_usd"]), "true_inventory_usd": round(t["true_inventory_usd"])}}
        return [state["result"]["headline"]]


base.register(Acquisition())
