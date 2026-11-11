# Several fractures growing at the same time from one stage (one per perforation cluster).
#
# Each fracture is the height-growth model of heightgrow.jl. Two things tie them together:
#   1. One wellbore. Every cluster sees the same pressure inside the casing; fluid reaches a fracture
#      through that cluster's perforations, which cost a pressure drop that rises with the square of
#      the rate. The split of the pump rate between clusters is solved, not declared.
#   2. Stress shadow. An open fracture squeezes the rock beside it, which raises the closure stress
#      its neighbours have to overcome.
#
# How the shadow is modelled, and its limits:
#   - Local and plane strain: the extra stress on fracture k at a position along its length comes only
#     from the neighbours' openings at the SAME position. A neighbour that has not reached that far
#     casts no shadow there. Stress does not spread along the length, so there is no shadow ahead of
#     a neighbour's tip and no turning of fractures.
#   - Size: the normal stress a uniformly pressurised crack puts on a parallel plane (Westergaard's
#     solution; on the centre line it is Sneddon's formula), averaged over the neighbour's height with
#     the weight of an elliptical opening. That weight makes the coupling the elastic energy of
#     elliptical openings, so the coupling matrix is symmetric and positive definite at every spacing.
#     (The centre-line value alone is not: three fractures a tenth of a height apart become unstable.)
#   - The neighbour enters through its cross-section area (its area-equivalent pressure) and its own
#     local height. Exact when the fractures are contained in the pay. (Using the mean height of the
#     pair, or the pay height, makes the coupling lose positive definiteness once fractures grow about
#     15% taller than the pay, and the run blows up; both were tried.)
#   - Because the neighbour acts through its average (area-equivalent) pressure, its shadow stops rising with its
#     pressure once its height grows fast: more pressure then mostly adds height, not average load.
#     A consequence: close clusters that grow far out of the pay run away together. The coupling stays positive
#     definite up to about 1.7 times the pay height for five clusters a tenth of a height apart, 2.5 times for three
#     clusters a quarter apart, 5 times at one height apart; beyond that the run stops with an error.
#   - The shadow is taken as uniform over the height, so it does not change the height criterion.
#   - An earlier stage can be included as a fixed background: what its fractures still hold open (fluid not yet
#     leaked off, or at least the proppant pack) shadows the new stage through the same kernel. The earlier
#     fractures themselves do not respond, and fractures do not turn towards or away from each other.
#   - No friction along the casing between clusters.
#
# Equations for fracture k (p = net pressure over the pay closure stress plus the shadow S_k):
#   dA(p_k)/dt = d/dx [ M(p_k) d(p_k + S_k)/dx ] - leak-off + inflow at the well
#   S_k(x) = sum over neighbours j of  Phi(d_kj / c_j) E' A_j(x) / (2 pi c_j^2),   c_j = the neighbour's half-height there
#   p_well = p_k(0) + S_k(0) + perforation drop(2 q_k),    sum of q_k = half the stage rate (one wing)
# All fractures are solved together in every time step (Newton, banded solve).
#
# Two wings (`two_wings = true`, used by parentchild.jl). By default one wing of each fracture is solved and the other
# is its mirror image. When the rock differs on the two sides of the well (a depleted parent on one side), both wings
# are solved as one fracture through the well: the cluster's rate (perforation friction on the whole of it) enters
# half into the first cell of each wing, and the face between those two cells carries fluid from one wing to the other
# by the same flow rule as any other face. Each wing has its own length, pressure and leak-off. Wings shadow only
# wings on their own side. (Two earlier forms failed: a perforation equation per wing made the border matrix singular
# to round-off, and "equal inlet pressures" says nothing while a first cell is still dry, so the solver went back and
# forth between rules.) Sand enters each wing with the fluid that wing takes.
# `stress_offset[k]` (a function of distance from the well, Pa) is a change of the pay's closure stress along wing k:
# it enters like the shadow, as part of the fluid pressure that drives flow. Unlike the shadow it is a change of the pay
# alone: the barriers keep their stress, so where the pay's stress has fallen the contrast that holds the fracture in
# the pay has risen by the same amount. The cross-section table is built for one contrast; a cell with contrast
# lambda times that reads it at p / lambda and scales the result (area by lambda, conductance by lambda^3), which is
# exact when toughness is negligible against the contrast (the scaled reading stands for a toughness lambda times
# larger). Only for the plain three-layer rock; with `layers` the contrast is left as it is.
# `leak_factor[k]` multiplies the leak-off coefficient along wing k.
# Wings are ordered: one side for every cluster, then the other side for every cluster.
#
# Proppant acting back on the flow (`proppant_feedback = true`; off by default, and then nothing here changes).
# Every cell gets a factor between a full pack's and 1 on its conductance (`flow_factor`, proppant.jl): slurry thickens with
# concentration, a bank takes its share of the cross-section out of the flow, a packed cell lets fluid through only as a
# porous pack. The flow across a face is multiplied by the harmonic mean of its two cells' factors (two half-cells in
# series). The factors come from the proppant and the cross-section at the START of the time step and are fixed numbers
# during the solve, so the solve itself is unchanged; the price is a dependence on the time step, which the suite bounds
# by halving it. What follows without further rules: grains that cannot enter a narrow tip pile up in front of it, the
# cell packs, flow to the tip stops, length stops growing, and the pressure behind the pack rises and widens the fracture
# (tip screen-out). When the pack backs up to the well the wellbore pressure climbs. `pressure_limit` (Pa over the pay's
# closure stress, inside the casing) ends the job at the end of the step in which the wellbore pressure passes it.
# If instead the pressure reaches what the barriers can hold, the job ends at the start of that step (`stop_reason`).
# That is a safeguard: in every case tried, the fracture grows in height as the pressure nears that value and takes
# the fluid, so the pressure stays below it (weak barriers show as a tall fracture, not as a stopped job).
# Resolution: the time and place of the first pack converge with the grid. What happens after it does too from about
# 250 cells up; on coarser grids the pack can be breached once and the tip run on (seen at 75 to 150 cells). The
# default is 300 cells. Halving the time step alone is not a refinement of this solver, with or without proppant:
# its tip rule ties the step to the cell size (steps = 2 x cells), and cells and steps are refined together.
# With feedback on, whether grains can enter the next cell is not a yes or no at the end of the step but the share of
# the step during which that cell is wide enough (`open_share`, proppant.jl).
# Not modelled: grains moving at a different speed from the fluid along the fracture, the bank's real shape while
# pumping (mean width), a pack holding the walls apart when pressure falls, erosion of a bank by fast flow above it
# (only the deposit rule of the settling model), perforation or wellbore bridging.

using LinearAlgebra
using Serialization

"""
Compressive normal stress, per unit net pressure, that a uniformly pressurised plane-strain crack of
half-height `c` puts on a parallel plane at distance `y`, at height `z` above the crack centre.
"""
function shadow_field(y, z, c)
    zeta = complex(z, y)
    s = sqrt(zeta - c) * sqrt(zeta + c)
    return 1 - real(zeta / s) + y * c^2 * imag(1 / s^3)
end

"Sneddon's centre-line value of the same stress; x = distance / half-height."
shadow_midline(x) = 1 - x^3 / (1 + x^2)^1.5

"The field averaged over an aligned neighbour of the same height, weight sqrt(c^2 - z^2) (Gauss-Chebyshev)."
function shadow_weighted_quadrature(x; n = 1500)
    x <= 0 && return 1.0
    s = 0.0
    for k in 1:n
        th = k * pi / (n + 1)
        s += sin(th)^2 * shadow_field(x, cos(th), 1.0)
    end
    return 2 * s / (n + 1)
end

"Plain (unweighted) average of the field over an aligned neighbour of the same height."
function shadow_average(x; n = 20_000)
    s = 0.0
    for k in 1:n
        s += shadow_field(x, -1 + (2k - 1) / n, 1.0)
    end
    return s / n
end

"""
The weighted average by a different route (Fourier transform of two elliptical openings):
2 * integral over t of (1 + t x) exp(-t x) J1(t)^2 / t. Used only to check `shadow_weighted_quadrature`.
"""
function shadow_weighted_fourier(x; tmax = 45 / x, dt = 0.005)
    m = ceil(Int, tmax) + 60
    j1(t) = (s = 0.0; for j in 1:m; th = (j - 0.5) * pi / m; s += cos(th - t * sin(th)); end; s / m)
    g(t) = t == 0 ? 0.0 : (1 + t * x) * exp(-t * x) * j1(t)^2 / t
    n = 2 * ceil(Int, tmax / dt / 2); h = tmax / n
    s = g(0.0) + g(tmax)
    for k in 1:n-1
        s += (isodd(k) ? 4 : 2) * g(k * h)
    end
    return 2 * s * h / 3
end

const SHADOW_NT = 1200
const SHADOW_TAB = Ref{Vector{Float64}}()
function shadow_table()                 # holds (1 + x^2) * Phi(x) at x = u / (1 - u): a smooth curve from 1 to 1.5
    if !isassigned(SHADOW_TAB)
        xs = [(k / SHADOW_NT) / (1 - k / SHADOW_NT) for k in 0:SHADOW_NT-1]
        SHADOW_TAB[] = vcat([(1 + x^2) * shadow_weighted_quadrature(x) for x in xs], 1.5)
    end
    return SHADOW_TAB[]
end

"Weighted shadow factor and its slope at x = distance / half-height (table in x / (1 + x))."
function shadow_weighted(x)
    tab = shadow_table(); nt = SHADOW_NT
    u = x / (1 + x); f = u * nt; k = min(floor(Int, f), nt - 1)
    g = tab[k+1] + (f - k) * (tab[k+2] - tab[k+1]); dg = (tab[k+2] - tab[k+1]) * nt * (1 - u)^2
    return (g / (1 + x^2), dg / (1 + x^2) - 2 * x * g / (1 + x^2)^2)
end

"Coupling matrix I + Phi for fractures at `positions` with a common half-height `c` (contained fractures)."
function shadow_matrix(positions, c; kernel = x -> shadow_weighted(x)[1])
    n = length(positions)
    return [k == j ? 1.0 : kernel(abs(positions[k] - positions[j]) / c) for k in 1:n, j in 1:n]
end

"""
Pressure drop through one cluster's perforations (Pa), orifice equation: rho v^2 / (2 Cd^2) with v the
velocity through the holes. `q` is the rate through the whole cluster (m3/s). The constant is
8 / pi^2 = 0.8106; some papers print 0.808 (0.3% lower).
"""
perforation_drop(q; shots, diameter, discharge = 0.7, density = 1000.0) = 8 * density * q * abs(q) / (pi^2 * shots^2 * diameter^4 * discharge^2)

"Cross-section properties against net pressure, tabulated once per stage (same table as `p3d_grow` builds)."
struct SectionTable
    a::Float64; dp::Float64; n::Int; p_top::Float64; p_cap::Float64
    A::Vector{Float64}; W::Vector{Float64}; G::Vector{Float64}; c::Vector{Float64}; Mc::Vector{Float64}
    up::Vector{Float64}; dn::Vector{Float64}        # upper and lower tip, measured from the middle of the start layer
end

