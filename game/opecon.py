"""Operator-style economics for career mode: interests, taxes, LOE, cash flow and the measures operators report.
Illustrative numbers, not a real play. Money in USD, oil and water in bbl, gas in Mcf, time in months."""
MONTH_DAYS = 30.4375

PRICE_DECK = {
    "oil_usd_bbl": 70.0, "oil_diff_usd_bbl": -3.0,     # WTI-style benchmark and regional differential
    "gas_usd_mcf": 2.5, "gas_diff_usd_mcf": -0.3,
}
TERMS = {
    "working_interest": 1.0,
    "royalty": 0.20,                  # NRI = WI x (1 - royalty)
    "severance_oil": 0.046, "severance_gas": 0.075, "ad_valorem": 0.02,   # on revenue after royalty
    "loe_usd_well_month": 8_000.0, "loe_usd_boe": 6.0,
    "gathering_usd_mcf": 0.40, "water_disposal_usd_bbl": 1.0,
    "discount_rate": 0.10,            # per year, mid-month convention
    "boe_mcf": 6.0,                   # 6 Mcf = 1 BOE
}
UNITS = {"money": "USD", "oil": "bbl", "gas": "Mcf", "water": "bbl", "time": "month", "boe": "BOE (6 Mcf = 1 bbl)"}

# Well and pad costs (AFE-style estimate). Quantities come from the design; these are the unit prices.
COSTS = {
    "rig_spread_usd_day": 95_000.0,   # rig, crew, mud, directional and services per day
    "vertical_days": 7.0,             # surface to landing, including the curve
    "lateral_ft_per_day": 1_500.0,
    "rig_move_days": 4.0,
    "learning_per_well": 0.03, "learning_floor": 0.70,
    "tangibles_usd": 650_000.0,       # casing and wellhead
    "mobilisation_usd": 100_000.0,
    "stage_usd": 40_000.0,            # plugs, perforating, crew time
    "half_length_usd": 10_000.0,      # per stage x (half-length / 100 ft)^2: pumped volume
    "conductivity_usd_mdft": 600.0,   # proppant, per stage per md-ft
    "stages_per_day": 6.0,
    "crew_move_days": 2.0,
    "tie_in_usd": 350_000.0, "tie_in_days": 14.0,
    "lift_usd": 150_000.0, "lift_free_bhp_psi": 2500.0, "lift_usd_per_kpsi": 100_000.0,
    "pad_usd": 400_000.0, "pad_build_days": 30.0,
}
LATERAL_FT = 4620.0             # a 5,280 ft section less 330 ft setbacks at each end


def well_estimate(design, lateral_ft=LATERAL_FT, costs=COSTS):
    """AFE-style estimate for one well: line items, drilling days and frac days."""
    n = max(1, round(lateral_ft / design["stage_spacing_ft"]))
    days = costs["vertical_days"] + lateral_ft / costs["lateral_ft_per_day"]
    hl, cd = design["half_length_ft"], design["conductivity_mdft"]
    drill = {
        "rig_spread_usd": days * costs["rig_spread_usd_day"],
        "tangibles_usd": costs["tangibles_usd"],
        "mobilisation_usd": costs["mobilisation_usd"],
    }
    complete = {
        "stages_usd": n * costs["stage_usd"],
        "fracture_size_usd": n * costs["half_length_usd"] * (hl / 100.0) ** 2,
        "proppant_usd": n * costs["conductivity_usd_mdft"] * cd,
    }
    lift = costs["lift_usd"] + costs["lift_usd_per_kpsi"] * max(0.0, costs["lift_free_bhp_psi"] - design["bhp_psi"]) / 1000.0
    facilities = {"tie_in_usd": costs["tie_in_usd"], "lift_usd": lift}
    out = {
        "stages": n, "drill_days": days, "frac_days": n / costs["stages_per_day"],
        "drilling": drill, "completion": complete, "facilities": facilities,
        "drilling_usd": sum(drill.values()), "completion_usd": sum(complete.values()), "facilities_usd": sum(facilities.values()),
    }
    out["total_usd"] = out["drilling_usd"] + out["completion_usd"] + out["facilities_usd"]
    return out


def net_cash(oil, gas, water, producing_wells, deck=PRICE_DECK, terms=TERMS):
    """Monthly operating cash (before capex) and its parts, from gross volumes."""
    ro = deck["oil_usd_bbl"] + deck["oil_diff_usd_bbl"]
    rg = deck["gas_usd_mcf"] + deck["gas_diff_usd_mcf"]
    nri = terms["working_interest"] * (1.0 - terms["royalty"])
    wi = terms["working_interest"]
    rev_o, rev_g = oil * ro * nri, gas * rg * nri
    tax = rev_o * terms["severance_oil"] + rev_g * terms["severance_gas"] + (rev_o + rev_g) * terms["ad_valorem"]
    boe = oil + gas / terms["boe_mcf"]
    loe = wi * (producing_wells * terms["loe_usd_well_month"] + boe * terms["loe_usd_boe"])
    other = wi * (gas * terms["gathering_usd_mcf"] + water * terms["water_disposal_usd_bbl"])
    return {"oil_revenue_usd": rev_o, "gas_revenue_usd": rev_g, "taxes_usd": -tax, "loe_usd": -loe, "other_opex_usd": -other,
            "net_usd": rev_o + rev_g - tax - loe - other}


def disc_factor(m, rate):
    """Mid-month discount factor for month index m (0 = first month)."""
    return (1.0 + rate) ** (-(m + 0.5) / 12.0)


def measures(op_cash, capex, eur_boe=None, rate=TERMS["discount_rate"]):
    """NPV10, IRR, payout, peak exposure, PV10/I and F&D from monthly operating cash and capex lists."""
    net = [o - c for o, c in zip(op_cash, capex)]
    npv = sum(v * disc_factor(m, rate) for m, v in enumerate(net))
    pv_capex = sum(c * disc_factor(m, rate) for m, c in enumerate(capex))
    cum, peak, payout = 0.0, 0.0, None
    cumlist = []
    first_capex = next((i for i, c in enumerate(capex) if c > 0), None)
    for m, v in enumerate(net):
        cum += v
        cumlist.append(cum)
        peak = min(peak, cum)
        if payout is None and first_capex is not None and m >= first_capex and cum >= 0:
            payout = m + 1
    total_capex = sum(capex)
    return {
        "npv10_usd": npv, "irr": irr(net), "payout_month": payout, "peak_exposure_usd": peak,
        "pv10_capex_usd": pv_capex, "pvi": (npv / pv_capex) if pv_capex > 0 else None,   # PV10/I = NPV10 / PV10(capex)
        "capex_usd": total_capex, "fd_usd_boe": (total_capex / eur_boe) if eur_boe else None,
        "cum_cash_usd": cumlist,
    }


def irr(net):
    """Annual IRR of monthly cash by bisection; None if it has no sign change or no root in range."""
    if not any(v < 0 for v in net) or not any(v > 0 for v in net):
        return None
    f = lambda r: sum(v * (1.0 + r) ** (-(m + 0.5) / 12.0) for m, v in enumerate(net))
    lo, hi = -0.99, 100.0
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if flo * fm <= 0:
            hi = mid
        else:
            lo, flo = mid, fm
    return 0.5 * (lo + hi)
