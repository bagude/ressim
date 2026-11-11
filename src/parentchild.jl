# Child wells that feel the parent: depletion to stress and pore pressure along a child fracture, lopsided growth, frac hits.
# (stream 2, 2026-11-10)
#
# A parent well that has produced for a while has lowered the pore pressure around its fractures. Two things follow
# for a fracture pumped later from a neighbouring (child) well, and both act on the side that faces the parent:
#   1. Lower closure stress. Rock that cannot strain sideways loses horizontal stress as its pore pressure falls:
#        change of least horizontal stress = biot (1 - 2 nu) / (1 - nu) x change of pore pressure
#      (about half to two thirds of the pressure change). A fracture opens more easily there and grows towards it.
#   2. More leak-off. Fluid is lost to the rock in proportion to the difference between the pressure in the fracture
#      and the pore pressure (leak-off controlled by the rock, the same rule as dfit.jl); depletion widens that
#      difference, because the closure stress falls by less than the pore pressure.
# The growth model (multifrac.jl, `two_wings`) solves both wings of every cluster, each with its own stress and
# leak-off along its length. Sources and what they do and do not support: research/parent-child-stress.md.
#
# What is and is not modelled:
#   - The stress change is local and applies to the pay only; the barriers keep their stress, so depleted pay holds
#     the fracture in better (multifrac.jl header). Exact only for equal barriers above and below; with unequal
#     barriers or fluid weight the containment is left unchanged, and a strongly depleted case can then stop with
#     a height-runaway error.
#   - Stress does not spread sideways from the depleted rock (no stress shadow of the depletion itself), and the
#     direction of the least stress does not turn: the child fracture stays in its plane.
#   - The pore pressure is frozen at the child's fracturing date and read along the fracture's own line.
#   - Leak-off follows closure stress less pore pressure; the fracture's net pressure and any filter cake are left out.
#   - A frac hit is flagged when a wing reaches as far as the tip of the parent's fracture. After that the wing goes
#     on growing as if in rock: no fluid enters the parent's fracture or well, and the parent's fracture does not
#     open again. The child's fluid and sand that would really go into the parent stay in the child's wing here.

"Change of the least horizontal stress per unit change of pore pressure, for rock that cannot strain sideways."
stress_path_ratio(; biot = 0.7, poisson = 0.25) = biot * (1 - 2 * poisson) / (1 - poisson)

"""
    field_pressure(field, x_ft, y_ft; width_ft, outside_psi)

Pressure of a `pressure_field` at a point, by interpolation between cell centres. Outside the model across its
width (y below 0 or above `width_ft`) the answer is `outside_psi`; along the lateral the nearest column is used.
"""
function field_pressure(field, x, y; width_ft, outside_psi)
    (0 <= y <= width_ft) || return outside_psi
    xc = field.x_ft; yc = field.y_ft; nx = length(xc); ny = length(yc)
    function bracket(c, v, n)
        n == 1 && return (1, 1, 0.0)
        v <= c[1] && return (1, 1, 0.0)
        v >= c[n] && return (n, n, 0.0)
        i = searchsortedlast(c, v); i = min(i, n - 1)
        return (i, i + 1, (v - c[i]) / (c[i+1] - c[i]))
    end
    i1, i2, fx = bracket(xc, x, nx); j1, j2, fy = bracket(yc, y, ny)
    return (1 - fx) * ((1 - fy) * field.psi[i1, j1] + fy * field.psi[i1, j2]) + fx * ((1 - fy) * field.psi[i2, j1] + fy * field.psi[i2, j2])
end

