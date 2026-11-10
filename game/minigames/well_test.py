"""Pressure Buildup: flow the well at a steady rate, shut it in, and read the permeability off the pressure record.

Physics from ressim: `run_buildup` (welltest.jl) runs the test on the reservoir model: one repeating stage of the
fractured well (its fracture cells thinned to 0.02 ft for the test, conductivity kept), flowed at the stage's share
of the well rate, then shut in. `pressure_derivative` gives the log-log pressure change and its Bourdet derivative.
The test fluid is single-phase oil (1 cp, total compressibility 7e-6 /psi, Bo 1.0) so the textbook linear-flow
analysis applies exactly; the production games use the SPE1 live oil instead.

Game rules (stated): the record shown starts 15 minutes after shut-in (the model has no wellbore storage, which hides
the first minutes of a real test); test costs; the well's rate before the test; the scoring.
"""
import math

import opecon
from . import base

STB_M3 = 0.158987294928
DAY_S = 86400.0
FT_M = 0.3048
MD_M2 = 9.869233e-16
PSI_PA = 6894.757293168

MU_CP = 1.0
OIL_COMP = 3e-6
ROCK_COMP = 4e-6
CT = OIL_COMP + ROCK_COMP
BO = 1.0
P_INIT = 5000.0
BHP_FLOOR = 500.0                    # the engine holds the rate down to this bottom-hole pressure
FIRST_HOURS = 0.25                   # record shown from 15 minutes after shut-in (game rule)
MAX_TESTS = 2
SHORT_SHUTIN_DAYS = 2.0              # a shut-in shorter than this that shows no half slope costs points
MOB_USD = 15_000.0                   # gauges in and out, per test
CREW_USD_DAY = 6_000.0               # slickline, gauges and a test crew, per day of the test
COST_REF_USD = 500_000.0             # cost at which the cost points reach zero
OIL_NET_USD_BBL = opecon.PRICE_DECK["oil_usd_bbl"] + opecon.PRICE_DECK["oil_diff_usd_bbl"]
LINEAR_SPREAD = 1.10                 # half slope "seen": slope estimates within 10 % over half a log cycle
LINEAR_DECADES = 0.5
NOTES = [
    "Simulated: the buildup itself (ressim run_buildup on one repeating stage of the well, single-phase oil, thin "
    "fracture cells for the test) and the Bourdet derivative (pressure_derivative).",
    "Not modelled: wellbore storage, skin and gauge noise. As a game rule the record starts 15 minutes after shut-in.",
    "Linear flow from the fractures: dp = m sqrt(t) while flowing, with m = (2 q mu Bo / (k A)) sqrt(k / (pi phi mu ct)) in "
    "consistent units, A = 4 x half-length x net pay x fractures. After shut-in the rise is m (sqrt(tp) + sqrt(dt) - sqrt(tp + dt)).",
    "derivative_superposed_psi is the derivative divided by (1 - sqrt(dt / (tp + dt))): it removes the flow period's bend, so "
    "linear flow shows a straight half slope and equals m sqrt(dt) / 2 (dt in days).",
    "Game rule for the flow-regime question: a half slope is 'seen' when the slope read from the corrected derivative "
    "(m = 2 x derivative_superposed_psi / sqrt(dt days)) stays within 10 % over at least half a log cycle.",
    "Game rules: costs (mobilisation, crew per day, oil deferred at the net oil price), the well's rate before the test, "
    "and the score (permeability 50: full within 20 %, none at a factor of 2; flow regime 15, cost 35, minus 15 for a shut-in under 2 days that shows no half slope).",
]


# ---- analysis (pure Python; the fast tests check it on the exact solution) --------------------------------------------
def linear_flow_slope(rate_stb_d, area_ft2, perm_md, porosity, viscosity_cp=MU_CP, ct=CT, bo=BO):
    """Exact linear-flow slope m (psi per sqrt(day)) for dp = m sqrt(t); same formula as ressim's linear_flow_slope."""
    q = rate_stb_d * bo * STB_M3 / DAY_S
    a = area_ft2 * FT_M ** 2
    k = perm_md * MD_M2
    mu = viscosity_cp * 1e-3
    c = ct / PSI_PA
    return (2 * q * mu / (k * a)) * math.sqrt(k / (math.pi * porosity * mu * c)) * math.sqrt(DAY_S) / PSI_PA