function section_table(; pay, dsigma, KIc, Eprime, mu, p_pkn, ntable = 240, extra = 0.0)
    a = pay / 2
    p_cap = 0.995 * (dsigma * (1 - (2 / pi) * asin(1 / 200)) + KIc / sqrt(pi * 200a))
    p_top = min(p_cap, 3 * p_pkn + extra)            # `extra`: room for net pressures above the usual range (a wing in depleted rock)
    grid = [p_top * (k / ntable) for k in 0:ntable]
    secs = [k == 1 ? (c = a, A = 0.0, I3 = 0.0, wmax = 0.0) : section(grid[k], a, dsigma, KIc, Eprime) for k in 1:ntable+1]
    M = [s.I3 / (12 * mu) for s in secs]
    Phi = zeros(ntable + 1)
    for k in 2:ntable+1
        Phi[k] = Phi[k-1] + (grid[k] - grid[k-1]) * (M[k-1] + 4 * (section(0.5 * (grid[k-1] + grid[k]), a, dsigma, KIc, Eprime).I3 / (12 * mu)) + M[k]) / 6
    end
    return SectionTable(a, grid[2], ntable, p_top, p_cap, [s.A for s in secs], [s.wmax for s in secs], Phi .^ (1 / 4), [s.c for s in secs], M .^ (1 / 3), [s.c for s in secs], [s.c for s in secs])
end

"""
The same table for layered rock (layers.jl): the tips are marched outward as the pressure rises, so each
entry continues from the one before. The top of the table sits just below the pressure at which a tip
finds nothing that stops it.
"""
function layered_table(L::StressLayers; Eprime, mu, p_pkn, ntable = 240, extra = 0.0)
    zb = L.z[L.start-1]; zt = L.z[L.start]; a = (zt - zb) / 2; zc = (zt + zb) / 2
    runs(p) = layer_tips(L, p, zb, zt)[3]
    p_cap = Inf
    if runs(3 * p_pkn + extra)
        lo = 0.0; hi = 3 * p_pkn + extra
        for _ in 1:50
            m = 0.5 * (lo + hi)
            runs(m) ? (hi = m) : (lo = m)
        end
        p_cap = 0.995 * lo
    end
    p_top = min(p_cap, 3 * p_pkn + extra)
    grid = [p_top * (k / ntable) for k in 0:ntable]
    A = zeros(ntable + 1); W = zeros(ntable + 1); M = zeros(ntable + 1); Phi = zeros(ntable + 1); c = fill(a, ntable + 1); up = fill(a, ntable + 1); dn = fill(a, ntable + 1)
    zl = zb; zu = zt
    for k in 2:ntable+1
        zlm, zum, _ = layer_tips(L, 0.5 * (grid[k-1] + grid[k]), zl, zu)
        Mm = layer_section(L, zlm, zum, 0.5 * (grid[k-1] + grid[k]), Eprime).I3 / (12 * mu)
        zl, zu, _ = layer_tips(L, grid[k], zlm, zum)
        sec = layer_section(L, zl, zu, grid[k], Eprime)
        A[k] = sec.A; W[k] = sec.wmax; M[k] = sec.I3 / (12 * mu); c[k] = sec.c; up[k] = zu - zc; dn[k] = zc - zl
        Phi[k] = Phi[k-1] + (grid[k] - grid[k-1]) * (M[k-1] + 4 * Mm + M[k]) / 6
    end
    return SectionTable(a, grid[2], ntable, p_top, p_cap, A, W, Phi .^ (1 / 4), c, M .^ (1 / 3), up, dn)
end

"Upper and lower tip (from the middle of the start layer) at net pressure p, read from the table."
function sec_tips(T::SectionTable, p)
    p <= 0 && return (T.a, T.a)
    k = min(floor(Int, p / T.dp) + 1, T.n); f = p / T.dp - (k - 1)
    return (T.up[k] + f * (T.up[k+1] - T.up[k]), T.dn[k] + f * (T.dn[k+1] - T.dn[k]))
end

"Area, its slope, flow potential, conductance, its slope, half-height and its slope at net pressure p."
@inline function sec_lookup(T::SectionTable, p)
    p <= 0 && return (0.0, T.A[2] / T.dp, 0.0, 0.0, 0.0, T.a, 0.0)
    if p >= T.p_top
        T.p_top < T.p_cap && throw(GrowthOverflow("net pressure left the tabulated range", T.p_top))
        error("height runaway: net pressure reached what the barriers can hold ($(round(T.p_cap / 1e6, digits = 2)) MPa)")
    end
    k = min(floor(Int, p / T.dp) + 1, T.n); f = p / T.dp - (k - 1)
    dA = (T.A[k+1] - T.A[k]) / T.dp
    gp = (T.G[k+1] - T.G[k]) / T.dp; g = T.G[k] + f * (T.G[k+1] - T.G[k])
    dc = (T.c[k+1] - T.c[k]) / T.dp
    return (T.A[k] + f * (T.A[k+1] - T.A[k]), dA, g^4, 4 * g^3 * gp, 12 * g^2 * gp^2, T.c[k] + f * (T.c[k+1] - T.c[k]), dc)
end

"""
Conductance and its slope, continuous in p (cube root interpolated, exact for a contained fracture).
The upwind flow uses this one: the conductance returned by `sec_lookup` is the slope of the
interpolated flow potential, which jumps a little at every table node, and a residual that jumps
has no root to converge to.
"""
@inline function sec_mobility(T::SectionTable, p)
    p <= 0 && return (0.0, 0.0)
    k = min(floor(Int, p / T.dp) + 1, T.n); f = p / T.dp - (k - 1)
    mp = (T.Mc[k+1] - T.Mc[k]) / T.dp; m = T.Mc[k] + f * (T.Mc[k+1] - T.Mc[k])
    return (m^3, 3 * m^2 * mp)
end

sec_wmax(T::SectionTable, p) = p <= 0 ? 0.0 : (k = min(floor(Int, p / T.dp) + 1, T.n); T.W[k] + (p / T.dp - (k - 1)) * (T.W[k+1] - T.W[k]))

struct GrowthOverflow <: Exception
    msg::String
    p_top::Float64                 # top of the cross-section table when the net pressure left it (NaN otherwise)
end
GrowthOverflow(msg) = GrowthOverflow(msg, NaN)

"""
Flow between two neighbouring cells of one fracture, times dx, and its slopes against the two
pressures and the two shadow stresses.

`upwind = false` (a fracture on its own): the exact integral of the conductance between the two
pressures, the same scheme as `p3d_grow`.

`upwind = true` (fractures that shadow each other): conductance of the cell the fluid leaves, times
the difference of p + S. Reasons: own pressure and shadow should share one conductance (otherwise a
neighbour's pressure in a newly wetted tip cell can outweigh the fracture's own), and it should not
rise with the pressure of the cell the fluid enters. Two earlier versions that broke one of these
rules did not converge; a separate round-off defect found later was present in those runs too, so
how much each contributed was not separated. Plain upwinding is first-order and four times too
conductive at the tip, so the conductance is scaled by `k`: the ratio of the exact mean conductance
to the upstream one, taken from the pressures at the START of the time step (a fixed number during
the solve, applied whichever way the fluid ends up going).
"""
@inline function face_flow(pL, pR, SL, SR, PhL, PhR, ML, MR, dML, dMR, upwind, k)
    upwind || return (PhL - PhR, ML, -MR, 0.0, 0.0)
    dT = pR - pL + SR - SL
    if dT < 0
        return (-k * ML * dT, k * (ML - dML * dT), -k * ML, k * ML, -k * ML)
    else
        return (-k * MR * dT, k * MR, k * (-MR - dMR * dT), k * MR, -k * MR)
    end
end

"""
    stage_grow(; pay, dsigma, KIc, Eprime, mu, q_stage, t_end, positions, perf_coeff, C_L = 0, ...)

Grow all the fractures of one stage together (SI units). `positions` are the cluster positions along
the well (m), `q_stage` the pump rate into the stage (all clusters, both wings), `perf_coeff[k]` the
perforation friction of cluster k in Pa per (m3/s)^2 of cluster rate (see `perforation_drop`).
Returns one result per fracture with the same fields as `p3d_grow`, plus the rate history and the
share of the fluid each took, and the wellbore pressure history.
"""
function stage_grow(; positions, q_stage, table_extra = 0.0, proppant_feedback = false, kwarg...)
    n = length(positions); Qw = q_stage / 2; q_ref = Qw * min(1.0, 1.5 / n); extra = table_extra
    while true
        try
            return stage_grow_once(; positions = positions, q_stage = q_stage, q_ref = q_ref, table_extra = extra, proppant_feedback = proppant_feedback, kwarg...)
        catch e
            e isa GrowthOverflow || rethrow()
            if proppant_feedback && isfinite(e.p_top)        # the pack raised the pressure beyond the table: more table, same grid
                extra += e.p_top
                continue
            end
            q_ref >= Qw && error("stage growth: a fracture outran the grid even when sized for the whole stage rate (" * e.msg * ")")
            q_ref = min(Qw, 1.6 * q_ref)
        end
    end
end

