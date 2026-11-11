# Multi-stage fractured horizontal well: geometry in, ECLIPSE-format deck out.
#
# The fractures are an INPUT here (position, half-length, conductivity per stage). Nothing in this
# file predicts how a fracture grows. Each fracture is a plane of high-permeability cells of declared
# physical width; its conductivity (md-ft) is honoured exactly whatever the cell width.
# The lateral is frictionless: every stage produces at the same bottom-hole pressure. Each stage is
# written as its own well so the summary reports stages separately.
# Idealisations to state when quoting results: by default one layer with fully penetrating fractures
# (layers, dip and a limited fracture height are optional, see `layers` in the spec), fracture
# porosity equal to the rock, a declared non-limiting well-to-fracture connection, no fracture
# conductivity loss with pressure unless asked for.

const FT = 0.3048

"Mesh presets, all in feet: first cell beside the fracture, growth factor, largest cell, row height along the fracture."
const FRAC_MESH = Dict(
    "coarse" => (first = 1.0, growth = 1.6, cap = 40.0, dy = 20.0),
    "standard" => (first = 0.3, growth = 1.4, cap = 20.0, dy = 10.0),
    "fine" => (first = 0.1, growth = 1.3, cap = 10.0, dy = 5.0),
    "screening" => (first = 2.0, growth = 1.8, cap = 80.0, dy = 40.0),     # for batches of runs; see `fast_spec` for what it costs in accuracy
)

Base.@kwdef struct FracWellSpec
    name::String = "fracwell"
    # reservoir (field units)
    thickness_ft::Float64 = 100.0
    width_ft::Float64 = 1300.0             # perpendicular to the lateral; the well runs down the middle
    perm_md::Float64 = 5e-4
    porosity::Float64 = 0.08
    top_ft::Float64 = 9000.0
    pressure_psi::Float64 = 5000.0
    rock_compressibility::Float64 = 4e-6   # 1/psi
    # well and stages
    bhp_psi::Float64 = 1500.0
    positions_ft::Vector{Float64} = [100.0, 300.0, 500.0]   # along the lateral
    half_length_ft::Vector{Float64} = [250.0, 250.0, 250.0]
    conductivity_mdft::Vector{Float64} = [50.0, 50.0, 50.0]
    # optional, per stage: multipliers on the conductivity at equal steps from the well (first) to the tip (last)
    conductivity_shape::Vector{Vector{Float64}} = Vector{Float64}[]
    # optional, per stage: where across the model the stage's wellbore sits (ft from one side). Empty = the middle.
    # Giving two groups of stages different values models two laterals in the same rock, so they interfere.
    center_ft::Vector{Float64} = Float64[]
    # optional, per stage: where the lateral crosses the stage's fracture (ft from the same side of the model). Empty = at the
    # fracture's middle (`center_ft`). A lopsided fracture (a child well's, see `design_child_well`) has its well off the middle:
    # the longer wing then has further to carry its oil. `conductivity_shape` is read from the well to each tip, wing by wing;
    # `conductivity_shape_minus`, if given, is the profile of the wing towards smaller y (the other profile then serves the wing
    # towards larger y only).
    lateral_ft::Vector{Float64} = Float64[]
    conductivity_shape_minus::Vector{Vector{Float64}} = Vector{Float64}[]
    # Fracture conductivity that falls as the fracture is drawn down: multiplier exp(-loss * (initial pressure - pressure in the
    # fracture cell)), never below `conductivity_floor`. 0 = off. Unless `conductivity_loss_reversible`, the loss is permanent:
    # the multiplier follows the LOWEST pressure the cell has seen. (Engine feature: ROCKCOMP / ROCKTAB / ROCKNUM in the deck.)
    conductivity_loss_per_psi::Float64 = 0.0
    conductivity_loss_reversible::Bool = false
    conductivity_floor::Float64 = 0.05
    # Rock that varies across the model. Each is `nothing` (use the single value above) or a function (x, y) -> value, with x the
    # position along the lateral (the same coordinate as `positions_ft`) and y the distance across the model, both in feet.
    # `net_thickness_map` gives net pay; `thickness_ft` is then the gross thickness and the deck carries net-to-gross.
    # `sw_map` gives water saturation; the water is taken as immobile, so it only reduces the pore volume that holds oil.
    # See `well_maps` (geology.jl) for building these from a `Geology`.
    porosity_map::Any = nothing
    perm_map::Any = nothing
    net_thickness_map::Any = nothing
    sw_map::Any = nothing
    # Optional, per stage: which well (1, 2, ...) the stage belongs to. Used by the surface and field drivers, where every well
    # produces through one wellbore: all stages of a well then share one bottom-hole pressure. Empty = one well. Give the wells
    # different `center_ft` to put them side by side in the same rock.
    well_of_stage::Vector{Int} = Int[]
    # Optional, per stage: the month in which the stage starts producing (0 = from the beginning). A stage that starts later does not
    # exist until then: no fracture, no well. The run is split at every start and the reservoir state is carried across, so a later
    # (child) stage sees the depletion and free gas left by the earlier (parent) ones, and the parents feel the child.
    start_month::Vector{Int} = Int[]
    # Faults crossing the model: a list of (points = [(x, y), ...], multiplier = m) in the same coordinates as the maps. Flow between two
    # neighbouring cells is multiplied by m when the line between their centres crosses the trace (0 seals). See `well_faults` (structure.jl).
    fault_traces::Any = nothing
    # Layers and depth (all optional; with none of them set the model is one flat layer, as it always was).
    # `layers`: the rock from top to bottom, a list of (thickness_ft = , perm_md = , porosity = ) with optional `kv_over_kh` and `sw`
    #   (immobile water, as `sw_map`). Each entry is one grid layer: split a thick layer into several entries where the fracture
    #   height or the vertical flow matters (`split_layers`). `thickness_ft`, `perm_md` and `porosity` above are then not used.
    # `kv_over_kh`: vertical over horizontal permeability of the rock, for layers that do not give their own.
    # `landing_ft`: depth of the lateral below the top of the stack (NaN = the middle).
    # `fracture_above_ft`, `fracture_below_ft`: per stage, how far the conductive fracture reaches above and below the lateral
    #   (empty = to the top / to the base). A grid layer partly covered carries that share of the conductivity.
    # `fracture_layer_share`: per stage, a multiplier on the conductivity for every layer (0 = the fracture does not conduct there).
    #   Replaces the two reaches above; this is how a proppant bank that fills the layers unevenly is described (`design_well`).
    # `well_connection`: "full_height" joins the well to its fracture in every layer the fracture covers (no loss inside the
    #   fracture on the way to the wellbore, as in the one-layer model); "landing_layer" joins it only in the lateral's own layer, so
    #   fluid from other layers has to converge through the fracture (resolved only as finely as the layers are).
    # `dip_deg`: dip across the model (deeper towards larger y); `dip_along_deg`: along the lateral (deeper towards larger x).
    # With any of these set, `top_ft` is the top of the stack at the middle of the model, `pressure_psi` is the pressure at the
    # lateral's depth there, the model starts in gravity equilibrium, and `bhp_psi` is at each well's own depth.
    # Engine defect to know about (GeoEnergyIO 2026-11, cell_centers_from_deltas): with cells of unequal width it applies each
    # cell's top (width of the cell - width of the first cell) / 2 away from the cell. The deck written here is the standard one;
    # in this engine a dipping model's depths are therefore off by up to that distance times the dip (a fraction of a foot).
    # Rock maps together with layers: the maps are the areal trend, the layers the vertical profile. `perm_map` and `porosity_map`
    # scale every layer by map value / the spec's single value (`perm_md`, `porosity`); `net_thickness_map` gives net pay out of
    # the whole stack, taken as the same share of every layer; `sw_map` applies to layers that give no `sw` of their own.
    layers::Vector{Any} = Any[]
    kv_over_kh::Float64 = 0.1
    landing_ft::Float64 = NaN
    fracture_above_ft::Vector{Float64} = Float64[]
    fracture_below_ft::Vector{Float64} = Float64[]
    fracture_layer_share::Vector{Vector{Float64}} = Vector{Float64}[]
    well_connection::String = "full_height"
    dip_deg::Float64 = 0.0
    dip_along_deg::Float64 = 0.0
    # Frac fluid left behind by the job (flowback). `frac_water_bbl`: per stage, the barrels of water the job left in the rock beside
    # the fracture as modelled (both wings). It starts as water in the cells next to the fracture, filled outward from the
    # fracture up to 1 - sor, and the water can then flow: back to the well, or deeper into the rock. Empty = no frac water, and
    # the model's water is immobile as before. `water_relperm`: Corey curves for water against oil, (swc, sor, nw, no, krw_max)
    # with optional capillary pressure (pc_entry_psi, pc_lambda; 0 = none), or `nothing` for the defaults below. The model starts
    # at swc everywhere else. One-layer models only for now. The water at the wellhead in the first days includes what stood in the
    # engine's wellbore; `water_from_rock` separates the two.
    frac_water_bbl::Vector{Float64} = Float64[]
    water_relperm::Any = nothing
    water_viscosity_cp::Float64 = 0.5
    edge_ft::Float64 = 100.0               # rock beyond the first and last stage
    # Width of the fracture cells (conductivity is preserved). The cell holds rock pore volume at the fracture's pressure, so a wide
    # cell gives up fluid, gas above all, too early: 2 ft (the default until 2026-11-10) reads 1.6% high on first-month oil and 7% on
    # first-month gas at 0.005 md, 3.5% and 22% at 0.0005 md. The error is proportional to the width; 0.1 ft leaves 0.1% and 0.3%.
    fracture_width_ft::Float64 = 0.1
    connection_multiple::Float64 = 30.0    # well connection = this many along-fracture cell transmissibilities
    # fluid: "blackoil_spe1" (illustrative live oil, gas, connate water), "oil" (constant-compressibility oil), or "drygas"
    # (dry gas with the same illustrative gas table, 20% connate water that does not move; one layer, fixed bottom-hole
    # pressure or a pressure schedule only: no oil-rate targets, no flowback, no tubing or field drivers yet)
    fluid::String = "blackoil_spe1"
    initial_rs::Float64 = 1.27             # Mscf/stb, blackoil_spe1 only (bubble point 4,014.7 psia)
    oil_compressibility::Float64 = 3e-6    # 1/psi, "oil" only
    oil_viscosity_cp::Float64 = 1.0        # "oil" only
    # schedule and mesh
    months::Int = 24
    dt_first_days::Float64 = 0.001
    dt_growth::Float64 = 1.25
    dt_max_days::Float64 = 2.5
    mesh::String = "standard"
