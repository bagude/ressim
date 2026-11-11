# Rock and pumping in, production out: grow every stage's fractures, then run the fractured well.
#
# Predicted: half-length and height of every fracture (heightgrow.jl); with a proppant design, the
# propped half-length and conductivity (proppant.jl); with several clusters in a stage, how the stage
# rate splits between them and how they squeeze each other (multifrac.jl).
# Declared by you when there is no proppant design: conductivity and the conductive share of the
# created length. With a one-layer reservoir model only the part of a fracture inside the pay
# produces. With `layers` in the base spec, the pay is a zone `pay_ft` thick centred on the lateral,
# and the height each fracture reaches above and below it decides which layers it drains (without a
# proppant design: the whole created height; with one: each layer conducts in proportion to the pack
# that ended in it, summed along the fracture; along the fracture all layers share the shape of the best one).

Base.@kwdef struct StageDesign
    rate_bpm_per_fracture::Float64         # slurry rate per fracture (both wings); a stage with clusters is pumped at this times `clusters`
    minutes::Float64
    viscosity_cp::Float64 = 3.0
    clusters::Int = 1                      # perforation clusters in the stage; each starts one fracture
    cluster_spacing_ft::Float64 = 0.0      # distance between neighbouring clusters, centred on the stage position
    shots_per_cluster::Int = 0             # perforations per cluster; 0 = no perforation friction
    perf_diameter_in::Float64 = 0.4
    discharge::Float64 = 0.7               # about 0.56 for new perforations, 0.9 once eroded by proppant
    # Optional pump schedule in steps, pumped one after another: a list of (minutes = , rate_bpm_per_fracture = , viscosity_cp = ,
    # ppa = ) where anything but `minutes` may be left out (the values above; no sand). A pad, a sand ramp and a flush are three
    # or more steps; a step with zero rate is a pause. With steps, `minutes` above is not used (the job lasts as long as its
    # steps), and the sand comes from the steps' `ppa`: the schedule of the `ProppantDesign` is not used, only its grains.
    # `viscosity_cp` above stays the fluid that is taken to carry the sand when the fracture closes.
    steps::Vector{Any} = Any[]
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
    # The flow feels the proppant: slurry thickens with concentration, a packed cell lets fluid through only as a porous pack, and
    # above a bank only the open part of the cross-section flows. A tip that packs off then stops, and the pressure behind it rises.
    # Off by default (results as before 2026-11-10). With it on, use at least 250 cells (`ncell`): on coarser grids the pack is breached.
    flow_feedback::Bool = false
    # With settling: the sand still in suspension at shut-in falls only as far as it can before the fracture closes on it
    # (closure.jl), instead of all the way to the bottom of its cross-section. It matters in leaky rock, where the fracture
    # closes within minutes, for thick fluid that still holds its sand at shut-in, and for a fracture that has grown far below the
    # pay. On by default since 2026-11-10; `false` gives the older rule (everything falls to the bottom, however long that takes).
    settle_until_closure::Bool = true
    net_pressure_limit_psi::Float64 = NaN       # with flow_feedback: stop the job when the pressure in the casing is this far above the pay's closure stress (NaN: never)
end

"How long a stage design is pumped (minutes): its own `minutes`, or the sum of its steps."
job_minutes(d::StageDesign) = isempty(d.steps) ? d.minutes : sum(Float64(st.minutes) for st in d.steps)

"""
Grow a stage whose design is a schedule in steps (`StageDesign.steps`) and return what `grow_stage_clusters` returns.
The grid is planned for the whole schedule at its highest rate and thinnest fluid. A step that passes the pressure limit, or
ends the job, is the last one pumped.
"""
function grow_stage_steps(d::StageDesign, proppant; feedback = NamedTuple(), common...)
    rate(st) = Float64(get(st, :rate_bpm_per_fracture, d.rate_bpm_per_fracture)) * d.clusters
    visc(st) = Float64(get(st, :viscosity_cp, d.viscosity_cp)); ppa(st) = Float64(get(st, :ppa, 0.0))
    any(st -> rate(st) > 0, d.steps) || error("a stage's steps pump nothing: every rate is zero")
    any(st -> ppa(st) > 0, d.steps) && isnothing(proppant) && error("a stage's steps pump sand (ppa) but no proppant design was given for the grains")
    grains = isnothing(proppant) ? nothing : (diameter_mm = proppant.diameter_mm, density = proppant.density, fluid_density = proppant.fluid_density, pack_porosity = proppant.pack_porosity,
        bridge = proppant.bridge, settling = proppant.settling, equilibrium_velocity_ft_s = proppant.equilibrium_velocity_ft_s)
    job = start_stage(; common..., plan_minutes = job_minutes(d), plan_rate_bpm = maximum(rate(st) for st in d.steps), plan_viscosity_cp = minimum(visc(st) for st in d.steps if rate(st) > 0),
        proppant = grains, feedback...)
    for st in d.steps
        job, ro = pump_step(job; minutes = Float64(st.minutes), rate_bpm = rate(st), viscosity_cp = visc(st), ppa = ppa(st))
        (ro.limit_hit || ro.ended) && break
    end
    return finish_stage(job)
