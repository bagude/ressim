# Nodal analysis: where a well's inflow meets its tubing, with or without lift gas.
#
#   inflow_curve    what the reservoir model delivers at a set of bottom-hole pressures, at a chosen date
#   nodal_point     the pressure and rate at which that inflow equals what the tubing needs
#   gaslift_curve   oil rate against lift-gas rate for one well
#   allocate_lift_gas   split a limited amount of lift gas between wells for the most oil
#
# The inflow curve is TRANSIENT: the well is produced to the test date at the spec's own pressure, then,
# from that state, held at each test pressure for `test_days` and the rate at the end is read. A longer
# test gives lower rates; there is no stabilised inflow in rock this tight. The tubing side is any lift
# function from lift.jl: (pressure at the top, oil, water, gas) -> bottom-hole pressure needed. Lift gas
# is simply added to the gas the tubing carries. Not modelled: the gas-lift valve, injection pressure and
# depth, casing-heading, or compressor limits other than the total gas.

"""
    inflow_curve(spec; at_month, bhps_psi, test_days = 1.0)

Rates the well delivers at each bottom-hole pressure in `bhps_psi`, `at_month` months into its life.
Returns `bhp_psi` (sorted), `oil_stb_d`, `gas_mscf_d`, `water_stb_d`.
"""
function inflow_curve(s::FracWellSpec; at_month, bhps_psi, test_days = 1.0, outdir = mktempdir(), kwarg...)
    1 <= at_month || error("inflow_curve: at_month must be at least 1")
    base = run_fracwell(FracWellSpec(; (f => getfield(s, f) for f in fieldnames(FracWellSpec))..., months = at_month); outdir = joinpath(outdir, "history"), kwarg...)
    n = length(s.positions_ft); active = isempty(s.start_month) ? trues(n) : s.start_month .< at_month
    low = nothing
    if s.conductivity_loss_per_psi > 0
        for r in base.runs
            low = lowest_pressure(r.result, low)
        end
    end
    steps = test_days .* [0.001, 0.009, 0.09, 0.9]
    bhps = sort(collect(Float64, bhps_psi)); oil = zeros(length(bhps)); gas = zeros(length(bhps)); water = zeros(length(bhps))
    for (k, b) in enumerate(bhps)
        deck = joinpath(outdir, @sprintf("IPR_%03d.DATA", k))
        L = write_fracwell_deck(s, deck; bhp_schedule = fill(b, length(steps)), step_days = steps, active = active)
        o = run_deck(deck; prepare = c -> (s.conductivity_loss_per_psi > 0 && rock_regions!(c, L.rocknum); carry_state!(c, base.run.result; lowest_pressure = low)), kwarg...)
        for i in 1:n
            active[i] || continue
            w = Symbol(@sprintf("S%03d", i)); last(key, unit) = (q = well_series(o.result, w, key); isnothing(q) ? 0.0 : -q[end] * DAY / unit)
            oil[k] += last(:orat, STB); gas[k] += last(:grat, MSCF); water[k] += last(:wrat, STB)
        end
    end
    return (bhp_psi = bhps, oil_stb_d = oil, gas_mscf_d = gas, water_stb_d = water, at_month = at_month, test_days = test_days)
end

"Straight-line interpolation through sorted points; the end values outside them."
function lin(xs, ys, x)
    x <= xs[1] && return float(ys[1])
    x >= xs[end] && return float(ys[end])
    j = searchsortedfirst(xs, x)
    return ys[j-1] + (x - xs[j-1]) / (xs[j] - xs[j-1]) * (ys[j] - ys[j-1])
end

"Rates on an inflow curve at bottom-hole pressure b (linear between its points; zero rate cannot go negative)."
function inflow_at(c, b)
    f(v) = max(lin(c.bhp_psi, v, b), 0.0)
    return (oil = f(c.oil_stb_d), gas = f(c.gas_mscf_d), water = f(c.water_stb_d))
end

"""
    nodal_point(curve, lift; node_psi, lift_gas_mscf_d = 0)

The bottom-hole pressure at which the inflow curve delivers what the tubing can carry to a top pressure of
`node_psi`. `lift` is a lift function from lift.jl. Of several intersections the one with the highest rate
is returned (the one a flowing well sits on). Returns `nothing` if the well cannot flow at any pressure on
the curve.
"""
function nodal_point(c, lift; node_psi, lift_gas_mscf_d = 0.0, nscan = 400)
    miss(b) = (q = inflow_at(c, b); b - lift(node_psi, q.oil, q.water, q.gas + lift_gas_mscf_d))     # positive: more pressure than the tubing needs
    lo = c.bhp_psi[1]; hi = c.bhp_psi[end]
    grid = range(lo, hi, length = nscan); prev = miss(grid[1])
    prev >= 0 && return (bhp_psi = lo, inflow_at(c, lo)..., lift_gas_mscf_d = lift_gas_mscf_d, at_curve_end = true)   # flows even at the lowest pressure tested
    for k in 2:nscan
        cur = miss(grid[k])
        if cur >= 0
            a = grid[k-1]; b = grid[k]
            for _ in 1:60
                m = 0.5 * (a + b)
                miss(m) >= 0 ? (b = m) : (a = m)
            end
            x = 0.5 * (a + b)
            return (bhp_psi = x, inflow_at(c, x)..., lift_gas_mscf_d = lift_gas_mscf_d, at_curve_end = false)
        end
        prev = cur
    end
    return nothing
end

"""
    gaslift_curve(curve, lift; node_psi, gas_rates_mscf_d)

Oil rate at the nodal point for each lift-gas rate (zero where the well cannot flow).
"""
function gaslift_curve(c, lift; node_psi, gas_rates_mscf_d)
    oil = [(p = nodal_point(c, lift; node_psi = node_psi, lift_gas_mscf_d = g); isnothing(p) ? 0.0 : p.oil) for g in gas_rates_mscf_d]
    return (gas_mscf_d = collect(Float64, gas_rates_mscf_d), oil_stb_d = oil)
end

"""
    allocate_lift_gas(curves, total_mscf_d; step_mscf_d = total_mscf_d / 200)

Split `total_mscf_d` of lift gas between wells for the most oil. `curves` is one (gas_mscf_d, oil_stb_d)
pair per well, as returned by `gaslift_curve`. Gas is handed out in small steps, each to the well that gains
the most oil from it, and the hand-out stops when no well gains. This reaches the best split when each
well's curve bends over smoothly (gains shrinking as gas is added); for a well that needs a minimum of gas
before it flows at all, it can stop short of the best split.
"""
function allocate_lift_gas(curves, total_mscf_d; step_mscf_d = total_mscf_d / 200)
    n = length(curves); g = zeros(n)
    oil(i, x) = lin(curves[i].gas_mscf_d, curves[i].oil_stb_d, x)
    left = total_mscf_d
    while left > 1e-9
        d = min(step_mscf_d, left)
        gains = [g[i] + d <= curves[i].gas_mscf_d[end] ? oil(i, g[i] + d) - oil(i, g[i]) : -Inf for i in 1:n]
        best = argmax(gains)
        gains[best] > 0 || break
        g[best] += d; left -= d
    end
    return (gas_mscf_d = g, oil_stb_d = [oil(i, g[i]) for i in 1:n], total_oil_stb_d = sum(oil(i, g[i]) for i in 1:n), unused_mscf_d = left)
end