end

const MONTH_DAYS = 30.4375

"Load a spec from TOML. Scalars given for per-stage quantities are repeated for every stage."
function load_fracwell(path)
    d = TOML.parsefile(path)
    n = haskey(d, "positions_ft") ? length(d["positions_ft"]) : get(d, "stages", 3)
    if !haskey(d, "positions_ft")
        sp = Float64(get(d, "spacing_ft", 200.0))
        d["positions_ft"] = [sp / 2 + (i - 1) * sp for i in 1:n]
        haskey(d, "edge_ft") || (d["edge_ft"] = sp / 2)
    end
    for k in ("half_length_ft", "conductivity_mdft")
        v = get(d, k, getfield(FracWellSpec(), Symbol(k))[1])
        d[k] = v isa AbstractVector ? Float64.(v) : fill(Float64(v), n)
    end
    delete!(d, "stages"); delete!(d, "spacing_ft")
    kw = Dict{Symbol, Any}()
    for (k, v) in d
        T = fieldtype(FracWellSpec, Symbol(k))
        kw[Symbol(k)] = k == "layers" ? Any[(; (Symbol(a) => Float64(b) for (a, b) in l)...) for l in v] :
                        T == Vector{Vector{Float64}} ? [Float64.(x) for x in v] : T <: Vector ? Float64.(v) : convert(T, v)
    end
    return FracWellSpec(; kw...)
end

function graded(len; first, growth, cap)
    w = Float64[]; x = first
    while sum(w; init = 0.0) + min(x, cap) < len - 1e-9
        push!(w, min(x, cap)); x *= growth
    end
    rem = len - sum(w; init = 0.0)
    (isempty(w) || rem > 0.5 * w[end]) ? push!(w, rem) : (w[end] += rem)
    w .*= len / sum(w)
    return w
end

"Mesh and fracture layout for a spec: cell widths, fracture column per stage, fracture rows per stage."
function fracwell_layout(s::FracWellSpec)
    m = FRAC_MESH[s.mesh]
    n = length(s.positions_ft)
    @assert length(s.half_length_ft) == n && length(s.conductivity_mdft) == n "one half-length and one conductivity per stage"
    isempty(s.center_ft) || length(s.center_ft) == n || error("center_ft needs one value per stage")
    wc = s.fracture_width_ft
    ux = sort(unique(s.positions_ft))                         # stages of different laterals may share a position
    nu = length(ux)
    x0 = ux[1] - s.edge_ft
    bounds = vcat(x0, [0.5 * (ux[i] + ux[i+1]) for i in 1:nu-1], ux[end] + s.edge_ft)
    dx = Float64[]; ucol = Int[]
    for i in 1:nu
        left = graded(ux[i] - wc / 2 - bounds[i]; first = m.first, growth = m.growth, cap = m.cap)
        right = graded(bounds[i+1] - ux[i] - wc / 2; first = m.first, growth = m.growth, cap = m.cap)
        append!(dx, reverse(left)); push!(dx, wc); push!(ucol, length(dx)); append!(dx, right)
    end
    icol = [ucol[findfirst(==(x), ux)] for x in s.positions_ft]
    # rows along the fractures: every fracture tip and every well row fall on row boundaries, so the
    # half-length on the mesh is the half-length asked for (clamped to the edges of the model)
    cen = isempty(s.center_ft) ? fill(s.width_ft / 2, n) : s.center_ft
    all(0 .< cen .< s.width_ft) || error("every stage's center_ft must lie inside the model width")
    half = [min(s.half_length_ft[i], cen[i], s.width_ft - cen[i]) for i in 1:n]
    dyw = min(m.dy, 2 * minimum(half))
    isempty(s.lateral_ft) || length(s.lateral_ft) == n || error("lateral_ft needs one value per stage")
    # the row the well sits in: centred on the lateral, kept inside the fracture
    wrow = isempty(s.lateral_ft) ? cen : [clamp(s.lateral_ft[i], cen[i] - half[i] + dyw / 2, cen[i] + half[i] - dyw / 2) for i in 1:n]
    isempty(s.lateral_ft) || all(i -> cen[i] - half[i] - 1e-6 <= s.lateral_ft[i] <= cen[i] + half[i] + 1e-6, 1:n) || error("every lateral_ft must lie inside its stage's fracture")
    bps = [0.0, s.width_ft]
    for i in 1:n
        append!(bps, [wrow[i] - dyw / 2, wrow[i] + dyw / 2])
        half[i] > dyw / 2 + 1e-9 && append!(bps, [cen[i] - half[i], cen[i] + half[i]])
    end
    bps = sort(unique(round.(clamp.(bps, 0.0, s.width_ft), digits = 9)))
    dy = Float64[]
    for k in 1:length(bps)-1
        len = bps[k+1] - bps[k]
        nrow = max(1, round(Int, len / m.dy))
        append!(dy, fill(len / nrow, nrow))
    end
    ny = length(dy)
    yc = cumsum(dy) .- dy ./ 2
    jws = [argmin(abs.(yc .- wrow[i])) for i in 1:n]
    rows = [findall(y -> abs(y - cen[i]) <= half[i] + 1e-9, yc) for i in 1:n]
    eff_half = [sum(dy[r]) / 2 for r in rows]                # half-length actually on the mesh
    return (dx = dx, dy = dy, icol = icol, jw = jws[1], jws = jws, rows = rows, eff_half_ft = eff_half, nx = length(dx), ny = ny, center_ft = cen, lateral_ft = wrow)