"""
    grow_lopsided_stage(; pore_pressure_plus, pore_pressure_minus, initial_pressure_psi, closure_stress_psi,
                          biot = 0.7, poisson = 0.25, leakoff_follows_pressure = true,
                          hit_distance_plus_ft = Inf, hit_distance_minus_ft = Inf, <what grow_stage_clusters takes>)

One stage whose two wings grow in different rock. `pore_pressure_plus` and `pore_pressure_minus` give the pore
pressure (psi) at a distance (ft) from the well along each wing: a function, one function per cluster, or `nothing`
for untouched rock at `initial_pressure_psi`. `closure_stress_psi` is the pay's closure stress before depletion
(absolute; it sets how much the leak-off rises). `barrier_psi`, the wellbore pressure and net pressures stay
measured from that undepleted closure stress. `hit_distance_..._ft`: how far along that wing the parent's fracture
tip lies (a number, or one per cluster).

Returns per cluster the half-length of each wing, the centre shift and half-length that describe the same fracture
to `FracWellSpec` (`center_shift_ft` is added to the stage's `center_ft`, positive towards the plus side), the
fluid split between wings, efficiency, and for each wing whether and when it reached the parent's fracture.
"""
function grow_lopsided_stage(; pore_pressure_plus = nothing, pore_pressure_minus = nothing, initial_pressure_psi, closure_stress_psi, biot = 0.7, poisson = 0.25,
        leakoff_follows_pressure = true, hit_distance_plus_ft = Inf, hit_distance_minus_ft = Inf, pay_ft, barrier_psi, barrier_above_psi = barrier_psi, barrier_below_psi = barrier_psi,
        fluid_weight = false, cluster_positions_ft, stage_rate_bpm, minutes, leakoff_ft_sqrtmin = 0.0, ntable = 240, kwarg...)
    n = length(cluster_positions_ft)
    closure_stress_psi > initial_pressure_psi || error("the closure stress must be above the initial pore pressure")
    ratio = stress_path_ratio(biot = biot, poisson = poisson)
    per_cluster(v) = v isa AbstractVector ? (length(v) == n || error("give one entry per cluster"); v) : fill(v, n)
    pp = vcat(per_cluster(pore_pressure_plus), per_cluster(pore_pressure_minus))            # one per wing, plus side first
    hit_at = vcat(Float64.(per_cluster(hit_distance_plus_ft)), Float64.(per_cluster(hit_distance_minus_ft)))
    pore(k, s_ft) = isnothing(pp[k]) ? initial_pressure_psi : Float64(pp[k](s_ft))
    any_change = any(!isnothing, pp)
    offset = [x -> ratio * (pore(k, x / FT) - initial_pressure_psi) * PSI for k in 1:2n]      # change of the pay's closure stress, Pa
    leak = [x -> leakoff_follows_pressure ? max(1 + (1 - ratio) * (initial_pressure_psi - pore(k, x / FT)) / (closure_stress_psi - initial_pressure_psi), 0.0) : 1.0 for k in 1:2n]
    plain = barrier_above_psi == barrier_below_psi && !fluid_weight
    # room in the cross-section table for the net pressure a wing reaches in depleted rock (it can sit as far above the local
    # closure stress as that stress has fallen); read through the local contrast it is at most this much:
    deepest = any_change ? maximum(max(initial_pressure_psi - pore(k, s), 0.0) for k in 1:2n, s in 0.0:5.0:6000.0) * ratio : 0.0
    extra = plain && deepest > 0 ? deepest * barrier_psi / (barrier_psi + deepest) * PSI : 0.0
    notes = String[]
    plain || !any_change || push!(notes, "unequal barriers or fluid weight: the better containment of depleted pay is not applied")
    args = (pay_ft = pay_ft, barrier_psi = barrier_psi, barrier_above_psi = barrier_above_psi, barrier_below_psi = barrier_below_psi, fluid_weight = fluid_weight, poisson = poisson,
        cluster_positions_ft = cluster_positions_ft, stage_rate_bpm = stage_rate_bpm, minutes = minutes, leakoff_ft_sqrtmin = leakoff_ft_sqrtmin, two_wings = true,
        stress_offset = any_change ? offset : nothing, leak_factor = any_change ? leak : nothing, table_extra = extra, ntable = ntable)      # (three times the entries for the wider table gave the same lengths to six digits and cost a second per run)
    g = nothing
    for margin in (1.15, 2.5, 5.0)                       # a wing running into depleted rock can go far beyond the usual grid
        try
            g = grow_stage_clusters(; args..., margin = margin, kwarg...)
            break
        catch e
            (e isa ErrorException && occursin("outran the grid", e.msg) && margin < 5.0) || rethrow()
        end
    end
    r = g.detail; fr = r.fractures; t = r.t
    stage_bbl(time) = stage_rate_bpm * min(time, r.pump_time) / 60          # pumped into the whole stage by then (bpm x minutes)
    function wing(k)
        f = fr[k]; L = f.L[end] / FT
        j = isfinite(hit_at[k]) ? findfirst(>=(hit_at[k] * FT), f.L) : nothing
        (half_length_ft = L, injected_bbl = f.V_injected / STB, in_fracture_bbl = f.V_fracture / STB, leaked_bbl = f.V_leaked / STB,
            hit = !isnothing(j), hit_minutes = isnothing(j) ? NaN : t[j] / 60, hit_stage_bbl = isnothing(j) ? NaN : stage_bbl(t[j]), past_hit_ft = isnothing(j) ? 0.0 : L - hit_at[k],
            pore_pressure_at_tip_psi = pore(k, L), stress_change_at_tip_psi = ratio * (pore(k, L) - initial_pressure_psi), detail = f)
    end
    clusters = map(1:n) do c
        p = wing(c); m = wing(c + n); f = fr[c]
        inj = p.injected_bbl + m.injected_bbl; total = sum(x.V_injected for x in fr) / STB
        cn = String[]
        (p.hit || m.hit) && push!(cn, "a wing reached the parent's fracture; after that it is grown as if in rock (no flow into the parent)")
        (plus = p, minus = m, half_length_plus_ft = p.half_length_ft, half_length_minus_ft = m.half_length_ft,
            center_shift_ft = (p.half_length_ft - m.half_length_ft) / 2, half_length_ft = (p.half_length_ft + m.half_length_ft) / 2,
            fluid_share = inj / total, share_to_plus = p.injected_bbl / inj, efficiency = (p.in_fracture_bbl + m.in_fracture_bbl) / inj,
            height_at_well_ft = f.h0[end] / FT, inlet_net_pressure_psi = f.p0[end] / PSI, stress_change_at_well_psi = ratio * (pore(c, 0.0) - initial_pressure_psi),
            perf_drop_psi = f.perf_drop / PSI, hit = p.hit || m.hit, notes = cn)
    end
    return (clusters = clusters, wellbore_net_psi = g.wellbore_net_psi, stress_path_ratio = ratio, stage_bbl = stage_bbl(r.pump_time), notes = notes, detail = r)
