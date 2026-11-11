# Structure: the depth of the top of the pay across the field, with faults.
#
# One description that a map, a steering game and a reservoir run can all read:
#   - `Structure.top`: the unfaulted top of pay (true vertical depth, feet, positive down) on a grid.
#   - `Structure.faults`: traces (polylines in field feet), each with a throw and a transmissibility multiplier.
# `top_at` gives the faulted depth at any point; `lateral_structure` gives top and base along a
# lateral, with the exact position and size of every fault crossing; `well_faults` hands the traces
# to a fractured-well model, where they become transmissibility multipliers.
#
# The fault model is geometric and simple: walking along the trace from its first point, the block on
# the side where the cross product (trace direction x offset) is positive is `throw_ft` deeper (in a
# frame with x east and y south that is the right-hand side). The throw is largest in the middle of
# the trace and falls to zero at both tips (parabola); each block takes half of it, and the
# displacement dies out with distance from the trace (exponentially, over `decay_ft`), so the surface
# is continuous everywhere except across the trace. No fault dip, no drag folds, no growth.

"A fault: `trace` is a polyline of (x, y) in field feet; `throw_ft` the largest throw; `multiplier` scales flow across it (0 seals)."
Base.@kwdef struct Fault
    trace::Vector{Tuple{Float64, Float64}}
    throw_ft::Float64
    multiplier::Float64 = 1.0
    decay_ft::Float64 = NaN                 # distance over which the displacement dies out; NaN: half the trace length
end

"A fault from plain arrays: `points` is a list of [x, y] pairs."
fault_from(points; throw_ft, transmissibility_multiplier = 1.0, decay_ft = NaN) =
    Fault(trace = [(Float64(q[1]), Float64(q[2])) for q in points], throw_ft = throw_ft, multiplier = transmissibility_multiplier, decay_ft = decay_ft)

struct Structure
    top::GeoField
    faults::Vector{Fault}
end

trace_length(tr) = sum(hypot(tr[k+1][1] - tr[k][1], tr[k+1][2] - tr[k][2]) for k in 1:length(tr)-1)

"Nearest point of a polyline to (x, y): distance, position along the trace as a share of its length, and which side (+1 or -1)."
function nearest_on_trace(tr, x, y)
    total = trace_length(tr); best = (Inf, 0.0, 1.0); run = 0.0
    for k in 1:length(tr)-1
        ax, ay = tr[k]; bx, by = tr[k+1]; dx = bx - ax; dy = by - ay; len = hypot(dx, dy)
        len > 0 || continue
        t = clamp(((x - ax) * dx + (y - ay) * dy) / len^2, 0.0, 1.0)
        d = hypot(x - (ax + t * dx), y - (ay + t * dy))
        if d < best[1]
            cross = dx * (y - ay) - dy * (x - ax)
            best = (d, (run + t * len) / total, cross >= 0 ? 1.0 : -1.0)
        end
        run += len
    end
    return best
end

"Throw of a fault at a share s of the way along its trace: full in the middle, zero at the tips."
fault_throw(f::Fault, s) = f.throw_ft * max(1 - (2 * s - 1)^2, 0.0)

"Depth change a fault adds at (x, y): plus half the local throw on the positive side, minus half on the other, dying out with distance."
function fault_offset(f::Fault, x, y)
    d, s, side = nearest_on_trace(f.trace, x, y)
    decay = isnan(f.decay_ft) ? trace_length(f.trace) / 2 : f.decay_ft
    return side * 0.5 * fault_throw(f, s) * exp(-d / decay)
end

"Top of pay (TVD, ft) at a map position, faults included."
top_at(S::Structure, x, y) = sample(S.top, x, y) + sum((fault_offset(f, x, y) for f in S.faults); init = 0.0)

"Where the segment p to q crosses the segment a to b: the share of the way along p to q, or nothing."
function segment_crossing(px, py, qx, qy, ax, ay, bx, by)
    rx = qx - px; ry = qy - py; sx = bx - ax; sy = by - ay
    den = rx * sy - ry * sx
    den == 0 && return nothing
    t = ((ax - px) * sy - (ay - py) * sx) / den; u = ((ax - px) * ry - (ay - py) * rx) / den
    return (0 <= t <= 1 && 0 <= u <= 1) ? t : nothing
end