end

"""
The pack a fracture (or one wing) is left with in a pay of thickness `pay` (m), by the rule the proppant design asks for:
spread evenly, settled to the bottom, or settled only until closure. `d` is the stage design, `pump_seconds` how long
the job was pumped.
"""
function pack_in_pay(proppant, d, f; pay, pump_seconds)
    common = (diameter = proppant.diameter_mm * 1e-3, density = proppant.density, pack_porosity = proppant.pack_porosity, closure_psi = proppant.closure_psi,
        stress_coefficient = proppant.stress_coefficient)
    (proppant.settling && proppant.settle_until_closure) || return propped_profile(f; pay = pay, common..., settled = proppant.settling)
    v = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3)
    return propped_profile_at_closure(f; pay = pay, common..., v_free = v, pump_time = pump_seconds)
end

"What the growth model needs to know about the proppant of a stage (nothing without a proppant design)."
proppant_arguments(proppant, d) = isnothing(proppant) ? nothing : (schedule = [(f * d.minutes * 60.0, ppa_to_fraction(ppa; density = proppant.density)) for (f, ppa) in proppant.schedule],
        diameter = proppant.diameter_mm * 1e-3, bridge = proppant.bridge,
        settle = proppant.settling ? (v_free = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3),
            n = 4.65, cmax = 1 - proppant.pack_porosity, u_eq = proppant.equilibrium_velocity_ft_s * FT, R = (proppant.density - proppant.fluid_density) / proppant.fluid_density, d = proppant.diameter_mm * 1e-3) : nothing)

