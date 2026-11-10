"""Minigames inside career mode.

A task is a minigame session linked to the career (and to a pad or wells). It is created by a trigger (a pad starting,
a well spudding, the annual budget meeting, a pad's first producing year); time cannot pass a blocking task's due
point until it is finished; when the session finishes, its result is applied to the career's hidden truth.

Effects (what each minigame changes in the career):
  pump-job      the pad's wells are completed with the propped half-length and conductivity you achieved (absolute)
  flowback      the pad's wells produce with your month-by-month bottom-hole pressure schedule (absolute)
  well-control  a kick on a spud: non-productive time and cost; a lost well costs a redrill
  hedging       your hedge book is settled month by month against the career's hidden oil price path
  rig-contracts this year's rig spread cost scales with how well you contracted against the market benchmark
  water         this year's completion cost scales with your water plan's cost against its benchmark
  facility      sets the battery's oil limit (production above it is curtailed) and charges its capex
  land-auction  tracts you win join the field as new open sections
  diagnostics   board confidence moves with the quality of your diagnosis of one of your own wells
  lift          the pad's production from the switch month scales with your plan against standard practice; lift costs
  frac-hits     parent wells next to a newly fracked pad lose production as the game resolves it
"""
import hashlib
import math
import random

import opecon
from minigames import REGISTRY, base

YEARLY_OPTIONAL = ["hedging", "rig-contracts", "water", "facility", "land-auction", "diagnostics"]
KICK_PROBABILITY = 0.04


def _career():
    import career
    return career


def new_task(state, truth, kind, label, link, blocking, due_day, params, ctx):
    g = REGISTRY.get(kind)
    if g is None:
        return None
    tid = f"t{len(state.setdefault('tasks', [])) + 1:03d}"
    if state.get("autopilot"):            # the staff benchmark: every job delegated at once, in memory
        task = {"id": tid, "kind": kind, "label": label, "link": link, "session": None, "blocking": blocking, "due_day": due_day,
                "due_month": None, "created_month": state["month"], "status": "open"}
        if kind == "frac-hits":           # standard practice needs the job's draws
            mg = base.new_state(kind, {"seed": int(hashlib.sha1(f"{state['seed']}|{tid}|{kind}".encode()).hexdigest()[:8], 16)})
            g.new(mg, params, base.Ctx(None, None, None))
            task["_mg"] = mg
        state["tasks"].append(task)
        delegate(state, tid, truth)
        task.pop("_mg", None)
        return task
    seed = int(hashlib.sha1(f"{state['seed']}|{tid}|{kind}".encode()).hexdigest()[:8], 16)   # stable across runs
    mg = base.new_state(kind, {"seed": seed})
    mg["link"] = {"career": state["id"], "task": tid, **link}
    g.new(mg, params, base.Ctx(ctx.worker, ctx.truth_sim, base.store_dir(kind) / mg["id"]))
    base.save(mg)
    task = {"id": tid, "kind": kind, "label": label, "link": link, "session": mg["id"], "blocking": blocking,
            "due_day": due_day, "due_month": None if due_day is None else round(due_day / opecon.MONTH_DAYS, 2),
            "created_month": state["month"], "status": "open"}
    state["tasks"].append(task)
    _career().inbox(state, "task", label, ("Required before " if blocking else "Optional, until ")
                    + (f"month {task['due_month']:.1f}." if due_day is not None else "the year ends.") + f" Minigame: {g.title}.",
                    {"task": tid, "kind": kind, "session": mg["id"], **link})
    return task


def blocking_pending(state, t1):
    return [t for t in state.get("tasks", []) if t["status"] == "open" and t["blocking"] and t["due_day"] is not None and t["due_day"] < t1]


STAFF_COST_FACTOR = 1.15     # rig and water contracting left to staff: typical, not sharp, market timing


def task_view(t):
    """A task as the browser sees it: what staff would do, and on finished ones how you did against that."""
    out = dict(t)
    out.pop("warned", None)
    msg = STANDARD_OUTCOME.get(t["kind"], "the company follows standard practice")
    out["staff_outcome"] = {"headline": msg[0].upper() + msg[1:] + "."}
    return out


