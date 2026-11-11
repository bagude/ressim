# Wellbore and surface back-pressure for ONE fractured well, coupled to the reservoir run.
#
# What it is: the bottom-hole pressure is no longer typed in. It is whatever the surface side needs
# to lift the produced liquid: separator pressure + tubing/flowline pressure drop at the current
# rate, raised further (a choke) when the facility's oil-rate limit would be exceeded.
# How it is coupled: the engine has no lift tables or group controls, so an outer loop adjusts the
# pressure of every report step until reservoir and surface agree, re-running the generated deck.
# What it is not: one well only (no shared network, no allocation between wells), and the tubing
# model is single-phase liquid or a declared curve. Gas lightening the column is NOT modelled, so
# for a gassy well a liquid-only tubing curve overstates the bottom-hole pressure.

const G_ACC = 9.80665
const LB_FT3 = 16.01846337          # kg/m3
const INCH = 0.0254

Base.@kwdef struct SurfaceSpec
    separator_psi::Float64 = 100.0
    tubing::Function = q -> 0.0     # pressure drop separator -> bottom hole (psi) at liquid rate q (stb/d)
    # optional replacement for `tubing`: (node psi, oil stb/d, water stb/d, gas Mscf/d) -> bottom-hole psi needed.
    # Use it when gas matters (see lift.jl). Only the in-timestep form (`run_fracwell_implicit`, `run_field`) honours it.
    lift::Union{Nothing, Function} = nothing
    oil_cap_stb_d::Float64 = Inf    # facility limit on oil rate
end

"Pressure the surface side needs at the bottom of the well to carry liquid rate `q` (stb/d)."
required_bhp(sf::SurfaceSpec, q) = sf.separator_psi + sf.tubing(q)

"Darcy friction factor: laminar 64/Re below Re = 2,300, else the Colebrook-White equation solved by iteration."
function friction_factor(Re, rel_roughness)
    Re <= 0 && return 0.0
    Re < 2300 && return 64 / Re
    f = 0.02
    for _ in 1:60
        f_new = (-2 * log10(rel_roughness / 3.7 + 2.51 / (Re * sqrt(f))))^-2
        abs(f_new - f) < 1e-14 && break
        f = f_new
    end
    return f
end

"""
Single-phase liquid pressure drop (psi) from the top of a pipe to its bottom while producing `q`
stb/d upward: hydrostatic head over the vertical depth plus wall friction over the measured length.
"""
function liquid_pipe_drop(q; depth_ft, length_ft = depth_ft, id_in, roughness_in = 0.0006, density_lb_ft3, viscosity_cp)
    rho = density_lb_ft3 * LB_FT3; mu = viscosity_cp * 1e-3; D = id_in * INCH
    Q = abs(q) * STB / DAY
    v = Q / (pi * D^2 / 4)
    f = friction_factor(rho * v * D / mu, roughness_in / id_in)
    return (rho * G_ACC * depth_ft * FT + f * (length_ft * FT / D) * rho * v^2 / 2) / PSI
end

"Tubing curve for `SurfaceSpec` from single-phase liquid hydraulics."
liquid_tubing(; kw...) = q -> liquid_pipe_drop(q; kw...)

"""
Well outputs at every accepted solver step of a result, with the lengths of those steps (s). When the engine
cuts a report step it keeps the in-between states inside the report step's state (`:substates`); they are
unpacked here, so a rate times its step length is the solver's own volume.
"""
function substep_well_outputs(model, res, forces)
    states, dts, _ = Jutul.expand_to_ministeps(res.states, res.reports)
    return JutulDarcy.full_well_outputs(model, states, forces), dts
end

"Averages of a per-solver-step series over each report step (time-weighted), from the solver's own step lengths."
function report_step_average(res, series)
    out = Float64[]; j = 0
    for rep in res.result.reports
        vol = 0.0; tt = 0.0
        for m in rep[:ministeps]
            get(m, :success, true) || continue
            j += 1; vol += series[j] * m[:dt]; tt += m[:dt]
        end
        push!(out, vol / tt)
    end
    @assert j == length(series)
    return out
end

