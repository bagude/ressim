# Lift tables (VFP): tabulate a tubing model, read and write the standard table keyword, use a table as the tubing.
# (stream 6, 2026-11-10)
#
# A lift table gives the bottom-hole pressure a well needs as a function of five things: flow rate, tubing-head
# pressure, water fraction, gas fraction and an artificial-lift quantity. It is how tubing performance is passed
# between tools: a nodal-analysis program writes one, a reservoir simulator reads it (keyword VFPPROD). Here:
#   build_lift_table   tabulates any lift function of this package (lift.jl) on axes you choose
#   table_lift         turns a table back into a lift function, by linear interpolation in all five directions
#   write_vfpprod / read_vfpprod   the keyword, in field units
# Conventions used for the table (stated in its first record): flow is OIL rate in stb/d, water fraction is the
# water-oil ratio (WOR, stb/stb), gas fraction is the gas-oil ratio (GOR, Mscf/stb), the lift quantity is lift gas
# in Mscf/d added to the well's own gas, pressures in psia as the lift functions take them.
# Outside the table the values are extended along the last interval (as the simulators that read VFPPROD do), which
# can be badly wrong; `table_lift` counts how often that happened. Not here: injection tables (VFPINJ), other
# choices of flow and fraction variables, temperature tables.

struct LiftTable
    number::Int
    datum_ft::Float64
    flo::Vector{Float64}       # oil rate, stb/d
    thp::Vector{Float64}       # tubing-head (node) pressure, psi
    wfr::Vector{Float64}       # water-oil ratio
    gfr::Vector{Float64}       # gas-oil ratio, Mscf/stb
    alq::Vector{Float64}       # lift gas, Mscf/d
    bhp::Array{Float64, 5}     # psi, [flo, thp, wfr, gfr, alq]
end

rising(v) = all(v[i+1] > v[i] for i in 1:length(v)-1)

"""
    build_lift_table(lift; flo, thp, wfr = [0.0], gfr, alq = [0.0], datum_ft = 0.0, number = 1)

Tabulate a lift function `lift(node_psi, oil_stb_d, water_stb_d, gas_mscf_d) -> bottom-hole psi` (see lift.jl)
on the given axes: oil rates `flo` (stb/d, all positive), node pressures `thp` (psi), water-oil ratios `wfr`,
gas-oil ratios `gfr` (Mscf/stb) and lift-gas rates `alq` (Mscf/d, added to the well's own gas).
"""
function build_lift_table(lift; flo, thp, wfr = [0.0], gfr, alq = [0.0], datum_ft = 0.0, number = 1)
    flo, thp, wfr, gfr, alq = Float64.(flo), Float64.(thp), Float64.(wfr), Float64.(gfr), Float64.(alq)
    all(rising, (flo, thp, wfr, gfr, alq)) || error("every axis of a lift table must increase")
    flo[1] > 0 && wfr[1] >= 0 && gfr[1] >= 0 && alq[1] >= 0 || error("oil rates must be positive; ratios and lift gas cannot be negative")
    bhp = [lift(p, q, w * q, g * q + a) for q in flo, p in thp, w in wfr, g in gfr, a in alq]
    all(isfinite, bhp) || error("the lift function did not give a finite pressure everywhere on the table")
    return LiftTable(number, datum_ft, flo, thp, wfr, gfr, alq, bhp)
end

"Interval and weight for linear interpolation on an increasing axis; outside the axis the end interval is extended."
function axis_weight(ax, x)
    n = length(ax)
    n == 1 && return (1, 1, 0.0, false)
    i = clamp(searchsortedlast(ax, x), 1, n - 1)
    return (i, i + 1, (x - ax[i]) / (ax[i+1] - ax[i]), x < ax[1] || x > ax[end])
end

"Bottom-hole pressure from a lift table at one point (linear in every direction). Returns the pressure and whether the point lay outside the table."
function lift_table_value(t::LiftTable, oil, thp, wor, gor, alq)
    a = (axis_weight(t.flo, oil), axis_weight(t.thp, thp), axis_weight(t.wfr, wor), axis_weight(t.gfr, gor), axis_weight(t.alq, alq))
    # the 32 corners of the cell the point is in; every term is kept, also at weight zero, so that derivatives (the engine
    # differentiates through this) are right when a point sits exactly on a node
    v = zero(oil + thp + wor + gor + alq)
    for c in 0:31
        hi(d) = (c >> (d - 1)) & 1 == 1
        w = prod(ntuple(d -> hi(d) ? a[d][3] : 1 - a[d][3], 5))
        v += w * t.bhp[ntuple(d -> hi(d) ? a[d][2] : a[d][1], 5)...]
    end
    return v, any(x -> x[4], a)
end

