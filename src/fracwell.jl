# Multi-stage fractured horizontal well: geometry in, ECLIPSE-format deck out.
#
# The fractures are an INPUT here (position, half-length, conductivity per stage). Nothing in this
# file predicts how a fracture grows. Each fracture is a plane of high-permeability cells of declared
# physical width; its conductivity (md-ft) is honoured exactly whatever the cell width.
# The lateral is frictionless: every stage produces at the same bottom-hole pressure. Each stage is
# written as its own well so the summary reports stages separately.
# Idealisations to state when quoting results: fully penetrating fractures in one layer, fracture
# porosity equal to the rock, a declared non-limiting well-to-fracture connection, no fracture
# conductivity loss with pressure.

const FT = 0.3048

"Mesh presets, all in feet: first cell beside the fracture, growth factor, largest cell, row height along the fracture."
const FRAC_MESH = Dict(
    "coarse" => (first = 1.0, growth = 1.6, cap = 40.0, dy = 20.0),
    "standard" => (first = 0.3, growth = 1.4, cap = 20.0, dy = 10.0),
    "fine" => (first = 0.1, growth = 1.3, cap = 10.0, dy = 5.0),
    "screening" => (first = 2.0, growth = 1.8, cap = 80.0, dy = 40.0),     # for batches of runs; see `fast_spec` for what it costs in accuracy
)

Base.@kwdef struct FracWellSpec
    name::String = "fracwell"
    # reservoir (field units)
    thickness_ft::Float64 = 100.0
    width_ft::Float64 = 1300.0             # perpendicular to the lateral; the well runs down the middle
    perm_md::Float64 = 5e-4
    porosity::Float64 = 0.08
    top_ft::Float64 = 9000.0
    pressure_psi::Float64 = 5000.0
    rock_compressibility::Float64 = 4e-6   # 1/psi
    # well and stages
    bhp_psi::Float64 = 1500.0
    positions_ft::Vector{Float64} = [100.0, 300.0, 500.0]   # along the lateral
    half_length_ft::Vector{Float64} = [250.0, 250.0, 250.0]
    conductivity_mdft::Vector{Float64} = [50.0, 50.0, 50.0]
    # optional, per stage: multipliers on the conductivity at equal steps from the well (first) to the tip (last)
    conductivity_shape::Vector{Vector{Float64}} = Vector{Float64}[]
    # optional, per stage: where across the model the stage's wellbore sits (ft from one side). Empty = the middle.
    # Giving two groups of stages different values models two laterals in the same rock, so they interfere.
    center_ft::Vector{Float64} = Float64[]
    # Fracture conductivity that falls as the fracture is drawn down: multiplier exp(-loss * (initial pressure - pressure in the
    # fracture cell)), never below `conductivity_floor`. 0 = off. Unless `conductivity_loss_reversible`, the loss is permanent:
    # the multiplier follows the LOWEST pressure the cell has seen. (Engine feature: ROCKCOMP / ROCKTAB / ROCKNUM in the deck.)
    conductivity_loss_per_psi::Float64 = 0.0
    conductivity_loss_reversible::Bool = false
    conductivity_floor::Float64 = 0.05
    # Rock that varies across the model. Each is `nothing` (use the single value above) or a function (x, y) -> value, with x the
    # position along the lateral (the same coordinate as `positions_ft`) and y the distance across the model, both in feet.
    # `net_thickness_map` gives net pay; `thickness_ft` is then the gross thickness and the deck carries net-to-gross.
    # `sw_map` gives water saturation; the water is taken as immobile, so it only reduces the pore volume that holds oil.
    # See `well_maps` (geology.jl) for building these from a `Geology`.
    porosity_map::Any = nothing
    perm_map::Any = nothing
    net_thickness_map::Any = nothing
    sw_map::Any = nothing
    # Optional, per stage: the month in which the stage starts producing (0 = from the beginning). A stage that starts later does not
    # exist until then: no fracture, no well. The run is split at every start and the reservoir state is carried across, so a later
    # (child) stage sees the depletion and free gas left by the earlier (parent) ones, and the parents feel the child.
    start_month::Vector{Int} = Int[]
    # Faults crossing the model: a list of (points = [(x, y), ...], multiplier = m) in the same coordinates as the maps. Flow between two
    # neighbouring cells is multiplied by m when the line between their centres crosses the trace (0 seals). See `well_faults` (structure.jl).
    fault_traces::Any = nothing
    edge_ft::Float64 = 100.0               # rock beyond the first and last stage
    fracture_width_ft::Float64 = 2.0       # width of the fracture cells (conductivity is preserved)
    connection_multiple::Float64 = 30.0    # well connection = this many along-fracture cell transmissibilities
    # fluid: "blackoil_spe1" (illustrative live oil, gas, connate water) or "oil" (constant-compressibility oil)
    fluid::String = "blackoil_spe1"
    initial_rs::Float64 = 1.27             # Mscf/stb, blackoil_spe1 only (bubble point 4,014.7 psia)
    oil_compressibility::Float64 = 3e-6    # 1/psi, "oil" only
    oil_viscosity_cp::Float64 = 1.0        # "oil" only
    # schedule and mesh
    months::Int = 24
    dt_first_days::Float64 = 0.001
    dt_growth::Float64 = 1.25
    dt_max_days::Float64 = 2.5
    mesh::String = "standard"
