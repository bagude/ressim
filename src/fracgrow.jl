# Hydraulic fracture growth, first model: one constant-height fracture wing (PKN type).
#
# What it is: fluid flow along the fracture (lubrication), an elliptical opening set by the local
# net pressure (plane strain across the height), Carter leak-off into the rock, and a front that
# advances as fluid reaches it. Height is an INPUT (the fracture is assumed contained in the pay).
# What it is not: no stress interaction between fractures, no height growth, no toughness, no
# proppant. Those need non-local elasticity and proppant transport, which this model does not have.
# It returns length and width, not propped conductivity.
#
# Equations (w = maximum opening at position x, one wing, SI units):
#   opening      w = 2 h p_net / E'                      E' = E / (1 - nu^2)
#   area         A = pi w h / 4
#   flow         q = -(pi h w^3 / (64 mu)) dp/dx
#   leak-off     2 h C_L / sqrt(t - tau(x)) per unit length, tau = time the fluid arrived
#   together     dw/dt = (E' / (128 mu h)) d2(w^4)/dx2 - (8 C_L / pi) / sqrt(t - tau)
#   inlet        q(0, t) = q_wing;   tip: w = 0

const BPM = 0.158987294928 / 60          # barrels per minute -> m3/s
const FT_SQRTMIN = 0.3048 / sqrt(60.0)   # ft/sqrt(min) -> m/sqrt(s)

"""
No-leak-off similarity solution of the model above, by shooting from the tip (a different method
from the time-stepping solver, used to check it). Returns the dimensionless constants in
    L(t)    = c_L * (E' q^3 / (mu h^4))^(1/5) * t^(4/5)
    w(0, t) = c_w * (mu q^2 / (E' h))^(1/5) * t^(1/5)
with q the rate into ONE wing.
"""
function pkn_similarity(; n = 200_000, s0 = 1e-4)
    a = (3 / 5)^(1 / 3)                         # tip behaviour: phi = a (1 - xi)^(1/3)
    f(s, y) = begin
        phi, psi = y
        dphi = -3 * s^2 * psi / (4 * phi^3)
        (dphi, -(3 / 5) * s^2 * phi - (4 / 5) * (1 - s^3) * dphi)
    end
    y = (a * s0, -(4 / 3) * a^4 * s0); s = s0; h = (1 - s0) / n
    area = a * s0 * (3 / 4) * s0^3                 # integral of phi over the tip piece, d(xi) = 3 s^2 ds
    for _ in 1:n                                 # classical Runge-Kutta in s = (1 - xi)^(1/3)
        k1 = f(s, y); k2 = f(s + h / 2, y .+ (h / 2) .* k1); k3 = f(s + h / 2, y .+ (h / 2) .* k2); k4 = f(s + h, y .+ h .* k3)
        y_new = y .+ (h / 6) .* (k1 .+ 2 .* k2 .+ 2 .* k3 .+ k4)
        area += h * 0.5 * (y[1] * 3 * s^2 + y_new[1] * 3 * (s + h)^2)
        y = y_new; s += h
    end
    phi0, B = y[1], -y[2]                        # phi(0) and -(phi^4)'(0)
    c_L = (512 / (pi * B))^(3 / 5) * 128^(-4 / 5)
    c_w = phi0 * (c_L^2 * 128)^(1 / 3)           # G0 = (lambda^2 / D)^(1/3), D = E' / (128 mu h)
    # volume balance of the similarity solution itself: (pi/4) c_L c_w * mean(phi/phi0) must equal 1
    return (c_L = c_L, c_w = c_w, phi0 = phi0, B = B, volume_check = pi / 4 * c_L * c_w * area / phi0 - 1)
end