end

"""
    grow_child_stage(parent; child_offset_ft, cluster_positions_ft, initial_pressure_psi, closure_stress_psi, step = nothing, ...)

A stage of a child well next to a producing parent. `parent` is a finished `run_fracwell` (single layer); its
pressure at the end of the run (or at solver step `step`) is the pore pressure the child is fractured into.
`child_offset_ft` is where the child's lateral lies across the model, measured from the parent's fractures' centre
line (positive towards larger y); `cluster_positions_ft` are the child's cluster positions along the lateral in the
parent's coordinate (that of the parent's `positions_ft`). Everything else is passed to `grow_lopsided_stage`.

Each cluster comes back with `toward_parent_ft` and `away_ft` (wing half-lengths as grown), `center_ft` and
`half_length_ft` for a `FracWellSpec` in the parent's coordinates, and `hit` with its time and the stage volume
pumped by then. A hit means the wing reached as far as the tip of the nearest parent fracture; `hit_gap_along_well_ft`
says how far apart the two fractures are along the well (they are parallel planes and meet only if that is small).
After a hit the model's wing keeps growing as if in rock, which is not what happens, so `center_ft` and
`half_length_ft` count the wing only up to the parent's fracture tip (`toward_parent_counted_ft`); the lengths as
grown are in `center_as_grown_ft` and `half_length_as_grown_ft`.
"""
function grow_child_stage(parent; child_offset_ft, cluster_positions_ft, initial_pressure_psi, step = nothing, kwarg...)
    child_offset_ft == 0 && error("the child well cannot lie on the parent's own line")
    fld = pressure_field(parent; step = step); L = parent.layout; width = sum(L.dy)
    n = length(cluster_positions_ft)
    near = [argmin([abs(st.position_ft - x) for st in parent.stages]) for x in cluster_positions_ft]     # the parent fracture nearest along the well
    child_y = [L.center_ft[near[c]] + child_offset_ft for c in 1:n]
    toward = child_offset_ft > 0 ? -1 : 1                                 # the side of the child that faces the parent
    notes = String[]
    path(c, sgn) = s -> field_pressure(fld, cluster_positions_ft[c], child_y[c] + sgn * s; width_ft = width, outside_psi = initial_pressure_psi)
    all(0 .<= child_y .<= width) || push!(notes, "the child well lies outside the parent's model: the rock there is taken as untouched")
    reach = [max(abs(child_offset_ft) - parent.stages[near[c]].half_length_ft, 0.0) for c in 1:n]      # along the wing to the parent's fracture tip
    g = grow_lopsided_stage(; pore_pressure_plus = [path(c, 1) for c in 1:n], pore_pressure_minus = [path(c, -1) for c in 1:n], initial_pressure_psi = initial_pressure_psi,
        hit_distance_plus_ft = toward == 1 ? reach : Inf, hit_distance_minus_ft = toward == -1 ? reach : Inf, cluster_positions_ft = cluster_positions_ft, kwarg...)
    clusters = map(1:n) do c
        k = g.clusters[c]; tw = toward == 1 ? k.plus : k.minus; aw = toward == 1 ? k.minus : k.plus
        counted = min(tw.half_length_ft, reach[c])                       # the child's own fracture is counted up to the parent's fracture tip
        (toward_parent_ft = tw.half_length_ft, away_ft = aw.half_length_ft, toward_parent_counted_ft = counted,
            center_ft = child_y[c] + toward * (counted - aw.half_length_ft) / 2, half_length_ft = (counted + aw.half_length_ft) / 2,
            center_as_grown_ft = child_y[c] + k.center_shift_ft, half_length_as_grown_ft = k.half_length_ft,
            share_toward_parent = tw.injected_bbl / (tw.injected_bbl + aw.injected_bbl), efficiency = k.efficiency, fluid_share = k.fluid_share,
            hit = tw.hit, hit_minutes = tw.hit_minutes, hit_stage_bbl = tw.hit_stage_bbl, past_hit_ft = tw.past_hit_ft, hit_distance_ft = reach[c],
            hit_gap_along_well_ft = abs(parent.stages[near[c]].position_ft - cluster_positions_ft[c]),
            pore_pressure_at_well_psi = path(c, 1)(0.0), pore_pressure_at_toward_tip_psi = tw.pore_pressure_at_tip_psi, stress_change_at_well_psi = k.stress_change_at_well_psi,
            stress_change_at_toward_tip_psi = tw.stress_change_at_tip_psi, height_at_well_ft = k.height_at_well_ft, inlet_net_pressure_psi = k.inlet_net_pressure_psi,
            perf_drop_psi = k.perf_drop_psi, notes = k.notes, wings = k)
    end
    return (clusters = clusters, wellbore_net_psi = g.wellbore_net_psi, stress_path_ratio = g.stress_path_ratio, stage_bbl = g.stage_bbl, toward_side = toward,
        notes = vcat(notes, g.notes), detail = g.detail)
end
