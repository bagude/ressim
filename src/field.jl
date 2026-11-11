# Several fractured wells sharing a flowline, a separator and facility limits on oil and on gas.
#
# Every well produces through its own tubing into a common node. The node pressure is the separator
# pressure plus the shared flowline drop at the total liquid rate. Wells may sit in separate reservoir
# models (they then do not feel each other through the rock) or several in one model, side by side in
# the same rock (`well_of_stage` and `center_ft` of the model), where they interfere. Wells may come on
# in different months: a well that has not started has no fractures and no wellbore in its model.
# When total oil would exceed the facility limit, one of three allocation rules decides who is cut back:
#   :common_choke  the node pressure is raised until the total fits; the split follows the reservoirs
#   :pro_rata      every well is cut to the same fraction of what it could make this step
#   :priority      wells are filled in the order given; later wells get what is left
#
# How it is solved: all models march through time together. In every report step the node pressure is
# found by a bracketed search; each trial re-solves that one step for every model from a saved state.
# Inside a trial the tubing condition and any per-well rate limit are solved with the reservoir
# (see surface.jl). The two rules with per-well limits first solve the step unconstrained to get each
# well's potential, then solve it again with the limits. When a well starts, its model is rebuilt with
# the new fractures and the reservoir state is carried over.

"Number of wells a reservoir model holds (see `FracWellSpec.well_of_stage`)."
well_count(s::FracWellSpec) = isempty(s.well_of_stage) ? 1 : maximum(s.well_of_stage)

Base.@kwdef struct FieldSpec
    wells::Vector{FracWellSpec}                                     # reservoir models: one well each, or several wells in the same rock
    # the next four have one entry per WELL, in the order of the models and, within a model, of its well numbers
    tubing::Vector{Function} = Function[q -> 0.0 for _ in 1:sum(well_count, wells)]   # psi at liquid rate in stb/d
    lift::Vector{Any} = Any[nothing for _ in 1:sum(well_count, wells)]                # optional lift function (see SurfaceSpec)
    separator_psi::Float64 = 100.0
    line::Function = q -> 0.0                                       # shared flowline: psi at total liquid stb/d
    oil_cap_stb_d::Float64 = Inf                                    # facility limit on total oil
    gas_cap_mscf_d::Float64 = Inf                                   # facility limit on total gas (:common_choke only): the node pressure is raised until both limits hold
    allocation::Symbol = :common_choke                              # :common_choke | :pro_rata | :priority
    priority::Vector{Int} = collect(1:sum(well_count, wells))       # order in which wells are filled under :priority
    start_month::Vector{Int} = zeros(Int, sum(well_count, wells))   # month in which each well comes on
end

sim_snapshot(sim) = Dict(k => deepcopy(sim.storage[k].state0) for k in keys(sim.model.models))

function sim_restore!(sim, snap)
    Jutul.reset_previous_state!(sim, snap)          # previous state back to the start of the step
    Jutul.reset_state_to_previous_state!(sim)       # and the unknowns with it
    return sim
end

# If the engine cuts a step at one trial pressure and not at the next, the two answers differ by the time-stepping error and
# the mismatch jumps between them: a search for the operating point then closes on a point where there is no root. So within
# a report step every trial is solved with the same number of equal sub-steps; when a trial is cut, that number is doubled
# and the search for the step starts again. Both step-by-step drivers below do this. For the same reason the engine's
# own step-length control by iteration count is off in them (`timesteps = :none`): it would shorten a sub-step after a
# slow one, with no failure to see.
"Raised inside a trial when the engine cut a step: the search for this report step starts again with more, equal sub-steps."
struct SubstepChange <: Exception end

