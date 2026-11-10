# Fracture cross-section in layered rock: any number of layers, each with its own closure stress and
# toughness. Replaces the symmetric three-layer formulas of heightgrow.jl when the stresses above and
# below the pay differ (the fracture then grows more into the weaker side).
#
# Same model class as heightgrow.jl: every vertical cross-section is a plane-strain crack under one
# fluid pressure; each tip sits where its stress intensity equals the toughness of the rock ahead of it.
# The fracture starts open across the whole start layer (the pay). The weight of the fluid can be
# included (`gamma`, pressure gain per metre of depth): the pressure is then higher at the bottom of
# the crack than at the top. Not modelled: different stiffness per layer, vertical flow, and where
# inside the pay the well is landed (with one pressure per cross-section and one stress in the pay,
# that has no effect).
#
# Formulas, for a crack from zl to zu, half-height c, centre z0, s = z - z0, net load n(s) = p - stress:
#   stress intensity, upper tip   K = (pi c)^(-1/2) * integral of n(s) sqrt((c + s)/(c - s)) ds
#   stress intensity, lower tip   K = (pi c)^(-1/2) * integral of n(s) sqrt((c - s)/(c + s)) ds
#   area                          A = (4/E') * integral of n(s) sqrt(c^2 - s^2) ds
#   opening, with s = c cos(alpha):  w = sum over m of b_m sin(m alpha),
#                                 b_m = (8 c / (pi E' m)) * integral of n sin(m beta) sin(beta) d beta
# Fluid weight adds a load -gamma s: it changes the two stress intensities by -/+ gamma c^(3/2) sqrt(pi)/2
# (upper/lower tip), leaves the area unchanged and adds -gamma c^2/E' to b_2. p is the net pressure at
# the middle of the start layer.
# The last line is the crack Green's function written as a sine series (its kernel is
# ln|sin((a+b)/2) / sin((a-b)/2)| = 2 sum sin(m a) sin(m b) / m). All integrals are closed form for a
# load that is constant in each layer. `layer_self_test` checks them against each other and against
# the symmetric formulas.

"""
Layered rock for the height model. `z` are the layer boundaries, ascending (n - 1 values for n layers;
the lowest and highest layers extend without limit); `sigma` the closure stress of each layer and `KIc`
its toughness, from the bottom up; `start` the index of the layer the fracture starts in; `gamma` the
weight of the fluid in the fracture (Pa per metre of depth, 0 to ignore it).
"""
struct StressLayers
    z::Vector{Float64}
    sigma::Vector{Float64}
    KIc::Vector{Float64}
    start::Int
    gamma::Float64
    function StressLayers(z, sigma, KIc, start; gamma = 0.0)
        n = length(sigma)
        length(z) == n - 1 && length(KIc) == n || error("layers: need one stress and one toughness per layer and one boundary between each pair")
        issorted(z) && allunique(z) || error("layers: boundaries must increase")
        1 < start < n || error("layers: the start layer must have a layer above and a layer below")
        new(collect(Float64, z), collect(Float64, sigma), collect(Float64, KIc), start, gamma)
    end
end

"Three layers: a pay of thickness `pay` centred on z = 0, with barriers whose stress is higher by `above` and `below`."
three_layers(pay, above, below; KIc = 0.0, gamma = 0.0) = StressLayers([-pay / 2, pay / 2], [below, 0.0, above], fill(KIc, 3), 2; gamma = gamma)

"Net pressure at the middle of a crack centred on z0, given the net pressure p at the middle of the start layer."
centre_pressure(L::StressLayers, p, z0) = p - L.gamma * (z0 - (L.z[L.start] + L.z[L.start-1]) / 2)

layer_at(L::StressLayers, z) = searchsortedlast(L.z, z) + 1          # layer containing z; a boundary belongs to the layer above it

"Loop over the pieces of the crack [zl, zu] that lie in each layer: f(layer index, z1, z2)."
@inline function each_piece(f, L::StressLayers, zl, zu)
    n = length(L.sigma)
    for i in 1:n
        z1 = max(zl, i == 1 ? -Inf : L.z[i-1]); z2 = min(zu, i == n ? Inf : L.z[i])
        z2 > z1 && f(i, z1, z2)
    end
end