end

"Layers no thicker than `max_ft`: every entry of `layers` is cut into equal parts (same rock), top to bottom."
function split_layers(layers; max_ft = 20.0)
    out = Any[]
    for l in layers
        m = max(1, ceil(Int, l.thickness_ft / max_ft - 1e-9))
        for _ in 1:m
            push!(out, merge(l, (thickness_ft = l.thickness_ft / m,)))
        end
    end
    return out
end

"""
Vertical make-up of a spec's model: layer thicknesses and rock, the lateral's depth and layer, and the share of
every layer that each stage's fracture covers. `layered` is false when no layer or depth option is set; the deck
is then the one-layer deck, unchanged.
"""
function fracwell_vertical(s::FracWellSpec)
    n = length(s.positions_ft)
    lay = isempty(s.layers) ? Any[(thickness_ft = s.thickness_ft, perm_md = s.perm_md, porosity = s.porosity)] : s.layers
    val(l, k, d) = Float64(get(l, k, d))
    dz = [val(l, :thickness_ft, NaN) for l in lay]; all(x -> x > 0, dz) || error("every layer needs a positive thickness_ft")
    perm = [val(l, :perm_md, s.perm_md) for l in lay]; poro = [val(l, :porosity, s.porosity) for l in lay]
    kvkh = [val(l, :kv_over_kh, s.kv_over_kh) for l in lay]; sw = [val(l, :sw, NaN) for l in lay]
    all(>(0), perm) && all(x -> 0 < x < 1, poro) && all(>=(0), kvkh) || error("layers need positive perm_md, porosity between 0 and 1, and kv_over_kh of zero or more")
    nz = length(dz); H = sum(dz); ztop = cumsum(dz) .- dz
    land = isnan(s.landing_ft) ? H / 2 : s.landing_ft
    0 <= land <= H || error("landing_ft must lie inside the layer stack (0 to $(H) ft)")
    k_land = something(findfirst(k -> land < ztop[k] + dz[k] - 1e-9, 1:nz), nz)
    ab = s.fracture_above_ft; be = s.fracture_below_ft
    (isempty(ab) || length(ab) == n) && (isempty(be) || length(be) == n) || error("fracture_above_ft and fracture_below_ft need one value per stage")
    cover = ones(n, nz)
    for i in 1:n
        zt = isempty(ab) ? 0.0 : max(land - ab[i], 0.0); zb = isempty(be) ? H : min(land + be[i], H)
        zb > zt || error("stage $i: the fracture has no height (fracture_above_ft + fracture_below_ft must be positive)")
        for k in 1:nz
            cover[i, k] = clamp((min(zb, ztop[k] + dz[k]) - max(zt, ztop[k])) / dz[k], 0.0, 1.0)
        end
    end
    sh = s.fracture_layer_share
    if !isempty(sh)
        isempty(ab) && isempty(be) || error("give either fracture_layer_share or the reaches above and below, not both")
        length(sh) == n && all(x -> length(x) == nz && all(>=(0), x), sh) || error("fracture_layer_share needs, for every stage, one value of zero or more per layer")
        for i in 1:n
            any(>(0), sh[i]) || error("stage $i: fracture_layer_share is zero in every layer")
            cover[i, :] .= sh[i]
        end
    end
    s.well_connection in ("full_height", "landing_layer") || error("well_connection must be \"full_height\" or \"landing_layer\"")
    if s.well_connection == "landing_layer"
        for i in 1:n
            cover[i, k_land] > 0 || error("stage $i: well_connection = \"landing_layer\" but the fracture does not conduct in the lateral's own layer ($k_land); use \"full_height\" or change the fracture")
        end
    end
    layered = !isempty(s.layers) || s.dip_deg != 0 || s.dip_along_deg != 0 || !isempty(ab) || !isempty(be) || !isempty(sh) || s.well_connection != "full_height"
    return (nz = nz, dz = dz, perm = perm, poro = poro, kvkh = kvkh, sw = sw, height_ft = H, landing_ft = land, k_land = k_land, cover = cover, layered = layered)
end

"""
    well_dip(S, spec; origin_ft, azimuth_deg)

`well_dip` for the model a spec describes: its width, and its length from the first stage less `edge_ft` to the
last stage plus `edge_ft`. `origin_ft` is the map position of the point on the lateral where the spec's
`positions_ft` would be zero.
"""
well_dip(S::Structure, s::FracWellSpec; origin_ft, azimuth_deg = 0.0, kw...) = well_dip(S; origin_ft = origin_ft, azimuth_deg = azimuth_deg, width_ft = s.width_ft,
    start_ft = minimum(s.positions_ft) - s.edge_ft, length_ft = maximum(s.positions_ft) - minimum(s.positions_ft) + 2 * s.edge_ft, kw...)

fmt_vals(v; per = 8) = join([join([@sprintf("%.9g", x) for x in v[i:min(i + per - 1, end)]], " ") for i in 1:per:length(v)], "\n")

