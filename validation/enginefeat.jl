# Small models that exercise engine features this suite had not run (stream 7, 2026-11-10). Included by suite.jl.
#
# Each function builds the smallest model that makes one feature of the engine do work, and returns the numbers a test
# needs. Nothing here is a model of a real reservoir. What each one exercises, and where the feature lives in the engine's
# source, is in research/engine-features.md.

const EF_DARCY = 9.869232667160130e-13
const EF_BAR = 1.0e5
const EF_DAY = 86400.0

# ---- tracers ------------------------------------------------------------------------------------------------------------
"""
Water pushed through a water-filled 1-D reservoir from an injector to a producer. The injected water carries tracer 1 at
concentration 1 and tracer 2 at concentration 0. Returns the tracer masses and concentrations at the end, the mass of
water injected, the mass of water in place, and cell centres as a share of the length.
"""
function ef_tracer_flood(; nx = 200, pvi = 0.4, nstep = 200)
    L = 1000.0
    g = reservoir_mesh((nx, 1, 1), (L, 10.0, 10.0))
    reservoir = reservoir_domain(g, permeability = 0.5 * EF_DARCY, porosity = 0.2)
    inj = setup_vertical_well(reservoir, 1, 1, name = :I); prod = setup_vertical_well(reservoir, nx, 1, name = :P)
    sys = ImmiscibleSystem((AqueousPhase(), LiquidPhase()), reference_densities = [1000.0, 800.0])
    tracers = [SinglePhaseTracer(sys, AqueousPhase()), SinglePhaseTracer(sys, AqueousPhase())]
    model = setup_reservoir_model(reservoir, sys, wells = [inj, prod], tracers = tracers)
    push!(model[:Reservoir].output_variables, :PhaseMassDensities); unique!(model[:Reservoir].output_variables)
    T = 100.0 * EF_DAY; dt = fill(T / nstep, nstep)
    pv = pore_volume(reservoir)
    rate = pvi * sum(pv) / T                                        # m3/s at the surface density of 1000 kg/m3
    controls = Dict(:I => InjectorControl(TotalRateTarget(rate), [1.0, 0.0], density = 1000.0, tracers = [1.0, 0.0]),
        :P => ProducerControl(BottomHolePressureTarget(100.0 * EF_BAR)))
    forces = setup_reservoir_forces(model, control = controls)
    state0 = setup_reservoir_state(model, Pressure = 100.0 * EF_BAR, Saturations = [1.0, 0.0])
    res = simulate_reservoir(state0, model, dt, forces = forces, info_level = -1)
    ws, states = res
    st = states[end]; full = res.result.states[end]
    rho = st[:PhaseMassDensities][1, :]
    in_wells = sum(full[:I][:TracerMasses][1, :]) + sum(full[:P][:TracerMasses][1, :])      # the wellbores hold water too
    return (masses = st[:TracerMasses], conc = st[:TracerConcentrations], injected_kg = rate * 1000.0 * T, water_in_place_kg = sum(rho .* pv),
        x = ((1:nx) .- 0.5) ./ nx, nx = nx, in_wells_kg = in_wells)
end

"Where a profile that falls from 1 to 0 crosses one half, as a share of the length (linear between cell centres)."
function ef_half_crossing(x, c)
    i = findlast(>(0.5), c)
    (isnothing(i) || i == length(c)) && return NaN
    return x[i] + (c[i] - 0.5) / (c[i] - c[i+1]) * (x[i+1] - x[i])
end