function stage_grow_once(; pay = nothing, dsigma = 0.0, KIc = 0.0, layers = nothing, Eprime, mu, q_stage, q_ref, t_end, C_L = 0.0, positions, perf_coeff = zeros(length(positions)),
        ncell = 300, nstep = 2 * ncell, ntable = 240, margin = 1.15, xmax = nothing, proppant = nothing, shadow = true, kernel = shadow_weighted, flow = :auto, background = nothing, pump_time = nothing, shut_steps = 0, shut_margin = 2.5,
        two_wings = false, stress_offset = nothing, leak_factor = nothing, table_extra = 0.0, proppant_feedback = false, slurry_exponent = 2.5, pressure_limit = nothing, monitor = nothing, stepped = nothing, table_reach = 1)
    # `stepped`: nothing (one job, sized and stepped from its own length, as always), or a job pumped in schedule steps that can be
    # stopped and continued (`stage_start`, `stage_pump`; see the notes above them). `table_reach`: the cross-section table reaches
    # this many times its usual top, with as many times the entries, so the entries of the usual range stay what they are.
    isstep = !isnothing(stepped)
    # `monitor`: a function called at the end of every time step with the live state (step, t, p, suspended, slurry_area, banked,
    # area, flow_factor, wellbore_pressure, rate); copy what you keep. For tests and diagnosis.
    isnothing(layers) || (pay = layers.z[layers.start] - layers.z[layers.start-1])     # layered rock: the pay is the start layer
    isnothing(pay) && error("stage_grow needs `pay` and `dsigma`, or `layers`")
    ncl = length(positions)
    length(perf_coeff) == ncl || error("perf_coeff needs one value per cluster")
    if two_wings                                      # both wings of every cluster: one side first, then the other
        positions = vcat(positions, positions); perf_coeff = vcat(perf_coeff, perf_coeff)
    end
    N = length(positions); M = ncell; a = pay / 2; Qw = q_stage / 2
    side = two_wings ? vcat(fill(1, ncl), fill(-1, ncl)) : zeros(Int, N)
    mate = two_wings ? vcat(collect(ncl+1:2ncl), collect(1:ncl)) : zeros(Int, N)
    hm = two_wings ? 0.5 : 1.0                        # weight of a wing's rate in the rate balance (a mirrored wing counts once in Qw)
    pairs = [j != k && side[j] == side[k] for k in 1:N, j in 1:N]      # who shadows whom: other fractures on the same side
    for (name, v) in (("stress_offset", stress_offset), ("leak_factor", leak_factor))
        isnothing(v) || length(v) == N || error("$name needs one function per wing ($N here)")
    end
    simc = pkn_similarity(n = 20_000)
    t_grow = isnothing(pump_time) ? t_end : pump_time            # the fracture grows only while the pumps run
    p_pkn = Eprime * simc.c_w * (mu * q_ref^2 / (Eprime * pay))^(1 / 5) * t_grow^(1 / 5) / (2 * pay)
    isnothing(pressure_limit) || (table_extra = max(table_extra, 1.2 * pressure_limit - 3 * p_pkn))       # the table must reach the limit
    if table_reach != 1
        (table_reach isa Integer && table_reach >= 1) || error("table_reach must be a whole number of 1 or more")
        table_extra += 3 * p_pkn * (table_reach - 1); ntable *= table_reach
    end
    # (a continued job brings the table it was started with: building it is most of the cost of a short call)
    T = (isstep && !isnothing(stepped.fields)) ? stepped.fields.T :
        isnothing(layers) ? section_table(pay = pay, dsigma = dsigma, KIc = KIc, Eprime = Eprime, mu = mu, p_pkn = p_pkn, ntable = ntable, extra = table_extra) :
        layered_table(layers; Eprime = Eprime, mu = mu, p_pkn = p_pkn, ntable = ntable, extra = table_extra)
    tips(v, l = 1.0) = isnothing(layers) ? (c = section_half_height(v, a, dsigma * l, KIc); (c, c)) : sec_tips(T, v)
    # readings of the table for a cell whose stress contrast is l times the table's (see the header)
    @inline seclk(l, v) = l == 1.0 ? sec_lookup(T, v) : (r = sec_lookup(T, v / l); (l * r[1], r[2], l^4 * r[3], l^3 * r[4], l^2 * r[5], r[6], r[7] / l))
    @inline secmb(l, v) = l == 1.0 ? sec_mobility(T, v) : (r = sec_mobility(T, v / l); (l^3 * r[1], l^2 * r[2]))
    if isnothing(xmax)
        xmax = simc.c_L * (Eprime * q_ref^3 / (mu * pay^4))^(1 / 5) * t_grow^(4 / 5)
        C_L > 0 && (xmax = min(xmax, q_ref * sqrt(t_grow) / (pi * C_L * pay)))
        xmax *= margin
        isnothing(pump_time) || (xmax *= shut_margin)       # after the pumps stop the stored fluid keeps pushing the tip on for a while
    end
    dx = xmax / M
    dist = [abs(positions[k] - positions[j]) for k in 1:N, j in 1:N]
    couple = shadow && any(pairs)
    # Stress from fractures that are already there (an earlier stage): a fixed field, added to every fracture's shadow.
    # `background` is a list of (position, dx, area, half_height): what each earlier fracture still holds open along its length.
    S_ext = zeros(N, M)
    if !isnothing(background)
        for e in background, i in 1:M
            j = floor(Int, (i - 0.5) * dx / e.dx) + 1
            (1 <= j <= length(e.area) && e.area[j] > 0 && e.half_height[j] > 0) || continue
            for k in 1:N
                S_ext[k, i] += kernel(abs(positions[k] - e.position) / e.half_height[j])[1] * Eprime * e.area[j] / (2 * pi * e.half_height[j]^2)
            end
        end
    end
    LF = ones(N, M); ctr = ones(N, M)                 # per cell: leak-off multiplier; stress contrast over the table's
    Soff = isstep ? zeros(N, M) : zeros(0, 0)         # stepped job: the stress change along each wing, kept as numbers
    @inbounds for k in 1:N, i in 1:M
        if !isnothing(stress_offset)
            d = stress_offset[k]((i - 0.5) * dx); S_ext[k, i] += d
            isstep && (Soff[k, i] = d)
            if isnothing(layers) && dsigma > 0 && d != 0
                ctr[k, i] = 1 - d / dsigma
                ctr[k, i] > 0.05 || error("stress_offset raises the pay's stress to within 5% of the barriers' at $(round((i - 0.5) * dx, digits = 1)) m: nothing holds the fracture in the pay there")
            end
        end
        isnothing(leak_factor) || (LF[k, i] = leak_factor[k]((i - 0.5) * dx))
    end
    all(>=(0.0), LF) || error("leak_factor must not be negative")
    if isstep && !isnothing(stepped.fields)           # a continued job: the fields as they were worked out when it started
        copyto!(S_ext, stepped.fields.S_ext); copyto!(LF, stepped.fields.LF); copyto!(ctr, stepped.fields.ctr); copyto!(Soff, stepped.fields.Soff)
    end
    upw = flow == :upwind || (flow == :auto && (couple || any(!=(0.0), S_ext)))
    p = zeros(N, M); An = zeros(N, M); tau = fill(Inf, N, M); dem = zeros(N, M)
    Av = zeros(N, M); dAv = zeros(N, M); Phv = zeros(N, M); Mv = zeros(N, M); dMv = zeros(N, M); cv = fill(a, N, M); dcv = zeros(N, M)
    S = copy(S_ext); dS = zeros(N, N, M); R = zeros(N, M); act = falses(N, M)
    kap = fill(0.25, N, M)
    Fx = zeros(N, M); fpl = zeros(N, M); fpr = zeros(N, M); fsl = zeros(N, M); fsr = zeros(N, M)   # face i sits between cells i and i + 1
    Fc = zeros(ncl); fcl = zeros(ncl); fcr = zeros(ncl); fcsl = zeros(ncl); fcsr = zeros(ncl); kapc = fill(0.25, ncl)   # two wings: the face at the well, from the first wing to its mate
    q = fill(Qw / (N * hm), N); pwb = 0.0; Eb = zeros(N + 1); Qnow = Ref(Qw)        # Qnow: what the pumps deliver in the current step (one wing)
    vnow = Ref(1.0)                                   # stepped job: the table's viscosity over the fluid's in the current step (all flows scale with it)
    # `pump_time` (seconds, less than t_end): the pumps stop then and the run goes on to t_end with no inflow, so the pressure falls
    # off and the fracture closes on its leak-off. `q_stage` and the grid are sized for the pumping part. `shut_steps` time steps
    # follow the shut-in, short at first.
    t_pump = t_grow
    0 < t_pump <= t_end || error("pump_time must lie between 0 and t_end")
    times = [t_pump * (k / nstep)^2 for k in 1:nstep]
    if t_pump < t_end
        shut_steps > 0 || error("give shut_steps (time steps after the pumps stop) together with pump_time")
        append!(times, [t_pump + (t_end - t_pump) * (k / shut_steps)^2 for k in 1:shut_steps])
    end
    # A stepped job. Its time steps are those of the PLAN (the same law as above, from the planned pumping time, going on at
    # the plan's last step length if the job runs longer), cut where a schedule step ends. They depend on the plan and on the
    # schedule, never on how the schedule is split between calls. A schedule step that ends within a billionth of the planned
    # time of a plan step ends on it.
    Qs = Float64[]; vfs = Float64[]; cs = Float64[]; vfr = Float64[]; kgs = Int[]; kg0 = 1; nplan = nstep; tplan = t_pump
    if isstep
        kg = isnothing(stepped.state) ? 1 : stepped.state.kgrid; kg0 = kg
        ta = isnothing(stepped.state) ? 0.0 : stepped.state.t
        dt_last = tplan * (2 * nplan - 1) / nplan^2; tol = 1e-9 * tplan
        tgrid(k) = k <= nplan ? tplan * (k / nplan)^2 : tplan + (k - nplan) * dt_last
        times = Float64[]
        for st in stepped.steps
            st.duration > 0 || error("a schedule step needs a positive duration")
            (st.Q >= 0 && st.visc > 0 && st.conc >= 0) || error("a schedule step needs a rate and a sand concentration of zero or more and a positive viscosity")
            tb = ta + st.duration
            while tgrid(kg) < tb - tol
                if tgrid(kg) > ta + tol
                    push!(times, tgrid(kg)); push!(Qs, st.Q); push!(vfs, st.visc); push!(cs, st.conc); push!(vfr, st.v_free); push!(kgs, kg + 1)
                end
                kg += 1
            end
            if abs(tgrid(kg) - tb) <= tol
                tb = tgrid(kg); kg += 1
            end
            push!(times, tb); push!(Qs, st.Q); push!(vfs, st.visc); push!(cs, st.conc); push!(vfr, st.v_free); push!(kgs, kg)
            ta = tb
        end
    end
    nstep = length(times)
    L_t = zeros(N, nstep); p0_t = zeros(N, nstep); h0_t = zeros(N, nstep); q_t = zeros(N, nstep); pwb_t = zeros(nstep)
    leaked = zeros(N); injected = zeros(N); t = 0.0; newton_total = 0; qx = zeros(N)      # qx: rate into a wing across the face at the well
    tclose = fill(Inf, N, M); p_shut = zeros(N, M)        # when each cell closed after having been open; pressures when the pumps stopped
    Vp = zeros(N, M); Vp_in = zeros(N); first_pack = fill(Inf, N)       # Vp: suspended grains per unit length
    Hs = zeros(N, M); Vb = zeros(N, M); qo = zeros(M); opn = falses(M); lk = zeros(M); hh = zeros(M)   # laden-slurry area, bank, and work rows
    settle = isnothing(proppant) ? nothing : get(proppant, :settle, nothing); Vp_rej = zeros(N)
    feed = proppant_feedback && !isnothing(proppant)       # the flow feels the proppant
    mcell = ones(N, M); mfx = ones(N, M); mfc = ones(ncl); hprev = zeros(N, M)      # per cell and per face (see the header); heights at the start of the step
    cmax_f = isnothing(proppant) ? 0.6 : (isnothing(settle) ? get(proppant, :cmax, 0.6) : settle.cmax)
    isnothing(pressure_limit) || pressure_limit > 0 || error("pressure_limit must be positive (Pa over the pay's closure stress)")
    stopped = false; stop_reason = ""; planned = 0.0         # planned: grains the schedule would have put into one wing of the stage
    pstart = zeros(N, M); qstart = zeros(N); opf = zeros(M)
    # When and where a cell first lost 99% of its conductance to proppant (a plug). Without feedback `first_pack_time` is, with
    # settling on, the first time sand could not be placed at all (rejected at the well), and with settling off the first time a
    # cell held a full pack. With feedback on, a fracture that plugs far from the well blows up behind the plug and can go on
    # taking all the sand: nothing is rejected, although it screened out long before. So with feedback on `first_pack_time` is
    # the time of the plug if that comes first (it was left infinite at first, and the chain then reported no screen-out).
    plug_t = fill(Inf, N); plug_x = fill(NaN, N)
    function note_plugs!(tnow)
        @inbounds for k in 1:N
            plug_t[k] == Inf || continue
            i = findfirst(<(0.01), view(mcell, k, :))
            isnothing(i) || (plug_t[k] = tnow; plug_x[k] = (i - 0.5) * dx; first_pack[k] = min(first_pack[k], tnow))
        end
    end
    conc_at(tm) = isnothing(proppant) ? 0.0 : (c = 0.0; for (ts, cs) in proppant.schedule; tm >= ts && (c = cs); end; c)
    let tt = 0.0
        for tn in times
            tn <= t_pump * (1 + 1e-12) && (planned += conc_at(tt + (tn - tt) / 2) * Qw * (tn - tt))
            tt = tn
        end
    end
    # banded storage for the cell equations (cells ordered position by position, fracture by fracture)
    nb = N * M; kl = 2N - 1; ku = 2N - 1; ld = 2kl + ku + 1
    AB = zeros(ld, nb); RHS = zeros(nb, N + 1); Cm = zeros(N + 1, nb); Dm = zeros(N + 1, N + 1)
    id(k, i) = (i - 1) * N + k
    p_s = p_pkn; q_s = Qw / N; A_s = max(T.A[end], 1e-300)          # scales: rows by A_s, p_s, q_s; columns by p_s, q_s
    @inline function put!(row, col, v)
        AB[kl+ku+1+row-col, col] += v * p_s / A_s
    end
    function evaluate!(dt, jac)
        r = dt / dx^2
        @inbounds for i in 1:M, k in 1:N
            Av[k, i], dAv[k, i], Phv[k, i], Mv[k, i], dMv[k, i], cv[k, i], dcv[k, i] = seclk(ctr[k, i], p[k, i])
            upw && ((Mv[k, i], dMv[k, i]) = secmb(ctr[k, i], p[k, i]))
        end
        if couple
            fill!(dS, 0.0)
            @inbounds for i in 1:M, k in 1:N
                s = 0.0
                for j in 1:N
                    pairs[k, j] || continue
                    cb = cv[j, i]; x = dist[k, j] / cb          # the neighbour's own height sets the reach of its shadow
                    f, df = kernel(x)
                    pref = Eprime / (2 * pi * cb^2)
                    psi = f * pref; dpsi = pref * (-df * x / cb - 2 * f / cb)
                    s += psi * Av[j, i]
                    dS[k, j, i] += psi * dAv[j, i] + dpsi * dcv[j, i] * Av[j, i]
                end
                S[k, i] = s + S_ext[k, i]
            end
        end
        @inbounds for i in 1:M-1, k in 1:N
            Fx[k, i], fpl[k, i], fpr[k, i], fsl[k, i], fsr[k, i] = face_flow(p[k, i], p[k, i+1], S[k, i], S[k, i+1], Phv[k, i], Phv[k, i+1],
                Mv[k, i], Mv[k, i+1], dMv[k, i], dMv[k, i+1], upw, kap[k, i])
            if feed
                mfac = mfx[k, i]; Fx[k, i] *= mfac; fpl[k, i] *= mfac; fpr[k, i] *= mfac; fsl[k, i] *= mfac; fsr[k, i] *= mfac
            end
            if vnow[] != 1.0
                vfac = vnow[]; Fx[k, i] *= vfac; fpl[k, i] *= vfac; fpr[k, i] *= vfac; fsl[k, i] *= vfac; fsr[k, i] *= vfac
            end
        end
        if two_wings
            @inbounds for c in 1:ncl
                m = c + ncl
                Fc[c], fcl[c], fcr[c], fcsl[c], fcsr[c] = face_flow(p[c, 1], p[m, 1], S[c, 1], S[m, 1], Phv[c, 1], Phv[m, 1], Mv[c, 1], Mv[m, 1], dMv[c, 1], dMv[m, 1], upw, kapc[c])
                if feed
                    mm = mfc[c]; Fc[c] *= mm; fcl[c] *= mm; fcr[c] *= mm; fcsl[c] *= mm; fcsr[c] *= mm
                end
                if vnow[] != 1.0
                    vv = vnow[]; Fc[c] *= vv; fcl[c] *= vv; fcr[c] *= vv; fcsl[c] *= vv; fcsr[c] *= vv
                end
            end
        end
        @inbounds for i in 1:M, k in 1:N
            R[k, i] = Av[k, i] - An[k, i] + r * ((i < M ? Fx[k, i] : 0.0) - (i > 1 ? Fx[k, i-1] : 0.0)) - (i == 1 ? dt * q[k] / dx : 0.0) + dem[k, i]
            two_wings && i == 1 && (R[k, i] += side[k] > 0 ? r * Fc[k] : -r * Fc[k-ncl])
            act[k, i] = p[k, i] > 0 || R[k, i] < 0
        end
        @inbounds for k in 1:N
            Tin = 1.5 * (p[k, 1] + S[k, 1]) - 0.5 * (p[k, 2] + S[k, 2])
            if side[k] < 0
                Eb[k] = (q[mate[k]] - q[k]) / q_s * p_s          # the cluster's rate enters half into each wing's first cell
            elseif two_wings
                # pressure at the well: the mean of what the two wings give, or the open wing's alone while the other is still shut
                m = mate[k]; Tm = 1.5 * (p[m, 1] + S[m, 1]) - 0.5 * (p[m, 2] + S[m, 2])
                wk = p[k, 1] > 0; wm = p[m, 1] > 0
                Tc = wk == wm ? 0.5 * (Tin + Tm) : (wk ? Tin : Tm)
                Qc = q[k] + q[m]                                 # the cluster's rate through its perforations
                Eb[k] = pwb - Tc - perf_coeff[k] * Qc * abs(Qc)
            else
                Qc = 2 * q[k]
                Eb[k] = pwb - Tin - perf_coeff[k] * Qc * abs(Qc)
            end
        end
        Eb[N+1] = (two_wings ? hm * sum(q) : sum(q)) - Qnow[]
        jac || return
        fill!(AB, 0.0); fill!(RHS, 0.0); fill!(Cm, 0.0); fill!(Dm, 0.0)
        @inbounds for i in 1:M, k in 1:N
            row = id(k, i)
            if !act[k, i]
                AB[kl+ku+1, row] = 1.0
                continue
            end
            RHS[row, 1] = R[k, i] / A_s
            put!(row, row, dAv[k, i])
            if i < M                                   # face to the right, enters with +r
                put!(row, row, r * fpl[k, i]); put!(row, id(k, i + 1), r * fpr[k, i])
                if couple
                    for j in 1:N
                        put!(row, id(j, i), r * fsl[k, i] * dS[k, j, i]); put!(row, id(j, i + 1), r * fsr[k, i] * dS[k, j, i+1])
                    end
                end
            end
            if i > 1                                   # face to the left, enters with -r
                put!(row, id(k, i - 1), -r * fpl[k, i-1]); put!(row, row, -r * fpr[k, i-1])
                if couple
                    for j in 1:N
                        put!(row, id(j, i - 1), -r * fsl[k, i-1] * dS[k, j, i-1]); put!(row, id(j, i), -r * fsr[k, i-1] * dS[k, j, i])
                    end
                end
            end
            if two_wings && i == 1                    # the face at the well
                c = side[k] > 0 ? k : k - ncl; m = c + ncl; sg = side[k] > 0 ? r : -r
                put!(row, id(c, 1), sg * fcl[c]); put!(row, id(m, 1), sg * fcr[c])
                if couple
                    for j in 1:N
                        put!(row, id(j, 1), sg * (fcsl[c] * dS[c, j, 1] + fcsr[c] * dS[m, j, 1]))
                    end
                end
            end
            i == 1 && (RHS[row, 1+k] = (-dt / dx) * q_s / A_s)
        end
        @inbounds for k in 1:N                      # wellbore rows, scaled by p_s; the rate row by q_s
            for j in 1:N
                Cm[k, id(j, 1)] = -1.5 * ((j == k) + dS[k, j, 1])
                Cm[k, id(j, 2)] = 0.5 * ((j == k) + dS[k, j, 2])
            end
            if side[k] < 0                            # equal halves of the cluster's rate
                for j in 1:N
                    Cm[k, id(j, 1)] = 0.0; Cm[k, id(j, 2)] = 0.0
                end
                Dm[k, k] = -1.0; Dm[k, mate[k]] = 1.0
            elseif two_wings
                m = mate[k]; wk = p[k, 1] > 0; wm = p[m, 1] > 0
                ak = wk == wm ? 0.5 : (wk ? 1.0 : 0.0); am = 1.0 - ak
                for j in 1:N
                    Cm[k, id(j, 1)] = -1.5 * (ak * ((j == k) + dS[k, j, 1]) + am * ((j == m) + dS[m, j, 1]))
                    Cm[k, id(j, 2)] = 0.5 * (ak * ((j == k) + dS[k, j, 2]) + am * ((j == m) + dS[m, j, 2]))
                end
                Dm[k, k] = -2 * perf_coeff[k] * abs(q[k] + q[m]) * q_s / p_s; Dm[k, m] = Dm[k, k]
                Dm[k, N+1] = 1.0
            else
                Dm[k, k] = -8 * perf_coeff[k] * abs(q[k]) * q_s / p_s
                Dm[k, N+1] = 1.0
            end
            Dm[N+1, k] = hm
        end
        return
    end
    DP = zeros(N, M); p_old = zeros(N, M); q_old = zeros(N)
    # How small a cell's residual can be made at all. The flow across a face is a difference of two nearly equal numbers
    # (flow potentials, or pressures) and carries their round-off. In an ordinary run that is far below the convergence
    # tolerance. Behind a proppant pack it is not: the fracture is blown up to several times its usual pressure, it is so
    # conductive that the pressure is the same along it to six digits, and the round-off of the two potentials is then
    # 1e-10 of the residual's scale, a hundred times the tolerance. The solve then sat still just above the tolerance
    # until it gave up (found through the chain, 2026-11-10). With feedback on, a residual at this floor counts as zero.
    function roundoff_floor(dt)
        r = dt / dx^2; v = 0.0
        face(k, i) = mfx[k, i] * (upw ? kap[k, i] * max(Mv[k, i], Mv[k, i+1]) * (abs(p[k, i]) + abs(p[k, i+1]) + abs(S[k, i]) + abs(S[k, i+1])) : abs(Phv[k, i]) + abs(Phv[k, i+1]))
        @inbounds for i in 1:M, k in 1:N
            p[k, i] > 0 || continue
            v = max(v, abs(Av[k, i]) + abs(An[k, i]) + r * ((i < M ? face(k, i) : 0.0) + (i > 1 ? face(k, i - 1) : 0.0)))
        end
        return 32 * eps() * v
    end
    function merit(Ascale)
        v = 0.0
        @inbounds for i in 1:M, k in 1:N
            v = max(v, p[k, i] > 0 ? abs(R[k, i]) : max(-R[k, i], 0.0))
        end
        return max(v / Ascale, maximum(abs, view(Eb, 1:N)) / p_s, abs(Eb[N+1]) / q_s)
    end
    Vst = 0.0; t_lastpump = 0.0; dead = false; kg_end = kg0
    if isstep && !isnothing(stepped.state)            # a continued job: everything the solver carries from one time step to the next
        s0 = stepped.state
        s0.dead && !isempty(stepped.steps) && error("this job has ended and cannot be continued: " * s0.reason)
        copyto!(p, s0.p); copyto!(tau, s0.tau); copyto!(tclose, s0.tclose); copyto!(p_shut, s0.p_shut); copyto!(q, s0.q); pwb = s0.pwb
        copyto!(leaked, s0.leaked); copyto!(injected, s0.injected); t = s0.t; newton_total = s0.newton
        copyto!(Vp, s0.Vp); copyto!(Vp_in, s0.Vp_in); copyto!(first_pack, s0.first_pack); copyto!(Hs, s0.Hs); copyto!(Vb, s0.Vb); copyto!(Vp_rej, s0.Vp_rej)
        copyto!(hprev, s0.hprev); copyto!(plug_t, s0.plug_t); copyto!(plug_x, s0.plug_x)
        Vst = s0.V_stage; t_lastpump = s0.t_lastpump
    end
    for (kt, tn) in enumerate(times)
        dt = tn - t
        Qnow[] = isstep ? Qs[kt] : (tn <= t_pump * (1 + 1e-12) ? Qw : 0.0)
        isstep && (vnow[] = vfs[kt])
        @inbounds for i in 1:M, k in 1:N
            An[k, i] = seclk(ctr[k, i], p[k, i])[1]
            t_in = tau[k, i] == Inf ? t + dt / 2 : tau[k, i]
            dem[k, i] = 4 * pay * C_L * LF[k, i] * (sqrt(tn - t_in) - sqrt(max(t - t_in, 0.0)))
        end
        if upw                                    # exact-mean correction of the upwind conductance, from the old pressures
            @inbounds for i in 1:M-1, k in 1:N
                pl = p[k, i]; pr = p[k, i+1]; hi = max(pl, pr); lf = 0.5 * (ctr[k, i] + ctr[k, i+1])     # one section rule for the face
                Mhi = hi > 0 ? secmb(lf, hi)[1] : 0.0
                dPhi = abs(seclk(lf, pl)[3] - seclk(lf, pr)[3])
                if Mhi <= 0 || dPhi <= 0                  # dry, or too thin to tell: the tip value of a contained fracture
                    kap[k, i] = 0.25
                else
                    kap[k, i] = abs(pl - pr) < 1e-9 * hi ? 1.0 : clamp(dPhi / (abs(pl - pr) * Mhi), 0.05, 1.0)
                end
            end
            two_wings && @inbounds for c in 1:ncl
                pl = p[c, 1]; pr = p[c+ncl, 1]; hi = max(pl, pr); lf = 0.5 * (ctr[c, 1] + ctr[c+ncl, 1])
                Mhi = hi > 0 ? secmb(lf, hi)[1] : 0.0
                dPhi = abs(seclk(lf, pl)[3] - seclk(lf, pr)[3])
                kapc[c] = (Mhi <= 0 || dPhi <= 0) ? 0.25 : (abs(pl - pr) < 1e-9 * hi ? 1.0 : clamp(dPhi / (abs(pl - pr) * Mhi), 0.05, 1.0))
            end
        end
        (feed || isstep) && (copyto!(pstart, p); copyto!(qstart, q)); pwb_start = pwb
        if feed                                   # what the proppant leaves of each cell's conductance, from the state at the start of the step
            @inbounds for i in 1:M, k in 1:N
                mcell[k, i] = flow_factor(An[k, i], hprev[k, i], Vp[k, i], Hs[k, i], Vb[k, i]; cmax = cmax_f, diameter = proppant.diameter, exponent = slurry_exponent)
            end
            @inbounds for i in 1:M-1, k in 1:N
                mfx[k, i] = 2 * mcell[k, i] * mcell[k, i+1] / (mcell[k, i] + mcell[k, i+1])
            end
            two_wings && @inbounds for c in 1:ncl
                mfc[c] = 2 * mcell[c, 1] * mcell[c+ncl, 1] / (mcell[c, 1] + mcell[c+ncl, 1])
            end
            note_plugs!(t)
        end
        Ascale = max(maximum(An), dt * maximum(abs, q) / dx, dt * Qw / (N * dx))
        converged = false; trace = String[]; steps_taken = String[]; broke_out = false; capped = 0; at_top = false
        try
        for it in 1:200
            evaluate!(dt, true)
            newton_total += 1
            viol = 0.0
            @inbounds for i in 1:M, k in 1:N
                viol = max(viol, p[k, i] > 0 ? abs(R[k, i]) : max(-R[k, i], 0.0))
            end
            well = max(maximum(abs, view(Eb, 1:N)) / p_s, abs(Eb[N+1]) / q_s)
            push!(trace, @sprintf("%.1e/%.1e", viol / Ascale, well))
            if viol < 1e-12 * Ascale && well < 1e-11
                converged = true; break
            end
            if feed && well < 1e-11 && viol < roundoff_floor(dt)       # as small as round-off lets it be (see roundoff_floor)
                converged = true; break
            end
            _, ipiv = LinearAlgebra.LAPACK.gbtrf!(kl, ku, nb, AB)
            LinearAlgebra.LAPACK.gbtrs!('N', kl, ku, nb, AB, ipiv, RHS)
            YR = view(RHS, :, 1); YB = view(RHS, :, 2:N+1)
            # border: (D - C YB) db = Eb_scaled - C YR ; unknowns scaled (q by q_s, wellbore pressure by p_s)
            Sc = copy(Dm); rb = zeros(N + 1)
            @inbounds for k in 1:N
                rb[k] = Eb[k] / p_s
            end
            rb[N+1] = Eb[N+1] / q_s
            @inbounds for k in 1:N
                rb[k] -= dot(view(Cm, k, :), YR)
                for j in 1:N
                    Sc[k, j] -= dot(view(Cm, k, :), view(YB, :, j))
                end
            end
            db = Sc \ rb
            @inbounds for i in 1:M, k in 1:N
                row = id(k, i)
                dpv = YR[row]
                for j in 1:N
                    dpv -= YB[row, j] * db[j]
                end
                DP[k, i] = act[k, i] ? dpv * p_s : 0.0          # a held cell stays exactly as it is (round-off in the solve once wetted one by 1e-23 Pa)
            end
            copyto!(p_old, p); copyto!(q_old, q); pwb_old = pwb
            lam = 1.0; change = 0.0
            if feed
                # When a cell packs, its conductance falls by orders of magnitude from one step to the next and the first Newton
                # steps overshoot. An iterate above the top of the cross-section table is an error in the table reading, and it
                # once ended a job as "barriers gave way" at a wellbore pressure far below what they hold. So no iteration goes
                # more than half way from where a cell is to the top of its table. If the solution really lies above the table,
                # the iterates then close in on the top without converging; that is recognised and handled after the loop.
                @inbounds for i in 1:M, k in 1:N
                    DP[k, i] < 0 || continue
                    room = 0.5 * (T.p_top * ctr[k, i] - p_old[k, i])
                    -lam * DP[k, i] > room && (lam = max(room, 0.0) / -DP[k, i])
                end
                capped = lam < 1.0 ? capped + 1 : 0
                if capped >= 30
                    at_top = true; break
                end
            end
            while true                                # plain Newton for the first iterations; after that, shorten the step until the residual falls
                change = 0.0
                @inbounds for i in 1:M, k in 1:N
                    pn = p_old[k, i] - DP[k, i] <= 0 ? 0.0 : p_old[k, i] - lam * DP[k, i]      # a cell the full step dries is dried at any step length
                    change = max(change, abs(pn - p_old[k, i])); p[k, i] = pn
                end
                @inbounds for k in 1:N
                    q[k] = q_old[k] - lam * db[k] * q_s
                end
                pwb = pwb_old - lam * db[N+1] * p_s
                it <= 12 && break
                evaluate!(dt, false)
                (merit(Ascale) <= (1 - 1e-4 * lam) * max(viol / Ascale, well) || lam < 1 / 60) && break
                lam /= 2
            end
            push!(steps_taken, @sprintf("%.1e", lam))
            if lam == 1.0 && change < 1e-11 * max(maximum(p), 1.0) && maximum(abs, view(db, 1:N)) < 1e-11 && abs(db[N+1]) < 1e-11
                converged = true; break
            end
        end
        catch e
            runaway = e isa ErrorException && occursin("height runaway", e.msg)
            ((feed && kt > 1 && runaway) || (isstep && (runaway || e isa GrowthOverflow))) || rethrow()
            broke_out = true
            # a stepped job cannot be given a larger table or grid after it has started: it ends here, and says why
            isstep && (dead = true; stop_reason = runaway ? "the net pressure reached what the barriers can hold" :
                "the net pressure left the range tabulated when the job started (" * @sprintf("%.2f", T.p_top / 1e6) * " MPa); start the job with a larger table_reach")
        end
        if at_top                                 # the pressure behind the pack has reached the top of the table
            copyto!(p, pstart); copyto!(q, qstart); pwb = pwb_start
            if isstep
                dead = true; stop_reason = T.p_top < T.p_cap ? "the net pressure left the range tabulated when the job started (" * @sprintf("%.2f", T.p_top / 1e6) * " MPa); start the job with a larger table_reach" :
                    "the pressure behind the proppant pack reached what the barriers can hold"
            else
                T.p_top < T.p_cap && throw(GrowthOverflow("net pressure left the tabulated range", T.p_top))       # more table (stage_grow)
                kt > 1 || error("height runaway: net pressure reached what the barriers can hold ($(round(T.p_cap / 1e6, digits = 2)) MPa)")
            end
            broke_out = true
        end
        if broke_out                              # the pack raised the pressure to what the barriers hold: the job ends where the step began
            copyto!(p, pstart); copyto!(q, qstart); pwb = pwb_start
            stopped = true; dead || (stop_reason = "the pressure behind the proppant pack reached what the barriers can hold")
            nstep = kt - 1; times = times[1:kt-1]; t_pump = min(t_pump, t)
            L_t = L_t[:, 1:kt-1]; p0_t = p0_t[:, 1:kt-1]; h0_t = h0_t[:, 1:kt-1]; q_t = q_t[:, 1:kt-1]; pwb_t = pwb_t[1:kt-1]
            break
        end
        where_stuck = ""
        if !converged
            evaluate!(dt, false)
            kw_ = 1; iw_ = 1; vw_ = -1.0
            @inbounds for i in 1:M, k in 1:N
                v = p[k, i] > 0 ? abs(R[k, i]) : max(-R[k, i], 0.0)
                v > vw_ && ((kw_, iw_, vw_) = (k, i, v))
            end
            nb(i) = 1 <= i <= M ? @sprintf("%.6g", p[kw_, i]) : "-"
            where_stuck = @sprintf("; worst cell: fracture %d, cell %d of %d (residual %.1e of the scale, round-off floor %.1e, pressure %s Pa, held %s, neighbours %s / %s Pa, flow factor %.1e, last step lengths %s)", kw_, iw_, M, vw_ / Ascale,
                roundoff_floor(dt) / Ascale, nb(iw_), !act[kw_, iw_], nb(iw_ - 1), nb(iw_ + 1), mcell[kw_, iw_], join(steps_taken[max(end - 3, 1):end], " "))
        end
        converged || error("stage growth: time step $kt of $nstep did not converge; cell/well residuals of the last iterations: " * join(trace[max(end - 7, 1):end], " ") * where_stuck *
            "; rate shares " * string(round.(q ./ Qw, digits = 4)) * "; lengths in cells " * string([something(findlast(>(0), view(p, k, :)), 0) for k in 1:N]) *
            (couple && maximum(cv) > 1.5 * a ? @sprintf(". The tallest fracture is %.1f times the pay height: clusters this close that grow this tall run away together in this model (each one's shadow on the others falls as it grows taller)", maximum(cv) / a) : ""))
        if maximum(view(p, :, M)) > 1e-3
            isstep || throw(GrowthOverflow("a fracture reached the end of the grid"))
            # a stepped job keeps the grid it started with: it ends where this time step began
            copyto!(p, pstart); copyto!(q, qstart); pwb = pwb_start
            stopped = true; dead = true; stop_reason = @sprintf("a fracture reached the end of the grid fixed when the job started (%.0f m); start the job with a longer plan", xmax)
            nstep = kt - 1; times = times[1:kt-1]
            L_t = L_t[:, 1:kt-1]; p0_t = p0_t[:, 1:kt-1]; h0_t = h0_t[:, 1:kt-1]; q_t = q_t[:, 1:kt-1]; pwb_t = pwb_t[1:kt-1]
            break
        end
        evaluate!(dt, false)
        @inbounds for i in 1:M, k in 1:N
            leaked[k] += (dem[k, i] - (p[k, i] > 0 ? 0.0 : R[k, i])) * dx
            p[k, i] > 0 && tau[k, i] == Inf && (tau[k, i] = t + dt / 2)
        end
        @inbounds for k in 1:N
            injected[k] += q[k] * dt
            two_wings && (qx[k] = side[k] > 0 ? -Fc[k] / dx : Fc[k-ncl] / dx; injected[k] += qx[k] * dt)    # what crossed at the well
        end
        @inbounds for i in 1:M, k in 1:N
            An[k, i] > 0 && p[k, i] == 0 && (tclose[k, i] = tn)       # held fluid at the start of the step, none now
            p[k, i] > 0 && (tclose[k, i] = Inf)                       # open (or open again)
        end
        (isstep ? Qs[kt] > 0 : tn <= t_pump * (1 + 1e-12)) && copyto!(p_shut, p)
        isstep && isnothing(proppant) && cs[kt] > 0 && error("this job was started without proppant; start it with the proppant's properties to pump sand")
        if !isnothing(proppant)
            nbr = get(proppant, :bridge, 3.0) * proppant.diameter
            settle_now = (isstep && !isnothing(settle) && isfinite(vfr[kt])) ? merge(settle, (v_free = vfr[kt],)) : settle     # the step's fluid sets the settling speed
            feed && @inbounds for i in 1:M, k in 1:N
                hprev[k, i] = p[k, i] > 0 ? 2 * cv[k, i] : 0.0
            end
            @inbounds for k in 1:N
                conc = isstep ? cs[kt] : conc_at(t + dt / 2); qin = max(q[k] + qx[k], 0.0) * dt / dx
                Vp_in[k] += conc * qin * dx
                for i in 1:M
                    qo[i] = i < M ? max(Fx[k, i] / dx, 0.0) : 0.0
                    opn[i] = i < M && ctr[k, i+1] * sec_wmax(T, p[k, i+1] / ctr[k, i+1]) >= nbr
                    feed && (opf[i] = i < M ? open_share(ctr[k, i+1] * sec_wmax(T, pstart[k, i+1] / ctr[k, i+1]), ctr[k, i+1] * sec_wmax(T, p[k, i+1] / ctr[k, i+1]), nbr) : 0.0)
                    lk[i] = dem[k, i] - (p[k, i] > 0 ? 0.0 : R[k, i])
                    hh[i] = p[k, i] > 0 ? 2 * cv[k, i] : 0.0
                end
                rej = proppant_sweep!(view(Vp, k, :), view(Hs, k, :), view(Vb, k, :); area = view(Av, k, :), height = hh, q_out = qo, open_next = opn, leak = lk,
                    inflow_V = conc * qin, inflow_H = conc > 0 ? qin : 0.0, dt = dt, dx = dx, settle = settle_now, open_fraction = feed ? opf : nothing)
                Vp_rej[k] += rej * dx; rej > 0 && (first_pack[k] = min(first_pack[k], tn))
                for i in 1:M
                    isnothing(settle) && (Av[k, i] > 0 && Vp[k, i] / Av[k, i] > get(proppant, :cmax, 0.6)) && (first_pack[k] = min(first_pack[k], tn))
                end
            end
        end
        t = tn
        if isstep
            Vst += Qnow[] * dt; Qnow[] > 0 && (t_lastpump = tn); kg_end = kgs[kt]
        end
        @inbounds for k in 1:N
            pk = view(p, k, :)
            kf = findlast(>(1e-3), pk)
            # tip position inside the last wet cell, from the pressure fall towards it. Next to a shorter neighbour the pressure can
            # rise towards the tip; the estimate is then meaningless (it once returned infinity), so the tip is put at most one cell on.
            den = isnothing(kf) || kf == 1 ? 1.0 : pk[kf-1]^3 - pk[kf]^3
            L_t[k, kt] = isnothing(kf) ? 0.0 : (kf == 1 ? dx : (kf - 0.5) * dx + (den > 0 ? min(dx * pk[kf]^3 / den, dx) : dx))
            p0_t[k, kt] = 1.5 * pk[1] - 0.5 * pk[2]
            h0_t[k, kt] = sum(tips(max(p0_t[k, kt], 0.0), ctr[k, 1]))
            q_t[k, kt] = q[k] + qx[k]
        end
        pwb_t[kt] = pwb
        isnothing(monitor) || monitor((step = kt, t = tn, p = p, suspended = Vp, slurry_area = Hs, banked = Vb, area = Av, flow_factor = mcell, wellbore_pressure = pwb, rate = q, dx = dx))
        if !isnothing(pressure_limit) && (isstep ? Qs[kt] > 0 : tn < t_pump * (1 - 1e-12)) && pwb > pressure_limit       # the job ends here
            stopped = true; stop_reason = "the wellbore pressure passed the limit"
            nstep = kt; times = times[1:kt]; isstep || (t_pump = tn)
            L_t = L_t[:, 1:kt]; p0_t = p0_t[:, 1:kt]; h0_t = h0_t[:, 1:kt]; q_t = q_t[:, 1:kt]; pwb_t = pwb_t[1:kt]
            break
        end
    end
    if feed                                       # the factors of the state the run ended in (those above belong to the start of the last step)
        @inbounds for i in 1:M, k in 1:N
            mcell[k, i] = flow_factor(seclk(ctr[k, i], p[k, i])[1], hprev[k, i], Vp[k, i], Hs[k, i], Vb[k, i]; cmax = cmax_f, diameter = proppant.diameter, exponent = slurry_exponent)
        end
        note_plugs!(t)
    end
    steps_here = length(times)                    # time steps taken in this call
    if isstep                                     # the histories of the whole job so far
        if !isnothing(stepped.state)
            h0s = stepped.state.hist
            times = vcat(h0s.t, times); L_t = hcat(h0s.L, L_t); p0_t = hcat(h0s.p0, p0_t); h0_t = hcat(h0s.h0, h0_t); q_t = hcat(h0s.q, q_t); pwb_t = vcat(h0s.pwb, pwb_t)
            steps_here == 0 && evaluate!(1.0, false)                   # nothing pumped in this call: the cross-sections and the shadow of the state as it stands
        end
        state_out = (p = copy(p), tau = copy(tau), tclose = copy(tclose), p_shut = copy(p_shut), q = copy(q), pwb = pwb, leaked = copy(leaked), injected = copy(injected), t = t, newton = newton_total,
            Vp = copy(Vp), Vp_in = copy(Vp_in), first_pack = copy(first_pack), Hs = copy(Hs), Vb = copy(Vb), Vp_rej = copy(Vp_rej), hprev = copy(hprev), plug_t = copy(plug_t), plug_x = copy(plug_x),
            V_stage = Vst, t_lastpump = t_lastpump, kgrid = kg_end, dead = dead, reason = dead ? stop_reason : "",
            limit_at = (stopped && !dead) ? t : (isnothing(stepped.state) ? NaN : stepped.state.limit_at),
            hist = (t = times, L = L_t, p0 = p0_t, h0 = h0_t, q = q_t, pwb = pwb_t))
        fields_out = (S_ext = S_ext, LF = LF, ctr = ctr, Soff = Soff, T = T)
        grid_out = (xmax = xmax, dx = dx, cells = M, p_top = T.p_top, p_cap = T.p_cap, table_entries = T.n, plan_time = tplan, plan_steps = nplan)
        isempty(times) && return (result = nothing, state = state_out, fields = fields_out, grid = grid_out, steps = 0, limit_hit = false)
    end
    x = ((1:M) .- 0.5) .* dx
    total = sum(injected)
    fracs = map(1:N) do k
        pk = p[k, :]
        area = [seclk(ctr[k, i], pk[i])[1] for i in 1:M]
        Vf = sum(area) * dx
        (t = times, L = L_t[k, :], p0 = p0_t[k, :], h0 = h0_t[k, :], x = x, p = pk,
            height = [pk[i] > 1e-3 ? sum(tips(pk[i], ctr[k, i])) : 0.0 for i in 1:M], up = [pk[i] > 1e-3 ? tips(pk[i], ctr[k, i])[1] : 0.0 for i in 1:M], down = [pk[i] > 1e-3 ? tips(pk[i], ctr[k, i])[2] : 0.0 for i in 1:M],
            up0 = tips(max(p0_t[k, end], 0.0), ctr[k, 1])[1], down0 = tips(max(p0_t[k, end], 0.0), ctr[k, 1])[2],
            V_injected = injected[k], V_fracture = Vf, V_leaked = leaked[k], efficiency = Vf / max(injected[k], 1e-300), dx = dx,
            wmax0 = isnothing(layers) ? section(max(p0_t[k, end], 0.0), a, dsigma * ctr[k, 1], KIc, Eprime).wmax : sec_wmax(T, max(p0_t[k, end], 0.0)), area = area,
            proppant_per_length = Vp[k, :] .+ Vb[k, :], proppant_pumped = Vp_in[k], proppant_in_fracture = (sum(view(Vp, k, :)) + sum(view(Vb, k, :))) * dx, first_pack_time = first_pack[k],
            proppant_suspended = Vp[k, :], proppant_banked = Vb[k, :], slurry_area = Hs[k, :], settled = !isnothing(settle), proppant_rejected = Vp_rej[k],
            q = q_t[k, :], share = injected[k] / total, arrival = tau[k, :], closure = tclose[k, :], p_at_shutin = p_shut[k, :], shadow0 = S[k, 1], earlier_stage0 = S_ext[k, 1], perf_drop = (Qc = two_wings ? q[k] + q[mate[k]] : 2 * q[k]; perf_coeff[k] * Qc * abs(Qc)), position = positions[k],
            side = side[k], leak_factor = LF[k, :], stress_offset = isstep ? Soff[k, :] : (isnothing(stress_offset) ? zeros(M) : [stress_offset[k](xx) for xx in x]), contrast_factor = ctr[k, :],
            flow_factor = mcell[k, :], plug_time = plug_t[k], plug_position = plug_x[k])
    end
    # stage totals of grains, both wings: what the schedule would have pumped had the job run to its end, and what was pumped
    res = (fractures = fracs, t = times, wellbore_pressure = pwb_t, V_injected = isstep ? Vst : Qw * t_pump, dx = dx, cells = M, newton = newton_total, table = T, pump_time = isstep ? t_lastpump : t_pump, two_wings = two_wings,
        proppant_feedback = feed, stopped = stopped, stop_reason = stop_reason, stop_time = stopped ? (isstep ? t : t_pump) : NaN, proppant_planned = isstep ? NaN : 2 * planned, proppant_pumped = (two_wings ? 1 : 2) * sum(Vp_in),
        proppant_placed = (two_wings ? 1 : 2) * (sum(Vp) + sum(Vb)) * dx, proppant_rejected = (two_wings ? 1 : 2) * sum(Vp_rej), q_ref = q_ref, table_extra = table_extra, xmax = xmax)
    isstep || return res
    return (result = res, state = state_out, fields = fields_out, grid = grid_out, steps = steps_here, limit_hit = stopped && !dead)
