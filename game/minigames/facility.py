"""Facility debottleneck: size the battery for three new wells sharing one flowline and separator.

Physics from ressim's multi-well field model (`run_field`): every well is its own reservoir model producing through
its own tubing into one node; the node sits at separator pressure plus the flowline drop; when total oil would
exceed the facility limit, the chosen allocation rule (common choke, pro rata, priority) cuts wells back.
"""
import opecon
from . import base

MONTHS = 24
TUBING = {"2.375 in (1.995 ID)": (1.995, 60_000.0), "2.875 in (2.441 ID)": (2.441, 80_000.0), "3.5 in (2.992 ID)": (2.992, 110_000.0)}
FACILITY_USD_PER_BBL_D = 2_500.0
COMPRESSION_USD_MONTH_PER_100PSI_BELOW_200 = 12_000.0
STUDIES = 3
ALLOCATIONS = ["common_choke", "pro_rata", "priority"]
NOTES = [
    "ressim's field model: wells do not interfere through the rock; they share one node, one flowline and one facility limit.",
    "Tubing is liquid-only hydraulics (gas lightening the column is not included), which overstates bottom-hole pressure. "
    "Each well is simulated as one repeating stage scaled to the lateral, so tubing friction is small and tubing size is fixed "
    "(2.875 in) in this game; scaling friction to the whole well made the field model unstable.",
    "Facility, tubing and compression costs are illustrative. The score covers the first 24 months, the life of this decision.",
]


