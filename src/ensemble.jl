# Uncertainty runs over geology draws (P10/P50/P90) and decline-curve (Arps) fitting of any forecast.
# (stream 3, 2026-11-10)
#
# ---- decline curves -----------------------------------------------------------------------------------
# Conventions, the same as the user's `arps-core` package (read there, not imported):
#   - time `t` is elapsed time from the curve's anchor. Here the unit is the MONTH (30.4375 days) unless the
#     caller uses another unit consistently for every argument.
#   - `D` is the NOMINAL decline at the anchor, 1 / (time unit): D = -(dq/dt) / q at t = 0. It is not the
#     effective (secant) decline over a year. Nominal declines change unit like a frequency: `arps_convert_decline`.
#   - `qi` is the rate at the anchor in volume per time unit (stb per month for a monthly series in stb).
#   - the volume of an interval is the exact integral of the rate over it, never a point rate times a duration.
#   q(t) = qi (1 + b D t)^(-1/b);  b = 0 exponential, 0 < b < 1 hyperbolic, b = 1 harmonic, b > 1 transient flow.
# Terminal decline (the "modified hyperbolic"): the decline D / (1 + b D t) may not fall below `terminal_decline`;
# from the time it gets there the curve is exponential at that decline. If the decline at the anchor is already
# below it, the curve is exponential at the terminal decline from the start (a floor, as in common practice).
# The terminal decline is imposed by the user, not fitted.
# Not here: choice of the fit window or of the peak month, outlier handling, probabilistic (P10/P90) declines,
# segments, rate-transient analysis.

const ARPS_B_EXP = 1e-12          # below this b the curve is taken as exactly exponential
const ARPS_B_HARMONIC = 1e-12     # |b - 1| below this uses the harmonic cumulative

"Nominal decline per `from` to per `to` (:day, :month = 30.4375 days, :year = 365.25 days)."
function arps_convert_decline(D, from::Symbol, to::Symbol)
    days = (day = 1.0, month = MONTH_DAYS, year = 12 * MONTH_DAYS)
    return D * days[to] / days[from]
end

arps_plain_rate(t, qi, D, b) = b < ARPS_B_EXP ? qi * exp(-D * t) : qi * exp(-log1p(b * D * t) / b)

function arps_plain_cumulative(t, qi, D, b)
    x = D * t
    b < ARPS_B_EXP && return -(qi / D) * expm1(-x)
    e = 1.0 - b
    abs(e) < ARPS_B_HARMONIC && return (qi / D) * log1p(x)
    return -(qi / (e * D)) * expm1(-(e / b) * log1p(b * x))
end

"""
Time at which the curve becomes exponential at `terminal_decline` (Inf if never, 0 if the decline at the anchor is
already at or below it).
"""
function arps_switch_time(D, b, terminal_decline)
    (isnothing(terminal_decline) || terminal_decline <= 0) && return Inf
    D <= terminal_decline && return 0.0
    b < ARPS_B_EXP && return Inf                      # an exponential's decline never falls
    return (D / terminal_decline - 1) / (b * D)
end

"Rate at elapsed time `t` (same unit as 1/D). `terminal_decline` is nominal, in the same unit as `D`."
function arps_rate(t, qi, D, b; terminal_decline = nothing)
    ts = arps_switch_time(D, b, terminal_decline)
    t <= ts && return arps_plain_rate(t, qi, D, b)
    return arps_plain_rate(ts, qi, D, b) * exp(-terminal_decline * (t - ts))
end

"Volume produced from the anchor to elapsed time `t`: the exact integral of the rate."
function arps_cumulative(t, qi, D, b; terminal_decline = nothing)
    ts = arps_switch_time(D, b, terminal_decline)
    t <= ts && return arps_plain_cumulative(t, qi, D, b)
    return arps_plain_cumulative(ts, qi, D, b) - (arps_plain_rate(ts, qi, D, b) / terminal_decline) * expm1(-terminal_decline * (t - ts))