end

"""
What a fracture still holds open `wait` seconds after its stage was shut in, per unit length: its
cross-section area at shut-in less what has leaked off since (the same leak-off law, cell by cell),
but never less than its proppant pack. This is what casts a shadow on the next stage. Not modelled:
fluid moving along the fracture after shut-in, and closure on asperities.
"""
function fracture_residual(f; pay, C_L, wait, pack_porosity = 0.35, position = f.position)
    t_end = f.t[end]
    area = map(eachindex(f.x)) do i
        (f.area[i] > 0 && isfinite(f.arrival[i])) || return 0.0
        lost = 4 * pay * C_L * (sqrt(t_end + wait - f.arrival[i]) - sqrt(max(t_end - f.arrival[i], 0.0)))
        max(f.area[i] - lost, min(f.proppant_per_length[i] / (1 - pack_porosity), f.area[i]))
    end
    return (position = position, dx = f.dx, area = area, half_height = f.height ./ 2)
end

"Shadow stress on each fracture at one position, for given net pressures there (the sum the solver uses)."
function shadow_stress(T::SectionTable, positions, pressures; Eprime, kernel = shadow_weighted)
    n = length(positions)
    return map(1:n) do k
        s = 0.0
        for j in 1:n
            j == k && continue
            Aj, _, _, _, _, cj, _ = sec_lookup(T, pressures[j])
            s += kernel(abs(positions[k] - positions[j]) / cj)[1] * Eprime * Aj / (2 * pi * cj^2)
        end
        s
    end
