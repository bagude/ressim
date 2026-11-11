# Ressim: a general-purpose reservoir simulator front end on the JutulDarcy engine.
# Deck in (ECLIPSE-format .DATA), well summary out in field units, plus run statistics.
# The research track in ../stage-sim is separate and is not touched by anything here.
module Ressim

using Jutul, JutulDarcy, HYPRE
using DelimitedFiles, Printf, Dates, TOML

const GeoEnergyIO = JutulDarcy.GeoEnergyIO

# ---- units (engine is SI; reports are field units) ---------------------------------------------
const DAY = 86400.0
const STB = 0.158987294928          # m3
const MSCF = 28.316846592           # m3
const PSI = 6894.757293168          # Pa
const BAR = 1e5
const DARCY = 9.86923266716013e-13  # m2

include("exact.jl")

# ---- run statistics -----------------------------------------------------------------------------
"Solver step counts from a simulation result: accepted ministeps, cut (failed) ministeps, Newton iterations."
function step_stats(res)
    reports = res isa JutulDarcy.ReservoirSimResult ? res.result.reports : res
    ok = 0; cut = 0; its = 0
    for rep in reports, m in rep[:ministeps]
        get(m, :success, true) ? (ok += 1) : (cut += 1)
        its += haskey(m, :steps) ? length(m[:steps]) : 0
    end
    return (ministeps = ok, cuts = cut, newton_iterations = its, report_steps = length(reports))
end

"Lengths (s) of the accepted solver ministeps, in order."
function ministep_lengths(res)
    out = Float64[]
    for rep in res.result.reports, m in rep[:ministeps]
        get(m, :success, true) && push!(out, m[:dt])
    end
    return out
end

# ---- deck runner --------------------------------------------------------------------------------
"Run `f()` with stdout captured; returns (value, captured text). Parser notes are printed, not logged."
function capture_stdout(f)
    path, io = mktemp()
    local val
    try
        redirect_stdout(io) do
            val = f()
        end
    finally
        close(io)
    end
    txt = read(path, String)
    rm(path; force = true)
    return val, txt
end

"Unsupported / partially supported keyword notes from the deck parser, one per keyword."
function parser_notes(txt)
    notes = String[]
    for ln in split(replace(txt, r"\e\[[0-9;]*m" => ""), '\n')
        occursin("Parser", ln) && occursin(r"support|ignored"i, ln) && push!(notes, strip(ln))
    end
    return unique(notes)
end

"""
    run_deck(path; outdir = nothing, kwarg...)

Simulate an ECLIPSE-format input deck. Returns a NamedTuple with the engine result, the case, run
statistics and the parser's notes on keywords it could not honour. With `outdir`, also writes
`summary_field.csv` (field units) and `run.toml`.
"""
function run_deck(path; outdir = nothing, info_level = -1, prepare = nothing, kwarg...)
    t_setup = @elapsed (case, txt) = capture_stdout(() -> setup_case_from_data_file(path))
    isnothing(prepare) || prepare(case)             # a chance to adjust the model the deck cannot fully describe (see rock_regions!)
    notes = parser_notes(txt)
    t_sim = @elapsed res = simulate_reservoir(case; info_level = info_level, kwarg...)
    st = step_stats(res)
    low = fluid_table_note(case, res); isnothing(low) || (notes = vcat(notes, low))
    out = (result = res, case = case, stats = st, notes = notes, setup_seconds = t_setup, wall_seconds = t_sim,
        cells = number_of_cells(reservoir_domain(case)))
    if !isnothing(outdir)
        mkpath(outdir)
        write_summary(joinpath(outdir, "summary_field.csv"), res)
        meta = Dict("deck" => abspath(path), "cells" => out.cells, "report_steps" => st.report_steps,
            "ministeps" => st.ministeps, "cut_ministeps" => st.cuts, "newton_iterations" => st.newton_iterations,
            "setup_seconds" => t_setup, "wall_seconds" => t_sim, "parser_notes" => notes,
            "engine" => "JutulDarcy " * string(pkgversion(JutulDarcy)), "julia" => string(VERSION))
        open(io -> TOML.print(io, meta), joinpath(outdir, "run.toml"), "w")
    end
    return out
