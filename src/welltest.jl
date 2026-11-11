# Well tests on a fractured well: flow at a steady rate, shut in, and watch the pressure build up.
#
# `run_buildup` runs the test on the reservoir model (all stages on one well, so there is one bottom-hole
# pressure). `pressure_derivative` turns a pressure record into the log-log diagnostic a well-test
# analyst plots: the pressure change and its derivative against the logarithm of time. On that plot a
# fracture draining rock in straight lines shows a half slope, and boundaries show as the derivative
# rising above it.
#
# Not modelled: wellbore storage (the well has no volume, so the earliest part of a real test is missing),
# skin, and gauge noise. The rate during the flow period is held by the engine with the spec's
# `bhp_psi` as the lower limit; if the well cannot hold the rate the result says so.

"""
    run_buildup(spec; flow_days, shut_days, oil_rate_stb_d, first_step_days = 1e-4, steps_per_decade = 8)

Flow all stages together at `oil_rate_stb_d` for `flow_days`, then shut the well in for `shut_days`.
Returns the shut-in record (`hours` since shut-in, `pressure_psi`), the flowing pressure at shut-in,
the flow-period record (`flow_days_axis`, `flow_pressure_psi`, `flow_rate_stb_d`) and whether the rate
was held throughout. Time steps are spaced evenly in log time after each change of rate. The test model
uses fracture cells `test_fracture_width_ft` wide (same conductivity), thinner than a production model's.
"""
function run_buildup(s::FracWellSpec; flow_days, shut_days, oil_rate_stb_d, first_step_days = 1e-4, steps_per_decade = 25, test_fracture_width_ft = 0.02, outdir = mktempdir(), kwarg...)
    mkpath(outdir)
    # The fracture cells of a production model are wide (2 ft by default) and hold rock pore volume at the well's pressure. In tight rock
    # that acts like wellbore storage and hides the first days of a test, so the test model uses thin fracture cells.
    s.fracture_width_ft > test_fracture_width_ft && (s = FracWellSpec(; (f => getfield(s, f) for f in fieldnames(FracWellSpec))..., fracture_width_ft = test_fracture_width_ft))
    ladder(total) = begin                       # log-spaced end times from the first step to the total, turned into step lengths
        n = max(ceil(Int, steps_per_decade * log10(total / first_step_days)), 1)
        ends = [first_step_days * (total / first_step_days)^(k / n) for k in 0:n]
        vcat(ends[1], diff(ends))
    end
    flow = ladder(flow_days); shut = ladder(shut_days)
    # a shut-in well is given a rate too small to matter, so that the engine keeps reporting its pressure
    sched = vcat([(dt, oil_rate_stb_d) for dt in flow], [(dt, 1e-6 * oil_rate_stb_d) for dt in shut])
    deck = joinpath(outdir, uppercase(replace(s.name, r"[^A-Za-z0-9_]" => "_")) * "_BUILDUP.DATA")
    L = write_fracwell_deck(s, deck; single_well = true, rate_schedule = sched)
    o = run_deck(deck; prepare = s.conductivity_loss_per_psi > 0 ? (c -> rock_regions!(c, L.rocknum)) : nothing, kwarg...)
    res = o.result; t = res.time ./ DAY; p = well_series(res, :W1, :bhp) ./ PSI; q = -well_series(res, :W1, :orat) .* DAY ./ STB
    nf = length(flow)
    length(t) == length(sched) || error("run_buildup: the engine returned $(length(t)) report steps for $(length(sched)) asked")
    held = all(x -> abs(x / oil_rate_stb_d - 1) < 1e-3, view(q, 1:nf))
    return (hours = (t[nf+1:end] .- t[nf]) .* 24, pressure_psi = p[nf+1:end], flowing_pressure_psi = p[nf], flow_days_axis = t[1:nf], flow_pressure_psi = p[1:nf],
        flow_rate_stb_d = q[1:nf], rate_held = held, run = o, layout = L, deck = deck)
end

"""
    pressure_derivative(hours, pressure_psi; reference_psi, smoothing = 0.1)

The log-log diagnostic of a pressure record: `dp` = |pressure - reference| and `derivative` =
d(dp) / d(ln t), by the three-point weighted (Bourdet) formula with a window of `smoothing` log cycles.
For a buildup the reference is the flowing pressure at shut-in; for a drawdown, the initial pressure.
"""
function pressure_derivative(hours, pressure_psi; reference_psi, smoothing = 0.1)
    n = length(hours); dp = abs.(pressure_psi .- reference_psi); x = log.(hours); d = fill(NaN, n)
    for i in 2:n-1
        a = i - 1; while a > 1 && x[i] - x[a] < smoothing * log(10); a -= 1; end
        b = i + 1; while b < n && x[b] - x[i] < smoothing * log(10); b += 1; end
        d1 = (dp[i] - dp[a]) / (x[i] - x[a]); d2 = (dp[b] - dp[i]) / (x[b] - x[i])
        d[i] = (d1 * (x[b] - x[i]) + d2 * (x[i] - x[a])) / (x[b] - x[a])
    end
    return (hours = hours, dp = dp, derivative = d)
end

"""
Exact pressure drop at a plane that feeds straight-line (linear) flow at a constant rate into rock of
unlimited extent: dp = m sqrt(t). Returns m in psi per sqrt(day). `rate_stb_d` is the total rate,
`area_ft2` the total face area the flow enters through (both faces of every fracture), permeability in md,
viscosity in cp, total compressibility in 1/psi; `Bo` converts to reservoir volume.
"""
function linear_flow_slope(; rate_stb_d, area_ft2, perm_md, porosity, viscosity_cp, total_compressibility, Bo = 1.0)
    q = rate_stb_d * Bo * STB / DAY; A = area_ft2 * FT^2; k = perm_md * 1e-3 * DARCY; mu = viscosity_cp * 1e-3; ct = total_compressibility / PSI
    m_si = (2 * q * mu / (k * A)) * sqrt(k / (pi * porosity * mu * ct))          # Pa per sqrt(s)
    return m_si * sqrt(DAY) / PSI
end

"Exact shut-in pressure rise after linear flow at a constant rate for `tp` (same time unit as `dt`): m (sqrt(tp) + sqrt(dt) - sqrt(tp + dt))."
linear_buildup_rise(m, tp, dt) = m * (sqrt(tp) + sqrt(dt) - sqrt(tp + dt))
