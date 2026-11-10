# Frac Challenge simulation worker: one long-lived Julia process so each player run skips start-up.
# Reads tab-separated requests on stdin, one per line:
#   RUN <spec.toml> <outdir> <oil_rate_target_stb_d or ->
# Replies on stdout with lines prefixed "@@" (anything else on stdout is engine chatter and ignored):
#   @@READY            after Ressim is loaded and compiled
#   @@OK <seconds> <cells>
#   @@ERR <message>
# Also writes field.json (pressure and gas saturation per cell by month) from the run's own result.
# Only public Ressim entry points are used (load_fracwell, run_fracwell); nothing in src/ is changed.
const ROOT = normpath(joinpath(@__DIR__, ".."))
include(joinpath(ROOT, "src", "Ressim.jl"))
using .Ressim

reply(s) = (println(stdout, "@@", s); flush(stdout))

const PSI_PA = 6894.757293168
const MONTH_S = 30.4375 * 86400.0

fmtv(io, v, digits) = (print(io, "["); for (k, x) in enumerate(v); k > 1 && print(io, ","); print(io, round(x; digits = digits)); end; print(io, "]"))

"""Write field.json: pressure (and gas saturation) per cell at the start and at every month end.
Cells are row-major with x (along the lateral) fastest; y is measured from the well centreline."""
function write_field(r, spec, outdir)
    L = r.layout; res = r.run.result
    nx, ny = L.nx, L.ny; nc = nx * ny
    length(res.states[end][:Pressure]) == nc || return false          # inactive cells would break the layout
    xe = vcat(0.0, cumsum(L.dx)); ye = vcat(0.0, cumsum(L.dy)) .- spec.width_ft / 2
    mask = zeros(Int, nc)
    for (k, rows) in enumerate(L.rows), j in rows
        mask[(j - 1) * nx + L.icol[k]] = k
    end
    snaps = [m for m in 1:spec.months if spec.months <= 36 || m <= 12 || m % 6 == 0 || m == spec.months]   # thin long runs
    idx = [argmin(abs.(res.time .- m * MONTH_S)) for m in snaps]
    sat = haskey(res.states[end], :Saturations) && size(res.states[end][:Saturations], 1) == 3
    open(joinpath(outdir, "field.json.tmp"), "w") do io
        print(io, "{\"nx\":", nx, ",\"ny\":", ny, ",\"x_edges_ft\":"); fmtv(io, xe, 2)
        print(io, ",\"y_edges_ft\":"); fmtv(io, ye, 2)
        print(io, ",\"frac_mask\":[", join(mask, ","), "],\"months\":[", join(vcat(0, snaps), ","), "]")
        print(io, ",\"initial_pressure_psi\":", spec.pressure_psi, ",\"bhp_psi\":", spec.bhp_psi)
        print(io, ",\"pressure_psi\":[")
        fmtv(io, fill(spec.pressure_psi, nc), 1)
        for i in idx
            print(io, ","); fmtv(io, res.states[i][:Pressure] ./ PSI_PA, 1)
        end
        print(io, "]")
        if sat
            print(io, ",\"sg\":["); fmtv(io, zeros(nc), 3)
            for i in idx
                print(io, ","); fmtv(io, res.states[i][:Saturations][3, :], 3)
            end
            print(io, "]")
        end
        print(io, "}")
    end
    mv(joinpath(outdir, "field.json.tmp"), joinpath(outdir, "field.json"); force = true)
    return true
end

function handle(line)
    parts = split(chomp(line), '\t')
    parts[1] == "CALL" && length(parts) == 4 && return handle_call(parts)
    parts[1] == "RUN" && length(parts) == 4 || return reply("ERR bad request")
    spec = Ressim.load_fracwell(parts[2])
    mf = joinpath(dirname(parts[2]), "maps.txt")     # a section's net pay and water saturation as constant maps (exact map path)
    if isfile(mf)
        n, w = parse.(Float64, split(strip(read(mf, String))))
        kw = Dict{Symbol, Any}(f => getfield(spec, f) for f in fieldnames(Ressim.FracWellSpec))
        kw[:net_thickness_map] = (x, y) -> n; kw[:sw_map] = (x, y) -> w
        spec = Ressim.FracWellSpec(; kw...)
    end
    target = parts[4] == "-" ? nothing : parse(Float64, parts[4])
    t0 = time()
    r = Ressim.run_fracwell(spec; outdir = parts[3], oil_rate_target = target)
    ok = try
        write_field(r, spec, parts[3])
    catch e                                   # the field is a bonus; never fail a run over it
        println("field output skipped: ", sprint(showerror, e)); false
    end
    ok || write(joinpath(parts[3], "field.skipped"), "no field output for this run")
    reply("OK $(round(time() - t0, digits = 2)) $(r.run.cells)")