"Stress intensity at the lower and upper tips of a crack from zl to zu; p is the net pressure over the start layer's stress."
function layer_K(L::StressLayers, zl, zu, p)
    c = (zu - zl) / 2; z0 = (zu + zl) / 2; Kl = 0.0; Ku = 0.0; s0 = L.sigma[L.start]; pc = centre_pressure(L, p, z0)
    each_piece(L, zl, zu) do i, z1, z2
        n = pc - (L.sigma[i] - s0)
        a1 = asin(clamp((z1 - z0) / c, -1.0, 1.0)); a2 = asin(clamp((z2 - z0) / c, -1.0, 1.0))
        r1 = sqrt(max(c^2 - (z1 - z0)^2, 0.0)); r2 = sqrt(max(c^2 - (z2 - z0)^2, 0.0))
        Ku += n * (c * (a2 - a1) - (r2 - r1))
        Kl += n * (c * (a2 - a1) + (r2 - r1))
    end
    tilt = L.gamma * c^1.5 * sqrt(pi) / 2
    return (Kl / sqrt(pi * c) + tilt, Ku / sqrt(pi * c) - tilt)
end

"""
Tips at net pressure p, starting from (zl, zu) and never retreating: each tip moves out while its stress
intensity exceeds the toughness of the rock ahead, to the first position where it no longer does.
Returns (zl, zu, ran_away). `reach` is how far a tip may go before the height is called unbounded.
"""
function layer_tips(L::StressLayers, p, zl, zu; reach = 200 * (L.z[L.start] - L.z[L.start-1]))
    tough_up(z) = L.KIc[layer_at(L, z)]
    tough_dn(z) = L.KIc[min(layer_at(L, z - 1e-12 * (1 + abs(z))), length(L.KIc))]   # just below z
    excess_up(a, b) = layer_K(L, a, b, p)[2] - tough_up(b)
    excess_dn(a, b) = layer_K(L, a, b, p)[1] - tough_dn(a)
    mid = (L.z[L.start] + L.z[L.start-1]) / 2
    for sweep in 1:400
        moved = false
        if excess_up(zl, zu) > 0
            lo = zu; hi = zu; step = 0.01 * (zu - zl)
            while true                                  # walk out, stopping at every layer boundary, to the first place the tip can rest
                nxt = lo + step
                k = searchsortedfirst(L.z, lo + 1e-12 * (1 + abs(lo)))
                k <= length(L.z) && L.z[k] < nxt && (nxt = L.z[k])
                nxt - mid > reach && return (zl, zu, true)
                if excess_up(zl, nxt) <= 0
                    hi = nxt; break
                end
                lo = nxt; step *= 1.3
            end
            for _ in 1:60
                m = 0.5 * (lo + hi)
                excess_up(zl, m) > 0 ? (lo = m) : (hi = m)
            end
            zu = hi; moved = true
        end
        if excess_dn(zl, zu) > 0
            lo = zl; hi = zl; step = 0.01 * (zu - zl)
            while true
                nxt = lo - step
                k = searchsortedlast(L.z, lo - 1e-12 * (1 + abs(lo)))
                k >= 1 && L.z[k] > nxt && (nxt = L.z[k])
                mid - nxt > reach && return (zl, zu, true)
                if excess_dn(nxt, zu) <= 0
                    hi = nxt; break
                end
                lo = nxt; step *= 1.3
            end
            for _ in 1:60
                m = 0.5 * (lo + hi)
                excess_dn(m, zu) > 0 ? (lo = m) : (hi = m)
            end
            zl = hi; moved = true
        end
        moved || return (zl, zu, false)
    end
    return (zl, zu, false)
end

"Sine-series coefficients of the opening of a crack from zl to zu at net pressure p."
function layer_opening_series(L::StressLayers, zl, zu, p, Ep; nterm = 300)
    c = (zu - zl) / 2; z0 = (zu + zl) / 2; s0 = L.sigma[L.start]; b = zeros(nterm); pc = centre_pressure(L, p, z0)
    each_piece(L, zl, zu) do i, z1, z2
        n = pc - (L.sigma[i] - s0)
        b1 = acos(clamp((z2 - z0) / c, -1.0, 1.0)); b2 = acos(clamp((z1 - z0) / c, -1.0, 1.0))      # s = c cos(beta), beta from the top tip
        b[1] += n * 0.5 * ((b2 - sin(2 * b2) / 2) - (b1 - sin(2 * b1) / 2))
        for m in 2:nterm
            b[m] += n * 0.5 * ((sin((m - 1) * b2) / (m - 1) - sin((m + 1) * b2) / (m + 1)) - (sin((m - 1) * b1) / (m - 1) - sin((m + 1) * b1) / (m + 1)))
        end
    end
    for m in 1:nterm
        b[m] *= 8 * c / (pi * Ep * m)
    end
    nterm >= 2 && (b[2] -= L.gamma * c^2 / Ep)
    return b
end