end

const MONTH_DAYS = 30.4375

"Load a spec from TOML. Scalars given for per-stage quantities are repeated for every stage."
function load_fracwell(path)
    d = TOML.parsefile(path)
    n = haskey(d, "positions_ft") ? length(d["positions_ft"]) : get(d, "stages", 3)
    if !haskey(d, "positions_ft")
        sp = Float64(get(d, "spacing_ft", 200.0))
        d["positions_ft"] = [sp / 2 + (i - 1) * sp for i in 1:n]
        haskey(d, "edge_ft") || (d["edge_ft"] = sp / 2)
    end
    for k in ("half_length_ft", "conductivity_mdft")
        v = get(d, k, getfield(FracWellSpec(), Symbol(k))[1])
        d[k] = v isa AbstractVector ? Float64.(v) : fill(Float64(v), n)
    end
    delete!(d, "stages"); delete!(d, "spacing_ft")
    kw = Dict{Symbol, Any}()
    for (k, v) in d
        T = fieldtype(FracWellSpec, Symbol(k))
        kw[Symbol(k)] = T == Vector{Vector{Float64}} ? [Float64.(x) for x in v] : T <: Vector ? Float64.(v) : convert(T, v)
    end
    return FracWellSpec(; kw...)
end

function graded(len; first, growth, cap)
    w = Float64[]; x = first
    while sum(w; init = 0.0) + min(x, cap) < len - 1e-9
        push!(w, min(x, cap)); x *= growth
    end
    rem = len - sum(w; init = 0.0)
    (isempty(w) || rem > 0.5 * w[end]) ? push!(w, rem) : (w[end] += rem)
    w .*= len / sum(w)
    return w
end

