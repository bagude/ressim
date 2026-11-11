# Proppant: from what was pumped to propped length and conductivity.
#
# Transport: proppant is carried along the fracture with the slurry (no slip) by the growth solver,
# cannot enter where the fracture is narrower than a few grain diameters, and is concentrated by leak-off.
#
# Two ways to close the fracture on it:
#   settled (default in the chain): grains fall through the slurry (hindered settling) and build a packed
#     bank from the bottom of the fracture. Per cell the model keeps the suspended grains, the area of
#     slurry that still carries them, and the bank. The laden slurry clears from the top at the settling
#     speed while the bank rises under it, so the concentration of what is still suspended does not
#     change (this is the exact solution for a closed slot, and the test for it). When pumping stops,
#     what is still suspended settles onto the bank below it. Only the part of the bank that lies inside
#     the pay conducts; a bank that fell below the pay is lost.
#   even spread (`settling = false`, the first model): everything stays suspended and is spread evenly
#     over the height when the fracture closes.
# By default the flow does not feel the proppant: it does not slow the slurry, a screen-out is reported
# but raises no pressure, and a bank does not narrow the flow path. With `proppant_feedback = true` in the
# growth solver it does (see `flow_factor` below and research/screen-out.md).
# Left out in both: grains rolling along the top of the bank, crushing and embedment
# beyond one stress factor, gel damage. While pumping, the bank's height is worked out with the mean
# width of the cross-section; at closure the pack fills an ellipse of the same height and area from the
# bottom, so the narrow bottom of the fracture holds little. Constants come from the sources in
# research/proppant-models.md and were not independently re-opened.

const LB_GAL = 119.826427          # kg/m3 per lb/gal
const LB_FT2 = 4.88242764          # kg/m2 per lb/ft2

"Volume fraction of proppant in slurry for a concentration in lb per gallon of clean fluid."
ppa_to_fraction(ppa; density = 2650.0) = (v = ppa * LB_GAL / density; v / (1 + v))

"Stokes settling velocity (m/s): valid for particle Reynolds number below about 1."
stokes_velocity(d; density = 2650.0, fluid_density = 1000.0, mu = 1e-3) = G_ACC * d^2 * (density - fluid_density) / (18 * mu)

"""
Settling velocity (m/s) at any Reynolds number: Ferguson and Church (2004),
v = R g d^2 / (C1 nu + sqrt(0.75 C2 R g d^3)), C1 = 18, C2 = 1.0 for natural sand (0.4 for spheres).
Reduces to Stokes for small grains.
"""
function settling_velocity(d; density = 2650.0, fluid_density = 1000.0, mu = 1e-3, C2 = 1.0)
    R = (density - fluid_density) / fluid_density; nu = mu / fluid_density
    return R * G_ACC * d^2 / (18 * nu + sqrt(0.75 * C2 * R * G_ACC * d^3))
end

"Hindered settling speed in the fixed frame, Richardson and Zaki: v = v_free (1 - c)^n, n = 4.65 at low Reynolds number."
hindered_velocity(v_free, c; n = 4.65) = v_free * max(1 - c, 0.0)^n

"""
Flow speed above the bank at which grains are carried along instead of adding to it (m/s):
    1.87 (d / W)^(1/6) sqrt(2 g W R),   d grain diameter, W fracture width, R = relative density difference.
This is the Wicks deposition rule for slurry pipes with the pipe diameter replaced by the slot width, as
given by McClure (2018), "Bed load proppant transport during slickwater hydraulic fracturing", eq. 12
(arXiv:1611.04020; see research/proppant-bank-equilibrium.md). 0.44 m/s for 0.2 mm sand in water in a
5 mm fracture. It was checked by its source only against 8 mm laboratory slots with 20/40 and coarser
sand in dilute slurry; for finer sand and thicker fluid it is an extrapolation. (A first version here
used Durand's rule with twice the width, written from memory: 0.57 m/s for the same case.)
"""
deposit_velocity(width, diameter; R = 1.65) = 1.87 * (diameter / width)^(1 / 6) * sqrt(2 * G_ACC * width * R)

"""
Settling in one cell over `dt`: `Vs` suspended grain volume and `Hs` area of laden slurry (both per unit
length of fracture), `Vb` grain volume in the bank, `width` the mean width. The laden zone loses height
at the settling speed (clear fluid appears above it) plus the speed of the rising bank,
c v / (cmax - c); the grains it held go to the bank. Returns the new (Vs, Hs, Vb).
"""
@inline function settle_cell(Vs, Hs, Vb, width, dt; v_free, n = 4.65, cmax = 0.6)
    Vs > 0 || return (0.0, 0.0, Vb)
    (Hs <= 0 || Vs >= cmax * Hs) && return (0.0, 0.0, Vb + Vs)          # nothing left to fall through: it is bank
    c = Vs / Hs; v = hindered_velocity(v_free, c; n = n)
    dH = min(Hs, (v + c * v / (cmax - c)) * width * dt)
    return dH >= Hs ? (0.0, 0.0, Vb + Vs) : (Vs - c * dH, Hs - dH, Vb + c * dH)