end

"""
Lowest pressure at which each fluid table of a reservoir model starts (Pa), found by walking the model's
fluid-property variables for pressure axes. A first node at exactly one atmosphere is skipped: the engine adds it.
"""
function fluid_table_floors(rmodel)
    floors = Float64[]
    function walk(x, depth)
        depth > 6 && return
        for f in fieldnames(typeof(x))
            y = getfield(x, f)
            if y isa AbstractVector{<:Real} && length(y) > 2 && f == :pressure
                v = y[1] == 101325.0 ? y[2:end] : y            # a first node at exactly one atmosphere was added by the engine
                isempty(v) || push!(floors, minimum(v))
            elseif y isa Tuple || (y isa AbstractVector && !(eltype(y) <: Number))
                for z in y
                    isstructtype(typeof(z)) && !(z isa Number) && !(z isa AbstractString) && !(z isa Function) && walk(z, depth + 1)
                end
            elseif isstructtype(typeof(y)) && !(y isa Number) && !(y isa AbstractString) && !(y isa Function) && !(y isa AbstractArray)
                walk(y, depth + 1)
            end
        end
    end
    for k in (:PhaseMassDensities, :ShrinkageFactors, :PhaseViscosities)
        haskey(rmodel.secondary_variables, k) && walk(rmodel.secondary_variables[k], 0)
    end
    return floors
end

"""
A plain-language note if a run took the reservoir below the lowest pressure of one of its fluid tables.
Below a table the engine holds gas properties constant, so almost no more gas is released (found on SPE3).
Returns nothing if the run stayed inside the tables or the check could not be made.
"""
function fluid_table_note(case, res)
    try
        floors = fluid_table_floors(reservoir_model(case.model))
        isempty(floors) && return nothing
        pmin = minimum(minimum(st[:Pressure]) for st in res.states)
        top = maximum(floors)
        pmin < top || return nothing
        return @sprintf("reservoir pressure fell to %.0f psia, below the lowest pressure of a fluid table (%.0f psia); the engine holds gas properties constant below a table, so results past that point are not reliable. Extend the fluid tables.",
            pmin / PSI, top / PSI)
    catch
        return nothing
    end
end

"""
Tell the engine which rock table each cell uses. The engine reads ROCKTAB tables from a deck but takes
the cell-to-table map from PVTNUM, not ROCKNUM, so a deck with one fluid and two rock tables ends up
using the first table everywhere. This sets the map on the permeability multiplier directly, and keeps
the pore volume reversible when the multiplier is permanent.
"""
function rock_regions!(case, rocknum)
    sv = reservoir_model(case.model).secondary_variables
    haskey(sv, :PermeabilityMultiplier) || error("the deck has no rock table with a transmissibility multiplier (ROCKTAB)")
    K = sv[:PermeabilityMultiplier]
    sv[:PermeabilityMultiplier] = (typeof(K).name.wrapper)(K.tab; regions = collect(Int, rocknum))
    # The engine's permanent mode also stops the pore volume from recovering when pressure comes back, in every cell.
    # Only the conductivity is meant to be permanent here, so the pore volume gets the reversible table back.
    V = sv[:FluidVolume]
    V isa JutulDarcy.HystereticTableCompressiblePoreVolume && (sv[:FluidVolume] = JutulDarcy.TableCompressiblePoreVolume(V.tab; regions = V.regions))
    return case
end

"""
Start a case from where an earlier run on the SAME grid ended: pressure, saturations and dissolved gas of
every reservoir cell, and the state of every well that exists in both. `lowest_pressure` (per cell, Pa), if
given, is carried too, so a permanent conductivity loss remembers the earlier drawdown.
"""
function carry_state!(case, previous; lowest_pressure = nothing)
    last = previous isa AbstractDict ? previous : previous.result.states[end]      # a finished run, or a full state
    for (name, st) in case.state0
        haskey(last, name) || continue
        name == :Facility && continue                       # the list of wells may have changed
        for (k, v) in st
            haskey(last[name], k) && size(last[name][k]) == size(v) && (v .= last[name][k])
        end
    end
    if !isnothing(lowest_pressure) && haskey(case.parameters[:Reservoir], :MinPressure)
        case.parameters[:Reservoir][:MinPressure] .= lowest_pressure
    end
    return case
