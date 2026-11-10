"""Pump the Job: design and pump one frac stage, then produce the well it makes.

Physics, all from ressim (open-harnessess-f7's frozen functions): pseudo-3-D fracture growth with height barriers
(`grow_stage_barriers`), proppant transport to a propped length and conductivity (`propped_profile`), and the
reservoir run of the resulting repeating stage (`run_fracwell` through a constant-pressure schedule).
Game rules on top (labelled in `notes`): costs, a screen-out cleanout charge when the model reports packing,
and a stage loss when the fracture height runs away through the barriers.
"""
import opecon
from . import base

FLUIDS = {"slickwater": {"viscosity_cp": 3.0, "usd_bbl": 2.0}, "linear_gel": {"viscosity_cp": 30.0, "usd_bbl": 7.0},
          "crosslinked": {"viscosity_cp": 200.0, "usd_bbl": 14.0}}
SANDS = {"100_mesh": 0.15, "40_70": 0.3}
SAND_USD_LB = 0.06
HORSEPOWER_USD_BBL = 6.0        # pumping charge per barrel of slurry
STAGE_FIXED_USD = 45_000.0      # plug, perforating, crew time
CLEANOUT_USD = 250_000.0        # coiled-tubing cleanout after a screen-out (game rule)
MINIFRAC_USD = 40_000.0
PERF_USD_CLUSTER = 1_500.0      # a perforating gun run per cluster (illustrative)
HHP_USD_MIN = 0.25              # pumping charge per hydraulic horsepower-minute spent against perforation friction (illustrative)
MAX_STAGE_RATE_BPM = 100.0
PERF_DIAMETER_IN = 0.4
STAGE_SPACING_FT = 250.0
WELL_SPACING_FT = 880.0
MONTHS = 120
GAL_BBL = 42.0
NOTES = [
    "Fracture growth: pseudo-3-D model with symmetric barriers; height and length are predicted, fractures do not interact.",
    "Proppant: carried with the slurry and settling into a bank at the bottom of the fracture as it goes (hindered settling); "
    "only the bank inside the pay conducts, so thin fluids and big grains lose sand below the pay. Packing (screen-out) "
    "is reported but the flow model does not feel it. The game charges a cleanout when packing occurs.",
    "A height runaway (the barriers cannot hold the net pressure) loses the stage in this game; the model stops there.",
    "Minifrac: a simulated DFIT (fracture closes on its leak-off, then the exact after-closure response) read with the "
    "standard G-function and after-closure analysis. Closure and pore pressure match the synthetic record by "
    "construction (it is built from the same laws the analysis fits; real records are not this clean). Leak-off and "
    "permeability from leak-off depend on which part of the decline is fitted: a factor-of-two number either way. "
    "No wellbore storage or near-wellbore friction. The barrier stress estimate is a game rule.",
    "Clusters: several fractures per stage share the wellbore pressure; the fluid split is solved with perforation friction "
    "and the stress shadow between neighbours (ressim multifrac). Few shots per cluster (limited entry) evens the split "
    "at the cost of friction, which the game charges as pumping horsepower. Surface treating pressure is still not modelled.",
    "Production: one simulated repeating stage of the well, SPE1 benchmark oil, scaled to the lateral. Costs are illustrative.",
]


def stages_per_well():
    return max(1, round(opecon.LATERAL_FT / STAGE_SPACING_FT))


