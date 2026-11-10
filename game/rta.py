"""Rate-transient analysis (#10) on one of your wells: the plots an engineer reads production with.

- Rate-normalised pressure (p_i - p_wf) / q against the square root of time: a straight line while flow is linear into
  the fractures. For a well held at constant pressure (as yours are) its slope m gives
      A sqrt(k) = 125.2 * B_o / m * sqrt(mu / (phi * c_t))     [A = both faces of every fracture, ft2; k md; m in psi/(stb/d)/sqrt(day)]
  (the constant-rate constant is 79.7; constant pressure is pi/2 larger; checked by the simulator owner against the
  exact linear-flow solution). Each month's average rate is plotted at t* = ((sqrt(t1) + sqrt(t2)) / 2)^2.
- Flowing material balance: q / (p_i - p_wf) against Np / (p_i - p_wf). A line through the late points has x-intercept
  N c_t: contacted oil in place = intercept / c_t, and intercept x drawdown = the oil expansion alone recovers at that
  pressure. In rock this tight a well may stay in linear flow for its whole life; then the late line is not yet
  boundary-dominated and the intercept keeps growing with time.
- APPARENT values: the wells flow far below the bubble point, so free gas near the fractures makes a single-phase oil
  analysis read A sqrt(k) low against the truth. That is the method's limit, not an error.
- Log-log rate against time: slope -1/2 is linear flow; a steeper bend marks the end of it.
Inputs are what an operator has: monthly oil, the bottom-hole pressure the well was held at, a reservoir pressure
estimate (the field's nominal 5,000 psi; the true pressure varies by section) and the SPE1 fluid properties near
the initial pressure (B_o 1.67, viscosity 0.55 cp, total compressibility 1.64e-5 /psi). Porosity comes from your map if you saved one, else 8 %.
"""
import math

import career
import opecon

PI_EST_PSI = 5000.0
BO = 1.67
MU_CP = 0.55
CT_PSI = 1.64e-5
C_CONST_P = 125.2           # A (both faces) sqrt(k), constant bottom-hole pressure


def analyse(state, truth, truth_sim, well_id, phi=None):
    w = next((w for w in state["wells"] if w["id"] == well_id), None)
    if w is None:
        raise career.CareerError("RTA works on your own drilled wells")
    h = w.get("oil_hist")
    if not h or len(h["oil"]) < 3:
        raise career.CareerError("needs at least 3 producing months")
    bhp_sched = w.get("bhp_schedule") or []
    if phi is None:
        phi = 0.08
        for gm in (state.get("geomodels") or {}).values():
            v = (gm.get("sections") or {}).get(w["section"], {}).get("phi")
            if v:
                phi = v
    bo = (state.get("pvt") or {}).get("bo_rb_stb") or BO     # your PVT study's Bo when you ran one
    months = h["oil"]
    online = w["online_day"] / opecon.MONTH_DAYS
    pts = []
    np_cum = 0.0
    for i, q_m in enumerate(months):
        cal = h["from_month"] + i
        t1 = max(0.0, (cal - online) * opecon.MONTH_DAYS)
        t2 = max(1.0, (cal + 1 - online) * opecon.MONTH_DAYS)
        t_days = max(0.5, ((math.sqrt(t1) + math.sqrt(t2)) / 2) ** 2)    # where a month's average rate belongs in linear flow
        days_on = min(opecon.MONTH_DAYS, max(1.0, (cal + 1 - online) * opecon.MONTH_DAYS))
        q = q_m / days_on
        k = int(cal - online) if cal >= online else 0
        pwf = bhp_sched[k] if k < len(bhp_sched) else w["design"]["bhp_psi"]
        dp = max(1.0, PI_EST_PSI - pwf)
        np_cum += q_m
        if q <= 0:
            continue
        pts.append({"t_days": round(t_days, 1), "sqrt_t": round(math.sqrt(t_days), 3), "q_stb_d": round(q, 2), "np_stb": round(np_cum),
                    "pwf_psi": pwf, "dp_over_q": round(dp / q, 4), "q_over_dp": round(q / dp, 6), "np_over_dp": round(np_cum / dp, 3)})
    # linear-flow slope through the origin on the early half (least squares on dp/q = m sqrt t)
    early = pts[:max(3, len(pts) // 2)]
    num = sum(p["sqrt_t"] * p["dp_over_q"] for p in early)
    den = sum(p["sqrt_t"] ** 2 for p in early)
    m = num / den if den > 0 else None
    ac_sqrt_k = C_CONST_P * bo / m * math.sqrt(MU_CP / (phi * CT_PSI)) if m else None
    # flowing material balance: line through the last third; x-intercept = contacted oil
    late = pts[-max(3, len(pts) // 3):]
    xs, ys = [p["np_over_dp"] for p in late], [p["q_over_dp"] for p in late]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx > 0 else 0.0
    fmb = None
    if slope < 0:
        x0 = mx - my / slope                         # Np/dp where q/dp reaches zero
        dp_end = PI_EST_PSI - (bhp_sched[-1] if bhp_sched else w["design"]["bhp_psi"])
        fmb = {"slope": slope, "intercept_q_over_dp": my - slope * mx, "x_intercept": x0,
               "contacted_oil_in_place_stb": round(x0 / CT_PSI), "expansion_recovery_stb": round(x0 * dp_end),
               "note": "may still be growing: the late points may not be boundary-dominated yet"}
    ll = []
    if len(pts) >= 4:
        a, b = pts[1], pts[-1]
        ll = round(math.log(b["q_stb_d"] / a["q_stb_d"]) / math.log(b["t_days"] / a["t_days"]), 3)
    stages = w["stages"]
    return {"well": well_id, "points": pts,
            "linear_flow": {"slope_psi_per_stbd_sqrt_day": m, "a_sqrt_k_ft2_sqrt_md": round(ac_sqrt_k) if ac_sqrt_k else None,
                            "area_convention": "both faces of every fracture", "apparent": True,
                            "per_stage_ft2_sqrt_md": round(ac_sqrt_k / stages) if ac_sqrt_k else None, "porosity_used": phi},
            "flowing_material_balance": fmb, "loglog_slope": ll,
            "inputs": {"initial_pressure_psi": PI_EST_PSI, "bo": bo, "bo_source": "your PVT study" if state.get("pvt") else "textbook", "viscosity_cp": MU_CP, "total_compressibility_1_psi": CT_PSI},
            "notes": [x.replace(chr(10), " ") for x in __doc__.split(chr(10) * 2)]}
