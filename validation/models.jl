# Small models built directly on the engine for the exact-solution checks.
using Jutul, JutulDarcy, HYPRE, Dates
using .Ressim: DAY, BAR, DARCY

function half_widths(half; first = 0.2, growth = 1.5, cap = 10.0)
    w = Float64[]; x = first
    while sum(w; init = 0.0) + min(x, cap) < half - 1e-9
        push!(w, min(x, cap)); x *= growth
    end
    rem = half - sum(w; init = 0.0)
    rem > 0.5 * w[end] ? push!(w, rem) : (w[end] += rem)
    w .*= half / sum(w)
    return w
end

"Report steps with every calendar-month end as a step end; month 1 ramps up from `dt_first`."
function month_schedule(start::Date, nmonths, dt_max, dt_first; growth = 1.25)
    dt = Float64[]; month_of = Int[]
    for m in 1:nmonths
        ndays = Float64(Dates.daysinmonth(start + Month(m - 1)))
        left = ndays
        if m == 1
            t, s = 0.0, dt_first
            while t + s < ndays && s < dt_max
                push!(dt, s); push!(month_of, m); t += s; s *= growth
            end
            left = ndays - t
        end
        n = ceil(Int, left / dt_max - 1e-12)
        append!(dt, fill(left / n, n)); append!(month_of, fill(m, n))
    end
    return dt .* DAY, month_of
end

"""
Closed 1-D slab of rock (length L) drained through a conductive strip held at the well pressure.
Liquid with exponential density and rigid rock, so the mass equation is exactly linear in density
and has a closed-form answer at any drawdown. Returns monthly produced mass from the simulator and
from the exact solution, with run statistics.

The default mesh and time stepping are the product preset for transient depletion.
"""
function run_slab(; L, k_m_ud, phi = 0.08, k_c_md = 100.0, WI = 2e-10, refine = 3, dt_max = 2.5, dt_first = 0.001,
        growth = 1.25, n_months = 24, c_f = 1.5e-9, p0 = 300BAR, p_bh = 100BAR, mu = 1e-3, rho_ref = 800.0,
        p_ref = 1BAR, Ly = 10.0, h = 10.0, w_half = 1.0, solver = NamedTuple())
    dx0 = vcat([w_half], half_widths(L))
    dx = refine == 1 ? dx0 : vcat([fill(w / refine, refine) for w in dx0]...)
    nx = length(dx)
    g = CartesianMesh((nx, 1, 1), (dx, [Ly], [h]))
    K = fill(k_m_ud * 1e-6 * DARCY, nx); K[1:refine] .= k_c_md * 1e-3 * DARCY
    domain = reservoir_domain(g, permeability = K, porosity = phi)
    W = setup_well(domain, [1]; name = :P, simple_well = true, radius = 0.1)
    sys = SinglePhaseSystem(LiquidPhase(), reference_density = rho_ref)
    model, prm = setup_reservoir_model(domain, sys, wells = [W], extra_out = true, block_backend = true)
    replace_variables!(model, PhaseMassDensities = ConstantCompressibilityDensities(
        p_ref = p_ref, density_ref = rho_ref, compressibility = c_f))
    prm = setup_parameters(model)
    prm[:Reservoir][:PhaseViscosities] .= mu
    prm[:P][:WellIndices] .= WI
    haskey(prm[:P], :PhaseViscosities) && (prm[:P][:PhaseViscosities] .= mu)
    state0 = setup_reservoir_state(model, Pressure = p0)
    forces = setup_reservoir_forces(model, control = Dict(:P => ProducerControl(BottomHolePressureTarget(p_bh))))
    dt, month_of = month_schedule(Date(2020, 1, 1), n_months, dt_max, dt_first; growth = growth)
    t_wall = @elapsed res = simulate_reservoir(state0, model, dt; parameters = prm, forces = forces, info_level = -1,
        output_substates = true, precond = :ilu0, solver...)
    ws, _ = res
    mini_dt = Float64[]; mini_month = Int[]
    for (k, rep) in enumerate(res.result.reports), m in rep[:ministeps]
        get(m, :success, true) || continue
        push!(mini_dt, m[:dt]); push!(mini_month, month_of[k])
    end
    m_out = -ws[:P][:mass_rate]
    @assert length(m_out) == length(mini_dt)
    sim = [sum((m_out .* mini_dt)[mini_month .== m]) for m in 1:n_months]

    rho(p) = rho_ref * exp(c_f * (p - p_ref))
    drho = rho(p0) - rho(p_bh)
    A = Ly * h
    eta = k_m_ud * 1e-6 * DARCY / (phi * mu * c_f)
    t_end = cumsum([Float64(Dates.daysinmonth(Date(2020, 1, 1) + Month(m - 1))) for m in 1:n_months]) .* DAY
    storage = (phi * w_half * A + sum(prm[:P][:FluidVolume])) * drho     # strip and wellbore, released at once
    cum = [A * phi * L * drho * Ressim.slab_recovery(eta * t / L^2) + storage for t in t_end]
    exact = diff(vcat(0.0, cum))
    st = Ressim.step_stats(res)
    return (sim = sim, exact = exact, stats = st, wall = t_wall, cells = nx, rho_ref = rho_ref)