# ---- heat conduction ------------------------------------------------------------------------------------------------------
"""
A bar of rock at rest, held hot at one end. Nothing flows; heat conducts. The first cell has a heat capacity so large that it
stays at `T_hot`. Returns the temperatures at the end, the exact temperatures of a half-space with its face (the centre of the
first cell) held hot, and the diffusivity used.
"""
function ef_conduction(; nc = 100, nstep = 200, L = 10.0, time = 2.8e5, T_cold = 300.0, T_hot = 400.0)
    lambda = 2.0; rho_r = 2500.0; C_r = 900.0; C_f = 4184.0; poro = 0.01
    G = get_1d_reservoir(nc; L = L, poro = poro, area = 1.0)
    sys = ImmiscibleSystem((LiquidPhase(), VaporPhase()))
    D = discretized_domain_tpfv_flow(G)
    model = SimulationModel(D, sys, data_domain = G)
    JutulDarcy.add_thermal_to_model!(model)
    push!(model.output_variables, :Temperature); push!(model.output_variables, :PhaseMassDensities); unique!(model.output_variables)
    replace_variables!(model, RelativePermeabilities = BrooksCoreyRelativePermeabilities(2, [2.0, 2.0]))
    dx = L / nc
    Cr = fill(C_r, nc); Cr[1] = 1.0e15                                 # the hot plate
    parameters = setup_parameters(model, PhaseViscosities = [1e-3, 1e-3], RockThermalConductivities = lambda * 1.0 / dx, FluidThermalConductivities = 0.0,
        RockDensity = rho_r, ComponentHeatCapacity = C_f, RockHeatCapacity = Cr)
    s0 = zeros(2, nc); s0[1, :] .= 1.0
    T0 = fill(T_cold, nc); T0[1] = T_hot
    state0 = setup_state(model, Pressure = 100.0 * EF_BAR, Saturations = s0, Temperature = T0)
    states, reports = simulate(state0, model, fill(time / nstep, nstep), parameters = parameters, forces = setup_forces(model), info_level = -1)
    Tend = collect(states[end][:Temperature]); rho_f = states[end][:PhaseMassDensities][1, 2]
    alpha = lambda / (rho_r * C_r * (1 - poro) + poro * rho_f * C_f)
    x = ((1:nc) .- 1) .* dx                                           # distance from the centre of the hot cell
    exact = [T_cold + (T_hot - T_cold) * (1 - Ressim.erf_approx(xi / (2 * sqrt(alpha * time)))) for xi in x]
    return (T = Tend, exact = exact, alpha = alpha, x = x, error = maximum(abs.(Tend .- exact)) / (T_hot - T_cold), hot_cell_drift = abs(Tend[1] - T_hot),
        pressure_drift = maximum(abs.(states[end][:Pressure] .- 100.0 * EF_BAR)))
end

# ---- relative-permeability hysteresis -------------------------------------------------------------------------------------
# Curves for the non-wetting phase with known formulas: drainage starts to flow at 5% saturation, imbibition traps 30%.
const EF_SCRD = 0.05
const EF_SCRI = 0.30
ef_drain(s) = s <= EF_SCRD ? 0.0 : ((s - EF_SCRD) / (1 - EF_SCRD))^2
ef_imb(s) = s <= EF_SCRI ? 0.0 : ((s - EF_SCRI) / (1 - EF_SCRI))^2

"The two curves as engine tables (fine enough that linear interpolation between rows is within 1e-6 of the formulas)."
function ef_hyst_tables(n = 2001)
    s = collect(range(0.0, 1.0, n))
    return PhaseRelativePermeability(s, ef_drain.(s)), PhaseRelativePermeability(s, ef_imb.(s))
end

"Carlson's scanning curve from the formulas alone: the imbibition curve moved sideways until it meets the drainage curve at the turning point."
function ef_carlson(s, s_turn)
    s_meet = EF_SCRI + (1 - EF_SCRI) * sqrt(ef_drain(s_turn))
    return ef_imb(s + s_meet - s_turn)
end

"Saturation trapped after turning at `s_turn` (Land's rule as Killough wrote it), from the end points alone."
function ef_trapped(s_turn)
    K = 1 / (EF_SCRI - EF_SCRD) - 1 / (1 - EF_SCRD)
    return EF_SCRD + (s_turn - EF_SCRD) / (1 + K * (s_turn - EF_SCRD))
end

"Killough's scanning curve from the formulas alone."
function ef_killough(s, s_turn)
    scr = ef_trapped(s_turn)
    s <= scr && return 0.0
    return ef_imb(EF_SCRI + (s - scr) * (1 - EF_SCRI) / (s_turn - scr)) * ef_drain(s_turn) / ef_drain(1.0)
end

