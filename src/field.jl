# Several fractured wells sharing a flowline, a separator and a facility oil-rate limit.
#
# Each well is its own reservoir model (the wells do not interfere through the rock) producing through
# its own tubing into a common node. The node pressure is the separator pressure plus the shared
# flowline drop at the total liquid rate. When total oil would exceed the facility limit, one of
# three allocation rules decides who is cut back:
#   :common_choke  the node pressure is raised until the total fits; the split follows the reservoirs
#   :pro_rata      every well is cut to the same fraction of what it could make this step
#   :priority      wells are filled in the order given; later wells get what is left
#
# How it is solved: all wells march through time together. In every report step the node pressure is
# found by a bracketed secant; each trial re-solves that one step for every well from a saved state.
# Inside a trial the tubing condition and any per-well rate limit are solved with the reservoir
# (see surface.jl). The two rules with per-well limits first solve the step unconstrained to get each
# well's potential, then solve it again with the limits.

Base.@kwdef struct FieldSpec
    wells::Vector{FracWellSpec}
    tubing::Vector{Function} = Function[q -> 0.0 for _ in wells]   # per well: psi at liquid rate in stb/d
    lift::Vector{Any} = Any[nothing for _ in wells]                # per well: optional lift function (see SurfaceSpec)
    separator_psi::Float64 = 100.0
    line::Function = q -> 0.0                                       # shared flowline: psi at total liquid stb/d
    oil_cap_stb_d::Float64 = Inf                                    # facility limit on total oil
    allocation::Symbol = :common_choke                              # :common_choke | :pro_rata | :priority
    priority::Vector{Int} = collect(1:length(wells))                # order in which wells are filled under :priority
end

sim_snapshot(sim) = Dict(k => deepcopy(sim.storage[k].state0) for k in keys(sim.model.models))

function sim_restore!(sim, snap)
    Jutul.reset_previous_state!(sim, snap)          # previous state back to the start of the step
    Jutul.reset_state_to_previous_state!(sim)       # and the unknowns with it
    return sim
end

