# Where the sand is when the fracture closes on it.
#
# `propped_profile(...; settled = true)` (proppant.jl) lets every grain fall to the bottom of its cross-section, however
# far that is and however long it takes. That is right when the fracture stays open for a long time after the pumps
# stop. It is wrong in leaky rock: there the fracture closes within minutes, and a grain that has to fall a hundred
# feet does not get there. Here the sand still in suspension at shut-in falls only as far as it can before closure:
#   closure time    from the fluid efficiency at shut-in, by the same relation the DFIT analysis uses (dfit.jl):
#                   efficiency = G / (G + 4 g(0) / pi), G the G-function of the closure time over the pumping time
#   fall            hindered settling speed at the suspension's own concentration, times the closure time
#   what lands      the bank that formed while pumping grows by what falls onto it
#   what stays      the rest keeps its place, a uniform suspension between the bank and its own lowered top, and
#                   is pressed into a pack whose width is the local fracture width times concentration / pack solids
# The cross-section is the same ellipse of equal height and area that `propped_profile` uses.
# Not modelled: the fracture closing first where the stress is highest (the barriers), which would trap sand there even
# sooner; fluid moving along the fracture while it closes; grains held up by the walls of a narrowing fracture; and a
# closure time for each cross-section on its own (one time for the whole fracture is used).

"""
    closure_time(efficiency, pump_time)

Time from shut-in to closure (same unit as `pump_time`) for a fracture of the given fluid efficiency at shut-in, from
efficiency = G / (G + 4 g(0) / pi) with constant fracture area after shut-in (the relation `dfit_analysis` uses).
"""
function closure_time(efficiency, pump_time)
    0 <= efficiency < 1 || error("closure_time: the efficiency must be at least 0 and below 1")
    Gc = efficiency / (1 - efficiency) * 4 * dfit_g(0.0) / pi
    hi = 1.0
    while dfit_G(hi) < Gc
        hi *= 2
    end
    lo = 0.0
    for _ in 1:80
        m = 0.5 * (lo + hi)
        dfit_G(m) < Gc ? (lo = m) : (hi = m)
    end
    return 0.5 * (lo + hi) * pump_time
end

"Height (from the lower tip) up to which an ellipse of height `h` holds the share `s` of its area."
function ellipse_height(s, h)
    s <= 0 && return 0.0
    s >= 1 && return h
    lo = 0.0; hi = 1.0
    for _ in 1:60
        m = 0.5 * (lo + hi)
        ellipse_fill(m) < s ? (lo = m) : (hi = m)
    end
    return 0.5 * (lo + hi) * h
end