"Mesh and fracture layout for a spec: cell widths, fracture column per stage, fracture rows per stage."
function fracwell_layout(s::FracWellSpec)
    m = FRAC_MESH[s.mesh]
    n = length(s.positions_ft)
    @assert length(s.half_length_ft) == n && length(s.conductivity_mdft) == n "one half-length and one conductivity per stage"
    isempty(s.center_ft) || length(s.center_ft) == n || error("center_ft needs one value per stage")
    wc = s.fracture_width_ft
    ux = sort(unique(s.positions_ft))                         # stages of different laterals may share a position
    nu = length(ux)
    x0 = ux[1] - s.edge_ft
    bounds = vcat(x0, [0.5 * (ux[i] + ux[i+1]) for i in 1:nu-1], ux[end] + s.edge_ft)
    dx = Float64[]; ucol = Int[]
    for i in 1:nu
        left = graded(ux[i] - wc / 2 - bounds[i]; first = m.first, growth = m.growth, cap = m.cap)
        right = graded(bounds[i+1] - ux[i] - wc / 2; first = m.first, growth = m.growth, cap = m.cap)
        append!(dx, reverse(left)); push!(dx, wc); push!(ucol, length(dx)); append!(dx, right)
    end
    icol = [ucol[findfirst(==(x), ux)] for x in s.positions_ft]
    # rows along the fractures: every fracture tip and every well row fall on row boundaries, so the
    # half-length on the mesh is the half-length asked for (clamped to the edges of the model)
    cen = isempty(s.center_ft) ? fill(s.width_ft / 2, n) : s.center_ft
    all(0 .< cen .< s.width_ft) || error("every stage's center_ft must lie inside the model width")
    half = [min(s.half_length_ft[i], cen[i], s.width_ft - cen[i]) for i in 1:n]
    dyw = min(m.dy, 2 * minimum(half))
    bps = [0.0, s.width_ft]
    for i in 1:n
        append!(bps, [cen[i] - dyw / 2, cen[i] + dyw / 2])
        half[i] > dyw / 2 + 1e-9 && append!(bps, [cen[i] - half[i], cen[i] + half[i]])
    end
    bps = sort(unique(round.(clamp.(bps, 0.0, s.width_ft), digits = 9)))
    dy = Float64[]
    for k in 1:length(bps)-1
        len = bps[k+1] - bps[k]
        nrow = max(1, round(Int, len / m.dy))
        append!(dy, fill(len / nrow, nrow))
    end
    ny = length(dy)
    yc = cumsum(dy) .- dy ./ 2
    jws = [argmin(abs.(yc .- cen[i])) for i in 1:n]
    rows = [findall(y -> abs(y - cen[i]) <= half[i] + 1e-9, yc) for i in 1:n]
    eff_half = [sum(dy[r]) / 2 for r in rows]                # half-length actually on the mesh
    return (dx = dx, dy = dy, icol = icol, jw = jws[1], jws = jws, rows = rows, eff_half_ft = eff_half, nx = length(dx), ny = ny, center_ft = cen)
end

fmt_vals(v; per = 8) = join([join([@sprintf("%.9g", x) for x in v[i:min(i + per - 1, end)]], " ") for i in 1:per:length(v)], "\n")

const PROPS_SPE1 = """
PVTW
 4017.55 1.038 3.22E-6 0.318 0.0 /
SWOF
0.12 0 1 0
0.18 4.64876033057851E-008 1 0
0.24 0.000000186 0.997 0
0.3 4.18388429752066E-007 0.98 0
0.36 7.43801652892562E-007 0.7 0
0.42 1.16219008264463E-006 0.35 0
0.48 1.67355371900826E-006 0.2 0
0.54 2.27789256198347E-006 0.09 0
0.6 2.97520661157025E-006 0.021 0
0.66 3.7654958677686E-006 0.01 0
0.72 4.64876033057851E-006 0.001 0
0.78 0.000005625 0.0001 0
0.84 6.69421487603306E-006 0 0
0.91 8.05914256198347E-006 0 0
1 0.00001 0 0 /
SGOF
0 0 1 0
0.001 0 1 0
0.02 0 0.997 0
0.05 0.005 0.980 0
0.12 0.025 0.700 0
0.2 0.075 0.350 0
0.25 0.125 0.200 0
0.3 0.190 0.090 0
0.4 0.410 0.021 0
0.45 0.60 0.010 0
0.5 0.72 0.001 0
0.6 0.87 0.0001 0
0.7 0.94 0.000 0
0.85 0.98 0.000 0
0.88 0.984 0.000 0 /
DENSITY
 53.66 64.49 0.0533 /
PVDG
14.700 166.666 0.008000
264.70 12.0930 0.009600
514.70 6.27400 0.011200
1014.7 3.19700 0.014000
2014.7 1.61400 0.018900
2514.7 1.29400 0.020800
3014.7 1.08000 0.022800
4014.7 0.81100 0.026800
5014.7 0.64900 0.030900
9014.7 0.38600 0.047000 /
PVTO
0.0010 14.7 1.0620 1.0400 /
0.0905 264.7 1.1500 0.9750 /
0.1800 514.7 1.2070 0.9100 /
0.3710 1014.7 1.2950 0.8300 /
0.6360 2014.7 1.4350 0.6950 /
0.7750 2514.7 1.5000 0.6410 /
0.9300 3014.7 1.5650 0.5940 /
1.2700 4014.7 1.6950 0.5100
 9014.7 1.5790 0.7400 /
1.6180 5014.7 1.8270 0.4490
 9014.7 1.7370 0.6310 /
/
"""

