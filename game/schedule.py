"""Drilling and completion schedule engine (deterministic, in days from career start, rolled to months).

Rules (after published development-planning practice): one rig per pad at a time; wells on a pad are batch
drilled with a per-rig learning curve; a rig moves to the next pad in the sequence after a move time; a frac crew
starts a pad only after all its wells are drilled; wells on a pad come online together after tie-in; before a pad
is released to a rig, its whole cost must fit the year's approved capital budget, otherwise it waits for the next
budget year. Every delay is reported with its reason.

The same engine runs on belief (planned durations and AFE costs) and on truth (durations and costs with the
career's hidden variance), so forecast and actual differ only through their inputs.
"""
import math

from opecon import COSTS, MONTH_DAYS

YEAR_DAYS = 12 * MONTH_DAYS


def year_of(day):
    return int(day // YEAR_DAYS)


def run(pads, rigs, crews, well_plan, budget=None, start_day=0.0, locked=None, costs=COSTS):
    """Schedule pads in order.

    pads: [{id, section, wells}] in sequence order.
    well_plan(pad, i) -> {drill_days, frac_days, drilling_usd, completion_usd, facilities_usd[, rig_spread_usd]} for well i.
    budget: {year_index: usd} approved capex per budget year; years missing from it are unconstrained but flagged.
        A pad is released only if its spend in every year it touches fits that year's remaining budget.
    locked: {pad_id: previously recorded pad result} for pads already started (kept exactly as recorded).
    Returns {pads, delays, capex_events: [(day, usd, category, pad_id)], committed_by_year, unbudgeted_years, unscheduled}.
    """
    locked = locked or {}
    rig_free = [start_day] * rigs
    rig_wells = [0] * rigs
    crew_free = [start_day] * crews
    committed = {}
    out, delays, events, unscheduled = [], [], [], []

    def commit(evs):
        for e in evs:
            y = year_of(e[0])
            committed[y] = committed.get(y, 0.0) + e[1]

    for pad in pads:                       # locked pads hold their rigs, crews and committed capital
        if pad["id"] in locked:
            p = locked[pad["id"]]
            if p["rig"] < rigs:
                rig_free[p["rig"]] = max(rig_free[p["rig"]], p["drill_end"])
                rig_wells[p["rig"]] += len(p["wells"])
            if p["crew"] < crews:
                crew_free[p["crew"]] = max(crew_free[p["crew"]], p["frac_end"])
            evs = [tuple(e) for e in p["capex_events"]]
            commit(evs)
            events.extend(evs)
            out.append(p)

    def lay_out(pad, plans, start, r, c):
        """Timeline and spend of a pad drilled from `start` by rig r, fracked by crew c (no state changes)."""
        t, wells, evs, nw = start, [], [], rig_wells[r]
        for i, w in enumerate(plans):
            f = max(costs["learning_floor"], (1.0 - costs["learning_per_well"]) ** nw)
            d = w["drill_days"] * f
            wells.append({"index": i, "spud": t, "td": t + d, "drill_days": d})
            evs.append((t, w["drilling_usd"] - w.get("rig_spread_usd", 0.0) * (1.0 - f), "drilling", pad["id"]))  # fewer rig days, less spread
            t += d
            nw += 1
        drill_end = t
        frac_start = max(drill_end, crew_free[c] + costs["crew_move_days"])
        t = frac_start
        for w, wp in zip(wells, plans):
            w["frac_start"] = t
            t += wp["frac_days"]
            w["frac_end"] = t
            evs.append((w["frac_start"], wp["completion_usd"], "completion", pad["id"]))
        frac_end = t
        online = frac_end + costs["tie_in_days"]
        for w, wp in zip(wells, plans):
            w["online"] = online
            evs.append((frac_end, wp["facilities_usd"], "facilities", pad["id"]))
        evs.append((start - costs["pad_build_days"], costs["pad_usd"], "pad", pad["id"]))
        return {"id": pad["id"], "section": pad["section"], "rig": r, "crew": c, "pad_build_start": start - costs["pad_build_days"],
                "drill_start": start, "drill_end": drill_end, "frac_start": frac_start, "frac_end": frac_end, "online": online,
                "wells": wells, "planned_cost_usd": sum(e[1] for e in evs), "budget_year": year_of(start),
                "capex_events": [list(e) for e in evs]}

    def breach(p):
        by = {}
        for e in p["capex_events"]:
            y = year_of(e[0])
            by[y] = by.get(y, 0.0) + e[1]
        for y in sorted(by):
            if budget is not None and y in budget and committed.get(y, 0.0) + by[y] > budget[y] + 1e-6:
                return y, by[y]
        return None

    for pad in pads:
        if pad["id"] in locked:
            continue
        plans = [well_plan(pad, i) for i in range(pad["wells"])]
        r = min(range(rigs), key=lambda k: rig_free[k])
        c = min(range(crews), key=lambda k: crew_free[k])
        start = max(rig_free[r] + (costs["rig_move_days"] if rig_wells[r] else 0.0), start_day + costs["pad_build_days"])
        start = max(start, pad.get("not_before_day", 0.0)) + pad.get("delay_days", 0.0)   # permits, weather, a late crew
        p = lay_out(pad, plans, start, r, c)
        for _ in range(12):
            b = breach(p)
            if b is None:
                break
            y, spend = b
            nxt = (year_of(start) + 1) * YEAR_DAYS          # wait for the next budget year and try again
            delays.append({"pad": pad["id"], "from_day": start, "to_day": nxt,
                           "reason": f"year {y + 1} budget: ${committed.get(y, 0.0) / 1e6:.1f} MM committed + ${spend / 1e6:.1f} MM "
                                     f"for pad {pad['id']} > ${budget[y] / 1e6:.1f} MM approved"})
            start = nxt
            p = lay_out(pad, plans, start, r, c)
        if breach(p) is not None:
            unscheduled.append(pad["id"])
            continue
        rig_free[r] = p["drill_end"]
        rig_wells[r] += len(p["wells"])
        crew_free[c] = p["frac_end"]
        evs = [tuple(e) for e in p["capex_events"]]
        commit(evs)
        events.extend(evs)
        out.append(p)
    unbudgeted = sorted({year_of(e[0]) for e in events if budget is not None and year_of(e[0]) not in budget})
    return {"pads": out, "delays": delays, "capex_events": events, "committed_by_year": committed, "unbudgeted_years": unbudgeted,
            "unscheduled": unscheduled}


def monthly_capex(events, months):
    cap = [0.0] * months
    by_cat = {}
    for day, usd, cat, _ in events:
        m = int(day // MONTH_DAYS)
        if 0 <= m < months:
            cap[m] += usd
            by_cat.setdefault(cat, [0.0] * months)[m] += usd
    return cap, by_cat


def place(curve, online_day, months):
    """Put a well's monthly volume curve (month 0 = first producing month) on the calendar, blending the partial first month."""
    out = [0.0] * months
    x = online_day / MONTH_DAYS
    m0 = int(math.floor(x))
    frac = 1.0 - (x - m0)               # share of the first calendar month the well produces
    for k in range(len(curve)):
        for m, share in ((m0 + k, frac), (m0 + k + 1, 1.0 - frac)):
            if 0 <= m < months:
                out[m] += curve[k] * share
    return out


def gantt(result, months):
    """The Gantt shape agreed with the front end."""
    m = lambda d: round(d / MONTH_DAYS, 3)
    lanes, bars, links, seen = [], [], [], set()
    for p in result["pads"]:
        for lid, kind, label in ((f"rig-{p['rig']}", "rig", f"Rig {p['rig'] + 1}"), (f"crew-{p['crew']}", "frac_crew", f"Frac crew {p['crew'] + 1}"),
                                 (f"pad-{p['id']}", "pad", f"Pad {p['id']}")):
            if lid not in seen:
                seen.add(lid)
                lanes.append({"id": lid, "kind": kind, "label": label})
        status = p.get("status", "planned")
        ids = [f"{p['id']}-{w['index'] + 1}" for w in p["wells"]]
        bars += [
            {"id": f"{p['id']}-build", "lane": f"pad-{p['id']}", "kind": "wait", "pad": p["id"], "start_month": m(p["pad_build_start"]),
             "end_month": m(p["drill_start"]), "label": "pad construction", "status": status},
            {"id": f"{p['id']}-drill", "lane": f"rig-{p['rig']}", "kind": "drill", "pad": p["id"], "wells": ids,
             "start_month": m(p["drill_start"]), "end_month": m(p["drill_end"]), "label": f"Drill {p['id']} ({len(ids)} wells)", "status": status},
            {"id": f"{p['id']}-frac", "lane": f"crew-{p['crew']}", "kind": "complete", "pad": p["id"], "wells": ids,
             "start_month": m(p["frac_start"]), "end_month": m(p["frac_end"]), "label": f"Frac {p['id']}", "status": status},
            {"id": f"{p['id']}-tie", "lane": f"pad-{p['id']}", "kind": "tie_in", "pad": p["id"], "wells": ids,
             "start_month": m(p["frac_end"]), "end_month": m(p["online"]), "label": "tie-in and flowback", "status": status},
        ]
        links += [{"from": f"{p['id']}-drill", "to": f"{p['id']}-frac", "type": "finish_start"},
                  {"from": f"{p['id']}-frac", "to": f"{p['id']}-tie", "type": "finish_start"}]
    for d in result["delays"]:
        bars.append({"id": f"{d['pad']}-wait-{int(d['from_day'])}", "lane": f"pad-{d['pad']}", "kind": "wait", "pad": d["pad"],
                     "start_month": m(d["from_day"]), "end_month": m(d["to_day"]), "label": d["reason"], "status": "delayed"})
    first = min((p["online"] for p in result["pads"]), default=None)
    milestones = [{"month": m(first), "label": "first oil from the development", "kind": "first_oil"}] if first is not None else []
    return {"start_month": 0, "months": months, "lanes": lanes, "bars": bars, "links": links, "milestones": milestones}