end

"Volumes produced in the consecutive intervals between `edges` (elapsed times from the anchor)."
arps_interval_volumes(edges, qi, D, b; terminal_decline = nothing) =
    [arps_cumulative(edges[k+1], qi, D, b; terminal_decline = terminal_decline) - arps_cumulative(edges[k], qi, D, b; terminal_decline = terminal_decline) for k in 1:length(edges)-1]

"""
    arps_eur(qi, D, b; limit_rate = nothing, limit_time = nothing, terminal_decline = nothing)

Volume produced from the anchor until the rate falls to `limit_rate` (same unit as `qi`) or until `limit_time`
(same unit as 1/D), whichever comes first; by closed form. With neither limit the volume to infinite time is
returned if it is finite (b < 1, or a terminal decline); otherwise it is an error, because the curve has no end.
Returns the volume, the time the limit is reached, and which limit it was (:rate, :time or :none).
"""
function arps_eur(qi, D, b; limit_rate = nothing, limit_time = nothing, terminal_decline = nothing)
    ts = arps_switch_time(D, b, terminal_decline)
    t_rate = Inf
    if !isnothing(limit_rate)
        limit_rate > 0 || error("arps_eur: limit_rate must be positive")
        if limit_rate >= qi
            t_rate = 0.0
        else
            t_rate = b < ARPS_B_EXP ? log(qi / limit_rate) / D : expm1(b * log(qi / limit_rate)) / (b * D)
            if t_rate > ts                                # the limit is reached on the exponential tail
                t_rate = ts + log(arps_plain_rate(ts, qi, D, b) / limit_rate) / terminal_decline
            end
        end
    end
    t_time = isnothing(limit_time) ? Inf : Float64(limit_time)
    t_end = min(t_rate, t_time)
    if isfinite(t_end)
        return (volume = arps_cumulative(t_end, qi, D, b; terminal_decline = terminal_decline), time = t_end, limit = t_rate <= t_time ? :rate : :time)
    end
    if isfinite(ts)
        return (volume = arps_plain_cumulative(ts, qi, D, b) + arps_plain_rate(ts, qi, D, b) / terminal_decline, time = Inf, limit = :none)
    end
    b < ARPS_B_EXP && return (volume = qi / D, time = Inf, limit = :none)
    b < 1 - ARPS_B_HARMONIC && return (volume = qi / ((1 - b) * D), time = Inf, limit = :none)
    error("arps_eur: a curve with b >= 1 never ends; give limit_rate, limit_time or terminal_decline")
end

# Least squares in a few bounded unknowns (Levenberg-Marquardt, differences for the slopes). An unknown that sits on a
# bound with the slope pushing it outward is held there for the step. Small and plain on purpose: no package is added.
function bounded_least_squares(resid, u0, lo, hi; max_iter = 400)
    u = clamp.(Float64.(u0), lo, hi); p = length(u)
    r = resid(u); cost = sum(abs2, r); lam = 1e-3
    function slopes(u, r)
        J = zeros(length(r), p)
        for i in 1:p
            h = 1e-6 * max(1.0, abs(u[i]))
            up = min(u[i] + h, hi[i]); dn = max(u[i] - h, lo[i])
            up > dn || continue
            a = copy(u); a[i] = up; b = copy(u); b[i] = dn
            J[:, i] = (resid(a) .- resid(b)) ./ (up - dn)
        end
        return J
    end
    converged = false
    for it in 1:max_iter
        J = slopes(u, r); g = J' * r
        free = [i for i in 1:p if !((u[i] <= lo[i] && g[i] > 0) || (u[i] >= hi[i] && g[i] < 0))]
        (isempty(free) || maximum(abs, g[free]) <= 1e-14 * (1 + cost)) && (converged = true; break)
        A = J[:, free]' * J[:, free]; accepted = false
        for _ in 1:40
            M = copy(A)
            for i in 1:size(M, 1)
                M[i, i] += lam * max(A[i, i], 1e-30)
            end
            step = -(M \ g[free])
            un = copy(u); un[free] .= clamp.(u[free] .+ step, lo[free], hi[free])
            rn = resid(un); cn = all(isfinite, rn) ? sum(abs2, rn) : Inf
            if cn < cost
                small = cost - cn <= 1e-15 * cost || maximum(abs.(un .- u) ./ (1 .+ abs.(u))) <= 1e-13
                u = un; r = rn; cost = cn; lam = max(lam / 3, 1e-12); accepted = true
                small && (converged = true)
                break
            end
            lam *= 4
        end
        (!accepted || converged || cost <= 1e-28) && (converged = true; break)
    end
    return (u = u, residuals = r, cost = cost, converged = converged)