"Report-step lengths in days: a ramp from `dt_first`, then steps no longer than `dt_max`, month ends always on a step."
function fracwell_tstep(s::FracWellSpec)
    dt = Float64[]; t = 0.0; x = s.dt_first_days
    while t + x < MONTH_DAYS && x < s.dt_max_days
        push!(dt, x); t += x; x *= s.dt_growth
    end
    left = MONTH_DAYS - t
    n = ceil(Int, left / s.dt_max_days - 1e-12); append!(dt, fill(left / n, n))
    nm = ceil(Int, MONTH_DAYS / s.dt_max_days - 1e-12)
    for _ in 2:s.months
        append!(dt, fill(MONTH_DAYS / nm, nm))
    end
    return dt
end

"Write the ECLIPSE-format deck for a spec. Returns the layout used."
function write_fracwell_deck(s::FracWellSpec, path; bhp_schedule = nothing, oil_rate_target = nothing, single_well = false, active = nothing)
    on(i) = isnothing(active) || active[i]              # stages not yet started have no fracture and no well
    L = fracwell_layout(s)
    nx, ny = L.nx, L.ny; nc = nx * ny
    n = length(s.positions_ft)
    perm = fill(s.perm_md, nx, ny); isfrac = falses(nx, ny)
    # cell centres in the spec's own coordinates: x along the lateral as in `positions_ft`, y across the model
    xc_map = (minimum(s.positions_ft) - s.edge_ft) .+ cumsum(L.dx) .- L.dx ./ 2; yc_map = cumsum(L.dy) .- L.dy ./ 2
    mapped = !all(isnothing, (s.porosity_map, s.perm_map, s.net_thickness_map, s.sw_map))
    sw_ref = s.fluid == "blackoil_spe1" ? 0.12 : 0.0                     # the uniform water saturation the deck starts with
    poro = fill(s.porosity, nx, ny); ntg = ones(nx, ny)
    if mapped
        for j in 1:ny, i in 1:nx
            x = xc_map[i]; y = yc_map[j]
            isnothing(s.perm_map) || (perm[i, j] = s.perm_map(x, y))
            isnothing(s.porosity_map) || (poro[i, j] = s.porosity_map(x, y))
            if !isnothing(s.sw_map)                                      # immobile water: only the oil-filled share of the pores is modelled
                sw = s.sw_map(x, y); 0 <= sw < 1 || error("sw_map must return values in [0, 1)")
                poro[i, j] *= (1 - sw) / (1 - sw_ref)
            end
            if !isnothing(s.net_thickness_map)
                net = s.net_thickness_map(x, y); 0 < net <= s.thickness_ft * (1 + 1e-9) || error("net_thickness_map must return values between 0 and thickness_ft (the gross thickness)")
                ntg[i, j] = min(net / s.thickness_ft, 1.0)
            end
        end
        all(>(0), perm) && all(x -> 0 < x < 1, poro) || error("mapped permeability must be positive and mapped porosity between 0 and 1")
    end
    isempty(s.conductivity_shape) || length(s.conductivity_shape) == n || error("conductivity_shape needs one profile per stage")
    yc = cumsum(L.dy) .- L.dy ./ 2
    for i in 1:n, j in L.rows[i]
        on(i) || continue
        mult = 1.0
        if !isempty(s.conductivity_shape)                 # linear between the given points, well to tip
            sh = s.conductivity_shape[i]; m = length(sh)
            u = clamp(abs(yc[j] - L.center_ft[i]) / max(L.eff_half_ft[i], 1e-9), 0.0, 1.0) * (m - 1)
            k0 = min(floor(Int, u) + 1, max(m - 1, 1)); f = u - (k0 - 1)
            mult = m == 1 ? sh[1] : sh[k0] + f * (sh[k0+1] - sh[k0])
        end
        perm[L.icol[i], j] = max(mult * s.conductivity_mdft[i] / s.fracture_width_ft, perm[L.icol[i], j])   # never below the rock or another fracture
        isfrac[L.icol[i], j] = true
    end
    live = s.fluid == "blackoil_spe1"
    live || s.fluid == "oil" || error("unknown fluid '$(s.fluid)'")
    live && s.pressure_psi < 4014.7 && error("blackoil_spe1 with initial_rs 1.27 needs initial pressure above its 4,014.7 psia bubble point")
    open(path, "w") do io
        println(io, "-- Generated by Ressim (fracwell). Geometry is an input; no fracture growth is modelled.")
        println(io, "RUNSPEC\nTITLE\n ", s.name, "\nDIMENS\n ", nx, " ", ny, " 1 /\nOIL\nWATER")
        live && println(io, "GAS\nDISGAS")
        println(io, "FIELD\nSTART\n 1 'JAN' 2020 /\nWELLDIMS\n ", n, " ", n, " ", n, " ", n, " /\nTABDIMS\n/")
        lossy = s.conductivity_loss_per_psi > 0
        lossy && println(io, "ROCKCOMP\n '", s.conductivity_loss_reversible ? "REVERS" : "IRREVERS", "' 2 /")
        println(io, "GRID\nDXV\n", fmt_vals(L.dx), " /\nDYV\n", fmt_vals(L.dy), " /\nDZV\n ", s.thickness_ft, " /")
        if mapped
            println(io, "TOPS\n ", nc, "*", s.top_ft, " /\nPORO\n", fmt_vals(vec(poro)), " /")
            isnothing(s.net_thickness_map) || println(io, "NTG\n", fmt_vals(vec(ntg)), " /")
        else
            println(io, "TOPS\n ", nc, "*", s.top_ft, " /\nPORO\n ", nc, "*", s.porosity, " /")
        end
        println(io, "PERMX\n", fmt_vals(vec(perm)), " /\nCOPY\n PERMX PERMY /\n PERMX PERMZ /\n/")
        if !isnothing(s.fault_traces) && !isempty(s.fault_traces)        # MULTX / MULTY act on the face towards the next cell in x / y
            mx = ones(nx, ny); my = ones(nx, ny)
            for j in 1:ny, i in 1:nx
                i < nx && (mx[i, j] = crossing_multiplier(s.fault_traces, xc_map[i], yc_map[j], xc_map[i+1], yc_map[j]))
                j < ny && (my[i, j] = crossing_multiplier(s.fault_traces, xc_map[i], yc_map[j], xc_map[i], yc_map[j+1]))
            end
            println(io, "MULTX\n", fmt_vals(vec(mx)), " /\nMULTY\n", fmt_vals(vec(my)), " /")
        end
        println(io, "PROPS\nROCK\n 14.7 ", s.rock_compressibility, " /")
        if lossy          # two rock tables against pressure: pore-volume multiplier (the rock compressibility above) and transmissibility multiplier
            ps = sort(unique(vcat(range(14.7, s.pressure_psi, length = 40), s.pressure_psi + 2000.0)))
            println(io, "ROCKTAB")
            for region in 1:2
                for pv in ps
                    tm = region == 1 || pv >= s.pressure_psi ? 1.0 : max(s.conductivity_floor, exp(-s.conductivity_loss_per_psi * (s.pressure_psi - pv)))
                    @printf(io, " %.4f %.9f %.9f\n", pv, exp(s.rock_compressibility * (pv - 14.7)), tm)
                end
                println(io, "/")
            end
        end
        if live
            print(io, PROPS_SPE1)
        else
            println(io, "PVCDO\n ", s.pressure_psi, " 1.0 ", s.oil_compressibility, " ", s.oil_viscosity_cp, " 0.0 /")
            println(io, "PVTW\n ", s.pressure_psi, " 1.0 ", s.oil_compressibility, " ", s.oil_viscosity_cp, " 0.0 /")
            println(io, "DENSITY\n 53.66 64.49 0.0533 /\nSWOF\n 0 0 1 0\n 1 1 0 0 /")
        end
        lossy && println(io, "REGIONS\nROCKNUM\n", fmt_vals([isfrac[k] ? 2 : 1 for k in 1:nc]), " /")
        println(io, "SOLUTION\nPRESSURE\n ", nc, "*", s.pressure_psi, " /\nSWAT\n ", nc, "*", live ? 0.12 : 0.0, " /")
        live && println(io, "SGAS\n ", nc, "*0 /\nRS\n ", nc, "*", s.initial_rs, " /")
        println(io, "SUMMARY\nSCHEDULE\nWELSPECS")
        depth = s.top_ft + s.thickness_ft / 2
        # default: every stage is its own well (per-stage reporting). single_well: one well, W1, with a
        # connection per stage, which is what a rate target or a tubing condition on the whole lateral needs.
        wname(i) = single_well ? "W1" : @sprintf("S%03d", i)
        wells = single_well ? (1:1) : [i for i in 1:n if on(i)]
        for i in wells
            @printf(io, " '%s' 'G' %d %d %.4f 'OIL' /\n", wname(i), L.icol[i], L.jws[i], depth)
        end
        println(io, "/\nCOMPDAT")
        for i in 1:n
            on(i) || continue
            cf = s.connection_multiple * 0.001127 * s.conductivity_mdft[i] * s.thickness_ft * ntg[L.icol[i], L.jws[i]] / L.dy[L.jws[i]]   # net pay at the well cell
            @printf(io, " '%s' %d %d 1 1 'OPEN' 1* %.9g 0.5 /\n", wname(i), L.icol[i], L.jws[i], cf)
        end
        steps = fracwell_tstep(s)
        if !isnothing(bhp_schedule)                      # one bottom-hole pressure per report step
            @assert length(bhp_schedule) == length(steps)
            for (k, dtk) in enumerate(steps)
                println(io, "/\nWCONPROD")
                for i in wells
                    @printf(io, " '%s' 'OPEN' 'BHP' 5* %.6f /\n", wname(i), bhp_schedule[k])
                end
                @printf(io, "/\nTSTEP\n %.9g ", dtk)
            end
            println(io, "/\nEND")
            return
        end
        println(io, "/\nWCONPROD")
        for i in wells
            if isnothing(oil_rate_target)
                @printf(io, " '%s' 'OPEN' 'BHP' 5* %.4f /\n", wname(i), s.bhp_psi)
            else                                         # the engine's own rate target with a pressure limit
                @printf(io, " '%s' 'OPEN' 'ORAT' %.6f 4* %.4f /\n", wname(i), oil_rate_target, s.bhp_psi)
            end
        end
        println(io, "/\nTSTEP\n", fmt_vals(steps), " /\nEND")
    end
    return merge(L, (rocknum = [isfrac[k] ? 2 : 1 for k in 1:nc],))
