"""Production diagnostics: read a noisy well history and answer what a reservoir engineer would be asked.

The well is a real ressim run (one repeating stage of a fractured well, SPE1 oil, monthly steps for 20 years),
scaled to the lateral, with field-style noise, downtime and sometimes an offset frac hit added on top (game rules,
stated). Answers are graded against that truth.
"""
import math

import field
import opecon
from . import base

SHOW_MONTHS = 24
NOTES = [
    "The underlying production is a ressim run: one repeating stage of a fractured well, SPE1 benchmark oil, scaled to the lateral.",
    "Noise, downtime months and the offset frac hit (a step drop with partial recovery) are added by the game; the simulator does "
    "not model fracture interaction.",
    "Flow regime is graded from the simulated rate's log-log slope over months 2-12: about -0.5 is linear flow from the fractures; "
    "steeper means the drainage boundaries are already felt.",
]


class Diagnostics(base.Game):
    kind = "diagnostics"
    title = "Production Diagnostics"
    blurb = "A well's first two years: spot the downtime, the frac hit and the flow regime, then call the 10-year EUR."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "well")
        rock = {"section": "D", "perm_md": round(r.uniform(0.002, 0.03), 4), "porosity": 0.08, "pressure_psi": 5000.0,
                "thickness_ft": round(r.uniform(60, 130))}
        design = {"stage_spacing_ft": float(r.choice([150, 200, 250, 300])), "half_length_ft": float(r.choice([150, 250, 350])),
                  "conductivity_mdft": 50.0, "bhp_psi": 1500.0}
        wps = r.choice([3, 4, 6, 8])
        if params.get("career"):
            rock = dict(params["rock"])
            design = dict(params["design"])
            wps = int(params["wells_per_section"])
            state["career_well"] = params.get("well")
        if ctx.truth_sim is None:
            raise base.GameError("this minigame needs the simulator")
        stage = ctx.truth_sim.stage_curve(field.spec_for(rock, design, wps))
        n = max(1, round(opecon.LATERAL_FT / design["stage_spacing_ft"]))
        true_oil = [x * n for x in stage["oil"]]
        down = sorted(r.sample(range(3, SHOW_MONTHS), r.choice([1, 2, 3])))
        hit = r.random() < 0.5
        hit_month = r.randint(8, 18) if hit else None
        shown = []
        for k in range(SHOW_MONTHS):
            f = math.exp(r.gauss(0, 0.05))
            if k in down:
                f *= r.uniform(0.25, 0.6)
            if hit and k >= hit_month:
                f *= 0.65 + 0.25 * min(1.0, (k - hit_month) / 6.0)    # step drop, partial recovery over 6 months
            shown.append(true_oil[k] * f)
        t = list(range(2, 12))
        xs = [math.log(k + 0.5) for k in t]
        ys = [math.log(max(true_oil[k], 1e-9)) for k in t]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        slope = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / sum((a - mx) ** 2 for a in xs)
        regime = "linear flow (half slope)" if slope > -0.75 else "boundary-dominated (steeper decline)"
        state["truth"] = {"rock": rock, "design": design, "wells_per_section": wps, "downtime_months": [k + 1 for k in down],
                          "frac_hit_month": hit_month + 1 if hit else None, "slope": slope, "regime": regime,
                          "eur10_bbl": sum(true_oil[:120]) * (1.0 if not hit else 0.9)}
        state["history"] = {"month": list(range(1, SHOW_MONTHS + 1)), "oil_bbl": [round(x) for x in shown],
                            "oil_bbl_d": [round(x / opecon.MONTH_DAYS, 1) for x in shown]}
        state["well"] = {"lateral_ft": opecon.LATERAL_FT, "stages": n, "stage_spacing_ft": design["stage_spacing_ft"],
                         "well_spacing_ft": round(5280 / wps)}

    def questions(self):
        return [{"id": "downtime", "prompt": "Which months had downtime? (list of month numbers)", "kind": "list"},
                {"id": "frac_hit", "prompt": "Was there an offset frac hit, and in which month? (0 = none)", "kind": "number"},
                {"id": "regime", "prompt": "Flow regime over months 2-12?", "kind": "enum",
                 "options": ["linear flow (half slope)", "boundary-dominated (steeper decline)"]},
                {"id": "eur10", "prompt": "10-year oil EUR of this well (bbl)?", "kind": "number", "unit": "bbl"}]

    def view(self, state):
        v = {"history": state["history"], "well": state["well"], "questions": self.questions(), "answers": state.get("answers")}
        acts = [{"name": "answer", "label": "Submit your diagnosis", "args": {
            "downtime": base.arg("list", unit="month numbers", default=[]),
            "frac_hit": base.arg("int", min=0, max=SHOW_MONTHS, step=1, unit="month (0 = none)", default=0),
            "regime": base.arg("enum", options=self.questions()[2]["options"]),
            "eur10": base.arg("number", min=0, max=5_000_000, step=1000, unit="bbl")}}]
        return {"view": v, "actions": acts, "notes": NOTES}

    def act(self, state, action, args, ctx):
        t = state["truth"]
        try:
            down = sorted({int(x) for x in (args.get("downtime") or [])})
        except (TypeError, ValueError):
            raise base.GameError("downtime must be a list of month numbers")
        hit = int(base.num(args, "frac_hit", 0, SHOW_MONTHS, 0))
        regime = args.get("regime")
        if regime not in self.questions()[2]["options"]:
            raise base.GameError("pick a flow regime")
        eur = base.num(args, "eur10", 0, 5_000_000)
        truth_down = set(t["downtime_months"])
        hits = len(truth_down & set(down))
        false = len(set(down) - truth_down)
        pts = {"downtime": max(0.0, 25.0 * hits / len(truth_down) - 8.0 * false),
               "frac_hit": 25.0 if (t["frac_hit_month"] is None and hit == 0) or (t["frac_hit_month"] and abs(hit - t["frac_hit_month"]) <= 1)
               else (10.0 if t["frac_hit_month"] and hit else 0.0),
               "regime": 20.0 if regime == t["regime"] else 0.0,
               "eur10": 30.0 * max(0.0, 1.0 - abs(eur / t["eur10_bbl"] - 1.0) / 0.3)}
        score = sum(pts.values())
        state["answers"] = {"downtime": down, "frac_hit": hit, "regime": regime, "eur10": eur}
        state["status"] = "finished"
        state["result"] = {"score": round(score, 1), "stars": sum(1 for c in (60, 75, 90) if score >= c),
                           "headline": f"Diagnosis scored {score:.0f} / 100",
                           "breakdown": {"points": pts, "answers": state["answers"]},
                           "lookback": {"downtime_months": t["downtime_months"], "frac_hit_month": t["frac_hit_month"],
                                        "regime": t["regime"], "loglog_slope": round(t["slope"], 3), "eur10_bbl": round(t["eur10_bbl"]),
                                        "rock": t["rock"], "design": t["design"], "wells_per_section": t["wells_per_section"]}}
        return [f"Diagnosis submitted: {score:.0f} / 100."]


base.register(Diagnostics())