def _versus(metric, unit, yours, staff, higher_better=True, note=None):
    d = (yours - staff) if higher_better else (staff - yours)
    return {"metric": metric, "unit": unit, "yours": yours, "staff": staff, "delta": d, "better": d > 0, "worse": d < 0,
            **({"note": note} if note else {})}


def frac_hits_standard(mg):
    """Standard practice on this job: reference size, every parent shut in before the job, no pre-load, no gauges."""
    from minigames import frac_hits as fh
    rows = [fh.parent_cost(p, t, fh.REF_BBL_STAGE, mg["steps"], 0, False, False) for p, t in zip(mg["parents"], mg["truth"]["parents"])]
    return fh.child_value(fh.REF_BBL_STAGE) - sum(r["total_usd"] for r in rows), rows


def _apply_frac_hit_losses(state, truth, parents, shares, why):
    hit = []
    for pid, l in zip(parents, shares):
        if l <= 0:
            continue
        hit.append(f"{pid} -{100 * l:.0f} %")
        m = {"from_month": state["month"], "factor": 1.0 - l, "why": why}
        for w in state["wells"]:
            if w["id"] == pid:
                w.setdefault("multipliers", []).append(m)
        for a in (truth or {}).get("analogs", []):
            if a["id"] == pid:
                a.setdefault("multipliers", []).append(m)
    return hit


def staff_outcome(state, t, truth=None):
    if t["kind"] == "frac-hits" and truth is not None:
        try:
            mg = t.get("_mg") or base.load("frac-hits", t["session"])
            _, rows = frac_hits_standard(mg)
            hit = _apply_frac_hit_losses(state, truth, t["link"].get("parents") or [], [r["loss_share"] for r in rows], "frac hit (standard practice)")
            t["staff_result"] = ("Frac hits under standard practice: " + ", ".join(hit) + ".") if hit else "No parent well lost production."
        except base.GameError:
            pass
    if t["kind"] in ("rig-contracts", "water", "facility"):
        y = str(t["link"]["year"] - 1)
        key = {"rig-contracts": "rig", "water": "completion", "facility": "facilities"}[t["kind"]]
        state.setdefault("cost_factors", {}).setdefault(y, {}).setdefault(key, STAFF_COST_FACTOR)


def expire(state, t1, truth=None):
    """Optional tasks past their due point lapse: staff handle them with typical results."""
    for t in state.get("tasks", []):
        if t["status"] == "open" and not t["blocking"] and t["due_day"] is not None and t["due_day"] <= t1:   # year-end jobs lapse at year end
            t["status"] = "lapsed"
            staff_outcome(state, t, truth)


# ---- triggers -------------------------------------------------------------------------------------
def on_lock(state, truth, pad, plan_pad, ctx):
    c = _career()
    rock = c.rock_of(truth, pad["section"])
    design = state["plan"]["design"]
    wells = [w for w in state["wells"] if w["pad"] == pad["id"]]
    if plan_pad.get("completion") == "manual":
        new_task(state, truth, "pump-job", f"Pump the job for pad {pad['id']}", {"pad": pad["id"]}, True, pad["frac_start"],
                 {"career": True, "pay_ft": rock["thickness_ft"], "perm_md": rock["perm_md"],
                  "well_spacing_ft": 5280.0 / len(wells)}, ctx)
    if plan_pad.get("flowback") == "manual":
        new_task(state, truth, "flowback", f"Bring pad {pad['id']} on: choke plan", {"pad": pad["id"]}, True, pad["online"],
                 {"career": True, "perm_md": rock["perm_md"], "thickness_ft": rock.get("net_ft", rock["thickness_ft"]), "half_length_ft": design["half_length_ft"],
                  "conductivity_mdft": design["conductivity_mdft"], "width_ft": 5280.0 / len(wells),
                  "stage_spacing_ft": design["stage_spacing_ft"], "gas_price_usd_mcf": opecon.PRICE_DECK["gas_usd_mcf"]}, ctx)
    for w in wells:
        r = random.Random(f"{state['seed']}|kick|{w['id']}")
        if r.random() < KICK_PROBABILITY:
            new_task(state, truth, "well-control", f"Kick on {w['id']}!", {"pad": pad["id"], "well": w["id"]}, True, w["spud_day"], {}, ctx)
    # frac hits: producing wells in neighbouring sections
    sec = next(s for s in state["sections"] if s["section"] == pad["section"])
    near = [s["section"] for s in state["sections"] if abs(s["col"] - sec["col"]) + abs(s["row"] - sec["row"]) == 1]
    parents = [w["id"] for w in state["wells"] if w["section"] in near and w["online_day"] < pad["frac_start"]][:3]
    parents += [a["id"] for a in truth["analogs"] if a["section"] in near][: 3 - len(parents)]
    if parents:
        new_task(state, truth, "frac-hits", f"Frac hits: pad {pad['id']} next to {', '.join(parents)}",
                 {"pad": pad["id"], "parents": parents}, False, pad["frac_start"],
                 {"career": True, "parents": parents, "distances_ft": [5280.0 / max(1, len(wells))] * len(parents)}, ctx)


