"""Nodal Analysis and Gas-Lift Allocation: split a pad's limited lift gas across wells of differing quality.

Physics from ressim (nodal.jl): each well's inflow curve is the reservoir model's transient deliverability at the pad's
current month (`inflow_curve`: the well produced to that date, then held at each test pressure for a day), scaled from
one repeating stage to the whole lateral. The tubing side is the drift-flux model of the SPE1 fluid (`driftflux_lift`).
`nodal_point` finds where inflow meets tubing with the lift gas added; `gaslift_curve` is oil against lift gas;
`allocate_lift_gas` is the greedy optimiser. Every split, yours and the references, is scored through `nodal_point`.

Game rules (stated): the pad (wells, tubing sizes, gas available), the value of a split (a year at today's rates, no
decline), the lift-gas cost, and the scoring.
"""
import itertools

import opecon
from . import base

BHPS = [150.0, 300.0, 500.0, 750.0, 1000.0, 1250.0, 1500.0, 1750.0, 2000.0, 2500.0, 3000.0]
NODE_PSI = 150.0
DEPTH_FT = 9000.0
STEP_MSCF = 50.0
STAGE_SPACING_FT = 250.0
OIL_NET_USD_BBL = opecon.PRICE_DECK["oil_usd_bbl"] + opecon.PRICE_DECK["oil_diff_usd_bbl"]
LIFT_GAS_USD_MCF = 0.6
DAYS_VALUED = 365.0
NOTES = [
    "Simulated: each well's inflow curve (ressim inflow_curve: the reservoir model at this month, one day at each test pressure, "
    "one repeating stage scaled to the lateral), the tubing (drift-flux model of the SPE1 fluid), and the nodal point of every "
    "split (nodal_point with your lift gas added to the tubing).",
    "Not modelled: gas-lift valves, injection depth and pressure, casing heading, compressor limits other than the pad total.",
    "The inflow is transient: a well's deliverability keeps falling with time, so these curves hold for this month only.",
    "Game rules: the value of a split is a year at today's rates with no decline (oil at the net price less lift gas at "
    f"${LIFT_GAS_USD_MCF}/Mcf), and you need not inject all the gas. The reference is the better of ressim's greedy "
    "allocate_lift_gas and a grid search over the gas-lift curves in 50 Mscf/d steps; the greedy allocator can stop short "
    "when a well needs a minimum of gas before it flows.",
]


def value_usd(oil_stb_d, gas_mscf_d):
    return DAYS_VALUED * (oil_stb_d * OIL_NET_USD_BBL - gas_mscf_d * LIFT_GAS_USD_MCF)


def interp(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            return ys[i - 1] + (x - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1])
    return ys[-1]


def grid_best(curves, total, step=STEP_MSCF):
    """Best split of up to `total` on a `step` grid by value read off the gas-lift curves (exhaustive; 3-4 wells)."""
    units = int(round(total / step))
    table = [[interp(cv["gas_mscf_d"], cv["oil_stb_d"], u * step) for u in range(units + 1)] for cv in curves]
    best, arg = None, None
    for combo in itertools.product(range(units + 1), repeat=len(curves)):
        s = sum(combo)
        if s > units:
            continue
        v = value_usd(sum(t[c] for t, c in zip(table, combo)), s * step)
        if best is None or v > best:
            best, arg = v, [c * step for c in combo]
    return arg


def check_split(args, n, total):
    g = args.get("gas_mscf_d")
    if not isinstance(g, list) or len(g) != n:
        raise base.GameError(f"gas_mscf_d must be a list of {n} numbers, one per well")
    try:
        g = [float(x) for x in g]
    except (TypeError, ValueError):
        raise base.GameError("gas_mscf_d must be numbers")
    if any(x < 0 for x in g):
        raise base.GameError("lift gas cannot be negative")
    if sum(g) > total + 1e-6:
        raise base.GameError(f"the split uses {sum(g):,.0f} Mscf/d; only {total:,.0f} is available")
    return g


