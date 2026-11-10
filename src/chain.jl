# Rock and pumping in, production out: grow every stage's fractures, then run the fractured well.
#
# Predicted: half-length and height of every fracture (heightgrow.jl); with a proppant design, the
# propped half-length and conductivity (proppant.jl); with several clusters in a stage, how the stage
# rate splits between them and how they squeeze each other (multifrac.jl).
# Declared by you when there is no proppant design: conductivity and the conductive share of the
# created length. Not modelled: the stress earlier stages leave behind for later ones, proppant
# settling. The reservoir model is one layer, so only the part of a fracture inside the pay produces.

Base.@kwdef struct StageDesign
    rate_bpm_per_fracture::Float64         # slurry rate per fracture (both wings); a stage with clusters is pumped at this times `clusters`
    minutes::Float64
    viscosity_cp::Float64 = 3.0
    clusters::Int = 1                      # perforation clusters in the stage; each starts one fracture
    cluster_spacing_ft::Float64 = 0.0      # distance between neighbouring clusters, centred on the stage position
    shots_per_cluster::Int = 0             # perforations per cluster; 0 = no perforation friction
    perf_diameter_in::Float64 = 0.4
    discharge::Float64 = 0.7               # about 0.56 for new perforations, 0.9 once eroded by proppant
end

Base.@kwdef struct RockSpec
    barrier_psi::Float64                   # closure stress in the barriers minus closure stress in the pay
    barrier_above_psi::Float64 = NaN       # the same for the rock above only, if it differs (NaN = barrier_psi)
    barrier_below_psi::Float64 = NaN       # the same for the rock below only
    youngs_psi::Float64
    poisson::Float64 = 0.25
    toughness_psi_sqrtin::Float64 = 1000.0
    leakoff_ft_sqrtmin::Float64 = 0.001
end

"""
Proppant for a stage. `schedule` lists (fraction of the pumping time at which it starts, lb per gallon of clean fluid).
`closure_psi` is the stress on the pack once the well is drawn down (closure stress minus flowing pressure).
"""
Base.@kwdef struct ProppantDesign
    schedule::Vector{Tuple{Float64, Float64}}
    diameter_mm::Float64 = 0.2                  # 100 mesh is about 0.15 to 0.2 mm, 40/70 about 0.2 to 0.4 mm
    density::Float64 = 2650.0                   # kg/m3, sand
    pack_porosity::Float64 = 0.35
    closure_psi::Float64 = 4000.0
    stress_coefficient::Float64 = 2.4e-4        # 1/psi, conductivity loss with stress (fit to vendor sand data, see research note)
    bridge::Float64 = 3.0                       # proppant cannot enter where the fracture is narrower than this many grains
    drawdown_loss::Bool = false                 # true: conductivity follows the pressure in each fracture cell and never recovers (see FracWellSpec)
    settling::Bool = true                       # grains settle into a bank at the bottom of the fracture (false: spread evenly over the height)
    fluid_density::Float64 = 1000.0             # kg/m3, carrier fluid, for the settling speed
    equilibrium_velocity_ft_s::Float64 = NaN    # flow speed above the bank at which grains are carried on instead of deposited; NaN: a published rule (see deposit_velocity), Inf: none
end

