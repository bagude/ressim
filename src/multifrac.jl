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

using LinearAlgebra

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

function section_table(; pay, dsigma, KIc, Eprime, mu, p_pkn, ntable = 240)
    a = pay / 2
    p_cap = 0.995 * (dsigma * (1 - (2 / pi) * asin(1 / 200)) + KIc / sqrt(pi * 200a))
    p_top = min(p_cap, 3 * p_pkn)
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
function layered_table(L::StressLayers; Eprime, mu, p_pkn, ntable = 240)
    zb = L.z[L.start-1]; zt = L.z[L.start]; a = (zt - zb) / 2; zc = (zt + zb) / 2
    runs(p) = layer_tips(L, p, zb, zt)[3]
    p_cap = Inf
    if runs(3 * p_pkn)
        lo = 0.0; hi = 3 * p_pkn
        for _ in 1:50
            m = 0.5 * (lo + hi)
            runs(m) ? (hi = m) : (lo = m)
        end
        p_cap = 0.995 * lo
    end
    p_top = min(p_cap, 3 * p_pkn)
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
        T.p_top < T.p_cap && throw(GrowthOverflow("net pressure left the tabulated range"))
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
end

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
function stage_grow(; positions, q_stage, kwarg...)
    n = length(positions); Qw = q_stage / 2; q_ref = Qw * min(1.0, 1.5 / n)
    while true
        try
            return stage_grow_once(; positions = positions, q_stage = q_stage, q_ref = q_ref, kwarg...)
        catch e
            e isa GrowthOverflow || rethrow()
            q_ref >= Qw && error("stage growth: a fracture outran the grid even when sized for the whole stage rate (" * e.msg * ")")
            q_ref = min(Qw, 1.6 * q_ref)
        end
    end
end