def on_month(state, truth, ctx):
    """Lift decision once a pad has produced for a year."""
    c = _career()
    done = {t["link"].get("pad") for t in state.get("tasks", []) if t["kind"] == "lift"}
    for pid, p in state["locked"].items():
        if pid in done or (state["month"] * opecon.MONTH_DAYS - p["online"]) < 12 * opecon.MONTH_DAYS:
            continue
        rock = c.rock_of(truth, p["section"])
        new_task(state, truth, "lift", f"Lift decision for pad {pid}", {"pad": pid}, False, state["month"] * opecon.MONTH_DAYS + 3 * opecon.MONTH_DAYS,
                 {"career": True, "perm_md": rock["perm_md"], "thickness_ft": rock.get("net_ft", rock["thickness_ft"])}, ctx)


def on_budget(state, truth, ctx, forecast_oil_by_month):
    """Optional yearly tasks after the board approves a budget; they lapse at year end."""
    c = _career()
    y = state["month"] // 12
    year_end = (y + 1) * 12 * opecon.MONTH_DAYS
    m0 = state["month"]
    nri = opecon.TERMS["working_interest"] * (1 - opecon.TERMS["royalty"])
    price_now = price_at(state, truth, max(0, m0 - 1))
    params = {
        "hedging": {"career": True, "spot": price_now, "forecast_net_bbl": [x * nri for x in forecast_oil_by_month[m0:m0 + 24]]},
        "rig-contracts": {"target_wells": max(10, min(150, 4 * sum(p["wells"] for p in state["plan"]["pads"] if p["id"] not in state["locked"]) or 20))},
        "water": {"volume": "high" if sum(p["wells"] for p in state["plan"]["pads"] if p["id"] not in state["locked"]) > 8 else "low"},
        "facility": {"career": True}, "land-auction": {}, "diagnostics": {"career": True},
    }
    own = [w for w in state["wells"] if w["online_day"] < m0 * opecon.MONTH_DAYS - 6 * opecon.MONTH_DAYS]
    for kind in YEARLY_OPTIONAL:
        if kind == "diagnostics":
            if not own:
                continue
            w = own[len(own) // 2]
            params[kind].update(rock=c.rock_of(truth, w["section"]), design=w["design"], wells_per_section=w["wells_per_section"], well=w["id"])
        if kind == "facility":
            ws = [w for w in state["wells"]][-3:]
            params[kind]["wells"] = [{"id": f"P{i + 1}", "perm_md": c.rock_of(truth, w["section"])["perm_md"],
                                      "thickness_ft": c.rock_of(truth, w["section"]).get("net_ft", c.rock_of(truth, w["section"])["thickness_ft"]),
                                      "half_length_ft": w["design"]["half_length_ft"]}
                                     for i, w in enumerate(ws)] or None
            if not params[kind]["wells"]:
                continue
        title = REGISTRY[kind].title if kind in REGISTRY else kind
        key = {"rig-contracts": "rig", "water": "completion", "facility": "facilities"}.get(kind)
        if key:
            state.setdefault("cost_factors", {}).setdefault(str(y), {}).setdefault(key, STAFF_COST_FACTOR)
        new_task(state, truth, kind, f"Year {y + 1}: {title}", {"year": y + 1}, False, year_end, params[kind], ctx)


# ---- price path (career truth) ----------------------------------------------------------------------
def price_at(state, truth, m):
    """The career's hidden WTI path: monthly, mean-reverting around the deck, seeded by the career."""
    path = truth.get("price_path")
    if path is None:
        r = random.Random(f"{state['seed']}|wti")
        mu = math.log(opecon.PRICE_DECK["oil_usd_bbl"])
        x, path = mu, []
        for _ in range(300):                       # log price mean-reverts (about 5 %/month) with about 30 %/yr volatility
            x += 0.05 * (mu - x) + 0.085 * r.gauss(0, 1)
            path.append(round(max(25.0, math.exp(x)), 2))
        truth["price_path"] = path
    return path[min(m, len(path) - 1)]


def hedge_settlement(state, m, wti):
    from minigames import hedging
    total = 0.0
    for book in state.get("hedge_books", []):
        k = m - book["start_month"]
        if 0 <= k < 24:
            total += hedging.settle(book["book"], k, wti)
    return total


# ---- applying results -------------------------------------------------------------------------------
def apply(state, truth, mg):
    """Called when a linked session finishes. Returns event strings for the inbox."""
    c = _career()
    link = mg.get("link") or {}
    task = next((t for t in state.get("tasks", []) if t["id"] == link.get("task")), None)
    if task is None or task["status"] != "open":
        return []
    kind, res = mg["kind"], mg.get("result") or {}
    pad = link.get("pad")
    pad_wells = [w for w in state["wells"] if w["pad"] == pad] if pad else []
    note = ""
    b = res.get("breakdown") or {}
    vs = None
    if kind == "pump-job" and "standard_design_npv10_usd" in b:
        vs = _versus("well NPV10 in the game", "usd", b["npv10_usd"], b["standard_design_npv10_usd"])
    if kind == "flowback" and b.get("reference_npv10_usd"):
        bhp = state["plan"]["design"]["bhp_psi"]
        flat = {k: v for k, v in b["reference_npv10_usd"].items() if "open day one" in k or "moderate" in k}
        ref = min(flat.items(), key=lambda kv: abs(float(kv[0].split("(")[1].split(" ")[0].replace(",", "")) - bhp))[1] if flat else None
        if ref is not None:
            vs = _versus("well operating NPV10", "usd", b["npv10_usd"], ref, note="staff flow back at the closest flat drawdown to the plan's BHP")
    if kind == "land-auction":
        vs = _versus("value created", "usd", b.get("value_created_usd", 0.0), 0.0, note="staff do not bid")
    if kind == "pump-job":
        g = mg.get("growth") or {}
        if g.get("runaway"):
            for w in pad_wells:
                w["design"] = dict(w["design"], half_length_ft=max(50.0, w["design"]["half_length_ft"] * 0.3))
            note = "The fracture ran out of zone: the pad's wells complete with short, poorly placed fractures."
        else:
            pk = g.get("propped") or {}
            xf = max(1.0, pk.get("half_length_ft", 1.0))
            cond = max(1e-3, (pk.get("conductivity_mdft") or [1e-3])[0])
            std = mg.get("standard_propped") or {"half_length_ft": xf, "conductivity_mdft": cond}
            # the plan's declared design is what the company's standard job delivers; your job scales it by how you did
            # against that standard job in the same rock (both through the same growth and proppant models)
            fx = max(0.3, min(3.0, xf / max(1.0, std["half_length_ft"])))
            fc = max(0.2, min(5.0, cond / max(1e-3, std["conductivity_mdft"])))
            for w in pad_wells:
                d0 = state["plan"]["design"]
                w["design"] = dict(w["design"], half_length_ft=round(d0["half_length_ft"] * fx, 1),
                                   conductivity_mdft=round(d0["conductivity_mdft"] * fc, 2))
            xf, cond = d0["half_length_ft"] * fx, d0["conductivity_mdft"] * fc
            extra = (mg.get("economics") or {}).get("stage_cost_usd", 0.0) - opecon.well_estimate(state["plan"]["design"])["completion_usd"] / max(1, pad_wells[0]["stages"] if pad_wells else 1)
            add_cost(state, pad_wells[0]["spud_day"] if pad_wells else state["month"] * opecon.MONTH_DAYS,
                     extra * sum(w["stages"] for w in pad_wells), f"pump job pad {pad}")
            note = f"Pad {pad} completes with {xf:.0f} ft propped at {cond:.1f} md-ft."
    elif kind == "flowback":
        sched = mg.get("schedule") or []
        if sched:
            for w in pad_wells:
                w["bhp_schedule"] = [float(x) for x in sched]
            note = f"Pad {pad} follows your {len(sched)}-month choke plan."
    elif kind == "well-control":
        b = res.get("breakdown") or {}
        lost, dead = b.get("lost"), b.get("well_dead")
        days = 1.5 if dead and not lost else (4.0 if not lost else 12.0)
        usd = days * opecon.COSTS["rig_spread_usd_day"] + (2_500_000.0 if lost else 0.0)
        vs = _versus("kick cost", "usd", usd, 4.0 * opecon.COSTS["rig_spread_usd_day"], higher_better=False)
        add_cost(state, state["month"] * opecon.MONTH_DAYS, usd, f"kick on {link.get('well')}")
        note = ("Well lost: redrill charged." if lost else "Kick killed.") + f" Cost ${usd / 1e6:.2f} MM."
    elif kind == "hedging":
        state.setdefault("hedge_books", []).append({"start_month": task["created_month"], "book": mg.get("book", [])})
        note = f"{len(mg.get('book', []))} hedge positions now settle against the oil price each month."
    elif kind in ("rig-contracts", "water"):
        # both games score 100 x hindsight cost / your cost, so your cost relative to a well-played market is 100 / score
        score = res.get("score")
        f = max(0.9, min(1.4, 100.0 / score)) if isinstance(score, (int, float)) and score > 0 else 1.4
        state.setdefault("cost_factors", {}).setdefault(str(task["link"]["year"] - 1), {})["rig" if kind == "rig-contracts" else "completion"] = f
        note = f"This year's {'rig' if kind == 'rig-contracts' else 'completion water'} costs run at {100 * f:.0f} % of standard."
        vs = _versus(f"{'rig' if kind == 'rig-contracts' else 'completion'} cost, % of a well-played market", "pct", 100 * f, 100 * STAFF_COST_FACTOR, higher_better=False)
    elif kind == "facility":
        # your battery design against the contractor's standard, on your own wells: it sets this year's facility cost
        rel = (res.get("breakdown") or {}).get("ratio", 1.0)
        f = max(0.85, min(1.4, 2.0 - rel))
        state.setdefault("cost_factors", {}).setdefault(str(task["link"]["year"] - 1), {})["facilities"] = f
        note = f"This year's facilities cost {100 * f:.0f} % of the contractor's standard."
        vs = _versus("facility cost, % of a well-designed battery", "pct", 100 * f, 100 * STAFF_COST_FACTOR, higher_better=False)
    elif kind == "land-auction":
        won = [t for t in (mg.get("tracts") or []) if t.get("winner") in ("You", "you", "player")]
        added = add_sections(state, truth, won, mg)
        add_cost(state, state["month"] * opecon.MONTH_DAYS, float(mg.get("paid_usd", 0.0)) + float(mg.get("appraisal_usd", 0.0)),
                 "lease bonus and appraisal")
        note = f"{len(added)} new section(s) join the field: {', '.join(added)}." if added else "No tracts won."
    elif kind == "diagnostics":
        sc = res.get("score", 0.0)
        d = max(-4.0, min(4.0, (sc - 60.0) / 10.0))
        state["board"]["confidence"] = max(0.0, min(100.0, state["board"]["confidence"] + d))
        note = f"The board read your diagnosis ({sc:.0f}/100): confidence {d:+.1f}."
        vs = _versus("board confidence", "points", d, 0.0)
    elif kind == "lift":
        b = res.get("breakdown") or {}
        inst = (res.get("lookback") or {}).get("installed") or {}
        refs = b.get("references_npv10_usd") or {}
        best = max(refs.values()) if refs else None
        ratio = base.relative(inst.get("npv10_usd", 0.0), best, 1e6) if best is not None else 1.0
        f = max(0.6, min(1.3, ratio))
        for w in pad_wells:
            w.setdefault("multipliers", []).append({"from_month": state["month"], "factor": f, "why": "lift plan"})
        note = f"Pad {pad} production from now: {100 * f:.0f} % of standard lift practice."
        vs = _versus("pad production, % of standard lift", "pct", 100 * f, 100.0)
    elif kind == "frac-hits":
        rows = ((res.get("lookback") or {}).get("parents")) or []
        parents = link.get("parents") or []           # the game's parents P1..P3 are the career's parents, in order
        hit = _apply_frac_hit_losses(state, truth, parents, [float(r.get("permanent_loss_share") or 0.0) for r in rows], "frac hit")
        note = ("Frac hits: " + ", ".join(hit) + ".") if hit else "No parent well lost production."
        if mg.get("truth"):
            std, _ = frac_hits_standard(mg)
            vs = _versus("child value less parent cost", "usd", b.get("total_value_usd", 0.0), std)
    if kind == "hedging":
        vs = {"metric": "hedge gains", "unit": "usd", "yours": None, "staff": 0.0, "delta": None, "better": None, "worse": None,
              "note": "staff do not hedge; your book settles monthly against the oil price (history.hedge_usd)"}
    task["status"] = "done"
    task["result_headline"] = res.get("headline")
    if vs:
        task["played_vs_staff"] = vs
    c.inbox(state, "task", f"{REGISTRY[kind].title} done", (res.get("headline") or "") + (" " + note if note else ""),
            {"task": task["id"], "kind": kind, "session": mg["id"], **(task.get("link") or {})})
    return [note]


STANDARD_OUTCOME = {
    "pump-job": "the completions team pumps the standard design (no change to the pad's wells)",
    "flowback": "production follows the standard flowback (no change)",
    "well-control": "the driller kills the kick with average performance: 4 days of non-productive time",
    "frac-hits": "standard practice: a standard-size job with every parent shut in beforehand, no pre-load; a hit still costs half its damage",
    "hedging": "staff do not hedge: revenue follows the oil price",
    "land-auction": "staff do not bid: the field stays as it is",
    "diagnostics": "no diagnosis goes to the board: confidence unchanged",
    "lift": "standard lift practice continues (no change)",
    "rig-contracts": "staff contract rigs with typical market timing: this year's rig costs run 15 % above a well-played market",
    "water": "staff source water with a typical plan: this year's completion costs run 15 % above a well-played plan",
    "facility": "the contractor builds standard batteries: this year's facility costs run 15 % above a well-designed one",
}


def delegate(state, task_id, truth=None):
    """Hand a task to the crew: the standard outcome applies and the minigame is skipped."""
    t = next((t for t in state.get("tasks", []) if t["id"] == task_id), None)
    if t is None or t["status"] != "open":
        raise ValueError("no such open task")
    if t["kind"] == "well-control":
        add_cost(state, state["month"] * opecon.MONTH_DAYS, 4.0 * opecon.COSTS["rig_spread_usd_day"], f"kick on {t['link'].get('well')}")
    t["status"] = "delegated"
    staff_outcome(state, t, truth)
    msg = STANDARD_OUTCOME.get(t["kind"], "the company follows standard practice")
    _career().inbox(state, "task", f"Delegated: {t['label']}", msg[0].upper() + msg[1:] + ".", {"task": t["id"], "kind": t["kind"]})
    return msg


def add_cost(state, day, usd, label):
    if usd:
        state.setdefault("costs_pending", []).append({"day": float(day), "usd": float(usd), "label": label})


def add_sections(state, truth, tracts, mg):
    """Won tracts become new open sections in a new row; their rock is drawn so better tracts are better rock."""
    c = _career()
    added = []
    rows = max(s["row"] for s in state["sections"]) + 1
    lb = (mg.get("result") or {}).get("lookback") or {}
    for i, t in enumerate(tracts):
        name = f"{chr(65 + rows)}{i + 1}"
        if any(s["section"] == name for s in state["sections"]):
            continue
        eur = (lb.get(t["id"]) or {}).get("true_eur_boe") or 400_000.0
        base_rock = truth["rock"][i % len(truth["rock"])]
        quality = max(0.4, min(2.0, eur / 450_000.0))
        truth["rock"].append(dict(base_rock, section=name, col=i, row=rows, perm_md=round(base_rock["perm_md"] * quality ** 2, 6)))
        state["sections"].append({"section": name, "col": i, "row": rows, "developed": False})
        added.append(name)
    return added