class Facility(base.Game):
    kind = "facility"
    title = "Facility Debottleneck"
    blurb = "Three new wells, one battery: size the oil limit, pick tubing and separator pressure, choose who gets cut back."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "wells")
        state["wells"] = [{"id": f"W{i + 1}", "perm_md": round(r.uniform(0.003, 0.015), 4), "thickness_ft": round(r.uniform(70, 130)),
                           "half_length_ft": float(r.choice([200, 300, 400]))} for i in range(3)]
        if params.get("career") and params.get("wells"):
            state["wells"] = [dict(w, thickness_ft=float(w["thickness_ft"]), half_length_ft=float(w["half_length_ft"]))
                              for w in params["wells"]][:3]
        state["studies"] = []
        state["built"] = None

    def view(self, state):
        v = {"wells": state["wells"], "tubing_options": {k: {"id_in": a, "usd_per_well": b} for k, (a, b) in TUBING.items()},
             "facility_usd_per_bbl_d": FACILITY_USD_PER_BBL_D, "months": MONTHS, "studies": state["studies"],
             "studies_left": STUDIES - len(state["studies"]), "built": state["built"]}
        design_args = {"separator_psi": base.arg("number", min=50, max=300, step=10, unit="psi"),
                       "oil_cap_bbl_d": base.arg("number", min=300, max=4000, step=50, unit="bbl/d"),
                       "allocation": base.arg("enum", options=ALLOCATIONS),
                       "priority": base.arg("list", unit="well order for 'priority', e.g. [2, 1, 3]", default=[1, 2, 3], length=3)}
        actions = []
        if len(state["studies"]) < STUDIES:
            actions.append({"name": "study", "label": f"Engineering study: simulate a design ({STUDIES - len(state['studies'])} left)", "args": design_args})
        actions.append({"name": "build", "label": "Build this design (final)", "args": design_args})
        return {"view": v, "actions": actions, "notes": NOTES}

    def design(self, args):
        tub = "2.875 in (2.441 ID)"
        alloc = args.get("allocation")
        if alloc not in ALLOCATIONS:
            raise base.GameError(f"allocation must be one of {ALLOCATIONS}")
        pr = args.get("priority") or [1, 2, 3]
        if sorted(int(x) for x in pr) != [1, 2, 3]:
            raise base.GameError("priority must list wells 1, 2 and 3 once each")
        return {"separator_psi": base.num(args, "separator_psi", 50, 300), "tubing": tub, "oil_cap_bbl_d": base.num(args, "oil_cap_bbl_d", 300, 4000),
                "allocation": alloc, "priority": [int(x) for x in pr]}

    def simulate(self, state, d, ctx, sub):
        specs = [{"name": w["id"], "thickness_ft": w["thickness_ft"], "perm_md": w["perm_md"], "porosity": 0.08, "pressure_psi": 5000.0,
                  "fluid": "blackoil_spe1", "mesh": "coarse", "months": MONTHS, "dt_max_days": 30.0, "dt_first_days": 1.0, "stages": None,
                  "positions_ft": [125.0], "edge_ft": 125.0, "width_ft": 880.0, "half_length_ft": [w["half_length_ft"]],
                  "conductivity_mdft": [50.0], "bhp_psi": 1500.0} for w in state["wells"]]
        for s in specs:
            s.pop("stages")
        idin = TUBING[d["tubing"]][0]   # each well is one repeating stage, so tubing friction is small: the column's weight dominates
        r = ctx.call("field", {"wells": specs, "tubing": [{"depth_ft": 9000.0, "id_in": idin}] * 3, "separator_psi": d["separator_psi"],
                               "oil_cap_stb_d": d["oil_cap_bbl_d"], "allocation": d["allocation"], "priority": d["priority"]}, sub)
        stages = max(1, round(opecon.LATERAL_FT / 250.0))
        monthly = r["monthly_oil_stb"]                         # [month][well] for one repeating stage of each well
        oil = [[x * stages for x in row] for row in monthly]
        # cap and gas scale with the stage count too: the field model's cap applies to the simulated stages, so it is
        # given per stage below (oil_cap / stages) by the caller
        return r, oil

    def evaluate(self, state, d, ctx, sub):
        stages = max(1, round(opecon.LATERAL_FT / 250.0))
        d_sim = dict(d, oil_cap_bbl_d=d["oil_cap_bbl_d"] / stages)   # each well is simulated as one repeating stage
        r, oil = self.simulate(state, d_sim, ctx, sub)
        days = opecon.MONTH_DAYS
        tot = [sum(row) for row in oil]
        gor = 1.3                                             # Mcf/bbl, SPE1 solution gas (gas revenue only matters a little here)
        compress = COMPRESSION_USD_MONTH_PER_100PSI_BELOW_200 * max(0.0, 200.0 - d["separator_psi"]) / 100.0
        op = [opecon.net_cash(o, o * gor, 0.0, 3)["net_usd"] - compress for o in tot]
        capex = d["oil_cap_bbl_d"] * FACILITY_USD_PER_BBL_D + 3 * TUBING[d["tubing"]][1]
        m = opecon.measures(op, [capex] + [0.0] * (MONTHS - 1))
        full_steps = sum(1 for x in r["facility_full"] if x)
        return {"design": d, "npv10_usd": m["npv10_usd"], "capex_usd": capex, "compression_usd_month": compress,
                "series": {"month": list(range(1, MONTHS + 1)), "total_oil_bbl_d": [x / days for x in tot], "cap_bbl_d": [d["oil_cap_bbl_d"]] * MONTHS,
                           "per_well": {w["id"]: [row[i] / days for row in oil] for i, w in enumerate(state["wells"])}},
                "steps_at_limit": full_steps, "steps": len(r["facility_full"]),
                "node_psi_first_last": [r["node_psi"][0], r["node_psi"][-1]]}

    def act(self, state, action, args, ctx):
        d = self.design(args)
        try:
            res = self.evaluate(state, d, ctx, f"{action}{len(state['studies'])}")
        except RuntimeError as e:
            # the field model found no operating point (or failed): tell the player, and do not use up the study
            raise base.GameError("This design could not flow in the field model: no rate at which the reservoirs, tubing, "
                                 "flowline and separator agree. Try larger tubing, a lower separator pressure or a higher oil "
                                 f"limit. (simulator: {str(e)[:160]})")
        if action == "study":
            state["studies"].append(res)
            return [f"Study {len(state['studies'])}: NPV10 ${res['npv10_usd'] / 1e6:.2f} MM over 24 months; facility at its limit "
                    f"{res['steps_at_limit']} of {res['steps']} steps."]
        state["built"] = res
        ref = self.evaluate(state, {"separator_psi": 100.0, "tubing": "2.875 in (2.441 ID)", "oil_cap_bbl_d": 1500.0,
                                    "allocation": "pro_rata", "priority": [1, 2, 3]}, ctx, "reference")
        ratio = base.relative(res["npv10_usd"], ref["npv10_usd"], 2e6)
        state["status"] = "finished"
        state["result"] = {"score": res["npv10_usd"], "stars": base.stars_for(ratio, (0.95, 1.02, 1.08)),
                           "headline": f"Built: NPV10 ${res['npv10_usd'] / 1e6:.2f} MM, "
                                       + base.versus(res["npv10_usd"], ref["npv10_usd"], "the contractor's standard battery"),
                           "breakdown": {"npv10_usd": res["npv10_usd"], "capex_usd": res["capex_usd"], "reference_npv10_usd": ref["npv10_usd"],
                                         "ratio": ratio, "reference_design": ref["design"]},
                           "lookback": {"wells": state["wells"], "reference": ref}}
        return [f"Battery built. 24-month NPV10 ${res['npv10_usd'] / 1e6:.2f} MM."]


base.register(Facility())
