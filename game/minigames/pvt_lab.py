"""PVT Lab: take a fluid sample, buy laboratory tests, and report the bubble point and the formation volume factor.

Physics from ressim (pvtlab.jl): the constant-composition expansion, the differential liberation and the separator test
are read exactly off the black-oil tables of the SPE1 live oil (`cce_test`, `differential_liberation`, `separator_test`,
`bubble_point`) for the gas content the sample holds.

Game rules (stated): how a sample's gas content depends on how it was taken (a bottom-hole sample taken while the well
flows below the bubble point catches free gas and comes back gas-rich; a surface recombination carries the error of
the measured gas-oil ratio), the costs, and the scoring.
"""
from . import base

P_RES = 5000.0
MAX_SAMPLES = 3
METHODS = {
    "bottomhole_conditioned": {"usd": 45_000.0, "label": "Bottom-hole sample after choking the well back (flowing above the bubble point)"},
    "bottomhole_flowing": {"usd": 20_000.0, "label": "Bottom-hole sample with the well flowing at its normal rate"},
    "surface_recombination": {"usd": 12_000.0, "label": "Separator oil and gas, recombined at the measured gas-oil ratio"},
}
TESTS = {"cce": 8_000.0, "dl": 15_000.0, "separator": 6_000.0}
RS_MAX = 1.6                        # the oil table ends at 1.618 Mscf/stb
CCE_PRESSURES = [6000.0, 5000.0, 4500.0, 4000.0, 3500.0, 3000.0, 2500.0, 2000.0, 1500.0, 1000.0, 500.0]
DL_PRESSURES = [3500.0, 3000.0, 2500.0, 2000.0, 1500.0, 1000.0, 500.0, 264.7, 14.7]
COST_PER_POINT_USD = 6_000.0
NOTES = [
    "Simulated: the laboratory reports, read exactly off the SPE1 live oil's black-oil tables (ressim cce_test, "
    "differential_liberation, separator_test) for the gas content of each sample.",
    "Game rule: a bottom-hole sample taken with the well flowing below the bubble point draws in free gas and comes back "
    "15-35 % gas-rich; a recombined surface sample carries a +/-10 % error in the measured gas-oil ratio; a sample taken "
    "after choking the well back above the bubble point is representative. The sampling pressure is reported with each sample.",
    "Differential liberation reports volumes per barrel of residual oil (Bod); the separator test gives the formation volume "
    "factor per stock-tank barrel (Bo), which is what the score checks.",
    "Out of scope: minimum miscibility pressure and huff-n-puff gas injection need a compositional (equation-of-state) model; "
    "black-oil tables have no compositions. The separator test has the one separator the tables were built for.",
    "Score: bubble point 50 (full within 2 %, none at 15 %), Bo 50 (full within 1 %, none at 6 %), less one point per "
    f"${COST_PER_POINT_USD:,.0f} spent.",
]


def accuracy_points(answer, truth, full, zero, weight=50.0):
    e = abs(answer / truth - 1.0)
    return weight * max(0.0, min(1.0, (zero - e) / (zero - full)))


def score(pb_ans, bo_ans, pb_true, bo_true, spent):
    pts = {"bubble_point": accuracy_points(pb_ans, pb_true, 0.02, 0.15), "bo": accuracy_points(bo_ans, bo_true, 0.01, 0.06),
           "cost": -spent / COST_PER_POINT_USD}
    return max(0.0, sum(pts.values())), pts


def sample_rs(method, rs_true, r):
    """The gas content a sample holds (game rule) and whether it is representative."""
    if method == "bottomhole_flowing":
        return min(RS_MAX, rs_true * r.uniform(1.15, 1.35)), "gas-rich: taken below the bubble point, free gas entered the sampler"
    if method == "surface_recombination":
        return min(RS_MAX, rs_true * (1.0 + r.uniform(-0.10, 0.10))), "recombined at a measured gas-oil ratio (+/-10 %)"
    return rs_true, "representative"


