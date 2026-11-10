"""Parent-child interference (#1): a child well drilled next to a producing parent drains rock the parent has already
depleted, and takes some of the parent's remaining oil.

Physics from ressim (f7's staged starts): parent and child laterals in one model, the child's fractures appearing at its
start month, the whole reservoir state (pressure, free gas, dissolved gas) carried across. Three runs on the fast
screening mesh, read only as ratios (its bias cancels): parent and child together, the parent alone, the child alone.
Child factor = child's oil with the parent / alone; parent factor = parent's oil after the child starts / without it,
both over 10 years. Limits (labelled): the child's fracture growth does not feel the parent's depletion (no asymmetric
growth, no frac hit here; frac hits are their own job); the rock is the child's section's; one repeating stage each.
"""
import json

import field
import opecon

MAX_DISTANCE_FT = 1500.0
LAST = {}
MONTHS = 120


def _key(spec):
    return field.TruthSim.key(spec)


def factors(worker, rock, design, distance_ft, delta_months):
    """(child_factor, parent_factor) for a child `delta_months` after its parent, laterals `distance_ft` apart."""
    delta = max(1, min(MONTHS - 1, int(round(delta_months))))
    d = float(distance_ft)
    base = field.spec_for(dict(rock, net_ft=rock.get("net_ft", rock["thickness_ft"]), sw=rock.get("sw", 0.12)), design, 1)
    base.pop("stages", None)
    base.pop("spacing_ft", None)
    sp = design["stage_spacing_ft"]
    common = dict(base, months=MONTHS + delta, mesh="screening", dt_max_days=30.0, edge_ft=sp / 2)
    two = dict(common, positions_ft=[sp / 2, sp / 2], center_ft=[d / 2, 1.5 * d], width_ft=2 * d,
               half_length_ft=[design["half_length_ft"]] * 2, conductivity_mdft=[design["conductivity_mdft"]] * 2)
    key = _key({"interference": two, "delta": delta})
    f = field.CACHE / f"i{key}.json"
    if f.exists():
        r = json.loads(f.read_text())
        LAST.update(r)
        return r["child"], r["parent"]
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        both = worker.call("staged", dict(two, start_month=[0, delta]), t)["oil"]
        parent_alone = worker.call("staged", dict(two, positions_ft=[sp / 2], center_ft=[d / 2], half_length_ft=[design["half_length_ft"]],
                                                  conductivity_mdft=[design["conductivity_mdft"]], start_month=[0]), t)["oil"][0]
        together = worker.call("staged", dict(two, months=MONTHS, start_month=[0, 0]), t)["oil"]
        child_alone = worker.call("staged", dict(common, positions_ft=[sp / 2], center_ft=[d / 2], width_ft=d, months=MONTHS,
                                                 half_length_ft=[design["half_length_ft"]], conductivity_mdft=[design["conductivity_mdft"]],
                                                 start_month=[0]), t)["oil"][0]
    child_with = sum(both[1][delta:delta + MONTHS])
    child = child_with / max(1.0, sum(child_alone[:MONTHS]))
    parent = sum(both[0][delta:delta + MONTHS]) / max(1.0, sum(parent_alone[delta:delta + MONTHS]))
    child, parent = max(0.3, min(1.0, child)), max(0.5, min(1.0, parent))
    # against the pair drilled together (the delay's own cost): what late infill costs beyond sharing the acreage
    child_codev = child_with / max(1.0, sum(together[1][:MONTHS]))
    rec = {"child": child, "parent": parent, "child_vs_codeveloped": child_codev, "distance_ft": d, "delta_months": delta}
    LAST.update(rec)
    f.write_text(json.dumps(rec))
    return child, parent


def apply_on_lock(state, truth, truth_sim, pad):
    """For the new pad's edge wells: find a producing parent across the section line within MAX_DISTANCE_FT and apply
    the simulated factors to both (truth). Returns inbox-ready notes."""
    worker = getattr(truth_sim, "worker", None)
    if worker is None:
        return []
    import career
    import geodesk
    pos = {s["section"]: (s["col"], s["row"]) for s in state["sections"]}
    rows = {h["id"]: h for h in geodesk.horizontal_rows(state, truth)}
    kids = [w for w in state["wells"] if w["pad"] == pad["id"]]
    if not kids or pad["section"] not in pos:
        return []
    c0, r0 = pos[pad["section"]]
    n = len(kids)
    notes = []
    for side, idx in ((-1, 0), (1, n - 1)):
        kid = next((w for w in kids if w["id"].endswith(f"-{idx + 1:02d}")), None)
        if kid is None:
            continue
        g = geodesk.slot((c0, r0), idx, n, kid["lateral_ft"])
        cand = []
        for h in rows.values():
            if h["id"] == kid["id"] or pos.get(h["section"]) != (c0 + side, r0):
                continue
            online = next((a["online_month"] for a in truth["analogs"] if a["id"] == h["id"]), None)
            if online is None:
                w = next((w for w in state["wells"] if w["id"] == h["id"]), None)
                online = w["online_day"] / opecon.MONTH_DAYS if w else None
            if online is None or online >= kid["online_day"] / opecon.MONTH_DAYS:
                continue
            cand.append((abs(h["x_ft"] - g["x_ft"]), h["id"], online))
        if not cand:
            continue
        dist, pid, online = min(cand)
        if dist > MAX_DISTANCE_FT:
            continue
        delta = kid["online_day"] / opecon.MONTH_DAYS - online
        cf, pf = factors(worker, career.rock_of(truth, kid["section"]), kid["design"], dist, delta)
        kid.setdefault("multipliers", []).append({"from_month": 0, "factor": round(cf, 4), "why": f"parent-child: next to {pid}"})
        m = {"from_month": int(kid["online_day"] / opecon.MONTH_DAYS), "factor": round(pf, 4), "why": f"parent-child: {kid['id']} next door"}
        for coll in (state["wells"], truth["analogs"]):
            for x in coll:
                if x["id"] == pid:
                    x.setdefault("multipliers", []).append(m)
        notes.append(f"{kid['id']} is {dist:,.0f} ft from producing {pid} ({delta:.0f} months older): the simulator puts the child at "
                     f"{100 * cf:.0f} % of a standalone well (a twin drilled with the parent would match a standalone well, so this is the "
                     f"cost of drilling it late)" + f", and the parent at {100 * pf:.0f} % of its own outlook from here "
                     f"(mostly acreage it no longer drains alone). No frac hit or damage is in these numbers.")
    return notes
