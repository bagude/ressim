# Gas and liquid flowing up the tubing together, with no slip between them (homogeneous model).
#
# At every depth the oil, its dissolved gas, the free gas and the water are taken from the SAME
# fluid tables the reservoir uses (the SPE1 benchmark fluid behind `fluid = "blackoil_spe1"`), and
# the mixture moves at one velocity. Free gas lightens the column, so the bottom-hole pressure is
# lower than for a liquid-filled tubing.
# What it leaves out: gas rising faster than liquid (slip). Real wells hold more liquid than this
# model says, so it UNDERSTATES bottom-hole pressure. A liquid-only tubing overstates it. The two
# together bracket the answer; neither is a calibrated lift correlation.
# Undersaturated oil is given its saturated volume factor at its own gas content (no oil
# compressibility above the bubble point in the tubing), a difference of about one percent.

# saturated oil: Rs (Mscf/stb), pressure (psia), Bo (rb/stb), viscosity (cP); gas: pressure, Bg (rb/Mscf), viscosity
const SPE1_OIL = ((0.001, 14.7, 1.062, 1.04), (0.0905, 264.7, 1.15, 0.975), (0.18, 514.7, 1.207, 0.91), (0.371, 1014.7, 1.295, 0.83),
    (0.636, 2014.7, 1.435, 0.695), (0.775, 2514.7, 1.5, 0.641), (0.93, 3014.7, 1.565, 0.594), (1.27, 4014.7, 1.695, 0.51), (1.618, 5014.7, 1.827, 0.449))
const SPE1_GAS = ((14.7, 166.666, 0.008), (264.7, 12.093, 0.0096), (514.7, 6.274, 0.0112), (1014.7, 3.197, 0.014), (2014.7, 1.614, 0.0189),
    (2514.7, 1.294, 0.0208), (3014.7, 1.08, 0.0228), (4014.7, 0.811, 0.0268), (5014.7, 0.649, 0.0309), (9014.7, 0.386, 0.047))
const SPE1_RHO_OIL, SPE1_RHO_WATER, SPE1_RHO_GAS = 53.66, 64.49, 0.0533      # lb/ft3 at surface
const SPE1_BW, SPE1_MUW = 1.038, 0.318
const FT3_PER_BBL = 5.614583333

"Piecewise-linear interpolation through (x, y) pairs picked from a table of tuples; clamped at the ends."
function tab(table, ix, iy, x)
    x <= table[1][ix] && return table[1][iy] + zero(x)
    for k in 2:length(table)
        if x <= table[k][ix]
            f = (x - table[k-1][ix]) / (table[k][ix] - table[k-1][ix])
            return table[k-1][iy] + f * (table[k][iy] - table[k-1][iy])
        end
    end
    return table[end][iy] + zero(x)
end

"""
No-slip mixture at pressure `p` (psia) for surface rates oil (stb/d), water (stb/d), gas (Mscf/d).
Returns density (lb/ft3), in-situ volume rate (ft3/d) and viscosity (cP).
"""
function noslip_mixture(p, qo, qw, qg)
    qo_e = max(qo, 1e-9)                                  # keeps the composition defined as the well dies
    rs = min(tab(SPE1_OIL, 2, 1, p), qg / qo_e)           # gas that stays dissolved at this pressure
    Vo = qo_e * tab(SPE1_OIL, 1, 3, rs)                   # rb/d
    Vg = max(qg - qo_e * rs, 0.0) * tab(SPE1_GAS, 1, 2, p)
    Vw = qw * SPE1_BW
    mass = qo_e * FT3_PER_BBL * SPE1_RHO_OIL + qg * 1000 * SPE1_RHO_GAS + qw * FT3_PER_BBL * SPE1_RHO_WATER   # lb/d
    V = (Vo + Vg + Vw) * FT3_PER_BBL
    mu = (Vo * tab(SPE1_OIL, 1, 4, rs) + Vg * tab(SPE1_GAS, 1, 3, p) + Vw * SPE1_MUW) / (Vo + Vg + Vw)
    mass_gas = max(qg - qo_e * rs, 0.0) * 1000 * SPE1_RHO_GAS                                              # free gas only
    rho_gas = Vg > 0 ? mass_gas / (Vg * FT3_PER_BBL) : zero(mass / V)
    rho_liquid = (mass - mass_gas) / ((Vo + Vw) * FT3_PER_BBL)
    return (rho = mass / V, V = V, mu = mu, Vg = Vg, Vtot = Vo + Vg + Vw, rho_gas = rho_gas, rho_liquid = rho_liquid)