end

"""
    fast_spec(spec; level = :fast)

The same well set up to run faster, for batches (history-match samples, probabilistic forecasts).
Measured on a three-stage live-oil well (0.005 md, 300 ft half-lengths, 120 months) against the standard
mesh with the default time steps:

| level        | mesh      | longest step | run time | oil at 3 / 12 / 60 / 120 months | gas at 3 / 12 / 60 / 120 months |
|--------------|-----------|--------------|----------|---------------------------------|---------------------------------|
| (coarse)     | coarse    | 2.5 days     | 1/3.4    | -0.2 / -0.2 / -0.2 / -0.3 %     | -1.2 / -1.4 / -0.8 / -0.8 %     |
| `:fast`      | coarse    | 15 days      | 1/14     | -1.9 / -0.9 / -0.6 / -0.5 %     | -2.9 / -2.2 / -1.1 / -0.8 %     |
| `:screening` | screening | 30 days      | 1/60     | -3.9 / -5.1 / -1.5 / -0.9 %     | -4.7 / -5.0 / -4.0 / -2.7 %     |

All three read low. Other rock and other fracture lengths will give somewhat different numbers; the
suite re-measures the `:fast` and `:screening` rows on one case and holds them to a bar.
"""
function fast_spec(s::FracWellSpec; level = :fast)
    kw = Dict{Symbol, Any}(f => getfield(s, f) for f in fieldnames(FracWellSpec))
    if level == :fast
        kw[:mesh] = "coarse"; kw[:dt_max_days] = MONTH_DAYS / 2; kw[:dt_growth] = 1.4
    elseif level == :screening
        kw[:mesh] = "screening"; kw[:dt_max_days] = MONTH_DAYS; kw[:dt_growth] = 1.5
    else
        error("fast_spec: level must be :fast or :screening")
    end
    return FracWellSpec(; kw...)