"""
Gas pushed into a water-filled 1-D reservoir, then water pushed after it for many pore volumes. With `hysteresis`, gas that
has been in a cell is partly trapped there. Returns the gas saturation at the end and the largest gas saturation every cell
has seen.
"""
function ef_trapping_flood(; hysteresis = true, nc = 40, gas_pv = 0.6, water_pv = 12.0, nstep = 200)
    domain = get_1d_reservoir(nc)
    sys = ImmiscibleSystem((AqueousPhase(), VaporPhase()))
    model = SimulationModel(domain, sys)
    drain, imb = ef_hyst_tables(401)
    s = collect(range(0.0, 1.0, 101)); krw = PhaseRelativePermeability(s, s .^ 2)
    kr = JutulDarcy.ReservoirRelativePermeabilities(w = krw, g = hysteresis ? (drain, imb) : drain,
        hysteresis_g = hysteresis ? JutulDarcy.KilloughHysteresis(tol = 0.0) : JutulDarcy.NoHysteresis())
    replace_variables!(model, RelativePermeabilities = kr)
    JutulDarcy.add_relperm_parameters!(model)
    pv = pore_volume(domain); p0 = 100.0 * EF_BAR
    T1 = 1.0 * EF_DAY; T2 = 20.0 * EF_DAY; n1 = nstep ÷ 4; n2 = nstep
    dt = vcat(fill(T1 / n1, n1), fill(T2 / n2, n2))
    bc = FlowBoundaryCondition(nc, p0)
    # mass rates; the engine's default density is close to 1000 kg/m3 for every phase of this simple system
    f_gas = setup_forces(model, sources = SourceTerm(1, gas_pv * sum(pv) * 1000.0 / T1, fractional_flow = [0.0, 1.0]), bc = bc)
    f_wat = setup_forces(model, sources = SourceTerm(1, water_pv * sum(pv) * 1000.0 / T2, fractional_flow = [1.0, 0.0]), bc = bc)
    forces = vcat([f_gas for _ in 1:n1], [f_wat for _ in 1:n2])
    parameters = setup_parameters(model, PhaseViscosities = [1e-3, 1e-4])
    state0 = setup_state(model, Pressure = p0, Saturations = [1.0, 0.0])
    states, reports = simulate(state0, model, dt, forces = forces, parameters = parameters, info_level = -1)
    sg = [collect(st[:Saturations][2, :]) for st in states]
    smax = [maximum(x[i] for x in sg) for i in 1:nc]
    return (sg_end = sg[end], sg_max = smax, sg_after_gas = sg[n1])
end

# ---- linear solvers -------------------------------------------------------------------------------------------------------
"Run a case with a chosen preconditioner; returns the well results and the solver's work."
function ef_solve(case; kw...)
    res = simulate_reservoir(case; info_level = -1, kw...)
    st = Jutul.report_stats(res.result.reports)
    return (res = res, newtons = st.newtons, linear_iterations = st.linear_iterations, steps = st.steps)
end

# ---- end-point scaling (through a deck) -------------------------------------------------------------------------------------
# A water-oil table and the end points it is scaled to. The scaled curves are also written out as an ordinary table, by the
# two-point rule as published (each curve stretched between its own critical and maximum saturation), so that a run that
# uses the scaling keywords can be compared with a run that uses no scaling at all.
const EF_SWOF = [(0.2, 0.0, 1.0), (0.3, 0.02, 0.6), (0.4, 0.08, 0.35), (0.5, 0.18, 0.18), (0.6, 0.32, 0.07), (0.7, 0.5, 0.01), (0.8, 0.7, 0.0)]   # Sw, krw, krow

ef_lin(xs, ys, x) = x <= xs[1] ? ys[1] : x >= xs[end] ? ys[end] : (i = searchsortedlast(xs, x); ys[i] + (ys[i+1] - ys[i]) * (x - xs[i]) / (xs[i+1] - xs[i]))

"The table of `EF_SWOF` scaled to the end points given (water: connate `swl`, critical `swcr`, maximum `swu`; oil: critical `sowcr`), as plain rows."
function ef_scaled_rows(; swl, swcr, swu, sowcr)
    sw = [r[1] for r in EF_SWOF]; krw = [r[2] for r in EF_SWOF]; kro = [r[3] for r in EF_SWOF]
    so_t = reverse(1 .- sw); kro_t = reverse(kro)                         # oil curve against oil saturation, rising
    swcr_t = 0.2; swu_t = 0.8; sowcr_t = 0.2; somax_t = 0.8
    fw(s) = s < swcr ? 0.0 : s >= swu ? krw[end] : ef_lin(sw, krw, swcr_t + (s - swcr) * (swu_t - swcr_t) / (swu - swcr))
    fo(so) = so < sowcr ? 0.0 : so >= 1 - swl ? kro_t[end] : ef_lin(so_t, kro_t, sowcr_t + (so - sowcr) * (somax_t - sowcr_t) / (1 - swl - sowcr))
    nodes = vcat([swcr + (s - swcr_t) * (swu - swcr) / (swu_t - swcr_t) for s in sw], [1 - (sowcr + (s - sowcr_t) * (1 - swl - sowcr) / (somax_t - sowcr_t)) for s in so_t], [swl, 1.0])
    nodes = sort(unique(round.(clamp.(nodes, swl, 1.0), digits = 10)))
    return [(s, fw(s), fo(1 - s)) for s in nodes]
end