function stage_grow_once(; pay = nothing, dsigma = 0.0, KIc = 0.0, layers = nothing, Eprime, mu, q_stage, q_ref, t_end, C_L = 0.0, positions, perf_coeff = zeros(length(positions)),
        ncell = 300, nstep = 2 * ncell, ntable = 240, margin = 1.15, xmax = nothing, proppant = nothing, shadow = true, kernel = shadow_weighted, flow = :auto, background = nothing)
    isnothing(layers) || (pay = layers.z[layers.start] - layers.z[layers.start-1])     # layered rock: the pay is the start layer
    isnothing(pay) && error("stage_grow needs `pay` and `dsigma`, or `layers`")
    N = length(positions); M = ncell; a = pay / 2; Qw = q_stage / 2
    length(perf_coeff) == N || error("perf_coeff needs one value per cluster")
    simc = pkn_similarity(n = 20_000)
    p_pkn = Eprime * simc.c_w * (mu * q_ref^2 / (Eprime * pay))^(1 / 5) * t_end^(1 / 5) / (2 * pay)
    T = isnothing(layers) ? section_table(pay = pay, dsigma = dsigma, KIc = KIc, Eprime = Eprime, mu = mu, p_pkn = p_pkn, ntable = ntable) :
        layered_table(layers; Eprime = Eprime, mu = mu, p_pkn = p_pkn, ntable = ntable)
    tips(v) = isnothing(layers) ? (c = section_half_height(v, a, dsigma, KIc); (c, c)) : sec_tips(T, v)
    if isnothing(xmax)
        xmax = simc.c_L * (Eprime * q_ref^3 / (mu * pay^4))^(1 / 5) * t_end^(4 / 5)
        C_L > 0 && (xmax = min(xmax, q_ref * sqrt(t_end) / (pi * C_L * pay)))
        xmax *= margin
    end
    dx = xmax / M
    dist = [abs(positions[k] - positions[j]) for k in 1:N, j in 1:N]
    couple = shadow && N > 1
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
    upw = flow == :upwind || (flow == :auto && (couple || any(!=(0.0), S_ext)))
    p = zeros(N, M); An = zeros(N, M); tau = fill(Inf, N, M); dem = zeros(N, M)
    Av = zeros(N, M); dAv = zeros(N, M); Phv = zeros(N, M); Mv = zeros(N, M); dMv = zeros(N, M); cv = fill(a, N, M); dcv = zeros(N, M)
    S = copy(S_ext); dS = zeros(N, N, M); R = zeros(N, M); act = falses(N, M)
    kap = fill(0.25, N, M)
    Fx = zeros(N, M); fpl = zeros(N, M); fpr = zeros(N, M); fsl = zeros(N, M); fsr = zeros(N, M)   # face i sits between cells i and i + 1
    q = fill(Qw / N, N); pwb = 0.0; Eb = zeros(N + 1)
    times = [t_end * (k / nstep)^2 for k in 1:nstep]
    L_t = zeros(N, nstep); p0_t = zeros(N, nstep); h0_t = zeros(N, nstep); q_t = zeros(N, nstep); pwb_t = zeros(nstep)
    leaked = zeros(N); injected = zeros(N); t = 0.0; newton_total = 0
    Vp = zeros(N, M); Vp_in = zeros(N); first_pack = fill(Inf, N)       # Vp: suspended grains per unit length
    Hs = zeros(N, M); Vb = zeros(N, M); qo = zeros(M); opn = falses(M); lk = zeros(M); hh = zeros(M)   # laden-slurry area, bank, and work rows
    settle = isnothing(proppant) ? nothing : get(proppant, :settle, nothing); Vp_rej = zeros(N)
    conc_at(tm) = isnothing(proppant) ? 0.0 : (c = 0.0; for (ts, cs) in proppant.schedule; tm >= ts && (c = cs); end; c)
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
            Av[k, i], dAv[k, i], Phv[k, i], Mv[k, i], dMv[k, i], cv[k, i], dcv[k, i] = sec_lookup(T, p[k, i])
            upw && ((Mv[k, i], dMv[k, i]) = sec_mobility(T, p[k, i]))
        end
        if couple
            fill!(dS, 0.0)
            @inbounds for i in 1:M, k in 1:N
                s = 0.0
                for j in 1:N
                    j == k && continue
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
        end
        @inbounds for i in 1:M, k in 1:N
            R[k, i] = Av[k, i] - An[k, i] + r * ((i < M ? Fx[k, i] : 0.0) - (i > 1 ? Fx[k, i-1] : 0.0)) - (i == 1 ? dt * q[k] / dx : 0.0) + dem[k, i]
            act[k, i] = p[k, i] > 0 || R[k, i] < 0
        end
        @inbounds for k in 1:N
            Tin = 1.5 * (p[k, 1] + S[k, 1]) - 0.5 * (p[k, 2] + S[k, 2])
            Eb[k] = pwb - Tin - perf_coeff[k] * (2 * q[k]) * abs(2 * q[k])
        end
        Eb[N+1] = sum(q) - Qw
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
            i == 1 && (RHS[row, 1+k] = (-dt / dx) * q_s / A_s)
        end
        @inbounds for k in 1:N                      # wellbore rows, scaled by p_s; the rate row by q_s
            for j in 1:N
                Cm[k, id(j, 1)] = -1.5 * ((j == k) + dS[k, j, 1])
                Cm[k, id(j, 2)] = 0.5 * ((j == k) + dS[k, j, 2])
            end
            Dm[k, k] = -8 * perf_coeff[k] * abs(q[k]) * q_s / p_s
            Dm[k, N+1] = 1.0
            Dm[N+1, k] = 1.0
        end
        return
    end
    DP = zeros(N, M); p_old = zeros(N, M); q_old = zeros(N)
    function merit(Ascale)
        v = 0.0
        @inbounds for i in 1:M, k in 1:N
            v = max(v, p[k, i] > 0 ? abs(R[k, i]) : max(-R[k, i], 0.0))
        end
        return max(v / Ascale, maximum(abs, view(Eb, 1:N)) / p_s, abs(Eb[N+1]) / q_s)
    end
    for (kt, tn) in enumerate(times)
        dt = tn - t
        @inbounds for i in 1:M, k in 1:N
            An[k, i] = sec_lookup(T, p[k, i])[1]
            t_in = tau[k, i] == Inf ? t + dt / 2 : tau[k, i]
            dem[k, i] = 4 * pay * C_L * (sqrt(tn - t_in) - sqrt(max(t - t_in, 0.0)))
        end
        if upw                                    # exact-mean correction of the upwind conductance, from the old pressures
            @inbounds for i in 1:M-1, k in 1:N
                pl = p[k, i]; pr = p[k, i+1]; hi = max(pl, pr)
                Mhi = hi > 0 ? sec_mobility(T, hi)[1] : 0.0
                dPhi = abs(sec_lookup(T, pl)[3] - sec_lookup(T, pr)[3])
                if Mhi <= 0 || dPhi <= 0                  # dry, or too thin to tell: the tip value of a contained fracture
                    kap[k, i] = 0.25
                else
                    kap[k, i] = abs(pl - pr) < 1e-9 * hi ? 1.0 : clamp(dPhi / (abs(pl - pr) * Mhi), 0.05, 1.0)
                end
            end
        end
        Ascale = max(maximum(An), dt * maximum(abs, q) / dx, dt * Qw / (N * dx))
        converged = false; trace = String[]
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
            if lam == 1.0 && change < 1e-11 * max(maximum(p), 1.0) && maximum(abs, view(db, 1:N)) < 1e-11 && abs(db[N+1]) < 1e-11
                converged = true; break
            end
        end
        converged || error("stage growth: time step $kt of $nstep did not converge; cell/well residuals of the last iterations: " * join(trace[max(end - 7, 1):end], " ") *
            "; rate shares " * string(round.(q ./ Qw, digits = 4)) * "; lengths in cells " * string([something(findlast(>(0), view(p, k, :)), 0) for k in 1:N]) *
            (couple && maximum(cv) > 1.5 * a ? @sprintf(". The tallest fracture is %.1f times the pay height: clusters this close that grow this tall run away together in this model (each one's shadow on the others falls as it grows taller)", maximum(cv) / a) : ""))
        maximum(view(p, :, M)) > 1e-3 && throw(GrowthOverflow("a fracture reached the end of the grid"))
        evaluate!(dt, false)
        @inbounds for i in 1:M, k in 1:N
            leaked[k] += (dem[k, i] - (p[k, i] > 0 ? 0.0 : R[k, i])) * dx
            p[k, i] > 0 && tau[k, i] == Inf && (tau[k, i] = t + dt / 2)
        end
        @inbounds for k in 1:N
            injected[k] += q[k] * dt
        end
        if !isnothing(proppant)
            nbr = get(proppant, :bridge, 3.0) * proppant.diameter
            @inbounds for k in 1:N
                conc = conc_at(t + dt / 2); qin = max(q[k], 0.0) * dt / dx
                Vp_in[k] += conc * qin * dx
                for i in 1:M
                    qo[i] = i < M ? max(Fx[k, i] / dx, 0.0) : 0.0
                    opn[i] = i < M && sec_wmax(T, p[k, i+1]) >= nbr
                    lk[i] = dem[k, i] - (p[k, i] > 0 ? 0.0 : R[k, i])
                    hh[i] = p[k, i] > 0 ? 2 * cv[k, i] : 0.0
                end
                rej = proppant_sweep!(view(Vp, k, :), view(Hs, k, :), view(Vb, k, :); area = view(Av, k, :), height = hh, q_out = qo, open_next = opn, leak = lk,
                    inflow_V = conc * qin, inflow_H = conc > 0 ? qin : 0.0, dt = dt, dx = dx, settle = settle)
                Vp_rej[k] += rej * dx; rej > 0 && (first_pack[k] = min(first_pack[k], tn))
                for i in 1:M
                    isnothing(settle) && (Av[k, i] > 0 && Vp[k, i] / Av[k, i] > get(proppant, :cmax, 0.6)) && (first_pack[k] = min(first_pack[k], tn))
                end
            end
        end
        t = tn
        @inbounds for k in 1:N
            pk = view(p, k, :)
            kf = findlast(>(1e-3), pk)
            # tip position inside the last wet cell, from the pressure fall towards it. Next to a shorter neighbour the pressure can
            # rise towards the tip; the estimate is then meaningless (it once returned infinity), so the tip is put at most one cell on.
            den = isnothing(kf) || kf == 1 ? 1.0 : pk[kf-1]^3 - pk[kf]^3
            L_t[k, kt] = isnothing(kf) ? 0.0 : (kf == 1 ? dx : (kf - 0.5) * dx + (den > 0 ? min(dx * pk[kf]^3 / den, dx) : dx))
            p0_t[k, kt] = 1.5 * pk[1] - 0.5 * pk[2]
            h0_t[k, kt] = sum(tips(max(p0_t[k, kt], 0.0)))
            q_t[k, kt] = q[k]
        end
        pwb_t[kt] = pwb
    end
    x = ((1:M) .- 0.5) .* dx
    total = sum(injected)
    fracs = map(1:N) do k
        pk = p[k, :]
        area = [sec_lookup(T, v)[1] for v in pk]
        Vf = sum(area) * dx
        (t = times, L = L_t[k, :], p0 = p0_t[k, :], h0 = h0_t[k, :], x = x, p = pk,
            height = [v > 1e-3 ? sum(tips(v)) : 0.0 for v in pk], up = [v > 1e-3 ? tips(v)[1] : 0.0 for v in pk], down = [v > 1e-3 ? tips(v)[2] : 0.0 for v in pk], up0 = tips(max(p0_t[k, end], 0.0))[1], down0 = tips(max(p0_t[k, end], 0.0))[2],
            V_injected = injected[k], V_fracture = Vf, V_leaked = leaked[k], efficiency = Vf / max(injected[k], 1e-300), dx = dx,
            wmax0 = isnothing(layers) ? section(max(p0_t[k, end], 0.0), a, dsigma, KIc, Eprime).wmax : sec_wmax(T, max(p0_t[k, end], 0.0)), area = area,
            proppant_per_length = Vp[k, :] .+ Vb[k, :], proppant_pumped = Vp_in[k], proppant_in_fracture = (sum(view(Vp, k, :)) + sum(view(Vb, k, :))) * dx, first_pack_time = first_pack[k],
            proppant_suspended = Vp[k, :], proppant_banked = Vb[k, :], slurry_area = Hs[k, :], settled = !isnothing(settle), proppant_rejected = Vp_rej[k],
            q = q_t[k, :], share = injected[k] / total, arrival = tau[k, :], shadow0 = S[k, 1], earlier_stage0 = S_ext[k, 1], perf_drop = perf_coeff[k] * (2 * q[k]) * abs(2 * q[k]), position = positions[k])
    end
    return (fractures = fracs, t = times, wellbore_pressure = pwb_t, V_injected = Qw * t_end, dx = dx, cells = M, newton = newton_total, table = T)
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

