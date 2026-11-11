# Diagnostic fracture injection test (DFIT): a small injection, then hours of watching the pressure fall.
#
# `run_dfit` makes a synthetic test from known rock; `dfit_analysis` is the standard reading of such a
# record. Run one on the other to see how well the textbook analysis recovers what was put in.
#
# The synthetic test has two parts that share one description of the rock:
#   before closure  the fracture model (multifrac.jl) is pumped, shut in and left to close on its leak-off.
#                   The pressure at the well is the closure stress plus the model's net pressure.
#   after closure   the fracture's walls touch, but it still holds fluid and is now stiffer (by
#                   `closed_stiffness`). That fluid goes on leaking into the rock, and the leak-off answers to
#                   the falling pressure: one equation for the pressure, solved step by step (the rock side
#                   is the exact one-dimensional response to a face whose pressure changes in time). Late on,
#                   the pressure approaches the pore pressure as one over the square root of time.
# They are tied together by taking the leak-off coefficient from the rock itself:
#   C_L = (closure stress - reservoir pressure) * sqrt(k phi c_t / (pi mu))
# which is what one-dimensional flow into rock gives for a face held at the closure stress.
# The test fracture has its own height (`fracture_height_ft`, tens of feet): a small injection does not open
# the whole pay, and a short fracture is stiff, so the pressure falls visibly while it is still open.
# Not modelled: wellbore storage, perforation and near-wellbore friction (so the first minutes of a real
# test are missing), pressure-dependent leak-off, natural fractures, height recession, radial flow late in
# the falloff, and walls that touch gradually. With walls that touch all at once, closure shows as a sudden
# steepening of the decline (by the stiffness ratio). On many real records nothing that sharp is seen, which
# is why closure picks are argued over.
#
# Formulas of the analysis and where they come from: research/dfit-analysis.md.

"Error function to about 1e-7 (Abramowitz and Stegun 7.1.26)."
function erf_approx(x)
    t = 1 / (1 + 0.3275911 * abs(x))
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x^2)
    return x >= 0 ? y : -y
end

"Nolte's g-function of dimensionless shut-in time (t - tp) / tp. alpha = 1: little leak-off (high efficiency); alpha = 1/2: much leak-off."
dfit_g(dtD; alpha = 1.0) = alpha == 1.0 ? (4 / 3) * ((1 + dtD)^1.5 - dtD^1.5) : (alpha == 0.5 ? (1 + dtD) * asin((1 + dtD)^-0.5) + sqrt(dtD) : error("alpha must be 1 or 1/2"))
"Nolte's G-function: (4 / pi) (g(dtD) - g(0)). Before closure the pressure falls in a straight line against it."
dfit_G(dtD; alpha = 1.0) = (4 / pi) * (dfit_g(dtD; alpha = alpha) - dfit_g(0.0; alpha = alpha))
"After-closure linear-flow time function: (2 / pi) asin(sqrt(tc / t)), times from the start of pumping."
after_closure_linear(t, tc) = (2 / pi) * asin(sqrt(min(tc / t, 1.0)))
"After-closure radial-flow time function: (1/4) ln(1 + (16 / pi^2) tc / (t - tc)), times from the start of pumping."
after_closure_radial(t, tc) = 0.25 * log(1 + (16 / pi^2) * tc / (t - tc))

"Leak-off coefficient (m / sqrt(s), per face) of rock whose face is held `dp` (Pa) above its pore pressure: dp sqrt(k phi c_t / (pi mu))."
reservoir_leakoff(dp; k, phi, ct, mu) = dp * sqrt(k * phi * ct / (pi * mu))

"""
Pressure rise at the well (the middle of the fracture) at time `t`, from leak-off through fracture cells
`x` (centres, one wing; the other wing is its mirror image) of width `dx`, each leaking from `arrival[i]`
to `closure[i]` at C_L / sqrt(time since arrival) per face. `eta` is the rock's diffusivity k / (phi mu c_t).
Exact for uniform rock; with one endless fracture face it returns the pressure the face was held at.
"""
function leakoff_pressure(t, x, dx, arrival, closure; C_L, phi, ct, eta, nq = 24)
    total = 0.0
    for i in eachindex(x)
        t0 = arrival[i]; (isfinite(t0) && t0 < t) || continue
        T = min(closure[i], t); span = T - t0
        span > 0 || continue
        a = x[i] - dx / 2; b = x[i] + dx / 2; s = 0.0
        for j in 1:nq                                   # tau = t0 + span sin^2(theta): removes the square-root singularities at both ends
            th = (j - 0.5) * (pi / 2) / nq
            lag = t - T + span * cos(th)^2
            w = sqrt(4 * eta * lag)
            s += 2 * sqrt(span) * cos(th) * (erf_approx(b / w) - erf_approx(a / w)) / sqrt(lag)
        end
        total += s * (pi / 2) / nq
    end
    return C_L * total / (phi * ct * sqrt(pi * eta))