"""
    run_field(field; outdir, tol_psi = 0.5)

March all wells of a `FieldSpec` through time together. Returns, per report step, the node
pressure and each well's oil, liquid and gas rate and bottom-hole pressure, plus monthly oil per
well and the work done (step solves, cut steps).
"""
function run_field(fs::FieldSpec; outdir = mktempdir(), tol_psi = 0.5, max_trials = 80, sim_options = NamedTuple())
    models = fs.wells; nm = length(models)
    wmap = [(m, j) for m in 1:nm for j in 1:well_count(models[m])]; nw = length(wmap)
    widx = Dict(wmap[w] => w for w in 1:nw)
    length(fs.tubing) == nw && length(fs.lift) == nw && length(fs.start_month) == nw || error("tubing, lift and start_month need one entry per well ($nw wells)")
    fs.allocation in (:common_choke, :pro_rata, :priority) || error("unknown allocation rule $(fs.allocation)")
    sort(fs.priority) == collect(1:nw) || error("priority must list every well once")
    minimum(fs.start_month) == 0 || error("at least one well must start in month 0")
    steps = fracwell_tstep(models[1])
    all(fracwell_tstep(s) == steps for s in models) || error("all models must share one report-step schedule")
    K = length(steps)
    stage_well(m, i) = isempty(models[m].well_of_stage) ? 1 : models[m].well_of_stage[i]
    p_res = minimum(s.pressure_psi for s in models)
    pmin = fs.separator_psi + fs.line(0.0); pmax = p_res - 1e-3
    pmin < pmax || error("the surface side needs more than reservoir pressure with the wells shut in: the field cannot flow")
    cap = fs.oil_cap_stb_d
    sc = isfinite(cap) ? (p_res - fs.separator_psi) / cap : 0.0          # psi per stb/d
    gcap = fs.gas_cap_mscf_d
    scg = isfinite(gcap) ? (p_res - fs.separator_psi) / gcap : 0.0       # psi per Mscf/d
    isfinite(gcap) && fs.allocation != :common_choke && error("a gas limit is honoured only with allocation = :common_choke for now")
    sc_si = sc * PSI / (STB / DAY)                                       # Pa per m3/s, for per-well limits
    # one control object per well for the whole run; only its node pressure and limit change (see surface.jl)
    targets = [SurfaceBackPressureTarget(0.0, si_drop(fs.tubing[w], fs.lift[w]), Inf, sc_si) for w in 1:nw]
    cases = Vector{Any}(nothing, nm); sims = Vector{Any}(nothing, nm); cfgs = Vector{Any}(nothing, nm); forces = Vector{Any}(nothing, nm)
    started = falses(nm); last_state = Vector{Any}(nothing, nm); last_res = Vector{Any}(nothing, nm)
    active_now = [falses(length(models[m].positions_ft)) for m in 1:nm]; on_wells = [Int[] for _ in 1:nm]
    function build!(m, active, tag)                  # (re)build a model with the stages that exist now, starting from where it had got to
        case, _ = fracwell_case(models[m]; outdir = joinpath(outdir, "model$(m)_$(tag)"), active = active)
        isnothing(last_state[m]) || carry_state!(case, last_state[m])
        # Every call below solves one report step. Without `initial_dt` the engine would start each call
        # with a one-day sub-step; with it, a report step is one solver step unless Newton fails.
        # A whole report step in one solver step is harder than the sub-steps the engine would choose for itself, and thin
        # fracture cells make it harder still: with the usual 15 Newton iterations many steps fail and are cut (105 cut solves
        # of 458 in one 60-month gas-slip case); with 30 allowed, 5 of 339.
        sim, cfg = setup_reservoir_simulator(case; info_level = -1, initial_dt = 1e12, output_substates = true, max_nonlinear_iterations = 30, timesteps = :none, sim_options...)
        on_wells[m] = sort(unique(stage_well(m, i) for i in eachindex(active) if active[i]))
        cases[m] = case; sims[m] = sim; cfgs[m] = cfg; started[m] = false; active_now[m] = copy(active)
        forces[m] = setup_reservoir_forces(case.model; control = Dict(Symbol("W", j) => ProducerControl(targets[widx[(m, j)]]) for j in on_wells[m]))
        return
    end
    node = zeros(K); oil = zeros(K, nw); liq = zeros(K, nw); gas = zeros(K, nw); bhp = fill(NaN, K, nw); mismatch = zeros(K); limited = falses(K); gas_limited = falses(K)
    q_o = zeros(nw); q_l = zeros(nw); q_g = zeros(nw); pw = fill(NaN, nw); a_o = zeros(nw); a_l = zeros(nw)
    solves = 0; cuts = 0; nsub = 1
    p = pmin; t_start = 0.0
    t_wall = @elapsed for k in 1:K
        dt = steps[k] * DAY
        month0 = floor(Int, t_start / MONTH_DAYS + 1e-9); t_start += steps[k]
        for m in 1:nm                                    # wells that come on at the start of this step
            want = [fs.start_month[widx[(m, stage_well(m, i))]] <= month0 for i in eachindex(models[m].positions_ft)]
            any(want) && want != active_now[m] && build!(m, want, "from_month_$(month0)")
        end
        live = [m for m in 1:nm if !isnothing(sims[m])]
        snaps = Dict(m => sim_snapshot(sims[m]) for m in live)
        fill!(q_o, 0.0); fill!(q_l, 0.0); fill!(q_g, 0.0); fill!(a_o, 0.0); fill!(a_l, 0.0); fill!(pw, NaN)
        fresh = true
        nsub = max(1, nsub ÷ 2)
        function trial(pn, field_limit)                  # residual, increasing in the node pressure
            for m in live
                fresh || sim_restore!(sims[m], snaps[m])
                for j in on_wells[m]
                    targets[widx[(m, j)]].value = pn * PSI
                end
                f = forces[m]
                res = Jutul.simulate!(sims[m], fill(dt / nsub, nsub); forces = f, config = cfgs[m], initialize = !started[m])
                started[m] = true; solves += 1; last_res[m] = res
                ncut = sum(count(x -> !get(x, :success, true), rep[:ministeps]) for rep in res.reports)
                cuts += ncut
                length(res.states) == nsub || error("the reservoir step failed for model $m at a node pressure of $(round(pn)) psi in step $k")
                nacc = sum(count(x -> get(x, :success, true), rep[:ministeps]) for rep in res.reports)
                if (ncut > 0 || nacc != nsub) && nsub < 256      # any split, failed or not, changes the time stepping
                    nsub *= 2; fresh = false; throw(SubstepChange())
                end
                outs, mdt = substep_well_outputs(sims[m].model, res, f)
                for j in on_wells[m]
                    w = widx[(m, j)]; wo = outs[Symbol("W", j)]
                    # The engine shuts a well that cannot flow against this node pressure, or whose allocation is zero
                    # (control `disabled`); its rates are then zero and it is offered the surface condition again on the
                    # next call. Any other switch of control would not be undone by the snapshot, so it is made loud.
                    ctrl = wo[:control][end]
                    (ctrl == JutulDarcy.translate_target_to_symbol(targets[w]) || ctrl == :disabled) ||
                        error("well $w left the surface condition in step $k (engine control $ctrl)")
                    # end-of-step rates close the node equation; step averages (the solver's own volumes) are reported
                    q_o[w] = -wo[:orat][end] * (DAY / STB)
                    q_l[w] = q_o[w] - (haskey(wo, :wrat) ? wo[:wrat][end] * (DAY / STB) : 0.0)
                    length(mdt) == length(wo[:orat]) || error("step bookkeeping for well $w in step $k: $(length(mdt)) solver steps but $(length(wo[:orat])) outputs")
                    avg(key, unit) = haskey(wo, key) ? -sum(wo[key] .* mdt) / sum(mdt) * (DAY / unit) : 0.0
                    a_o[w] = avg(:orat, STB); a_l[w] = a_o[w] + avg(:wrat, STB); q_g[w] = avg(:grat, MSCF)
                    pw[w] = wo[:bhp][end] / PSI
                end
            end
            fresh = false
            a = pn - fs.separator_psi - fs.line(sum(q_l))
            # the limit is on the step's average rate (its volume): if the engine cut the step, the rate was higher before its end
            field_limit || return a
            isfinite(cap) && (a = min(a, (cap - sum(a_o)) * sc))
            isfinite(gcap) && (a = min(a, (gcap - sum(q_g)) * scg))
            return a
        end
        function solve_node(start, field_limit)          # root of the residual in the node pressure
            lo, hi = pmin, pmax; Rlo, Rhi = NaN, NaN
            x = clamp(start, pmin, pmax); R = trial(x, field_limit)
            x_prev, R_prev = NaN, NaN; side = 0
            for it in 1:max_trials
                abs(R) <= tol_psi && break
                if R < 0                                  # Illinois rule: an end kept twice has its weight halved
                    side == -1 && (Rhi *= 0.5); lo, Rlo = x, R; side = -1
                else
                    side == 1 && (Rlo *= 0.5); hi, Rhi = x, R; side = 1
                end
                # the rate can change by thousands of stb/d per psi in a flush step; once the pressure is pinned
                # to a millionth of a psi there is nothing left to resolve, and the leftover mismatch is reported
                hi - lo < 1e-6 && break
                it == max_trials && error("node pressure did not converge in step $k (mismatch $(round(R, digits = 2)) psi)")
                slope = (R - R_prev) / (x - x_prev)
                cand = (isfinite(slope) && slope > 0) ? x - R / slope : NaN          # secant from the last two points
                if !(lo < cand < hi)
                    cand = (isfinite(Rlo) && isfinite(Rhi)) ? lo - Rlo * (hi - lo) / (Rhi - Rlo) : NaN
                    (lo < cand < hi) || (cand = 0.5 * (lo + hi))
                end
                x_prev, R_prev = x, R
                x = cand; R = trial(x, field_limit)
            end
            return x, R
        end
        common = fs.allocation == :common_choke
        x = p; R = NaN
        while true
        try
        for t in targets
            t.oil_cap = Inf
        end
        x, R = solve_node(p, common && (isfinite(cap) || isfinite(gcap)))
        if !common && isfinite(cap) && sum(a_o) > cap * (1 + 1e-9)
            pot = copy(a_o)                               # what each well could make this step
            share = zeros(nw)
            if fs.allocation == :pro_rata
                share .= cap .* pot ./ sum(pot)
            else
                left = cap
                for w in fs.priority
                    share[w] = min(pot[w], left); left -= share[w]
                end
            end
            for w in 1:nw
                targets[w].oil_cap = share[w] * STB / DAY
            end
            x, R = solve_node(x, false)
            limited[k] = true
        elseif common && (isfinite(cap) || isfinite(gcap))
            held = x > fs.separator_psi + fs.line(sum(q_l)) + tol_psi        # the node is above what the surface alone asks for
            oil_full = isfinite(cap) && sum(a_o) > cap - 2 * tol_psi / sc     # the search stops within tol_psi, which is tol_psi / sc in rate
            gas_limited[k] = held && isfinite(gcap) && sum(q_g) > gcap - 2 * tol_psi / scg
            limited[k] = held && (oil_full || gas_limited[k])
        end
        break
        catch err
            err isa SubstepChange || rethrow()
        end
        end
        for m in live
            last_state[m] = last_res[m].states[end]       # the accepted end of this step, in case the model is rebuilt later
        end
        p = x; node[k] = x; mismatch[k] = R
        oil[k, :] .= a_o; liq[k, :] .= a_l; gas[k, :] .= q_g; bhp[k, :] .= pw
    end
    t_end = cumsum(steps)
    months = models[1].months
    mi = clamp.(ceil.(Int, (t_end .- 1e-6) ./ MONTH_DAYS), 1, months)
    monthly = [sum(oil[mi .== m, w] .* steps[mi .== m]) for m in 1:months, w in 1:nw]
    return (node_psi = node, oil_stb_d = oil, liquid_stb_d = liq, gas_mscf_d = gas, bhp_psi = bhp, mismatch_psi = mismatch, facility_full = limited, gas_limited = gas_limited,
        step_days = steps, time_days = t_end, monthly_oil_stb = monthly, step_solves = solves, cut_steps = cuts, wall_seconds = t_wall,
        cells = [number_of_cells(reservoir_domain(c)) for c in cases if !isnothing(c)], well_model = [m for (m, j) in wmap])