end

"""
Incremental coupling at one position: identity plus the slope of every fracture's shadow against every
neighbour's pressure. The growth problem is well posed where the symmetric part of this is positive definite.
"""
function shadow_increment(T::SectionTable, positions, pressures; Eprime, kernel = shadow_weighted)
    n = length(positions); B = zeros(n, n)
    for k in 1:n, j in 1:n
        if j == k
            B[k, k] = 1.0; continue
        end
        Aj, dAj, _, _, _, cj, dcj = sec_lookup(T, pressures[j])
        x = abs(positions[k] - positions[j]) / cj; f, df = kernel(x); pref = Eprime / (2 * pi * cj^2)
        B[k, j] = f * pref * dAj + pref * (-df * x / cj - 2 * f / cj) * dcj * Aj
    end
    return B
end

"One entry per fracture of a stage result, in field units (what `grow_stage_clusters` and `finish_stage` return as `clusters`)."
function stage_cluster_summary(r, pay_ft, barrier_above_psi, barrier_below_psi)
    return map(r.fractures) do f
        face = sum(f.height) * f.dx; in_pay = sum(min.(f.height, pay_ft * FT)) * f.dx
        notes = String[]
        f.h0[end] > f.L[end] && push!(notes, @sprintf("height at the well (%.0f ft) exceeds the half-length (%.0f ft): the pseudo-3-D assumption (height small against length) is weak here", f.h0[end] / FT, f.L[end] / FT))
        # The height comes from a rule that says how tall a fracture at rest would be at this net pressure. As the net pressure nears
        # what the weaker barrier adds, that rule's height runs off without limit (twice the pay at 67%, five times at 87%, ten times
        # at 94% for a fracture with little toughness), and it takes no account of the time and fluid such growth needs.
        weakest = min(barrier_above_psi, barrier_below_psi)
        f.p0[end] / PSI > 0.8 * weakest && push!(notes, @sprintf("net pressure at the well (%.0f psi) is %.0f%% of what the weaker barrier adds (%.0f psi): the height given (%.0f ft) is from the steep end of the equilibrium-height rule and means \"not contained\", not a height to rely on",
            f.p0[end] / PSI, 100 * f.p0[end] / PSI / weakest, weakest, f.h0[end] / FT))
        isfinite(f.plug_time) && push!(notes, @sprintf("proppant plugged the fracture %.0f ft from the well %.1f min into the job; what was pumped after that widened the fracture behind the plug", f.plug_position / FT, f.plug_time / 60))
        (half_length_ft = f.L[end] / FT, height_at_well_ft = f.h0[end] / FT, share_in_pay = face > 0 ? in_pay / face : 1.0, inlet_width_in = f.wmax0 / INCH,
            net_pressure_psi = f.p0[end] / PSI, efficiency = f.efficiency, notes = notes, detail = f, fluid_share = f.share,
            rate_bpm_end = (r.two_wings ? 1 : 2) * f.q[end] / BPM, perf_drop_psi = f.perf_drop / PSI, shadow_psi = f.shadow0 / PSI, earlier_stage_psi = f.earlier_stage0 / PSI,
            above_pay_ft = (f.up0 - pay_ft * FT / 2) / FT, below_pay_ft = (f.down0 - pay_ft * FT / 2) / FT,
            plug_minutes = f.plug_time / 60, plug_position_ft = f.plug_position / FT)
    end