end

"""
Gas fraction of the pipe cross-section when gas slips past liquid (drift flux, vertical pipe):
    alpha = v_sg / (C0 v_m + v_d),   C0 = 1.2,   v_d = 0.35 sqrt(g D)
`v_sg` is the gas volume flux and `v_m` the total volume flux (m/s). This is the Nicklin slug-flow
relation; one flow pattern is assumed at every depth and rate. With C0 = 1 and v_d = 0 it is the
no-slip fraction v_sg / v_m.
"""
slip_gas_fraction(v_sg, v_m, D; C0 = 1.2, drift = 0.35) = v_sg / (C0 * v_m + drift * sqrt(G_ACC * D))

"Pressure gradient going down the tubing: psi per ft of depth (weight) and psi per ft of pipe (friction)."
function noslip_gradient(p, qo, qw, qg; id_in, roughness_in = 0.0006, slip = false, C0 = 1.2, drift = 0.35)
    m = noslip_mixture(p, qo, qw, qg)
    D = id_in * INCH
    v = m.V * FT^3 / DAY / (pi * D^2 / 4)                 # m/s
    rho = m.rho * LB_FT3
    f = friction_factor(rho * v * D / (m.mu * 1e-3), roughness_in / id_in)
    weight = m.rho / 144
    if slip && m.Vg > 0
        # liquid holds up: the column carries less gas than the flowing mixture does
        alpha = slip_gas_fraction(v * m.Vg / m.Vtot, v, D; C0 = C0, drift = drift)
        weight = (alpha * m.rho_gas + (1 - alpha) * m.rho_liquid) / 144
    end
    return (weight = weight, friction = f * rho * v^2 / (2 * D) * FT / PSI)
end

"""
    noslip_bhp(p_top, qo, qw, qg; depth_ft, length_ft = depth_ft, id_in, roughness_in, nseg = 60)

Bottom-hole pressure (psia) needed to deliver the surface rates against `p_top` at the top of the
tubing, by marching down the tubing (midpoint rule).
"""
function noslip_bhp(p_top, qo, qw, qg; depth_ft, length_ft = depth_ft, id_in, roughness_in = 0.0006, nseg = 60, slip = false, C0 = 1.2, drift = 0.35)
    p = p_top + zero(qo + qw + qg)
    dz = depth_ft / nseg; dl = length_ft / nseg
    for _ in 1:nseg
        g1 = noslip_gradient(p, qo, qw, qg; id_in = id_in, roughness_in = roughness_in, slip = slip, C0 = C0, drift = drift)
        pm = p + 0.5 * (g1.weight * dz + g1.friction * dl)
        g2 = noslip_gradient(pm, qo, qw, qg; id_in = id_in, roughness_in = roughness_in, slip = slip, C0 = C0, drift = drift)
        p += g2.weight * dz + g2.friction * dl
    end
    return p
end

"Lift function for `SurfaceSpec(lift = ...)`: no-slip gas-liquid flow of the SPE1 fluid in the tubing."
noslip_lift(; kw...) = (p_node, qo, qw, qg) -> noslip_bhp(p_node, qo, qw, qg; kw...)

"""
Lift function with slip between gas and liquid (drift flux, see `slip_gas_fraction`). It sits
between the liquid-only and the no-slip curves. At low rates the gas fraction goes to zero and the
column is nearly full of liquid, which is how a weak well loads up.
Not a calibrated lift correlation: one flow pattern, vertical pipe, and the constants (1.2 and 0.35)
come from the slug-flow literature through secondary sources.
"""
driftflux_lift(; kw...) = (p_node, qo, qw, qg) -> noslip_bhp(p_node, qo, qw, qg; slip = true, kw...)