end

# ---- CALL <kind> <input.toml> <output.json>: minigame physics through public Ressim functions -------------
using TOML

jsonv(io, x::AbstractDict) = (print(io, "{"); for (i, (k, v)) in enumerate(x); i > 1 && print(io, ","); jsonv(io, string(k)); print(io, ":"); jsonv(io, v); end; print(io, "}"))
jsonv(io, x::NamedTuple) = jsonv(io, Dict(string(k) => v for (k, v) in pairs(x)))
jsonv(io, x::AbstractVector) = (print(io, "["); for (i, v) in enumerate(x); i > 1 && print(io, ","); jsonv(io, v); end; print(io, "]"))
jsonv(io, x::AbstractMatrix) = jsonv(io, [x[i, :] for i in 1:size(x, 1)])
jsonv(io, x::Tuple) = jsonv(io, collect(x))
jsonv(io, x::AbstractString) = print(io, "\"", replace(x, "\\" => "\\\\", "\"" => "\\\"", "\n" => " "), "\"")
jsonv(io, x::Bool) = print(io, x ? "true" : "false")
jsonv(io, x::Integer) = print(io, x)
jsonv(io, x::Real) = isfinite(x) ? print(io, round(Float64(x); sigdigits = 7)) : print(io, "null")
jsonv(io, ::Nothing) = print(io, "null")
jsonv(io, x::Symbol) = jsonv(io, string(x))
jsonv(io, x) = jsonv(io, string(x))

spec_from(d) = (kw = Dict{Symbol, Any}(); for (k, v) in d
        if k == "net_ft"                       # a section's mapped net pay and water saturation: constant maps, the exact map path
            kw[:net_thickness_map] = let n = Float64(v); (x, y) -> n; end; continue
        elseif k == "sw"
            kw[:sw_map] = let w = Float64(v); (x, y) -> w; end; continue
        end
        T = fieldtype(Ressim.FracWellSpec, Symbol(k))
        kw[Symbol(k)] = T <: Vector{Vector{Float64}} ? [Float64.(x) for x in v] : T <: Vector ? Float64.(v) : convert(T, v)
    end; Ressim.FracWellSpec(; kw...))

"Monthly volumes from a result's report steps: oil, gas, water (stb, Mscf, stb) per calendar month for every well summed."
function monthly(res, months)
    t = res.time; dt = diff(vcat(0.0, t))
    tot = Ressim.field_totals(res)
    m = clamp.(ceil.(Int, (t .- 1.0) ./ (Ressim.MONTH_DAYS * Ressim.DAY)), 1, months)
    f(k, u) = [sum((tot[k] .* dt)[m .== i]) / u for i in 1:months]
    return Dict("oil" => f(:oil_prod, Ressim.STB), "gas" => f(:gas_prod, Ressim.MSCF), "water" => f(:water_prod, Ressim.STB))
end

function call_grow(d)
    pp = get(d, "proppant", nothing)
    psched = isnothing(pp) ? nothing : (schedule = [(Float64(s[1]) * d["minutes"] * 60.0, Ressim.ppa_to_fraction(Float64(s[2]))) for s in pp["schedule"]],
        diameter = pp["diameter_mm"] * 1e-3, bridge = get(pp, "bridge", 3.0))
    haskey(d, "cluster_positions_ft") && return call_grow_clusters(d, pp, psched)
    g = try
        Ressim.grow_stage_barriers(; pay_ft = d["pay_ft"], barrier_psi = d["barrier_psi"], youngs_psi = d["youngs_psi"],
            poisson = get(d, "poisson", 0.25), toughness_psi_sqrtin = get(d, "toughness_psi_sqrtin", 1000.0),
            leakoff_ft_sqrtmin = get(d, "leakoff_ft_sqrtmin", 0.001), viscosity_cp = d["viscosity_cp"], rate_bpm = d["rate_bpm"],
            minutes = d["minutes"], ncell = get(d, "ncell", 200), proppant = psched)
    catch e
        msg = sprint(showerror, e)
        occursin("height runaway", msg) && return Dict("runaway" => true, "message" => msg)
        rethrow()
    end
    r = g.detail
    out = Dict{String, Any}("runaway" => false, "half_length_ft" => g.half_length_ft, "height_at_well_ft" => g.height_at_well_ft,
        "share_in_pay" => g.share_in_pay, "inlet_width_in" => g.inlet_width_in, "net_pressure_psi" => g.net_pressure_psi,
        "efficiency" => g.efficiency, "notes" => g.notes,
        "history" => Dict("t_min" => r.t ./ 60, "half_length_ft" => r.L ./ Ressim.FT, "net_pressure_psi" => r.p0 ./ Ressim.PSI,
                          "height_at_well_ft" => r.h0 ./ Ressim.FT),
        "profile" => Dict("x_ft" => r.x ./ Ressim.FT, "height_ft" => r.height ./ Ressim.FT))
    if !isnothing(pp)
        pk = Ressim.propped_profile(r; pay = d["pay_ft"] * Ressim.FT, diameter = pp["diameter_mm"] * 1e-3, closure_psi = get(pp, "closure_psi", 4000.0))
        fall = Ressim.settling_velocity(pp["diameter_mm"] * 1e-3; mu = d["viscosity_cp"] * 1e-3) * d["minutes"] * 60 / Ressim.FT
        out["propped"] = Dict("half_length_ft" => pk.propped_half_length / Ressim.FT, "conductivity_mdft" => pk.conductivity_mdft,
            "x_ft" => pk.x ./ Ressim.FT, "settle_ft" => fall, "first_pack_min" => isfinite(r.first_pack_time) ? r.first_pack_time / 60 : nothing,
            "proppant_pumped_m3" => r.proppant_pumped, "proppant_in_fracture_m3" => r.proppant_in_fracture)
    end
    return out