end

"""
1-D water flood of oil (Corey exponent 2, residuals 0.2, viscosity ratio M) at `pvi` pore volumes
injected. Returns the simulated and exact water saturation per cell and the front positions.
"""
function run_bl(nc; pvi = 0.25, nstep = nc, M = 5.0)
    domain = get_1d_reservoir(nc)
    sys = ImmiscibleSystem((LiquidPhase(), VaporPhase()))
    model = SimulationModel(domain, sys)
    replace_variables!(model, RelativePermeabilities = BrooksCoreyRelativePermeabilities(sys, [2.0, 2.0], [0.2, 0.2]))
    T = 1.0 * DAY
    dt = fill(T / nstep, nstep)
    pv = pore_volume(domain); p = 50BAR
    rho = 1000.0 * exp(1e-10 * (p - 101325.0))          # engine default density law at the run pressure
    src = SourceTerm(1, pvi * sum(pv) * rho / T, fractional_flow = [1.0, 0.0])
    forces = setup_forces(model, sources = src, bc = FlowBoundaryCondition(nc, p))
    parameters = setup_parameters(model, PhaseViscosities = [1e-3, M * 1e-3])
    state0 = setup_state(model, Pressure = p, Saturations = [0.2, 0.8])
    t_wall = @elapsed (states, reports) = simulate(state0, model, dt, forces = forces, parameters = parameters, info_level = -1)
    sw = collect(states[end][:Saturations][1, :])
    # exact cell averages by sub-sampling each cell
    nsub = 41
    xs = [(i - 1 + (j - 0.5) / nsub) / nc for i in 1:nc for j in 1:nsub]
    se, x_front = Ressim.buckley_leverett(xs, pvi; M = M)
    exact = [sum(se[(i-1)*nsub+1:i*nsub]) / nsub for i in 1:nc]
    # simulated front: where the saturation crosses half the shock height, searched from the outlet
    s_shock = 0.2 + 0.6 / sqrt(M + 1)
    level = 0.5 * (0.2 + s_shock)
    xc = ((1:nc) .- 0.5) ./ nc
    i = findlast(>(level), sw)
    x_sim = (isnothing(i) || i == nc) ? NaN : xc[i] + (sw[i] - level) / (sw[i] - sw[i+1]) / nc
    return (sw = sw, exact = exact, x_front = x_front, x_front_sim = x_sim, pvi = pvi, wall = t_wall,
        injected_check = sum((sw .- 0.2) .* pv) / sum(pv) / pvi - 1, stats = Ressim.step_stats(reports))
end