end

"""
One time step of proppant movement along ONE fracture, cells swept from the well outward (implicit
upwind). `area`, `height`: cross-section now; `q_out`: flow leaving each cell towards the tip (m3/s);
`open_next`: whether the next cell is wide enough for grains; `leak`: fluid area lost to the rock in
this step; `inflow_V`, `inflow_H`: grain volume and laden-slurry volume entering at the well, per unit
length of the first cell. `settle = (v_free, n, cmax, u_eq, R, d)` turns settling on; `u_eq` is the flow
speed above the bank at which nothing more deposits (Inf: deposit until the cell is full; NaN: `deposit_velocity`
of the local width, with `R` the relative density difference and `d` the grain diameter). With settling on,
no cell holds more than a full pack; the function returns the grain volume (per unit length of a cell) that
could not be placed at all.
`open_fraction` (optional, used with `proppant_feedback`): the share of the step during which the next cell is wide
enough, in place of the yes or no of `open_next` (see `open_share`).
"""
function proppant_sweep!(Vs, Hs, Vb; area, height, q_out, open_next, leak, inflow_V, inflow_H, dt, dx, settle = nothing, open_fraction = nothing)
    inV = inflow_V; inH = inflow_H
    @inbounds for i in eachindex(Vs)
        (inV == 0.0 && Vs[i] == 0.0) && continue
        coef = isnothing(open_fraction) ? ((open_next[i] && area[i] > 0) ? dt * q_out[i] / (area[i] * dx) : 0.0) :
            ((open_fraction[i] > 0 && area[i] > 0) ? open_fraction[i] * dt * q_out[i] / (area[i] * dx) : 0.0)
        Vs[i] = (Vs[i] + inV) / (1 + coef)
        inV = Vs[i] * coef
        keep = area[i] > 0 ? area[i] / (area[i] + max(leak[i], 0.0)) : 1.0       # leak-off takes carrier fluid, not grains
        Hs[i] = min((Hs[i] * keep + inH) / (1 + coef), max(area[i], 0.0))
        inH = Hs[i] * coef
        if !isnothing(settle) && height[i] > 0 && area[i] > 0 && Vs[i] > 0
            w = area[i] / height[i]
            room = height[i] - Vb[i] / (settle.cmax * w)
            u_eq = isnan(settle.u_eq) ? deposit_velocity(w, settle.d; R = settle.R) : settle.u_eq
            if room > 0 && q_out[i] / (w * room) < u_eq
                Vs[i], Hs[i], Vb[i] = settle_cell(Vs[i], Hs[i], Vb[i], w, dt; v_free = settle.v_free, n = settle.n, cmax = settle.cmax)
            end
        end
    end
    isnothing(settle) && return 0.0
    # A cell cannot hold more grains than a full pack. What does not fit backs up towards the well (this is how a
    # screen-out spreads back from the tip); what does not fit in the first cell was never placed and is returned.
    rejected = 0.0
    @inbounds for i in reverse(eachindex(Vs))
        area[i] > 0 || continue
        excess = Vs[i] + Vb[i] - settle.cmax * area[i]
        excess > 0 || continue
        Vb[i] = settle.cmax * area[i]; Vs[i] = 0.0; Hs[i] = 0.0          # the cell is all pack now
        if i > firstindex(Vs)
            Vs[i-1] += excess
        else
            rejected += excess
        end
    end
    return rejected
end

"""
Slurry viscosity over the carrier fluid's, at grain volume fraction `c`: 1 / (1 - c / cmax)^exponent, exponent 2.5.
This is the relation given by Mack and Warpinski (2000, in Reservoir Stimulation, 3rd edition) as quoted in the
Itasca 3DEC manual (research/screen-out.md); the original was not opened. It has no upper limit as c nears cmax;
`flow_factor` caps it at the resistance of a full pack.
"""
slurry_viscosity_ratio(c; cmax = 0.6, exponent = 2.5) = c <= 0 ? 1.0 : c >= cmax ? Inf : (1 - c / cmax)^(-exponent)

