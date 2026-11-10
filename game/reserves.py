"""Reserves booking (SEC-style, simplified): what the company books at each year end, the roll-forward, and the
third-party audit the board reads.

- Price: the trailing 12-month average of the realised oil price (the deck's gas price), flat, for the economic limit.
- PDP (proved developed producing): each producing well's own Arps fit on its history (booking standard: b capped at
  1.0, 10 %/yr terminal decline), from its current age to the economic limit (monthly net cash below zero) or the end
  of the well's 20-year life.
- PDNP (developed, not yet producing): drilled wells not online yet, on their pad's forecast curve.
- PUD (proved undeveloped): pads in the current plan that have not started and are scheduled to start within 5 years
  of the booking, on their type curve at P90 (reasonable certainty) with the plan's geology factor. A PUD carried
  more than 5 years from its first booking is removed (the 5-year rule).
- Audit: an independent engineer re-estimates the developed reserves (PDP + PDNP) from the wells' true remaining
  production at the same price. Booking more than 15 % above the auditor is a write-down.
All volumes are gross oil (bbl), working interest share not applied, as everywhere in the career.
"""
import math

import career
import field
import opecon
import schedule
import typecurve

LIFE_MONTHS = 240
PUD_YEARS = 5
AUDIT_TOLERANCE = 0.15
BOOK_B_MAX = 1.0                 # reserves practice: hyperbolic exponent capped, terminal decline 10 %/yr
BOOK_DMIN = 0.10


def sec_price(state):
    w = [x for x in (state["history"].get("wti_usd_bbl") or [])[-12:] if x is not None]
    return sum(w) / len(w) if w else opecon.PRICE_DECK["oil_usd_bbl"]


def _economic(vols, gor, price):
    deck = dict(opecon.PRICE_DECK, oil_usd_bbl=price)
    tot = 0.0
    for q in vols:
        if q <= 0 or opecon.net_cash(q, q * gor, 0.0, 1, deck=deck)["net_usd"] <= 0:
            break
        tot += q
    return tot


def book(state, truth, truth_sim):
    """The company's booking now. Returns {price, pdp, pdnp, pud, proved, wells: {id: bbl}, puds: {pad: bbl}}."""
    price = sec_price(state)
    now = state["month"]
    al = career.analog_list(state, truth, truth_sim)
    gor = 1.0
    if state.get("plan"):
        gor = state["typecurves"][state["plan"]["typecurve"]]["gor_mcf_bbl"] or 1.0
    wells = {}
    for a in al:
        if a["history_months"] < 3:
            continue
        hist = typecurve.align_peak(a["oil"])
        f = typecurve.fit(hist, dmin=BOOK_DMIN, b_max=BOOK_B_MAX)   # booking standard: capped b, 10 % terminal decline
        if not f:
            continue
        age = len(hist)
        life = max(0, field.HORIZON - a["history_months"])        # the same well life the auditor's curves have
        rem = [typecurve.arps_rate(age + k + 0.5, f["qi"], f["di"], f["b"], f["dmin"]) for k in range(min(LIFE_MONTHS, life))]
        wells[a["id"]] = _economic(rem, gor, price)
    pdnp = 0.0
    producing = {a["id"] for a in al}
    for w in state["wells"]:
        if w["id"] in producing:
            continue
        p = state["locked"].get(w["pad"]) or {}
        if p.get("belief_well_oil"):
            pdnp += _economic(p["belief_well_oil"], gor, price)
    puds = {}
    first = state.setdefault("pud_first_booked", {})
    if state.get("plan"):
        ev = career.evaluate_plan(state, truth, truth_sim, state["plan"])
        starts = {p["id"]: p["drill_start"] for p in ev["_schedule"]["pads"]}
        for pp in state["plan"]["pads"]:
            if pp["id"] in state["locked"] or pp["id"] not in starts:
                continue
            if starts[pp["id"]] > (now + 12 * PUD_YEARS) * opecon.MONTH_DAYS:
                continue
            y0 = first.setdefault(pp["id"], now)
            if now - y0 > 12 * PUD_YEARS:
                continue                                    # 5-year rule: no longer bookable
            t = state["typecurves"][pp.get("typecurve", state["plan"]["typecurve"])]
            fit = t["fits"].get("p90") or t["fits"]["p50"]
            g = career.geo_factor(state, t, pp["section"])
            curve = [v * opecon.LATERAL_FT / (t["per_ft"] or 1000.0) * g for v in typecurve.curve(fit)]
            puds[pp["id"]] = pp["wells"] * _economic(curve, t["gor_mcf_bbl"] or gor, price)
    pdp = sum(wells.values())
    pud = sum(puds.values())
    return {"month": now, "price_usd_bbl": round(price, 2), "pdp_bbl": round(pdp), "pdnp_bbl": round(pdnp), "pud_bbl": round(pud),
            "proved_bbl": round(pdp + pdnp + pud), "wells": {k: round(v) for k, v in wells.items()}, "puds": {k: round(v) for k, v in puds.items()}}


