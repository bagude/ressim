"""Parent-child frac hits: frack a 4-well child pad next to 3 producing parent wells and decide how to protect the parents.

This game has no simulator physics behind it. The reservoir model does not model fracture interaction or parent depletion,
so hit probabilities and losses are game rules drawn from public industry ranges (hits are common inside ~500 ft and rare
beyond ~1,000 ft; a hit parent typically loses 5-40 % of its remaining production).

The hidden truth is drawn once per session as random numbers, and outcomes are resolved against the player's decisions:
a per-parent uniform u (the parent is hit when u < p, where p rises with job size and falls with distance), the step of the
job in which a hit would arrive, the hit severity, and the gauge precursor and false-alarm draws. Before the job the player
chooses, per parent, to shut in (with an optional pre-load) or keep producing, buys gauges, and may resize the child job.
The job is then fracked in 4-6 steps. Gauged parents show their pressure live, so the player can shut a parent in mid-job.

Damage from a hit depends on the parent's state when the hit arrives: shut in (halved), shut in and pre-loaded (further cut),
or producing (full damage unless the parent is shut in right after the hit; each extra step it keeps producing adds damage).
Score: regret against a hindsight plan that knew the draws (best job size, and per parent the best shut-in step and pre-load).
"""
import math

import opecon
from minigames import base

N_PARENTS = 3
CHILD_WELLS = 4
STAGES_PER_WELL = 40
STAGES = CHILD_WELLS * STAGES_PER_WELL
FRAC_DAYS = STAGES / opecon.COSTS["stages_per_day"]          # zipper frac at opecon's stage rate, ~27 days
MARGIN_USD_BBL = opecon.net_cash(1.0, 0.0, 0.0, 0)["net_usd"]  # net cash per parent barrel after royalty, taxes, LOE
PV_YEARS = 3.0                    # remaining parent value ~ 3 years of today's rate (declining, discounted tail)
RAMP_DAYS = 10.0                  # after a shut-in the parent ramps back over ~10 days (half its rate lost on average)
PRELOAD_DAYS = 4.0                # extra downtime to pump the pre-load
PRELOAD_USD = 120_000.0           # ~30,000 bbl of water plus pumping
GAUGE_USD = 15_000.0              # surface pressure gauge and monitoring for the job

REF_BBL_STAGE = 7_500.0           # reference job size for the hit-probability rule
SIZE_MIN, SIZE_MAX, SIZE_STEP = 4_000.0, 10_000.0, 500.0
SIZE_GRID = [4_000.0, 5_000.0, 6_000.0, 7_500.0, 9_000.0, 10_000.0]
HIT_P0 = 0.85                     # hit chance at 330 ft for the reference job and an average rock (k = 1)
DECAY_FT = 420.0                  # hit chance falls by e every 420 ft
HIT_PMAX = 0.95
SIZE_EXP = 1.0                    # hit chance scales with (size / reference)^1
SEV_MIN, SEV_MAX = 0.05, 0.40     # permanent loss of a producing parent hit with no response
SHUT_MIT = 0.5                    # shut in when the hit arrives: half the damage
PRELOAD_MIT = 0.6                 # pre-loaded as well: a further 40 % off
RESPONSE_BASE = 0.6               # producing when hit, shut in right after: 60 % of full damage; +20 % per extra step open
RESPONSE_STEP = 0.2
PRECURSOR_P = 0.65                # chance a gauge shows a pressure rise one step before a hit
FALSE_ALARM_P = 0.15              # chance a gauge shows a rise on a parent that is not about to be hit

CHILD_PV_WELL_USD = 8.0e6         # child well value at the reference job size (before fluid cost)
CHILD_SIZE_EXP = 0.2              # child value scales gently with job size
FLUID_USD_BBL = 4.0               # water, proppant and pumping per barrel of job (net child value still rises with size)
REGRET_SCALE_USD = 2.0e6         # score = 100 * exp(-regret / scale)
HINTS = ("weak", "moderate", "strong")