"""
    flow_factor(area, height, Vs, Hs, Vb; cmax, diameter, exponent = 2.5)

How much of its clean-fluid conductance a cross-section keeps when it holds proppant (1 = all of it).
`area`, `height`: the open cross-section; `Vs`: suspended grain volume and `Hs`: area of slurry that carries it;
`Vb`: grain volume in the bank (all per unit length of fracture). The cross-section is taken at its mean width
w = area / height and split by height into three parts that flow side by side under the same pressure gradient:
  clear fluid          its share of the area, at the fluid's own viscosity;
  laden slurry         its share, slowed by `slurry_viscosity_ratio` of its concentration;
  bank (a full pack)   its share, as flow through a porous pack: 12 k / w^2 of an open slot of the same width,
                       k the Kozeny-Carman permeability of the pack (porosity 1 - cmax).
No part is taken as slower than the pack. A cross-section that is all pack keeps about a hundred-thousandth of its
conductance (0.2 mm sand, 5 mm wide): the fluid can only filter through.
"""
function flow_factor(area, height, Vs, Hs, Vb; cmax = 0.6, diameter, exponent = 2.5)
    (area > 0 && height > 0 && (Vs > 0 || Vb > 0)) || return 1.0
    w = area / height
    m_pack = min(12 * pack_permeability(diameter, 1 - cmax) / w^2, 1.0)
    f_bank = min(Vb / (cmax * area), 1.0)
    laden = max(Hs, Vs / cmax)                              # suspended grains take at least the room of a pack
    f_laden = Vs > 0 ? min(laden / area, 1.0 - f_bank) : 0.0
    c = Vs > 0 ? Vs / laden : 0.0
    m_laden = c >= cmax ? m_pack : max((1 - c / cmax)^exponent, m_pack)
    return clamp((1.0 - f_bank - f_laden) + f_laden * m_laden + f_bank * m_pack, m_pack, 1.0)
end

"""
Share of a time step during which a cell is at least `limit` wide, its width taken as changing evenly from `w0` at the
start of the step to `w1` at its end. A yes or no taken at the end of the step depends on the step: a tip cell that opens
and widens past the limit within one long step is never seen narrow, while short steps see it narrow for several. With
the share, grains held back in front of a narrow tip do not depend on the step in that way.
"""
open_share(w0, w1, limit) = w0 >= limit ? (w1 >= limit ? 1.0 : (w0 - limit) / (w0 - w1)) : (w1 >= limit ? (w1 - limit) / (w1 - w0) : 0.0)

"Kozeny-Carman pack permeability (m2) for grain diameter d and porosity phi, constant 180."
pack_permeability(d, phi) = d^2 * phi^3 / (180 * (1 - phi)^2)

"Propped width (m) for an areal proppant concentration (kg/m2): the pack's solid fraction is 1 - phi."
propped_width(areal_kg_m2; density = 2650.0, pack_porosity = 0.35) = areal_kg_m2 / ((1 - pack_porosity) * density)

"Share of an ellipse's area that lies below the fraction `eta` of its height (0 at the bottom tip, 1 at the top)."
ellipse_fill(eta) = (u = clamp(1 - 2 * eta, -1.0, 1.0); (acos(u) - u * sqrt(1 - u^2)) / pi)

