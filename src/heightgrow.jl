# Hydraulic fracture growth, second model: pseudo-3-D. Length AND height grow.
#
# The fracture starts in a pay layer of thickness H. Above and below are barrier layers whose
# closure stress is higher by `dsigma` (symmetric, same stiffness). Every vertical cross-section is a
# plane-strain crack in equilibrium: its height is the one at which the stress intensity at its tips
# equals the rock toughness, so the fracture breaks into the barriers as net pressure rises. Fluid
# flows along the length (lubrication) and leaks off into the pay (Carter).
#
# This is the classic pseudo-3-D idea used by many commercial fracture design tools. It is NOT a
# planar 3-D model: there is no vertical flow, no stress interaction between fractures, layers are
# symmetric and equally stiff, and it loses accuracy when height is not small against length.
# With barriers too strong to break it reduces exactly to the constant-height model in fracgrow.jl.
#
# Cross-section formulas (a = H/2, c = half-height, p = net pressure in the pay, E' plane-strain modulus),
# all derived from two textbook results for a pressurised crack in plane strain:
#   stress intensity   K(c) = sqrt(pi c) [ p - dsigma (1 - (2/pi) asin(a/c)) ]        (weight function)
#   area               A = (4/E') [ p pi c^2/2 - 2 dsigma S ],  S = integral_a^c sqrt(c^2 - s^2) ds   (reciprocity)
#   opening            w(z) = (2/(pi E')) * integral over -c < s < c of p(s) G(z, s) ds,
#                      G = ln | (sqrt(c^2-z^2) + sqrt(c^2-s^2)) / (sqrt(c^2-z^2) - sqrt(c^2-s^2)) |
# `section_self_test` checks these against each other and against the uniform-pressure crack.

"Stress intensity at the tips of a cross-section of half-height c."
section_K(c, p, a, dsigma) = sqrt(pi * c) * (p - dsigma * (1 - (2 / pi) * asin(min(a / c, 1.0))))

"Equilibrium half-height for net pressure p: a while contained, otherwise the stable root of K(c) = K_Ic."
function section_half_height(p, a, dsigma, KIc; cmax = 200a)
    section_K(a, p, a, dsigma) <= KIc && return a
    section_K(cmax, p, a, dsigma) >= KIc && return Inf          # runaway: the barriers cannot hold this pressure
    hi = cmax; lo = cmax                                        # walk in from far away to the first c with K >= K_Ic
    while lo > a && section_K(lo, p, a, dsigma) < KIc
        hi = lo; lo = max(a, lo / 1.05)
    end
    for _ in 1:80
        mid = 0.5 * (lo + hi)
        section_K(mid, p, a, dsigma) >= KIc ? (lo = mid) : (hi = mid)
    end
    return 0.5 * (lo + hi)
end

"Cross-section area from the reciprocity formula."
function section_area(c, p, a, dsigma, Ep)
    S = c > a ? (c^2 / 2) * (pi / 2 - asin(a / c)) - (a / 2) * sqrt(c^2 - a^2) : 0.0
    return (4 / Ep) * (p * pi * c^2 / 2 - 2 * dsigma * S)
end

"Integral of the crack Green's function G(z, s) over s1 < |s| < s2 (both signs), midpoint rule."
function green_integral(z, c, s1, s2; n = 240)
    rz = sqrt(max(c^2 - z^2, 0.0)); h = (s2 - s1) / n; I = 0.0
    for k in 1:n
        rs = sqrt(max(c^2 - (s1 + (k - 0.5) * h)^2, 0.0))
        I += log(abs((rz + rs) / max(abs(rz - rs), 1e-300)))
    end
    return 2 * I * h
end

