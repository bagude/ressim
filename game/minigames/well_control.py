"""Well control: catch a drilling kick, shut in, fill in the kill sheet and pump a Wait-and-Weight kill.

Textbook hydrostatics in oilfield units, no simulator. Phases:
    drilling   drill / flow check / shut in, watching flow-out, pit gain and rate of penetration
    shut_in    read stabilised SIDPP and SICP; enter kill mud weight, MAASP and the influx type
    kill_sheet enter the initial and final circulating pressures (ICP, FCP)
    pumping    step through strokes, entering the drill-pipe pressure held on the choke at each step
Hidden truth: when the bit enters the over-pressured zone, how fast the influx grows, the formation pressure (as SIDPP)
and the influx fluid.

Pumping model (single bubble, no expansion): the drill-pipe pressure needed to keep bottom-hole pressure at formation
pressure, with a fraction f of the string full of the mud the player actually mixed (kmw), is
    P(f) = SIDPP - 0.052 TVD (kmw - MW) f + SCR (1 + (kmw / MW - 1) f)
which is ICP at f = 0 and FCP at f = 1 when kmw is the right kill weight. Holding less underbalances the well (the
influx grows); holding more adds the same pressure at the casing and the shoe.
"""
from . import base

G = 0.052                       # psi/ft per ppg
JOINT_FT = 30.0                 # drilled per drilling turn
BHA_FT = 600.0
ANN_DC = 0.0291                 # bbl/ft, 8-1/2" hole x 6-1/2" collars
ANN_DP = 0.0459                 # bbl/ft, 8-1/2" hole x 5" drill pipe
CAP_DP = 0.01776                # bbl/ft inside 5" 19.5 lb/ft pipe
CAP_DC = 0.0073                 # bbl/ft inside 6-1/2" x 2-13/16" collars
PUMP_BBL_STK = 0.102
KILL_SPM = 30
LOSE_BBL = 80.0                 # influx at which the well is lost
UNDER_TOL, OVER_TOL = 50.0, 150.0   # safe window around the needed drill-pipe pressure while pumping, psi
STEPS_STRING, STEPS_ANNULUS = 5, 5
INFLUX = {"gas": (0.08, 0.15), "oil": (0.30, 0.36), "water": (0.44, 0.47)}   # psi/ft ranges for the hidden influx
NOTES = [
    "Textbook hydrostatics only, no reservoir simulator.",
    "Single-bubble model: no gas migration or expansion beyond the simple influx-height calculation.",
    "Training-calculator level: not for real well control. Follow your company's procedures and certified kill sheets.",
    "Influx classes used here: gas below 0.25 psi/ft, oil 0.25-0.40 psi/ft, water above 0.40 psi/ft.",
    "MAASP is computed with the original mud in the hole and held constant during the kill.",
]


# ---------- formulas (also used by the tests) -------------------------------------------------------------------------

def kill_mud_weight(mw, sidpp, tvd):
    return mw + sidpp / (G * tvd)


def icp(scr, sidpp):
    return scr + sidpp


def fcp(scr, kmw, mw):
    return scr * kmw / mw


def maasp(fracture_emw, mw, shoe_tvd):
    return (fracture_emw - mw) * G * shoe_tvd


def influx_height(pit_gain, ann_dc=ANN_DC, ann_dp=ANN_DP, bha_ft=BHA_FT):
    """Height of the influx at the bottom of the annulus: first around the collars, then around the pipe."""
    v_dc = bha_ft * ann_dc
    if pit_gain <= v_dc:
        return pit_gain / ann_dc
    return bha_ft + (pit_gain - v_dc) / ann_dp


def influx_gradient(mw, sidpp, sicp, height):
    return G * mw - (sicp - sidpp) / height


def classify(gradient):
    return "gas" if gradient < 0.25 else ("oil" if gradient <= 0.40 else "water")


def required_dpp(frac, sidpp, scr, mw, kmw, tvd):
    """Drill-pipe pressure that keeps bottom-hole pressure at formation pressure with fraction frac of the string full
    of kmw mud (Wait and Weight, pumping at the slow circulating rate)."""
    return sidpp - G * tvd * (kmw - mw) * frac + scr * (1.0 + (kmw / mw - 1.0) * frac)


