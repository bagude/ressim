"""Flowback and choke management: set the bottom-hole pressure month by month for a new well's first year.

Physics from ressim: the well (one simulated repeating stage, SPE1 live oil, bubble point 4,014.7 psia) is re-run with
the player's monthly pressure schedule (`run_fracwell` with a bhp schedule). Drawing down below the bubble point frees
gas in the rock. Game rule on top: the gas takeaway is limited; gas above it is flared, earns nothing and pays a fee.
"""
import opecon
from . import base

BUBBLE_PSI = 4014.7
MONTHS = 120
DECISION_MONTHS = 12
STAGE_SPACING_FT = 250.0
FLARE_FEE_USD_MCF = 1.0
FLARE_ALLOWANCE = 1.25          # gas above 125 % of takeaway in a month: the regulator orders a shut-in the next month
SHUT_IN_PSI = 4900.0
CHOKE_BACK_PSI = 300.0
CONDUCTIVITY_LOSS_PER_PSI = 2.4e-4   # ressim: permanent loss exp(-k x drawdown) in each fracture cell; k = the sand's stress coefficient          # each violation: bottom-hole pressure raised by this much for the rest of the well's life
ENFORCE_CHOKE_BACK = False      # off: with the hub gas price below, the trade-off comes from the physics, not a rule
GAS_SCENARIOS = [(2.5, "healthy hub"), (0.5, "weak hub"), (-0.5, "negative hub (pipeline full)"), (-1.5, "deeply negative hub")]
NOTES = [
    "Production is ressim's run of one repeating stage of the well, scaled to the lateral; SPE1 benchmark live oil (bubble point 4,015 psi).",
    "Fracture conductivity falls permanently as each part of the fracture is drawn down (ressim: exp(-2.4e-4 per psi of "
    "drawdown), following the lowest pressure that cell has seen, floor 5 %): opening a well hard crushes the pack for good. "
    "Proppant flowback is not modelled.",
    "Below the bubble point the rock releases much more gas but, in this model, little extra oil: the simulator decides how much. "
    "The hub gas price (it can be negative when pipelines are full), the takeaway limit and the flaring fee are game settings. Choke size is shown as the bottom-hole "
    "pressure it holds.",
]


