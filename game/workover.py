"""Workovers (#12): a decision card for a producing well, and share codes (#15) for a career's starting field.

Workovers are a GAME RULE on top of the simulated well (labelled in notes): the uplift is a hidden draw per well and
kind, applied as a production multiplier that fades out. The card's economics are your expectation: the well's own
decline fit (booking standard), the kind's expected uplift, today's price.
"""
import base64
import json
import math

import career
import field
import opecon
import reserves
import typecurve

KINDS = {
    "refrac": {"label": "Refrac (re-stimulate the lateral)", "cost_usd": 2_400_000.0, "uplift_mean": 0.60, "uplift_sd": 0.30,
               "fade_months": 36, "min_age_months": 18,
               "note": "new fractures and re-opened old ones; results vary widely from well to well"},
    "cleanout": {"label": "Cleanout (coiled tubing: sand and scale)", "cost_usd": 150_000.0, "uplift_mean": 0.08, "uplift_sd": 0.05,
                 "fade_months": 18, "min_age_months": 6, "note": "restores flow lost to fill and scale near the wellbore"},
}
NOTES = ["Workover uplift is a game rule, not simulated: a hidden draw per well (mean and spread shown), applied as a "
         "multiplier on the well's simulated production that fades to nothing over the stated months.",
         "The card's economics use your expectation: the well's own decline (booking standard), the mean uplift and "
         "today's price. A well can only be worked over once per kind."]


def multiplier(mm, m):
    """A production multiplier at calendar month m: constant from from_month, or fading over fade_months."""
    if m < mm["from_month"]:
        return 1.0
    fade = mm.get("fade_months")
    if not fade:
        return mm["factor"]
    left = max(0.0, 1.0 - (m - mm["from_month"]) / fade)
    return 1.0 + (mm["factor"] - 1.0) * left


def _draw(state, wid, kind):
    k = KINDS[kind]
    r = field.rng_for(state["seed"], "workover", wid, kind)
    return max(0.0, r.gauss(k["uplift_mean"], k["uplift_sd"]))


def candidates(state, truth, truth_sim):
    """Your producing wells with the options open to each and their expected incremental economics."""
    price = reserves.sec_price(state)
    deck = dict(opecon.PRICE_DECK, oil_usd_bbl=price)
    al = {a["id"]: a for a in career.analog_list(state, truth, truth_sim) if a["owner"] == "you"}
    gor = 1.0
    if state.get("plan"):
        gor = state["typecurves"][state["plan"]["typecurve"]]["gor_mcf_bbl"] or 1.0
    out = []
    for w in state["wells"]:
        a = al.get(w["id"])
        if not a or a["history_months"] < 3:
            continue
        f = typecurve.fit(typecurve.align_peak(a["oil"]), dmin=reserves.BOOK_DMIN, b_max=reserves.BOOK_B_MAX)
        if not f:
            continue
        age = len(typecurve.align_peak(a["oil"]))
        base = [typecurve.arps_rate(age + k + 0.5, f["qi"], f["di"], f["b"], f["dmin"]) for k in range(60)]
        done = {mm.get("why") for mm in w.get("multipliers", [])}
        opts = []
        for kind, k in KINDS.items():
            if a["history_months"] < k["min_age_months"] or f"workover: {kind}" in done:
                continue
            mm = {"from_month": 0, "factor": 1.0 + k["uplift_mean"], "fade_months": k["fade_months"]}
            inc = [b * (multiplier(mm, i) - 1.0) for i, b in enumerate(base)]
            cash = [opecon.net_cash(q, q * gor, 0.0, 0, deck=deck)["net_usd"] for q in inc]
            npv = sum(c * opecon.disc_factor(i + 1, opecon.TERMS["discount_rate"]) for i, c in enumerate(cash)) - k["cost_usd"]
            opts.append({"kind": kind, "label": k["label"], "cost_usd": k["cost_usd"], "uplift_mean": k["uplift_mean"],
                         "uplift_sd": k["uplift_sd"], "fade_months": k["fade_months"], "incremental_oil_bbl": round(sum(inc)),
                         "expected_npv10_usd": round(npv), "note": k["note"]})
        out.append({"well": w["id"], "pad": w["pad"], "history_months": a["history_months"],
                    "current_rate_bbl_month": round(a["oil"][-1]) if a["oil"] else 0, "options": opts})
    return {"price_usd_bbl": round(price, 2), "wells": out, "notes": NOTES}


def perform(state, wid, kind):
    if kind not in KINDS:
        raise career.CareerError(f"kind must be one of {list(KINDS)}")
    w = next((w for w in state["wells"] if w["id"] == wid), None)
    if w is None:
        raise career.CareerError("unknown well")
    if any(mm.get("why") == f"workover: {kind}" for mm in w.get("multipliers", [])):
        raise career.CareerError(f"{wid} already had a {kind}")
    produced = state["month"] - w["online_day"] / opecon.MONTH_DAYS
    if produced < KINDS[kind]["min_age_months"]:
        raise career.CareerError(f"{wid} must produce {KINDS[kind]['min_age_months']} months first")
    k = KINDS[kind]
    u = _draw(state, wid, kind)
    w.setdefault("multipliers", []).append({"from_month": state["month"], "factor": 1.0 + u, "fade_months": k["fade_months"],
                                            "why": f"workover: {kind}"})
    from career_tasks import add_cost
    add_cost(state, state["month"] * opecon.MONTH_DAYS, k["cost_usd"], f"{kind} on {wid}")
    career.inbox(state, "operations", f"{k['label'].split(' (')[0]} on {wid}",
                 f"Cost ${k['cost_usd'] / 1e6:.2f} MM. The result shows in its production from next month.", {"well": wid, "kind": kind})
    return {"well": wid, "kind": kind, "cost_usd": k["cost_usd"]}


# ---- share codes (#15) -------------------------------------------------------------------------------------------------
def share_code(state):
    """A code that recreates this career's starting field (seed); nothing about your decisions is in it."""
    raw = json.dumps({"v": 1, "seed": state["seed"]}).encode()
    return "RS1-" + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def seed_from_code(code):
    try:
        assert isinstance(code, str) and code.startswith("RS1-")
        b = code[4:] + "=" * (-len(code[4:]) % 4)
        d = json.loads(base64.urlsafe_b64decode(b.encode()))
        return int(d["seed"])
    except Exception:  # noqa: BLE001
        raise career.CareerError("not a valid share code")


_ = math