"""
    design_well(base, rock, designs; propped_fraction = 1.0, proppant = nothing)

Grow the fractures of every stage and return the `FracWellSpec` to simulate, the growth result per
fracture, plain-language notes (for example when a grown fracture is longer than the reservoir model
is wide and had to be cut), the proppant pack per fracture, and `stage_of` (which stage each fracture
belongs to). `base` supplies everything except half-lengths; its thickness is the pay thickness and
its positions are the stage centres. A stage with one cluster gives one fracture, as before; a stage
with several gives one fracture per cluster, grown together.

If `base` has `layers`, give `pay_ft`: the thickness of the zone the fractures start in, centred on the
lateral (`landing_ft`), with the barrier stresses of `rock` outside it. Default: the whole stack. The spec
returned then carries `fracture_above_ft` and `fracture_below_ft` for every fracture.

`flowback = true` (one-layer models) leaves each fracture's pumped fluid in the rock beside it as water that can
flow back; see `frac_water_bbl` in `FracWellSpec` and `water_from_rock`.
"""
function design_well(base::FracWellSpec, rock::RockSpec, designs::Vector{StageDesign}; propped_fraction = 1.0, ncell = 400, proppant = nothing, hours_between_stages = 2.0, pay_ft = nothing, flowback = false)
    # flowback = true: the fluid each fracture was pumped with is left in the rock beside it as water that can flow back
    # (`frac_water_bbl` in the spec). Only the share beside the conductive length is in the model; the rest lies beyond it.
    flowback && !isempty(base.layers) && error("flowback is for one-layer models for now")
    frac_water = Float64[]
    stacked = !isempty(base.layers)
    stacked || isnothing(pay_ft) || error("pay_ft is for a base spec with layers; with one layer the pay is its thickness_ft")
    pay = base.thickness_ft
    if stacked
        V = fracwell_vertical(base); pay = Float64(something(pay_ft, V.height_ft))
        (pay > 0 && V.landing_ft - pay / 2 >= -1e-6 && V.landing_ft + pay / 2 <= V.height_ft + 1e-6) ||
            error("the pay ($(pay) ft, centred on the lateral $(V.landing_ft) ft below the top) must lie inside the layer stack ($(V.height_ft) ft)")
    end
    reach_up = Float64[]; reach_down = Float64[]; layer_share = Vector{Float64}[]
    # Stages are pumped in the order listed. Each one feels what the stage before it still holds open after `hours_between_stages`
    # (`Inf`: only its proppant pack; `nothing`: earlier stages are ignored, the behaviour before 2026-11-10).
    # with `proppant` (a ProppantDesign), propped half-length and conductivity come from the model and `propped_fraction` is not used
    n = length(base.positions_ft)
    length(designs) == n || error("one stage design per stage: got $(length(designs)) for $n stages")
    0 < propped_fraction <= 1 || error("propped_fraction must be in (0, 1]")
    cache = Dict{Any, Any}(); previous = nothing; grown = Any[]; notes = String[]; half = Float64[]; cond = Float64[]; shape = Vector{Float64}[]; packs = Any[]
    pos = Float64[]; stage_of = Int[]; cond_in = Float64[]; center = Float64[]
    prop_kw(d) = proppant_arguments(proppant, d)
    for (i, d) in enumerate(designs)
        d.clusters >= 1 || error("stage $i: clusters must be at least 1")
        offsets = [(k - (d.clusters + 1) / 2) * d.cluster_spacing_ft for k in 1:d.clusters]
        centre = base.positions_ft[i]
        back = isnothing(previous) || isnothing(hours_between_stages) ? nothing :
            [fracture_residual(g.detail; pay = pay * FT, C_L = rock.leakoff_ft_sqrtmin * FT_SQRTMIN, wait = min(hours_between_stages, 1e6) * 3600.0,
                pack_porosity = isnothing(proppant) ? 0.35 : proppant.pack_porosity, position = (previous.centre + previous.offsets[k]) * FT) for (k, g) in enumerate(previous.gs)]
        # the same design after the same kind of neighbour, at the same distance, gives the same fractures: solve it once
        key = (d, isnothing(back) ? nothing : (previous.d, round(centre - previous.centre, digits = 6)))
        fb = isnothing(proppant) || !proppant.flow_feedback ? NamedTuple() :
            (proppant_feedback = true, net_pressure_limit_psi = isnan(proppant.net_pressure_limit_psi) ? nothing : proppant.net_pressure_limit_psi)
        G = get!(cache, key) do
            above = isnan(rock.barrier_above_psi) ? rock.barrier_psi : rock.barrier_above_psi; below = isnan(rock.barrier_below_psi) ? rock.barrier_psi : rock.barrier_below_psi
            d.clusters == 1 || d.cluster_spacing_ft > 0 || error("stage $i: cluster_spacing_ft must be positive when a stage has several clusters")
            isempty(d.steps) ?
                grow_stage_clusters(; pay_ft = pay, barrier_psi = rock.barrier_psi, barrier_above_psi = above, barrier_below_psi = below, toughness_psi_sqrtin = rock.toughness_psi_sqrtin,
                    youngs_psi = rock.youngs_psi, poisson = rock.poisson, viscosity_cp = d.viscosity_cp, stage_rate_bpm = d.rate_bpm_per_fracture * d.clusters,
                    minutes = d.minutes, leakoff_ft_sqrtmin = rock.leakoff_ft_sqrtmin, cluster_positions_ft = centre .+ offsets, shots = d.shots_per_cluster,
                    perf_diameter_in = d.perf_diameter_in, discharge = d.discharge, ncell = ncell, proppant = prop_kw(d), background = back, fb...) :
                grow_stage_steps(d, proppant; feedback = fb, pay_ft = pay, barrier_psi = rock.barrier_psi, barrier_above_psi = above, barrier_below_psi = below,
                    toughness_psi_sqrtin = rock.toughness_psi_sqrtin, youngs_psi = rock.youngs_psi, poisson = rock.poisson, leakoff_ft_sqrtmin = rock.leakoff_ft_sqrtmin,
                    cluster_positions_ft = centre .+ offsets, shots = d.shots_per_cluster, perf_diameter_in = d.perf_diameter_in, discharge = d.discharge, ncell = ncell, background = back)
        end
        gs = G.clusters
        feels = !isempty(fb)
        if feels
            ncell < 250 && push!(notes, "stage $i: the flow feels the proppant but the grid has $ncell cells; below about 250 the pack is breached and the tip runs on")
            planned = G.detail.proppant_planned             # known for a design with one schedule; a job in steps has no plan beyond its steps
            G.stopped && push!(notes, @sprintf("stage %d: the job was stopped after %.1f of %.0f min (%s)%s", i, G.stop_minutes, job_minutes(d), G.stop_reason,
                isfinite(planned) && planned > 0 ? @sprintf("; %.0f%% of the planned proppant had been pumped", 100 * G.detail.proppant_pumped / planned) : "; the steps after that were not pumped"))
        end
        isempty(d.steps) || !G.stopped || feels || push!(notes, @sprintf("stage %d: the job ended after %.1f of %.0f min (%s)", i, G.stop_minutes, job_minutes(d), G.stop_reason))
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
                pumped_s = (G.stopped && isfinite(G.stop_minutes) ? G.stop_minutes : job_minutes(d)) * 60.0
                pk = pack_in_pay(proppant, d, g.detail; pay = pay * FT, pump_seconds = pumped_s)
                h = pk.propped_half_length / FT
                if stacked     # every layer of the stack is a zone: conductivity from the pack that ended in it
                    ztop = cumsum(V.dz) .- V.dz
                    zones = [((V.landing_ft - ztop[kz] - V.dz[kz]) * FT, (V.landing_ft - ztop[kz]) * FT) for kz in 1:V.nz]
                    pz = proppant.settling && proppant.settle_until_closure ?
                        propped_at_closure(g.detail, zones; diameter = proppant.diameter_mm * 1e-3, density = proppant.density, pack_porosity = proppant.pack_porosity,
                            closure_psi = proppant.closure_psi, stress_coefficient = proppant.stress_coefficient, pump_time = pumped_s,
                            v_free = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3)) :
                        propped_zones(g.detail, zones; diameter = proppant.diameter_mm * 1e-3, density = proppant.density, pack_porosity = proppant.pack_porosity,
                            closure_psi = proppant.closure_psi, stress_coefficient = proppant.stress_coefficient, settled = proppant.settling)
                    # Each layer's weight is its conductivity summed along the fracture. (The cell at the well alone says little: when the
                    # fracture packs off back to the well, that cell is full from top to bottom whatever happened further out.)
                    at_well = [sum(c) for c in pz.conductivity_mdft]; kbest = argmax(at_well)
                    at_well[kbest] > 0 || error(label * ": no proppant pack in any layer (too little was pumped, or it settled below the stack)")
                    lastp = findlast(>=(proppant.diameter_mm * 1e-3), pz.packed_height[kbest])
                    h = isnothing(lastp) ? 0.0 : (g.detail.x[lastp] + g.detail.dx / 2) / FT
                    pk = merge(pk, (conductivity_mdft = pz.conductivity_mdft[kbest], propped_half_length = h * FT, layer_conductivity_mdft = pz.conductivity_mdft, best_layer = kbest))
                    push!(layer_share, at_well ./ at_well[kbest])
                    at_well[V.k_land] > 0 || push!(notes, label * ": the lateral's own layer holds no proppant (the bank sits " * (kbest > V.k_land ? "below" : "above") *
                        " it); the well is still joined to the pack, which a real well may not be")
                end
                h > 0 || error(label * (feels && G.stopped ? @sprintf(": the job was stopped after %.1f min (%s) before any proppant was placed; a pressure limit must be above what the job needs with clean fluid, perforation friction included (here %.0f psi over the closure stress at the stop)",
                        G.stop_minutes, G.stop_reason, G.wellbore_net_psi) :
                    proppant.settling ? ": no proppant bank stands inside the pay (it settled below the pay, or too little was pumped)" :
                    ": no part of the fracture holds a full grain of proppant; raise the concentration or shorten the pad"))
                fall_ft = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, mu = d.viscosity_cp * 1e-3) * job_minutes(d) * 60 / FT
                if k == 1                                      # the same for every cluster of a stage: say it once
                    if !proppant.settling
                        fall_ft = settling_velocity(proppant.diameter_mm * 1e-3; density = proppant.density, fluid_density = proppant.fluid_density, mu = d.viscosity_cp * 1e-3) * job_minutes(d) * 60 / FT
                        fall_ft > g.height_at_well_ft && push!(notes, @sprintf("stage %d: a grain would settle about %.0f ft during pumping, more than the %.0f ft fracture height; it will bank at the bottom, so the even spread assumed here overstates propped length",
                            i, fall_ft, g.height_at_well_ft))
                    end
                    first_pack = minimum(x.detail.first_pack_time for x in gs)
                    if proppant.settling
                        lost = sum(x.detail.proppant_rejected for x in gs) / max(sum(x.detail.proppant_pumped for x in gs), 1e-300)
                        if feels          # with the flow feeling the proppant, a pack anywhere is the event: growth stops there and pressure rises
                            isfinite(first_pack) && push!(notes, @sprintf("stage %d: the fracture packed off %.0f min into the job (screen-out); growth stops at the pack and the pressure rises behind it%s%s",
                                i, first_pack / 60, lost > 0.005 ? @sprintf("; %.0f%% of the proppant could not be placed", 100 * lost) : "",
                                G.stopped ? "" : isnan(proppant.net_pressure_limit_psi) ? ". The job was pumped on to the end against the pack; a real job would be stopped (give net_pressure_limit_psi)" :
                                    ". The pressure stayed under the limit given, so the job was pumped to the end"))
                        else
                            lost > 0.005 && push!(notes, @sprintf("stage %d: %.0f%% of the proppant could not be placed: the fracture packed off back to the well %.0f min into the job (screen-out). A real job would have stopped there; the flow model does not feel it",
                                i, 100 * lost, first_pack / 60))
                        end
                    else
                        isfinite(first_pack) && push!(notes, @sprintf("stage %d: proppant reached packing concentration %.0f min into the job (screen-out)%s", i, first_pack / 60,
                            feels ? "; growth stops at the pack and the pressure rises behind it" : "; the flow model does not feel it"))
                    end
                end
                proppant.settling && pk.share_in_pay < 0.8 && push!(notes, @sprintf("%s: only %.0f%% of the placed proppant ended inside the pay; the rest sits in the part of the fracture outside it", label, 100 * pk.share_in_pay))
            end
            if h > base.width_ft / 2
                push!(notes, @sprintf("%s: grown half-length %.0f ft is longer than the model half-width %.0f ft and was cut to it; widen the model or the result understates this fracture",
                    label, h, base.width_ft / 2))
                h = base.width_ft / 2
            end
            if stacked && isnothing(proppant)
                (g.above_pay_ft > 1 || g.below_pay_ft > 1) && push!(notes, @sprintf("%s: the fracture reaches %.0f ft above and %.0f ft below the pay and is connected to the layers there", label, g.above_pay_ft, g.below_pay_ft))
            else
                stacked || (g.share_in_pay < 0.9 && push!(notes, @sprintf("%s: only %.0f%% of the fracture face is inside the pay; the rest grew into the barriers and does not produce in this one-layer model",
                    label, 100 * g.share_in_pay)))
            end
            push!(reach_up, pay / 2 + (isnothing(proppant) ? g.above_pay_ft : 0.0)); push!(reach_down, pay / 2 + (isnothing(proppant) ? g.below_pay_ft : 0.0))
            push!(half, h); push!(packs, pk)
            pumped_bbl = 2 * g.detail.V_injected / STB                      # both wings
            push!(frac_water, pumped_bbl * min(h / max(g.half_length_ft, 1e-9), 1.0))
            flowback && h < 0.95 * g.half_length_ft && push!(notes, @sprintf("%s: %.0f of the %.0f bbl pumped lie beside the conductive %.0f ft; the rest is beyond it, out of the model, and does not come back", label,
                frac_water[end], pumped_bbl, h))
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
    flowback && (kw[:frac_water_bbl] = frac_water)
    if stacked && isnothing(proppant)
        kw[:fracture_above_ft] = reach_up; kw[:fracture_below_ft] = reach_down
    elseif stacked
        kw[:fracture_layer_share] = layer_share
    end
    if !isnothing(proppant)
        kw[:conductivity_mdft] = cond; kw[:conductivity_shape] = shape
        if proppant.drawdown_loss        # `closure_psi` is the stress on the pack at the flowing pressure; start from the stress at initial pressure and let the run lower it
            kw[:conductivity_mdft] = cond .* exp(proppant.stress_coefficient * (base.pressure_psi - base.bhp_psi))
            kw[:conductivity_loss_per_psi] = proppant.stress_coefficient
        end
    end
    return (spec = FracWellSpec(; kw...), growth = grown, notes = notes, packs = packs, stage_of = stage_of)
