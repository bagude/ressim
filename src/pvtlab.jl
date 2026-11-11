# A laboratory on paper for the built-in live oil (the SPE1 benchmark fluid behind `fluid = "blackoil_spe1"`).
#
# The reservoir model knows this fluid only as black-oil tables: how much gas the oil holds at each
# pressure, and the volumes of oil and gas. The three classic laboratory tests can be read off those
# tables exactly, and that is all this file does:
#   - constant-composition expansion (the cell is opened up, nothing is removed): total volume against pressure;
#   - differential liberation (the freed gas is removed at every step): oil shrinkage and gas released;
#   - separator test: what one barrel of stock-tank oil brings with it.
# What this is not: an equation of state. There are no compositions, so no minimum miscibility pressure, no
# gas injection or huff-n-puff, and the separator test has only the one separator the tables were built for.
# Above the bubble point the oil is given one compressibility (1.369e-5 per psi, the table's value at a
# bubble point of 4,014.7 psia; the table's other branch differs from it by a tenth).

const SPE1_OIL_COMPRESSIBILITY = (1.695 - 1.579) / (9014.7 - 4014.7) / 1.695       # 1/psi, undersaturated branch at Rs = 1.27 Mscf/stb
const WATER_LB_FT3 = 62.366; const AIR_LB_FT3 = 0.0764                             # at standard conditions

"Bubble-point pressure (psia) of oil holding `rs` Mscf of gas per stock-tank barrel."
bubble_point(rs) = tab(SPE1_OIL, 1, 2, rs)

"Black-oil properties at pressure `p` (psia) of a sample whose total gas content is `rs_total` (Mscf/stb): dissolved gas, oil and gas volume factors, free gas."
function blackoil_state(p, rs_total)
    pb = bubble_point(rs_total)
    if p >= pb
        return (rs = rs_total, bo = tab(SPE1_OIL, 1, 3, rs_total) * (1 - SPE1_OIL_COMPRESSIBILITY * (p - pb)), bg = tab(SPE1_GAS, 1, 2, p), free_gas = 0.0, pb = pb)
    end
    rs = tab(SPE1_OIL, 2, 1, p)
    return (rs = rs, bo = tab(SPE1_OIL, 2, 3, p), bg = tab(SPE1_GAS, 1, 2, p), free_gas = rs_total - rs, pb = pb)
end

"""
    cce_test(; rs = 1.27, pressures)

Constant-composition expansion of a sample with `rs` Mscf/stb of gas. For each pressure (psia): relative
volume (total volume over the volume at the bubble point), the oil and free-gas volumes per stock-tank
barrel (rb), the oil density (lb/ft3), and below the bubble point the Y-function
(pb - p) / (p (relative volume - 1)).
"""
function cce_test(; rs = 1.27, pressures = [9014.7, 7014.7, 5014.7, 4014.7, 3514.7, 3014.7, 2514.7, 2014.7, 1514.7, 1014.7])
    pb = bubble_point(rs); vb = blackoil_state(pb, rs).bo
    rows = map(pressures) do p
        s = blackoil_state(p, rs); vg = s.free_gas * s.bg
        (pressure_psia = p, relative_volume = (s.bo + vg) / vb, oil_rb = s.bo, gas_rb = vg,
            oil_density_lb_ft3 = (SPE1_RHO_OIL * FT3_PER_BBL + s.rs * 1000 * SPE1_RHO_GAS) / (s.bo * FT3_PER_BBL),
            y_function = p < pb ? (pb - p) / (p * ((s.bo + vg) / vb - 1)) : NaN)
    end
    return (bubble_point_psia = pb, rows = rows)
end

"""
    differential_liberation(; rs = 1.27, pressures)

Differential liberation from the bubble point down to atmospheric pressure, reported the way a
laboratory does, per barrel of RESIDUAL oil (the oil left at 14.7 psia and reservoir temperature):
gas still in solution `rsd` (scf per residual barrel), oil volume `bod`, total volume `btd`, gas volume
factor (rb/Mscf), and the gas released in each step.
"""
function differential_liberation(; rs = 1.27, pressures = [3514.7, 3014.7, 2514.7, 2014.7, 1514.7, 1014.7, 514.7, 264.7, 14.7])
    pb = bubble_point(rs); steps = vcat(pb, filter(<(pb), sort(pressures; rev = true)))
    steps[end] == 14.7 || push!(steps, 14.7)
    residual = tab(SPE1_OIL, 2, 3, 14.7); rs_res = tab(SPE1_OIL, 2, 1, 14.7); prev = rs
    rows = map(steps) do p
        s = blackoil_state(p, rs); released = (prev - s.rs) * 1000 / residual; prev = s.rs
        (pressure_psia = p, rsd_scf_bbl = (s.rs - rs_res) * 1000 / residual, bod = s.bo / residual, btd = (s.bo + (rs - s.rs) * s.bg) / residual,
            bg_rb_mscf = s.bg, gas_released_scf_bbl = released,
            oil_density_lb_ft3 = (SPE1_RHO_OIL * FT3_PER_BBL + s.rs * 1000 * SPE1_RHO_GAS) / (s.bo * FT3_PER_BBL))
    end
    return (bubble_point_psia = pb, residual_oil_rb_stb = residual, gas_gravity = SPE1_RHO_GAS / AIR_LB_FT3, rows = rows)
end

"""
    separator_test(; rs = 1.27)

What one stock-tank barrel carries at the bubble point, as the tables define it: gas-oil ratio (scf/stb),
formation volume factor (rb/stb), stock-tank oil gravity (API) and gas gravity (air = 1). Black-oil tables
are built for one separator, so there are no separator conditions to vary.
"""
function separator_test(; rs = 1.27)
    pb = bubble_point(rs)
    return (bubble_point_psia = pb, gor_scf_stb = rs * 1000, bo_rb_stb = blackoil_state(pb, rs).bo, oil_gravity_api = 141.5 / (SPE1_RHO_OIL / WATER_LB_FT3) - 131.5,
        gas_gravity = SPE1_RHO_GAS / AIR_LB_FT3)
end
