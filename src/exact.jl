# Closed-form solutions used as independent checks. Nothing here calls the engine.

"""
Fraction of a closed slab's recoverable mass produced through a constant-pressure face at
dimensionless time tau = eta t / L^2 (linear diffusion, no-flow far boundary).
F -> 2 sqrt(tau / pi) at early time and F -> 1 at late time.
"""
function slab_recovery(tau; nterms = 4000)
    tau <= 0 && return 0.0
    s = 0.0
    for n in 0:nterms-1
        a = (2n + 1)^2 * pi^2
        s += 8 / a * exp(-a * tau / 4)
    end
    return 1 - s
end

"""
Buckley-Leverett water saturation profile for Corey exponent 2 in both phases.
`x` is distance as a fraction of the length, `pvi` the pore volumes injected, `M` = mu_oil / mu_water,
`swr`, `sor` the residual saturations; the initial water saturation is `swr`.
Returns water saturation at each x (exact, with the shock).
"""
function buckley_leverett(x::AbstractVector, pvi; M = 5.0, swr = 0.2, sor = 0.2)
    dS = 1 - swr - sor
    D(s) = M * s^2 + (1 - s)^2
    fp(s) = 2M * s * (1 - s) / D(s)^2            # df/ds in normalised saturation
    s_front = 1 / sqrt(M + 1)                    # Welge tangent, closed form for exponent 2
    x_front = pvi * fp(s_front) / dS
    out = fill(swr, length(x))
    for (i, xi) in enumerate(x)
        xi >= x_front && continue
        target = xi * dS / pvi                   # fp(s) = target, fp decreasing on [s_front, 1]
        lo, hi = s_front, 1.0
        for _ in 1:80
            mid = 0.5 * (lo + hi)
            fp(mid) > target ? (lo = mid) : (hi = mid)
        end
        out[i] = swr + 0.5 * (lo + hi) * dS
    end
    return out, x_front
end

"Self-check of the closed forms against their own limits. Throws if any fails."
function exact_self_test()
    for tau in (1e-4, 1e-3, 1e-2)
        @assert abs(slab_recovery(tau) / (2 * sqrt(tau / pi)) - 1) < 1e-4
    end
    @assert abs(slab_recovery(50.0) - 1) < 1e-12
    # Buckley-Leverett: water injected must equal the integral of the saturation rise
    x = range(0, 1, length = 200001)
    s, xf = buckley_leverett(collect(x), 0.25)
    @assert xf < 1
    @assert abs(sum(s .- 0.2) * step(x) - 0.25) < 2e-4
    return true
end