class PumpJob(base.Game):
    kind = "pump-job"
    title = "Pump the Job"
    blurb = "Design and pump a frac stage: rate, fluid, proppant ramp. Contain the height, place the sand, make the well."
    sim = True

    def new(self, state, params, ctx):
        r = base.rng(state, "rock")
        pay = round(r.uniform(60, 140), 0)
        barrier = round(r.uniform(400, 1200), -1)
        truth = {"pay_ft": pay, "barrier_psi": round(barrier * r.uniform(0.8, 1.15), 0), "youngs_psi": round(r.uniform(3e6, 6e6), -4),
                 "leakoff_ft_sqrtmin": round(r.uniform(0.0006, 0.0025), 5), "perm_md": round(r.uniform(0.003, 0.01), 4),
                 "closure_psi": round(r.uniform(3500, 5500), -1)}
        if params.get("career"):
            truth["pay_ft"] = pay = float(params["pay_ft"])
            truth["perm_md"] = float(params["perm_md"])
        state["well_spacing_ft"] = float(params.get("well_spacing_ft", WELL_SPACING_FT))
        state["career"] = bool(params.get("career"))      # the career plan's stage spacing already sets fracture spacing: one cluster
        state["truth"] = truth
        state["known"] = {"pay_ft": pay, "barrier_psi_estimate": barrier, "barrier_uncertainty": "±20 %",
                          "youngs_psi": truth["youngs_psi"], "leakoff_ft_sqrtmin_estimate": round(truth["leakoff_ft_sqrtmin"] * r.uniform(0.6, 1.5), 5),
                          "closure_psi": truth["closure_psi"], "minifrac": None}
        state["phase"] = "design"
        state["spent_usd"] = 0.0

    def view(self, state):
        v = {"phase": state["phase"], "rock": state["known"], "stage_spacing_ft": STAGE_SPACING_FT, "well_spacing_ft": WELL_SPACING_FT,
             "stages_per_well": stages_per_well(), "lateral_ft": opecon.LATERAL_FT, "fluids": FLUIDS, "sands_mm": SANDS,
             "sand_usd_lb": SAND_USD_LB, "spent_usd": state["spent_usd"]}
        for k in ("job", "growth", "production", "economics", "dfit"):
            if k in state:
                v[k] = state[k]
        if (state.get("growth") or {}).get("clusters"):
            v["clusters"] = [{k: c.get(k) for k in ("fluid_share", "half_length_ft", "perf_drop_psi", "shadow_psi", "share_in_pay",
                                                     "height_at_well_ft", "position_ft")}
                             | {"propped_half_length_ft": (c.get("propped") or {}).get("half_length_ft")} for c in state["growth"]["clusters"]]
            v["perf_friction_psi"] = max(c.get("perf_drop_psi") or 0.0 for c in state["growth"]["clusters"])
        k = state["known"]
        v["pay"] = {"top_ft": -k["pay_ft"] / 2, "base_ft": k["pay_ft"] / 2}          # relative to the perforations, + down
        bar = (k["minifrac"] or {}).get("barrier_psi", k["barrier_psi_estimate"])
        v["barriers"] = [{"top_ft": -k["pay_ft"] / 2 - 200, "base_ft": -k["pay_ft"] / 2, "stress_psi": bar},
                         {"top_ft": k["pay_ft"] / 2, "base_ft": k["pay_ft"] / 2 + 200, "stress_psi": bar}]
        g = state.get("growth")
        if g and not g.get("runaway"):
            h = g["history"]
            job = state["job"]
            sched = job["schedule"]
            ppa = [next((c for f, c in reversed(sched) if t / job["minutes"] >= f), 0.0) for t in h["t_min"]]
            v["series"] = {"t_min": h["t_min"], "net_psi": h["net_pressure_psi"], "surface_psi": None,
                           "rate_bpm": [job["rate_bpm"] * job.get("clusters", 1)] * len(h["t_min"]), "ppa": ppa,
                           "half_length_ft": h["half_length_ft"], "height_at_well_ft": h["height_at_well_ft"]}
            v["fracture"] = {"half_length_ft": g["half_length_ft"], "height_up_ft": g["height_at_well_ft"] / 2,
                             "height_down_ft": g["height_at_well_ft"] / 2,
                             "propped_half_length_ft": (g.get("propped") or {}).get("half_length_ft"), "width_in": g["inlet_width_in"]}
            v["alarms"] = (["screen_out"] if g.get("screen_out") else [])
            bbl = job["rate_bpm"] * job.get("clusters", 1) * job["minutes"]
            pts = sched + [[1.0, 0.0]]
            v["schedule"] = [{"ppa": c, "bbl": bbl * (f1 - f0)} for (f0, c), (f1, _) in zip(pts, pts[1:])]
            cls = g.get("clusters") or [g]
            v["proppant_placed_lb"] = sum((c.get("propped") or {}).get("proppant_in_fracture_m3", 0.0) for c in cls) * 2650 * 2.20462 * 0.65
        elif g:
            v["alarms"] = ["height_runaway"]
        v["limits"] = {"max_surface_psi": None, "note": "surface treating pressure is not modelled; net pressure in the fracture is"}
        actions = []
        if state["phase"] == "design":
            if state["known"]["minifrac"] is None:
                actions.append({"name": "minifrac", "label": f"Run a minifrac (${MINIFRAC_USD / 1e3:.0f}k): measure barrier stress and leak-off", "args": {}})
            actions.append({"name": "pump", "label": "Pump the stage", "args": {
                "fluid": base.arg("enum", options=list(FLUIDS)),
                "rate_bpm": base.arg("number", min=5, max=40, step=1, unit="bbl/min per cluster (stage rate = this x clusters, at most 100)"),
                **({} if state.get("career") else {
                    "clusters": base.arg("int", min=1, max=6, default=STANDARD["clusters"], unit="perforation clusters per stage, evenly spaced"),
                    "shots_per_cluster": base.arg("int", min=2, max=24, default=STANDARD["shots_per_cluster"],
                                                  unit="perforations per cluster (0.4 in); fewer = limited entry")}),
                "minutes": base.arg("number", min=15, max=120, step=5, unit="min"),
                "sand": base.arg("enum", options=list(SANDS)),
                "schedule": base.arg("list", unit="[[start fraction 0-1, lb/gal 0-6], ...] up to 6 steps; pad = steps before the first sand",
                                     default=[[0.25, 0.5], [0.5, 1.0], [0.75, 1.5]], max_length=6)}})
        return {"view": v, "actions": actions, "notes": NOTES}

    def act(self, state, action, args, ctx):
        t = state["truth"]
        if action == "minifrac":
            r = base.rng(state, "minifrac")
            state["spent_usd"] += MINIFRAC_USD
            mf = {"barrier_psi": round(t["barrier_psi"] * r.uniform(0.96, 1.04), 0),
                  "leakoff_ft_sqrtmin": round(t["leakoff_ft_sqrtmin"] * r.uniform(0.9, 1.1), 5)}
            try:                                   # f7's synthetic DFIT and the textbook analysis of it
                d = ctx.call("dfit", {"pay_ft": t["pay_ft"], "youngs_psi": t["youngs_psi"], "rate_bpm": 5.0, "pump_minutes": 5.0,
                                      "falloff_hours": 72.0, "closure_psi": t["closure_psi"] + 5000.0, "reservoir_psi": 5000.0,
                                      "perm_md": t["perm_md"], "porosity": 0.08, "total_compressibility": 1.64e-5,
                                      "reservoir_viscosity_cp": 0.55}, "dfit")
            except base.GameError:
                raise
            except Exception:  # noqa: BLE001  the worker cannot run it: fall back to the game-rule estimates
                d = None
            if d and not d.get("failed"):
                a = d["analysis"]
                bias = (a.get("leakoff_ft_sqrtmin") or 0) / max(1e-12, d["leakoff_ft_sqrtmin"])
                mf.update(leakoff_ft_sqrtmin=round(t["leakoff_ft_sqrtmin"] * bias, 5) if bias > 0 else mf["leakoff_ft_sqrtmin"],
                          closure_psi=round(a["closure_psi"]), pore_pressure_psi=round(a["pore_pressure_psi"]) if a.get("pore_pressure_psi") else None,
                          perm_md_from_leakoff=a.get("perm_md_from_leakoff"), efficiency=a.get("efficiency"),
                          radial_reached=a.get("radial_reached"), source="DFIT (simulated) and the standard G-function / after-closure analysis")
                state["dfit"] = {"minutes": d["minutes"], "pressure_psi": d["pressure_psi"], "G": a["G"], "dPdG": a["dPdG"], "GdPdG": a["GdPdG"],
                                 "isip_psi": a.get("isip_psi"), "closure_G": a.get("closure_G"), "closure_minutes": a.get("closure_minutes")}
            elif d:
                mf["note"] = "the DFIT did not close within 72 hours (rock too tight for the test); estimates from the pump-in only"
            state["known"]["minifrac"] = mf
            msg = (f"Minifrac: barrier stress contrast about {mf['barrier_psi']:.0f} psi, leak-off about {mf['leakoff_ft_sqrtmin']:.4f} ft/√min.")
            if mf.get("closure_psi"):
                msg += (f" DFIT: closure {mf['closure_psi']:,} psi, pore pressure {mf['pore_pressure_psi'] or 0:,} psi, "
                        f"permeability from leak-off about {mf['perm_md_from_leakoff'] or 0:.4f} md (a factor-of-two number; it depends on the fit).")
            return [msg]
        if action != "pump":
            raise base.GameError("unknown action")
        job = check_job(args, career=state.get("career", False))
        events = []
        g = ctx.call("grow", grow_input(t, job), "grow")
        if g.get("failed"):
            raise base.GameError("The model could not grow this cluster design (closely spaced clusters growing far out of "
                                 "the pay are unstable in it). Try fewer clusters, a lower rate or a thicker fluid. Nothing was charged.")
        cost = stage_cost(job)
        state["job"] = job
        if g.get("runaway"):
            state["growth"] = {"runaway": True, "message": g["message"]}
            state["spent_usd"] += cost
            state["status"] = "finished"
            state["result"] = {"score": -cost, "stars": 0, "headline": "Height runaway: the fracture broke through the barriers",
                               "breakdown": {"stage_cost_usd": cost, "message": g["message"]},
                               "lookback": {"truth": t}}
            return ["Net pressure exceeded what the barriers can hold. The fracture grew out of zone; the stage is lost."]
        ws = state.get("well_spacing_ft", WELL_SPACING_FT)
        if len(g.get("clusters") or []) > 1:
            cls = g["clusters"]
            for c, x in zip(cls, cluster_positions(job["clusters"])):
                c["position_ft"] = x
                if c.get("half_length_ft") is None:          # the model returned a non-finite length at the end: last finite one
                    hist = [v for v in (c.get("history") or {}).get("half_length_ft", []) if v is not None]
                    c["half_length_ft"] = hist[-1] if hist else (c.get("propped") or {}).get("half_length_ft", 0.0)
                    c["length_note"] = "final length not finite in the model; last finite value shown"
            lead = max(cls, key=lambda c: c["fluid_share"])
            friction = sum(c["fluid_share"] * (c.get("perf_drop_psi") or 0.0) for c in cls)
            hhp = job["rate_bpm"] * job["clusters"] * friction / 40.8
            cost += hhp * job["minutes"] * HHP_USD_MIN
            state["growth"] = {"runaway": False, **{k: lead[k] for k in ("half_length_ft", "height_at_well_ft", "share_in_pay", "inlet_width_in",
                                                                          "net_pressure_psi", "efficiency", "history", "profile")},
                               "notes": [], "propped": lead.get("propped") or {}, "clusters": cls,
                               "wellbore_net_psi": g.get("wellbore_net_psi"), "friction_hhp": hhp}
            packs = [c["propped"]["first_pack_min"] for c in cls if (c.get("propped") or {}).get("first_pack_min") is not None]
            events.append("Fluid split across clusters: " + ", ".join(f"{100 * c['fluid_share']:.0f} %" for c in cls)
                          + f"; perforation friction about {friction:,.0f} psi ({hhp:,.0f} hydraulic hp).")
        else:
            g = (g.get("clusters") or [g])[0]
            cls = [dict(g, position_ft=0.0)]
            state["growth"] = {"runaway": False, **{k: g[k] for k in ("half_length_ft", "height_at_well_ft", "share_in_pay", "inlet_width_in",
                                                                       "net_pressure_psi", "efficiency", "history", "profile")},
                               "notes": g.get("notes") or [], "propped": g.get("propped") or {}}
            packs = [g["propped"]["first_pack_min"]] if (g.get("propped") or {}).get("first_pack_min") is not None else []
        screen = bool(packs)
        state["growth"]["screen_out"] = screen
        if screen:
            cost += CLEANOUT_USD
            events.append(f"Screen-out at {min(packs):.0f} min: proppant packed near the wellbore. Coiled-tubing cleanout charged.")
        fr = []
        for c in cls:
            pk = c.get("propped") or {}
            x = min(pk.get("half_length_ft", 0.0), ws / 2)
            k = max(1e-3, (pk.get("conductivity_mdft") or [0.0])[0])
            if x <= 1.0:
                x, k = 5.0, 0.01
            fr.append((STAGE_SPACING_FT / 2 + c["position_ft"], x, k, profile_shape(pk, x)))
        if all(x <= 5.0 for _, x, _, _ in fr):
            events.append("No proppant reached the fracture in a full grain layer: the fracture closes unpropped.")
        xf = max(x for _, x, _, _ in fr)
        cond = next(k for _, x, k, _ in fr if x == xf)
        spec = {"name": "pumpjob", "thickness_ft": t["pay_ft"],
                "perm_md": t["perm_md"], "porosity": 0.08, "pressure_psi": 5000.0, "fluid": "blackoil_spe1", "mesh": "coarse",
                "months": MONTHS, "dt_max_days": 30.0, "positions_ft": [f[0] for f in fr], "edge_ft": STAGE_SPACING_FT / 2,
                "width_ft": ws, "half_length_ft": [f[1] for f in fr], "conductivity_mdft": [f[2] for f in fr],
                "conductivity_shape": [f[3] for f in fr],
                "bhp_psi": 1500.0}
        prod = ctx.call("bhpsched", {"spec": spec, "monthly_bhp_psi": [1500.0] * MONTHS}, "produce")["monthly"]
        n = stages_per_well()
        vol = {k: [x * n for x in prod[k]] for k in ("oil", "gas", "water")}
        well_capex = opecon.COSTS["rig_spread_usd_day"] * (opecon.COSTS["vertical_days"] + opecon.LATERAL_FT / opecon.COSTS["lateral_ft_per_day"]) \
            + opecon.COSTS["tangibles_usd"] + opecon.COSTS["mobilisation_usd"] + opecon.COSTS["tie_in_usd"] + opecon.COSTS["lift_usd"]
        completion = cost * n + state["spent_usd"]
        op = [opecon.net_cash(vol["oil"][k], vol["gas"][k], vol["water"][k], 1)["net_usd"] for k in range(MONTHS)]
        m = opecon.measures(op, [well_capex + completion] + [0.0] * (MONTHS - 1), eur_boe=sum(vol["oil"]) + sum(vol["gas"]) / 6)
        m.pop("cum_cash_usd")
        state["production"] = {"months": MONTHS, "stage": prod, "well": vol, "stages_per_well": n, "fractures_per_stage": len(fr)}
        state["economics"] = {"stage_cost_usd": cost, "completion_usd": completion, "drilling_and_facilities_usd": well_capex, **m}
        ref = reference(state, ctx)
        ratio = base.relative(m["npv10_usd"], ref["npv10_usd"], 2e6)
        state["status"] = "finished"
        state["result"] = {"score": m["npv10_usd"], "stars": base.stars_for(ratio, (0.9, 1.0, 1.1)),
                           "headline": (f"{len(fr)} clusters, longest propped {xf:.0f} ft" if len(fr) > 1 else f"Propped {xf:.0f} ft at {cond:.1f} md-ft")
                                       + f"; well NPV10 ${m['npv10_usd'] / 1e6:.2f} MM, "
                                       + base.versus(m["npv10_usd"], ref["npv10_usd"], "the company's standard design"),
                           "breakdown": {"npv10_usd": m["npv10_usd"], "standard_design_npv10_usd": ref["npv10_usd"], "ratio": ratio,
                                         "screen_out": screen, "share_in_pay": state["growth"]["share_in_pay"], "stage_cost_usd": cost,
                                         "stage_oil_10yr_bbl": sum(prod["oil"]), "standard_stage_oil_10yr_bbl": ref.get("stage_oil_bbl"),
                                         "clusters": len(fr)},
                           "lookback": {"truth": t, "standard_design": ref["job"]}}
        events.append(f"Stage pumped: half-length {state['growth']['half_length_ft']:.0f} ft created, {xf:.0f} ft propped; "
                      f"{100 * state['growth']['share_in_pay']:.0f} % of the face in pay. Well NPV10 ${m['npv10_usd'] / 1e6:.2f} MM.")
        return events