"""
    propped_at_closure(f, zones; diameter, v_free, pump_time, n = 4.65, density, pack_porosity, closure_psi,
                       stress_coefficient, efficiency = f.efficiency, fall = nothing)

The pack left in a fracture `f` (one entry of a growth result, run with settling) when it closes, by depth zone.
`zones` is a list of (bottom, top) in metres above the fracture's centre line; `v_free` the settling speed of a
single grain (m/s); `pump_time` the pumping time (s). `fall` overrides how far the suspension falls (m; a number
or one per position; `Inf` gives `propped_profile`'s settled answer). Returns per zone and position
`conductivity_mdft`, `packed_height` (m of the zone's height that holds a pack at least one grain wide) and `grain_area` (m2 of grains in the
zone's part of the cross-section, conducting or not), and per position `bank_height` (m, bank from the lower tip),
`suspension_top` (m from the lower tip), `fall` (m), with `closure_seconds`.
A suspension left too thin to make a pack one grain wide still conducts in proportion to its sand (as the even-spread
rule of `propped_profile` has it) but does not count as propped height, so it does not extend the propped length.
"""
function propped_at_closure(f, zones; diameter, v_free, pump_time, n = 4.65, density = 2650.0, pack_porosity = 0.35, closure_psi = 0.0, stress_coefficient = 2.4e-4,
        efficiency = f.efficiency, fall = nothing)
    k = pack_permeability(diameter, pack_porosity) * exp(-stress_coefficient * closure_psi)
    solid = 1 - pack_porosity; nx = length(f.x)
    tc = closure_time(clamp(efficiency, 0.0, 0.999), pump_time)
    cond = [zeros(nx) for _ in zones]; packed = [zeros(nx) for _ in zones]; grains = [zeros(nx) for _ in zones]
    bank = zeros(nx); top = zeros(nx); fell = zeros(nx)
    for i in 1:nx
        h = f.height[i]; A = f.area[i]
        (h > 0 && A > 0) || continue
        F(y) = A * ellipse_fill(clamp(y / h, 0.0, 1.0))                  # area of the cross-section below height y (from the lower tip)
        Vs = f.proppant_suspended[i]; Vb = f.proppant_banked[i]
        b0 = ellipse_height(min(Vb / (solid * A), 1.0), h)               # the bank that formed while pumping
        open = A - F(b0); c = open > 0 ? min(Vs / open, solid) : 0.0     # grains per volume of the suspension above it
        z = isnothing(fall) ? hindered_velocity(v_free, c; n = n) * tc : (fall isa Number ? Float64(fall) : Float64(fall[i]))
        t1 = max(h - z, b0)                                              # the suspension's top after falling
        # the bank's new top b1: grains that landed plus grains still in suspension between b1 and t1 are the grains there were
        left(b) = solid * (F(b) - F(b0)) + c * max(F(t1) - F(b), 0.0) - c * open
        lo = b0; hi = h
        for _ in 1:60
            m = 0.5 * (lo + hi)
            left(m) < 0 ? (lo = m) : (hi = m)
        end
        b1 = c > 0 ? 0.5 * (lo + hi) : b0; t1 = max(t1, b1)
        bank[i] = b1; top[i] = t1; fell[i] = isfinite(z) ? min(z, h) : h
        low = -f.down[i]
        for (kz, (z1, z2)) in enumerate(zones)
            a1 = clamp(z1 - low, 0.0, h); a2 = clamp(z2 - low, 0.0, h)
            a2 > a1 || continue
            in_bank = F(min(a2, b1)) - F(min(a1, b1))
            s1 = clamp(a1, b1, t1); s2 = clamp(a2, b1, t1)
            in_susp = s2 > s1 ? (c / solid) * (F(s2) - F(s1)) : 0.0         # packed area the suspension leaves in this zone
            conducts = s2 > s1 && in_susp / (s2 - s1) >= diameter         # at least one grain wide on average: counts as propped height
            grains[kz][i] = solid * (in_bank + in_susp)
            packed[kz][i] = (min(a2, b1) - min(a1, b1)) + (conducts ? s2 - s1 : 0.0)
            cond[kz][i] = k * ((in_bank + in_susp) / (z2 - z1)) / (DARCY * 1e-3) / FT
        end
    end
    return (conductivity_mdft = cond, packed_height = packed, grain_area = grains, bank_height = bank, suspension_top = top, fall = fell, closure_seconds = tc)
end

"""
    propped_profile_at_closure(f; pay, diameter, v_free, pump_time, ...)

`propped_at_closure` for the pay alone, with the fields `propped_profile` returns (so it can stand in for it): the
pay-height average of the packed width, conductivity along the fracture, the propped half-length (out to where at
least one grain diameter of the pay's height conducts), the share of the sand that ended inside the pay, and the
bank's height. Also `fall_ft` and `closure_minutes`.
"""
function propped_profile_at_closure(f; pay, diameter, v_free, pump_time, density = 2650.0, pack_porosity = 0.35, kw...)
    r = propped_at_closure(f, [(-pay / 2, pay / 2)]; diameter = diameter, v_free = v_free, pump_time = pump_time, density = density, pack_porosity = pack_porosity, kw...)
    solid = 1 - pack_porosity; nx = length(f.x)
    c = r.conductivity_mdft[1]; kperm = pack_permeability(diameter, pack_porosity)
    wp = r.grain_area[1] ./ (solid * pay)
    last = findlast(>=(diameter), r.packed_height[1]); xf = isnothing(last) ? 0.0 : f.x[last] + f.dx / 2
    total = f.proppant_in_fracture; in_pay = sum(r.grain_area[1]) * f.dx
    below = [max(f.down[i] - pay / 2, 0.0) for i in 1:nx]
    return (x = f.x, propped_width = wp, conductivity_mdft = c, propped_half_length = xf, pack_permeability_darcy = kperm / DARCY, share_in_pay = total > 0 ? in_pay / total : 0.0,
        areal_lb_ft2 = [wp[i] * solid * density / LB_FT2 for i in 1:nx], bank_height = r.bank_height, bank_height_in_pay = [clamp(r.bank_height[i] - below[i], 0.0, pay) for i in 1:nx],
        packed_height_in_pay = r.packed_height[1], fall_ft = r.fall ./ FT, closure_minutes = r.closure_seconds / 60)
end