const PROPS_SPE1 = """
PVTW
 4017.55 1.038 3.22E-6 0.318 0.0 /
SWOF
0.12 0 1 0
0.18 4.64876033057851E-008 1 0
0.24 0.000000186 0.997 0
0.3 4.18388429752066E-007 0.98 0
0.36 7.43801652892562E-007 0.7 0
0.42 1.16219008264463E-006 0.35 0
0.48 1.67355371900826E-006 0.2 0
0.54 2.27789256198347E-006 0.09 0
0.6 2.97520661157025E-006 0.021 0
0.66 3.7654958677686E-006 0.01 0
0.72 4.64876033057851E-006 0.001 0
0.78 0.000005625 0.0001 0
0.84 6.69421487603306E-006 0 0
0.91 8.05914256198347E-006 0 0
1 0.00001 0 0 /
SGOF
0 0 1 0
0.001 0 1 0
0.02 0 0.997 0
0.05 0.005 0.980 0
0.12 0.025 0.700 0
0.2 0.075 0.350 0
0.25 0.125 0.200 0
0.3 0.190 0.090 0
0.4 0.410 0.021 0
0.45 0.60 0.010 0
0.5 0.72 0.001 0
0.6 0.87 0.0001 0
0.7 0.94 0.000 0
0.85 0.98 0.000 0
0.88 0.984 0.000 0 /
DENSITY
 53.66 64.49 0.0533 /
PVDG
14.700 166.666 0.008000
264.70 12.0930 0.009600
514.70 6.27400 0.011200
1014.7 3.19700 0.014000
2014.7 1.61400 0.018900
2514.7 1.29400 0.020800
3014.7 1.08000 0.022800
4014.7 0.81100 0.026800
5014.7 0.64900 0.030900
9014.7 0.38600 0.047000 /
PVTO
0.0010 14.7 1.0620 1.0400 /
0.0905 264.7 1.1500 0.9750 /
0.1800 514.7 1.2070 0.9100 /
0.3710 1014.7 1.2950 0.8300 /
0.6360 2014.7 1.4350 0.6950 /
0.7750 2514.7 1.5000 0.6410 /
0.9300 3014.7 1.5650 0.5940 /
1.2700 4014.7 1.6950 0.5100
 9014.7 1.5790 0.7400 /
1.6180 5014.7 1.8270 0.4490
 9014.7 1.7370 0.6310 /
/
"""

"Corey curves for water against oil, with the spec's choices or the defaults (connate water as the fluid's own table has it)."
function water_curves(s::FracWellSpec)
    d = (swc = s.fluid == "blackoil_spe1" ? 0.12 : 0.2, sor = 0.25, nw = 2.0, no = 2.0, krw_max = 0.3, pc_entry_psi = 0.0, pc_lambda = 2.0)
    w = isnothing(s.water_relperm) ? d : merge(d, s.water_relperm)
    0 <= w.swc < 1 - w.sor < 1 && w.nw > 0 && w.no > 0 && 0 < w.krw_max <= 1 && w.pc_entry_psi >= 0 && w.pc_lambda > 0 || error("water_relperm: need 0 <= swc < 1 - sor < 1, positive exponents, krw_max in (0, 1], pc_entry_psi >= 0")
    return w
end

"The SWOF table (water saturation, krw, kro, capillary pressure in psi) of `water_curves`, as deck text."
function swof_text(w; rows = 26)
    io = IOBuffer(); println(io, "SWOF")
    for k in 0:rows-1
        se = k / (rows - 1); sw = w.swc + se * (1 - w.sor - w.swc)
        pc = w.pc_entry_psi == 0 ? 0.0 : w.pc_entry_psi * max(se, 0.02)^(-1 / w.pc_lambda)      # Brooks-Corey, capped near connate water
        @printf(io, " %.6f %.8g %.8g %.6g\n", sw, w.krw_max * se^w.nw, (1 - se)^w.no, pc)
    end
    @printf(io, " 1 1 0 0 /\n")
    return String(take!(io))
end

"""
Water saturation per cell at the start, with the frac water of every stage placed beside its fracture: the fracture
cells first, then the columns next to them on both sides, each filled to 1 - sor before the next is started. Returns
the saturations and the barrels placed per stage (less than asked for only if the model has no room).
"""
function frac_water_saturation(s::FracWellSpec, L, poro, ntg, isfrac, on)
    w = water_curves(s); nx, ny = L.nx, L.ny
    sw = fill(w.swc, nx, ny); placed = zeros(length(s.positions_ft))
    length(s.frac_water_bbl) == length(s.positions_ft) || error("frac_water_bbl needs one value per stage")
    room(i, j) = poro[i, j] * ntg[i, j] * L.dx[i] * L.dy[j] * s.thickness_ft * (1 - w.sor - sw[i, j]) / 5.614583333      # barrels of water the cell can still take
    for st in eachindex(s.positions_ft)
        (on(st) && s.frac_water_bbl[st] > 0) || continue
        rows = L.rows[st]; c = L.icol[st]; total = sum(L.dy[rows])
        for j in rows
            left = s.frac_water_bbl[st] * L.dy[j] / total                # this row's share: spread evenly along the fracture
            for k in 0:max(c - 1, nx - c)                                # the fracture cell, then outward on both sides
                # this ring's cells: the fracture cell itself, or the two cells k columns away (not another stage's fracture)
                cols = k == 0 ? [c] : [i for i in (c - k, c + k) if 1 <= i <= nx && !isfrac[i, j]]
                for (m, i) in enumerate(cols)
                    take = min(left / (length(cols) - m + 1), room(i, j))          # an even split of what is left over the cells still to fill
                    sw[i, j] += take * 5.614583333 / (poro[i, j] * ntg[i, j] * L.dx[i] * L.dy[j] * s.thickness_ft); left -= take; placed[st] += take
                end
                left <= 1e-9 && break
            end
        end
    end
    return sw, placed
end

"Report-step lengths in days: a ramp from `dt_first`, then steps no longer than `dt_max`, month ends always on a step."
function fracwell_tstep(s::FracWellSpec)
    dt = Float64[]; t = 0.0; x = s.dt_first_days
    while t + x < MONTH_DAYS && x < s.dt_max_days
        push!(dt, x); t += x; x *= s.dt_growth
    end
    left = MONTH_DAYS - t
    n = ceil(Int, left / s.dt_max_days - 1e-12); append!(dt, fill(left / n, n))
    nm = ceil(Int, MONTH_DAYS / s.dt_max_days - 1e-12)
    for _ in 2:s.months
        append!(dt, fill(MONTH_DAYS / nm, nm))
    end
    return dt
end