end

"""
Field-unit front end: one stage with several clusters pumped together at `stage_rate_bpm` (the whole
stage, both wings) for `minutes`. `barrier_above_psi` and `barrier_below_psi` may differ (the fracture
then grows more into the weaker side); each result reports the growth above and below the pay at the well. `cluster_positions_ft` are positions along the well. Perforations:
`shots` per cluster (a number or one per cluster), hole diameter, discharge coefficient and slurry
density; `shots = 0` means no perforation friction. Returns one entry per cluster shaped like the
result of `grow_stage_barriers`, with the share of fluid it took, and the stage totals.
"""
function grow_stage_clusters(; pay_ft, barrier_psi, barrier_above_psi = barrier_psi, barrier_below_psi = barrier_psi, toughness_psi_sqrtin = 1000.0, youngs_psi, poisson = 0.25, viscosity_cp, stage_rate_bpm, minutes,
        leakoff_ft_sqrtmin = 0.0, cluster_positions_ft, shots = 0, perf_diameter_in = 0.4, discharge = 0.7, slurry_density_lb_gal = 8.5, fluid_weight = false,
        net_pressure_limit_psi = nothing, kwarg...)
    # `net_pressure_limit_psi`: the job ends when the pressure inside the casing passes this much over the pay's closure stress
    # (a screen-out, with `proppant_feedback = true`). Results then carry `stopped` and `stop_minutes`.
    n = length(cluster_positions_ft)
    Ep = youngs_psi * PSI / (1 - poisson^2)
    sh = shots isa AbstractVector ? shots : fill(shots, n)
    coeff = [s > 0 ? perforation_drop(1.0; shots = s, diameter = perf_diameter_in * INCH, discharge = discharge, density = slurry_density_lb_gal * LB_GAL) : 0.0 for s in sh]
    KIc = toughness_psi_sqrtin * PSI * sqrt(INCH)
    rock = barrier_above_psi == barrier_below_psi && !fluid_weight ? (pay = pay_ft * FT, dsigma = barrier_above_psi * PSI, KIc = KIc) :
        (layers = three_layers(pay_ft * FT, barrier_above_psi * PSI, barrier_below_psi * PSI; KIc = KIc, gamma = fluid_weight ? slurry_density_lb_gal * LB_GAL * G_ACC : 0.0),)
    r = stage_grow(; rock..., Eprime = Ep, mu = viscosity_cp * 1e-3,
        q_stage = stage_rate_bpm * BPM, t_end = minutes * 60.0, C_L = leakoff_ft_sqrtmin * FT_SQRTMIN, positions = collect(Float64, cluster_positions_ft) .* FT,
        perf_coeff = coeff, pressure_limit = isnothing(net_pressure_limit_psi) ? nothing : net_pressure_limit_psi * PSI, kwarg...)
    clusters = stage_cluster_summary(r, pay_ft, barrier_above_psi, barrier_below_psi)
    return (clusters = clusters, wellbore_net_psi = r.wellbore_pressure[end] / PSI, detail = r, stopped = r.stopped, stop_reason = r.stop_reason, stop_minutes = r.stop_time / 60)