end

"""
    run_fracwell(spec; outdir)

Write the deck, simulate it, and return the run plus a per-stage table (cumulative oil, gas and
water in field units, and the half-length actually represented on the mesh).
"""
function run_fracwell(s::FracWellSpec; outdir = mktempdir(), bhp_schedule = nothing, oil_rate_target = nothing, kwarg...)
    mkpath(outdir)
    n = length(s.positions_ft)
    isempty(s.start_month) || length(s.start_month) == n || error("start_month needs one value per stage")
    starts = isempty(s.start_month) ? zeros(Int, n) : s.start_month
    all(m -> 0 <= m < s.months, starts) || error("every start_month must be at least 0 and below months")
    minimum(starts) == 0 || error("at least one stage must start in month 0")
    name = uppercase(replace(s.name, r"[^A-Za-z0-9_]" => "_"))
    breaks = sort(unique(starts)); staged = length(breaks) > 1
    staged && !(isnothing(bhp_schedule) && isnothing(oil_rate_target)) && error("staged starts cannot be combined with a pressure schedule or a rate target yet")
    oil = zeros(s.months, n); gas = zeros(s.months, n); water = zeros(s.months, n)
    runs = Any[]; L = nothing; deck = ""; previous = nothing; low = nothing
    for (k, m0) in enumerate(breaks)                       # one run per period between starts; the state is carried from one to the next
        m1 = k < length(breaks) ? breaks[k+1] : s.months
        active = starts .<= m0
        part = staged ? FracWellSpec(; (f => getfield(s, f) for f in fieldnames(FracWellSpec))..., months = m1 - m0) : s
        deck = joinpath(outdir, staged ? @sprintf("%s_FROM_MONTH_%03d.DATA", name, m0) : name * ".DATA")
        L = write_fracwell_deck(part, deck; bhp_schedule = bhp_schedule, oil_rate_target = oil_rate_target, active = staged ? active : nothing)
        prep = function (c)
            s.conductivity_loss_per_psi > 0 && rock_regions!(c, L.rocknum)
            isnothing(previous) || carry_state!(c, previous; lowest_pressure = low)
        end
        o = run_deck(deck; outdir = staged ? nothing : outdir, output_substates = true, prepare = prep, kwarg...)   # solver steps, so rate x step is the solver's own volume
        push!(runs, o); previous = o.result
        s.conductivity_loss_per_psi > 0 && (low = lowest_pressure(o.result, low))
        for i in 1:n
            active[i] || continue
            w = Symbol(@sprintf("S%03d", i))
            oil[m0+1:m1, i] = stage_monthly(o.result, w, :orat, STB, m1 - m0); gas[m0+1:m1, i] = stage_monthly(o.result, w, :grat, MSCF, m1 - m0)
            water[m0+1:m1, i] = stage_monthly(o.result, w, :wrat, STB, m1 - m0)
        end
    end
    stages = [(stage = i, position_ft = s.positions_ft[i], half_length_ft = L.eff_half_ft[i], conductivity_mdft = s.conductivity_mdft[i],
        oil_stb = sum(view(oil, :, i)), gas_mscf = sum(view(gas, :, i)), water_stb = sum(view(water, :, i)), start_month = starts[i]) for i in 1:n]
    open(joinpath(outdir, "stages.csv"), "w") do io
        println(io, "stage,position_ft,half_length_on_mesh_ft,conductivity_mdft,cum_oil_stb,cum_gas_mscf,cum_water_stb,start_month")
        for r in stages
            @printf(io, "%d,%.2f,%.2f,%.4g,%.6g,%.6g,%.6g,%d\n", r.stage, r.position_ft, r.half_length_ft, r.conductivity_mdft, r.oil_stb, r.gas_mscf, r.water_stb, r.start_month)
        end
    end
    return (run = runs[end], stages = stages, layout = L, deck = deck, outdir = outdir, monthly_oil_stb = oil, monthly_gas_mscf = gas, monthly_water_stb = water, runs = runs)