"""
    pkn_grow(; height, Eprime, mu, q_wing, t_end, C_L = 0, ncell = 800, nstep = 2 ncell)

Grow one fracture wing (SI units). Returns times, length, inlet opening and net pressure, the final
opening profile and the fluid volume account (injected = in the fracture + leaked off).
"""
function pkn_grow(; height, Eprime, mu, q_wing, t_end, C_L = 0.0, ncell = 800, nstep = 2 * ncell, margin = 1.15)
    h = height
    D = Eprime / (128 * mu * h)
    sim = pkn_similarity(n = 20_000)
    # two upper bounds on the final length: no leak-off at all, and everything leaking off
    xmax = sim.c_L * (Eprime * q_wing^3 / (mu * h^4))^(1 / 5) * t_end^(4 / 5)
    C_L > 0 && (xmax = min(xmax, q_wing * sqrt(t_end) / (pi * C_L * h)))
    xmax *= margin
    N = ncell; dx = xmax / N
    w = zeros(N); tau = fill(Inf, N)
    inflow = 4 * q_wing / (pi * h) / dx                # source in the first cell, in opening per time
    times = [t_end * (k / nstep)^2 for k in 1:nstep]   # small steps first
    L_t = zeros(nstep); w0_t = zeros(nstep)
    leaked = 0.0; t = 0.0
    lo = zeros(N); di = zeros(N); up = zeros(N); R = zeros(N); dw = zeros(N); wn = similar(w); dem = zeros(N)
    # residual of the implicit step, leak-off demand included; R >= 0 on a dry cell means the rock
    # would take more than arrives, so the cell stays dry
    function residual!(r, dt)
        @inbounds for i in 1:N
            u = w[i]^4
            ul = i > 1 ? w[i-1]^4 : u               # nothing through the inlet face except the source
            ur = i < N ? w[i+1]^4 : u
            R[i] = w[i] - wn[i] - r * (ul - 2u + ur) - (i == 1 ? dt * inflow : 0.0) + dem[i]
        end
    end
    for (k, tn) in enumerate(times)
        dt = tn - t; r = dt * D / dx^2
        copyto!(wn, w)
        @inbounds for i in 1:N                          # leak-off demand over this step (opening units)
            t_in = tau[i] == Inf ? t + dt / 2 : tau[i]  # a cell first reached in this step: mid-step arrival
            dem[i] = (16 * C_L / pi) * (sqrt(tn - t_in) - sqrt(max(t - t_in, 0.0)))
        end
        for it in 1:200                                 # Newton with an active set (dry cells that stay dry are held)
            residual!(r, dt)
            scale = max(maximum(w), 1e-6); viol = 0.0
            @inbounds for i in 1:N
                viol = max(viol, w[i] > 0 ? abs(R[i]) : max(-R[i], 0.0))
            end
            viol < 1e-13 * scale && break
            @inbounds for i in 1:N
                if w[i] > 0 || R[i] < 0
                    nb = (i > 1) + (i < N)
                    di[i] = 1 + r * nb * 4 * w[i]^3
                    lo[i] = i > 1 ? -r * 4 * w[i-1]^3 : 0.0
                    up[i] = i < N ? -r * 4 * w[i+1]^3 : 0.0
                    dw[i] = R[i]
                else
                    di[i] = 1.0; lo[i] = 0.0; up[i] = 0.0; dw[i] = 0.0
                end
            end
            @inbounds for i in 2:N                      # Thomas solve
                m = lo[i] / di[i-1]; di[i] -= m * up[i-1]; dw[i] -= m * dw[i-1]
            end
            dw[N] /= di[N]
            @inbounds for i in N-1:-1:1
                dw[i] = (dw[i] - up[i] * dw[i+1]) / di[i]
            end
            change = 0.0
            @inbounds for i in 1:N
                wi = max(w[i] - dw[i], 0.0); change = max(change, abs(wi - w[i])); w[i] = wi
            end
            change < 1e-11 * scale && break             # the flux terms cancel to round-off, so test the update
            it == 200 && error("fracture growth step did not converge")
        end
        w[N] > 1e-9 && error("fracture reached the end of the grid; raise `margin`")
        residual!(r, dt)
        @inbounds for i in 1:N                          # what the rock actually took: the demand, or all that arrived
            leaked += (dem[i] - (w[i] > 0 ? 0.0 : R[i])) * pi * h / 4 * dx
            w[i] > 0 && tau[i] == Inf && (tau[i] = t + dt / 2)
        end
        t = tn
        kf = findlast(>(1e-9), w)
        L_t[k] = isnothing(kf) ? 0.0 : (kf == 1 ? dx : (kf - 0.5) * dx + dx * w[kf]^3 / max(w[kf-1]^3 - w[kf]^3, 1e-300))
        w0_t[k] = 1.5 * w[1] - 0.5 * w[2]              # extrapolated to the inlet face
    end
    V_frac = sum(w) * pi * h / 4 * dx
    V_inj = q_wing * t_end
    return (t = times, L = L_t, w0 = w0_t, pnet0 = Eprime .* w0_t ./ (2h), x = ((1:N) .- 0.5) .* dx, w = w,
        V_injected = V_inj, V_fracture = V_frac, V_leaked = leaked, efficiency = V_frac / V_inj, dx = dx)
end

"""
Field-unit front end: one stage pumped at `rate_bpm` (both wings together) for `minutes`.
Returns half-length (ft), average and inlet opening (in), inlet net pressure (psi) and fluid efficiency.
"""
function grow_stage(; height_ft, youngs_psi, poisson = 0.25, viscosity_cp, rate_bpm, minutes, leakoff_ft_sqrtmin = 0.0, kwarg...)
    Ep = youngs_psi * PSI / (1 - poisson^2)
    r = pkn_grow(; height = height_ft * FT, Eprime = Ep, mu = viscosity_cp * 1e-3, q_wing = rate_bpm * BPM / 2, t_end = minutes * 60.0,
        C_L = leakoff_ft_sqrtmin * FT_SQRTMIN, kwarg...)
    L = r.L[end]
    return (half_length_ft = L / FT, inlet_width_in = r.w0[end] / 0.0254, average_width_in = r.V_fracture / (L * height_ft * FT) / 0.0254,
        net_pressure_psi = r.pnet0[end] / PSI, efficiency = r.efficiency, detail = r)
end