"Opening at height z (0 <= z < c): the uniform-load part in closed form, the other layer by quadrature."
function section_opening(z, c, p, a, dsigma, Ep; n = 240)
    rz = sqrt(max(c^2 - z^2, 0.0))
    c <= a && return (4 / Ep) * p * rz
    if z < a        # in the pay: uniform load p, minus dsigma acting on the barrier strips
        return (4 / Ep) * p * rz - (2 * dsigma / (pi * Ep)) * green_integral(z, c, a, c; n = n)
    else            # in a barrier: uniform load p - dsigma, plus dsigma acting on the pay strip
        return (4 / Ep) * (p - dsigma) * rz + (2 * dsigma / (pi * Ep)) * green_integral(z, c, 0.0, a; n = n)
    end
end

"Cross-section at net pressure p: half-height, area, integral of opening cubed, maximum opening."
function section(p, a, dsigma, KIc, Ep; nz = 160)
    c = section_half_height(p, a, dsigma, KIc)
    isfinite(c) || return (c = Inf, A = Inf, I3 = Inf, wmax = Inf)
    if c <= a                                   # contained: an ellipse, closed forms
        w0 = (4 / Ep) * p * a
        return (c = a, A = pi * a * w0 / 2, I3 = (3 * pi / 16) * (2a) * w0^3, wmax = w0)
    end
    # Gauss-Chebyshev-like nodes z = c cos(theta) resolve the square-root tips
    I3 = 0.0; wmax = 0.0
    for k in 1:nz
        th = (k - 0.5) * (pi / 2) / nz
        z = c * cos(th)
        w = max(section_opening(z, c, p, a, dsigma, Ep), 0.0)
        I3 += 2 * w^3 * c * sin(th) * (pi / 2) / nz
        wmax = max(wmax, w)
    end
    return (c = c, A = section_area(c, p, a, dsigma, Ep), I3 = I3, wmax = wmax)
end

"""
Consistency checks of the cross-section formulas. Returns the worst relative errors:
- `uniform`: integral of G over the whole crack against pi sqrt(c^2 - z^2) (uniform-pressure crack)
- `area`: area by integrating the opening against the reciprocity formula, with barriers
- `tip`: stress intensity read from the opening near the tip, w = (8 K / E') sqrt(s / (2 pi)), against the formula
- `interface`: jump in the opening across the pay/barrier boundary (must vanish). The area check alone cannot
  see a wrong prefactor on the layer correction, because that error cancels in the integral.
"""
function section_self_test(; a = 15.0, dsigma = 3.0e6, Ep = 3.0e10)
    c = 2.2a; p = 0.75 * dsigma
    # uniform load: the Green's function integrated over the whole crack must give 2 pi sqrt(c^2 - z^2),
    # which with the 2/(pi E') prefactor is the textbook opening 4 p sqrt(c^2 - z^2) / E'
    worst_u = 0.0
    for z in (0.0, 0.3c, 0.7c)
        whole = green_integral(z, c, 0.0, a; n = 20000) + green_integral(z, c, a, c; n = 20000)
        worst_u = max(worst_u, abs(whole / (2 * pi * sqrt(c^2 - z^2)) - 1))
    end
    # area by quadrature of the opening
    nz = 4000; A = 0.0
    for k in 1:nz
        th = (k - 0.5) * (pi / 2) / nz
        A += 2 * section_opening(c * cos(th), c, p, a, dsigma, Ep; n = 2000) * c * sin(th) * (pi / 2) / nz
    end
    err_area = abs(A / section_area(c, p, a, dsigma, Ep) - 1)
    # stress intensity from the near-tip opening
    s = 1e-3 * c
    K_tip = section_opening(c - s, c, p, a, dsigma, Ep; n = 20000) * Ep / 8 * sqrt(2 * pi / s)
    err_tip = abs(K_tip / section_K(c, p, a, dsigma) - 1)
    # the pay and barrier expressions for the opening must agree where the layers meet
    w_in = section_opening(a * (1 - 1e-4), c, p, a, dsigma, Ep; n = 20000); w_out = section_opening(a * (1 + 1e-4), c, p, a, dsigma, Ep; n = 20000)
    return (uniform = worst_u, area = err_area, tip = err_tip, interface = abs(w_out / w_in - 1))
end