"""
    design_well(base, rock, designs; propped_fraction = 1.0, proppant = nothing)

Grow the fractures of every stage and return the `FracWellSpec` to simulate, the growth result per
fracture, plain-language notes (for example when a grown fracture is longer than the reservoir model
is wide and had to be cut), the proppant pack per fracture, and `stage_of` (which stage each fracture
belongs to). `base` supplies everything except half-lengths; its thickness is the pay thickness and
its positions are the stage centres. A stage with one cluster gives one fracture, as before; a stage
with several gives one fracture per cluster, grown together.
"""
function design_well(base::FracWellSpec, rock::RockSpec, designs::Vector{StageDesign}; propped_fraction = 1.0, ncell = 400, proppant = nothing, hours_between_stages = 2.0)
    # Stages are pumped in the order listed. Each one feels what the stage before it still holds open after `hours_between_stages`
    # (`Inf`: only its proppant pack; `nothing`: earlier stages are ignored, the behaviour before 2026-11-10).
    # with `proppant` (a ProppantDesign), propped half-length and conductivity come from the model and `propped_fraction` is not used
    n = length(base.positions_ft)
    length(designs) == n || error("one stage design per stage: got $(length(designs)) for $n stages")
    0 < propped_fraction <= 1 || error("propped_fraction must be in (0, 1]")
    cache = Dict{Any, Any}(); previous = nothing; grown = Any[]; notes = String[]; half = Float64[]; cond = Float64[]; shape = Vector{Float64}[]; packs = Any[]
    pos = Float64[]; stage_of = Int[]; cond_in = Float64[]; center = Float64[]
    prop_kw(d) = isnothing(proppant) ? nothing : (schedule = [(f * d.minutes * 60.0, ppa_to_fraction(ppa; density = proppant.density)) for (f, ppa) in proppant.schedule],
        diameter = proppant.diameter_mm * 1e-3, bridge = proppant.bridge,
        settle = proppant.settling ? (v_free = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3),
            n = 4.65, cmax = 1 - proppant.pack_porosity, u_eq = proppant.equilibrium_velocity_ft_s * FT, R = (proppant.density - proppant.fluid_density) / proppant.fluid_density, d = proppant.diameter_mm * 1e-3) : nothing)
    for (i, d) in enumerate(designs)
        d.clusters >= 1 || error("stage $i: clusters must be at least 1")
        offsets = [(k - (d.clusters + 1) / 2) * d.cluster_spacing_ft for k in 1:d.clusters]
        centre = base.positions_ft[i]
        back = isnothing(previous) || isnothing(hours_between_stages) ? nothing :
            [fracture_residual(g.detail; pay = base.thickness_ft * FT, C_L = rock.leakoff_ft_sqrtmin * FT_SQRTMIN, wait = min(hours_between_stages, 1e6) * 3600.0,
                pack_porosity = isnothing(proppant) ? 0.35 : proppant.pack_porosity, position = (previous.centre + previous.offsets[k]) * FT) for (k, g) in enumerate(previous.gs)]
        # the same design after the same kind of neighbour, at the same distance, gives the same fractures: solve it once
        key = (d, isnothing(back) ? nothing : (previous.d, round(centre - previous.centre, digits = 6)))
        gs = get!(cache, key) do
            above = isnan(rock.barrier_above_psi) ? rock.barrier_psi : rock.barrier_above_psi; below = isnan(rock.barrier_below_psi) ? rock.barrier_psi : rock.barrier_below_psi
            d.clusters == 1 || d.cluster_spacing_ft > 0 || error("stage $i: cluster_spacing_ft must be positive when a stage has several clusters")
            grow_stage_clusters(; pay_ft = base.thickness_ft, barrier_psi = rock.barrier_psi, barrier_above_psi = above, barrier_below_psi = below, toughness_psi_sqrtin = rock.toughness_psi_sqrtin,
                youngs_psi = rock.youngs_psi, poisson = rock.poisson, viscosity_cp = d.viscosity_cp, stage_rate_bpm = d.rate_bpm_per_fracture * d.clusters,
                minutes = d.minutes, leakoff_ft_sqrtmin = rock.leakoff_ft_sqrtmin, cluster_positions_ft = centre .+ offsets, shots = d.shots_per_cluster,
                perf_diameter_in = d.perf_diameter_in, discharge = d.discharge, ncell = ncell, proppant = prop_kw(d), background = back).clusters
        end
        previous = (gs = gs, d = d, centre = centre, offsets = offsets)
        if d.clusters > 1
            sh = [g.fluid_share for g in gs]
            maximum(sh) > 1.1 * minimum(sh) && push!(notes, @sprintf("stage %d: the clusters took %s%% of the fluid (an even split would be %.0f%% each)%s", i, join([@sprintf("%.0f", 100 * x) for x in sh], " / "),
                100 / d.clusters, d.shots_per_cluster == 0 ? "; no perforation friction was given, which is what evens the split in practice" : ""))
        end
        abs(gs[1].above_pay_ft - gs[1].below_pay_ft) > 1 && push!(notes, @sprintf("stage %d: at the well the fracture reaches %.0f ft above the pay and %.0f ft below it", i, gs[1].above_pay_ft, gs[1].below_pay_ft))
        for (k, g) in enumerate(gs)
            label = d.clusters == 1 ? "stage $i" : "stage $i cluster $k"
            push!(grown, g); push!(stage_of, i); push!(pos, base.positions_ft[i] + offsets[k]); push!(cond_in, base.conductivity_mdft[i])
            isempty(base.center_ft) || push!(center, base.center_ft[i])
            for nt in g.notes
                push!(notes, label * ": " * nt)
            end
            h = g.half_length_ft * propped_fraction
            pk = nothing
            if !isnothing(proppant)
                pk = propped_profile(g.detail; pay = base.thickness_ft * FT, diameter = proppant.diameter_mm * 1e-3, density = proppant.density,
                    pack_porosity = proppant.pack_porosity, closure_psi = proppant.closure_psi, stress_coefficient = proppant.stress_coefficient, settled = proppant.settling)
                h = pk.propped_half_length / FT
                h > 0 || error(label * (proppant.settling ? ": no proppant bank stands inside the pay (it settled below the pay, or too little was pumped)" :
                    ": no part of the fracture holds a full grain of proppant; raise the concentration or shorten the pad"))
                fall_ft = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, mu = d.viscosity_cp * 1e-3) * d.minutes * 60 / FT
                if k == 1                                      # the same for every cluster of a stage: say it once
                    if !proppant.settling
                        fall_ft = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3) * d.minutes * 60 / FT
                        fall_ft > g.height_at_well_ft && push!(notes, @sprintf("stage %d: a grain would settle about %.0f ft during pumping, more than the %.0f ft fracture height; it will bank at the bottom, so the even spread assumed here overstates propped length",
                            i, fall_ft, g.height_at_well_ft))
                    end
                    first_pack = minimum(x.detail.first_pack_time for x in gs)
                    if proppant.settling
                        lost = sum(x.detail.proppant_rejected for x in gs) / max(sum(x.detail.proppant_pumped for x in gs), 1e-300)
                        lost > 0.005 && push!(notes, @sprintf("stage %d: %.0f%% of the proppant could not be placed: the fracture packed off back to the well %.0f min into the job (screen-out). A real job would have stopped there; the flow model does not feel it",
                            i, 100 * lost, first_pack / 60))
                    else
                        isfinite(first_pack) && push!(notes, @sprintf("stage %d: proppant reached packing concentration %.0f min into the job (screen-out); the flow model does not feel it", i, first_pack / 60))
                    end
                end
                proppant.settling && pk.share_in_pay < 0.8 && push!(notes, @sprintf("%s: only %.0f%% of the placed proppant ended inside the pay; the rest sits in the part of the fracture outside it", label, 100 * pk.share_in_pay))
            end
            if h > base.width_ft / 2
                push!(notes, @sprintf("%s: grown half-length %.0f ft is longer than the model half-width %.0f ft and was cut to it; widen the model or the result understates this fracture",
                    label, h, base.width_ft / 2))
                h = base.width_ft / 2
            end
            g.share_in_pay < 0.9 && push!(notes, @sprintf("%s: only %.0f%% of the fracture face is inside the pay; the rest grew into the barriers and does not produce in this one-layer model",
                label, 100 * g.share_in_pay))
            push!(half, h); push!(packs, pk)
            if !isnothing(pk)                                  # conductivity at the well, and its shape out to the (possibly cut) tip
                xs = range(0.0, h * FT, length = 21)
                cv = [pk.conductivity_mdft[clamp(floor(Int, x / g.detail.dx) + 1, 1, length(pk.x))] for x in xs]
                push!(cond, max(cv[1], 1e-6)); push!(shape, cv ./ max(cv[1], 1e-6))
            end
        end
    end
    issorted(pos) || error("clusters of neighbouring stages overlap along the well: reduce cluster_spacing_ft or move the stages apart")
    kw = Dict{Symbol, Any}(f => getfield(base, f) for f in fieldnames(FracWellSpec))
    kw[:positions_ft] = pos; kw[:half_length_ft] = half; kw[:conductivity_mdft] = cond_in; kw[:center_ft] = center
    if !isnothing(proppant)
        kw[:conductivity_mdft] = cond; kw[:conductivity_shape] = shape
        if proppant.drawdown_loss        # `closure_psi` is the stress on the pack at the flowing pressure; start from the stress at initial pressure and let the run lower it
            kw[:conductivity_mdft] = cond .* exp(proppant.stress_coefficient * (base.pressure_psi - base.bhp_psi))
            kw[:conductivity_loss_per_psi] = proppant.stress_coefficient
        end
    end
    return (spec = FracWellSpec(; kw...), growth = grown, notes = notes, packs = packs, stage_of = stage_of)