end


# ---- a pump schedule in steps, and a job that can be stopped and continued -------------------------------------------------
# research/pump-schedule.md has the reasons. In short:
#   A JOB is plain data: `init` (everything the solver is started with: rock, clusters, the plan, the grid, the proppant's
#   properties, options), `fields` (what was worked out once at the start: per cell, stress from an earlier stage, a stress
#   change and a leak-off factor along each wing; and the cross-section table), `state` (everything the solver carries from one time step to the next, and the history so
#   far) and `grid` (what was fixed at the start, for the reader). Nothing in it is a function, so it can be kept, copied,
#   written to a file and read back. Pumping never changes a job: it returns a new one, so the same job can be continued in
#   two different ways.
#   THE PLAN fixes, when the job starts, the grid (length and cell size), the cross-section table and the law of the time
#   steps. They come from a planned rate, viscosity and pumping time by the same rules a one-call job uses, and nothing that
#   is pumped later changes them. A fracture that outgrows the grid, or a pressure that leaves the table, ends the job where
#   that time step began, and the job says why; it can still be read, not continued.
#   A SCHEDULE STEP has a duration, a stage rate (zero: a pause or the shut-in), a fluid viscosity and a sand concentration.
#   The viscosity applies to the whole fracture at once: the fluid already in the fracture is not followed separately.
#   Time steps are the plan's, cut where a schedule step ends, so they do not depend on how a schedule is split between calls:
#   pumping a schedule in one call or step by step gives the same numbers to the last digit.

"""
    stage_start(; positions, q_plan, t_plan, mu, <rock, Eprime, C_L, perf_coeff, ncell, ... as stage_grow>, proppant = nothing,
                  table_reach = 4, q_ref = nothing, xmax = nothing) -> job

Start a stage that is pumped in schedule steps (SI units). `q_plan` (stage rate, both wings), `t_plan` (pumping time) and
`mu` are the plan: they size the grid, the table and the time steps, and nothing else. `proppant` holds the grains'
properties (`diameter`, `bridge`, and `settle` or `cmax`) without a schedule; sand comes with the steps. `table_reach`: how
many times the usual net-pressure range the table covers. `xmax`: the grid's length, if not the plan's. Returns the job at
time zero.
"""
function stage_start(; positions, q_plan, t_plan, mu, proppant = nothing, stress_offset = nothing, leak_factor = nothing, kernel = shadow_weighted, table_reach = 4, q_ref = nothing, kwarg...)
    kernel === shadow_weighted || error("a stepped job uses the standard shadow kernel")
    for k in (:pump_time, :shut_steps, :monitor, :stepped, :q_stage, :t_end)
        haskey(kwarg, k) && error("stage_start does not take `$k`: a shut-in is a schedule step with zero rate, and the plan is given as q_plan and t_plan")
    end
    (q_plan > 0 && t_plan > 0 && mu > 0) || error("the plan needs a positive rate, pumping time and viscosity")
    isnothing(proppant) || !haskey(proppant, :schedule) || error("a stepped job takes its sand from the schedule steps: give the proppant's properties without `schedule`")
    prop = isnothing(proppant) ? nothing : merge(proppant, (schedule = Tuple{Float64, Float64}[],))
    qr = Float64(something(q_ref, (q_plan / 2) * min(1.0, 1.5 / length(positions))))
    init = (; positions = collect(Float64, positions), q_stage = Float64(q_plan), q_ref = qr, t_end = Float64(t_plan), mu = Float64(mu), proppant = prop, table_reach = table_reach, kwarg...)
    o = stage_grow_once(; init..., stress_offset = stress_offset, leak_factor = leak_factor, stepped = (steps = NamedTuple[], state = nothing, fields = nothing))
    return (init = merge(init, (xmax = o.grid.xmax,)), fields = o.fields, state = o.state, grid = o.grid)
end

"""
    stage_run(job, steps; monitor = nothing) -> (job, readout)

Pump schedule steps one after another. Each step is a named tuple with `duration` (s) and `q_stage` (m3/s, the whole stage;
zero for a pause), and optionally `mu` (Pa s; the plan's if left out), `conc` (grain volume fraction of the slurry; 0) and
`v_free` (settling speed of a single grain in this step's fluid, m/s; the starting value if left out). Returns the job as it
stands afterwards and a read-out of where it stands. If the pressure limit given at the start is passed while pumping, the
call returns at the end of that time step (`limit_hit`) and the rest of the schedule is not pumped; the job can be continued.
"""
function stage_run(job, steps; monitor = nothing)
    job.state.dead && error("this job has ended and cannot be continued: " * job.state.reason)
    isempty(steps) && error("stage_run needs at least one schedule step")
    mu0 = job.init.mu
    st = [(duration = Float64(x.duration), Q = Float64(x.q_stage) / 2, visc = mu0 / Float64(get(x, :mu, mu0)), conc = Float64(get(x, :conc, 0.0)), v_free = Float64(get(x, :v_free, NaN))) for x in steps]
    o = stage_grow_once(; job.init..., stepped = (steps = st, state = job.state, fields = job.fields), monitor = monitor)
    return (init = job.init, fields = job.fields, state = o.state, grid = job.grid), stage_readout(o, length(job.state.hist.t))