# ---------- the game --------------------------------------------------------------------------------------------------

class WellControl(base.Game):
    kind = "well-control"
    title = "Kick!"
    blurb = "Spot a kick, shut in, work the kill sheet and pump a Wait-and-Weight kill without breaking the shoe."
    sim = False

    def new(self, state, params, ctx):
        r = base.rng(state, "well")
        depth = round(r.uniform(9000.0, 10800.0) / 10.0) * 10.0
        mw = round(r.uniform(9.5, 11.0), 1)
        tvd_kick = depth + 4 * JOINT_FT         # roughly where the kick will be read
        shoe = round(r.uniform(0.55, 0.70) * tvd_kick, -2)
        fg = round(mw + r.uniform(1100.0, 1500.0) / (G * shoe), 1)
        kind = r.choice(sorted(INFLUX))
        state["well"] = {
            "mw_ppg": mw, "shoe_tvd_ft": shoe, "shoe_fracture_emw_ppg": fg,
            "scr_psi": float(round(r.uniform(400.0, 700.0), -1)), "kill_rate_spm": KILL_SPM,
            "bha_length_ft": BHA_FT, "annular_capacity_dc_bbl_ft": ANN_DC, "annular_capacity_dp_bbl_ft": ANN_DP,
            "string_capacity_dp_bbl_ft": CAP_DP, "string_capacity_dc_bbl_ft": CAP_DC, "pump_output_bbl_stk": PUMP_BBL_STK,
        }
        state["truth"] = {
            "kick_turn": r.randint(2, 4),                       # drilling turn on which the bit enters the zone
            "influx_rate_bbl": round(r.uniform(2.5, 4.0), 2),   # influx added per turn grows with time in the zone
            "sidpp_psi": float(round(r.uniform(250.0, 650.0), -1)),
            "influx_type": kind, "influx_gradient_psi_ft": round(r.uniform(*INFLUX[kind]), 3),
            "influx_bbl": 0.0, "kick_turns": 0,
        }
        state["phase"] = "drilling"
        state["depth_ft"] = depth
        state["drill_turns"] = 0
        state["false_alarms"] = 0
        state["readings"] = []
        state["shut_in"] = None
        state["answers"] = {}
        state["pump"] = []
        state["pump_step"] = 0

    # ----- helpers

    def _strokes(self, state):
        d = state["depth_ft"]
        to_bit = ((d - BHA_FT) * CAP_DP + BHA_FT * CAP_DC) / PUMP_BBL_STK
        bottoms_up = ((d - BHA_FT) * ANN_DP + BHA_FT * ANN_DC) / PUMP_BBL_STK
        return round(to_bit), round(bottoms_up)

    def _sicp(self, state, influx_bbl):
        t, mw = state["truth"], state["well"]["mw_ppg"]
        return t["sidpp_psi"] + influx_height(influx_bbl) * (G * mw - t["influx_gradient_psi_ft"])

    def _maasp(self, state):
        w = state["well"]
        return maasp(w["shoe_fracture_emw_ppg"], w["mw_ppg"], w["shoe_tvd_ft"])

    def _answers_truth(self, state):
        """The right answers, from the numbers the player was shown."""
        w, s = state["well"], state["shut_in"]
        kmw = kill_mud_weight(w["mw_ppg"], s["sidpp_psi"], s["tvd_ft"])
        g = influx_gradient(w["mw_ppg"], s["sidpp_psi"], s["sicp_psi"], influx_height(s["pit_gain_bbl"]))
        return {"kmw_ppg": kmw, "icp_psi": icp(w["scr_psi"], s["sidpp_psi"]), "fcp_psi": fcp(w["scr_psi"], kmw, w["mw_ppg"]),
                "maasp_psi": self._maasp(state), "influx_gradient_psi_ft": g, "influx": classify(g)}

    def _schedule(self, state):
        """Pump steps: (strokes, fraction of string full of kill mud, fraction of annulus displaced)."""
        stb, bu = self._strokes(state)
        out = [(0, 0.0, 0.0)]
        out += [(round(stb * i / STEPS_STRING), i / STEPS_STRING, 0.0) for i in range(1, STEPS_STRING + 1)]
        out += [(stb + round(bu * j / STEPS_ANNULUS), 1.0, j / STEPS_ANNULUS) for j in range(1, STEPS_ANNULUS + 1)]
        return out

    # ----- actions

    def act(self, state, action, args, ctx):
        handler = {"drill": self._drill, "flow_check": self._flow_check, "shut_in": self._shut_in,
                   "kill_mud": self._kill_mud, "kill_sheet": self._kill_sheet, "pump": self._pump}.get(action)
        if handler is None:
            raise base.GameError(f"unknown action '{action}'")
        return handler(state, args)

    def _grow(self, state, turns=1.0):
        t = state["truth"]
        t["kick_turns"] += 1
        t["influx_bbl"] += t["influx_rate_bbl"] * t["kick_turns"] * turns

    def _drill(self, state, args):
        t = state["truth"]
        r = base.rng(state, "reading", state["drill_turns"])
        state["drill_turns"] += 1
        state["depth_ft"] += JOINT_FT
        in_zone = state["drill_turns"] >= t["kick_turn"]
        if in_zone:
            self._grow(state)
        rop = r.gauss(60.0, 5.0) * (1.8 if in_zone and t["kick_turns"] == 1 else (1.3 if in_zone else 1.0))
        flow = 100.0 + 6.0 * t["kick_turns"] + r.gauss(0.0, 1.5)
        pit = t["influx_bbl"] + r.gauss(0.0, 0.8)
        state["readings"].append({"turn": state["drill_turns"], "depth_ft": state["depth_ft"], "rop_ft_hr": round(rop, 1),
                                  "flow_out_pct": round(flow, 1), "pit_gain_bbl": round(pit, 1)})
        ev = [f"Drilled to {state['depth_ft']:,.0f} ft: ROP {rop:.0f} ft/hr, flow out {flow:.0f} %, pit {pit:+.1f} bbl."]
        if t["influx_bbl"] > LOSE_BBL:
            ev.append("The well unloads mud over the derrick: blowout. Game over.")
            self._finish(state, lost="blowout while drilling")
        return ev

    def _flow_check(self, state, args):
        t = state["truth"]
        if t["kick_turns"] == 0:
            return ["Flow check: pumps off, the well is static. No flow."]
        self._grow(state, 0.5)
        ev = [f"Flow check: pumps off and the well keeps flowing. Pit gain now about {t['influx_bbl']:.0f} bbl."]
        if t["influx_bbl"] > LOSE_BBL:
            ev.append("The flow accelerates before you can close the BOP: blowout. Game over.")
            self._finish(state, lost="blowout during flow check")
        return ev

    def _shut_in(self, state, args):
        t = state["truth"]
        if t["kick_turns"] == 0:
            state["false_alarms"] += 1
            return ["Shut in: both gauges read zero and the pits are steady. False alarm; open up and keep drilling."]
        vol = round(t["influx_bbl"], 1)
        sicp = round(self._sicp(state, vol))
        state["shut_in"] = {"pit_gain_bbl": vol, "sidpp_psi": t["sidpp_psi"], "sicp_psi": float(sicp),
                            "tvd_ft": state["depth_ft"]}
        state["phase"] = "shut_in"
        ev = [f"Shut in at {state['depth_ft']:,.0f} ft. Stabilised: SIDPP {t['sidpp_psi']:.0f} psi, SICP {sicp:.0f} psi, "
              f"pit gain {vol:.1f} bbl."]
        if sicp >= self._maasp(state):
            ev.append("Casing pressure is above MAASP: the shoe breaks down and returns are lost underground. Game over.")
            self._finish(state, lost="shoe broke down at shut-in")
        return ev

    def _kill_mud(self, state, args):
        a = state["answers"]
        a["kmw_ppg"] = base.num(args, "kmw_ppg", 8.0, 20.0)
        a["maasp_psi"] = base.num(args, "maasp_psi", 0.0, 10000.0)
        if args.get("influx") not in ("gas", "oil", "water"):
            raise base.GameError("influx must be gas, oil or water")
        a["influx"] = args["influx"]
        state["phase"] = "kill_sheet"
        return [f"Weighting up the pits to {a['kmw_ppg']:.2f} ppg. MAASP {a['maasp_psi']:.0f} psi, influx logged as "
                f"{a['influx']}."]

    def _kill_sheet(self, state, args):
        a = state["answers"]
        a["icp_psi"] = base.num(args, "icp_psi", 0.0, 10000.0)
        a["fcp_psi"] = base.num(args, "fcp_psi", 0.0, 10000.0)
        state["phase"] = "pumping"
        return [f"Kill sheet: ICP {a['icp_psi']:.0f} psi, FCP {a['fcp_psi']:.0f} psi. Bring the pump up to "
                f"{KILL_SPM} spm holding casing pressure constant."]

    def _pump(self, state, args):
        t, w, s, a = state["truth"], state["well"], state["shut_in"], state["answers"]
        dpp = base.num(args, "dpp_psi", 0.0, 10000.0)
        strokes, frac, ann = self._schedule(state)[state["pump_step"]]
        mw, kmw, tvd = w["mw_ppg"], a["kmw_ppg"], s["tvd_ft"]
        need = required_dpp(frac, t["sidpp_psi"], w["scr_psi"], mw, kmw, tvd)
        excess = dpp - need
        ev = []
        if excess < -UNDER_TOL:     # underbalanced: formation fluid keeps coming in
            gain = (-excess - UNDER_TOL) / 20.0
            t["influx_bbl"] += gain
            ev.append(f"Pit gain up {gain:.1f} bbl: bottom-hole pressure is below formation pressure.")
        resid = max(0.0, t["sidpp_psi"] - G * tvd * (kmw - mw))    # shut-in pressure left once kmw fills the well
        cp_base = self._sicp(state, t["influx_bbl"]) * (1.0 - ann) + resid * ann
        cp = max(0.0, cp_base + excess)
        limit = self._maasp(state)
        safe = -UNDER_TOL <= excess <= OVER_TOL and cp <= limit
        state["pump"].append({"step": state["pump_step"], "strokes": strokes, "dpp_psi": dpp, "casing_psi": round(cp),
                              "pit_gain_bbl": round(t["influx_bbl"], 1)})
        t.setdefault("pump_safe", []).append(safe)                    # graded at the end, not shown mid-kill
        t.setdefault("pump_need_psi", []).append(round(need, 1))      # hidden, for the lookback
        ev.insert(0, f"{strokes:,} strokes: drill pipe {dpp:.0f} psi, casing {cp:.0f} psi, "
                     f"pit gain {t['influx_bbl']:.1f} bbl.")
        state["pump_step"] += 1
        if cp > limit:
            ev.append("Casing pressure above MAASP: the shoe fractures and returns are lost. Game over.")
            self._finish(state, lost="lost returns at the shoe while pumping")
        elif t["influx_bbl"] > LOSE_BBL:
            ev.append("The influx overwhelms the choke: the well is lost. Game over.")
            self._finish(state, lost="influx grew out of control while pumping")
        elif state["pump_step"] >= len(self._schedule(state)):
            if resid > 25.0:
                ev.append(f"Kill mud circulated but the well is not dead: {resid:.0f} psi still on the drill pipe.")
            else:
                ev.append("Kill mud all round: pressures bleed to zero and the well is dead.")
            self._finish(state, lost=None, residual=resid)
        return ev

    # ----- scoring

    def _finish(self, state, lost, residual=None):
        t, w = state["truth"], state["well"]
        a, s = state["answers"], state["shut_in"]
        pts = {"shut_in": 0.0, "kmw": 0.0, "icp": 0.0, "fcp": 0.0, "maasp": 0.0, "influx": 0.0, "pumping": 0.0}
        right = self._answers_truth(state) if s else {}
        if s:
            g = s["pit_gain_bbl"]
            pts["shut_in"] = 20.0 if g <= 10 else 12.0 if g <= 20 else 6.0 if g <= 30 else 0.0
            pts["shut_in"] = max(0.0, pts["shut_in"] - 3.0 * state["false_alarms"])
        if "kmw_ppg" in a:
            d = a["kmw_ppg"] - right["kmw_ppg"]
            pts["kmw"] = 20.0 if -0.02 <= d <= 0.15 else (8.0 if abs(d) <= 0.3 else 0.0)
            pts["maasp"] = 5.0 if abs(a["maasp_psi"] - right["maasp_psi"]) <= 30 else 0.0
            pts["influx"] = 5.0 if a["influx"] == right["influx"] else 0.0
        if "icp_psi" in a:
            pts["icp"] = 15.0 if abs(a["icp_psi"] - right["icp_psi"]) <= 30 else 0.0
            pts["fcp"] = 15.0 if abs(a["fcp_psi"] - right["fcp_psi"]) <= 30 else 0.0
        steps = len(self._schedule(state))
        safe = t.get("pump_safe", [])
        pts["pumping"] = 20.0 * sum(safe) / steps
        score = sum(pts.values())
        dead = lost is None and (residual or 0.0) <= 25.0
        stars = 0 if lost else min(base.stars_for(score / 100.0, (0.6, 0.8, 0.9)), 3 if dead else 2)
        if lost:
            head = f"Well lost: {lost}. 0 stars."
        else:
            head = f"{'Well killed' if dead else 'Well not dead after the circulation'}: score {score:.0f}/100, {stars} star" \
                   f"{'s' if stars != 1 else ''}."
        state["status"] = "finished"
        state["phase"] = "finished"
        state["result"] = {
            "score": round(score, 1), "stars": stars, "headline": head,
            "breakdown": {"points": pts, "answers": dict(a), "pit_gain_at_shut_in_bbl": s["pit_gain_bbl"] if s else None,
                          "false_alarms": state["false_alarms"], "lost": lost, "well_dead": dead,
                          "safe_pump_steps": sum(safe), "pump_steps": steps},
            "lookback": {
                "correct": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in right.items()},
                "kick_turn": t["kick_turn"], "influx_rate_bbl_per_turn": t["influx_rate_bbl"],
                "true_influx_type": t["influx_type"], "true_influx_gradient_psi_ft": t["influx_gradient_psi_ft"],
                "formation_pressure_psi": round(G * w["mw_ppg"] * s["tvd_ft"] + t["sidpp_psi"]) if s else None,
                "pump_needed_dpp_psi": t.get("pump_need_psi", []),
                "pump_held_dpp_psi": [p["dpp_psi"] for p in state["pump"]],
                "pump_step_safe": safe,
                "safe_window": f"held drill-pipe pressure within -{UNDER_TOL:.0f}/+{OVER_TOL:.0f} psi of the needed value "
                               f"and casing pressure at or below MAASP",
            },
        }

    # ----- view

    def view(self, state):
        stb, bu = self._strokes(state)
        v = {"phase": state["phase"], "depth_ft": state["depth_ft"], "well": dict(state["well"], strokes_to_bit=stb,
                                                                                  strokes_bottoms_up=bu),
             "readings": state["readings"][-20:], "false_alarms": state["false_alarms"],
             "shut_in": state["shut_in"], "answers": state["answers"], "pump": state["pump"]}
        a = state["answers"]
        if "icp_psi" in a:   # the player's own kill-sheet line, from their ICP and FCP
            v["schedule"] = [{"strokes": st, "dpp_psi": round(a["icp_psi"] - (a["icp_psi"] - a["fcp_psi"]) * f)}
                             for st, f, _ in self._schedule(state)]
            if state["pump_step"] < len(self._schedule(state)):
                v["next_strokes"] = self._schedule(state)[state["pump_step"]][0]
        psi = base.arg("number", min=0, max=10000, step=1, unit="psi")
        actions = {
            "drilling": [
                {"name": "drill", "label": "Drill ahead one joint", "args": {}},
                {"name": "flow_check", "label": "Flow check", "args": {}},
                {"name": "shut_in", "label": "Shut in the well", "args": {}},
            ],
            "shut_in": [{"name": "kill_mud", "label": "Kill mud weight, MAASP and influx type", "args": {
                "kmw_ppg": base.arg("number", min=8, max=20, step=0.01, unit="ppg"), "maasp_psi": psi,
                "influx": base.arg("enum", options=["gas", "oil", "water"])}}],
            "kill_sheet": [{"name": "kill_sheet", "label": "Initial and final circulating pressure",
                            "args": {"icp_psi": psi, "fcp_psi": psi}}],
            "pumping": [{"name": "pump", "label": "Pump to the next stroke count holding this drill-pipe pressure",
                         "args": {"dpp_psi": psi}}],
        }.get(state["phase"], []) if state["status"] == "active" else []
        return {"view": v, "actions": actions, "notes": NOTES}


base.register(WellControl())
