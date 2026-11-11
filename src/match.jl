# History matching: fit a fractured-well model to a production history, and say how well the data pin each number down.
# (stream 5, 2026-11-10)
#
# Three parts:
#   fit        chosen inputs of a FracWellSpec are varied within stated bounds until the model's monthly volumes follow
#              the history. The misfit is the root mean square of log(model / history), every month counting the same:
#              rates fall by orders of magnitude over a well's life, and a 5% miss matters as much late as early.
#   how sure   at the best fit, the slopes of every month's log volume against the log of every input are taken apart
#              (singular values). Each direction is a product of powers of the inputs; the data fix a direction to
#              (noise in the data) / (its singular value). A history that is all linear flow fixes
#              half-length x sqrt(permeability) and says almost nothing about either alone; that comes out here as one
#              well-fixed product and one loose one, with the numbers.
#   forecast   the loosest direction is walked in both senses, re-fitting the others at every step, for as long as the
#              misfit stays within what the noise allows; every other direction gets one set at each end of what the
#              noise allows (a long history leaves no loose direction, and the forecast's uncertainty is then all in the
#              well-fixed ones). Every such set of inputs fits the history as well as the best one does; the forecast is
#              run for each and the spread reported.
# All fitting is done in the logarithm of the inputs. Not here: more than one loose direction at a time (only the loosest
# is walked), inputs that are not positive numbers, weights by month, any prior knowledge beyond the bounds, gradients
# from the engine's adjoint (slopes are taken by differences, one run per input), and uncertainty in what is NOT fitted
# (conductivity, thickness, fluid): the spread reported is only as wide as the inputs you chose to vary allow.

struct MatchInput
    name::String
    low::Float64
    high::Float64
    start::Float64
    apply::Any                  # (spec, value) -> spec
end

"""
    match_input(field; low, high, start = sqrt(low * high), name = string(field), apply = nothing)

An input to vary in a history match: a field of `FracWellSpec` (a number, or a per-stage list that is set to the
same value for every stage), between `low` and `high` (both positive), starting from `start`. For anything else
give `apply = (spec, value) -> spec`, for example a multiplier on every stage's own half-length.
"""
function match_input(field::Symbol; low, high, start = sqrt(low * high), name = String(field), apply = nothing)
    0 < low < high || error("match_input $name: need 0 < low < high")
    low <= start <= high || error("match_input $name: start must lie between low and high")
    f = apply
    if isnothing(f)
        hasfield(FracWellSpec, field) || error("match_input: FracWellSpec has no field $field; give `apply`")
        T = fieldtype(FracWellSpec, field)
        f = T == Float64 ? ((s, v) -> respec(s; Dict(field => Float64(v))...)) :
            T == Vector{Float64} ? ((s, v) -> respec(s; Dict(field => fill(Float64(v), length(s.positions_ft)))...)) :
            error("match_input: field $field is neither a number nor a per-stage list of numbers; give `apply`")
    end
    return MatchInput(name, Float64(low), Float64(high), Float64(start), f)
end

"The spec with a set of input values put in."
function matched_spec(base::FracWellSpec, inputs::Vector{MatchInput}, values)
    s = base
    for (x, v) in zip(inputs, values)
        s = x.apply(s, v)
    end
    return s
end

"""
    simulate_history(spec; level = :screening, months = spec.months, bhp_psi_monthly = nothing)

Monthly oil (stb) and gas (Mscf) of the whole well. `level` is the run mode of `fast_spec` (`nothing`: the spec as
given). `bhp_psi_monthly`: a flowing bottom-hole pressure for every month, in place of the spec's single value.
"""
function simulate_history(spec::FracWellSpec; level = :screening, months = spec.months, bhp_psi_monthly = nothing)
    s = respec(spec; months = months); isnothing(level) || (s = fast_spec(s; level = level))
    if isnothing(bhp_psi_monthly)
        r = run_fracwell(s)
    else
        length(bhp_psi_monthly) >= months || error("simulate_history: bhp_psi_monthly needs a value for every month")
        t_end = cumsum(fracwell_tstep(s))
        r = run_fracwell(s; bhp_schedule = [Float64(bhp_psi_monthly[clamp(ceil(Int, (t - 1e-6) / MONTH_DAYS), 1, months)]) for t in t_end])
    end
    return (oil_stb = vec(sum(r.monthly_oil_stb, dims = 2)), gas_mscf = vec(sum(r.monthly_gas_mscf, dims = 2)))
