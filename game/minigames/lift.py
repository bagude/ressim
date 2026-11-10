"""Artificial lift: a well flowing naturally loads up as it declines. Choose when to install lift and which kind.

Physics from ressim: natural flow and gas lift use the drift-flux tubing model (`driftflux_lift`, the SPE1 fluid, gas
slip) through `run_fracwell_marching`, which finds where reservoir and tubing agree each step; gas lift adds the
injected gas to the column. A pump is modelled as holding a set intake (bottom-hole) pressure. The installed plan is
then produced in one consistent reservoir run: natural flow's bottom-hole pressure before the switch month, the
lifted case's after it (`run_fracwell` with a bottom-hole pressure schedule).
"""
import opecon
from . import base

MONTHS = 60
STUDIES = 3
GAS_LIFT_CAPEX = 150_000.0
GAS_LIFT_USD_MCF = 0.6                  # compression fuel and maintenance per Mcf injected
PUMP_CAPEX = 250_000.0
PUMP_OPEX_USD_MONTH = 4_000.0
STAGE_SPACING_FT = 250.0
NOTES = [
    "A well that loads up flows in bursts, and the number of bursts moves its 5-year total by about 6 % with numerical "
    "detail: plans within about 10 % of the best are scored as a tie (3 stars from 97 % of the best).",
    "Tubing with gas: drift-flux model of the SPE1 fluid (one flow pattern, vertical pipe), not a calibrated lift correlation; "
    "liquid-only would overstate and no-slip understate the bottom-hole pressure.",
    "A pump is modelled as holding its intake pressure; pump efficiency, gas interference and failures are not modelled.",
    "The installed plan joins natural flow's pressures before the switch to the lifted case's after it, then re-runs the reservoir "
    "with that schedule, so depletion is consistent. Costs are illustrative.",
]