"Write the ECLIPSE-format deck for a spec. Returns the layout used."
function write_fracwell_deck(s::FracWellSpec, path; bhp_schedule = nothing, oil_rate_target = nothing, single_well = false, active = nothing, rate_schedule = nothing, step_days = nothing)
    # rate_schedule: a list of (step length in days, oil rate in stb/d), one entry per report step; replaces the spec's own time steps
    on(i) = isnothing(active) || active[i]              # stages not yet started have no fracture and no well
    L = fracwell_layout(s)
    nx, ny = L.nx, L.ny; nc = nx * ny
    n = length(s.positions_ft)
    V = fracwell_vertical(s); nz = V.nz; layered = V.layered
    perm = fill(s.perm_md, nx, ny); isfrac = falses(nx, ny)
    # cell centres in the spec's own coordinates: x along the lateral as in `positions_ft`, y across the model
    xc_map = (minimum(s.positions_ft) - s.edge_ft) .+ cumsum(L.dx) .- L.dx ./ 2; yc_map = cumsum(L.dy) .- L.dy ./ 2
    mapped = !all(isnothing, (s.porosity_map, s.perm_map, s.net_thickness_map, s.sw_map))
    sw_ref = s.fluid == "blackoil_spe1" ? 0.12 : s.fluid == "drygas" ? 0.2 : 0.0      # the uniform water saturation the deck starts with
    poro = fill(s.porosity, nx, ny); ntg = ones(nx, ny)
    if mapped
        for j in 1:ny, i in 1:nx
            x = xc_map[i]; y = yc_map[j]
            isnothing(s.perm_map) || (perm[i, j] = s.perm_map(x, y))
            isnothing(s.porosity_map) || (poro[i, j] = s.porosity_map(x, y))
            if !isnothing(s.sw_map)                                      # immobile water: only the oil-filled share of the pores is modelled
                sw = s.sw_map(x, y); 0 <= sw < 1 || error("sw_map must return values in [0, 1)")
                poro[i, j] *= (1 - sw) / (1 - sw_ref)
            end
            if !isnothing(s.net_thickness_map)
                gross = isempty(s.layers) ? s.thickness_ft : V.height_ft
                net = s.net_thickness_map(x, y); 0 < net <= gross * (1 + 1e-9) || error("net_thickness_map must return values between 0 and the gross thickness (thickness_ft, or the sum of the layers)")
                ntg[i, j] = min(net / gross, 1.0)
            end
        end
        all(>(0), perm) && all(x -> 0 < x < 1, poro) || error("mapped permeability must be positive and mapped porosity between 0 and 1")
    end
    isempty(s.conductivity_shape) || length(s.conductivity_shape) == n || error("conductivity_shape needs one profile per stage")
    isempty(s.conductivity_shape_minus) || (length(s.conductivity_shape_minus) == n && !isempty(s.conductivity_shape)) || error("conductivity_shape_minus needs one profile per stage, and conductivity_shape for the other wing")
    isempty(s.conductivity_shape_minus) || !isempty(s.lateral_ft) || error("conductivity_shape_minus is read only when lateral_ft says where the well crosses each fracture; give lateral_ft (the fracture's middle is center_ft)")
    yc = cumsum(L.dy) .- L.dy ./ 2
    perm_rock = copy(perm)                                 # the rock alone, before fractures are written over it
    fcells = Tuple{Int, Int, Float64}[]                    # (stage, row, fracture permeability) of every fracture cell
    for i in 1:n, j in L.rows[i]
        on(i) || continue
        mult = 1.0
        if !isempty(s.conductivity_shape)                 # linear between the given points, well to tip
            sh = s.conductivity_shape[i]; u = 0.0
            if isempty(s.lateral_ft)                        # well at the fracture's middle: one profile, both wings
                u = clamp(abs(yc[j] - L.center_ft[i]) / max(L.eff_half_ft[i], 1e-9), 0.0, 1.0)
            else                                            # well off the middle: each wing from the well to its own tip
                up = yc[j] >= L.lateral_ft[i]
                wing = up ? L.center_ft[i] + L.eff_half_ft[i] - L.lateral_ft[i] : L.lateral_ft[i] - (L.center_ft[i] - L.eff_half_ft[i])
                u = clamp(abs(yc[j] - L.lateral_ft[i]) / max(wing, 1e-9), 0.0, 1.0)
                up || isempty(s.conductivity_shape_minus) || (sh = s.conductivity_shape_minus[i])
            end
            m = length(sh); u *= (m - 1)
            k0 = min(floor(Int, u) + 1, max(m - 1, 1)); f = u - (k0 - 1)
            mult = m == 1 ? sh[1] : sh[k0] + f * (sh[k0+1] - sh[k0])
        end
        perm[L.icol[i], j] = max(mult * s.conductivity_mdft[i] / s.fracture_width_ft, perm[L.icol[i], j])   # never below the rock or another fracture
        isfrac[L.icol[i], j] = true
        push!(fcells, (i, j, mult * s.conductivity_mdft[i] / s.fracture_width_ft))
    end
    # Layers and depth: the same fracture footprint in every layer the fracture covers; a layer partly covered carries that share.
    # Inside the fracture the permeability is the same up and down as along it; in the rock, vertical = kv/kh * horizontal.
    rocknum = [isfrac[k] ? 2 : 1 for k in 1:nc]
    perm3 = zeros(0, 0, 0); permz3 = perm3; poro3 = perm3; tops = Float64[]
    xmid = (xc_map[1] - L.dx[1] / 2 + xc_map[end] + L.dx[end] / 2) / 2
    top_at(x, y) = s.top_ft + (x - xmid) * tand(s.dip_along_deg) + (y - s.width_ft / 2) * tand(s.dip_deg)
    if layered
        sw_ref3 = s.fluid == "blackoil_spe1" ? 0.12 : 0.0
        # areal trend from the maps (1 everywhere without maps): map value over the spec's single value
        ktrend = perm_rock ./ s.perm_md; ptrend = isnothing(s.porosity_map) ? ones(nx, ny) : [s.porosity_map(xc_map[i], yc_map[j]) / s.porosity for i in 1:nx, j in 1:ny]
        swf(i, j, k) = !isnan(V.sw[k]) ? (1 - V.sw[k]) / (1 - sw_ref3) : isnothing(s.sw_map) ? 1.0 : (1 - s.sw_map(xc_map[i], yc_map[j])) / (1 - sw_ref3)
        perm3 = [V.perm[k] * ktrend[i, j] for i in 1:nx, j in 1:ny, k in 1:nz]; permz3 = [V.kvkh[k] * V.perm[k] * ktrend[i, j] for i in 1:nx, j in 1:ny, k in 1:nz]
        poro3 = [V.poro[k] * ptrend[i, j] * swf(i, j, k) for i in 1:nx, j in 1:ny, k in 1:nz]
        all(x -> 0 < x < 1, poro3) || error("porosity after the maps must stay between 0 and 1 in every layer")
        isfrac3 = falses(nx, ny, nz)
        for (i, j, kf) in fcells, k in 1:nz
            V.cover[i, k] > 0 || continue
            c = L.icol[i]; v = kf * V.cover[i, k]
            if v > perm3[c, j, k] || !isfrac3[c, j, k]
                perm3[c, j, k] = max(v, perm3[c, j, k]); permz3[c, j, k] = max(v, permz3[c, j, k])
            end
            isfrac3[c, j, k] = true
        end
        rocknum = [isfrac3[k] ? 2 : 1 for k in 1:nc*nz]
        tops = [top_at(xc_map[i], yc_map[j]) for j in 1:ny for i in 1:nx]
    end
    live = s.fluid == "blackoil_spe1"; drygas = s.fluid == "drygas"
    live || drygas || s.fluid == "oil" || error("unknown fluid '$(s.fluid)'")
    if drygas
        layered && error("the dry-gas fluid is for one-layer models for now")
        isempty(s.frac_water_bbl) || error("flowback (frac_water_bbl) is not available with the dry-gas fluid yet")
        isnothing(oil_rate_target) && isnothing(rate_schedule) || error("a gas well cannot be given an oil-rate target")
    end
    flowback = !isempty(s.frac_water_bbl)
    flowback && layered && error("frac_water_bbl (flowback) is for one-layer models for now")
    sw0 = zeros(0, 0); water_placed = Float64[]; wc = flowback ? water_curves(s) : nothing
    if flowback
        sw0, water_placed = frac_water_saturation(s, L, poro, ntg, isfrac, on)
    end
    live && s.pressure_psi < 4014.7 && error("blackoil_spe1 with initial_rs 1.27 needs initial pressure above its 4,014.7 psia bubble point")
    open(path, "w") do io
        println(io, "-- Generated by Ressim (fracwell). Geometry is an input; no fracture growth is modelled.")
        println(io, "RUNSPEC\nTITLE\n ", s.name, "\nDIMENS\n ", nx, " ", ny, " ", nz, drygas ? " /\nGAS\nWATER" : " /\nOIL\nWATER")
        live && println(io, "GAS\nDISGAS")
        if layered
            println(io, "FIELD\nSTART\n 1 'JAN' 2020 /\nWELLDIMS\n ", n, " ", n * nz, " ", n, " ", n, " /\nTABDIMS\n/\nEQLDIMS\n 1 /")
        else
            println(io, "FIELD\nSTART\n 1 'JAN' 2020 /\nWELLDIMS\n ", n, " ", n, " ", n, " ", n, " /\nTABDIMS\n/")
        end
        lossy = s.conductivity_loss_per_psi > 0
        lossy && println(io, "ROCKCOMP\n '", s.conductivity_loss_reversible ? "REVERS" : "IRREVERS", "' 2 /")
        if layered
            println(io, "GRID\nDXV\n", fmt_vals(L.dx), " /\nDYV\n", fmt_vals(L.dy), " /\nDZV\n", fmt_vals(V.dz), " /")
            println(io, "TOPS\n", fmt_vals(tops), " /\nPORO\n", fmt_vals(vec(poro3)), " /")
            isnothing(s.net_thickness_map) || println(io, "NTG\n", fmt_vals(repeat(vec(ntg), nz)), " /")
        else
            println(io, "GRID\nDXV\n", fmt_vals(L.dx), " /\nDYV\n", fmt_vals(L.dy), " /\nDZV\n ", s.thickness_ft, " /")
        end
        if layered
        elseif mapped
            println(io, "TOPS\n ", nc, "*", s.top_ft, " /\nPORO\n", fmt_vals(vec(poro)), " /")
            isnothing(s.net_thickness_map) || println(io, "NTG\n", fmt_vals(vec(ntg)), " /")
        else
            println(io, "TOPS\n ", nc, "*", s.top_ft, " /\nPORO\n ", nc, "*", s.porosity, " /")
        end
        if layered
            println(io, "PERMX\n", fmt_vals(vec(perm3)), " /\nCOPY\n PERMX PERMY /\n/\nPERMZ\n", fmt_vals(vec(permz3)), " /")
        else
            println(io, "PERMX\n", fmt_vals(vec(perm)), " /\nCOPY\n PERMX PERMY /\n PERMX PERMZ /\n/")
        end
        if !isnothing(s.fault_traces) && !isempty(s.fault_traces)        # MULTX / MULTY act on the face towards the next cell in x / y
            mx = ones(nx, ny); my = ones(nx, ny)
            for j in 1:ny, i in 1:nx
                i < nx && (mx[i, j] = crossing_multiplier(s.fault_traces, xc_map[i], yc_map[j], xc_map[i+1], yc_map[j]))
                j < ny && (my[i, j] = crossing_multiplier(s.fault_traces, xc_map[i], yc_map[j], xc_map[i], yc_map[j+1]))
            end
            println(io, "MULTX\n", fmt_vals(repeat(vec(mx), nz)), " /\nMULTY\n", fmt_vals(repeat(vec(my), nz)), " /")
        end
        println(io, "PROPS\nROCK\n 14.7 ", s.rock_compressibility, " /")
        if lossy          # two rock tables against pressure: pore-volume multiplier (the rock compressibility above) and transmissibility multiplier
            ps = sort(unique(vcat(range(14.7, s.pressure_psi, length = 40), s.pressure_psi + 2000.0)))
            println(io, "ROCKTAB")
            for region in 1:2
                for pv in ps
                    tm = region == 1 || pv >= s.pressure_psi ? 1.0 : max(s.conductivity_floor, exp(-s.conductivity_loss_per_psi * (s.pressure_psi - pv)))
                    @printf(io, " %.4f %.9f %.9f\n", pv, exp(s.rock_compressibility * (pv - 14.7)), tm)
                end
                println(io, "/")
            end
        end
        if live && flowback       # the fluid's own tables, with water that can move: its SWOF and PVTW replaced
            a2 = first(findfirst("SGOF", PROPS_SPE1))             # everything from the gas-oil table on is kept as it is
            println(io, "PVTW\n 4017.55 1.038 3.22E-6 ", s.water_viscosity_cp, " 0.0 /"); print(io, swof_text(wc)); print(io, PROPS_SPE1[a2:end])
        elseif live
            print(io, PROPS_SPE1)
        elseif drygas             # the illustrative gas table of the live-oil fluid on its own; connate water that cannot move
            g1 = first(findfirst("PVDG", PROPS_SPE1)); g2 = first(findfirst("PVTO", PROPS_SPE1))
            println(io, "PVTW\n ", s.pressure_psi, " 1.0 3.0E-6 ", s.water_viscosity_cp, " 0.0 /\nDENSITY\n 53.66 64.49 0.0533 /")
            print(io, PROPS_SPE1[g1:g2-1]); println(io, "SWOF\n 0.2 0 1 0\n 1 1 0 0 /\nSGOF\n 0 0 1 0\n 0.8 1 0 0 /")
        elseif flowback
            println(io, "PVCDO\n ", s.pressure_psi, " 1.0 ", s.oil_compressibility, " ", s.oil_viscosity_cp, " 0.0 /")
            println(io, "PVTW\n ", s.pressure_psi, " 1.0 3.0E-6 ", s.water_viscosity_cp, " 0.0 /")
            print(io, "DENSITY\n 53.66 64.49 0.0533 /\n", swof_text(wc))
        else
            println(io, "PVCDO\n ", s.pressure_psi, " 1.0 ", s.oil_compressibility, " ", s.oil_viscosity_cp, " 0.0 /")
            println(io, "PVTW\n ", s.pressure_psi, " 1.0 ", s.oil_compressibility, " ", s.oil_viscosity_cp, " 0.0 /")
            println(io, "DENSITY\n 53.66 64.49 0.0533 /\nSWOF\n 0 0 1 0\n 1 1 0 0 /")
        end
        lossy && println(io, "REGIONS\nROCKNUM\n", fmt_vals(rocknum), " /")
        if layered     # gravity equilibrium: the pressure asked for at the lateral's depth in the middle of the model, no contacts in the model
            datum = s.top_ft + V.landing_ft
            println(io, "SOLUTION\nEQUIL\n ", datum, " ", s.pressure_psi, " ", datum + 50000.0, " 0 0 0", live ? " 1 0 0" : "", " /")
            live && println(io, "RSVD\n 0 ", s.initial_rs, "\n ", datum + 50000.0, " ", s.initial_rs, " /")
        elseif flowback
            println(io, "SOLUTION\nPRESSURE\n ", nc, "*", s.pressure_psi, " /\nSWAT\n", fmt_vals(vec(sw0)), " /")
            live && println(io, "SGAS\n ", nc, "*0 /\nRS\n ", nc, "*", s.initial_rs, " /")
        elseif drygas
            println(io, "SOLUTION\nPRESSURE\n ", nc, "*", s.pressure_psi, " /\nSWAT\n ", nc, "*0.2 /\nSGAS\n ", nc, "*0.8 /")
        else
            println(io, "SOLUTION\nPRESSURE\n ", nc, "*", s.pressure_psi, " /\nSWAT\n ", nc, "*", live ? 0.12 : 0.0, " /")
            live && println(io, "SGAS\n ", nc, "*0 /\nRS\n ", nc, "*", s.initial_rs, " /")
        end
        println(io, "SUMMARY\nSCHEDULE\nWELSPECS")
        depth = s.top_ft + s.thickness_ft / 2
        well_depth(i) = layered ? top_at(xc_map[L.icol[i]], yc_map[L.jws[i]]) + V.landing_ft : depth
        # default: every stage is its own well (per-stage reporting). single_well: one well, W1, with a
        # connection per stage, which is what a rate target or a tubing condition on the whole lateral needs.
        isempty(s.well_of_stage) || length(s.well_of_stage) == n || error("well_of_stage needs one value per stage")
        wo(i) = isempty(s.well_of_stage) ? 1 : s.well_of_stage[i]
        wname(i) = single_well ? "W" * string(wo(i)) : @sprintf("S%03d", i)
        # single_well: one entry per well (its first active stage stands for it in the well list and the controls)
        wells = single_well ? [findfirst(i -> on(i) && wo(i) == j, 1:n) for j in sort(unique(wo(i) for i in 1:n if on(i)))] : [i for i in 1:n if on(i)]
        for i in wells
            @printf(io, " '%s' 'G' %d %d %.4f '%s' /\n", wname(i), L.icol[i], L.jws[i], well_depth(i), drygas ? "GAS" : "OIL")
        end
        println(io, "/\nCOMPDAT")
        for i in 1:n
            on(i) || continue
            if layered     # one connection per layer the fracture covers, or only the lateral's own layer
                for k in (s.well_connection == "full_height" ? (1:nz) : (V.k_land:V.k_land))
                    V.cover[i, k] > 0 || continue
                    cfk = s.connection_multiple * 0.001127 * s.conductivity_mdft[i] * V.cover[i, k] * V.dz[k] * ntg[L.icol[i], L.jws[i]] / L.dy[L.jws[i]]
                    @printf(io, " '%s' %d %d %d %d 'OPEN' 1* %.9g 0.5 /\n", wname(i), L.icol[i], L.jws[i], k, k, cfk)
                end
                continue
            end
            cf = s.connection_multiple * 0.001127 * s.conductivity_mdft[i] * s.thickness_ft * ntg[L.icol[i], L.jws[i]] / L.dy[L.jws[i]]   # net pay at the well cell
            @printf(io, " '%s' %d %d 1 1 'OPEN' 1* %.9g 0.5 /\n", wname(i), L.icol[i], L.jws[i], cf)
        end
        if !isnothing(rate_schedule)                     # one oil rate per report step, the spec's pressure as the lower limit
            for (dtk, rate) in rate_schedule
                println(io, "/\nWCONPROD")
                for i in wells
                    @printf(io, " '%s' 'OPEN' 'ORAT' %.9g 4* %.4f /\n", wname(i), rate, s.bhp_psi)
                end
                @printf(io, "/\nTSTEP\n %.9g ", dtk)
            end
            println(io, "/\nEND")
            return merge(L, (rocknum = rocknum, nz = nz, dz = V.dz, k_land = V.k_land, cover = V.cover, landing_ft = V.landing_ft, frac_water_placed_bbl = water_placed))
        end
        steps = isnothing(step_days) ? fracwell_tstep(s) : step_days       # step_days: your own report steps, for short tests
        if !isnothing(bhp_schedule)                      # one bottom-hole pressure per report step
            @assert length(bhp_schedule) == length(steps)
            for (k, dtk) in enumerate(steps)
                println(io, "/\nWCONPROD")
                for i in wells
                    @printf(io, " '%s' 'OPEN' 'BHP' 5* %.6f /\n", wname(i), bhp_schedule[k])
                end
                @printf(io, "/\nTSTEP\n %.9g ", dtk)
            end
            println(io, "/\nEND")
            return
        end
        println(io, "/\nWCONPROD")
        for i in wells
            if isnothing(oil_rate_target)
                @printf(io, " '%s' 'OPEN' 'BHP' 5* %.4f /\n", wname(i), s.bhp_psi)
            else                                         # the engine's own rate target with a pressure limit
                @printf(io, " '%s' 'OPEN' 'ORAT' %.6f 4* %.4f /\n", wname(i), oil_rate_target, s.bhp_psi)
            end
        end
        println(io, "/\nTSTEP\n", fmt_vals(steps), " /\nEND")
    end
    return merge(L, (rocknum = rocknum, nz = nz, dz = V.dz, k_land = V.k_land, cover = V.cover, landing_ft = V.landing_ft, frac_water_placed_bbl = water_placed))