end

"Lowest pressure each cell has seen during a run (Pa), optionally also no higher than an earlier record."
function lowest_pressure(res, earlier = nothing)
    low = reduce((a, b) -> min.(a, b), (st[:Pressure] for st in res.states))
    return isnothing(earlier) ? low : min.(low, earlier)
end

well_series(res, w::Symbol, k::Symbol) = haskey(res.wells.wells[w], k) ? collect(Float64, res.wells.wells[w][k]) : nothing

"Field totals in SI at the result's report times: production positive, injection positive, separate."
function field_totals(res)
    n = length(res.time)
    tot = Dict(k => zeros(n) for k in (:oil_prod, :gas_prod, :water_prod, :oil_inj, :gas_inj, :water_inj))
    for w in keys(res.wells.wells), (k, name) in ((:orat, :oil), (:grat, :gas), (:wrat, :water))
        q = well_series(res, w, k)
        isnothing(q) && continue
        tot[Symbol(name, :_prod)] .+= max.(-q, 0.0)
        tot[Symbol(name, :_inj)] .+= max.(q, 0.0)
    end
    return tot
end

"Write the well and field summary in field units (stb/d, Mscf/d, psi)."
function write_summary(path, res)
    t = res.time ./ DAY
    cols = Any[t]; head = ["time_days"]
    f = field_totals(res)
    for (k, lab, s) in ((:oil_prod, "FIELD:oil_prod_stb_d", DAY / STB), (:gas_prod, "FIELD:gas_prod_mscf_d", DAY / MSCF),
            (:water_prod, "FIELD:water_prod_stb_d", DAY / STB), (:water_inj, "FIELD:water_inj_stb_d", DAY / STB),
            (:gas_inj, "FIELD:gas_inj_mscf_d", DAY / MSCF))
        push!(cols, f[k] .* s); push!(head, lab)
    end
    for w in sort(collect(keys(res.wells.wells)))
        for (k, lab, s) in ((:orat, "oil_stb_d", DAY / STB), (:grat, "gas_mscf_d", DAY / MSCF), (:wrat, "water_stb_d", DAY / STB), (:bhp, "bhp_psi", 1 / PSI))
            q = well_series(res, w, k)
            isnothing(q) && continue
            push!(cols, q .* s); push!(head, "$w:$lab")
        end
    end
    open(path, "w") do io
        println(io, join(head, ","))
        writedlm(io, hcat(cols...), ',')
    end
    return path
end

# ---- comparison measures ------------------------------------------------------------------------
"Linear interpolation of (t, y) at times tq (clamped at the ends)."
function interp1(t, y, tq)
    out = similar(tq, Float64)
    for (i, x) in enumerate(tq)
        j = searchsortedfirst(t, x)
        if j <= 1
            out[i] = y[1]
        elseif j > length(t)
            out[i] = y[end]
        else
            w = (x - t[j-1]) / (t[j] - t[j-1])
            out[i] = (1 - w) * y[j-1] + w * y[j]
        end
    end
    return out
end

"Time-integrated |a - b| over time-integrated |b|, with a (at times ta) interpolated onto the reference times tb."
function series_error(ta, a, tb, b)
    ai = interp1(ta, a, tb)
    dt = diff(vcat(0.0, tb))
    den = sum(abs.(b) .* dt)
    return den == 0 ? (sum(abs.(ai) .* dt) == 0 ? 0.0 : Inf) : sum(abs.(ai .- b) .* dt) / den
end

include("geology.jl")
include("structure.jl")
include("fracwell.jl")
include("fracgrow.jl")
include("heightgrow.jl")
include("layers.jl")
include("multifrac.jl")
include("proppant.jl")
include("surface.jl")
include("lift.jl")
include("pvtlab.jl")
include("field.jl")
include("welltest.jl")
include("dfit.jl")
include("nodal.jl")
include("closure.jl")
include("chain.jl")
include("parentchild.jl")
include("ensemble.jl")
include("match.jl")
include("vfp.jl")
include("eclout.jl")
include("economics.jl")

end # module