end

"""
Pressure of a closed fracture that still holds fluid and leaks it into the rock, at the times `ts` (s, all
after the closure time `tc`). `P0` is the pressure at closure and `p_res` the pore pressure (Pa); the rock
face was first wetted at `t0`; `kappa` = sqrt(k phi c_t / (pi mu)) is the leak-off per unit of pressure
difference; `cw` the fracture's storage per unit of face area (m of width per Pa), a number or a function of the
pressure (then taken at the pressure of the step before).
Solves  cw dP/dt = -2 kappa [ (P0 - p_res) / sqrt(t - t0) + integral from tc to t of P'(s) / sqrt(t - s) ds ]
with the pressure taken as changing at a constant rate within each step.
"""
function closed_fracture_pressure(ts; tc, t0, P0, p_res, kappa, cw)
    n = length(ts); P = zeros(n); g = zeros(n); tprev = tc; Pprev = P0
    edges = vcat(tc, ts)
    for i in 1:n
        t = ts[i]; hist = 0.0
        for j in 1:i-1
            hist += g[j] * 2 * (sqrt(t - edges[j]) - sqrt(t - edges[j+1]))
        end
        wii = 2 * sqrt(t - tprev)
        cwi = cw isa Function ? cw(Pprev) : cw
        g[i] = -2 * kappa * ((P0 - p_res) / sqrt(t - t0) + hist) / (cwi + 2 * kappa * wii)
        P[i] = Pprev + g[i] * (t - tprev)
        tprev = t; Pprev = P[i]
    end
    return P
end