end

"""
    fast_spec(spec; level = :fast)

The same well set up to run faster, for batches (history-match samples, probabilistic forecasts).
Measured on a three-stage live-oil well (0.005 md, 300 ft half-lengths, 120 months) against the standard
mesh with the default time steps:

| level        | mesh      | longest step | run time | oil at 3 / 12 / 60 / 120 months | gas at 3 / 12 / 60 / 120 months |
|--------------|-----------|--------------|----------|---------------------------------|---------------------------------|
| (coarse)     | coarse    | 2.5 days     | 1/3.4    | -0.2 / -0.2 / -0.2 / -0.3 %     | -1.2 / -1.4 / -0.8 / -0.8 %     |
| `:fast`      | coarse    | 15 days      | 1/14     | -1.9 / -0.9 / -0.6 / -0.5 %     | -2.9 / -2.2 / -1.1 / -0.8 %     |
| `:screening` | screening | 30 days      | 1/60     | -3.9 / -5.1 / -1.5 / -0.9 %     | -4.7 / -5.0 / -4.0 / -2.7 %     |

All three read low. Other rock and other fracture lengths will give somewhat different numbers; the
suite re-measures the `:fast` and `:screening` rows on one case and holds them to a bar.
"""
function fast_spec(s::FracWellSpec; level = :fast)
    kw = Dict{Symbol, Any}(f => getfield(s, f) for f in fieldnames(FracWellSpec))
    if level == :fast
        kw[:mesh] = "coarse"; kw[:dt_max_days] = MONTH_DAYS / 2; kw[:dt_growth] = 1.4
    elseif level == :screening
        kw[:mesh] = "screening"; kw[:dt_max_days] = MONTH_DAYS; kw[:dt_growth] = 1.5
    else
        error("fast_spec: level must be :fast or :screening")
    end
    return FracWellSpec(; kw...)