"""
    lateral_structure(S; origin_ft, azimuth_deg, length_ft, step_ft = 30, gross = 100)

Top and base of the pay along a lateral that starts at `origin_ft` and runs `length_ft` in the direction
(cos, sin) of `azimuth_deg` in field coordinates. `gross` is the gross thickness: a number, a `GeoField`,
or a `Geology` (its `:gross_ft` field). Returns `md`, `x`, `y`, `top_tvd`, `base_tvd` at `step_ft`
spacing, and `crossings`: for every fault crossed, the measured depth, the jump in the top when going
down the lateral (positive: the pay steps deeper) and the index of the fault. Give `md` (a list of
measured depths from the origin) instead of `length_ft` to choose the sample points yourself.
"""
function lateral_structure(S::Structure; origin_ft, azimuth_deg = 0.0, length_ft = nothing, step_ft = 30.0, gross = 100.0, md = nothing)
    ca = cosd(azimuth_deg); sa = sind(azimuth_deg)
    if isnothing(md)
        isnothing(length_ft) && error("lateral_structure needs `length_ft` or `md`")
        md = collect(0.0:step_ft:length_ft); md[end] < length_ft && push!(md, length_ft)
    else
        md = collect(Float64, md); length_ft = maximum(md)
    end
    xs = origin_ft[1] .+ md .* ca; ys = origin_ft[2] .+ md .* sa
    thick(x, y) = gross isa Number ? Float64(gross) : (gross isa GeoField ? sample(gross, x, y) : sample(gross, :gross_ft, x, y))
    top = [top_at(S, x, y) for (x, y) in zip(xs, ys)]
    base = [t + thick(x, y) for (t, x, y) in zip(top, xs, ys)]
    crossings = NamedTuple{(:md, :throw_ft, :fault), Tuple{Float64, Float64, Int}}[]
    ex = origin_ft[1] + length_ft * ca; ey = origin_ft[2] + length_ft * sa; eps = 1e-6
    for (k, f) in enumerate(S.faults), j in 1:length(f.trace)-1
        t = segment_crossing(origin_ft[1], origin_ft[2], ex, ey, f.trace[j][1], f.trace[j][2], f.trace[j+1][1], f.trace[j+1][2])
        isnothing(t) && continue
        m = t * length_ft
        before = top_at(S, origin_ft[1] + (m - eps) * ca, origin_ft[2] + (m - eps) * sa); after = top_at(S, origin_ft[1] + (m + eps) * ca, origin_ft[2] + (m + eps) * sa)
        push!(crossings, (md = m, throw_ft = after - before, fault = k))
    end
    sort!(crossings; by = c -> c.md)
    return (md = md, x = xs, y = ys, top_tvd = top, base_tvd = base, crossings = crossings)
end

"""
    synthetic_structure(; nx, ny, cell_ft, seed, top_ft = 9000, dip_deg = 0.5, dip_azimuth_deg = 0,
                          residual_ft = 20, residual_range_ft = 12000, faults = Fault[])

A top-of-pay surface for games and tests: a plane dipping `dip_deg` towards `dip_azimuth_deg` (deeper in
that direction), pinned to `top_ft` at the middle of the grid, plus a correlated residual with standard
deviation `residual_ft` and the given variogram range. Not a description of any real field.
"""
function synthetic_structure(; nx, ny, cell_ft, seed = 1, top_ft = 9000.0, dip_deg = 0.5, dip_azimuth_deg = 0.0, residual_ft = 20.0, residual_range_ft = 12000.0,
        model = :spherical, faults = Fault[], x0 = 0.0, y0 = 0.0)
    z = gaussian_field(; nx = nx, ny = ny, cell_ft = cell_ft, range_ft = residual_range_ft, model = model, seed = seed, x0 = x0, y0 = y0).field
    xc = x0 + (nx - 1) * cell_ft / 2; yc = y0 + (ny - 1) * cell_ft / 2; g = tand(dip_deg); ca = cosd(dip_azimuth_deg); sa = sind(dip_azimuth_deg)
    vals = [top_ft + g * ((x0 + (i - 1) * cell_ft - xc) * ca + (y0 + (j - 1) * cell_ft - yc) * sa) + residual_ft * z.values[i, j] for i in 1:nx, j in 1:ny]
    return Structure(GeoField(x0, y0, cell_ft, cell_ft, vals), collect(Fault, faults))
end