"""
Field-unit front end: one stage with several clusters pumped together at `stage_rate_bpm` (the whole
stage, both wings) for `minutes`. `barrier_above_psi` and `barrier_below_psi` may differ (the fracture
then grows more into the weaker side); each result reports the growth above and below the pay at the well. `cluster_positions_ft` are positions along the well. Perforations:
`shots` per cluster (a number or one per cluster), hole diameter, discharge coefficient and slurry
density; `shots = 0` means no perforation friction. Returns one entry per cluster shaped like the
result of `grow_stage_barriers`, with the share of fluid it took, and the stage totals.
"""
function grow_stage_clusters(; pay_ft, barrier_psi, barrier_above_psi = barrier_psi, barrier_below_psi = barrier_psi, toughness_psi_sqrtin = 1000.0, youngs_psi, poisson = 0.25, viscosity_cp, stage_rate_bpm, minutes,
        leakoff_ft_sqrtmin = 0.0, cluster_positions_ft, shots = 0, perf_diameter_in = 0.4, discharge = 0.7, slurry_density_lb_gal = 8.5, fluid_weight = false, kwarg...)
    n = length(cluster_positions_ft)
    Ep = youngs_psi * PSI / (1 - poisson^2)
    sh = shots isa AbstractVector ? shots : fill(shots, n)
    coeff = [s > 0 ? perforation_drop(1.0; shots = s, diameter = perf_diameter_in * INCH, discharge = discharge, density = slurry_density_lb_gal * LB_GAL) : 0.0 for s in sh]
    KIc = toughness_psi_sqrtin * PSI * sqrt(INCH)
    rock = barrier_above_psi == barrier_below_psi && !fluid_weight ? (pay = pay_ft * FT, dsigma = barrier_above_psi * PSI, KIc = KIc) :
        (layers = three_layers(pay_ft * FT, barrier_above_psi * PSI, barrier_below_psi * PSI; KIc = KIc, gamma = fluid_weight ? slurry_density_lb_gal * LB_GAL * G_ACC : 0.0),)
    r = stage_grow(; rock..., Eprime = Ep, mu = viscosity_cp * 1e-3,
        q_stage = stage_rate_bpm * BPM, t_end = minutes * 60.0, C_L = leakoff_ft_sqrtmin * FT_SQRTMIN, positions = collect(Float64, cluster_positions_ft) .* FT,
        perf_coeff = coeff, kwarg...)
    clusters = map(r.fractures) do f
        face = sum(f.height) * f.dx; in_pay = sum(min.(f.height, pay_ft * FT)) * f.dx
        notes = String[]
        f.h0[end] > f.L[end] && push!(notes, @sprintf("height at the well (%.0f ft) exceeds the half-length (%.0f ft): the pseudo-3-D assumption (height small against length) is weak here", f.h0[end] / FT, f.L[end] / FT))
        (half_length_ft = f.L[end] / FT, height_at_well_ft = f.h0[end] / FT, share_in_pay = face > 0 ? in_pay / face : 1.0, inlet_width_in = f.wmax0 / INCH,
            net_pressure_psi = f.p0[end] / PSI, efficiency = f.efficiency, notes = notes, detail = f, fluid_share = f.share,
            rate_bpm_end = 2 * f.q[end] / BPM, perf_drop_psi = f.perf_drop / PSI, shadow_psi = f.shadow0 / PSI, earlier_stage_psi = f.earlier_stage0 / PSI,
            above_pay_ft = (f.up0 - pay_ft * FT / 2) / FT, below_pay_ft = (f.down0 - pay_ft * FT / 2) / FT)
    end
    return (clusters = clusters, wellbore_net_psi = r.wellbore_pressure[end] / PSI, detail = r)
end
