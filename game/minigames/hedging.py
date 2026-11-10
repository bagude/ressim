"""Hedging: run a producer's hedge book for 24 months.

The player sees a declining production forecast and the WTI spot price as it happens. At the start of each quarter they
can sell swaps, buy put floors or put on costless-ish collars (buy a put, sell a call) over the next 1-4 quarters, then
produce the quarter. Hidden truth: the monthly WTI path (seeded GBM with jumps, ~35 %/yr vol) and a production surprise.

Scoring rewards certainty, not P&L: no covenant breach, lower cash-flow volatility than unhedged, and not giving away
much of the unhedged cash. Volatility is the standard deviation of monthly cash minus plan (plan = forecast volume at
the deck price), so the production decline itself does not count as volatility.
"""
import math

import opecon
from . import base

MONTHS = 24
QUARTERS = MONTHS // 3
WELLS = 6
Q0_BBL_MONTH = 30_000.0           # first-month forecast for the well group
DECLINE_MONTH = 0.03              # exponential decline per month (known forecast)
VOL_YEAR = 0.35                   # true annual volatility of WTI
JUMP_PROB = 0.06                  # chance of a price jump in any month
JUMP_SD = 0.15                    # log size of a jump
PRICE_FLOOR = 15.0                # WTI never prints below this (illustrative)
SURPRISE = 0.10                   # hidden production surprise, +/- this fraction
HEDGE_CAP = 0.80                  # hedged (swap + put) volume may not exceed this share of the net forecast in any month
SWAP_SPREAD = 0.50                # USD/bbl the dealer keeps below flat-at-spot forward
OPT_MARKUP = 0.10                 # option premium markup (bought) / markdown (sold)
OPT_FEE = 0.25                    # USD/bbl fixed option spread
COVENANT_SHARE = 0.30             # quarterly cash floor = this share of the plan's quarterly cash
NOTES = [
    "Illustrative prices: a seeded random WTI path, not a forecast or market data.",
    "No basis risk: hedges settle on the same WTI the barrels are sold against (a fixed differential applies to both).",
    "No counterparty credit risk, margin calls or collateral.",
    "Simplified option pricing: Black-76 on a flat forward equal to spot, the true volatility, zero rates, plus a dealer "
    "markup. Premiums are deferred and paid in each settlement month.",
    "Hedge volumes and the 80 % cap are in net revenue barrels (after the 20 % royalty). Swaps and sold calls settle "
    "on the hedged volume whatever the wells actually produce: hedging more than you produce is a real loss when "
    "price rises.",
]


# ---------- pricing helpers -------------------------------------------------------------------------------------------