"""
Write a 1-D water-oil deck (metric units, 50 cells of 10 m, 10,000 m3 of pore volume). `rows` is the SWOF table;
`endscale` = (swl, swcr, swu, sowcr) adds the scaling keywords with those values in every cell; `flood` = true injects one
pore volume of water in 1,000 days against a producer, false only produces (depletion to 150 bar). `swat` is the water
saturation at the start (at 0.2, the table's connate value, the water cannot move).
"""
function ef_ow_deck(path; rows = EF_SWOF, endscale = nothing, flood = true, nx = 50, days = 1000.0, nstep = 40, swat = 0.27)
    open(path, "w") do io
        println(io, "RUNSPEC\nTITLE\n ef\nDIMENS\n $nx 1 1 /\nOIL\nWATER\nMETRIC\nSTART\n 1 'JAN' 2020 /\nWELLDIMS\n 2 1 2 2 /\nTABDIMS\n/")
        isnothing(endscale) || println(io, "ENDSCALE\n 'NODIR' 'REVERS' 1 20 /")
        println(io, "GRID\nDX\n $nx*10 /\nDY\n $nx*10 /\nDZ\n $nx*10 /\nTOPS\n $nx*2000 /\nPORO\n $nx*0.2 /\nPERMX\n $nx*100 /\nCOPY\n PERMX PERMY /\n PERMX PERMZ /\n/")
        println(io, "PROPS\nSWOF")
        for (s, kw, ko) in rows
            @printf(io, " %.10f %.10f %.10f 0\n", s, kw, ko)
        end
        println(io, "/\nPVTW\n 200 1.0 4.0E-5 0.5 0 /\nPVCDO\n 200 1.0 1.0E-4 2.0 0 /\nDENSITY\n 800 1000 1 /\nROCK\n 200 4.0E-5 /")
        if !isnothing(endscale)
            for (key, v) in zip(("SWL", "SWCR", "SWU", "SOWCR"), endscale)
                println(io, key, "\n $nx*", v, " /")
            end
        end
        println(io, "SOLUTION\nPRESSURE\n $nx*200 /\nSWAT\n $nx*", swat, " /\nSUMMARY\nSCHEDULE")
        if flood
            println(io, "WELSPECS\n 'INJ' 'G' 1 1 2005 'WATER' /\n 'PROD' 'G' $nx 1 2005 'OIL' /\n/\nCOMPDAT\n 'INJ' 1 1 1 1 'OPEN' 1* 1* 0.2 /\n 'PROD' $nx 1 1 1 'OPEN' 1* 1* 0.2 /\n/")
            println(io, "WCONINJE\n 'INJ' 'WATER' 'OPEN' 'RATE' 10.0 1* 600 /\n/\nWCONPROD\n 'PROD' 'OPEN' 'BHP' 5* 150 /\n/")
        else
            println(io, "WELSPECS\n 'PROD' 'G' $nx 1 2005 'OIL' /\n/\nCOMPDAT\n 'PROD' $nx 1 1 1 'OPEN' 1* 1* 0.2 /\n/\nWCONPROD\n 'PROD' 'OPEN' 'BHP' 5* 150 /\n/")
        end
        println(io, "TSTEP\n $nstep*", days / nstep, " /\nEND")
    end
    return path
end

"Cumulative oil (m3) of well PROD at the end of every report step, and the water saturation at the end."
function ef_flood_result(o)
    res = o.result; q = -Ressim.well_series(res, :PROD, :orat); dt = diff(vcat(0.0, res.time))
    return (cum = cumsum(q .* dt), sw = collect(res.states[end][:Saturations][1, :]), time = res.time)
end

# ---- multi-segment wells --------------------------------------------------------------------------------------------------
"Friction factor (Darcy) from the Colebrook-White equation, solved by iteration; laminar below Reynolds 2,000."
function ef_colebrook(Re, rel_rough)
    Re < 2000 && return 64 / Re
    f = 0.02
    for _ in 1:60
        f = 1 / (-2 * log10(rel_rough / 3.7 + 2.51 / (Re * sqrt(f))))^2
    end
    return f
end