end

"Load a design file: `[well]`, `[rock]`, `[pumping]`, optional `[proppant]`. Returns base, rock, designs, propped fraction, proppant design, hours between stages."
function load_design(path)
    d = TOML.parsefile(path)
    w = copy(d["well"]); n = length(w["positions_ft"])
    w["half_length_ft"] = fill(1.0, n)                       # placeholder, replaced by the growth result
    tmp = tempname() * ".toml"
    open(io -> TOML.print(io, w), tmp, "w")
    base = load_fracwell(tmp); rm(tmp; force = true)
    r = d["rock"]
    rock = RockSpec(; (Symbol(k) => Float64(v) for (k, v) in r)...)
    pu = d["pumping"]
    per(key, default) = (v = get(pu, key, default); v isa AbstractVector ? Float64.(v) : fill(Float64(v), n))
    rates = per("rate_bpm_per_fracture", 10.0); mins = per("minutes", 60.0); visc = per("viscosity_cp", 3.0)
    ncl = per("clusters", 1); spc = per("cluster_spacing_ft", 0.0); shots = per("shots_per_cluster", 0); pdia = per("perf_diameter_in", 0.4); cd = per("discharge", 0.7)
    designs = [StageDesign(rate_bpm_per_fracture = rates[i], minutes = mins[i], viscosity_cp = visc[i], clusters = round(Int, ncl[i]), cluster_spacing_ft = spc[i],
        shots_per_cluster = round(Int, shots[i]), perf_diameter_in = pdia[i], discharge = cd[i]) for i in 1:n]
    prop = nothing
    if haskey(d, "proppant")
        pr = d["proppant"]
        sch = [(Float64(a), Float64(b)) for (a, b) in zip(pr["start_fraction"], pr["ppa"])]
        prop = ProppantDesign(; schedule = sch, (Symbol(k) => Float64(v) for (k, v) in pr if !(k in ("start_fraction", "ppa")))...)
    end
    hours = get(pu, "hours_between_stages", 2.0)             # a negative number in the file means: ignore earlier stages
    return base, rock, designs, Float64(get(pu, "propped_fraction", 1.0)), prop, (hours < 0 ? nothing : Float64(hours))
end