"""
    p3d_grow(; pay, dsigma, KIc, Eprime, mu, q_wing, t_end, C_L = 0, ncell = 400, ntable = 240)

Grow one fracture wing with height growth (SI units). `pay` is the pay thickness, `dsigma` the extra
closure stress in the barriers, `KIc` the toughness. Returns length, inlet net pressure and inlet
height against time, the final pressure and height along the fracture, and the fluid account.
Throws if net pressure reaches the level the barriers cannot hold (height runaway).
"""
function p3d_grow(; pay, dsigma, KIc = 0.0, Eprime, mu, q_wing, t_end, C_L = 0.0, ncell = 400, nstep = 2 * ncell, ntable = 240, margin = 1.15, xmax = nothing,
        proppant = nothing)
    # proppant = (schedule = [(start_seconds, volume_fraction), ...], diameter = m, bridge = 3.0)
    a = pay / 2
    # pressure table up to just below runaway
    p_cap = 0.995 * (dsigma * (1 - (2 / pi) * asin(1 / 200)) + KIc / sqrt(pi * 200a))   # above this the height is unbounded
    simc = pkn_similarity(n = 20_000)
    p_pkn = Eprime * simc.c_w * (mu * q_wing^2 / (Eprime * pay))^(1 / 5) * t_end^(1 / 5) / (2 * pay)   # contained inlet pressure at the end
    p_tab = min(p_cap, 3 * p_pkn)                   # height growth only lowers pressure, so 3x is ample
    p_grid = [p_tab * (k / ntable) for k in 0:ntable]
    secs = [k == 1 ? (c = a, A = 0.0, I3 = 0.0, wmax = 0.0) : section(p_grid[k], a, dsigma, KIc, Eprime) for k in 1:ntable+1]
    A_tab = [s.A for s in secs]
    W_tab = [s.wmax for s in secs]                   # maximum opening, for the proppant bridging rule
    M_tab = [s.I3 / (12 * mu) for s in secs]         # flow conductance: q = -M dp/dx
    Phi_tab = zeros(ntable + 1)                      # Kirchhoff potential, integral of M dp
    for k in 2:ntable+1                              # M ~ p^3 near zero: integrate on a sub-grid of p^3-exact Simpson
        Phi_tab[k] = Phi_tab[k-1] + (p_grid[k] - p_grid[k-1]) * (M_tab[k-1] + 4 * (section(0.5 * (p_grid[k-1] + p_grid[k]), a, dsigma, KIc, Eprime).I3 / (12 * mu)) + M_tab[k]) / 6
    end
    dp = p_grid[2]
    function lookup(p)                               # A, dA/dp, Phi, M at net pressure p
        p <= 0 && return (0.0, A_tab[2] / dp, 0.0, 0.0)
        if p >= p_grid[end]
            p_tab < p_cap && error("net pressure left the tabulated range; raise the table top")
            error("height runaway: net pressure reached what the barriers can hold ($(round(p_cap / 1e6, digits = 2)) MPa)")
        end
        k = min(floor(Int, p / dp) + 1, ntable); f = (p - p_grid[k]) / dp
        A = A_tab[k] + f * (A_tab[k+1] - A_tab[k]); dA = (A_tab[k+1] - A_tab[k]) / dp
        # interpolate Phi^(1/4), which is linear in p while contained
        g0 = Phi_tab[k]^(1 / 4); g1 = Phi_tab[k+1]^(1 / 4); g = g0 + f * (g1 - g0)
        Phi = g^4; M = 4 * g^3 * (g1 - g0) / dp
        return (A, dA, Phi, M)
    end
    if isnothing(xmax)
        xmax = simc.c_L * (Eprime * q_wing^3 / (mu * pay^4))^(1 / 5) * t_end^(4 / 5)   # contained and no leak-off: the longest it can be
        C_L > 0 && (xmax = min(xmax, q_wing * sqrt(t_end) / (pi * C_L * pay)))
        xmax *= margin
    end
    N = ncell; dx = xmax / N
    p = zeros(N); An = zeros(N); tau = fill(Inf, N)
    times = [t_end * (k / nstep)^2 for k in 1:nstep]
    L_t = zeros(nstep); p0_t = zeros(nstep); h0_t = zeros(nstep)
    lo = zeros(N); di = zeros(N); up = zeros(N); R = zeros(N); dq = zeros(N); dem = zeros(N)
    Av = zeros(N); dAv = zeros(N); Phv = zeros(N); Mv = zeros(N)
    leaked = 0.0; t = 0.0
    Vp = zeros(N); Vp_in = 0.0; first_pack = Inf     # proppant volume per unit length, volume pumped, first time a cell packs
    wmax_at(pk) = pk <= 0 ? 0.0 : (kk = min(floor(Int, pk / dp) + 1, ntable); W_tab[kk] + (pk - p_grid[kk]) / dp * (W_tab[kk+1] - W_tab[kk]))
    conc_at(tm) = isnothing(proppant) ? 0.0 : (c = 0.0; for (ts, cs) in proppant.schedule; tm >= ts && (c = cs); end; c)
    function residual!(r, dt)
        @inbounds for i in 1:N
            Av[i], dAv[i], Phv[i], Mv[i] = lookup(p[i])
        end
        @inbounds for i in 1:N
            fl = i > 1 ? Phv[i-1] : Phv[i]; fr = i < N ? Phv[i+1] : Phv[i]
            R[i] = Av[i] - An[i] - r * (fl - 2 * Phv[i] + fr) - (i == 1 ? dt * q_wing / dx : 0.0) + dem[i]
        end
    end
    for (k, tn) in enumerate(times)
        dt = tn - t; r = dt / dx^2
        @inbounds for i in 1:N
            An[i] = lookup(p[i])[1]
            t_in = tau[i] == Inf ? t + dt / 2 : tau[i]
            dem[i] = 4 * pay * C_L * (sqrt(tn - t_in) - sqrt(max(t - t_in, 0.0)))      # both faces, pay height only
        end
        Ascale = max(maximum(An), dt * q_wing / dx)
        for it in 1:200
            residual!(r, dt)
            viol = 0.0
            @inbounds for i in 1:N
                viol = max(viol, p[i] > 0 ? abs(R[i]) : max(-R[i], 0.0))
            end
            viol < 1e-12 * Ascale && break
            @inbounds for i in 1:N
                if p[i] > 0 || R[i] < 0
                    nb = (i > 1) + (i < N)
                    di[i] = dAv[i] + r * nb * Mv[i]
                    lo[i] = i > 1 ? -r * Mv[i-1] : 0.0
                    up[i] = i < N ? -r * Mv[i+1] : 0.0
                    dq[i] = R[i]
                else
                    di[i] = 1.0; lo[i] = 0.0; up[i] = 0.0; dq[i] = 0.0
                end
            end
            @inbounds for i in 2:N
                m = lo[i] / di[i-1]; di[i] -= m * up[i-1]; dq[i] -= m * dq[i-1]
            end
            dq[N] /= di[N]
            @inbounds for i in N-1:-1:1
                dq[i] = (dq[i] - up[i] * dq[i+1]) / di[i]
            end
            change = 0.0
            @inbounds for i in 1:N
                pi_new = max(p[i] - dq[i], 0.0); change = max(change, abs(pi_new - p[i])); p[i] = pi_new
            end
            change < 1e-11 * max(maximum(p), 1.0) && break
            it == 200 && error("fracture growth step did not converge")
        end
        p[N] > 1e-3 && error("fracture reached the end of the grid; raise `margin`")
        residual!(r, dt)
        @inbounds for i in 1:N
            leaked += (dem[i] - (p[i] > 0 ? 0.0 : R[i])) * dx
            p[i] > 0 && tau[i] == Inf && (tau[i] = t + dt / 2)
        end
        if !isnothing(proppant)
            # Proppant moves with the slurry (no slip) on the fluxes just solved, implicit upwind, swept outward.
            # It cannot enter a cell narrower than `bridge` grain diameters. Leak-off takes fluid only.
            inflow = conc_at(t + dt / 2) * q_wing * dt / dx; Vp_in += inflow * dx
            nb = get(proppant, :bridge, 3.0) * proppant.diameter
            @inbounds for i in 1:N
                (inflow == 0.0 && Vp[i] == 0.0) && continue
                q_out = i < N ? max(-(Phv[i+1] - Phv[i]) / dx, 0.0) : 0.0
                open_next = i < N && wmax_at(p[i+1]) >= nb
                coef = (open_next && Av[i] > 0) ? dt * q_out / (Av[i] * dx) : 0.0
                Vp[i] = (Vp[i] + inflow) / (1 + coef)
                inflow = Vp[i] * coef
                (Av[i] > 0 && Vp[i] / Av[i] > get(proppant, :cmax, 0.6)) && (first_pack = min(first_pack, tn))
            end
        end
        t = tn
        kf = findlast(>(1e-3), p)                     # 1 mPa: any real fluid pressure
        L_t[k] = isnothing(kf) ? 0.0 : (kf == 1 ? dx : (kf - 0.5) * dx + dx * p[kf]^3 / max(p[kf-1]^3 - p[kf]^3, 1e-300))
        p0_t[k] = 1.5 * p[1] - 0.5 * p[2]
        h0_t[k] = 2 * section_half_height(max(p0_t[k], 0.0), a, dsigma, KIc)
    end
    height = [pk > 1e-3 ? 2 * section_half_height(pk, a, dsigma, KIc) : 0.0 for pk in p]
    V_frac = sum(lookup(pk)[1] for pk in p) * dx
    V_inj = q_wing * t_end
    return (t = times, L = L_t, p0 = p0_t, h0 = h0_t, x = ((1:N) .- 0.5) .* dx, p = copy(p), height = height,
        V_injected = V_inj, V_fracture = V_frac, V_leaked = leaked, efficiency = V_frac / V_inj, dx = dx,
        wmax0 = section(max(p0_t[end], 0.0), a, dsigma, KIc, Eprime).wmax,
        area = [lookup(pk)[1] for pk in p], proppant_per_length = Vp, proppant_pumped = Vp_in, proppant_in_fracture = sum(Vp) * dx, first_pack_time = first_pack)