"""
    run_dfit(; pay_ft, youngs_psi, poisson, rate_bpm, pump_minutes, falloff_hours, closure_psi, reservoir_psi,
               perm_md, porosity, total_compressibility, reservoir_viscosity_cp, viscosity_cp = 1.0,
               fracture_height_ft = min(pay_ft, 40), closed_stiffness = 3.0)

A synthetic DFIT. `closure_psi` is the closure stress in the pay and `reservoir_psi` the pore pressure, both
absolute; `perm_md`, `porosity`, `total_compressibility` (1/psi) and `reservoir_viscosity_cp` describe the
rock and the fluid in it, and set the leak-off. The test fracture is contained in `fracture_height_ft`;
once closed it is `closed_stiffness` times stiffer than when open. With `contact_psi = 0` the walls touch all at once
and closure is a sharp steepening. With `contact_psi` > 0 they touch gradually: stiffening starts when the pressure is
that far above the closure stress and is complete that far below it (`contact_minutes` is when it starts,
`closure_minutes` when the pressure passes the closure stress itself). Returns the record after shut-in
(`minutes`, `pressure_psi`), the instantaneous shut-in pressure, the true closure time, the leak-off
coefficient used, the fluid efficiency at shut-in, the fracture half-length at shut-in, and the injected
volume. `truth` repeats what an analysis should recover.
"""
function run_dfit(; pay_ft, youngs_psi, poisson = 0.25, rate_bpm, pump_minutes, falloff_hours, closure_psi, reservoir_psi, perm_md, porosity, total_compressibility,
        reservoir_viscosity_cp, viscosity_cp = 1.0, fracture_height_ft = min(pay_ft, 40.0), closed_stiffness = 3.0, contact_psi = 0.0, barrier_psi = 1.0e5, ncell = 400, shut_steps = 600, late_points = 240)
    closure_psi > reservoir_psi || error("run_dfit: the closure stress must be above the reservoir pressure")
    contact_psi >= 0 || error("run_dfit: contact_psi cannot be negative")
    closed_stiffness >= 1 || error("run_dfit: a closed fracture cannot be softer than an open one (closed_stiffness >= 1)")
    k = perm_md * 1e-3 * DARCY; ct = total_compressibility / PSI; mu_r = reservoir_viscosity_cp * 1e-3
    kappa = sqrt(k * porosity * ct / (pi * mu_r)); C_L = (closure_psi - reservoir_psi) * PSI * kappa
    Ep = youngs_psi * PSI / (1 - poisson^2); tp = pump_minutes * 60.0; h = fracture_height_ft * FT
    # run the fracture long enough to close: lengthen the falloff until the well cell has closed, up to the time asked for
    t_fall = min(falloff_hours * 3600.0, 20 * tp); r = nothing; f = nothing
    while true
        r = stage_grow(; pay = h, dsigma = barrier_psi * PSI, Eprime = Ep, mu = viscosity_cp * 1e-3, C_L = C_L, q_stage = rate_bpm * BPM, positions = [0.0],
            ncell = ncell, t_end = tp + t_fall, pump_time = tp, shut_steps = shut_steps)
        f = r.fractures[1]
        (isfinite(f.closure[1]) || t_fall >= falloff_hours * 3600.0) && break
        t_fall = min(4 * t_fall, falloff_hours * 3600.0)
    end
    np = count(<=(tp * (1 + 1e-9)), r.t); tc = f.closure[1]
    isfinite(tc) || error("run_dfit: the fracture had not closed after $(falloff_hours) hours; the rock is too tight for a test this short")
    # before closure: closure stress plus net pressure at the well, from the model's own time steps
    before = [(r.t[j] - tp, closure_psi + f.p0[j] / PSI) for j in np:length(r.t) if r.t[j] < tc && f.p0[j] > 0]
    # The model notes closure at the end of the time step in which the walls met. The record closes where the net pressure reaches
    # zero inside that step, on the line through its last two points, so the two halves join without a flat spot.
    if length(before) >= 2
        (t1, p1), (t2, p2) = before[end-1], before[end]
        p1 > p2 && (tc = min(tc, tp + t2 + (p2 - closure_psi) * (t2 - t1) / (p1 - p2)))
    end
    # after closure: the closed fracture bleeding down. Its storage is the open fracture's (mean width per unit of net pressure,
    # pi h / (2 E')) divided by the stiffness ratio; the face is taken as wetted at the area-weighted mean arrival time.
    wet = [i for i in eachindex(f.x) if isfinite(f.arrival[i]) && f.arrival[i] < tp]
    t0 = sum(f.arrival[i] for i in wet) / length(wet)
    cw = pi * h / (2 * Ep) / closed_stiffness
    t_last = tp + falloff_hours * 3600.0
    contact_minutes = NaN
    if contact_psi > 0
        # Walls that touch gradually. Rough walls first meet while the fluid pressure is still `contact_psi` above the closure
        # stress; from there down to the same distance below it the fracture stiffens smoothly from open to closed. The fracture
        # model is followed down to first contact, and the closed-fracture equation takes over there with a storage that falls
        # with pressure, so the decline steepens gradually instead of in one step.
        jc = findlast(x -> x[2] > closure_psi + contact_psi, before)
        (isnothing(jc) || jc == length(before)) && error("run_dfit: contact_psi must be below the net pressure at shut-in and above the last recorded net pressure before closure")
        (t1, p1), (t2, p2) = before[jc], before[jc+1]
        tsw = tp + t1 + (p1 - (closure_psi + contact_psi)) * (t2 - t1) / (p1 - p2)
        before = before[1:jc]
        cw_open = pi * h / (2 * Ep)
        stor(P) = (x = clamp((P / PSI - (closure_psi - contact_psi)) / (2 * contact_psi), 0.0, 1.0); cw_open * (1 / closed_stiffness + (1 - 1 / closed_stiffness) * x^2 * (3 - 2 * x)))
        ts = [tsw + (t_last - tsw) * (j / late_points)^3 for j in 1:late_points]
        Pc = closed_fracture_pressure(ts; tc = tsw, t0 = t0, P0 = (closure_psi + contact_psi) * PSI, p_res = reservoir_psi * PSI, kappa = kappa, cw = stor)
        after = vcat([(tsw - tp, closure_psi + contact_psi)], [(ts[j] - tp, Pc[j] / PSI) for j in 1:late_points])
        contact_minutes = (tsw - tp) / 60
        jz = findfirst(x -> x[2] <= closure_psi, after)          # when the pressure reaches the closure stress itself
        tc = isnothing(jz) ? NaN : jz == 1 ? tsw : tp + after[jz-1][1] + (after[jz-1][2] - closure_psi) * (after[jz][1] - after[jz-1][1]) / (after[jz-1][2] - after[jz][2])
    else
        ts = [tc + (t_last - tc) * (j / late_points)^3 for j in 1:late_points]              # short steps first
        Pc = closed_fracture_pressure(ts; tc = tc, t0 = t0, P0 = closure_psi * PSI, p_res = reservoir_psi * PSI, kappa = kappa, cw = cw)
        after = vcat([(tc - tp, closure_psi)], [(ts[j] - tp, Pc[j] / PSI) for j in 1:late_points])
    end
    rec = vcat(before, after)
    return (minutes = [x[1] / 60 for x in rec], pressure_psi = [x[2] for x in rec], isip_psi = closure_psi + f.p0[np] / PSI, closure_minutes = (tc - tp) / 60, contact_minutes = contact_minutes,
        leakoff_ft_sqrtmin = C_L / FT_SQRTMIN, efficiency = sum(sec_lookup(r.table, v)[1] for v in f.p_at_shutin) * f.dx / f.V_injected,
        half_length_ft = f.L[np] / FT, injected_bbl = 2 * f.V_injected / STB,
        truth = (closure_psi = closure_psi, reservoir_psi = reservoir_psi, perm_md = perm_md, fracture_height_ft = fracture_height_ft, closed_stiffness = closed_stiffness, contact_psi = contact_psi), detail = r)