end

"""
    arps_fit(volumes; edges = 0:length(volumes), mask = nothing, weights = nothing, b_bounds = (0.0, 2.0), fix_b = nothing,
             D_bounds = (1e-5, 50.0))

Fit an Arps curve to the volumes produced in consecutive intervals (`volumes[k]` between `edges[k]` and
`edges[k+1]`, elapsed time from the curve's anchor; by default whole months counted from the first one given).
The curve's interval volumes (exact integrals) are matched to the observed ones by least squares on their
LOGARITHMS: every interval then counts by its relative error, so the late, low months that decide the long-term
forecast are not drowned out by the first few high ones. Volumes that are zero or negative cannot be used that way:
mask them (`mask[k] = false` leaves interval k out but keeps its place in time) or it is an error.
`fix_b` holds b at a value (0 for an exponential fit). `D` is nominal, per unit of `edges`.

Returns `qi`, `D`, `b`, the fitted interval volumes, the root-mean-square and largest log residual (0.05 means about
5%), which unknowns ended on a bound, the number of intervals used and whether the search converged.
For every pair (D, b) tried the best `qi` is known in closed form, so the search is over D and b only; it is started
from several values of b and D and the best result kept.
"""
function arps_fit(volumes; edges = 0:length(volumes), mask = nothing, weights = nothing, b_bounds = (0.0, 2.0), fix_b = nothing, D_bounds = (1e-5, 50.0))
    v = Float64.(collect(volumes)); e = Float64.(collect(edges)); n = length(v)
    length(e) == n + 1 || error("arps_fit: edges must have one more entry than volumes")
    m = isnothing(mask) ? trues(n) : collect(Bool, mask); w = isnothing(weights) ? ones(n) : Float64.(collect(weights))
    use = findall(m)
    any(v[k] <= 0 for k in use) && error("arps_fit: zero or negative volume in the fit; mask it or choose another window")
    nfree = isnothing(fix_b) ? 3 : 2
    length(use) >= nfree || error("arps_fit: $(length(use)) intervals cannot determine $nfree unknowns")
    y = log.(v[use]); ww = w[use]; sw = sum(abs2, ww)
    unit(D, b) = [log(max(arps_plain_cumulative(e[k+1], 1.0, D, b) - arps_plain_cumulative(e[k], 1.0, D, b), 1e-300)) for k in use]
    logqi(g) = sum(ww .^ 2 .* (y .- g)) / sw
    unpack(u) = (exp(u[1]), isnothing(fix_b) ? u[2] : Float64(fix_b))
    function resid(u)
        D, b = unpack(u); g = unit(D, b)
        return ww .* (logqi(g) .+ g .- y)
    end
    lo = isnothing(fix_b) ? [log(D_bounds[1]), b_bounds[1]] : [log(D_bounds[1])]
    hi = isnothing(fix_b) ? [log(D_bounds[2]), b_bounds[2]] : [log(D_bounds[2])]
    mid = [(e[k] + e[k+1]) / 2 for k in use]; mean_rate = [v[k] / (e[k+1] - e[k]) for k in use]
    slope = max(-(log(mean_rate[end]) - log(mean_rate[1])) / max(mid[end] - mid[1], 1e-12), 10 * D_bounds[1])
    b_starts = isnothing(fix_b) ? [b for b in (0.0, 0.5, 1.0, 1.5, 2.0) if b_bounds[1] <= b <= b_bounds[2]] : [Float64(fix_b)]
    isempty(b_starts) && (b_starts = [(b_bounds[1] + b_bounds[2]) / 2])
    best = nothing; starts = 0
    for b0 in b_starts, mult in (1.0, 10.0, 100.0)
        D0 = clamp(slope * mult, 1.01 * D_bounds[1], 0.99 * D_bounds[2])
        u0 = isnothing(fix_b) ? [log(D0), b0] : [log(D0)]
        r = bounded_least_squares(resid, u0, lo, hi); starts += 1
        all(isfinite, r.residuals) && (isnothing(best) || r.cost < best.cost) && (best = r)
    end
    isnothing(best) && error("arps_fit: no start gave a finite fit")
    D, b = unpack(best.u); qi = exp(logqi(unit(D, b)))
    tol = 1e-6 .* (hi .- lo); names = isnothing(fix_b) ? (:D, :b) : (:D,)
    at_bound = Dict(names[i] => (best.u[i] - lo[i] < tol[i] ? :lower : hi[i] - best.u[i] < tol[i] ? :upper : :none) for i in eachindex(names))
    res = best.residuals
    return (qi = qi, D = D, b = b, fitted_volumes = arps_interval_volumes(e, qi, D, b), rms_log_residual = sqrt(sum(abs2, res) / length(res)),
        max_log_residual = maximum(abs, res), at_bound = at_bound, intervals_used = length(use), starts = starts, converged = best.converged, edges = e)
