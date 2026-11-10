"""Game economics: illustrative numbers, not a real play. All money in US dollars, volumes in field units."""
MONTH_DAYS = 30.4375

DEFAULT_PRICES = {"oil_usd_stb": 70.0, "gas_usd_mscf": 2.5, "water_disposal_usd_stb": 3.0}
DEFAULT_COSTS = {
    "well_base_usd": 1_500_000.0,      # pad, vertical and build section
    "lateral_usd_ft": 500.0,           # drilling and casing the lateral
    "stage_usd": 60_000.0,             # plugs, perforating, crew time per stage
    "half_length_usd": 25_000.0,       # per stage, times (half-length / 100 ft)^2: pumped volume grows faster than length
    "conductivity_usd_mdft": 1_500.0,  # proppant per stage per md-ft
    "lift_usd_per_kpsi": 400_000.0,    # artificial lift to draw bottom-hole pressure below lift_free_bhp_psi, per 1,000 psi
    "lift_free_bhp_psi": 2500.0,
    "opex_usd_month": 15_000.0,        # fixed lease operating cost
    "discount_rate": 0.10,             # per year, applied monthly
}


def capex(design, lateral_ft, costs):
    """Itemised capital cost of a design. design: stages, half_length_ft[], conductivity_mdft[], bhp_psi."""
    n = design["stages"]
    hl, cd = design["half_length_ft"], design["conductivity_mdft"]
    items = {
        "well_usd": costs["well_base_usd"] + costs["lateral_usd_ft"] * lateral_ft,
        "stages_usd": costs["stage_usd"] * n,
        "fracture_size_usd": sum(costs["half_length_usd"] * (h / 100.0) ** 2 for h in hl),
        "proppant_usd": sum(costs["conductivity_usd_mdft"] * c for c in cd),
        "lift_usd": costs["lift_usd_per_kpsi"] * max(0.0, costs["lift_free_bhp_psi"] - design["bhp_psi"]) / 1000.0,
    }
    items["total_usd"] = sum(items.values())
    return items


def monthly_volumes(time_days, oil, gas, water, months):
    """Integrate field rates (rate at the end of each solver step x step length) into calendar months."""
    vol = {k: [0.0] * months for k in ("oil_stb", "gas_mscf", "water_stb")}
    prev = 0.0
    for t, o, g, w in zip(time_days, oil, gas, water):
        dt = t - prev
        prev = t
        if dt <= 0:
            continue
        m = min(max(int(-(-(t - 1e-5) // MONTH_DAYS)), 1), months) - 1   # ceil, with slack for round-off
        vol["oil_stb"][m] += o * dt
        vol["gas_mscf"][m] += g * dt
        vol["water_stb"][m] += w * dt
    return vol


def cashflow(vol, capex_total, prices, costs):
    """Monthly cash, discounted cumulative cash and NPV. Capital is spent at time zero; cash arrives at month end."""
    months = len(vol["oil_stb"])
    r = (1.0 + costs["discount_rate"]) ** (1.0 / 12.0) - 1.0
    cash, cum_disc, cum_oil = [], [], []
    run_disc, run_oil = -capex_total, 0.0
    rev = {"oil_usd": 0.0, "gas_usd": 0.0, "water_usd": 0.0, "opex_usd": 0.0}
    for m in range(months):
        o, g, w = vol["oil_stb"][m], vol["gas_mscf"][m], vol["water_stb"][m]
        parts = (o * prices["oil_usd_stb"], g * prices["gas_usd_mscf"], -w * prices["water_disposal_usd_stb"], -costs["opex_usd_month"])
        for k, v in zip(rev, parts):
            rev[k] += v
        c = sum(parts)
        cash.append(c)
        run_disc += c / (1.0 + r) ** (m + 1)
        cum_disc.append(run_disc)
        run_oil += o
        cum_oil.append(run_oil)
    rev["net_usd"] = sum(cash)
    return {"cash_usd": cash, "cum_disc_cash_usd": cum_disc, "cum_oil_stb": cum_oil, "npv_usd": run_disc, "revenue": rev}


def stars(npv, thresholds):
    return sum(1 for t in thresholds if npv >= t)