end

"""
    dfit_analysis(minutes, pressure_psi; pump_minutes, injected_bbl, height_ft, youngs_psi, poisson, porosity,
                  total_compressibility, reservoir_viscosity_cp, alpha = 1.0)

The standard reading of a DFIT record (`minutes` since shut-in). Before closure: the G-function plot, the
closure pick (where the fall of pressure against G has become 10% steeper than at its steadiest: the walls
have met and the system has stiffened), fluid efficiency from the closure G, and
the leak-off coefficient from the slope with the compliance of a contained (PKN) fracture. Two slopes are
given, the steadiest part of the open decline and the whole of it (`..._whole`); they bracket the answer.
After closure:
pore pressure from the straight line against the linear-flow time function, permeability from the leak-off
coefficient, and, from the last part of the record, kh from the radial-flow straight line. That last number
means something only if radial flow was reached: `late_slope` is the log-log slope of the last third of the
record (-1/2 in linear flow, -1 in radial flow) and `radial_reached` is true below -0.85.
"""
function dfit_analysis(minutes, pressure_psi; pump_minutes, injected_bbl, height_ft, youngs_psi, poisson = 0.25, porosity, total_compressibility, reservoir_viscosity_cp, alpha = 1.0)
    n = length(minutes); G = [dfit_G(m / pump_minutes; alpha = alpha) for m in minutes]
    dPdG = fill(NaN, n)
    for i in 2:n-1
        G[i+1] > G[i-1] && (dPdG[i] = (pressure_psi[i+1] - pressure_psi[i-1]) / (G[i+1] - G[i-1]))
    end
    # While the fracture is open the pressure falls at a steady rate against G; once the walls meet the system is far stiffer and
    # it falls faster. Closure is picked where |dP/dG| has risen 10% above its lowest value (the pick McClure and co-authors
    # argue for). The slope of the open period is the median of the points within 10% of that lowest value.
    cand = [i for i in 2:n-1 if isfinite(dPdG[i]) && G[i] > 0.05]
    mid3(a, b, c) = max(min(a, b), min(max(a, b), c))
    rate = [1 < j < length(cand) ? mid3(-dPdG[cand[j-1]], -dPdG[cand[j]], -dPdG[cand[j+1]]) : -dPdG[cand[j]] for j in eachindex(cand)]   # one odd point does not count
    low = Inf; jc = length(cand)                        # walk forward: the lowest rate so far, and the first point 10% above it
    for j in eachindex(cand)
        if j > 3 && rate[j] > 1.1 * low
            jc = j; break
        end
        low = min(low, rate[j])
    end
    ic = cand[jc]; Gc = G[ic]; pc = pressure_psi[ic]; tc_min = minutes[ic]
    plateau = sort([rate[j] for j in 1:jc-1 if rate[j] <= 1.1 * low])
    slope = isempty(plateau) ? low : plateau[cld(length(plateau), 2)]
    isip = pc + slope * Gc
    eff = Gc / (Gc + 4 * dfit_g(0.0; alpha = alpha) / pi)
    Ep = youngs_psi / (1 - poisson^2)
    C_L = slope * height_ft / (Ep * sqrt(pump_minutes))                              # ft / sqrt(min), per face; all of the height takes leak-off
    # The decline is not one straight line (right after shut-in the pressure also evens out along the fracture), so the answer
    # depends on what is fitted. The second estimate uses the whole open period: first recorded pressure to closure.
    slope_whole = Gc > 0 ? (pressure_psi[1] - pc) / Gc : NaN
    C_L_whole = slope_whole * height_ft / (Ep * sqrt(pump_minutes))
    # after closure, times from the start of pumping
    tcs = pump_minutes + tc_min; late = [i for i in ic+1:n if minutes[i] + pump_minutes > 1.5 * tcs]
    line(xs, ys) = (mx = sum(xs) / length(xs); my = sum(ys) / length(ys); b = sum((xs .- mx) .* (ys .- my)) / sum((xs .- mx) .^ 2); (my - b * mx, b))
    p_lin = NaN; p_rad = NaN; kh = NaN
    if length(late) >= 6
        FL = [after_closure_linear(minutes[i] + pump_minutes, tcs) for i in late]; pl = pressure_psi[late]
        k0 = fld(2 * length(late), 3) + 1                                             # last third of the record: by then the closed fracture has bled down
        p_lin = line(FL[k0:end], pl[k0:end])[1]
        tail = late[fld(2 * length(late), 3)+1:end]                                    # last third: radial flow if it was reached
        inv_t = [1 / ((minutes[i] + pump_minutes) / 60) for i in tail]                 # 1 / hours
        p_rad, m_r = line(inv_t, pressure_psi[tail])
        kh = 24 * 70.6 * injected_bbl * reservoir_viscosity_cp / m_r                   # md-ft: impulse radial flow, p - p_i = 1694.4 V mu / (k h t)
    end
    # How the last third of the record falls, on log-log axes: -1/2 in linear flow, -1 in radial flow. Taken from the derivative
    # dp / d ln(t), which falls at the same rate as the distance to the pore pressure and does not need the pore pressure itself.
    late_slope = NaN
    if length(late) >= 9
        tail = late[fld(2 * length(late), 3)+1:end]; lt = Float64[]; ld = Float64[]
        for j in 2:length(tail)-1
            i0 = tail[j-1]; i1 = tail[j+1]; i = tail[j]
            d = (pressure_psi[i1] - pressure_psi[i0]) / (log(minutes[i1] + pump_minutes) - log(minutes[i0] + pump_minutes))
            d < 0 && (push!(lt, log(minutes[i] + pump_minutes)); push!(ld, log(-d)))
        end
        length(lt) >= 3 && (late_slope = line(lt, ld)[2])
    end
    radial = late_slope < -0.85
    p_pore = radial ? p_rad : p_lin                                                 # the straight line that fits the flow the record ended in
    kperm(c) = isfinite(p_pore) && pc > p_pore ? pi * (reservoir_viscosity_cp * 1e-3) * (c * FT_SQRTMIN)^2 / (porosity * (total_compressibility / PSI) * ((pc - p_pore) * PSI)^2) / (1e-3 * DARCY) : NaN
    perm_from_leakoff = kperm(C_L)
    return (G = G, dPdG = dPdG, GdPdG = G .* dPdG, closure_G = Gc, closure_psi = pc, closure_minutes = tc_min, isip_psi = isip, efficiency = eff, slope_psi = slope,
        leakoff_ft_sqrtmin = C_L, slope_whole_psi = slope_whole, leakoff_whole_ft_sqrtmin = C_L_whole, pore_pressure_psi = p_pore, pore_pressure_linear_psi = p_lin,
        pore_pressure_radial_psi = p_rad, kh_mdft = kh, perm_md_from_leakoff = perm_from_leakoff, perm_md_from_leakoff_whole = kperm(C_L_whole),
        late_slope = late_slope, radial_reached = radial)
end