"""
    synthetic_faults(; n, seed, x_extent, y_extent, length_ft = (5280, 21120), throw_ft = (10, 60),
                       sealing_share = 0.5, multiplier = (0.01, 0.5), bend = 0.05)

`n` faults for games and tests: gently bent three-point traces placed and oriented at random inside the
extent, throw of either sign, a share of them sealing with a multiplier drawn from the given range.
"""
function synthetic_faults(; n, seed = 1, x_extent, y_extent, length_ft = (5280.0, 21120.0), throw_ft = (10.0, 60.0), sealing_share = 0.5, multiplier = (0.01, 0.5), bend = 0.05)
    rng = Random.MersenneTwister(seed); between(r) = r[1] + rand(rng) * (r[2] - r[1])
    return map(1:n) do _
        len = between(length_ft); az = 360 * rand(rng); cx = between(x_extent); cy = between(y_extent)
        hx = cosd(az) * len / 2; hy = sind(az) * len / 2; off = bend * len * (2 * rand(rng) - 1)
        tr = [(cx - hx, cy - hy), (cx - sind(az) * off, cy + cosd(az) * off), (cx + hx, cy + hy)]
        Fault(trace = tr, throw_ft = (rand(rng) < 0.5 ? -1 : 1) * between(throw_ft), multiplier = rand(rng) < sealing_share ? between(multiplier) : 1.0)
    end
end

"""
    well_faults(S; origin_ft, azimuth_deg, width_ft)

The fault traces of a structure in a fractured-well model's own coordinates (x along the lateral, y
across the model), with their multipliers: pass the result to `FracWellSpec` as `fault_traces`. Same
placement arguments as `well_maps`. Faults with a multiplier of 1 are left out.
"""
function well_faults(S::Structure; origin_ft, azimuth_deg = 0.0, width_ft)
    ca = cosd(azimuth_deg); sa = sind(azimuth_deg)
    local_xy(X, Y) = ((X - origin_ft[1]) * ca + (Y - origin_ft[2]) * sa, -(X - origin_ft[1]) * sa + (Y - origin_ft[2]) * ca + width_ft / 2)
    return [(points = [local_xy(p...) for p in f.trace], multiplier = f.multiplier) for f in S.faults if f.multiplier != 1.0]
end

"""
    well_dip(S; origin_ft, azimuth_deg, width_ft, length_ft)

The plane that best fits a structure under a fractured-well model, in the model's own terms: pass
`top_ft`, `dip_deg` (across the model) and `dip_along_deg` (along the lateral) to `FracWellSpec`. Same
placement arguments as `well_maps`; the model runs along the lateral from `start_ft` (in the coordinate of
the spec's `positions_ft`, zero at `origin_ft`) for `length_ft`, and `top_ft` is the plane's depth at the
middle of that, which is where the spec wants it. `misfit_ft` is the largest distance between the surface and
the plane under the model: what a planar model leaves out (curvature, fault steps).
"""
function well_dip(S::Structure; origin_ft, azimuth_deg = 0.0, width_ft, length_ft, start_ft = 0.0, samples = 21)
    ca = cosd(azimuth_deg); sa = sind(azimuth_deg)
    xs = range(start_ft, start_ft + length_ft, length = samples); ys = range(0.0, width_ft, length = samples)
    xm = start_ft + length_ft / 2; ym = width_ft / 2
    depth(x, y) = top_at(S, origin_ft[1] + x * ca - (y - ym) * sa, origin_ft[2] + x * sa + (y - ym) * ca)
    # least squares for z = a + b (x - xm) + c (y - ym) on a regular grid of points: the three sums separate
    n = samples^2; a = 0.0; b = 0.0; c = 0.0; sxx = 0.0; syy = 0.0
    for x in xs, y in ys
        z = depth(x, y); a += z / n; b += z * (x - xm); c += z * (y - ym); sxx += (x - xm)^2; syy += (y - ym)^2
    end
    b /= sxx; c /= syy
    misfit = maximum(abs(depth(x, y) - (a + b * (x - xm) + c * (y - ym))) for x in xs, y in ys)
    return (top_ft = a, dip_deg = atand(c), dip_along_deg = atand(b), misfit_ft = misfit)
end

"Product of the multipliers of every trace that the straight line between two points crosses (1 if none)."
function crossing_multiplier(traces, x1, y1, x2, y2)
    m = 1.0
    for tr in traces, k in 1:length(tr.points)-1
        isnothing(segment_crossing(x1, y1, x2, y2, tr.points[k][1], tr.points[k][2], tr.points[k+1][1], tr.points[k+1][2])) || (m *= tr.multiplier; break)
    end
    return m
end