def _ncdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black76(fwd, strike, t_years, vol, put=True):
    """Undiscounted Black-76 option value per bbl."""
    if t_years <= 0 or vol <= 0:
        return max(strike - fwd, 0.0) if put else max(fwd - strike, 0.0)
    sd = vol * math.sqrt(t_years)
    d1 = (math.log(fwd / strike) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    if put:
        return strike * _ncdf(-d2) - fwd * _ncdf(-d1)
    return fwd * _ncdf(d1) - strike * _ncdf(d2)


def premium(fwd, strike, t_years, put=True, bought=True):
    """Dealer price per bbl: fair value with markup when the player buys, markdown when the player sells."""
    fair = black76(fwd, strike, t_years, VOL_YEAR, put)
    return fair * (1.0 + OPT_MARKUP) + OPT_FEE if bought else max(0.0, fair * (1.0 - OPT_MARKUP) - OPT_FEE)


NRI = opecon.TERMS["working_interest"] * (1.0 - opecon.TERMS["royalty"])


def forecast(m):
    """Gross (8/8ths) forecast oil for month m."""
    return Q0_BBL_MONTH * math.exp(-DECLINE_MONTH * m)


def net_forecast(m):
    """Net revenue barrels: the producer's own share, which is what it hedges (royalty barrels are not its to sell)."""
    return forecast(m) * NRI


def month_cash(oil_bbl, wti):
    """Operating cash for one month at a WTI price (opecon terms, oil only)."""
    deck = dict(opecon.PRICE_DECK, oil_usd_bbl=wti)
    return opecon.net_cash(oil_bbl, 0.0, 0.0, WELLS, deck)["net_usd"]


def settle(book, m, wti):
    """Hedge settlement for month m at a WTI price: swaps, puts (less premium), sold calls (plus premium)."""
    total = 0.0
    for h in book:
        v = h["bbl"][m - h["first_month"]] if h["first_month"] <= m < h["first_month"] + len(h["bbl"]) else 0.0
        if not v:
            continue
        if h["type"] == "swap":
            total += (h["price"] - wti) * v
        else:
            total += (max(h["put_strike"] - wti, 0.0) - h["put_premium"]) * v
            if h["type"] == "collar":
                total += (h["call_premium"] - max(wti - h["call_strike"], 0.0)) * v
    return total


def _sd(xs):
    if len(xs) < 2:
        return 0.0
    mu = sum(xs) / len(xs)
    return math.sqrt(sum((x - mu) ** 2 for x in xs) / (len(xs) - 1))


# ---------- the game --------------------------------------------------------------------------------------------------

class Hedging(base.Game):
    kind = "hedging"
    title = "Hedge Book"
    blurb = "Run a producer's hedge book for two years: swaps, floors and collars against a bank covenant."
    sim = False

    def new(self, state, params, ctx):
        r = base.rng(state, "price")
        s0 = opecon.PRICE_DECK["oil_usd_bbl"]
        dt = 1.0 / 12.0
        sig = VOL_YEAR * math.sqrt(dt)
        path, p = [], s0
        for _ in range(MONTHS):      # price realised in each production month
            jump = r.gauss(0.0, JUMP_SD) if r.random() < JUMP_PROB else 0.0
            p = max(PRICE_FLOOR, p * math.exp(-0.5 * sig * sig + sig * r.gauss(0.0, 1.0) + jump))
            path.append(round(p, 2))
        rp = base.rng(state, "production")
        surprise = rp.uniform(-SURPRISE, SURPRISE)
        # the surprise phases in over the first half-year (the forecast was right at first), plus small monthly noise
        actual = [forecast(m) * (1.0 + surprise * min(1.0, (m + 1) / 6.0)) * (1.0 + rp.gauss(0.0, 0.02))
                  for m in range(MONTHS)]
        plan = [month_cash(forecast(m), s0) for m in range(MONTHS)]
        state["truth"] = {"price": path, "surprise": surprise, "actual_bbl": actual}
        if params.get("career"):
            # career mode: hedge the career's own forecast at today's career price; no playing forward (no price is revealed).
            # The career settles the book month by month against its hidden price path.
            state["career_mode"] = True
            state["forecast_net"] = [float(x) for x in params["forecast_net_bbl"]][:MONTHS]
            state["forecast_gross"] = [x / NRI for x in state["forecast_net"]]
            s0 = float(params["spot"])
        state["spot"] = s0                       # last realised WTI (deck price before month 1)
        state["quarter"] = 0                     # next quarter to produce
        state["book"] = []
        state["covenant_floor_usd"] = [COVENANT_SHARE * sum(plan[3 * q:3 * q + 3]) for q in range(QUARTERS)]
        state["months"] = []                     # realised months: price, volume, cash

    # ----- hedge coverage

    def _covered(self, state, m, kinds=("swap", "put", "collar")):
        return sum((h["bbl"][m - h["first_month"]] for h in state["book"]
                    if h["type"] in kinds and h["first_month"] <= m < h["first_month"] + len(h["bbl"])), 0.0)

    def _nf(self, state, m):
        fc = state.get("forecast_net")
        return (fc[m] if m < len(fc) else 0.0) if fc is not None else net_forecast(m)

    def _gf(self, state, m):
        fc = state.get("forecast_gross")
        return (fc[m] if m < len(fc) else 0.0) if fc is not None else forecast(m)

    def _headroom(self, state, m):
        return max(0.0, HEDGE_CAP * self._nf(state, m) - self._covered(state, m))

    def _window(self, state, quarters):
        first = 3 * state["quarter"]
        return list(range(first, min(MONTHS, first + 3 * quarters)))

    def _quotes(self, state):
        spot = state["spot"]
        months = self._window(state, 4)
        ts = [(m - months[0] + 0.5) / 12.0 for m in months] if months else [0.0]
        avg = lambda k, put, bought: sum(premium(spot, k, t, put, bought) for t in ts) / len(ts)
        return {
            "swap_price_usd_bbl": round(spot - SWAP_SPREAD, 2),
            "put_premium_usd_bbl": [{"strike": round(spot * f, 2), "premium": round(avg(spot * f, True, True), 2)}
                                    for f in (0.7, 0.8, 0.9, 1.0)],
            "call_premium_usd_bbl": [{"strike": round(spot * f, 2), "premium": round(avg(spot * f, False, False), 2)}
                                     for f in (1.1, 1.2, 1.3, 1.5)],
            "note": "Premiums are averages over a 4-quarter strip, deferred and paid monthly; the exact charge depends on "
                    "the tenor you pick.",
        }

    # ----- actions

    def act(self, state, action, args, ctx):
        if action == "advance":
            return self._advance(state)
        if action == "commit":
            state["status"] = "finished"
            hedged = sum(sum(h["bbl"]) for h in state["book"])
            state["result"] = {"score": hedged, "stars": None, "headline": f"Hedge book committed: {hedged:,.0f} bbl hedged",
                               "breakdown": {"book": state["book"], "spot_usd_bbl": state["spot"]},
                               "lookback": {"note": "settled month by month in your career as prices are realised"}}
            return [f"Hedge book committed to the career: {len(state['book'])} positions, {hedged:,.0f} bbl."]
        spot = state["spot"]
        share = base.num(args, "share_pct", 5, 80) / 100.0
        quarters = int(base.num(args, "quarters", 1, 4, default=4))
        months = self._window(state, quarters)
        if not months:
            raise base.GameError("no months left to hedge")
        h = {"type": action, "quarter": state["quarter"], "first_month": months[0], "bbl": []}
        clipped = 0.0
        for m in months:
            want = share * self._nf(state, m)
            got = min(want, self._headroom(state, m))
            clipped += want - got
            h["bbl"].append(got)
        if sum(h["bbl"]) <= 0:
            raise base.GameError(f"the hedge ratio cap ({HEDGE_CAP:.0%} of forecast) is already full for these months")
        ts = [(m - months[0] + 0.5) / 12.0 for m in months]
        if action == "swap":
            h["price"] = round(spot - SWAP_SPREAD, 2)
            desc = f"sold swaps at ${h['price']:.2f}"
        else:
            k = base.num(args, "put_strike", round(0.5 * spot, 2), round(spot, 2))
            h["put_strike"] = k
            h["put_premium"] = round(sum(premium(spot, k, t, True, True) for t in ts) / len(ts), 2)
            desc = f"bought ${k:.2f} puts for ${h['put_premium']:.2f}/bbl"
            if action == "collar":
                c = base.num(args, "call_strike", round(spot, 2), round(2.0 * spot, 2))
                h["call_strike"] = c
                h["call_premium"] = round(sum(premium(spot, c, t, False, False) for t in ts) / len(ts), 2)
                desc += f" and sold ${c:.2f} calls for ${h['call_premium']:.2f}/bbl"
        state["book"].append(h)
        ev = [f"Q{state['quarter'] + 1}: {desc} on {sum(h['bbl']):,.0f} bbl over months {months[0] + 1}-{months[-1] + 1}."]
        if clipped > 1.0:
            ev.append(f"{clipped:,.0f} bbl were not hedged: the {HEDGE_CAP:.0%} hedge ratio cap was reached.")
        return ev

    def _advance(self, state):
        """Produce one quarter: realise prices and volumes, settle hedges, test the covenant."""
        t = state["truth"]
        q = state["quarter"]
        ev = []
        q_cash = 0.0
        for m in range(3 * q, 3 * q + 3):
            wti, vol = t["price"][m], t["actual_bbl"][m]
            phys = month_cash(vol, wti)
            hedge = settle(state["book"], m, wti)
            over = max(0.0, self._covered(state, m, ("swap", "collar")) - vol * NRI)   # short more than you own
            state["months"].append({"month": m + 1, "wti": wti, "oil_bbl": round(vol, 1), "physical_usd": round(phys, 2),
                                    "hedge_usd": round(hedge, 2), "cash_usd": round(phys + hedge, 2),
                                    "over_hedged_bbl": round(over, 1)})
            q_cash += phys + hedge
            if over > 1.0:
                ev.append(f"Month {m + 1}: {over:,.0f} bbl hedged above actual net production.")
        state["spot"] = t["price"][3 * q + 2]
        state["quarter"] = q + 1
        floor = state["covenant_floor_usd"][q]
        ev.insert(0, f"Q{q + 1} produced: cash ${q_cash / 1e6:,.2f}M (covenant floor ${floor / 1e6:,.2f}M), "
                     f"WTI now ${state['spot']:.2f}.")
        if q_cash < floor:
            ev.append(f"Covenant breached in Q{q + 1}: the bank calls the loan. Game over.")
            self._finish(state, breach_quarter=q + 1)
        elif state["quarter"] >= QUARTERS:
            self._finish(state, breach_quarter=None)
            ev.append(state["result"]["headline"])
        return ev

    def _finish(self, state, breach_quarter):
        t = state["truth"]
        s0 = opecon.PRICE_DECK["oil_usd_bbl"]
        n = len(state["months"])
        plan = [month_cash(forecast(m), s0) for m in range(n)]
        hedged = [r["cash_usd"] for r in state["months"]]
        unhedged = [r["physical_usd"] for r in state["months"]]
        sd_h = _sd([c - p for c, p in zip(hedged, plan)])
        sd_u = _sd([c - p for c, p in zip(unhedged, plan)])
        sd_ratio = sd_h / sd_u if sd_u > 0 else 1.0
        cash_ratio = sum(hedged) / sum(unhedged) if sum(unhedged) > 0 else 1.0
        no_breach = breach_quarter is None
        calm = sd_ratio <= 0.7
        kept = cash_ratio >= 0.95
        stars = (1 + int(calm) + int(calm and kept)) if no_breach else 0    # the third star needs real hedging, not just cash
        score = 0.0
        if no_breach:
            score = (40.0 + 40.0 * min(1.0, max(0.0, (1.0 - sd_ratio) / 0.3))
                     + 20.0 * min(1.0, max(0.0, (cash_ratio - 0.85) / 0.10)))
        if not no_breach:
            head = f"Covenant breached in Q{breach_quarter}: 0 stars."
        else:
            head = (f"Cash-flow volatility {sd_ratio:.0%} of unhedged, cash {cash_ratio:.0%} of unhedged, "
                    f"covenant intact: {stars} star{'s' if stars != 1 else ''}.")
        q_h = [sum(hedged[3 * q:3 * q + 3]) for q in range(n // 3)]
        q_u = [sum(unhedged[3 * q:3 * q + 3]) for q in range(n // 3)]
        state["status"] = "finished"
        state["result"] = {
            "score": round(score, 1), "stars": stars, "headline": head,
            "breakdown": {
                "covenant_breach_quarter": breach_quarter,
                "sd_hedged_usd": round(sd_h, 2), "sd_unhedged_usd": round(sd_u, 2), "sd_ratio": round(sd_ratio, 4),
                "cash_hedged_usd": round(sum(hedged), 2), "cash_unhedged_usd": round(sum(unhedged), 2),
                "cash_ratio": round(cash_ratio, 4),
                "hedge_pnl_usd": round(sum(r["hedge_usd"] for r in state["months"]), 2),
                "over_hedged_bbl": round(sum(r["over_hedged_bbl"] for r in state["months"]), 1),
                "volatility_measure": "sample standard deviation of (monthly cash - plan), plan = forecast volume at "
                                      "the deck price; the production decline is not counted as volatility",
                "stars_rule": "1 for no covenant breach, +1 if volatility <= 70 % of unhedged, +1 more if also cash >= 95 % of "
                              "unhedged; a breach is 0 stars",
            },
            "lookback": {
                "wti_path_usd_bbl": t["price"],
                "production_surprise": round(t["surprise"], 4),
                "actual_bbl": [round(v, 1) for v in t["actual_bbl"]],
                "forecast_bbl": [round(forecast(m), 1) for m in range(MONTHS)],
                "net_forecast_bbl": [round(net_forecast(m), 1) for m in range(MONTHS)],
                "plan_cash_usd": [round(p, 2) for p in plan],
                "hedged_cash_usd": hedged, "unhedged_cash_usd": unhedged,
                "hedged_quarterly_usd": [round(v, 2) for v in q_h],
                "unhedged_quarterly_usd": [round(v, 2) for v in q_u],
                "covenant_floor_usd": [round(v, 2) for v in state["covenant_floor_usd"]],
            },
        }

    # ----- view

    def view(self, state):
        q = state["quarter"]
        coverage = []
        for m in range(len(state["forecast_net"]) if state.get("forecast_net") is not None else MONTHS):
            f = self._nf(state, m) or 1e-9
            coverage.append({"month": m + 1, "forecast_bbl": round(self._gf(state, m), 1), "net_forecast_bbl": round(f, 1),
                             "swap_bbl": round(self._covered(state, m, ("swap",)), 1),
                             "floor_bbl": round(self._covered(state, m, ("put", "collar")), 1),
                             "capped_bbl": round(self._covered(state, m, ("collar",)), 1),
                             "hedge_ratio": round(self._covered(state, m) / f, 4)})
        v = {
            "career_mode": bool(state.get("career_mode")),
            "month": 3 * q, "quarter": q + 1, "quarters_total": QUARTERS, "months_total": MONTHS,
            "spot_wti_usd_bbl": state["spot"], "differential_usd_bbl": opecon.PRICE_DECK["oil_diff_usd_bbl"],
            "wells": WELLS, "net_revenue_interest": NRI, "hedge_cap": HEDGE_CAP, "implied_vol": VOL_YEAR,
            "covenant_floor_usd": [round(x, 2) for x in state["covenant_floor_usd"]],
            "coverage": coverage,
            "book": state["book"],
            "history": state["months"],
            "quarterly_cash_usd": [round(sum(r["cash_usd"] for r in state["months"][3 * i:3 * i + 3]), 2)
                                   for i in range(len(state["months"]) // 3)],
        }
        actions = []
        if state["status"] == "active":
            v["quotes"] = self._quotes(state)
            spot = state["spot"]
            share = base.arg("number", min=5, max=80, step=5, unit="%")
            tenor = base.arg("int", min=1, max=min(4, QUARTERS - q), step=1, unit="quarters")
            put_k = base.arg("number", min=round(0.5 * spot, 2), max=round(spot, 2), step=0.5, unit="USD/bbl")
            if any(self._headroom(state, m) > 1.0 for m in self._window(state, 4)):
                actions += [
                    {"name": "swap", "label": "Sell swaps", "args": {"share_pct": share, "quarters": tenor}},
                    {"name": "put", "label": "Buy put floors", "args": {"share_pct": share, "quarters": tenor,
                                                                         "put_strike": put_k}},
                    {"name": "collar", "label": "Collar (buy put, sell call)",
                     "args": {"share_pct": share, "quarters": tenor, "put_strike": put_k,
                              "call_strike": base.arg("number", min=round(spot, 2), max=round(2 * spot, 2), step=0.5,
                                                      unit="USD/bbl")}},
                ]
            if state.get("career_mode"):
                actions.append({"name": "commit", "label": "Commit this hedge book to the company", "args": {}})
            else:
                actions.append({"name": "advance", "label": f"Produce Q{q + 1}", "args": {}})
        return {"view": v, "actions": actions, "notes": NOTES}


base.register(Hedging())