end

"""
Field-unit front end for the height-growth model: one fracture (both wings) pumped at `rate_bpm` for
`minutes` in a pay of `pay_ft` between barriers whose closure stress is higher by `barrier_psi`.
Returns half-length, height at the well, the share of the fracture face that lies inside the pay,
inlet width and net pressure, and fluid efficiency.
"""
function grow_stage_barriers(; pay_ft, barrier_psi, toughness_psi_sqrtin = 1000.0, youngs_psi, poisson = 0.25, viscosity_cp, rate_bpm, minutes,
        leakoff_ft_sqrtmin = 0.0, kwarg...)
    Ep = youngs_psi * PSI / (1 - poisson^2)
    r = p3d_grow(; pay = pay_ft * FT, dsigma = barrier_psi * PSI, KIc = toughness_psi_sqrtin * PSI * sqrt(INCH), Eprime = Ep, mu = viscosity_cp * 1e-3,
        q_wing = rate_bpm * BPM / 2, t_end = minutes * 60.0, C_L = leakoff_ft_sqrtmin * FT_SQRTMIN, kwarg...)
    face = sum(r.height) * r.dx                                   # wetted face area of one wing, m2
    in_pay = sum(min.(r.height, pay_ft * FT)) * r.dx
    notes = String[]
    r.h0[end] > r.L[end] && push!(notes, @sprintf("height at the well (%.0f ft) exceeds the half-length (%.0f ft): the pseudo-3-D assumption (height small against length) is weak here", r.h0[end] / FT, r.L[end] / FT))
    return (half_length_ft = r.L[end] / FT, height_at_well_ft = r.h0[end] / FT, share_in_pay = face > 0 ? in_pay / face : 1.0,
        inlet_width_in = r.wmax0 / INCH, net_pressure_psi = r.p0[end] / PSI, efficiency = r.efficiency, notes = notes, detail = r)
end