end

"""
    design_child_well(parent, rock, designs; child_offset_ft, positions_ft, closure_stress_psi, child_months,
                      propped_fraction = 1.0, conductivity_mdft = nothing, proppant = nothing, biot = 0.7, ncell = 200, hit_gap_ft = 30.0)

A child well fractured beside a parent that has already produced. `parent` is the parent's `FracWellSpec` (one
layer, fractures as they are); it is run for its own `months`, and every stage of the child (`designs`, one per
entry of `positions_ft`, the stage centres along the lateral in the parent's coordinate) is then grown into the
rock as the parent left it (`grow_child_stage`): lower closure stress and pore pressure towards the parent pull
the fracture that way. `child_offset_ft` is where the child's lateral lies across the model, measured from the
parent's line; `closure_stress_psi` is the pay's closure stress before any production.

Returns `spec`: both wells in one model, the parent as well 1 from the start and the child as well 2 from month
`parent.months`, for `child_months` more (run it with `run_fracwell` or the field driver); `parent_run`; `growth`
(one entry per child fracture, see `grow_child_stage`); `stage_of`; and `notes`.
A child fracture and a parent fracture are parallel planes. They meet only if they lie nearly in line along the
well: when a wing gets as far as the parent's fracture tip and the two are no more than `hit_gap_ft` apart along
the well, that is a frac hit, and the wing is counted only up to the parent's tip (what happens beyond is not
modelled). Further apart, the wing runs on beside the parent's fracture and is counted as grown.

The child's well crosses each of its fractures where the lateral is, not at the fracture's middle (`lateral_ft` in
the spec), so the longer wing has further to carry its oil.

Without `proppant` the child's fractures get `conductivity_mdft` (default the parent's first) over `propped_fraction`
of each wing. With `proppant` (a `ProppantDesign`) each wing's propped length and conductivity come from the sand that
wing took: the two wings then differ in both, and `propped_fraction` and `conductivity_mdft` are not used.

Not modelled: flow from the child's fracture into the parent's during pumping, damage to the parent.
"""
function design_child_well(parent::FracWellSpec, rock::RockSpec, designs::Vector{StageDesign}; child_offset_ft, positions_ft, closure_stress_psi, child_months,
        propped_fraction = 1.0, conductivity_mdft = nothing, proppant = nothing, biot = 0.7, ncell = 200, hit_gap_ft = 30.0)
    fracwell_vertical(parent).layered && error("design_child_well reads a one-layer parent; layers and dip are not yet followed here")
    length(designs) == length(positions_ft) || error("one stage design per child stage position")
    0 < propped_fraction <= 1 || error("propped_fraction must be in (0, 1]")
    isempty(parent.start_month) || all(==(0), parent.start_month) || error("the parent's own stages must all start in month 0")
    np = length(parent.positions_ft)
    par = run_fracwell(parent)
    above = isnan(rock.barrier_above_psi) ? rock.barrier_psi : rock.barrier_above_psi; below = isnan(rock.barrier_below_psi) ? rock.barrier_psi : rock.barrier_below_psi
    pos = Float64[]; half = Float64[]; cen = Float64[]; grown = Any[]; stage_of = Int[]; notes = String[]; hits = Bool[]
    lines = Float64[]; cond = Float64[]; shape_up = Vector{Float64}[]; shape_dn = Vector{Float64}[]; packs = Any[]
    fb = isnothing(proppant) || !proppant.flow_feedback ? NamedTuple() :
        (proppant_feedback = true, net_pressure_limit_psi = isnan(proppant.net_pressure_limit_psi) ? nothing : proppant.net_pressure_limit_psi)
    for (i, d) in enumerate(designs)
        offsets = [(k - (d.clusters + 1) / 2) * d.cluster_spacing_ft for k in 1:d.clusters]
        d.clusters == 1 || d.cluster_spacing_ft > 0 || error("child stage $i: cluster_spacing_ft must be positive when a stage has several clusters")
        g = grow_child_stage(par; child_offset_ft = child_offset_ft, cluster_positions_ft = positions_ft[i] .+ offsets, initial_pressure_psi = parent.pressure_psi,
            closure_stress_psi = closure_stress_psi, biot = biot, pay_ft = parent.thickness_ft, barrier_psi = rock.barrier_psi, barrier_above_psi = above, barrier_below_psi = below,
            toughness_psi_sqrtin = rock.toughness_psi_sqrtin, youngs_psi = rock.youngs_psi, poisson = rock.poisson, viscosity_cp = d.viscosity_cp,
            stage_rate_bpm = d.rate_bpm_per_fracture * d.clusters, minutes = d.minutes, leakoff_ft_sqrtmin = rock.leakoff_ft_sqrtmin, shots = d.shots_per_cluster,
            perf_diameter_in = d.perf_diameter_in, discharge = d.discharge, ncell = ncell, proppant = proppant_arguments(proppant, d), fb...)
        for nt in g.notes
            push!(notes, "child stage $i: " * nt)
        end
        if !isempty(fb)                    # the flow feels the proppant: say what the job did, as design_well does
            r = g.detail
            ncell < 250 && push!(notes, "child stage $i: the flow feels the proppant but the grid has $ncell cells; below about 250 the pack is breached and the tip runs on")
            r.stopped && push!(notes, @sprintf("child stage %d: the job was stopped after %.1f of %.0f min (%s); %.0f%% of the planned proppant had been pumped", i, r.stop_time / 60, d.minutes, r.stop_reason,
                100 * r.proppant_pumped / max(r.proppant_planned, 1e-300)))
            plugs = [f.plug_time for f in r.fractures if isfinite(f.plug_time)]
            isempty(plugs) || push!(notes, @sprintf("child stage %d: a wing packed off %.0f min into the job (screen-out); growth stops at the pack and the pressure rises behind it%s", i, minimum(plugs) / 60,
                r.stopped ? "" : isnan(proppant.net_pressure_limit_psi) ? ". The job was pumped on to the end against the pack; a real job would be stopped (give net_pressure_limit_psi)" :
                    ". The pressure stayed under the limit given, so the job was pumped to the end"))
        end
        for (k, c) in enumerate(g.clusters)
            label = d.clusters == 1 ? "child stage $i" : "child stage $i cluster $k"
            line = c.center_as_grown_ft - c.wings.center_shift_ft                      # where the child's lateral is, across the model
            met = c.hit && c.hit_gap_along_well_ft <= hit_gap_ft                       # in line with a parent fracture and long enough to reach it
            c0 = met ? c.center_ft : c.center_as_grown_ft; h0 = met ? c.half_length_ft : c.half_length_as_grown_ft
            push!(pos, positions_ft[i] + offsets[k]); push!(lines, line); push!(grown, c); push!(stage_of, i); push!(hits, met)
            if isnothing(proppant)
                push!(cen, line + propped_fraction * (c0 - line)); push!(half, propped_fraction * h0); push!(packs, nothing)
            else
                # each wing on its own: how far its pack reaches and how well it conducts; the plus wing lies towards larger y
                toward_up = g.toward_side == 1
                prof(w) = pack_in_pay(proppant, d, w.detail; pay = parent.thickness_ft * FT, pump_seconds = (g.detail.stopped ? g.detail.stop_time : d.minutes * 60.0))
                pu = prof(c.wings.plus); pd = prof(c.wings.minus)
                lu = pu.propped_half_length / FT; ld = pd.propped_half_length / FT
                met && (toward_up ? (lu = min(lu, c.hit_distance_ft)) : (ld = min(ld, c.hit_distance_ft)))     # a frac hit: counted to the parent's tip
                lu + ld > 0 || error(label * (g.detail.stopped ? @sprintf(": the job was stopped after %.1f min (%s) before any proppant was placed; a pressure limit must be above what the job needs with clean fluid, perforation friction included (here %.0f psi over the closure stress at the stop)",
                    g.detail.stop_time / 60, g.detail.stop_reason, g.wellbore_net_psi) : ": neither wing holds a proppant pack inside the pay"))
                along(pk, w, len) = [pk.conductivity_mdft[clamp(floor(Int, x / w.detail.dx) + 1, 1, length(pk.x))] for x in range(0.0, max(len, 1e-6) * FT, length = 21)]
                cu = along(pu, c.wings.plus, lu); cd = along(pd, c.wings.minus, ld)
                ref = max(lu > 0 ? cu[1] : 0.0, ld > 0 ? cd[1] : 0.0, 1e-6)
                push!(cen, line + (lu - ld) / 2); push!(half, (lu + ld) / 2); push!(cond, ref); push!(shape_up, cu ./ ref); push!(shape_dn, cd ./ ref)
                push!(packs, (plus = pu, minus = pd, propped_plus_ft = lu, propped_minus_ft = ld, conductivity_at_well_mdft = ref))
                push!(notes, @sprintf("%s: propped %.0f ft towards the parent and %.0f ft away, %.0f md-ft at the well", label, toward_up ? lu : ld, toward_up ? ld : lu, ref))
            end
            push!(notes, @sprintf("%s: %.0f ft towards the parent, %.0f ft away; %.0f%% of its fluid went towards the parent", label, c.toward_parent_ft, c.away_ft, 100 * c.share_toward_parent))
            met && push!(notes, @sprintf("%s: frac hit. It reached the parent's fracture tip after %.1f min and %.0f bbl pumped into the stage, %.0f ft from it along the well; counted only up to there, no flow into the parent is modelled",
                label, c.hit_minutes, c.hit_stage_bbl, c.hit_gap_along_well_ft))
            c.hit && !met && push!(notes, @sprintf("%s: grew past the parent's fracture tip, %.0f ft from that fracture along the well: the two run side by side and are counted as grown", label, c.hit_gap_along_well_ft))
            for nt in c.notes
                push!(notes, label * ": " * nt)
            end
        end
    end
    width = parent.width_ft
    for j in eachindex(pos)
        (cen[j] - half[j] >= -1e-6 && cen[j] + half[j] <= width + 1e-6) || push!(notes, @sprintf("child fracture %d reaches outside the model (%.0f to %.0f ft of %.0f) and is cut at its edge; widen the parent's model", j, cen[j] - half[j], cen[j] + half[j], width))
        0 < cen[j] < width || error("child fracture $j is centred outside the parent's model: widen the model or reduce child_offset_ft")
    end
    kw = Dict{Symbol, Any}(f => getfield(parent, f) for f in fieldnames(FracWellSpec))
    pc = isempty(parent.center_ft) ? fill(width / 2, np) : parent.center_ft
    kw[:positions_ft] = vcat(parent.positions_ft, pos); kw[:half_length_ft] = vcat(parent.half_length_ft, half); kw[:center_ft] = vcat(pc, cen)
    kw[:lateral_ft] = vcat(isempty(parent.lateral_ft) ? pc : parent.lateral_ft, lines)        # the child's well is where its lateral is, not at the fracture's middle
    flat = [[1.0, 1.0] for _ in 1:np]; pshape = isempty(parent.conductivity_shape) ? flat : parent.conductivity_shape
    if isnothing(proppant)
        kw[:conductivity_mdft] = vcat(parent.conductivity_mdft, fill(Float64(something(conductivity_mdft, parent.conductivity_mdft[1])), length(pos)))
        isempty(parent.conductivity_shape) || (kw[:conductivity_shape] = vcat(parent.conductivity_shape, [[1.0, 1.0] for _ in pos]))
        isempty(parent.conductivity_shape_minus) || (kw[:conductivity_shape_minus] = vcat(parent.conductivity_shape_minus, [[1.0, 1.0] for _ in pos]))
    else
        kw[:conductivity_mdft] = vcat(parent.conductivity_mdft, cond)
        kw[:conductivity_shape] = vcat(pshape, shape_up)
        kw[:conductivity_shape_minus] = vcat(isempty(parent.conductivity_shape_minus) ? pshape : parent.conductivity_shape_minus, shape_dn)
    end
    kw[:well_of_stage] = vcat(fill(1, np), fill(2, length(pos))); kw[:start_month] = vcat(fill(0, np), fill(parent.months, length(pos)))
    kw[:months] = parent.months + child_months
    return (spec = FracWellSpec(; kw...), parent_run = par, growth = grown, stage_of = stage_of, frac_hit = hits, packs = packs, notes = notes)