STANDARD_ONE = {"fluid": "slickwater", "rate_bpm": 15.0, "minutes": 60.0, "sand": "100_mesh",
                "schedule": [[0.25, 0.5], [0.5, 1.0], [0.75, 1.5]]}
STANDARD = dict(STANDARD_ONE, clusters=3, shots_per_cluster=8)   # the company's modern plug-and-perf stage (standalone game)


def reference(state, ctx):
    """The company's standard slickwater design pumped into the same rock (scored the same way)."""
    t = state["truth"]
    std = STANDARD_ONE if state.get("career") else STANDARD
    ws = state.get("well_spacing_ft", WELL_SPACING_FT)
    g = ctx.call("grow", grow_input(t, std), "grow_ref")
    if g.get("runaway") or g.get("failed"):
        state["standard_propped"] = None
        return {"npv10_usd": 1.0, "job": std}
    cls = g.get("clusters") or [g]
    pos = cluster_positions(len(cls))
    fr = []
    for c, x0 in zip(cls, pos):
        pk = c.get("propped") or {}
        xf = min(max(pk.get("half_length_ft", 5.0), 5.0), ws / 2)
        fr.append((STAGE_SPACING_FT / 2 + x0, xf, max(1e-3, (pk.get("conductivity_mdft") or [0.01])[0]), profile_shape(pk, xf)))
    state["standard_propped"] = {"half_length_ft": fr[0][1], "conductivity_mdft": fr[0][2]}
    spec = {"name": "pumpref", "thickness_ft": t["pay_ft"], "perm_md": t["perm_md"], "porosity": 0.08, "pressure_psi": 5000.0,
            "fluid": "blackoil_spe1", "mesh": "coarse", "months": MONTHS, "dt_max_days": 30.0, "positions_ft": [f[0] for f in fr],
            "edge_ft": STAGE_SPACING_FT / 2, "width_ft": ws, "half_length_ft": [f[1] for f in fr], "conductivity_mdft": [f[2] for f in fr],
            "conductivity_shape": [f[3] for f in fr], "bhp_psi": 1500.0}
    prod = ctx.call("bhpsched", {"spec": spec, "monthly_bhp_psi": [1500.0] * MONTHS}, "produce_ref")["monthly"]
    n = stages_per_well()
    packed = any((c.get("propped") or {}).get("first_pack_min") is not None for c in cls)
    friction = sum(c.get("fluid_share", 1.0) * (c.get("perf_drop_psi") or 0.0) for c in cls)
    hhp_usd = std["rate_bpm"] * len(cls) * friction / 40.8 * std["minutes"] * HHP_USD_MIN
    cost = stage_cost(std) + hhp_usd + (CLEANOUT_USD if packed else 0.0)
    well_capex = opecon.COSTS["rig_spread_usd_day"] * (opecon.COSTS["vertical_days"] + opecon.LATERAL_FT / opecon.COSTS["lateral_ft_per_day"]) \
        + opecon.COSTS["tangibles_usd"] + opecon.COSTS["mobilisation_usd"] + opecon.COSTS["tie_in_usd"] + opecon.COSTS["lift_usd"]
    op = [opecon.net_cash(prod["oil"][k] * n, prod["gas"][k] * n, prod["water"][k] * n, 1)["net_usd"] for k in range(MONTHS)]
    m = opecon.measures(op, [well_capex + cost * n] + [0.0] * (MONTHS - 1))
    return {"npv10_usd": m["npv10_usd"], "job": std, "stage_oil_bbl": sum(prod["oil"])}