series_opening(b, alpha) = (w = 0.0; for m in eachindex(b); w += b[m] * sin(m * alpha); end; w)

"Area by the reciprocity formula (closed form per layer)."
function layer_area(L::StressLayers, zl, zu, p, Ep)
    c = (zu - zl) / 2; z0 = (zu + zl) / 2; s0 = L.sigma[L.start]; A = 0.0; pc = centre_pressure(L, p, z0)
    F(s) = (s / 2) * sqrt(max(c^2 - s^2, 0.0)) + (c^2 / 2) * asin(clamp(s / c, -1.0, 1.0))
    each_piece(L, zl, zu) do i, z1, z2
        A += (pc - (L.sigma[i] - s0)) * (F(z2 - z0) - F(z1 - z0))
    end
    return 4 * A / Ep
end

"Cross-section at net pressure p for given tips: area, integral of opening cubed, largest opening, opening at the middle of the start layer."
function layer_section(L::StressLayers, zl, zu, p, Ep; nz = 120, nterm = 300)
    c = (zu - zl) / 2
    b = layer_opening_series(L, zl, zu, p, Ep; nterm = nterm)
    I3 = 0.0; wmax = 0.0
    for k in 1:nz
        al = (k - 0.5) * pi / nz
        w = max(series_opening(b, al), 0.0)
        I3 += w^3 * c * sin(al) * pi / nz
        wmax = max(wmax, w)
    end
    return (A = layer_area(L, zl, zu, p, Ep), I3 = I3, wmax = wmax, c = c)
end

"""
Consistency checks of the layered cross-section. Returns the worst relative errors:
- `symmetric_*`: equal barriers against the three-layer formulas of heightgrow.jl (tips, area, integral of opening cubed)
- `area`: area by integrating the series opening against the reciprocity formula, unequal barriers
- `tip_up`, `tip_down`: stress intensity read from the opening near each tip against the closed form
- `resting`: at the solved tips the stress intensity must equal the toughness
"""
function layer_self_test(; pay = 30.0, Ep = 3.0e10, KIc = 1.0e6)
    a = pay / 2
    # equal barriers
    ds = 3.0e6; p = 0.6 * ds
    Ls = three_layers(pay, ds, ds; KIc = KIc)
    zl, zu, _ = layer_tips(Ls, p, -a, a)
    ref = section(p, a, ds, KIc, Ep; nz = 400)
    sec = layer_section(Ls, zl, zu, p, Ep; nz = 400, nterm = 2000)
    # unequal barriers
    L = three_layers(pay, 4.0e6, 2.0e6; KIc = KIc); p = 1.5e6
    zl2, zu2, _ = layer_tips(L, p, -a, a)
    c = (zu2 - zl2) / 2
    b = layer_opening_series(L, zl2, zu2, p, Ep; nterm = 60_000)
    nq = 4000; A = 0.0
    for k in 1:nq
        al = (k - 0.5) * pi / nq
        A += series_opening(b, al) * c * sin(al) * pi / nq
    end
    Kl, Ku = layer_K(L, zl2, zu2, p)
    r = 1e-4 * c; al = acos(1 - r / c)
    Ku_open = series_opening(b, al) * Ep / 8 * sqrt(2 * pi / r)
    Kl_open = series_opening(b, pi - al) * Ep / 8 * sqrt(2 * pi / r)
    # with fluid weight: stress intensity from the opening at both tips against the closed form (crack held at the same tips)
    Lg = three_layers(pay, 4.0e6, 2.0e6; KIc = KIc, gamma = 1.0e4)
    bg = layer_opening_series(Lg, zl2, zu2, p, Ep; nterm = 60_000)
    Klg, Kug = layer_K(Lg, zl2, zu2, p)
    weight = max(abs(series_opening(bg, al) * Ep / 8 * sqrt(2 * pi / r) / Kug - 1), abs(series_opening(bg, pi - al) * Ep / 8 * sqrt(2 * pi / r) / Klg - 1))
    return (fluid_weight = weight, symmetric_top = abs(zu / ref.c - 1), symmetric_bottom = abs(-zl / ref.c - 1), symmetric_area = abs(sec.A / ref.A - 1), symmetric_flow = abs(sec.I3 / ref.I3 - 1),
        area = abs(A / layer_area(L, zl2, zu2, p, Ep) - 1), tip_up = abs(Ku_open / Ku - 1), tip_down = abs(Kl_open / Kl - 1),
        resting = max(abs(Ku / KIc - 1), abs(Kl / KIc - 1)), up_m = zu2 - a, down_m = -a - zl2)
end