def perm_from_slope(m, rate_stb_d, area_ft2, porosity, viscosity_cp=MU_CP, ct=CT, bo=BO):
    """Invert m for permeability: m scales as 1 / sqrt(k)."""
    return (linear_flow_slope(rate_stb_d, area_ft2, 1.0, porosity, viscosity_cp, ct, bo) / m) ** 2


def superposed(hours, derivative, flow_days):
    """Derivative corrected for the flow period: d / (1 - sqrt(dt / (tp + dt)))."""
    out = []
    for h, d in zip(hours, derivative):
        dt = h / 24.0
        out.append(None if d is None else d / (1.0 - math.sqrt(dt / (flow_days + dt))))
    return out


def slope_estimates(hours, derivative, flow_days):
    """Linear-flow slope m read from each derivative point: m = 2 corrected derivative / sqrt(dt days)."""
    return [None if d is None or d <= 0 else 2.0 * d / math.sqrt(h / 24.0) for h, d in zip(hours, superposed(hours, derivative, flow_days))]


def linear_window(hours, m_est, decades=LINEAR_DECADES, spread=LINEAR_SPREAD):
    """The longest stretch of at least `decades` log cycles over which the slope estimates stay within `spread` (max/min).
    Returns {seen, m, from_hours, to_hours, decades}."""
    pts = [(h, m) for h, m in zip(hours, m_est) if m is not None and h > 0]
    best = None
    for i in range(len(pts)):
        lo = hi = pts[i][1]
        for j in range(i + 1, len(pts)):
            lo, hi = min(lo, pts[j][1]), max(hi, pts[j][1])
            if hi / lo > spread:
                break
            span = math.log10(pts[j][0] / pts[i][0])
            if span >= decades and (best is None or span > best[2]):
                best = (i, j, span)
    if best is None:
        return {"seen": False, "m": None, "from_hours": None, "to_hours": None, "decades": 0.0}
    i, j, span = best
    ms = sorted(m for _, m in pts[i:j + 1])
    return {"seen": True, "m": ms[len(ms) // 2], "from_hours": pts[i][0], "to_hours": pts[j][0], "decades": span}


def k_points(answer_md, true_md):
    """50 points within 20 %, none at a factor of 2 or worse (straight in log error between)."""
    e = abs(math.log(answer_md / true_md))
    return 50.0 * max(0.0, min(1.0, 1.0 - (e - math.log(1.2)) / (math.log(2.0) - math.log(1.2))))


def test_cost(rate, flow_days, shut_days, normal_rate):
    deferred = shut_days * normal_rate + flow_days * max(0.0, normal_rate - rate)
    crew = MOB_USD + CREW_USD_DAY * (flow_days + shut_days)
    return {"crew_usd": crew, "deferred_bbl": deferred, "deferred_usd": deferred * OIL_NET_USD_BBL, "cost_usd": crew + deferred * OIL_NET_USD_BBL}


def score(answer_k, answer_linear, truth_k, linear_seen, too_short, cost_usd):
    pts = {"permeability": k_points(answer_k, truth_k), "flow_regime": 15.0 if answer_linear == linear_seen else 0.0,
           "cost": 35.0 * max(0.0, 1.0 - cost_usd / COST_REF_USD), "short_shut_in": -15.0 if too_short else 0.0}
    return max(0.0, sum(pts.values())), pts


class WellTest(base.Game):
    kind = "well-test"
    title = "Pressure Buildup"
    blurb = "Flow the well, shut it in, and read the permeability off the buildup. Every day of testing costs oil."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "well")
        k = round(math.exp(r.uniform(math.log(0.001), math.log(0.02))), 5)
        rock = {"perm_md": k, "porosity": round(r.uniform(0.06, 0.10), 3), "thickness_ft": float(round(r.uniform(60, 130)))}
        design = {"half_length_ft": float(r.choice([150, 250, 350])), "stage_spacing_ft": float(r.choice([200, 250, 300])), "conductivity_mdft": 50.0}
        wps = r.choice([4, 6])
        if params.get("career"):
            rock = dict(params["rock"])
            design = dict(params["design"])
            wps = int(params["wells_per_section"])
            state["career_well"] = params.get("well")
        h = float(rock.get("net_ft", rock["thickness_ft"]))
        phi = float(rock["porosity"]) * (1.0 - float(rock.get("sw", 0.0)))      # oil-filled porosity (water immobile)
        sp = float(design["stage_spacing_ft"])
        width = 5280.0 / wps
        xf = min(float(design["half_length_ft"]), 0.45 * width)
        n = max(1, round(opecon.LATERAL_FT / sp))
        area = 4.0 * xf * h * n
        k = float(rock["perm_md"])
        m_unit = linear_flow_slope(1.0, area, k, phi)
        normal = 3500.0 / (m_unit * math.sqrt(180.0)) * math.exp(r.gauss(0.0, 0.25))      # game rule: the rate before the test
        normal = float(min(2000.0, max(20.0, round(normal / 5.0) * 5.0)))
        state["hidden"] = {"perm_md": k, "tests": []}
        state["well"] = {"stages": n, "half_length_ft": xf, "net_pay_ft": h, "phi": round(phi, 4), "viscosity_cp": MU_CP,
                         "total_compressibility_per_psi": CT, "bo_rb_stb": BO, "fracture_area_ft2": round(area),
                         "initial_pressure_psi": P_INIT, "bhp_floor_psi": BHP_FLOOR, "stage_spacing_ft": sp, "well_spacing_ft": round(width),
                         "conductivity_mdft": float(design.get("conductivity_mdft", 50.0)), "current_rate_stb_d": normal, "lateral_ft": opecon.LATERAL_FT}
        state["model"] = {"thickness_ft": h, "perm_md": k, "porosity": phi, "width_ft": width}
        state["tests"] = []
        state["answers"] = None

    def spec(self, state):
        w, m = state["well"], state["model"]
        sp = w["stage_spacing_ft"]
        return {"name": "welltest", "fluid": "oil", "mesh": "standard", "thickness_ft": m["thickness_ft"], "perm_md": m["perm_md"],
                "porosity": m["porosity"], "pressure_psi": P_INIT, "bhp_psi": BHP_FLOOR, "oil_compressibility": OIL_COMP,
                "rock_compressibility": ROCK_COMP, "oil_viscosity_cp": MU_CP, "positions_ft": [sp / 2], "edge_ft": sp / 2,
                "width_ft": m["width_ft"], "half_length_ft": [w["half_length_ft"]], "conductivity_mdft": [w["conductivity_mdft"]], "months": 1}

    def max_rate(self, state):
        return float(max(50.0, round(2.0 * state["well"]["current_rate_stb_d"] / 10.0) * 10.0))

    def run_args(self, state):
        q = state["well"]["current_rate_stb_d"]
        return {"rate_stb_d": base.arg("number", min=5, max=self.max_rate(state), step=5, unit="stb/d during the flow period", default=q),
                "flow_days": base.arg("number", min=0.5, max=30, step=0.5, unit="days flowing at that rate", default=7),
                "shut_days": base.arg("number", min=0.25, max=30, step=0.25, unit="days shut in", default=3)}

    def view(self, state):
        w = state["well"]
        v = {"well": w, "tests": state["tests"], "tests_left": MAX_TESTS - len(state["tests"]), "answers": state["answers"],
             "spent_usd": sum(t["cost_usd"] for t in state["tests"]),
             "costs": {"mobilisation_usd": MOB_USD, "crew_usd_day": CREW_USD_DAY, "oil_net_usd_bbl": OIL_NET_USD_BBL,
                       "deferred": "shut-in days x current rate, plus flow days x any cut below the current rate"},
             "record_from_hours": FIRST_HOURS}
        acts = []
        if len(state["tests"]) < MAX_TESTS:
            acts.append({"name": "run_test", "label": f"Run a buildup test ({MAX_TESTS - len(state['tests'])} left)", "args": self.run_args(state)})
        if state["tests"]:
            acts.append({"name": "interpret", "label": "Report your interpretation (final)", "args": {
                "k_md": base.arg("number", min=1e-5, max=1.0, step=0.0001, unit="md, permeability"),
                "linear_flow": base.arg("enum", options=["yes", "no"], unit="half slope (linear flow) seen?")}})
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        if action == "run_test":
            return self.run_test(state, args, ctx)
        return self.interpret(state, args)

    def run_test(self, state, args, ctx):
        if len(state["tests"]) >= MAX_TESTS:
            raise base.GameError("no tests left")
        w = state["well"]
        rate = base.num(args, "rate_stb_d", 5, self.max_rate(state))
        tp = base.num(args, "flow_days", 0.5, 30)
        ts = base.num(args, "shut_days", 0.25, 30)
        try:
            r = ctx.call("buildup", {"spec": self.spec(state), "flow_days": tp, "shut_days": ts, "oil_rate_stb_d": rate / w["stages"]},
                         f"test{len(state['tests'])}")
        except RuntimeError as e:
            raise base.GameError(f"The simulator could not run this test: {str(e)[:200]}")
        keep = [i for i, h in enumerate(r["hours"]) if h >= FIRST_HOURS]
        hours = [r["hours"][i] for i in keep]
        deriv = [r["derivative_psi"][i] for i in keep]
        c = test_cost(rate, tp, ts, w["current_rate_stb_d"])
        test = {"rate_stb_d": rate, "flow_days": tp, "shut_days": ts, "rate_held": bool(r["rate_held"]),
                "flowing_pressure_psi": r["flowing_pressure_psi"], "hours": hours, "pressure_psi": [r["pressure_psi"][i] for i in keep],
                "dp_psi": [r["dp_psi"][i] for i in keep], "derivative_psi": deriv, "derivative_superposed_psi": superposed(hours, deriv, tp),
                "flow": {"days": r["flow_days_axis"], "pressure_psi": r["flow_pressure_psi"], "rate_stb_d": [x * w["stages"] for x in r["flow_rate_stb_d"]]},
                **{k: round(v, 1) for k, v in c.items()}}
        lw = linear_window(hours, slope_estimates(hours, deriv, tp))
        k_an = perm_from_slope(lw["m"], rate, w["fracture_area_ft2"], w["phi"]) if lw["seen"] else None
        state["tests"].append(test)
        state["hidden"]["tests"].append({"window": lw, "analyst_k_md": k_an})
        ev = [f"Test {len(state['tests'])}: {rate:.0f} stb/d for {tp:g} days, shut in {ts:g} days. Flowing pressure at shut-in "
              f"{r['flowing_pressure_psi']:,.0f} psi; {ts * 24:,.0f} hours later {test['pressure_psi'][-1]:,.0f} psi. Cost ${c['cost_usd']:,.0f}."]
        if not r["rate_held"]:
            ev.append(f"The well could not hold {rate:.0f} stb/d above {BHP_FLOOR:.0f} psi: the rate fell during the flow period.")
        return ev

    def interpret(self, state, args):
        if not state["tests"]:
            raise base.GameError("run a test first")
        k_ans = base.num(args, "k_md", 1e-5, 1.0)
        lin = args.get("linear_flow")
        if lin not in ("yes", "no"):
            raise base.GameError("linear_flow must be yes or no")
        hid = state["hidden"]
        seen = any(t["window"]["seen"] for t in hid["tests"])
        too_short = not seen and max(t["shut_days"] for t in state["tests"]) < SHORT_SHUTIN_DAYS
        cost = sum(t["cost_usd"] for t in state["tests"])
        total, pts = score(k_ans, lin == "yes", hid["perm_md"], seen, too_short, cost)
        best = next((t for t in hid["tests"] if t["window"]["seen"]), None)
        state["answers"] = {"k_md": k_ans, "linear_flow": lin}
        state["status"] = "finished"
        state["result"] = {
            "score": round(total, 1), "stars": base.stars_for(total, (55, 70, 85)),
            "headline": f"Interpretation scored {total:.0f} / 100 (k within {100 * abs(k_ans / hid['perm_md'] - 1):.0f} %, "
                        f"tests cost ${cost / 1e3:,.0f} k)",
            "breakdown": {"points": pts, "answers": state["answers"], "cost_usd": cost,
                          "deferred_bbl": sum(t["deferred_bbl"] for t in state["tests"]), "linear_flow_seen": seen, "short_shut_in": too_short},
            "lookback": {"linear_flow_seen": seen, "window_hours": [best["window"]["from_hours"], best["window"]["to_hours"]] if best else None,
                         "truth": {"perm_md": hid["perm_md"], "analyst_k_md": best["analyst_k_md"] if best else None,
                                   "analyst_slope_psi_sqrt_day": best["window"]["m"] if best else None}}}
        return [f"Interpretation submitted: {total:.0f} / 100."]


base.register(WellTest())