end

"""
    arps_forecast(fit, edges; terminal_decline = nothing)

Volumes of the fitted curve in the intervals between `edges` (elapsed time from the fit's anchor, so `0:120`
gives ten years of months including the fitted ones).
"""
arps_forecast(fit, edges; terminal_decline = nothing) = arps_interval_volumes(Float64.(collect(edges)), fit.qi, fit.D, fit.b; terminal_decline = terminal_decline)

# ---- uncertainty runs -------------------------------------------------------------------------------------
# One well design, many versions of what is not known. A `builder` turns a draw number (seed) into a complete
# fractured-well spec; every draw is run and the spread of the answers is summarised.
# Convention for P10 / P50 / P90: Pxx is the value that is EXCEEDED with xx% probability, so P90 is the low case
# and P10 the high case (the reserves convention). Rule: the draws are sorted and the value is read by straight-line
# interpolation between neighbours at position (n - 1)(1 - xx/100) counted from the lowest (the usual spreadsheet
# rule). With few draws P10 and P90 are close to the extremes and move a lot from one set of seeds to another.
# Not here: sampling schemes other than one run per seed, history-match weighting, conditioning the geology to wells,
# economics. The draws run one after another in one process.

"""
    exceedance_value(values, probability)

The value exceeded with the given probability (0.9 for P90, the low case), by interpolation between the sorted
values at position (n - 1)(1 - probability).
"""
function exceedance_value(values, probability)
    0 <= probability <= 1 || error("exceedance_value: probability must be between 0 and 1")
    s = sort(Float64.(collect(values))); n = length(s)
    n >= 1 || error("exceedance_value: no values")
    pos = (n - 1) * (1 - probability); i = floor(Int, pos); f = pos - i
    return i + 1 >= n ? s[n] : s[i+1] + f * (s[i+2] - s[i+1])
end

"P90 (low), P50, P10 (high), mean, lowest and highest of a set of outcomes, and the spread (P10 - P90) / P50."
function spread_summary(values)
    p90 = exceedance_value(values, 0.9); p50 = exceedance_value(values, 0.5); p10 = exceedance_value(values, 0.1)
    return (p90 = p90, p50 = p50, p10 = p10, mean = sum(values) / length(values), low = minimum(values), high = maximum(values),
        spread = p50 != 0 ? (p10 - p90) / p50 : NaN)