def check_job(a, career=False):
    fluid = a.get("fluid")
    if fluid not in FLUIDS:
        raise base.GameError(f"fluid must be one of {list(FLUIDS)}")
    sand = a.get("sand")
    if sand not in SANDS:
        raise base.GameError(f"sand must be one of {list(SANDS)}")
    sched = a.get("schedule")
    if not isinstance(sched, list) or not 1 <= len(sched) <= 6:
        raise base.GameError("schedule must be a list of 1-6 [start fraction, lb/gal] steps")
    steps = []
    for s in sched:
        try:
            f, c = float(s[0]), float(s[1])
        except (TypeError, ValueError, IndexError, KeyError):
            raise base.GameError("each schedule step is [start fraction 0-1, lb/gal 0-6]")
        if not (0 <= f < 1 and 0 <= c <= 6):
            raise base.GameError("each schedule step is [start fraction 0-1, lb/gal 0-6]")
        steps.append([f, c])
    steps.sort()
    clusters, shots = (1, 8) if career else (a.get("clusters", STANDARD["clusters"]), a.get("shots_per_cluster", STANDARD["shots_per_cluster"]))
    if isinstance(clusters, float) and clusters.is_integer():
        clusters = int(clusters)
    if isinstance(shots, float) and shots.is_integer():
        shots = int(shots)
    if not isinstance(clusters, int) or isinstance(clusters, bool) or not 1 <= clusters <= 6:
        raise base.GameError("clusters must be a whole number from 1 to 6")
    if not isinstance(shots, int) or isinstance(shots, bool) or not 2 <= shots <= 24:
        raise base.GameError("shots_per_cluster must be a whole number from 2 to 24")
    rate = base.num(a, "rate_bpm", 5, 40)
    if rate * clusters > MAX_STAGE_RATE_BPM:
        raise base.GameError(f"stage rate {rate * clusters:.0f} bbl/min is above the {MAX_STAGE_RATE_BPM:.0f} bbl/min the spread can pump")
    job = {"fluid": fluid, "rate_bpm": rate, "minutes": base.num(a, "minutes", 15, 120), "sand": sand, "schedule": steps}
    if clusters > 1:
        job.update(clusters=clusters, shots_per_cluster=shots)
    return job