class Lift(base.Game):
    kind = "lift"
    title = "Artificial Lift"
    blurb = "Your well is loading up. When do you install lift, gas lift or a pump, and is it worth it?"
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "well")
        state["well"] = {"perm_md": round(r.uniform(0.003, 0.009), 4), "thickness_ft": round(r.uniform(70, 120)),
                         "depth_ft": 9000.0, "tubing_id_in": 2.441, "stages": max(1, round(opecon.LATERAL_FT / STAGE_SPACING_FT))}
        if params.get("career"):
            state["well"].update(perm_md=float(params["perm_md"]), thickness_ft=float(params["thickness_ft"]))
        state["studies"] = []
        state["natural"] = None

    def spec(self, state):
        w = state["well"]
        return {"name": "lift", "thickness_ft": float(w["thickness_ft"]), "perm_md": w["perm_md"], "porosity": 0.08, "pressure_psi": 5000.0,
                "fluid": "blackoil_spe1", "mesh": "coarse", "months": MONTHS, "dt_max_days": 30.0, "dt_first_days": 1.0,
                "positions_ft": [STAGE_SPACING_FT / 2], "edge_ft": STAGE_SPACING_FT / 2, "width_ft": 880.0, "half_length_ft": [300.0],
                "conductivity_mdft": [50.0], "bhp_psi": 1500.0}

    def monthly_bhp(self, r):
        """Time-weighted bottom-hole pressure per calendar month from a marching result."""
        out, t = [], 0.0
        sums, wts = [0.0] * MONTHS, [0.0] * MONTHS
        for p, dt in zip(r["bhp_psi"], r["step_days"]):
            m = min(MONTHS - 1, int((t + 1e-6) // opecon.MONTH_DAYS))
            sums[m] += p * dt
            wts[m] += dt
            t += dt
        last = r["bhp_psi"][0]
        for s, w in zip(sums, wts):
            last = s / w if w > 0 else last
            out.append(last)
        return out

    def natural(self, state, ctx):
        if state["natural"] is None:
            w = state["well"]
            r = ctx.call("marching", {"spec": self.spec(state), "separator_psi": 100.0, "lift": "natural", "depth_ft": w["depth_ft"],
                                      "tubing_id_in": w["tubing_id_in"]}, "natural")
            state["natural"] = {"bhp_psi": self.monthly_bhp(r)}
        return state["natural"]["bhp_psi"]

    def plan_bhp(self, state, plan, ctx, sub):
        nat = self.natural(state, ctx)
        if plan["method"] == "none":
            return nat
        w = state["well"]
        call = {"spec": self.spec(state), "separator_psi": 100.0, "depth_ft": w["depth_ft"], "tubing_id_in": w["tubing_id_in"]}
        if plan["method"] == "gas_lift":
            call.update(lift="gas_lift", gas_injection_mscf_d=plan["injection_mcf_d"] / w["stages"])   # per simulated stage
        else:
            call.update(lift="pump", pump_intake_psi=plan["intake_psi"])
        lifted = self.monthly_bhp(ctx.call("marching", call, sub + "_lift"))
        k = plan["switch_month"]
        return nat[:k] + [min(a, b) for a, b in zip(lifted[k:], nat[k:])]

    def evaluate(self, state, plan, ctx, sub):
        sched = self.plan_bhp(state, plan, ctx, sub)
        m = ctx.call("bhpsched", {"spec": self.spec(state), "monthly_bhp_psi": sched}, sub)["monthly"]
        n = state["well"]["stages"]
        vol = {k: [x * n for x in m[k]] for k in ("oil", "gas", "water")}
        k0 = plan["switch_month"]
        cash, capex = [], [0.0] * MONTHS
        for k in range(MONTHS):
            c = opecon.net_cash(vol["oil"][k], vol["gas"][k], vol["water"][k], 1)["net_usd"]
            if plan["method"] == "gas_lift" and k >= k0:
                c -= plan["injection_mcf_d"] * opecon.MONTH_DAYS * GAS_LIFT_USD_MCF
            if plan["method"] == "pump" and k >= k0:
                c -= PUMP_OPEX_USD_MONTH
            cash.append(c)
        if plan["method"] != "none":
            capex[k0] = GAS_LIFT_CAPEX if plan["method"] == "gas_lift" else PUMP_CAPEX
        meas = opecon.measures(cash, capex)
        days = opecon.MONTH_DAYS
        return {"plan": plan, "npv10_usd": meas["npv10_usd"], "oil_bbl_5yr": sum(vol["oil"]),
                "series": {"month": list(range(1, MONTHS + 1)), "bhp_psi": sched, "oil_bbl_d": [x / days for x in vol["oil"]],
                           "gas_mcf_d": [x / days for x in vol["gas"]],
                           "method": [("natural" if k < k0 or plan["method"] == "none" else plan["method"]) for k in range(MONTHS)]}}

    def check(self, args):
        method = args.get("method")
        if method not in ("none", "gas_lift", "pump"):
            raise base.GameError("method must be none, gas_lift or pump")
        plan = {"method": method, "switch_month": int(base.num(args, "switch_month", 0, MONTHS - 1, 0))}
        if method == "gas_lift":
            plan["injection_mcf_d"] = base.num(args, "injection_mcf_d", 100, 2000)
        if method == "pump":
            plan["intake_psi"] = base.num(args, "intake_psi", 150, 2500)
        return plan

    def view(self, state):
        v = {"well": state["well"], "months": MONTHS, "studies": state["studies"], "studies_left": STUDIES - len(state["studies"]),
             "natural_bhp_psi": (state["natural"] or {}).get("bhp_psi"),
             "costs": {"gas_lift_capex_usd": GAS_LIFT_CAPEX, "gas_lift_usd_mcf": GAS_LIFT_USD_MCF, "pump_capex_usd": PUMP_CAPEX,
                       "pump_opex_usd_month": PUMP_OPEX_USD_MONTH}}
        args = {"method": base.arg("enum", options=["none", "gas_lift", "pump"]),
                "switch_month": base.arg("int", min=0, max=MONTHS - 1, step=1, unit="month lift starts", default=12),
                "injection_mcf_d": base.arg("number", min=100, max=2000, step=50, unit="Mcf/d gas injected (gas lift)", default=500),
                "intake_psi": base.arg("number", min=150, max=2500, step=50, unit="psi pump intake (pump)", default=300)}
        acts = []
        if len(state["studies"]) < STUDIES:
            acts.append({"name": "study", "label": f"Study a lift plan ({STUDIES - len(state['studies'])} left)", "args": args})
        acts.append({"name": "install", "label": "Commit to this plan (final)", "args": args})
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        plan = self.check(args)
        try:
            res = self.evaluate(state, plan, ctx, f"{action}{len(state['studies'])}")
        except RuntimeError as e:
            raise base.GameError(f"The simulator could not run this plan: {str(e)[:200]}")
        if action == "study":
            state["studies"].append(res)
            return [f"Study {len(state['studies'])}: {plan['method']} from month {plan['switch_month']}: 5-year oil "
                    f"{res['oil_bbl_5yr']:,.0f} bbl, NPV10 ${res['npv10_usd'] / 1e6:.2f} MM."]
        refs = {}
        for name, p in (("no lift", {"method": "none", "switch_month": 0}),
                        ("gas lift 500 Mcf/d from month 6", {"method": "gas_lift", "switch_month": 6, "injection_mcf_d": 500.0}),
                        ("pump at 300 psi from month 6", {"method": "pump", "switch_month": 6, "intake_psi": 300.0})):
            try:
                refs[name] = self.evaluate(state, p, ctx, "ref_" + p["method"])["npv10_usd"]
            except RuntimeError:
                pass
        best = max(refs.values()) if refs else res["npv10_usd"]
        ratio = base.relative(res["npv10_usd"], best, 1e6)
        state["status"] = "finished"
        state["result"] = {"score": res["npv10_usd"], "stars": base.stars_for(ratio, (0.80, 0.90, 0.97)),   # within ~10 % is a tie (bursting wells)
                           "headline": f"{plan['method']} from month {plan['switch_month']}: NPV10 ${res['npv10_usd'] / 1e6:.2f} MM, "
                                       + base.versus(res["npv10_usd"], best, "the best standard plan"),
                           "breakdown": {"npv10_usd": res["npv10_usd"], "oil_bbl_5yr": res["oil_bbl_5yr"], "references_npv10_usd": refs, "ratio": ratio},
                           "lookback": {"installed": res}}
        return [f"Lift plan committed. 5-year oil {res['oil_bbl_5yr']:,.0f} bbl."]


base.register(Lift())