"""
    propped_profile(r; pay, diameter, density, pack_porosity, closure_psi, stress_coefficient, settled)

Close the fracture from a growth result `r` (run with `proppant = ...`). Returns, along the
fracture: propped width and conductivity averaged over the PAY height (md-ft), the propped
half-length, and the share of the proppant that ended inside the pay.

`settled = false`: the proppant in each cross-section is spread evenly over its height; the propped
half-length is where at least one grain diameter of pack remains.
`settled = true` (needs a growth run with settling): everything in a cross-section ends in a bank at
the bottom of the fracture. The cross-section is taken as an ellipse of the same height and area, so the
narrow bottom holds little. Only the pack inside the pay conducts: conductivity is pack permeability x
(packed area inside the pay / pay thickness).
The propped half-length is where the bank stands at least one grain diameter into the pay.
"""
function propped_profile(r; pay, diameter, density = 2650.0, pack_porosity = 0.35, closure_psi = 0.0, stress_coefficient = 2.4e-4, settled = false)
    k = pack_permeability(diameter, pack_porosity) * exp(-stress_coefficient * closure_psi)      # m2
    n = length(r.x)
    wp = zeros(n); cond = zeros(n); in_pay = 0.0; bank = zeros(n); bank_in_pay = zeros(n)
    for i in 1:n
        r.height[i] > 0 || continue
        if settled
            A = r.area[i]; h = r.height[i]
            A > 0 || continue
            share = min(r.proppant_per_length[i] / ((1 - pack_porosity) * A), 1.0)               # share of the cross-section the pack fills
            lo = 0.0; hi = 1.0                                                                   # fill an ellipse of the same height and area from the bottom
            for _ in 1:50
                m = 0.5 * (lo + hi)
                ellipse_fill(m) < share ? (lo = m) : (hi = m)
            end
            bank[i] = 0.5 * (lo + hi) * h                                                        # bank height, from the lower tip up
            below = max(r.down[i] - pay / 2, 0.0)                                                # how far the fracture reaches below the pay
            bank_in_pay[i] = clamp(bank[i] - below, 0.0, pay)
            A_in = A * max(ellipse_fill(min(bank[i], below + pay) / h) - ellipse_fill(min(below / h, 1.0)), 0.0)   # packed area inside the pay
            wp[i] = A_in / pay                                                                   # pay-height average of the packed width
            cond[i] = k * wp[i] / (DARCY * 1e-3) / FT
            in_pay += (1 - pack_porosity) * A_in * r.dx
        else
            solid_per_height = r.proppant_per_length[i] / r.height[i]        # m3 of grains per m2 of fracture face
            wp[i] = solid_per_height / (1 - pack_porosity)                   # packed width, uniform over the height
            cond[i] = k * wp[i] / (DARCY * 1e-3) / FT                        # md-ft
            in_pay += r.proppant_per_length[i] * min(pay / r.height[i], 1.0) * r.dx
        end
    end
    last = settled ? findlast(>=(diameter), bank_in_pay) : findlast(>=(diameter), wp)
    xf = isnothing(last) ? 0.0 : r.x[last] + r.dx / 2
    total = r.proppant_in_fracture
    return (x = r.x, propped_width = wp, conductivity_mdft = cond, propped_half_length = xf, pack_permeability_darcy = k / DARCY,
        share_in_pay = total > 0 ? in_pay / total : 0.0, areal_lb_ft2 = [wp[i] * (1 - pack_porosity) * density / LB_FT2 for i in 1:n],
        bank_height = bank, bank_height_in_pay = bank_in_pay)
end

"""
    propped_zones(r, zones; diameter, density, pack_porosity, closure_psi, stress_coefficient, settled)

As `propped_profile`, for several depth zones at once. `zones` is a list of (bottom, top) in metres above the
fracture's centre line (where the lateral is; negative below it). Returns, for zone k and position i along the
fracture, `conductivity_mdft[k][i]` (pack permeability x packed area inside the zone / zone thickness) and
`packed_height[k][i]` (m of the zone's height that holds pack). With the pay as the only zone this is
`propped_profile`'s conductivity.
"""
function propped_zones(r, zones; diameter, density = 2650.0, pack_porosity = 0.35, closure_psi = 0.0, stress_coefficient = 2.4e-4, settled = false)
    k = pack_permeability(diameter, pack_porosity) * exp(-stress_coefficient * closure_psi)      # m2
    n = length(r.x); cond = [zeros(n) for _ in zones]; packed = [zeros(n) for _ in zones]
    for i in 1:n
        h = r.height[i]; h > 0 || continue
        low = -r.down[i]                                    # the lower tip, in height above the centre line
        if settled
            A = r.area[i]; A > 0 || continue
            share = min(r.proppant_per_length[i] / ((1 - pack_porosity) * A), 1.0)
            lo = 0.0; hi = 1.0
            for _ in 1:50
                m = 0.5 * (lo + hi)
                ellipse_fill(m) < share ? (lo = m) : (hi = m)
            end
            bank = 0.5 * (lo + hi) * h                      # bank height, from the lower tip up
            for (kz, (z1, z2)) in enumerate(zones)
                a1 = clamp(z1 - low, 0.0, h); a2 = clamp(min(z2 - low, bank), 0.0, h)
                a2 > a1 || continue
                cond[kz][i] = k * (A * (ellipse_fill(a2 / h) - ellipse_fill(a1 / h)) / (z2 - z1)) / (DARCY * 1e-3) / FT
                packed[kz][i] = a2 - a1
            end
        else
            wp = r.proppant_per_length[i] / h / (1 - pack_porosity)      # packed width, uniform over the fracture's height
            for (kz, (z1, z2)) in enumerate(zones)
                over = min(z2, low + h) - max(z1, low)
                over > 0 || continue
                cond[kz][i] = k * wp * (over / (z2 - z1)) / (DARCY * 1e-3) / FT
                packed[kz][i] = wp >= diameter ? over : 0.0
            end
        end
    end
    return (conductivity_mdft = cond, packed_height = packed)
end