def audit(state, truth, truth_sim, price):
    """The independent engineer's developed reserves: each well's true remaining production to the economic limit."""
    now = state["month"]
    gor = 1.0
    if state.get("plan"):
        gor = state["typecurves"][state["plan"]["typecurve"]]["gor_mcf_bbl"] or 1.0
    tot = 0.0
    for a in truth["analogs"]:
        c = career.analog_truth_curve(truth, a, truth_sim)["oil"]
        k = now - a["online_month"]
        if k >= 0:
            tot += _economic(c[k:k + LIFE_MONTHS], gor, price)
    for w in state["wells"]:
        c = career.player_well_truth_curve(truth, w, truth_sim)["oil"]
        k = max(0, now - int(round(w["online_day"] / opecon.MONTH_DAYS)))
        tot += _economic(c[k:k + LIFE_MONTHS], gor, price)
    return tot


def roll_forward(prev, cur, produced_bbl, converted_pads):
    """Opening to closing: production, PUD conversions, extensions (new PUDs), PUD removals, revisions (the rest)."""
    conv = sum(prev["puds"].get(p, 0) for p in converted_pads)
    ext = sum(v for k, v in cur["puds"].items() if k not in prev["puds"])
    removed = sum(v for k, v in prev["puds"].items() if k not in cur["puds"] and k not in converted_pads)
    revisions = cur["proved_bbl"] - prev["proved_bbl"] + produced_bbl - ext + removed
    return {"opening_bbl": prev["proved_bbl"], "production_bbl": -round(produced_bbl), "extensions_bbl": round(ext),
            "pud_conversions_bbl": round(conv), "pud_removals_bbl": -round(removed), "revisions_bbl": round(revisions),
            "closing_bbl": cur["proved_bbl"]}


def year_end(state, truth, truth_sim, y):
    """Book, roll forward from the previous booking, audit; returns the board parts and the record."""
    cur = book(state, truth, truth_sim)
    books = state.setdefault("reserves", {"books": [], "note": __doc__.split("\n\n")[0]})
    prev = books["books"][-1] if books["books"] else None
    h = state["history"]
    produced = sum(h["oil"][i] for i, m in enumerate(h["month"]) if 12 * y <= m < 12 * (y + 1))
    aud = audit(state, truth, truth_sim, cur["price_usd_bbl"])
    developed = cur["pdp_bbl"] + cur["pdnp_bbl"]
    over = developed / aud - 1.0 if aud > 0 else 0.0
    parts = {}
    rec = dict(cur, year=y + 1, audit_developed_bbl=round(aud), audit_over_pct=round(100 * over, 1))
    if prev:
        conv = [p for p in prev["puds"] if p in state["locked"]]
        rf = roll_forward(prev, cur, produced, conv)
        rec["roll_forward"] = rf
        adds = rf["extensions_bbl"] + max(0, rf["revisions_bbl"])
        rrr = (rf["extensions_bbl"] + rf["revisions_bbl"]) / produced if produced > 0 else 1.0
        rec["reserve_replacement"] = round(rrr, 3)
        neg = max(0.0, -rf["revisions_bbl"]) / max(1.0, prev["proved_bbl"])
        parts["reserve_replacement"] = max(-3.0, min(3.0, 3.0 * (rrr - 1.0)))
        parts["reserve_revisions"] = -min(8.0, 40.0 * max(0.0, neg - 0.05))
        _ = adds
    parts["reserves_audit"] = -min(15.0, 50.0 * max(0.0, over - AUDIT_TOLERANCE))
    rec["parts"] = parts
    books["books"].append(rec)
    return parts, rec


def opening(state, truth, truth_sim):
    """The first booking, at the first budget meeting (no roll-forward, no score)."""
    books = state.setdefault("reserves", {"books": [], "note": __doc__.split("\n\n")[0]})
    if books["books"]:
        return books["books"][-1]
    rec = dict(book(state, truth, truth_sim), year=0)
    books["books"].append(rec)
    return rec


def view(state):
    r = state.get("reserves")
    if not r or not r["books"]:
        return None
    last = r["books"][-1]
    return {"latest": {k: v for k, v in last.items() if k not in ("wells",)}, "history": [{k: b.get(k) for k in (
        "year", "month", "price_usd_bbl", "pdp_bbl", "pdnp_bbl", "pud_bbl", "proved_bbl", "reserve_replacement",
        "audit_developed_bbl", "audit_over_pct", "roll_forward", "parts")} for b in r["books"]],
            "notes": [__doc__.split("\n\n")[1].replace("\n", " ")]}


_ = (math, field, schedule)