"""
    run_field(field; outdir, tol_psi = 0.5)

March all wells of a `FieldSpec` through time together. Returns, per report step, the node
pressure and each well's oil, liquid and gas rate and bottom-hole pressure, plus monthly oil per
well and the work done (step solves, cut steps).
"""
function run_field(fs::FieldSpec; outdir = mktempdir(), tol_psi = 0.5, max_trials = 80)
    nw = length(fs.wells)
    fs.allocation in (:common_choke, :pro_rata, :priority) || error("unknown allocation rule $(fs.allocation)")
    sort(fs.priority) == collect(1:nw) || error("priority must list every well once")
    steps = fracwell_tstep(fs.wells[1])
    all(fracwell_tstep(s) == steps for s in fs.wells) || error("all wells must share one report-step schedule")
    K = length(steps)
    cases = Any[]; sims = Any[]; cfgs = Any[]
    for (w, s) in enumerate(fs.wells)
        case, _ = fracwell_case(s; outdir = joinpath(outdir, "well$w"))
        # Every call below solves one report step. Without `initial_dt` the engine would start each call
        # with a one-day sub-step; with it, a report step is one solver step unless Newton fails.
        sim, cfg = setup_reservoir_simulator(case; info_level = -1, initial_dt = 1e12, output_substates = true)
        push!(cases, case); push!(sims, sim); push!(cfgs, cfg)
    end
    p_res = minimum(s.pressure_psi for s in fs.wells)
    pmin = fs.separator_psi + fs.line(0.0); pmax = p_res - 1e-3
    pmin < pmax || error("the surface side needs more than reservoir pressure with the wells shut in: the field cannot flow")
    cap = fs.oil_cap_stb_d
    sc = isfinite(cap) ? (p_res - fs.separator_psi) / cap : 0.0          # psi per stb/d
    sc_si = sc * PSI / (STB / DAY)                                       # Pa per m3/s, for per-well limits
    # one control object per well for the whole run; only its node pressure and limit change (see surface.jl)
    targets = [SurfaceBackPressureTarget(0.0, si_drop(fs.tubing[w], fs.lift[w]), Inf, sc_si) for w in 1:nw]
    forces = [surface_forces(cases[w], targets[w]) for w in 1:nw]
    node = zeros(K); oil = zeros(K, nw); liq = zeros(K, nw); gas = zeros(K, nw); bhp = zeros(K, nw); mismatch = zeros(K); limited = falses(K)
    q_o = zeros(nw); q_l = zeros(nw); q_g = zeros(nw); pw = zeros(nw); a_o = zeros(nw); a_l = zeros(nw)
    started = falses(nw); solves = 0; cuts = 0
    p = pmin
    t_wall = @elapsed for k in 1:K
        dt = steps[k] * DAY
        snaps = [sim_snapshot(sim) for sim in sims]
        fresh = true
        function trial(pn, field_limit)                  # residual, increasing in the node pressure
            for w in 1:nw
                fresh || sim_restore!(sims[w], snaps[w])
                targets[w].value = pn * PSI; f = forces[w]
                res = Jutul.simulate!(sims[w], [dt]; forces = f, config = cfgs[w], initialize = !started[w])
                started[w] = true; solves += 1
                cuts += count(m -> !get(m, :success, true), res.reports[end][:ministeps])
                isempty(res.states) && error("the reservoir step failed for well $w at a node pressure of $(round(pn)) psi in step $k")
                wo = JutulDarcy.full_well_outputs(sims[w].model, res.states, f)[:W1]
                # The engine shuts a well that cannot flow against this node pressure, or whose allocation is zero
                # (control `disabled`); its rates are then zero and it is offered the surface condition again on the
                # next call. Any other switch of control would not be undone by the snapshot, so it is made loud.
                ctrl = wo[:control][end]
                (ctrl == JutulDarcy.translate_target_to_symbol(targets[w]) || ctrl == :disabled) ||
                    error("well $w left the surface condition in step $k (engine control $ctrl)")
                # end-of-step rates close the node equation; step averages (the solver's own volumes) are reported
                q_o[w] = -wo[:orat][end] * (DAY / STB)
                q_l[w] = q_o[w] - (haskey(wo, :wrat) ? wo[:wrat][end] * (DAY / STB) : 0.0)
                mdt = [m[:dt] for m in res.reports[end][:ministeps] if get(m, :success, true)]
                length(mdt) == length(wo[:orat]) || error("step bookkeeping for well $w in step $k: $(length(mdt)) solver steps but $(length(wo[:orat])) outputs")
                avg(key, unit) = haskey(wo, key) ? -sum(wo[key] .* mdt) / sum(mdt) * (DAY / unit) : 0.0
                a_o[w] = avg(:orat, STB); a_l[w] = a_o[w] + avg(:wrat, STB); q_g[w] = avg(:grat, MSCF)
                pw[w] = wo[:bhp][end] / PSI
            end
            fresh = false
            a = pn - fs.separator_psi - fs.line(sum(q_l))
            return field_limit ? min(a, (cap - sum(q_o)) * sc) : a
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
        for t in targets
            t.oil_cap = Inf
        end
        common = fs.allocation == :common_choke
        x, R = solve_node(p, common && isfinite(cap))
        if !common && isfinite(cap) && sum(q_o) > cap * (1 + 1e-9)
            pot = copy(q_o)                               # what each well could make this step
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
        elseif common && isfinite(cap)
            limited[k] = sum(q_o) > cap * (1 - 1e-6) && x > fs.separator_psi + fs.line(sum(q_l)) + tol_psi
        end
        p = x; node[k] = x; mismatch[k] = R
        oil[k, :] .= a_o; liq[k, :] .= a_l; gas[k, :] .= q_g; bhp[k, :] .= pw
    end
    t_end = cumsum(steps)
    months = fs.wells[1].months
    mi = clamp.(ceil.(Int, (t_end .- 1e-6) ./ MONTH_DAYS), 1, months)
    monthly = [sum(oil[mi .== m, w] .* steps[mi .== m]) for m in 1:months, w in 1:nw]
    return (node_psi = node, oil_stb_d = oil, liquid_stb_d = liq, gas_mscf_d = gas, bhp_psi = bhp, mismatch_psi = mismatch, facility_full = limited,
        step_days = steps, time_days = t_end, monthly_oil_stb = monthly, step_solves = solves, cut_steps = cuts, wall_seconds = t_wall,
        cells = [number_of_cells(reservoir_domain(c)) for c in cases])
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
function run_fracwell_marching(s::FracWellSpec, sf::SurfaceSpec; outdir = mktempdir(), tol_psi = 0.5, max_trials = 60)
    case, L = fracwell_case(s; outdir = outdir)
    sim, cfg = setup_reservoir_simulator(case; info_level = -1, initial_dt = 1e12, output_substates = true)
    target = SurfaceBackPressureTarget(0.0, (pn, a, b, c) -> 0.0, Inf, 0.0)       # plain bottom-hole pressure, changed in place
    f = surface_forces(case, target)
    steps = fracwell_tstep(s); K = length(steps)
    need(qo, qw, qg) = isnothing(sf.lift) ? sf.separator_psi + sf.tubing(qo + qw) : sf.lift(sf.separator_psi, qo, qw, qg)
    cap = sf.oil_cap_stb_d; sc = isfinite(cap) ? (s.pressure_psi - sf.separator_psi) / cap : 0.0
    pmin = sf.separator_psi; pmax = s.pressure_psi - 1e-3
    bhp = zeros(K); oil = zeros(K); wat = zeros(K); gas = zeros(K); mismatch = zeros(K)
    e = zeros(3); a = zeros(3); started = false; solves = 0; cuts = 0
    x = pmin
    t_wall = @elapsed for k in 1:K
        dt = steps[k] * DAY
        snap = sim_snapshot(sim); fresh = true
        function trial(b)
            fresh || sim_restore!(sim, snap); fresh = false
            target.value = b * PSI
            res = Jutul.simulate!(sim, [dt]; forces = f, config = cfg, initialize = !started)
            started = true; solves += 1
            cuts += count(m -> !get(m, :success, true), res.reports[end][:ministeps])
            isempty(res.states) && error("the reservoir step failed at $(round(b)) psi bottom-hole pressure in step $k")
            wo = JutulDarcy.full_well_outputs(sim.model, res.states, f)[:W1]
            mdt = [m[:dt] for m in res.reports[end][:ministeps] if get(m, :success, true)]
            for (j, key, u) in ((1, :orat, STB), (2, :wrat, STB), (3, :grat, MSCF))
                e[j] = haskey(wo, key) ? -wo[key][end] * (DAY / u) : 0.0
                a[j] = haskey(wo, key) ? -sum(wo[key] .* mdt) / sum(mdt) * (DAY / u) : 0.0
            end
            r = b - need(e[1], e[2], e[3])
            return isfinite(cap) ? min(r, (cap - e[1]) * sc) : r
        end
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
            abs(R) <= 10 * tol_psi || error("operating point did not converge in step $k (mismatch $(round(R, digits = 2)) psi)")
        end
        bhp[k] = x; mismatch[k] = R; oil[k], wat[k], gas[k] = a[1], a[2], a[3]
    end
    t_end = cumsum(steps)
    mi = clamp.(ceil.(Int, (t_end .- 1e-6) ./ MONTH_DAYS), 1, s.months)
    return (bhp_psi = bhp, oil_stb_d = oil, water_stb_d = wat, gas_mscf_d = gas, mismatch_psi = mismatch, step_days = steps, time_days = t_end,
        monthly_oil_stb = [sum(oil[mi .== m] .* steps[mi .== m]) for m in 1:s.months], step_solves = solves, cut_steps = cuts, wall_seconds = t_wall,
        cells = number_of_cells(reservoir_domain(case)), layout = L)
end