"""
    run_fracwell_surface(spec, surface; outdir, max_iter = 40, tol_psi = 0.5)

Find the bottom-hole pressure of every report step such that, for each step, either the pressure
equals what the surface side requires at that step's liquid rate, or the oil rate sits on the
facility limit with the pressure above that requirement. Returns the converged run, the pressure
and rate per report step, and the iteration record. Non-convergence is returned, not hidden.
"""
function run_fracwell_surface(s::FracWellSpec, sf::SurfaceSpec; outdir = mktempdir(), max_iter = 200, tol_psi = 0.5, window = 12, verbose = false)
    K = length(fracwell_tstep(s)); n = length(s.positions_ft)
    pmin = required_bhp(sf, 0.0); pmax = s.pressure_psi - 1e-3
    pmin < pmax || error("the surface side needs $(round(pmin)) psi with the well shut in, above reservoir pressure: the well cannot flow")
    cap = sf.oil_cap_stb_d
    sc = isfinite(cap) ? (s.pressure_psi - sf.separator_psi) / cap : 0.0     # psi per stb/d, puts the rate-limit term in psi
    p = fill(pmin, K); p_prev = fill(NaN, K); R_prev = fill(NaN, K)
    history = Float64[]; r = nothing; q_liq = zeros(K); q_oil = zeros(K); R = zeros(K); on_cap = falses(K); converged = false
    for it in 1:max_iter
        r = run_fracwell(s; outdir = outdir, bhp_schedule = p)
        res = r.run.result
        fill!(q_liq, 0.0); fill!(q_oil, 0.0)
        for i in 1:n
            w = Symbol(@sprintf("S%03d", i))
            qo = report_step_average(res, -well_series(res, w, :orat)) .* (DAY / STB)
            qw = well_series(res, w, :wrat); qw = isnothing(qw) ? zeros(K) : report_step_average(res, -qw) .* (DAY / STB)
            q_oil .+= qo; q_liq .+= qo .+ qw
        end
        # one residual per step, increasing in that step's pressure; zero when surface and reservoir agree
        for k in 1:K
            a = p[k] - required_bhp(sf, q_liq[k]); c = (cap - q_oil[k]) * sc
            on_cap[k] = isfinite(cap) && c < a
            R[k] = on_cap[k] ? c : a
        end
        push!(history, maximum(abs, R))
        verbose && @printf("  surface iteration %3d: worst mismatch %.3f psi\n", it, history[end])
        f = findfirst(>(tol_psi), abs.(R))
        if isnothing(f)
            converged = true; break
        end
        it == max_iter && break
        # A step's rate depends on the pressures of the steps before it, never after. So the earliest
        # unconverged step and a window behind it get a secant update; later steps only a cautious nudge.
        for k in f:K
            head = max(s.pressure_psi - p[k], 1.0)
            guess = on_cap[k] ? sc * q_oil[k] / head : 1 + (required_bhp(sf, q_liq[k]) - pmin) / head   # productivity-index view
            guess = max(guess, 1e-6)
            slope = NaN
            if k < f + window && isfinite(R_prev[k]) && abs(p[k] - p_prev[k]) > 1e-9
                slope = (R[k] - R_prev[k]) / (p[k] - p_prev[k])
            end
            (isfinite(slope) && slope > 0.2 * guess) || (slope = 2 * guess)
            step = -R[k] / slope
            k < f + window || (step *= 0.5)
            p_prev[k] = p[k]; R_prev[k] = R[k]; p[k] = clamp(p[k] + step, pmin, pmax)
        end
    end
    return (run = r, bhp_psi = copy(p), liquid_stb_d = copy(q_liq), oil_stb_d = copy(q_oil), converged = converged,
        iterations = length(history), mismatch_psi = history, step_days = fracwell_tstep(s))
end

# ---- the same surface condition solved inside the engine's timestep ------------------------------
# The engine lets a well be controlled by any target for which `well_target_value` is defined. This
# target says: bottom-hole pressure minus the tubing drop at the current liquid rate must equal the
# pressure the well discharges into, unless the oil rate would exceed the limit, in which case the
# rate sits on the limit. It is solved together with the reservoir in every Newton iteration, so no
# outer loop is needed. It applies to one well; use the single-well form of the fractured well.