end

"A history with measurement noise: every value multiplied by exp(sd x a standard normal draw). The same seed gives the same history."
function noisy_history(volumes; sd, seed = 1)
    rng = Random.MersenneTwister(seed)
    return [v * exp(sd * randn(rng)) for v in volumes]
end

"Root mean square of log(model / history) over the months where the history is positive (and `mask` is true)."
function history_misfit(model, history; mask = nothing)
    use = [i for i in eachindex(history) if history[i] > 0 && (isnothing(mask) || mask[i])]
    return sqrt(sum(log(model[i] / history[i])^2 for i in use) / length(use))
end

# Least squares in a few bounded unknowns where one evaluation is a simulator run: Levenberg-Marquardt with slopes from
# forward differences of a LARGE step (`step`, in the unknowns' own units, here logarithms: 0.05 is 5%). The model's answer
# is not perfectly smooth in its inputs (the mesh changes its row count as a fracture lengthens), and a small step would
# measure that roughness instead of the trend.
function match_least_squares(resid, u0, lo, hi; step = 0.05, max_iterations = 15, x_tolerance = 2e-3)
    u = clamp.(Float64.(u0), lo, hi); p = length(u)
    r = resid(u); cost = sum(abs2, r); lam = 1e-2; its = 0; converged = false
    for it in 1:max_iterations
        its = it
        J = zeros(length(r), p)
        for j in 1:p
            h = u[j] + step <= hi[j] ? step : -step
            a = copy(u); a[j] = clamp(u[j] + h, lo[j], hi[j])
            a[j] == u[j] && continue
            J[:, j] = (resid(a) .- r) ./ (a[j] - u[j])
        end
        g = J' * r; A = J' * J; accepted = false; small = false
        for _ in 1:8
            M = copy(A)
            for j in 1:p
                M[j, j] += lam * max(A[j, j], 1e-12)
            end
            du = -(M \ g)
            un = clamp.(u .+ du, lo, hi)
            rn = resid(un); cn = all(isfinite, rn) ? sum(abs2, rn) : Inf
            if cn < cost
                small = maximum(abs.(un .- u)) < x_tolerance || cost - cn < 1e-6 * cost
                u = un; r = rn; cost = cn; lam = max(lam / 5, 1e-6); accepted = true
                break
            end
            lam *= 5
        end
        if !accepted || small
            converged = true; break
        end
    end
    return (u = u, residuals = r, cost = cost, iterations = its, converged = converged)
end

"Point k of a Halton sequence in the unit box of dimension p: evenly spread starting points, the same every time."
function halton_point(k, p)
    primes = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29)
    p <= length(primes) || error("at most $(length(primes)) inputs")
    return map(1:p) do j
        b = primes[j]; f = 1.0; x = 0.0; i = k
        while i > 0
            f /= b; x += f * (i % b); i = div(i, b)
        end
        x
    end
end

"How far a number is fixed, in words: a percentage when it is tight, a factor when it is loose."
function fixed_words(log_sd)
    (isfinite(log_sd) && log_sd < 7) || return "not at all"          # beyond a factor of a thousand there is nothing to quote
    f = exp(log_sd)
    return f < 1.5 ? @sprintf("to within %.*f%%", f - 1 < 0.1 ? 1 : 0, 100 * (f - 1)) : @sprintf("only to within a factor of %.1f", f)
end

"A product of powers of the inputs, written out: `perm_md^0.50 x half_length_ft`."
function product_words(names, exponents)
    parts = String[]
    for (nm, e) in zip(names, exponents)
        abs(e) < 0.02 && continue
        push!(parts, abs(e - 1) < 0.005 ? nm : @sprintf("%s^%.2f", nm, e))
    end
    return join(parts, " x ")
end