"""
    table_lift(table; alq = 0.0)

A lift function `(node_psi, oil, water, gas) -> bottom-hole psi` that reads the table, for `SurfaceSpec(lift = ...)`
and the field driver. `alq` is the lift gas (Mscf/d) at which the table is read. The function carries a counter:
`f.outside[]` is how many calls with the well flowing fell outside the table's axes, and `f.first_outside[]` is the
first such point (oil rate, node pressure, water-oil ratio, gas-oil ratio). How fine a table has to be depends on
the tubing model: for the gas-liquid model of lift.jl, 14 log-spaced rates by 10 gas-oil ratios left up to 10% error
in the tubing's pressure drop (see the test `lift_table_well`).
"""
function table_lift(t::LiftTable; alq = 0.0)
    outside = Ref(0); first_outside = Ref{Any}(nothing)
    plain(x) = Float64(x isa Real && !(x isa AbstractFloat) && hasproperty(x, :value) ? x.value : x)      # the number inside a derivative-carrying value
    f = function (p_node, qo, qw, qg)
        wor = qo > 0 ? qw / qo : t.wfr[1]; gor = qo > 0 ? qg / qo : t.gfr[1]
        v, out = lift_table_value(t, qo, p_node, wor, gor, alq)
        if out && qo > 0                                # a well that is not flowing is not a point on the table
            outside[] += 1
            isnothing(first_outside[]) && (first_outside[] = (oil_stb_d = plain(qo), node_psi = plain(p_node), wor = plain(wor), gor = plain(gor)))
        end
        return v
    end
    return TableLift(f, outside, first_outside, t)
end

"A lift function backed by a table (callable), with the count of calls that fell outside the table."
struct TableLift <: Function
    f::Function
    outside::Base.RefValue{Int}
    first_outside::Base.RefValue{Any}
    table::LiftTable
end
(l::TableLift)(p_node, qo, qw, qg) = l.f(p_node, qo, qw, qg)

"Write a lift table as a VFPPROD keyword (field units). `io` is a path or an open stream."
function write_vfpprod(t::LiftTable, io::IO)
    println(io, "VFPPROD")
    @printf(io, " %d %.6g 'OIL' 'WOR' 'GOR' 'THP' 'GRAT' 'FIELD' 'BHP' /\n", t.number, t.datum_ft)
    for ax in (t.flo, t.thp, t.wfr, t.gfr, t.alq)
        println(io, " ", join([@sprintf("%.9g", x) for x in ax], " "), " /")
    end
    for ia in eachindex(t.alq), ig in eachindex(t.gfr), iw in eachindex(t.wfr), it in eachindex(t.thp)
        println(io, " ", it, " ", iw, " ", ig, " ", ia, " ", join([@sprintf("%.9g", t.bhp[iq, it, iw, ig, ia]) for iq in eachindex(t.flo)], " "), " /")
    end
    return nothing
end
write_vfpprod(t::LiftTable, path::AbstractString) = open(io -> write_vfpprod(t, io), path, "w")

"""
    read_vfpprod(path_or_text)

Read the first VFPPROD keyword of a file (or of a string holding one). Only the conventions this package writes are
accepted (oil rate, WOR, GOR, field units, BHP); anything else is an error that says which item differs, because a
table read with the wrong meaning gives wrong pressures without any sign of it. Repeat counts (`3*100`) and
comments (`--`) are understood.
"""
function read_vfpprod(src::AbstractString)
    text = occursin("VFPPROD", src) ? src : read(src, String)
    lines = [strip(first(split(l, "--"))) for l in split(text, '\n')]
    k = findfirst(l -> uppercase(l) == "VFPPROD", lines)
    isnothing(k) && error("no VFPPROD keyword found")
    recs = Vector{Vector{String}}(); cur = String[]
    for l in lines[k+1:end]
        isempty(l) && continue
        done = false
        for tok in split(replace(l, "/" => " / "))
            if tok == "/"
                push!(recs, cur); cur = String[]; done = true
            else
                m = match(r"^(\d+)\*(.+)$", tok)
                isnothing(m) ? push!(cur, String(tok)) : append!(cur, fill(String(m.captures[2]), parse(Int, m.captures[1])))
            end
        end
        # a keyword name on a line of its own (letters only, no terminating slash) ends the table
        !done && isempty(recs) == false && length(cur) == 1 && occursin(r"^[A-Za-z]+$", cur[1]) && (cur = String[]; break)
    end
    length(recs) >= 6 || error("VFPPROD: the table is incomplete")
    head = recs[1]; q(sv) = uppercase(strip(sv, ['\'', ' ']))
    want = ("OIL", "WOR", "GOR", "THP", "GRAT", "FIELD", "BHP"); what = ("flow variable", "water fraction", "gas fraction", "fixed pressure", "lift quantity", "units", "tabulated quantity")
    for (j, (w, name)) in enumerate(zip(want, what))
        got = length(head) >= j + 2 ? q(head[j+2]) : (j >= 4 ? w : "")            # the last four may be left to their defaults
        (got == w || (j >= 4 && got in ("", "1*", "' '"))) || error("VFPPROD: this reader takes $name $w, the table says $got")
    end
    num(v) = parse.(Float64, v)
    flo, thp, wfr, gfr, alq = num(recs[2]), num(recs[3]), num(recs[4]), num(recs[5]), num(recs[6])
    bhp = fill(NaN, length(flo), length(thp), length(wfr), length(gfr), length(alq))
    for r in recs[7:end]
        length(r) == 4 + length(flo) || break
        it, iw, ig, ia = parse.(Int, r[1:4])
        bhp[:, it, iw, ig, ia] .= num(r[5:end])
    end
    all(isfinite, bhp) || error("VFPPROD: not every combination of the axes has a record")
    return LiftTable(parse(Int, head[1]), parse(Float64, head[2]), flo, thp, wfr, gfr, alq, bhp)
end