class Flowback(base.Game):
    kind = "flowback"
    title = "Flowback and Choke"
    blurb = "Bring a new well on month by month: draw down too fast and gas breaks out past the takeaway limit."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "well")
        state["truth"] = {}
        state["well"] = {"perm_md": round(r.uniform(0.004, 0.012), 4), "thickness_ft": round(r.uniform(70, 130), 0), "half_length_ft": 300.0,
                         "conductivity_mdft": 50.0, "width_ft": 880.0, "stages": max(1, round(opecon.LATERAL_FT / STAGE_SPACING_FT)),
                         "gas_takeaway_mcf_d": round(r.uniform(1500, 3500), -2)}
        if params.get("career"):
            state["well"].update(perm_md=float(params["perm_md"]), thickness_ft=float(params["thickness_ft"]),
                                 half_length_ft=float(params["half_length_ft"]), conductivity_mdft=float(params["conductivity_mdft"]),
                                 width_ft=float(params["width_ft"]),
                                 stages=max(1, round(opecon.LATERAL_FT / float(params["stage_spacing_ft"]))))
            state["stage_spacing_ft"] = float(params["stage_spacing_ft"])
            state["well"]["conductivity_loss_per_psi"] = float(params.get("conductivity_loss_per_psi", 0.0))   # the career's own truth
        state["schedule"] = []
        state["series"] = None
        state["well"]["gas_takeaway_mcf_d"] = round(base.rng(state, "takeaway").uniform(1500, 3000), -1)
        price, label = base.rng(state, "gas").choice(GAS_SCENARIOS)
        if params.get("career"):
            price, label = float(params.get("gas_price_usd_mcf", 2.5)), "your company's gas contract"
        state["well"]["gas_price_usd_mcf"], state["well"]["gas_market"] = price, label

    def spec(self, state, months):
        w = state["well"]
        return {"name": "flowback", "thickness_ft": w["thickness_ft"], "perm_md": w["perm_md"], "porosity": 0.08, "pressure_psi": 5000.0,
                "fluid": "blackoil_spe1", "mesh": "coarse", "months": months, "dt_max_days": 30.0,
                "positions_ft": [state.get("stage_spacing_ft", STAGE_SPACING_FT) / 2], "edge_ft": state.get("stage_spacing_ft", STAGE_SPACING_FT) / 2, "width_ft": w["width_ft"], "half_length_ft": [w["half_length_ft"]],
                "conductivity_mdft": [w["conductivity_mdft"]], "bhp_psi": 1500.0,
                "conductivity_loss_per_psi": w.get("conductivity_loss_per_psi", CONDUCTIVITY_LOSS_PER_PSI)}

    def run(self, state, ctx, schedule, months, sub, enforce_from=0):
        """Simulate the schedule; from month `enforce_from` on, apply the regulator's shut-in after each violating month
        (re-simulating, since a shut-in changes everything after it)."""
        sched = schedule + [schedule[-1]] * (months - len(schedule))
        n = state["well"]["stages"]
        limit = FLARE_ALLOWANCE * state["well"]["gas_takeaway_mcf_d"] * opecon.MONTH_DAYS
        for _ in range(15 if ENFORCE_CHOKE_BACK else 1):
            m = ctx.call("bhpsched", {"spec": self.spec(state, months), "monthly_bhp_psi": sched}, sub)["monthly"]
            vol = {k: [x * n for x in m[k]] for k in ("oil", "gas", "water")}
            bad = next((k for k in range(max(0, enforce_from - 1), months - 1)
                        if vol["gas"][k] > limit and sched[k + 1] < min(SHUT_IN_PSI, sched[k] + CHOKE_BACK_PSI)), None)
            if bad is None:
                break
            floor = min(SHUT_IN_PSI, sched[bad] + CHOKE_BACK_PSI)   # the operator must choke back, and keep it there
            sched = sched[:bad + 1] + [max(x, floor) for x in sched[bad + 1:]]
        return vol, sched

    def cash(self, state, vol, months):
        cap = state["well"]["gas_takeaway_mcf_d"] * opecon.MONTH_DAYS
        out, flared = [], []
        for k in range(months):
            g = vol["gas"][k]
            sold, fl = min(g, cap), max(0.0, g - cap)
            deck = dict(opecon.PRICE_DECK, gas_usd_mcf=state["well"]["gas_price_usd_mcf"], gas_diff_usd_mcf=0.0)
            c = opecon.net_cash(vol["oil"][k], sold, vol["water"][k], 1, deck=deck)["net_usd"] - fl * FLARE_FEE_USD_MCF
            out.append(c)
            flared.append(fl)
        return out, flared

    def view(self, state):
        w = state["well"]
        month = len(state["schedule"])
        v = {"month": month, "decision_months": DECISION_MONTHS, "bubble_point_psi": BUBBLE_PSI, "initial_pressure_psi": 5000.0,
             "gas_takeaway_mcf_d": w["gas_takeaway_mcf_d"], "flare_fee_usd_mcf": FLARE_FEE_USD_MCF, "stages": w["stages"],
             "gas_price_usd_mcf": w["gas_price_usd_mcf"], "gas_market": w["gas_market"], "oil_price_usd_bbl": opecon.PRICE_DECK["oil_usd_bbl"],
             "choke_back_trigger_mcf_d": FLARE_ALLOWANCE * w["gas_takeaway_mcf_d"], "min_bhp_psi_by_order": state.get("choke_floor_psi", 0.0),
             "schedule_bhp_psi": state["schedule"], "series": state["series"]}
        actions = []
        if state["status"] == "active":
            lo = 1000 if state.get("link") else 800
            actions.append({"name": "set_month", "label": f"Hold this bottom-hole pressure through month {month + 1}",
                            "args": {"bhp_psi": base.arg("number", min=lo, max=4900, step=50, unit="psi")}})
            if month >= 1:
                actions.append({"name": "finish", "label": "Hand over to production (hold the last pressure for 10 years)", "args": {}})
        notes = NOTES
        if not state["well"].get("conductivity_loss_per_psi", CONDUCTIVITY_LOSS_PER_PSI):
            notes = [n if not n.startswith("Fracture conductivity falls") else
                     "Fracture conductivity loss with drawdown is off here: your career's wells are simulated without it."
                     for n in NOTES]
        return {"view": v, "actions": actions, "notes": notes}

    def act(self, state, action, args, ctx):
        if action == "set_month":
            bhp = base.num(args, "bhp_psi", 1000 if state.get("link") else 800, 4900)
            forced = state.get("choke_floor_psi", 0.0)
            if bhp < forced:
                bhp = forced
            state["schedule"].append(bhp)
            m = len(state["schedule"])
            vol, sched = self.run(state, ctx, state["schedule"], m, "m")
            cash, flared = self.cash(state, vol, m)
            cum, acc = [], 0.0
            for c in cash:
                acc += c
                cum.append(acc)
            days = opecon.MONTH_DAYS
            state["series"] = {"month": list(range(1, m + 1)), "bhp_psi": sched, "oil_bbl_d": [x / days for x in vol["oil"]],
                               "gas_mcf_d": [x / days for x in vol["gas"]], "water_bbl_d": [x / days for x in vol["water"]],
                               "gor_scf_bbl": [1000 * g / o if o > 0 else None for o, g in zip(vol["oil"], vol["gas"])],
                               "flared_mcf_d": [x / days for x in flared], "cum_cash_usd": cum}
            ev = [f"Month {m}: {vol['oil'][-1] / days:,.0f} bbl/d oil, {vol['gas'][-1] / days:,.0f} Mcf/d gas at {bhp:,.0f} psi."]
            if forced and bhp == forced:
                ev.insert(0, f"Regulator's order: bottom-hole pressure held at no less than {forced:,.0f} psi.")
            violated = vol["gas"][-1] > FLARE_ALLOWANCE * state["well"]["gas_takeaway_mcf_d"] * days
            if violated and ENFORCE_CHOKE_BACK:
                state["choke_floor_psi"] = min(SHUT_IN_PSI, bhp + CHOKE_BACK_PSI)
            state["shut_in_next"] = violated
            if flared[-1] > 0:
                ev.append(f"Gas above the {state['well']['gas_takeaway_mcf_d']:,.0f} Mcf/d takeaway: {flared[-1] / days:,.0f} Mcf/d flared.")
            if state["shut_in_next"] and ENFORCE_CHOKE_BACK:
                ev.append(f"Flaring above 125 % of takeaway: the regulator orders the well choked back to at least "
                          f"{state['choke_floor_psi']:,.0f} psi from now on.")
            if bhp < BUBBLE_PSI and (m == 1 or state["schedule"][-2] >= BUBBLE_PSI):
                ev.append("Below the bubble point: gas is now coming out of solution in the rock.")
            if m >= DECISION_MONTHS:
                ev += self.finish(state, ctx)
            return ev
        if action == "finish":
            return self.finish(state, ctx)
        raise base.GameError("unknown action")

    def npv(self, state, ctx, schedule, sub, enforce_from=0):
        vol, _ = self.run(state, ctx, schedule, MONTHS, sub, enforce_from)
        cash, flared = self.cash(state, vol, MONTHS)
        m = opecon.measures(cash, [0.0] * MONTHS)
        return m["npv10_usd"], vol, sum(flared)

    def finish(self, state, ctx):
        mine, vol, fl = self.npv(state, ctx, state["schedule"], "final", enforce_from=len(state["schedule"]))
        refs = {"open day one (1,000 psi)": [1000.0], "moderate (2,000 psi)": [2000.0],
                "hold above bubble point a year": [4100.0] * 12 + [1000.0], "staged 4,100 / 3,000 / 2,000": [4100.0] * 3 + [3000.0] * 3 + [2000.0]}
        scores = {k: self.npv(state, ctx, s, f"ref{i}")[0] for i, (k, s) in enumerate(refs.items())}
        best = max(scores.values())
        ratio = base.relative(mine, best, 2e6)
        state["status"] = "finished"
        state["result"] = {"score": mine, "stars": base.stars_for(ratio, (0.95, 0.99, 1.01)),
                           "headline": f"Operating NPV10 ${mine / 1e6:.2f} MM, " + base.versus(mine, best, "the best standard schedule"),
                           "breakdown": {"npv10_usd": mine, "oil_bbl_10yr": sum(vol["oil"]), "gas_flared_mcf": fl,
                                         "reference_npv10_usd": scores},
                           "lookback": {"well": state["well"]}}
        return [f"Handed over. 10-year oil {sum(vol['oil']):,.0f} bbl; NPV10 ${mine / 1e6:.2f} MM."]


base.register(Flowback())
