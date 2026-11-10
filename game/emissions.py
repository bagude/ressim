"""Emissions (#14): CO2-equivalent from your operations each month, an intensity target from the board, a carbon price,
and two abatement choices in the plan.

Sources (illustrative factors, labelled as such; not a regulatory inventory):
- drilling: rig diesel, 25 t CO2e per rig-day;
- completions: frac fleet fuel, 6 t per stage (an electric fleet on grid or field gas: 3 t, at +4 % completion cost);
- production: compression and fuel, 0.0012 t per Mcf of gas handled (about 2 % of the gas burned);
- fugitive and tank venting: 25 t per producing well-month (about 1 t of methane) (vapour recovery units: -75 %, $150,000 per pad).
Intensity = CO2e / BOE produced (6 Mcf = 1 BOE). The board's target falls 8 % a year from 6.5 kg/BOE (no routine flaring in this model); a carbon price
of $25/t is charged on everything emitted.
"""
import opecon

F = {"rig_t_day": 25.0, "frac_t_stage": 6.0, "efrac_t_stage": 3.0, "comp_t_mcf": 0.0012, "fugitive_t_well_month": 25.0, "vru_cut": 0.75}
EFRAC_COMPLETION_FACTOR = 1.04
VRU_USD_PAD = 150_000.0
CARBON_USD_T = 25.0
TARGET_KG_BOE = 6.5
TARGET_DECLINE = 0.08


def plan_options(raw):
    e = raw.get("emissions") or {}
    if not isinstance(e, dict):
        raise ValueError("plan.emissions must be an object")
    return {"electric_frac": bool(e.get("electric_frac")), "vru": bool(e.get("vru"))}


def month(state, t0, t1, gas_mcf, producing):
    """Emissions for the month from the locked pads' activity and production. Returns (tCO2e, parts)."""
    opts = (state.get("plan") or {}).get("emissions") or {}
    rig_days = frac_stages = 0.0
    vru_wells = 0
    for p in state["locked"].values():
        for w in p["wells"]:
            a, b = max(t0, w["spud"]), min(t1, w["td"])
            rig_days += max(0.0, b - a)
            fa, fb = max(t0, w.get("frac_start", 0.0)), min(t1, w.get("frac_end", 0.0))
            if fb > fa and w.get("frac_end", 0.0) > w.get("frac_start", 0.0):
                frac_stages += (fb - fa) / (w["frac_end"] - w["frac_start"]) * (opecon.LATERAL_FT / p.get("design", {}).get("stage_spacing_ft", 200.0))
        if p.get("vru"):
            vru_wells += len(p["wells"])
    fug_wells = max(0, producing - vru_wells) + vru_wells * (1 - F["vru_cut"])
    parts = {"drilling_t": rig_days * F["rig_t_day"],
             "completions_t": frac_stages * (F["efrac_t_stage"] if opts.get("electric_frac") else F["frac_t_stage"]),
             "compression_t": gas_mcf * F["comp_t_mcf"], "fugitive_t": fug_wells * F["fugitive_t_well_month"]}
    return sum(parts.values()), parts


def target_kg_boe(year_index):
    return TARGET_KG_BOE * (1 - TARGET_DECLINE) ** year_index


def year_part(state, y):
    h = state["history"]
    idx = [i for i, m in enumerate(h["month"]) if 12 * y <= m < 12 * (y + 1)]
    co2 = sum((h.get("co2e_t") or [0.0] * len(h["month"]))[i] or 0.0 for i in idx)
    boe = sum(h["oil"][i] + h["gas"][i] / 6.0 for i in idx)
    if boe <= 0:
        return {}, None
    kg = 1000.0 * co2 / boe
    tgt = target_kg_boe(y)
    part = max(-4.0, min(2.0, 10.0 * (tgt - kg) / tgt))
    return {"emissions_intensity": part}, {"co2e_t": round(co2), "intensity_kg_boe": round(kg, 2), "target_kg_boe": round(tgt, 2)}


NOTES = [__doc__.split("\n\n")[1].replace("\n", " ")]