def cluster_positions(n):
    """Clusters evenly spaced along the stage, relative to its centre (ft)."""
    s = STAGE_SPACING_FT / n
    return [(i - (n - 1) / 2) * s for i in range(n)]


def grow_input(t, job):
    d = {"pay_ft": t["pay_ft"], "barrier_psi": t["barrier_psi"], "youngs_psi": t["youngs_psi"], "leakoff_ft_sqrtmin": t["leakoff_ft_sqrtmin"],
         "viscosity_cp": FLUIDS[job["fluid"]]["viscosity_cp"], "rate_bpm": job["rate_bpm"], "minutes": job["minutes"], "ncell": 200,
         "proppant": {"schedule": job["schedule"], "diameter_mm": SANDS[job["sand"]], "closure_psi": t["closure_psi"]}}
    n = job.get("clusters", 1)
    # every job goes through the multi-cluster solver (one cluster too) so the sand can settle into a bank
    d.update(cluster_positions_ft=cluster_positions(n), stage_rate_bpm=job["rate_bpm"] * n, shots=job.get("shots_per_cluster", 0) if n > 1 else 0,
             perf_diameter_in=PERF_DIAMETER_IN)
    d["proppant"]["settling"] = True
    return d


def stage_cost(job):
    """Fluid, sand and horsepower for one stage, plus the fixed stage cost."""
    n = job.get("clusters", 1)
    bbl = job["rate_bpm"] * n * job["minutes"]
    sand_lb = 0.0
    sched = job["schedule"] + [[1.0, 0.0]]
    for (f0, c), (f1, _) in zip(sched, sched[1:]):
        sand_lb += c * bbl * (f1 - f0) * GAL_BBL           # lb/gal of clean fluid x gallons (slurry volume ~ clean volume here)
    return STAGE_FIXED_USD + (PERF_USD_CLUSTER * n if n > 1 else 0.0) + bbl * (FLUIDS[job["fluid"]]["usd_bbl"] + HORSEPOWER_USD_BBL) \
        + sand_lb * SAND_USD_LB


def profile_shape(pk, xf):
    """21 conductivity multipliers from the well to the (possibly cut) propped tip, relative to the value at the well."""
    xs, cs = pk.get("x_ft") or [], pk.get("conductivity_mdft") or []
    if not xs or not cs or cs[0] <= 0:
        return [1.0] * 21
    out = []
    for i in range(21):
        x = xf * i / 20
        j = min(range(len(xs)), key=lambda k: abs(xs[k] - x))
        out.append(max(cs[j], 0.0) / cs[0])
    return out


base.register(PumpJob())