"""
A column of rock with one producer through it, open to the rock only in the bottom cell, so the whole wellbore carries the same
flow, and an injector in a corner that holds the pressure up, so the flow is steady when it is read. `segmented` = false is
the engine's simple well (one node); true resolves the producer's wellbore in segments with friction in tubing of the given
radius. Returns the producer's mass rate at the end and its full state at the end.
"""
function ef_column_well(; segmented = true, radius = 0.05, nz = 10, days = 5.0, nstep = 20)
    g = CartesianMesh((3, 3, nz), (300.0, 300.0, 10.0 * nz))
    domain = reservoir_domain(g, permeability = 1.0 * EF_DARCY, porosity = 0.2)
    sys = ImmiscibleSystem((AqueousPhase(), LiquidPhase()), reference_densities = [1000.0, 800.0])
    well = setup_vertical_well(domain, 2, 2, name = :P, simple_well = !segmented, radius = radius, roughness = 1e-4)
    well[:well_index, Perforations()][1:nz-1] .= 0.0
    inj = setup_vertical_well(domain, 1, 1, name = :I, simple_well = true)
    model = setup_reservoir_model(domain, sys, wells = [well, inj])
    for k in (:Reservoir, :P)
        push!(model[k].output_variables, :PhaseMassDensities); unique!(model[k].output_variables)
    end
    forces = setup_reservoir_forces(model, control = Dict(:P => ProducerControl(BottomHolePressureTarget(50.0 * EF_BAR)),
        :I => InjectorControl(BottomHolePressureTarget(300.0 * EF_BAR), [0.0, 1.0], density = 800.0)))
    state0 = setup_reservoir_state(model, Pressure = 200.0 * EF_BAR, Saturations = [0.0, 1.0])
    res = simulate_reservoir(state0, model, fill(days * EF_DAY / nstep, nstep), forces = forces, info_level = -1)
    ws = res.wells; full = res.result.states[end][:P]
    return (mass_rate = -ws[:P, :mass_rate][end], well_state = full, well = well, model = model)
end

# ---- coarsening -------------------------------------------------------------------------------------------------------------
"Pore volume of a case's reservoir (m3)."
ef_pore_volume(case) = sum(pore_volume(reservoir_domain(case)))

"Run a case and return the oil left in the reservoir (kg) after the first report step and at the end, and the highest pressure at the end."
function ef_oil_left(case)
    r = simulate_reservoir(case; info_level = -1)
    return (first = sum(r.states[1][:TotalMasses][2, :]), last = sum(r.states[end][:TotalMasses][2, :]), p_end = maximum(r.states[end][:Pressure]))
end

# ---- adjoint gradients --------------------------------------------------------------------------------------------------------
"""
A small two-phase displacement and one number computed from it (the gas saturation of the last cell, summed over time).
Returns how that number changes with the pore volume of chosen cells and the transmissibility of chosen faces, twice: from
the engine's adjoint solve, and from re-running the model with each input moved up and down by a part in a thousand.
"""
function ef_adjoint_check(; nc = 12, nstep = 12)
    G = get_1d_reservoir(nc)
    sys = ImmiscibleSystem((LiquidPhase(), VaporPhase()))
    model = SimulationModel(G, sys)
    replace_variables!(model, RelativePermeabilities = BrooksCoreyRelativePermeabilities(sys, [2.0, 2.0], [0.2, 0.2]))
    dt = fill(EF_DAY / nstep, nstep); pv = pore_volume(G)
    rate = 500 * sum(pv) / sum(dt)
    forces = setup_forces(model, sources = [SourceTerm(1, rate, fractional_flow = [0.8, 0.2]), SourceTerm(nc, -rate, fractional_flow = [1.0, 0.0])])
    parameters = setup_parameters(model, PhaseViscosities = [1e-3, 5e-3])
    state0 = setup_state(model, Pressure = 100.0 * EF_BAR, Saturations = [0.7, 0.3])
    obj = (m, state, dt, step_info, forces) -> dt * state[:Saturations][2, end]
    function total(par)
        states, reports = simulate(state0, model, dt, forces = forces, parameters = par, info_level = -1)
        return sum(dt[i] * states[i][:Saturations][2, end] for i in eachindex(dt)), states, reports
    end
    J0, states, reports = total(parameters)
    grad = solve_adjoint_sensitivities(model, states, reports, obj, forces = forces, state0 = state0, parameters = parameters, raw_output = false)
    out = Tuple{Symbol, Int, Float64, Float64}[]
    for (key, idx) in ((:FluidVolume, (1, nc ÷ 2, nc)), (:Transmissibilities, (1, nc ÷ 2, nc - 1)))
        for i in idx
            up = deepcopy(parameters); dn = deepcopy(parameters); h = 1e-3 * parameters[key][i]
            up[key][i] += h; dn[key][i] -= h
            push!(out, (key, i, grad[key][i], (total(up)[1] - total(dn)[1]) / (2h)))
        end
    end
    return (rows = out, objective = J0)
end