"""
    fit_model(model, inputs, observed; mask = nothing, noise_sd = nothing, step = 0.05, max_iterations = 15, starts = 4)

The fit and the "how sure" report for any model: `model(values)` returns the predicted series (positive numbers, at
least as long as `observed`) for a list of input values in the order of `inputs`. See `match_history` for the
fractured-well form and for what is returned.
"""
function fit_model(model, inputs::Vector{MatchInput}, observed; mask = nothing, noise_sd = nothing, step = 0.05, max_iterations = 15, x_tolerance = 2e-3, starts = 4)
    obs = Float64.(collect(observed)); n = length(obs); p = length(inputs)
    use = [i for i in 1:n if obs[i] > 0 && (isnothing(mask) || mask[i])]
    length(use) >= p || error("fit_model: $(length(use)) usable observations cannot fix $p inputs")
    lo = [log(x.low) for x in inputs]; hi = [log(x.high) for x in inputs]; u0 = [log(x.start) for x in inputs]
    runs = Ref(0); cache = Dict{Vector{Float64}, Vector{Float64}}()
    function resid(u)
        get!(cache, round.(u, digits = 12)) do
            runs[] += 1
            pred = model(exp.(u))
            length(pred) >= n || error("fit_model: the model returned $(length(pred)) values for $n observations")
            [pred[i] > 0 ? log(pred[i] / obs[i]) : -50.0 for i in use]      # a model that produces nothing is very wrong, not an error
        end
    end
    # The misfit can have more than one valley (a fracture as long as the model is wide behaves differently from a short one in
    # better rock, yet can fit the early months as well). So the search is started from several places: the start asked for,
    # then points spread evenly through the bounds, the same ones every time. The best ending wins; all are reported.
    tried = map(1:starts) do k
        g = match_least_squares(resid, k == 1 ? u0 : lo .+ halton_point(k - 1, p) .* (hi .- lo), lo, hi; step = step, max_iterations = max_iterations, x_tolerance = x_tolerance)
        (values = exp.(g.u), misfit = sqrt(g.cost / length(use)), iterations = g.iterations, converged = g.converged, fit = g)
    end
    f = tried[argmin([t.misfit for t in tried])].fit
    u = f.u; m = sqrt(f.cost / length(use))
    on_bound = [inputs[j].name for j in 1:p if u[j] <= lo[j] + 1e-9 || u[j] >= hi[j] - 1e-9]
    # slopes at the best fit, by central differences where the bounds allow
    J = zeros(length(use), p)
    for j in 1:p
        a = copy(u); b = copy(u); a[j] = min(u[j] + step, hi[j]); b[j] = max(u[j] - step, lo[j])
        a[j] > b[j] && (J[:, j] = (resid(a) .- resid(b)) ./ (a[j] - b[j]))
    end
    F = LinearAlgebra.svd(J); sv = F.S; V = Matrix(F.V)
    sigma = Float64(something(noise_sd, max(m, 0.02)))
    names = [x.name for x in inputs]
    tiny = 1e-12 * max(sv[1], 1e-300)
    cov = zeros(p, p)
    for k in 1:p
        cov .+= (sigma / max(sv[k], tiny))^2 .* (V[:, k] * V[:, k]')
    end
    combos = map(1:p) do k
        jm = argmax(abs.(V[:, k])); e = V[:, k] ./ V[jm, k]
        sd = sv[k] > tiny ? sigma / sv[k] / abs(V[jm, k]) : Inf
        (exponents = e, singular_value = sv[k], log_sd = sd, product = product_words(names, e),
            text = "the history fixes " * product_words(names, e) * " " * fixed_words(sd))
    end
    alone = map(1:p) do j
        sd = sqrt(cov[j, j]); room = hi[j] - lo[j]; limited = !(sd < room / 2)
        (name = names[j], log_sd = sd, limited_by_bounds = limited,
            text = limited ? @sprintf("%s alone is not fixed by the history (%s); only its bounds, %.3g to %.3g, hold it", names[j], fixed_words(sd), inputs[j].low, inputs[j].high) :
                names[j] * " alone is fixed " * fixed_words(sd))
    end
    corr = [cov[i, j] / sqrt(cov[i, i] * cov[j, j]) for i in 1:p, j in 1:p]
    statements = vcat([c.text for c in combos], [a.text for a in alone])
    isempty(on_bound) || push!(statements, "the best fit sits on the bound of " * join(on_bound, " and ") * ": widen the bound or distrust the answer")
    return (values = exp.(u), log_values = u, misfit = m, observations_used = length(use), iterations = f.iterations, runs = runs[], converged = f.converged,
        jacobian = J, singular_values = sv, directions = V, combinations = combos, inputs_alone = alone, correlation = corr, noise_sd = sigma,
        statements = statements, inputs = inputs, low = lo, high = hi, residuals = resid, step = step, run_counter = runs, on_bound = on_bound,
        starts = [(values = t.values, misfit = t.misfit, iterations = t.iterations) for t in tried])
end

"""
    equally_good(fit; level = 4.0, step = 0.15, max_steps = 25)

Sets of input values that fit the history as well as the best one: the loosest direction of `fit` is walked both
ways in steps of `step` (in logarithm; 0.15 is 15%), the other directions re-fitted at every step, until the misfit
rises above `threshold` = sqrt(best misfit^2 + level x noise^2 / observations) (level 4: about two standard
deviations for one direction) or a bound is reached. The other, better-fixed directions each add two sets, one at
either end of the same allowance (straight along the direction, no re-fitting). Returns the sets (best fit included),
each with its misfit and its `direction` (the last one is the loosest), the threshold, and for every input the range
it covers.
"""
function equally_good(fit; level = 4.0, step = 0.15, max_steps = 25)
    p = length(fit.inputs); u0 = fit.log_values; lo = fit.low; hi = fit.high; n = fit.observations_used
    threshold = sqrt(fit.misfit^2 + level * fit.noise_sd^2 / n)
    v = fit.directions[:, p]; W = fit.directions[:, 1:p-1]
    mis(u) = sqrt(sum(abs2, fit.residuals(u)) / n)
    inside(u) = all(lo .- 1e-9 .<= u .<= hi .+ 1e-9)
    function along(s, w0)                           # best point with the loose coordinate held at s
        p == 1 && return (u0 .+ s .* v, zeros(0))
        point(w) = u0 .+ s .* v .+ W * w
        g = match_least_squares(w -> inside(point(w)) ? fit.residuals(point(w)) : fill(1e3, n), w0, fill(-20.0, p - 1), fill(20.0, p - 1);
            step = fit.step, max_iterations = 6)
        return (point(g.u), g.u)
    end
    sets = [(values = exp.(u0), misfit = fit.misfit, along = 0.0, direction = p)]
    for sgn in (-1.0, 1.0)
        w = zeros(p - 1); last_good = 0.0
        for k in 1:max_steps
            s = sgn * k * step
            u, wn = along(s, w)
            if !inside(u) || mis(u) > threshold     # too far: look once for the edge between the last good step and this one
                a = last_good; b = s
                for _ in 1:3
                    c = 0.5 * (a + b); uc, wc = along(c, w)
                    if inside(uc) && mis(uc) <= threshold
                        a = c; w = wc; push!(sets, (values = exp.(uc), misfit = mis(uc), along = c, direction = p))
                    else
                        b = c
                    end
                end
                break
            end
            w = wn; last_good = s; push!(sets, (values = exp.(u), misfit = mis(u), along = s, direction = p))
        end
    end
    sort!(sets, by = x -> x.along)
    loose_first = sets[1]; loose_last = sets[end]
    # the better-fixed directions: to the end of the allowance by the slopes at the best fit, pulled in if the model disagrees
    for k in 1:p-1, sgn in (-1.0, 1.0)
        sk = fit.singular_values[k]; sk > 0 || continue
        s = sgn * sqrt(level) * fit.noise_sd / sk
        for _ in 1:5
            u = u0 .+ s .* fit.directions[:, k]
            if inside(u) && mis(u) <= 1.02 * threshold
                push!(sets, (values = exp.(u), misfit = mis(u), along = s, direction = k)); break
            end
            s *= 0.7
        end
    end
    names = [x.name for x in fit.inputs]
    ranges = [(name = names[j], low = minimum(x.values[j] for x in sets), high = maximum(x.values[j] for x in sets)) for j in 1:p]
    text = "fits as good as the best one run from " * join([@sprintf("%s = %.3g", r.name, loose_first.values[j]) for (j, r) in enumerate(ranges)], ", ") * " to " *
        join([@sprintf("%s = %.3g", r.name, loose_last.values[j]) for (j, r) in enumerate(ranges)], ", ")
    return (sets = sets, threshold = threshold, ranges = ranges, text = text, runs = fit.run_counter[])
end

"""
    match_history(base, inputs, oil_stb; gas_mscf = nothing, bhp_psi_monthly = nothing, level = :screening,
                  mask = nothing, noise_sd = nothing, step = 0.05, max_iterations = 15)

Fit a fractured-well model to a monthly history. `base` is the `FracWellSpec` with everything that is NOT fitted
(its `months` is ignored: the history's length is used); `inputs` is a list of `match_input`; `oil_stb` is the
well's oil by month, and `gas_mscf`, if given, is fitted with it (twice as many observations). Months with zero
or negative volume, or where `mask` is false, are left out. `bhp_psi_monthly` gives the flowing pressure of every
month if it was not constant. `level` is the run mode of `fast_spec` used for every run of the match.

The search is started from `starts` places (default 4: the inputs' own `start`, then points spread through the
bounds); `starts` in the result lists where each one ended, and the best is taken.

Returns `values` (the best fit, in the order of `inputs`), `spec` (the matched model), `misfit` (root mean square of
log(model / history)), `runs` (simulator runs spent), `on_bound` (inputs that ended on a bound), and the report on how sure the answer is, for data noise
`noise_sd` (given, or the larger of the misfit and 2%): `combinations` (products of powers of the inputs, best fixed
first, each with `log_sd` and a sentence), `inputs_alone` (each input by itself), `correlation`, `singular_values`,
and `statements` (all the sentences). Pass the result to `equally_good` and `match_forecast`.
"""
function match_history(base::FracWellSpec, inputs::Vector{MatchInput}, oil_stb; gas_mscf = nothing, bhp_psi_monthly = nothing, level = :screening, kwarg...)
    months = length(oil_stb)
    isnothing(gas_mscf) || length(gas_mscf) == months || error("match_history: gas_mscf must be as long as oil_stb")
    function model(values)
        h = simulate_history(matched_spec(base, inputs, values); level = level, months = months, bhp_psi_monthly = bhp_psi_monthly)
        return isnothing(gas_mscf) ? h.oil_stb : vcat(h.oil_stb, h.gas_mscf)
    end
    mask = get(kwarg, :mask, nothing)
    kw = (; (k => v for (k, v) in pairs(kwarg) if k != :mask)...)
    obs = isnothing(gas_mscf) ? Float64.(oil_stb) : vcat(Float64.(oil_stb), Float64.(gas_mscf))
    fit = fit_model(model, inputs, obs; mask = isnothing(mask) || isnothing(gas_mscf) ? mask : vcat(mask, mask), kw...)
    return merge(fit, (spec = matched_spec(base, inputs, fit.values), base = base, level = level, months = months, bhp_psi_monthly = bhp_psi_monthly))
end

"""
    match_forecast(match, months; sets = equally_good(match).sets, level = match.level, bhp_psi = nothing, max_sets = 9)

Forecast to `months` (from the start of the history) with every set of inputs in `sets` (those along the loose
direction thinned evenly to `max_sets`, both ends kept). Returns the cumulative oil
at the end for each set, `best_stb` for the best fit, the lowest and highest, P90 / P50 / P10 across the sets
(`spread_summary`; the sets are spaced evenly along the loose direction, not drawn at random, so read these as a
range, not as probabilities), and the monthly oil of every set. After the history the well flows at the spec's
`bhp_psi` (or `bhp_psi`, if given); a history with changing pressure is replayed first.
"""
function match_forecast(match, months; sets = nothing, level = match.level, bhp_psi = nothing, max_sets = 9)
    sets = isnothing(sets) ? equally_good(match).sets : sets
    nd = maximum(get(x, :direction, 1) for x in sets)
    loose = [x for x in sets if get(x, :direction, nd) == nd]; others = [x for x in sets if get(x, :direction, nd) != nd]
    if length(loose) > max_sets                     # along the loose direction: both ends always, the rest evenly between
        loose = loose[unique(round.(Int, range(1, length(loose), length = max_sets)))]
    end
    sets = vcat(loose, others)
    months >= match.months || error("match_forecast: the forecast must run at least to the end of the history ($(match.months) months)")
    function run(values)
        s = matched_spec(match.base, match.inputs, values)
        isnothing(bhp_psi) || (s = respec(s; bhp_psi = Float64(bhp_psi)))
        sched = isnothing(match.bhp_psi_monthly) ? nothing : vcat(Float64.(match.bhp_psi_monthly[1:match.months]), fill(s.bhp_psi, months - match.months))
        return simulate_history(s; level = level, months = months, bhp_psi_monthly = sched).oil_stb
    end
    monthly = [run(x.values) for x in sets]; cum = [sum(m) for m in monthly]
    best = sum(run(match.values)); sm = spread_summary(cum)
    return (cum_oil_stb = cum, best_stb = best, low_stb = sm.low, high_stb = sm.high, p90_stb = sm.p90, p50_stb = sm.p50, p10_stb = sm.p10,
        spread = (sm.high - sm.low) / best, monthly_oil_stb = monthly, sets = sets)
end