class PvtLab(base.Game):
    kind = "pvt-lab"
    title = "PVT Lab"
    blurb = "Sample the well's oil, choose the lab tests, and report its bubble point and formation volume factor."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "fluid")
        rs = round(r.uniform(0.70, 1.27), 3)
        if params.get("career"):
            rs = float(params.get("rs", 1.27))
        truth = self.lab(rs, ctx, "truth")
        state["hidden"] = {"rs": rs, "bubble_point_psia": truth["bubble_point_psia"], "bo_rb_stb": truth["separator"]["bo_rb_stb"], "samples": []}
        state["samples"] = []
        state["answers"] = None

    @staticmethod
    def lab(rs, ctx, sub):
        try:
            return ctx.call("pvt", {"rs": rs, "cce_pressures": CCE_PRESSURES, "dl_pressures": DL_PRESSURES}, sub)
        except RuntimeError as e:
            raise base.GameError(f"The lab model could not run: {str(e)[:200]}")

    def spent(self, state):
        return sum(s["cost_usd"] for s in state["samples"])

    def view(self, state):
        v = {"reservoir_pressure_psia": P_RES, "samples": state["samples"], "samples_left": MAX_SAMPLES - len(state["samples"]),
             "spent_usd": self.spent(state), "answers": state["answers"],
             "costs": {"samples": {k: m["usd"] for k, m in METHODS.items()}, "tests": TESTS},
             "methods": {k: m["label"] for k, m in METHODS.items()}}
        acts = []
        if len(state["samples"]) < MAX_SAMPLES:
            acts.append({"name": "sample", "label": f"Take a fluid sample ({MAX_SAMPLES - len(state['samples'])} left)",
                         "args": {"method": base.arg("enum", options=list(METHODS))}})
        if state["samples"]:
            acts.append({"name": "lab", "label": "Send a sample for a lab test", "args": {
                "sample": base.arg("int", min=1, max=len(state["samples"]), step=1, unit="sample number", default=len(state["samples"])),
                "test": base.arg("enum", options=list(TESTS))}})
            acts.append({"name": "report", "label": "Report the fluid properties (final)", "args": {
                "bubble_point_psia": base.arg("number", min=500, max=6000, step=10, unit="psia"),
                "bo_rb_stb": base.arg("number", min=1.0, max=2.5, step=0.001, unit="rb/stb at the bubble point (separator)")}})
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        if action == "sample":
            return self.take(state, args, ctx)
        if action == "lab":
            return self.test(state, args)
        return self.report(state, args)

    def take(self, state, args, ctx):
        if len(state["samples"]) >= MAX_SAMPLES:
            raise base.GameError("no samples left")
        method = args.get("method")
        if method not in METHODS:
            raise base.GameError(f"method must be one of {', '.join(METHODS)}")
        hid = state["hidden"]
        k = len(state["samples"])
        r = base.rng(state, "sample", k)
        pb = hid["bubble_point_psia"]
        rs, quality = sample_rs(method, hid["rs"], r)
        s = {"id": k + 1, "method": method, "label": METHODS[method]["label"], "cost_usd": METHODS[method]["usd"], "tests": {}}
        if method == "bottomhole_conditioned":
            s["sampling_pressure_psia"] = round(min(P_RES - 50.0, pb + r.uniform(300.0, 800.0)), -1)
        elif method == "bottomhole_flowing":
            s["sampling_pressure_psia"] = round(max(300.0, pb - r.uniform(500.0, 1500.0)), -1)
        else:
            s["separator_gor_scf_stb"] = round(rs * 1000.0, -1)
        hid["samples"].append({"rs": rs, "quality": quality, "reports": self.lab(rs, ctx, f"sample{k + 1}")})
        state["samples"].append(s)
        where = f"at {s['sampling_pressure_psia']:,.0f} psia" if "sampling_pressure_psia" in s else f"at a separator GOR of {s['separator_gor_scf_stb']:,.0f} scf/stb"
        return [f"Sample {k + 1} taken ({method.replace('_', ' ')}) {where}: ${s['cost_usd']:,.0f}."]

    def test(self, state, args):
        i = int(base.num(args, "sample", 1, len(state["samples"])))
        test = args.get("test")
        if test not in TESTS:
            raise base.GameError(f"test must be one of {', '.join(TESTS)}")
        s = state["samples"][i - 1]
        if test in s["tests"]:
            raise base.GameError(f"sample {i} already has a {test} report")
        rep = state["hidden"]["samples"][i - 1]["reports"]
        if test == "cce":
            out = {"bubble_point_psia": rep["cce"]["bubble_point_psia"], "rows": rep["cce"]["rows"]}
        elif test == "dl":
            out = {k: rep["dl"][k] for k in ("bubble_point_psia", "residual_oil_rb_stb", "gas_gravity", "rows")}
        else:
            out = dict(rep["separator"])
        s["tests"][test] = out
        s["cost_usd"] += TESTS[test]
        return [f"Sample {i}: {test} report back (${TESTS[test]:,.0f})."]

    def report(self, state, args):
        pb = base.num(args, "bubble_point_psia", 500, 6000)
        bo = base.num(args, "bo_rb_stb", 1.0, 2.5)
        hid = state["hidden"]
        spent = self.spent(state)
        total, pts = score(pb, bo, hid["bubble_point_psia"], hid["bo_rb_stb"], spent)
        state["answers"] = {"bubble_point_psia": pb, "bo_rb_stb": bo}
        state["status"] = "finished"
        state["result"] = {
            "score": round(total, 1), "stars": base.stars_for(total, (60, 75, 88)),
            "headline": f"Fluid report scored {total:.0f} / 100: bubble point {100 * (pb / hid['bubble_point_psia'] - 1):+.1f} %, "
                        f"Bo {100 * (bo / hid['bo_rb_stb'] - 1):+.1f} %, lab spend ${spent / 1e3:,.0f} k",
            "breakdown": {"points": pts, "answers": state["answers"], "spent_usd": spent},
            "lookback": {"bubble_point_psia": hid["bubble_point_psia"], "bo_rb_stb": hid["bo_rb_stb"], "rs_mscf_stb": hid["rs"],
                         "samples": [{"id": s["id"], "method": s["method"], "quality": h["quality"], "rs_mscf_stb": round(h["rs"], 4),
                                      "bubble_point_psia": h["reports"]["bubble_point_psia"]}
                                     for s, h in zip(state["samples"], hid["samples"])]}}
        return [f"Fluid report submitted: {total:.0f} / 100."]


base.register(PvtLab())