end

"`stage_run` for one schedule step given by keywords."
stage_pump(job; duration, q_stage, mu = job.init.mu, conc = 0.0, v_free = NaN, monitor = nothing) =
    stage_run(job, [(duration = duration, q_stage = q_stage, mu = mu, conc = conc, v_free = v_free)]; monitor = monitor)

"The result of a stepped job as it stands, in the same form as `stage_grow` returns (`nothing` before anything was pumped)."
stage_result(job) = stage_grow_once(; job.init..., stepped = (steps = NamedTuple[], state = job.state, fields = job.fields)).result

"Where a stepped job stands after a call (SI units); `history` holds the time steps of that call."
function stage_readout(o, n_before)
    r = o.result; s = o.state
    isnothing(r) && return (time = s.t, time_steps = 0, limit_hit = false, ended = s.dead, reason = s.reason)
    fr = r.fractures; sl = n_before+1:length(r.t); wings = r.two_wings ? 1 : 2
    return (time = s.t, time_steps = o.steps, limit_hit = o.limit_hit, ended = s.dead, reason = s.dead ? s.reason : (o.limit_hit ? r.stop_reason : ""),
        wellbore_pressure = r.wellbore_pressure[end], inlet_pressure = [f.p0[end] for f in fr], perf_drop = [f.perf_drop for f in fr], length = [f.L[end] for f in fr], height = [f.h0[end] for f in fr],
        rate = [f.q[end] for f in fr], side = [f.side for f in fr], efficiency = sum(f.V_fracture for f in fr) / max(sum(f.V_injected for f in fr), 1e-300), fracture_efficiency = [f.efficiency for f in fr],
        volume_pumped = 2 * r.V_injected, volume_in_fractures = wings * sum(f.V_fracture for f in fr), volume_leaked = wings * sum(f.V_leaked for f in fr),
        sand_pumped = r.proppant_pumped, sand_placed = r.proppant_placed, sand_rejected = r.proppant_rejected,
        first_pack_time = [f.first_pack_time for f in fr], plug_time = [f.plug_time for f in fr], plug_position = [f.plug_position for f in fr],
        history = (t = r.t[sl], wellbore_pressure = r.wellbore_pressure[sl], length = [f.L[sl] for f in fr], inlet_pressure = [f.p0[sl] for f in fr], height = [f.h0[sl] for f in fr]))
end

"""
    start_stage(; <rock and clusters as grow_stage_clusters>, plan_minutes, plan_rate_bpm, plan_viscosity_cp,
                  plan_length_ft = nothing, net_pressure_limit_psi = nothing, proppant = nothing, proppant_feedback = false, ...) -> job

Field-unit front end of `stage_start`. The plan (rate, viscosity, pumping time; or `plan_length_ft` for the grid's length)
fixes the grid, the table and the time steps; see the notes above `stage_start`. `proppant` holds the grains' properties as a
named tuple, any of `diameter_mm` (0.2), `density` (2650 kg/m3), `fluid_density` (1000), `pack_porosity` (0.35), `bridge` (3),
`settling` (true), `equilibrium_velocity_ft_s` (NaN: the published rule); give `(;)` for the defaults, or nothing for a job
without sand. Other keywords (`ncell`, `two_wings`, `background`, `table_reach`, ...) go to the solver.
"""
function start_stage(; pay_ft, barrier_psi, barrier_above_psi = barrier_psi, barrier_below_psi = barrier_psi, toughness_psi_sqrtin = 1000.0, youngs_psi, poisson = 0.25, leakoff_ft_sqrtmin = 0.0,
        cluster_positions_ft, shots = 0, perf_diameter_in = 0.4, discharge = 0.7, slurry_density_lb_gal = 8.5, fluid_weight = false, plan_minutes, plan_rate_bpm, plan_viscosity_cp,
        plan_length_ft = nothing, net_pressure_limit_psi = nothing, proppant = nothing, proppant_feedback = false, kwarg...)
    n = length(cluster_positions_ft)
    Ep = youngs_psi * PSI / (1 - poisson^2)
    sh = shots isa AbstractVector ? shots : fill(shots, n)
    coeff = [x > 0 ? perforation_drop(1.0; shots = x, diameter = perf_diameter_in * INCH, discharge = discharge, density = slurry_density_lb_gal * LB_GAL) : 0.0 for x in sh]
    KIc = toughness_psi_sqrtin * PSI * sqrt(INCH)
    rock = barrier_above_psi == barrier_below_psi && !fluid_weight ? (pay = pay_ft * FT, dsigma = barrier_above_psi * PSI, KIc = KIc) :
        (layers = three_layers(pay_ft * FT, barrier_above_psi * PSI, barrier_below_psi * PSI; KIc = KIc, gamma = fluid_weight ? slurry_density_lb_gal * LB_GAL * G_ACC : 0.0),)
    mu = plan_viscosity_cp * 1e-3
    P = nothing; prop = nothing
    if !isnothing(proppant)
        P = merge((diameter_mm = 0.2, density = 2650.0, fluid_density = 1000.0, pack_porosity = 0.35, bridge = 3.0, settling = true, equilibrium_velocity_ft_s = NaN), proppant)
        d = P.diameter_mm * 1e-3
        prop = P.settling ? (diameter = d, bridge = P.bridge, settle = (v_free = settling_velocity(d; density = P.density, fluid_density = P.fluid_density, mu = mu), n = 4.65, cmax = 1 - P.pack_porosity,
            u_eq = P.equilibrium_velocity_ft_s * FT, R = (P.density - P.fluid_density) / P.fluid_density, d = d)) : (diameter = d, bridge = P.bridge, cmax = 1 - P.pack_porosity)
    end
    xm = haskey(kwarg, :xmax) ? kwarg[:xmax] : (isnothing(plan_length_ft) ? nothing : plan_length_ft * FT)      # `xmax` in metres is taken as it is (no unit round-off)
    rest = (; (k => v for (k, v) in pairs(kwarg) if k != :xmax)...)
    job = stage_start(; rock..., Eprime = Ep, mu = mu, q_plan = plan_rate_bpm * BPM, t_plan = plan_minutes * 60.0, C_L = leakoff_ft_sqrtmin * FT_SQRTMIN,
        positions = collect(Float64, cluster_positions_ft) .* FT, perf_coeff = coeff, proppant = prop, proppant_feedback = proppant_feedback,
        pressure_limit = isnothing(net_pressure_limit_psi) ? nothing : net_pressure_limit_psi * PSI, xmax = xm, rest...)
    return merge(job, (field = (pay_ft = Float64(pay_ft), barrier_above_psi = Float64(barrier_above_psi), barrier_below_psi = Float64(barrier_below_psi), plan_viscosity_cp = Float64(plan_viscosity_cp), proppant = P),))
end

"""
    pump_step(job; minutes, rate_bpm, viscosity_cp = <the plan's>, ppa = 0.0) -> (job, readout)

Pump one schedule step of a job started with `start_stage`: `rate_bpm` for the whole stage (zero: a pause or the shut-in),
`ppa` in lb of sand per gallon of clean fluid. The settling speed follows the step's viscosity. The read-out is in field
units: minutes, net pressure in the casing and at each fracture's inlet, perforation friction, half-length and height of every
fracture, efficiency, sand pumped, placed and rejected so far (lb), when and where a fracture packed or plugged, whether the
pressure limit was passed, whether the job has ended and why, and the history of this step.
"""
function pump_step(job; minutes, rate_bpm, viscosity_cp = job.field.plan_viscosity_cp, ppa = 0.0, monitor = nothing)
    P = job.field.proppant
    ppa == 0 || !isnothing(P) || error("this job was started without proppant; give start_stage the proppant's properties to pump sand")
    conc = ppa == 0 ? 0.0 : ppa_to_fraction(ppa; density = P.density)
    vfree = (isnothing(P) || !P.settling) ? NaN : settling_velocity(P.diameter_mm * 1e-3; density = P.density, fluid_density = P.fluid_density, mu = viscosity_cp * 1e-3)
    newjob, ro = stage_run((init = job.init, fields = job.fields, state = job.state, grid = job.grid),
        [(duration = minutes * 60.0, q_stage = rate_bpm * BPM, mu = viscosity_cp * 1e-3, conc = conc, v_free = vfree)]; monitor = monitor)
    return merge(newjob, (field = job.field,)), field_readout(ro, isnothing(P) ? 2650.0 : P.density)
end

"A stepped job's read-out in field units (see `pump_step`)."
function field_readout(ro, grain_density)
    haskey(ro, :wellbore_pressure) || return (minutes = ro.time / 60, time_steps = 0, limit_hit = false, ended = ro.ended, reason = ro.reason)
    lb = grain_density / 0.45359237
    mins(v) = [x / 60 for x in v]
    return (minutes = ro.time / 60, time_steps = ro.time_steps, limit_hit = ro.limit_hit, ended = ro.ended, reason = ro.reason,
        wellbore_net_psi = ro.wellbore_pressure / PSI, inlet_net_psi = ro.inlet_pressure ./ PSI, perf_drop_psi = ro.perf_drop ./ PSI, half_length_ft = ro.length ./ FT, height_ft = ro.height ./ FT,
        rate_bpm = ro.rate ./ BPM, side = ro.side, efficiency = ro.efficiency, fracture_efficiency = ro.fracture_efficiency, pumped_bbl = ro.volume_pumped / STB,
        sand_pumped_lb = ro.sand_pumped * lb, sand_placed_lb = ro.sand_placed * lb, sand_rejected_lb = ro.sand_rejected * lb,
        first_pack_minutes = mins(ro.first_pack_time), plug_minutes = mins(ro.plug_time), plug_position_ft = ro.plug_position ./ FT,
        history = (minutes = ro.history.t ./ 60, wellbore_net_psi = ro.history.wellbore_pressure ./ PSI, half_length_ft = [v ./ FT for v in ro.history.length],
            inlet_net_psi = [v ./ PSI for v in ro.history.inlet_pressure], height_ft = [v ./ FT for v in ro.history.height]))
end

"The result of a job started with `start_stage`, in the form `grow_stage_clusters` returns (clusters, wellbore_net_psi, detail, stopped, stop_reason, stop_minutes)."
function finish_stage(job)
    r = stage_result((init = job.init, fields = job.fields, state = job.state, grid = job.grid))
    isnothing(r) && error("nothing has been pumped in this job yet")
    return (clusters = stage_cluster_summary(r, job.field.pay_ft, job.field.barrier_above_psi, job.field.barrier_below_psi), wellbore_net_psi = r.wellbore_pressure[end] / PSI, detail = r,
        stopped = job.state.dead || isfinite(job.state.limit_at), stop_reason = job.state.dead ? job.state.reason : (isfinite(job.state.limit_at) ? "the wellbore pressure passed the limit" : ""),
        stop_minutes = job.state.dead ? job.state.t / 60 : job.state.limit_at / 60)
end

const STAGE_FILE_TAG = "ressim stage job 1"

"""
Write a job (from `stage_start` or `start_stage`) to a file, and read it back. The file is Julia's own Serialization format
(a standard library): exact to the last bit, but tied to the Julia version and to this module's types, so it is for keeping a
job between calls of one installation, not for exchange.
"""
save_stage(job, path) = open(io -> serialize(io, (STAGE_FILE_TAG, job)), path, "w")
function load_stage(path)
    x = open(deserialize, path)
    (x isa Tuple && length(x) == 2 && x[1] == STAGE_FILE_TAG) || error("not a stage job file written by this version: $path")
    return x[2]
end