end

"Several clusters in one stage (multifrac.jl): the fluid split, perforation friction and stress shadow are solved."
function call_grow_clusters(d, pp, psched)
    settled = !isnothing(pp) && get(pp, "settling", false)
    if settled      # grains settle into a bank during pumping (proppant.jl); only the bank inside the pay conducts
        dm = pp["diameter_mm"] * 1e-3
        psched = merge(psched, (settle = (v_free = Ressim.settling_velocity(dm; density = 2650.0, fluid_density = 1000.0, mu = d["viscosity_cp"] * 1e-3),
                                          n = 4.65, cmax = 0.65, u_eq = Inf),))
    end
    g = try
        Ressim.grow_stage_clusters(; pay_ft = d["pay_ft"], barrier_psi = d["barrier_psi"], youngs_psi = d["youngs_psi"],
            poisson = get(d, "poisson", 0.25), toughness_psi_sqrtin = get(d, "toughness_psi_sqrtin", 1000.0),
            leakoff_ft_sqrtmin = get(d, "leakoff_ft_sqrtmin", 0.001), viscosity_cp = d["viscosity_cp"], stage_rate_bpm = d["stage_rate_bpm"],
            minutes = d["minutes"], cluster_positions_ft = Float64.(d["cluster_positions_ft"]), shots = get(d, "shots", 0),
            perf_diameter_in = get(d, "perf_diameter_in", 0.4), ncell = get(d, "ncell", 200), proppant = psched)
    catch e
        msg = sprint(showerror, e)
        occursin("height runaway", msg) && return Dict("runaway" => true, "message" => msg)
        (occursin("did not converge", msg) || occursin("outran the grid", msg) || occursin("unstable", msg)) &&
            return Dict("runaway" => false, "failed" => true, "message" => first(msg, 400))
        rethrow()
    end
    cl = map(g.clusters) do c
        r = c.detail
        o = Dict{String, Any}("half_length_ft" => c.half_length_ft, "height_at_well_ft" => c.height_at_well_ft, "share_in_pay" => c.share_in_pay,
            "inlet_width_in" => c.inlet_width_in, "net_pressure_psi" => c.net_pressure_psi, "efficiency" => c.efficiency,
            "fluid_share" => c.fluid_share, "perf_drop_psi" => c.perf_drop_psi, "shadow_psi" => c.shadow_psi,
            "above_pay_ft" => c.above_pay_ft, "below_pay_ft" => c.below_pay_ft,
            "history" => Dict("t_min" => r.t ./ 60, "half_length_ft" => r.L ./ Ressim.FT, "net_pressure_psi" => r.p0 ./ Ressim.PSI,
                              "height_at_well_ft" => r.h0 ./ Ressim.FT),
            "profile" => Dict("x_ft" => r.x ./ Ressim.FT, "height_ft" => r.height ./ Ressim.FT))
        if !isnothing(pp)
            pk = Ressim.propped_profile(r; pay = d["pay_ft"] * Ressim.FT, diameter = pp["diameter_mm"] * 1e-3, closure_psi = get(pp, "closure_psi", 4000.0),
                                        settled = settled)
            o["propped"] = Dict("half_length_ft" => pk.propped_half_length / Ressim.FT, "conductivity_mdft" => pk.conductivity_mdft,
                "share_in_pay" => pk.share_in_pay, "settled" => settled,
                "bank_height_ft" => settled ? pk.bank_height ./ Ressim.FT : nothing, "bank_height_in_pay_ft" => settled ? pk.bank_height_in_pay ./ Ressim.FT : nothing,
                "proppant_banked_m3" => settled ? sum(r.proppant_banked) * r.dx : nothing,
                "x_ft" => pk.x ./ Ressim.FT, "first_pack_min" => isfinite(r.first_pack_time) ? r.first_pack_time / 60 : nothing,
                "proppant_pumped_m3" => r.proppant_pumped, "proppant_in_fracture_m3" => r.proppant_in_fracture)
        end
        o
    end
    return Dict{String, Any}("runaway" => false, "clusters" => cl, "wellbore_net_psi" => g.wellbore_net_psi)