# Mutable on purpose: the engine keeps the control it was first given for a step, so a caller that
# retries a step at another node pressure must change `value` on the same object.
mutable struct SurfaceBackPressureTarget{F} <: JutulDarcy.WellTarget
    value::Float64        # pressure the well discharges into, Pa (separator, or a shared node)
    drop::F               # (node Pa, oil, water, gas surface m3/s, production positive) -> bottom-hole minus node pressure, Pa
    oil_cap::Float64      # m3/s at surface, Inf for none
    cap_scale::Float64    # Pa per m3/s, puts the rate-limit branch in pressure units
end

JutulDarcy.rate_weighted(::SurfaceBackPressureTarget) = false
JutulDarcy.target_scaling(::SurfaceBackPressureTarget) = 1e5
# the engine files every target as a limit under its own name; this one has no limit form
JutulDarcy.as_limit(::SurfaceBackPressureTarget) = NamedTuple()
# same safeguard the engine gives a pressure-controlled producer: it may not turn into an injector
JutulDarcy.default_limits(::JutulDarcy.ProducerControl{<:SurfaceBackPressureTarget}) = (rate_lower = -JutulDarcy.MIN_ACTIVE_WELL_RATE,)

function JutulDarcy.well_target_value(ctrl, t::SurfaceBackPressureTarget, cond, well, model, state)
    a = cond.bottom_hole_pressure - t.drop(t.value, -cond.surface_liquid_rate, -cond.surface_aqueous_rate, -cond.surface_vapor_rate)
    isfinite(t.oil_cap) || return a
    return min(a, t.value + (t.oil_cap + cond.surface_liquid_rate) * t.cap_scale)
end

"Tubing in the engine's units: a liquid-rate curve, or a full lift function when one is given."
function si_drop(tubing, lift)
    isnothing(lift) && return (pn, qo, qw, qg) -> PSI * tubing((qo + qw) * (DAY / STB))
    return (pn, qo, qw, qg) -> PSI * lift(pn / PSI, qo * (DAY / STB), qw * (DAY / STB), qg * (DAY / MSCF)) - pn
end

"Engine target for a `SurfaceSpec`; `node_psi` is the pressure the well discharges into."
function surface_target(sf::SurfaceSpec, reservoir_psi; node_psi = sf.separator_psi)
    cap = sf.oil_cap_stb_d * STB / DAY
    sc = isfinite(cap) ? (reservoir_psi - sf.separator_psi) * PSI / cap : 0.0
    return SurfaceBackPressureTarget(node_psi * PSI, si_drop(sf.tubing, sf.lift), cap, sc)
end

"Engine case for a fractured-well model with every well's stages on one wellbore (W1, W2, ...; see `well_of_stage`). `active`: stages that exist yet."
function fracwell_case(s::FracWellSpec; outdir = mktempdir(), active = nothing)
    mkpath(outdir)
    deck = joinpath(outdir, uppercase(replace(s.name, r"[^A-Za-z0-9_]" => "_")) * ".DATA")
    L = write_fracwell_deck(s, deck; single_well = true, active = active)
    case, _ = capture_stdout(() -> setup_case_from_data_file(deck))
    s.conductivity_loss_per_psi > 0 && rock_regions!(case, L.rocknum)
    return case, L
end

surface_forces(case, target) = setup_reservoir_forces(case.model; control = Dict(:W1 => ProducerControl(target)))

"""
    run_fracwell_implicit(spec, surface; outdir)

One fractured well (all stages on one well) producing against the surface condition, solved in a
single run. Returns the engine result with run statistics.
"""
function run_fracwell_implicit(s::FracWellSpec, sf::SurfaceSpec; outdir = mktempdir(), kwarg...)
    case, L = fracwell_case(s; outdir = outdir)
    f = surface_forces(case, surface_target(sf, s.pressure_psi))
    t = @elapsed res = simulate_reservoir(case.state0, case.model, case.dt; parameters = case.parameters, forces = f,
        info_level = -1, output_substates = true, kwarg...)
    return (result = res, stats = step_stats(res), wall_seconds = t, cells = number_of_cells(reservoir_domain(case)), layout = L)
end