end

"""
    run_fracwell(spec; outdir)

Write the deck, simulate it, and return the run plus a per-stage table (cumulative oil, gas and
water in field units, and the half-length actually represented on the mesh).
"""
function run_fracwell(s::FracWellSpec; outdir = mktempdir(), bhp_schedule = nothing, oil_rate_target = nothing, kwarg...)
    mkpath(outdir)
    n = length(s.positions_ft)
    isempty(s.start_month) || length(s.start_month) == n || error("start_month needs one value per stage")
    starts = isempty(s.start_month) ? zeros(Int, n) : s.start_month
    all(m -> 0 <= m < s.months, starts) || error("every start_month must be at least 0 and below months")
    minimum(starts) == 0 || error("at least one stage must start in month 0")
    name = uppercase(replace(s.name, r"[^A-Za-z0-9_]" => "_"))
    breaks = sort(unique(starts)); staged = length(breaks) > 1
    staged && !(isnothing(bhp_schedule) && isnothing(oil_rate_target)) && error("staged starts cannot be combined with a pressure schedule or a rate target yet")
    oil = zeros(s.months, n); gas = zeros(s.months, n); water = zeros(s.months, n)
    runs = Any[]; L = nothing; deck = ""; previous = nothing; low = nothing
    for (k, m0) in enumerate(breaks)                       # one run per period between starts; the state is carried from one to the next
        m1 = k < length(breaks) ? breaks[k+1] : s.months
        active = starts .<= m0
        part = staged ? FracWellSpec(; (f => getfield(s, f) for f in fieldnames(FracWellSpec))..., months = m1 - m0) : s
        deck = joinpath(outdir, staged ? @sprintf("%s_FROM_MONTH_%03d.DATA", name, m0) : name * ".DATA")
        L = write_fracwell_deck(part, deck; bhp_schedule = bhp_schedule, oil_rate_target = oil_rate_target, active = staged ? active : nothing)
        prep = function (c)
            s.conductivity_loss_per_psi > 0 && rock_regions!(c, L.rocknum)
            isnothing(previous) || carry_state!(c, previous; lowest_pressure = low)
        end
        o = run_deck(deck; outdir = staged ? nothing : outdir, output_substates = true, prepare = prep, kwarg...)   # solver steps, so rate x step is the solver's own volume
        push!(runs, o); previous = o.result
        s.conductivity_loss_per_psi > 0 && (low = lowest_pressure(o.result, low))
        for i in 1:n
            active[i] || continue
            w = Symbol(@sprintf("S%03d", i))
            oil[m0+1:m1, i] = stage_monthly(o.result, w, :orat, STB, m1 - m0); gas[m0+1:m1, i] = stage_monthly(o.result, w, :grat, MSCF, m1 - m0)
            water[m0+1:m1, i] = stage_monthly(o.result, w, :wrat, STB, m1 - m0)
        end
    end
    stages = [(stage = i, position_ft = s.positions_ft[i], half_length_ft = L.eff_half_ft[i], conductivity_mdft = s.conductivity_mdft[i],
        oil_stb = sum(view(oil, :, i)), gas_mscf = sum(view(gas, :, i)), water_stb = sum(view(water, :, i)), start_month = starts[i]) for i in 1:n]
    open(joinpath(outdir, "stages.csv"), "w") do io
        println(io, "stage,position_ft,half_length_on_mesh_ft,conductivity_mdft,cum_oil_stb,cum_gas_mscf,cum_water_stb,start_month")
        for r in stages
            @printf(io, "%d,%.2f,%.2f,%.4g,%.6g,%.6g,%.6g,%d\n", r.stage, r.position_ft, r.half_length_ft, r.conductivity_mdft, r.oil_stb, r.gas_mscf, r.water_stb, r.start_month)
        end
    end
    return (run = runs[end], stages = stages, layout = L, deck = deck, outdir = outdir, monthly_oil_stb = oil, monthly_gas_mscf = gas, monthly_water_stb = water, runs = runs)