end

"A copy of a fractured-well spec with some fields replaced."
respec(s::FracWellSpec; kw...) = FracWellSpec(; (f => getfield(s, f) for f in fieldnames(FracWellSpec))..., kw...)

"""
    geology_builder(base; geology, origin_ft, azimuth_deg = 0.0)

A builder for `run_ensemble`: draw `seed` gives the `base` spec placed in a `synthetic_geology` made with that seed.
`geology` holds the other arguments of `synthetic_geology` (grid, variogram range, means and spreads); `origin_ft`
and `azimuth_deg` place the well on the map as in `well_maps`. The spec's thickness becomes the largest gross
thickness of the draw, as the maps need.
"""
function geology_builder(base::FracWellSpec; geology, origin_ft, azimuth_deg = 0.0)
    return function (seed)
        g = synthetic_geology(; geology..., seed = seed)
        return respec(base; thickness_ft = maximum(g.fields[:gross_ft].values), well_maps(g; origin_ft = origin_ft, azimuth_deg = azimuth_deg, width_ft = base.width_ft)...)
    end
end

"""
    run_ensemble(builder, seeds; level = :screening, outdir = nothing)

Run one fractured-well model per seed (`builder(seed)` returns its spec; anything may differ from draw to draw:
rock, fracture lengths, conductivity) and summarise the spread. `level` is the run mode of `fast_spec`
(`:screening`, `:fast`, or `nothing` to run each spec as given). The same seeds give the same answer.
Returns per draw the monthly oil of the whole well (months by draws) and the cumulative oil and gas; P90 / P50 / P10
and mean of the final cumulative oil; and P90 / P50 / P10 of cumulative oil at the end of every month. Those
monthly curves are read month by month across the draws: no single draw need follow one of them.
"""
function run_ensemble(builder, seeds; level = :screening, outdir = nothing)
    seeds = collect(seeds); n = length(seeds); n >= 1 || error("run_ensemble: no seeds")
    monthly = nothing; monthly_gas = nothing; monthly_water = nothing; gas = zeros(n); specs = Any[]
    t = @elapsed for (j, seed) in enumerate(seeds)
        s = builder(seed); isnothing(level) || (s = fast_spec(s; level = level))
        r = isnothing(outdir) ? run_fracwell(s) : run_fracwell(s; outdir = joinpath(outdir, "draw_$(seed)"))
        isnothing(monthly) && (monthly = zeros(s.months, n); monthly_gas = zeros(s.months, n); monthly_water = zeros(s.months, n))
        size(monthly, 1) == s.months || error("run_ensemble: every draw must run the same number of months")
        monthly[:, j] = vec(sum(r.monthly_oil_stb, dims = 2)); gas[j] = sum(r.monthly_gas_mscf); push!(specs, s)
        monthly_gas[:, j] = vec(sum(r.monthly_gas_mscf, dims = 2)); monthly_water[:, j] = vec(sum(r.monthly_water_stb, dims = 2))
    end
    cum = cumsum(monthly, dims = 1); final = vec(cum[end, :]); sm = spread_summary(final)
    by_month(p) = [exceedance_value(view(cum, m, :), p) for m in 1:size(cum, 1)]
    return (seeds = seeds, monthly_oil_stb = monthly, monthly_gas_mscf = monthly_gas, monthly_water_stb = monthly_water, cum_oil_stb = final, cum_gas_mscf = gas, p90_stb = sm.p90, p50_stb = sm.p50, p10_stb = sm.p10, mean_stb = sm.mean,
        low_stb = sm.low, high_stb = sm.high, spread = sm.spread, cum_by_month_p90 = by_month(0.9), cum_by_month_p50 = by_month(0.5), cum_by_month_p10 = by_month(0.1),
        specs = specs, wall_seconds = t)
end