# ---- rules shared by play and the hindsight benchmark --------------------------------------------------------------------
def child_value(size):
    """Illustrative PV of the 4 child wells for a job size in bbl/stage, net of the fluid cost."""
    return CHILD_WELLS * (CHILD_PV_WELL_USD * (size / REF_BBL_STAGE) ** CHILD_SIZE_EXP - STAGES_PER_WELL * size * FLUID_USD_BBL)


def hit_prob(distance_ft, size, k=1.0):
    return min(HIT_PMAX, HIT_P0 * k * (size / REF_BBL_STAGE) ** SIZE_EXP * math.exp(-(distance_ft - 330.0) / DECAY_FT))


def parent_pv(rate):
    return rate * 365.0 * PV_YEARS * MARGIN_USD_BBL


def deferral_usd(rate, steps, shut_step, preload):
    """Production lost to a shut-in from shut_step (0 = before the job) to the end, plus the ramp-back."""
    if shut_step is None:
        return 0.0
    days = (steps - shut_step) * FRAC_DAYS / steps + 0.5 * RAMP_DAYS + (PRELOAD_DAYS if preload else 0.0)
    return rate * days * MARGIN_USD_BBL


def damage_share(hit, hit_step, shut_step, preload):
    """Share of the severity a parent suffers. hit_step = index of the step the hit arrives in; shut_step = number of
    steps done when the parent was shut in (None = never)."""
    if not hit:
        return 0.0
    if shut_step is not None and shut_step <= hit_step:
        return SHUT_MIT * (PRELOAD_MIT if preload else 1.0)
    open_after = (shut_step - hit_step - 1) if shut_step is not None else 10 ** 6
    return min(1.0, RESPONSE_BASE + RESPONSE_STEP * open_after)


def parent_cost(p, t, size, steps, shut_step, preload, gauge):
    """Total cost to one parent: deferral + pre-load + gauge + permanent loss. Returns a dict."""
    hit = t["u"] < hit_prob(p["distance_ft"], size, t["k"])
    share = damage_share(hit, t["hit_step"], shut_step, preload)
    loss = share * t["severity"] * parent_pv(p["rate_bopd"])
    d = deferral_usd(p["rate_bopd"], steps, shut_step, preload)
    extra = (PRELOAD_USD if preload else 0.0) + (GAUGE_USD if gauge else 0.0)
    return {"hit": hit, "loss_share": share * t["severity"], "loss_usd": loss, "deferral_usd": d,
            "extras_usd": extra, "total_usd": loss + d + extra}


def hindsight(parents, truth, steps, extra_size=None):
    """Best plan with the draws known: try every job size on the grid (plus the player's), and per parent every shut-in
    step, with or without a pre-load (pre-load only before the job). No gauges: hindsight does not need them."""
    sizes = sorted(set(SIZE_GRID + ([extra_size] if extra_size else [])))
    best = None
    for s in sizes:
        total, plan = child_value(s), []
        for p, t in zip(parents, truth):
            opts = [(None, False), (0, True)] + [(k, False) for k in range(steps)]
            c, sh, pl = min((parent_cost(p, t, s, steps, sh, pl, False)["total_usd"], sh if sh is not None else -1, pl)
                            for sh, pl in opts)
            total -= c
            plan.append({"id": p["id"], "shut_in_before_step": None if sh < 0 else sh + 1, "preload": pl, "cost_usd": round(c)})
        if best is None or total > best[0]:
            best = (total, s, plan)
    return best


def _bits(args, name, default):
    v = args.get(name, default)
    if not isinstance(v, list) or len(v) != N_PARENTS:
        raise base.GameError(f"{name} must be a list of {N_PARENTS} values (1 = yes, 0 = no), one per parent P1-P3")
    out = []
    for x in v:
        if isinstance(x, bool):
            out.append(x)
        elif isinstance(x, (int, float)) and x in (0, 1):
            out.append(bool(x))
        else:
            raise base.GameError(f"{name} entries must be 0 or 1")
    return out