end

"The career's hidden rock: f7's synthetic_geology (gross and net-to-gross are fields; net = gross x ntg), as plain grids."
function call_geology(d)
    nx, ny, cell = Int(d["nx"]), Int(d["ny"]), Float64(d["cell_ft"])
    g = Ressim.synthetic_geology(; nx = nx, ny = ny, cell_ft = cell, range_ft = Float64(d["range_ft"]), seed = Int(d["seed"]),
        porosity = (mean = Float64(d["phi_mean"]), sd = Float64(d["phi_sd"])),
        perm_md = (median = Float64(d["perm_median_md"]), decades = Float64(d["perm_decades"]), correlation = 0.7),
        gross_ft = (mean = Float64(d["gross_mean_ft"]), sd = Float64(d["gross_sd_ft"])),
        net_to_gross = (mean = Float64(d["ntg_mean"]), sd = Float64(d["ntg_sd"])),
        sw = (mean = Float64(d["sw_mean"]), sd = Float64(d["sw_sd"]), correlation = -0.6))
    grid(f) = [f.values[i, j] for j in 1:ny, i in 1:nx]          # rows of y, columns of x
    f0 = g.fields[:net_ft]
    return Dict("nx" => nx, "ny" => ny, "cell_ft" => cell, "x0" => f0.x0, "y0" => f0.y0, "dx" => f0.dx, "dy" => f0.dy,
        "porosity" => grid(g.fields[:porosity]), "perm_md" => grid(g.fields[:perm_md]), "net_ft" => grid(f0), "sw" => grid(g.fields[:sw]),
        "gross_ft" => grid(g.fields[:gross_ft]))
end

"The career's structure (top of pay with faults), rebuilt from its seed: fault list, faulted tops at points, or a lateral."
function call_structure(d)
    nx, ny, cell, seed = Int(d["nx"]), Int(d["ny"]), Float64(d["cell_ft"]), Int(d["seed"])
    W, H = (nx - 1) * cell, (ny - 1) * cell
    fs = Ressim.synthetic_faults(; n = Int(d["n_faults"]), seed = seed + 31, x_extent = (0.0, W), y_extent = (0.0, H))
    S = Ressim.synthetic_structure(; nx = nx, ny = ny, cell_ft = cell, seed = seed + 37, top_ft = Float64(d["top_ft"]),
        dip_deg = Float64(d["dip_deg"]), dip_azimuth_deg = Float64(d["dip_azimuth_deg"]), residual_ft = Float64(d["residual_ft"]),
        residual_range_ft = Float64(d["residual_range_ft"]), faults = fs)
    mode = d["mode"]
    if mode == "faults"
        return Dict("faults" => [Dict("trace" => [[p[1], p[2]] for p in f.trace], "throw_ft" => f.throw_ft, "multiplier" => f.multiplier)
                                 for f in S.faults])
    elseif mode == "tops"
        return Dict("top_tvd" => [Ressim.top_at(S, Float64(p[1]), Float64(p[2])) for p in d["points"]])
    elseif mode == "lateral"
        r = Ressim.lateral_structure(S; origin_ft = (Float64(d["x_ft"]), Float64(d["y_ft"])), azimuth_deg = Float64(d["azimuth_deg"]),
                                     length_ft = Float64(d["length_ft"]), step_ft = 10.0, gross = Float64(d["gross_ft"]))
        return Dict("md" => r.md, "top_tvd" => r.top_tvd, "crossings" => [Dict("md" => c.md, "throw_ft" => c.throw_ft, "fault" => c.fault) for c in r.crossings])
    end
    error("structure: unknown mode $mode")
end