end

"Volume produced per calendar month by one stage well of a run: `key` is :orat, :grat or :wrat, `unit` the volume unit to report in."
function stage_monthly(res, w::Symbol, key::Symbol, unit, months)
    q = well_series(res, w, key)
    isnothing(q) && return zeros(months)
    dt = diff(vcat(0.0, res.time))
    m = clamp.(ceil.(Int, (res.time .- 1.0) ./ (MONTH_DAYS * DAY)), 1, months)   # 1 s slack for step-sum round-off
    return [sum((-q .* dt)[m .== k]) / unit for k in 1:months]
end

"""
Reservoir pressure on the model grid at the end of a fractured-well run (or at solver step `step` of its last
period): `psi[i, j]` with cell centres `x_ft[i]` along the lateral (the coordinate of `positions_ft`) and
`y_ft[j]` across the model.
"""
function pressure_field(r; step = nothing)
    L = r.layout; st = r.run.result.states
    p = st[isnothing(step) ? length(st) : step][:Pressure]
    i0 = argmin([t.position_ft for t in r.stages])                # line the cell centres up with the stage positions
    xc = cumsum(L.dx) .- L.dx ./ 2; xc .+= r.stages[i0].position_ft - xc[L.icol[i0]]
    return (psi = reshape(collect(p), L.nx, L.ny) ./ PSI, x_ft = xc, y_ft = cumsum(L.dy) .- L.dy ./ 2)
end

"Oil produced per calendar month (stb) for one stage well of a fracwell result."
function stage_monthly_oil(res, w::Symbol, months)
    dt = diff(vcat(0.0, res.time)); q = -well_series(res, w, :orat)
    m = clamp.(ceil.(Int, (res.time .- 1.0) ./ (MONTH_DAYS * DAY)), 1, months)   # 1 s slack for step-sum round-off
    return [sum((q .* dt)[m .== k]) / STB for k in 1:months]
end