class FracHits(base.Game):
    kind = "frac-hits"
    title = "Parent-Child"
    blurb = "Frack a child pad next to producing parents: shut in, pre-load, gauge, or gamble on frac hits."
    sim = False

    # ---- setup ---------------------------------------------------------------------------------------------------------
    def new(self, state, params, ctx):
        r = base.rng(state, "setup")
        bands = [(330, 600), (600, 1000), (1000, 1320)]       # one close, one middling, one far parent, in random order
        r.shuffle(bands)
        steps = r.randint(4, 6)
        planned = r.choice([6_000.0, 7_500.0, 9_000.0])
        parents, truth = [], []
        for i, (lo, hi) in enumerate(bands):
            d = round(r.uniform(lo, hi), -1)
            rate = round(r.uniform(60.0, 250.0))
            rp = base.rng(state, "parent", i)
            k = rp.uniform(0.65, 1.35)
            u = rp.random()
            frac = 0.45 + 0.55 * (d - 330.0) / 990.0          # closer parents are hit earlier in the job
            hit_step = min(steps - 1, int(steps * rp.random() * frac))
            sev = rp.uniform(SEV_MIN, SEV_MAX)
            precursor = rp.random() < PRECURSOR_P
            false_alarm = rp.randrange(steps) if rp.random() < FALSE_ALARM_P else None
            hit_psi = round(rp.uniform(300, 1500), -1)
            rise_psi = round(rp.uniform(60, 200), -1)
            # noisy offset-monitoring hint: k plus noise, binned
            h = k + rp.gauss(0.0, 0.15)
            hint = HINTS[0] if h < 0.88 else HINTS[2] if h > 1.12 else HINTS[1]
            parents.append({"id": f"P{i + 1}", "distance_ft": d, "rate_bopd": rate, "hint": hint,
                            "status": "producing", "shut_step": None, "preload": False, "gauge": False,
                            "readings": [], "hit_seen": False, "hit_seen_step": None})
            truth.append({"k": k, "u": u, "hit_step": hit_step, "severity": sev, "precursor": precursor,
                          "false_alarm_step": false_alarm, "hit_psi": hit_psi, "rise_psi": rise_psi})
        if params.get("career"):
            # in career mode the parents are the career's producing neighbours, in this order (P1 = first, ...)
            for p, cw in zip(parents, params.get("parents") or []):
                p["career_well"] = cw
        state["truth"] = {"parents": truth}
        state.update({"phase": "plan", "steps": steps, "step": 0, "planned_bbl_stage": planned, "job_bbl_stage": planned,
                      "parents": parents, "plan": {"shut_in": [0] * N_PARENTS, "preload": [0] * N_PARENTS,
                                                   "gauges": [0] * N_PARENTS, "job_bbl_stage": planned}})

    # ---- actions -------------------------------------------------------------------------------------------------------
    def act(self, state, action, args, ctx):
        if action == "plan":
            return self._plan(state, args)
        if action == "start_frac":
            return self._start(state)
        if action == "frac_step":
            return self._step(state)
        if action == "shut_in":
            pid = args.get("parent")
            p = next((x for x in state["parents"] if x["id"] == pid and x["status"] == "producing"), None)
            if p is None:
                raise base.GameError(f"parent must be one of {[x['id'] for x in state['parents'] if x['status'] == 'producing']}")
            p["status"], p["shut_step"] = "shut-in", state["step"]
            cost = deferral_usd(p["rate_bopd"], state["steps"], state["step"], False)
            return [f"Step {state['step']}: shut in {pid} for the rest of the job (about ${cost:,.0f} of deferred production)."]
        raise base.GameError(f"unknown action '{action}'")

    def _plan(self, state, args):
        pl = state["plan"]                                     # omitted args keep the current plan
        shut, pre, gau = (_bits(args, "shut_in", pl["shut_in"]), _bits(args, "preload", pl["preload"]),
                          _bits(args, "gauges", pl["gauges"]))
        size = base.num(args, "job_bbl_stage", SIZE_MIN, SIZE_MAX, state["plan"]["job_bbl_stage"])
        size = round(size / SIZE_STEP) * SIZE_STEP
        for i in range(N_PARENTS):
            if pre[i] and not shut[i]:
                raise base.GameError(f"P{i + 1}: a parent can only be pre-loaded if it is shut in for the job")
        state["plan"] = {"shut_in": [int(x) for x in shut], "preload": [int(x) for x in pre], "gauges": [int(x) for x in gau],
                         "job_bbl_stage": size}
        state["job_bbl_stage"] = size
        return [f"Plan: shut in {[f'P{i + 1}' for i in range(N_PARENTS) if shut[i]] or 'none'}, "
                f"pre-load {[f'P{i + 1}' for i in range(N_PARENTS) if pre[i]] or 'none'}, "
                f"gauges on {[f'P{i + 1}' for i in range(N_PARENTS) if gau[i]] or 'none'}, job {size:,.0f} bbl/stage."]

    def _start(self, state):
        pl = state["plan"]
        for i, p in enumerate(state["parents"]):
            p["gauge"] = bool(pl["gauges"][i])
            p["preload"] = bool(pl["preload"][i])
            if pl["shut_in"][i]:
                p["status"], p["shut_step"] = "shut-in", 0
        state["job_bbl_stage"] = pl["job_bbl_stage"]
        state["phase"] = "frac"
        return [f"Frac started: {STAGES} stages at {state['job_bbl_stage']:,.0f} bbl/stage in {state['steps']} steps "
                f"(~{FRAC_DAYS:.0f} days)."]

    def _step(self, state):
        s, steps = state["step"], state["steps"]
        events = [f"Step {s + 1} of {steps}: stages {s * STAGES // steps + 1}-{(s + 1) * STAGES // steps} pumped."]
        for p, t in zip(state["parents"], state["truth"]["parents"]):
            hit = t["u"] < hit_prob(p["distance_ft"], state["job_bbl_stage"], t["k"])
            if hit and t["hit_step"] == s:
                reading = {"step": s + 1, "signal": "hit", "dpsi": t["hit_psi"]}
            elif (hit and t["precursor"] and t["hit_step"] == s + 1) or t["false_alarm_step"] == s:
                reading = {"step": s + 1, "signal": "rising", "dpsi": t["rise_psi"]}
            else:
                reading = {"step": s + 1, "signal": "quiet", "dpsi": 0}
            if p["gauge"]:                                    # ungauged parents record nothing: no leak via log or view
                p["readings"].append(reading)
                if reading["signal"] == "hit":
                    p["hit_seen"], p["hit_seen_step"] = True, s + 1
                    events.append(f"{p['id']} gauge: pressure jumped {t['hit_psi']:,.0f} psi - a frac hit "
                                  f"({'shut in' if p['status'] == 'shut-in' else 'still producing'}).")
                elif reading["signal"] == "rising":
                    events.append(f"{p['id']} gauge: pressure rising {t['rise_psi']:,.0f} psi.")
        state["step"] = s + 1
        if state["step"] >= steps:
            self._finish(state)
            events.append(state["result"]["headline"])
        return events

    # ---- result --------------------------------------------------------------------------------------------------------
    def _outcome(self, state):
        size, steps = state["job_bbl_stage"], state["steps"]
        rows = [parent_cost(p, t, size, steps, p["shut_step"], p["preload"], p["gauge"])
                for p, t in zip(state["parents"], state["truth"]["parents"])]
        return child_value(size) - sum(r["total_usd"] for r in rows), rows

    def _finish(self, state):
        size, steps = state["job_bbl_stage"], state["steps"]
        value, rows = self._outcome(state)
        truth = state["truth"]["parents"]
        bench, bsize, bplan = hindsight(state["parents"], truth, steps, size)
        regret = max(0.0, bench - value)
        score = 100.0 * math.exp(-regret / REGRET_SCALE_USD)
        stars = base.stars_for(score / 100.0, (0.5, 0.75, 0.9))     # regret under ~$1.4MM, ~$575k, ~$210k
        hits = [p["id"] for p, r in zip(state["parents"], rows) if r["hit"]]
        lost = sum(r["total_usd"] for r in rows)
        headline = (f"{len(hits)} of {N_PARENTS} parents hit ({', '.join(hits) or 'none'}). Parent cost ${lost / 1e6:,.2f}MM; "
                    f"regret ${regret / 1e3:,.0f}k against hindsight.")
        state["phase"] = "done"
        state["status"] = "finished"
        state["result"] = {
            "score": round(score, 1), "stars": stars, "headline": headline,
            "breakdown": {"child_value_usd": round(child_value(size)), "job_bbl_stage": size,
                          "parent_loss_usd": round(sum(r["loss_usd"] for r in rows)),
                          "deferral_usd": round(sum(r["deferral_usd"] for r in rows)),
                          "preload_and_gauges_usd": round(sum(r["extras_usd"] for r in rows)),
                          "total_value_usd": round(value), "hindsight_value_usd": round(bench), "regret_usd": round(regret)},
            "lookback": {"parents": [{"id": p["id"], "distance_ft": p["distance_ft"],
                                      "hit_probability": round(hit_prob(p["distance_ft"], size, t["k"]), 3),
                                      "hit": r["hit"], "hit_step": t["hit_step"] + 1 if r["hit"] else None,
                                      "severity_if_unprotected": round(t["severity"], 3),
                                      "permanent_loss_share": round(r["loss_share"], 3), "loss_usd": round(r["loss_usd"]),
                                      "deferral_usd": round(r["deferral_usd"]),
                                      "shut_in_before_step": p["shut_step"] + 1 if p["shut_step"] is not None else None,
                                      "preload": p["preload"], "gauge": p["gauge"]}
                                     for p, t, r in zip(state["parents"], truth, rows)],
                         "hindsight": {"job_bbl_stage": bsize, "value_usd": round(bench), "parents": bplan}}}

    # ---- view ----------------------------------------------------------------------------------------------------------
    def view(self, state):
        active = state["status"] == "active"
        phase, steps, size = state["phase"], state["steps"], state["job_bbl_stage"]
        pl = state["plan"]
        parents = []
        for i, p in enumerate(state["parents"]):
            shut_now = p["status"] == "shut-in"
            if phase == "plan":
                cost_now = deferral_usd(p["rate_bopd"], steps, 0, bool(pl["preload"][i]))
            else:
                cost_now = deferral_usd(p["rate_bopd"], steps, state["step"], False) if not shut_now else 0.0
            parents.append({
                "id": p["id"], "career_well": p.get("career_well"), "distance_ft": p["distance_ft"], "rate_bopd": p["rate_bopd"],
                "remaining_pv_usd": round(parent_pv(p["rate_bopd"]), -3),
                "monitoring_hint": p["hint"],
                "typical_hit_chance": round(round(hit_prob(p["distance_ft"], size) / 0.05) * 0.05, 2),   # public rule of thumb, k = 1
                "status": p["status"],
                "shut_in_before_step": p["shut_step"] + 1 if p["shut_step"] is not None else None,
                "planned": {"shut_in": bool(pl["shut_in"][i]), "preload": bool(pl["preload"][i]), "gauge": bool(pl["gauges"][i])},
                "preload": p["preload"], "gauge": p["gauge"], "readings": p["readings"] if p["gauge"] else [],
                "hit_seen": p["hit_seen"], "hit_seen_step": p["hit_seen_step"],
                "shut_in_cost_usd": round(cost_now, -2)})
        committed = phase != "plan"
        deferral = sum(deferral_usd(p["rate_bopd"], steps, p["shut_step"], p["preload"]) for p in state["parents"]) if committed else 0.0
        extras = sum((PRELOAD_USD if p["preload"] else 0.0) + (GAUGE_USD if p["gauge"] else 0.0) for p in state["parents"])
        v = {"phase": phase, "step": state["step"], "steps": steps, "stages_total": STAGES,
             "stages_done": state["step"] * STAGES // steps, "frac_days": round(FRAC_DAYS, 1),
             "step_days": round(FRAC_DAYS / steps, 1),
             "child": {"wells": CHILD_WELLS, "stages_per_well": STAGES_PER_WELL, "planned_bbl_stage": state["planned_bbl_stage"],
                       "job_bbl_stage": size, "value_usd": round(child_value(size), -3),
                       "value_at_planned_usd": round(child_value(state["planned_bbl_stage"]), -3)},
             "parents": parents,
             "costs_usd": {"deferral_committed": round(deferral), "preload_and_gauges": round(extras)},
             "prices": {"preload_usd": PRELOAD_USD, "gauge_usd": GAUGE_USD, "margin_usd_bbl": round(MARGIN_USD_BBL, 2),
                        "ramp_days": RAMP_DAYS, "preload_days": PRELOAD_DAYS, "pv_years": PV_YEARS,
                        "fluid_usd_bbl": FLUID_USD_BBL}}
        actions = []
        if active and phase == "plan":
            bits = lambda what, key: base.arg("list", unit=f"1 = {what}, 0 = no; one entry per parent P1-P3",
                                              default=list(pl[key]), length=N_PARENTS)
            actions.append({"name": "plan", "label": "Set the plan for the parents and the child job",
                            "args": {"shut_in": bits("shut in for the job", "shut_in"),
                                     "preload": bits("pre-load (shut-in parents only)", "preload"),
                                     "gauges": bits("install a pressure gauge", "gauges"),
                                     "job_bbl_stage": base.arg("number", min=SIZE_MIN, max=SIZE_MAX, step=SIZE_STEP,
                                                               unit="bbl/stage", default=pl["job_bbl_stage"])}})
            actions.append({"name": "start_frac", "label": "Lock the plan and start the frac", "args": {}})
        elif active and phase == "frac":
            producing = [p["id"] for p in state["parents"] if p["status"] == "producing"]
            if producing:
                actions.append({"name": "shut_in", "label": "Shut in a parent now",
                                "args": {"parent": base.arg("enum", options=producing)}})
            actions.append({"name": "frac_step", "label": f"Frac step {state['step'] + 1} of {steps}", "args": {}})
        notes = ["Honesty note: fracture interaction and parent depletion effects are not modelled by the simulator; hit "
                 "probabilities and losses are game rules drawn from public industry ranges.",
                 "Rule of thumb used here: the hit chance falls with distance (common inside ~500 ft, rare beyond ~1,000 ft) and "
                 "rises with job size; the offset-monitoring hint is a noisy read on how communicative the rock is near each parent.",
                 f"A hit parent permanently loses {SEV_MIN:.0%}-{SEV_MAX:.0%} of its remaining value if it is producing and left "
                 f"open; shut in when the hit arrives halves that, and a pre-load cuts it by another {1 - PRELOAD_MIT:.0%}. "
                 f"Shutting a producing parent in right after a gauged hit limits the damage to {RESPONSE_BASE:.0%}.",
                 f"Shut-in costs the parent's production for the rest of the job plus a {RAMP_DAYS:.0f}-day ramp-back; values "
                 f"use ${MARGIN_USD_BBL:.0f}/bbl net margin from opecon and ~{PV_YEARS:.0f} years of today's rate as remaining value.",
                 "Only gauged parents show hits live; other hits are revealed at the end. Child value vs job size is an "
                 "illustrative rule. Score compares with a hindsight plan that knew every draw."]
        return {"view": v, "actions": actions, "notes": notes}


base.register(FracHits())