function call_bhpsched(d, outdir)
    s = spec_from(d["spec"])
    steps = Ressim.fracwell_tstep(s)
    mb = Float64.(d["monthly_bhp_psi"])
    sched = Float64[]; t = 0.0
    for dt in steps
        m = clamp(floor(Int, (t + 1e-6) / Ressim.MONTH_DAYS) + 1, 1, length(mb)); push!(sched, mb[m]); t += dt
    end
    r = Ressim.run_fracwell(s; outdir = outdir, bhp_schedule = sched)
    return Dict("monthly" => monthly(r.run.result, s.months), "cells" => r.run.cells)
end

function lift_for(w)
    kind = get(w, "lift", "natural")
    depth = get(w, "depth_ft", 9000.0); idin = get(w, "tubing_id_in", 2.441)
    if kind == "natural"
        return Ressim.driftflux_lift(; depth_ft = depth, id_in = idin)
    elseif kind == "gas_lift"
        inj = Float64(w["gas_injection_mscf_d"])
        base = Ressim.driftflux_lift(; depth_ft = depth, id_in = idin)
        return (pn, qo, qw, qg) -> base(pn, qo, qw, qg + inj)
    elseif kind == "pump"
        intake = Float64(w["pump_intake_psi"])
        return (pn, qo, qw, qg) -> intake
    end
    error("unknown lift '$kind'")
end

function call_marching(d, outdir)
    s = spec_from(d["spec"])
    sf = Ressim.SurfaceSpec(separator_psi = get(d, "separator_psi", 100.0), lift = lift_for(d))
    r = Ressim.run_fracwell_marching(s, sf; outdir = outdir)
    return Dict("bhp_psi" => r.bhp_psi, "oil_stb_d" => r.oil_stb_d, "gas_mscf_d" => r.gas_mscf_d, "water_stb_d" => r.water_stb_d,
        "step_days" => r.step_days, "time_days" => r.time_days, "mismatch_psi" => r.mismatch_psi)
end

function call_field(d, outdir)
    wells = [spec_from(w) for w in d["wells"]]
    tub = Function[]
    for w in d["tubing"]
        push!(tub, Ressim.liquid_tubing(; depth_ft = w["depth_ft"], id_in = w["id_in"], density_lb_ft3 = get(w, "density_lb_ft3", 50.0),
            viscosity_cp = get(w, "viscosity_cp", 1.0)))
    end
    fs = Ressim.FieldSpec(wells = wells, tubing = tub, separator_psi = d["separator_psi"], oil_cap_stb_d = get(d, "oil_cap_stb_d", Inf),
        allocation = Symbol(get(d, "allocation", "common_choke")), priority = Int.(get(d, "priority", collect(1:length(wells)))))
    r = Ressim.run_field(fs; outdir = outdir)
    return Dict("node_psi" => r.node_psi, "oil_stb_d" => r.oil_stb_d, "gas_mscf_d" => r.gas_mscf_d, "bhp_psi" => r.bhp_psi,
        "facility_full" => r.facility_full, "time_days" => r.time_days, "step_days" => r.step_days, "monthly_oil_stb" => r.monthly_oil_stb,
        "mismatch_psi" => r.mismatch_psi)
end

function handle_call(parts)
    kind, inp, outp = parts[2], parts[3], parts[4]
    d = TOML.parsefile(inp)
    outdir = dirname(outp)
    t0 = time()
    res = kind == "grow" ? call_grow(d) : kind == "bhpsched" ? call_bhpsched(d, outdir) : kind == "marching" ? call_marching(d, outdir) :
          kind == "field" ? call_field(d, outdir) : kind == "geology" ? call_geology(d) : kind == "structure" ? call_structure(d) : error("unknown call '$kind'")
    open(outp * ".tmp", "w") do io
        jsonv(io, res)
    end
    mv(outp * ".tmp", outp; force = true)
    reply("OK $(round(time() - t0, digits = 2)) 0")
end

# compile once on a tiny case so the first player run is quick
let warm = mktempdir()
    spec = Ressim.FracWellSpec(name = "warmup", mesh = "coarse", months = 1, positions_ft = [100.0], half_length_ft = [100.0],
        conductivity_mdft = [20.0], width_ft = 400.0)
    Ressim.run_fracwell(spec; outdir = warm)
    Ressim.run_fracwell(spec; outdir = warm, oil_rate_target = 50.0)
end
reply("READY")

for line in eachline(stdin)
    isempty(strip(line)) && continue
    strip(line) == "QUIT" && break
    try
        handle(line)
    catch e
        reply("ERR " * replace(sprint(showerror, e), r"\s+" => " ")[1:min(end, 400)])
    end
end