class GasLift(base.Game):
    kind = "gaslift"
    title = "Nodal and Gas-Lift Allocation"
    blurb = "Read each well's inflow and tubing curves, then split the pad's limited lift gas for the most oil."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "pad")
        n = r.choice([3, 4])
        month = r.choice([18, 24, 30])
        wells = [{"perm_md": round(r.uniform(0.0008, 0.004), 4), "thickness_ft": float(round(r.uniform(70, 120))),
                  "half_length_ft": float(r.choice([100, 150, 200, 250, 300]))} for _ in range(n)]
        if params.get("career"):
            wells = [{"perm_md": float(w["perm_md"]), "thickness_ft": float(w["thickness_ft"]), "half_length_ft": float(w["half_length_ft"])}
                     for w in params["wells"]][:4]
            month = int(params.get("month", month))
            n = len(wells)
        if not 1 <= n <= 4:
            raise base.GameError("a pad needs 1-4 wells")
        tubing = [r.choice([2.992, 3.958, 3.958]) for _ in range(n)]
        total = float(r.choice([150, 200, 250]) * n)
        stages = max(1, round(opecon.LATERAL_FT / STAGE_SPACING_FT))
        specs = [{"name": f"gl{i + 1}", "fluid": "blackoil_spe1", "mesh": "coarse", "thickness_ft": w["thickness_ft"], "perm_md": w["perm_md"],
                  "porosity": 0.08, "pressure_psi": 5000.0, "bhp_psi": 1500.0, "positions_ft": [STAGE_SPACING_FT / 2], "edge_ft": STAGE_SPACING_FT / 2,
                  "width_ft": 880.0, "half_length_ft": [w["half_length_ft"]], "conductivity_mdft": [50.0], "months": month,
                  "dt_max_days": 30.0, "dt_first_days": 1.0} for i, w in enumerate(wells)]
        grid = [STEP_MSCF * k for k in range(int(total / STEP_MSCF) + 1)]
        try:
            res = ctx.call("inflow", {"wells": [{"spec": s, "scale": float(stages), "depth_ft": DEPTH_FT, "tubing_id_in": t} for s, t in zip(specs, tubing)],
                                      "at_month": month, "bhps_psi": BHPS, "node_psi": NODE_PSI, "gas_rates_mscf_d": grid, "total_mscf_d": total}, "curves")
        except RuntimeError as e:
            raise base.GameError(f"The simulator could not build the inflow curves: {str(e)[:200]}")
        state["month"] = month
        state["total_mscf_d"] = total
        state["hidden"] = {"wells": wells, "allocation": res["allocation"]}
        state["wells"] = [{"id": f"W{i + 1}", "half_length_ft": w["half_length_ft"], "net_pay_ft": w["thickness_ft"], "stages": stages,
                           "tubing_id_in": t, "depth_ft": DEPTH_FT, "curve": x["curve"], "vlp_bhp_psi": x["vlp_bhp_psi"],
                           "natural": x["natural"], "gaslift": x["gaslift"]}
                          for i, (w, t, x) in enumerate(zip(wells, tubing, res["wells"]))]
        state["answers"] = None

    def evaluate(self, state, split, ctx, sub):
        """Nodal points of every well at this split (curves passed back in; nothing re-simulated)."""
        res = ctx.call("inflow", {"wells": [{"curve": w["curve"], "depth_ft": w["depth_ft"], "tubing_id_in": w["tubing_id_in"], "lift_gas_mscf_d": g}
                                            for w, g in zip(state["wells"], split)], "node_psi": NODE_PSI, "gas_rates_mscf_d": [0.0]}, sub)
        oil = [(x["point"] or {}).get("oil_stb_d", 0.0) for x in res["wells"]]
        bhp = [(x["point"] or {}).get("bhp_psi") for x in res["wells"]]
        return {"gas_mscf_d": split, "oil_stb_d": oil, "bhp_psi": bhp, "total_oil_stb_d": sum(oil), "value_usd": value_usd(sum(oil), sum(split))}

    def view(self, state):
        n = len(state["wells"])
        v = {"month": state["month"], "total_lift_gas_mscf_d": state["total_mscf_d"], "node_psi": NODE_PSI, "wells": state["wells"],
             "answers": state["answers"], "oil_net_usd_bbl": OIL_NET_USD_BBL, "lift_gas_usd_mcf": LIFT_GAS_USD_MCF, "days_valued": DAYS_VALUED}
        acts = [{"name": "allocate", "label": "Commit this lift-gas split (final)", "args": {
            "gas_mscf_d": base.arg("list", length=n, min=0, max=state["total_mscf_d"], step=STEP_MSCF, unit="Mscf/d per well, in well order",
                                   default=[round(state["total_mscf_d"] / n / STEP_MSCF) * STEP_MSCF] * n)}}]
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        n, total = len(state["wells"]), state["total_mscf_d"]
        split = check_split(args, n, total)
        try:
            mine = self.evaluate(state, split, ctx, "mine")
            alloc = self.evaluate(state, list(state["hidden"]["allocation"]["gas_mscf_d"]), ctx, "allocator")
            grid = self.evaluate(state, grid_best([w["gaslift"] for w in state["wells"]], total), ctx, "grid")
            equal = self.evaluate(state, [total / n] * n, ctx, "equal")
            none = self.evaluate(state, [0.0] * n, ctx, "none")
        except RuntimeError as e:
            raise base.GameError(f"The simulator could not evaluate this split: {str(e)[:200]}")
        best = max((alloc, grid), key=lambda x: x["value_usd"])
        ratio = base.relative(mine["value_usd"], best["value_usd"], 1e6)
        ratio_eq = base.relative(mine["value_usd"], equal["value_usd"], 1e6)
        ratio_alloc = base.relative(mine["value_usd"], alloc["value_usd"], 1e6)
        state["answers"] = {"gas_mscf_d": split}
        state["status"] = "finished"
        state["result"] = {
            "score": round(100 * ratio, 1), "stars": base.stars_for(ratio, (0.9, 0.97, 0.995)),
            "headline": f"{mine['total_oil_stb_d']:,.0f} stb/d from the pad: " + base.versus(mine["value_usd"], best["value_usd"], "the best split")
                        + "; " + base.versus(mine["value_usd"], equal["value_usd"], "an equal split"),
            "breakdown": {"yours": mine, "ratio_to_best": ratio, "ratio_to_equal": ratio_eq, "ratio_to_allocator": ratio_alloc,
                          "references": {"best": best, "allocator": alloc, "grid_search": grid, "equal_split": equal, "no_lift_gas": none}},
            "lookback": {"wells": [{"id": w["id"], "half_length_ft": w["half_length_ft"], "net_pay_ft": w["net_pay_ft"], "perm_md": h["perm_md"]}
                                   for w, h in zip(state["wells"], state["hidden"]["wells"])]}}
        return [f"Split committed: {mine['total_oil_stb_d']:,.0f} stb/d with {sum(split):,.0f} Mscf/d of lift gas "
                f"(best found {best['total_oil_stb_d']:,.0f} stb/d, equal split {equal['total_oil_stb_d']:,.0f})."]


base.register(GasLift())