end

"Volume produced per calendar month by one stage well of a run: `key` is :orat, :grat or :wrat, `unit` the volume unit to report in."
function stage_monthly(res, w::Symbol, key::Symbol, unit, months)
    q = well_series(res, w, key)
    isnothing(q) && return zeros(months)
    dt = diff(vcat(0.0, res.time))
    m = clamp.(ceil.(Int, (res.time .- 1.0) ./ (MONTH_DAYS * DAY)), 1, months)   # 1 s slack for step-sum round-off
    return [sum((-q .* dt)[m .== k]) / unit for k in 1:months]
end

"""
Reservoir pressure on the model grid at the end of a fractured-well run (or at solver step `step` of its last
period): `psi[i, j]` with cell centres `x_ft[i]` along the lateral (the coordinate of `positions_ft`) and
`y_ft[j]` across the model. In a layered model it is the lateral's own layer unless `layer` is given.
"""
function pressure_field(r; step = nothing, layer = nothing)
    L = r.layout; st = r.run.result.states
    p = st[isnothing(step) ? length(st) : step][:Pressure]
    nz = get(L, :nz, 1)
    nz > 1 && (p = reshape(collect(p), L.nx, L.ny, nz)[:, :, something(layer, L.k_land)])
    i0 = argmin([t.position_ft for t in r.stages])                # line the cell centres up with the stage positions
    xc = cumsum(L.dx) .- L.dx ./ 2; xc .+= r.stages[i0].position_ft - xc[L.icol[i0]]
    return (psi = reshape(collect(p), L.nx, L.ny) ./ PSI, x_ft = xc, y_ft = cumsum(L.dy) .- L.dy ./ 2)
end

"""
    water_from_rock(r)

Where the water of a fractured-well run came from, in barrels at surface conditions, from the engine's own water mass:
`rock_bbl` is what the reservoir cells gave up, `wellbore_bbl` what stood in the engine's wellbores and was produced
(the engine gives every well a volume and fills it at the start with fluid like that of the cell it is connected to, so
the wellhead figures of the first days include it), `produced_bbl` their sum. All three are counted from the end of the
first solver step (the engine keeps no mass for the starting state); with the default first step of a thousandth of a
day that leaves out about a barrel. For load recovery use `rock_bbl`.
"""
function water_from_rock(r)
    rho = 64.49 * 16.01846337                               # surface density of water in the generated decks, kg/m3
    rock = 0.0; bore = 0.0
    for o in r.runs
        full = o.result.result.states
        mass(st, name) = sum(st[name][:TotalMasses][1, :])
        rock += mass(full[1], :Reservoir) - mass(full[end], :Reservoir)
        for name in keys(full[1])
            (name in (:Reservoir, :Facility, :substates) || !haskey(full[1][name], :TotalMasses)) && continue
            bore += mass(full[1], name) - mass(full[end], name)
        end
    end
    return (rock_bbl = rock / rho / 0.158987294928, wellbore_bbl = bore / rho / 0.158987294928, produced_bbl = (rock + bore) / rho / 0.158987294928)
end

"Oil produced per calendar month (stb) for one stage well of a fracwell result."
function stage_monthly_oil(res, w::Symbol, months)
    dt = diff(vcat(0.0, res.time)); q = -well_series(res, w, :orat)
    m = clamp.(ceil.(Int, (res.time .- 1.0) ./ (MONTH_DAYS * DAY)), 1, months)   # 1 s slack for step-sum round-off
    return [sum((q .* dt)[m .== k]) / STB for k in 1:months]
end