end

"""
    child_factors(parent, rock, design; child_offset_ft, child_months, closure_stress_psi, child_position_ft = <the parent's first stage>,
                  level = :screening, propped_fraction = 1.0, conductivity_mdft = nothing, proppant = nothing, ncell = 200, hit_gap_ft = 30.0)

What a child well loses to its parent, and the parent to the child, as two numbers. `parent` is the parent's
`FracWellSpec` (its `months` is how long it produces before the child is fractured), `design` the child's stage
design (one stage, at `child_position_ft` along the lateral). Runs, all at the same `level` (see `fast_spec`;
`nothing` keeps the spec's own mesh and steps):
  the parent, then the child designed into the rock it left (`design_child_well`), then both for `child_months`;
  the child's own fractures alone in untouched rock, same model, for `child_months`;
  the parent alone for the whole time.
`child_factor` = the child's oil / its own fractures' oil in untouched rock; `parent_factor` = the parent's oil over
the child's months with the child / without it. Also `frac_hit` per child fracture, `notes`, the four oil volumes,
`pad` (what `design_child_well` returned) and `seconds`.
"""
function child_factors(parent::FracWellSpec, rock::RockSpec, design::StageDesign; child_offset_ft, child_months, closure_stress_psi, child_position_ft = parent.positions_ft[1],
        level = :screening, propped_fraction = 1.0, conductivity_mdft = nothing, proppant = nothing, ncell = 200, hit_gap_ft = 30.0)
    fast(s) = isnothing(level) ? s : fast_spec(s; level = level)
    par = fast(parent); np = length(par.positions_ft)
    t = @elapsed begin
        pad = design_child_well(par, rock, [design]; child_offset_ft = child_offset_ft, positions_ft = [child_position_ft], closure_stress_psi = closure_stress_psi, child_months = child_months,
            propped_fraction = propped_fraction, conductivity_mdft = conductivity_mdft, proppant = proppant, ncell = ncell, hit_gap_ft = hit_gap_ft)
        both = run_fracwell(pad.spec)
        # the child's own fractures alone in untouched rock: the pad's model with the parent's stages taken out
        kw = Dict{Symbol, Any}(f => getfield(pad.spec, f) for f in fieldnames(FracWellSpec)); nall = length(pad.spec.positions_ft); ch = np+1:nall
        for f in (:positions_ft, :half_length_ft, :conductivity_mdft, :center_ft, :lateral_ft, :conductivity_shape, :conductivity_shape_minus)
            isempty(kw[f]) || (kw[f] = kw[f][ch])
        end
        kw[:well_of_stage] = Int[]; kw[:start_month] = Int[]; kw[:months] = child_months; kw[:name] = par.name * "_child_alone"
        # keep the model's extent along the lateral: the parent's stages no longer set it
        x0 = minimum(pad.spec.positions_ft) - pad.spec.edge_ft; x1 = maximum(pad.spec.positions_ft) + pad.spec.edge_ft
        cx0 = minimum(kw[:positions_ft]); cx1 = maximum(kw[:positions_ft])
        abs((cx0 - x0) - (x1 - cx1)) < 1e-6 || push!(pad.notes, "the child's stage is not in the middle of the model along the lateral: its fresh-rock run uses the smaller of the two distances to the model's ends on both sides")
        kw[:edge_ft] = min(cx0 - x0, x1 - cx1)
        own = run_fracwell(FracWellSpec(; kw...))
        kp = Dict{Symbol, Any}(f => getfield(par, f) for f in fieldnames(FracWellSpec)); kp[:months] = par.months + child_months
        alone = run_fracwell(FracWellSpec(; kp...))
    end
    m0 = par.months; months = m0+1:m0+child_months
    child_oil = sum(both.monthly_oil_stb[months, ch]); own_oil = sum(own.monthly_oil_stb)
    parent_with = sum(both.monthly_oil_stb[months, 1:np]); parent_alone = sum(alone.monthly_oil_stb[months, :])
    return (child_factor = child_oil / own_oil, parent_factor = parent_with / parent_alone, frac_hit = pad.frac_hit, notes = pad.notes, child_oil_stb = child_oil, child_alone_oil_stb = own_oil,
        parent_oil_stb = parent_with, parent_alone_oil_stb = parent_alone, pad = pad, seconds = t)