end

# ---- one well, marched step by step with an explicit search for the operating point --------------
# A tubing curve with gas slip is not monotone: below some rate the column fills with liquid and the
# pressure needed at the bottom goes UP as rate goes down. Reservoir and tubing can then agree at more
# than one rate, and Newton on the combined system can fail. Here every report step holds the
# bottom-hole pressure fixed (the engine's most robust control), and the pressure is searched until it
# equals what the tubing needs at the rates that pressure gives. The search follows the solution from
# the previous step, which keeps the well on its stable, higher-rate branch for as long as it exists.

"""
    run_fracwell_marching(spec, surface; outdir, tol_psi = 0.5)

One fractured well against a `SurfaceSpec` whose tubing may be any curve, including `lift` functions
with gas slip. Returns rates and bottom-hole pressure per report step, monthly oil, and the work done.
"""
function run_fracwell_marching(s::FracWellSpec, sf::SurfaceSpec; outdir = mktempdir(), tol_psi = 0.5, max_trials = 60, sim_options = NamedTuple())
    case, L = fracwell_case(s; outdir = outdir)
    sim, cfg = setup_reservoir_simulator(case; info_level = -1, initial_dt = 1e12, output_substates = true, max_nonlinear_iterations = 30, timesteps = :none, sim_options...)
    target = SurfaceBackPressureTarget(0.0, (pn, a, b, c) -> 0.0, Inf, 0.0)       # plain bottom-hole pressure, changed in place
    f = surface_forces(case, target)
    steps = fracwell_tstep(s); K = length(steps)
    need(qo, qw, qg) = isnothing(sf.lift) ? sf.separator_psi + sf.tubing(qo + qw) : sf.lift(sf.separator_psi, qo, qw, qg)
    cap = sf.oil_cap_stb_d; sc = isfinite(cap) ? (s.pressure_psi - sf.separator_psi) / cap : 0.0
    pmin = sf.separator_psi; pmax = s.pressure_psi - 1e-3
    bhp = zeros(K); oil = zeros(K); wat = zeros(K); gas = zeros(K); mismatch = zeros(K)
    e = zeros(3); a = zeros(3); started = false; solves = 0; cuts = 0
    x = pmin
    nsub = 1                                          # equal sub-steps per report step (see SubstepChange)
    t_wall = @elapsed for k in 1:K
        dt = steps[k] * DAY
        snap = sim_snapshot(sim); fresh = true
        nsub = max(1, nsub ÷ 2)
        function trial(b)
            fresh || sim_restore!(sim, snap); fresh = false
            target.value = b * PSI
            res = Jutul.simulate!(sim, fill(dt / nsub, nsub); forces = f, config = cfg, initialize = !started)
            started = true; solves += 1
            ncut = sum(count(m -> !get(m, :success, true), rep[:ministeps]) for rep in res.reports)
            cuts += ncut
            length(res.states) == nsub || error("the reservoir step failed at $(round(b)) psi bottom-hole pressure in step $k")
            nacc = sum(count(m -> get(m, :success, true), rep[:ministeps]) for rep in res.reports)
            if (ncut > 0 || nacc != nsub) && nsub < 256          # any split, failed or not, changes the time stepping
                nsub *= 2; throw(SubstepChange())
            end
            outs, mdt = substep_well_outputs(sim.model, res, f); wo = outs[:W1]
            length(mdt) == length(wo[:bhp]) || error("step bookkeeping in step $k: $(length(mdt)) solver steps but $(length(wo[:bhp])) outputs")
            for (j, key, u) in ((1, :orat, STB), (2, :wrat, STB), (3, :grat, MSCF))
                e[j] = haskey(wo, key) ? -wo[key][end] * (DAY / u) : 0.0
                a[j] = haskey(wo, key) ? -sum(wo[key] .* mdt) / sum(mdt) * (DAY / u) : 0.0
            end
            r = b - need(e[1], e[2], e[3])
            return isfinite(cap) ? min(r, (cap - a[1]) * sc) : r       # the limit is on the step's average rate (its volume)
        end
        x_start = x; R = NaN
        while true
        try
        x = x_start
        # look for a sign change starting from the previous step's pressure, stepping outward
        R = trial(x)
        if abs(R) > tol_psi
            lo, Rlo, hi, Rhi = NaN, NaN, NaN, NaN
            R < 0 ? ((lo, Rlo) = (x, R)) : ((hi, Rhi) = (x, R))
            h = max(abs(R), 5.0); n = 0
            while (isnan(lo) || isnan(hi)) && n < max_trials
                y = R < 0 ? min(x + h, pmax) : max(x - h, pmin)
                Ry = trial(y); n += 1
                Ry < 0 ? ((lo, Rlo) = (y, Ry)) : ((hi, Rhi) = (y, Ry))
                (y == pmax || y == pmin) && (isnan(lo) || isnan(hi)) && error("no operating point in step $k: the well cannot lift against this tubing")
                x, R = y, Ry; h *= 2
            end
            side = 0                                      # false position, Illinois form: if one end is kept twice,
            for _ in 1:max_trials                         # halve its weight so the other end is forced to move
                abs(R) <= tol_psi && break
                y = lo - Rlo * (hi - lo) / (Rhi - Rlo)
                (min(lo, hi) < y < max(lo, hi)) || (y = 0.5 * (lo + hi))
                R = trial(y); x = y
                if R < 0
                    side == -1 && (Rhi *= 0.5); lo, Rlo = x, R; side = -1
                else
                    side == 1 && (Rlo *= 0.5); hi, Rhi = x, R; side = 1
                end
            end
            abs(R) <= 10 * tol_psi || error("operating point did not converge in step $k (mismatch $(round(R, digits = 2)) psi; between $(round(lo, digits = 4)) and $(round(hi, digits = 4)) psi)")
        end
        break
        catch err
            err isa SubstepChange || rethrow()
        end
        end
        bhp[k] = x; mismatch[k] = R; oil[k], wat[k], gas[k] = a[1], a[2], a[3]
    end
    t_end = cumsum(steps)
    mi = clamp.(ceil.(Int, (t_end .- 1e-6) ./ MONTH_DAYS), 1, s.months)
    return (bhp_psi = bhp, oil_stb_d = oil, water_stb_d = wat, gas_mscf_d = gas, mismatch_psi = mismatch, step_days = steps, time_days = t_end,
        monthly_oil_stb = [sum(oil[mi .== m] .* steps[mi .== m]) for m in 1:s.months], step_solves = solves, cut_steps = cuts, wall_seconds = t_wall,
        cells = number_of_cells(reservoir_domain(case)), layout = L)
end