end

"""
    job_minutes_for_length(rock, design; pay_ft, target_ft, ncell = 100)

How many minutes the stage design must be pumped (at its own rate, fluid and clusters) for its fractures to grow to
`target_ft` of half-length in untouched rock: the answer to "the standard job that makes about 300 ft here". Clean
fluid, found by halving the interval between 2 minutes and 8 hours; about ten growth runs. Returns the minutes and the
half-length they give (the longest fracture of the stage).
"""
function job_minutes_for_length(rock::RockSpec, d::StageDesign; pay_ft, target_ft, ncell = 100)
    above = isnan(rock.barrier_above_psi) ? rock.barrier_psi : rock.barrier_above_psi; below = isnan(rock.barrier_below_psi) ? rock.barrier_psi : rock.barrier_below_psi
    offsets = [(k - (d.clusters + 1) / 2) * d.cluster_spacing_ft for k in 1:d.clusters]
    len(minutes) = maximum(c.half_length_ft for c in grow_stage_clusters(; pay_ft = pay_ft, barrier_psi = rock.barrier_psi, barrier_above_psi = above, barrier_below_psi = below,
        toughness_psi_sqrtin = rock.toughness_psi_sqrtin, youngs_psi = rock.youngs_psi, poisson = rock.poisson, viscosity_cp = d.viscosity_cp, stage_rate_bpm = d.rate_bpm_per_fracture * d.clusters,
        minutes = minutes, leakoff_ft_sqrtmin = rock.leakoff_ft_sqrtmin, cluster_positions_ft = offsets, shots = d.shots_per_cluster, perf_diameter_in = d.perf_diameter_in, discharge = d.discharge,
        ncell = ncell).clusters)
    lo = 2.0; hi = 480.0
    len(hi) >= target_ft || error("job_minutes_for_length: even 8 hours of pumping give only $(round(Int, len(hi))) ft here; the target of $(target_ft) ft is out of reach for this design in this rock")
    len(lo) <= target_ft || return (minutes = lo, half_length_ft = len(lo))
    for _ in 1:9
        mid = sqrt(lo * hi)
        len(mid) < target_ft ? (lo = mid) : (hi = mid)
    end
    m = sqrt(lo * hi)
    return (minutes = m, half_length_ft = len(m))
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
