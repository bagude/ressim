# ECLIPSE-format binary summary output (SMSPEC / UNSMRY): write a run so other tools can read it, and read such files back.
# (stream 8, 2026-11-10)
#
# Other tools (ResInsight, Petrel, OPM's readers, plotting and economics scripts) read results as a pair of binary files:
# NAME.SMSPEC says which vectors there are (keyword, well name, unit), NAME.UNSMRY holds one row of numbers per time.
# Here: `write_ecl_summary` writes the pair from any run of this package, `read_ecl_summary` reads such a pair,
# `summary_table` builds the vectors (and is where every sign and unit conversion is made), and `ecl_write_array` /
# `ecl_read_arrays` are the record layer underneath, shared by all ECLIPSE binary files.
#
# The layout and where each part of it comes from are in research/ecl-binary-format.md. Evidence, plainly: no summary
# file from another simulator and no independent reader were available on this machine when this was written, so the
# layout is checked only against its published description (bytes assembled by hand in a test) and by reading back
# what was written. The vector VALUES are checked against the engine's own summary assembly.
# Not written: restart files (.UNRST), grids (.EGRID), the formatted (text) variants, non-unified files (.S0001),
# group, region, block, completion and aquifer vectors, well names longer than 8 characters.

const ECL_BLOCK = 1000          # numbers per record
const ECL_CHAR_BLOCK = 105      # 8-character strings per record
const ECL_NO_NAME = ":+:+:+:+"  # the name of a vector that belongs to no well or group

function ecl_pad8(s)
    str = String(s)
    isascii(str) && ncodeunits(str) <= 8 || error("'$str' does not fit the 8 ASCII characters the summary format allows")
    return rpad(str, 8)
end

"One Fortran unformatted record: the byte count, the bytes, the byte count again (4-byte integers, big-endian)."
function ecl_write_record(io::IO, bytes::Vector{UInt8})
    n = hton(Int32(length(bytes)))
    write(io, n); write(io, bytes); write(io, n)
    return nothing
end

ecl_type_of(::AbstractVector{Int32}) = ("INTE", ECL_BLOCK)
ecl_type_of(::AbstractVector{Float32}) = ("REAL", ECL_BLOCK)
ecl_type_of(::AbstractVector{Float64}) = ("DOUB", ECL_BLOCK)
ecl_type_of(::AbstractVector{Bool}) = ("LOGI", ECL_BLOCK)
ecl_type_of(::AbstractVector{<:AbstractString}) = ("CHAR", ECL_CHAR_BLOCK)

ecl_put(b::IO, x::Union{Int32, Float32, Float64}) = write(b, hton(x))
ecl_put(b::IO, x::Bool) = write(b, hton(x ? Int32(-1) : Int32(0)))
ecl_put(b::IO, x::AbstractString) = write(b, ecl_pad8(x))

"""
    ecl_write_array(io, keyword, values)

One named array in ECLIPSE binary form: a header record (keyword in 8 characters, number of items, 4-character type),
then the items in records of at most 1000 numbers or 105 strings. `values` is a vector of `Int32` (INTE), `Float32`
(REAL), `Float64` (DOUB), `Bool` (LOGI) or strings of up to 8 characters (CHAR). Everything is big-endian.
"""
function ecl_write_array(io::IO, keyword, values::AbstractVector)
    typ, block = ecl_type_of(values)
    head = IOBuffer(); write(head, ecl_pad8(keyword)); write(head, hton(Int32(length(values)))); write(head, typ)
    ecl_write_record(io, take!(head))
    for first in 1:block:length(values)
        b = IOBuffer()
        for i in first:min(first + block - 1, length(values))
            ecl_put(b, values[i])
        end
        ecl_write_record(io, take!(b))
    end
    return nothing
end

"""
    ecl_read_arrays(path)

Every named array of an ECLIPSE binary file, in order, as (keyword, type, values). Numbers come back as `Int32`,
`Float32` or `Float64` vectors, LOGI as `Bool`, CHAR (and the longer C0nn strings) as strings without trailing blanks.
"""
function ecl_read_arrays(path::AbstractString)
    data = read(path); pos = 1; out = NamedTuple{(:keyword, :type, :values), Tuple{String, String, Any}}[]
    int32(at) = ntoh(reinterpret(Int32, data[at:at+3])[1])
    while pos <= length(data)
        pos + 23 <= length(data) || error("$path: the file ends inside an array header (byte $pos)")
        int32(pos) == 16 && int32(pos + 20) == 16 || error("$path: no array header at byte $pos; not an unformatted big-endian ECLIPSE file, or damaged")
        keyword = String(rstrip(String(data[pos+4:pos+11]))); count = Int(int32(pos + 12)); typ = String(data[pos+16:pos+19]); pos += 24
        width = typ == "INTE" ? 4 : typ == "REAL" ? 4 : typ == "DOUB" ? 8 : typ == "LOGI" ? 4 : typ == "CHAR" ? 8 : typ == "MESS" ? 0 :
            startswith(typ, "C0") ? parse(Int, typ[2:4]) : error("$path: array $keyword has a type this reader does not know ($typ)")
        raw = UInt8[]
        while length(raw) < count * width
            pos + 3 <= length(data) || error("$path: the file ends inside array $keyword")
            n = Int(int32(pos)); (n > 0 && pos + 7 + n <= length(data) && int32(pos + 4 + n) == n) || error("$path: broken record in array $keyword at byte $pos")
            append!(raw, @view data[pos+4:pos+3+n]); pos += 8 + n
        end
        length(raw) == count * width || error("$path: array $keyword holds $(length(raw)) bytes, its header says $(count * width)")
        values = typ == "INTE" ? ntoh.(reinterpret(Int32, raw)) : typ == "REAL" ? ntoh.(reinterpret(Float32, raw)) : typ == "DOUB" ? ntoh.(reinterpret(Float64, raw)) :
            typ == "LOGI" ? (ntoh.(reinterpret(Int32, raw)) .!= 0) : typ == "MESS" ? nothing :
            [String(rstrip(String(raw[(i-1)*width+1:i*width]))) for i in 1:count]
        push!(out, (keyword = keyword, type = typ, values = values isa AbstractVector ? collect(values) : values))
    end
    return out
end

# ---- the vectors of a run ------------------------------------------------------------------------------------------

"One summary vector: its keyword (WOPR, FOPT, ...), the well it belongs to (\"\" for none), its number, unit string and values, one per time."
struct SummaryVector
    keyword::String
    name::String
    num::Int
    unit::String
    values::Vector{Float64}
end

"The vectors of a run at its times (days since `start`), with the grid dimensions and unit system the files state."
struct SummaryTable
    start::DateTime
    dims::NTuple{3, Int}
    unit_system::Symbol
    time_days::Vector{Float64}
    vectors::Vector{SummaryVector}
end

# The one place where signs and units are set. The engine works in SI (m3/s at surface conditions, Pa) and gives a well's
# rate as negative when it produces. A summary file wants production and injection as separate, positive vectors.
# rate: multiply m3/s by this; total: multiply m3 by this; pressure: multiply Pa (absolute) by this.
const SUMMARY_UNITS = Dict(
    :field => (id = 2, liquid = (DAY / STB, "STB/DAY", 1 / STB, "STB"), gas = (DAY / MSCF, "MSCF/DAY", 1 / MSCF, "MSCF"), pressure = (1 / PSI, "PSIA")),
    :metric => (id = 1, liquid = (DAY, "SM3/DAY", 1.0, "SM3"), gas = (DAY, "SM3/DAY", 1.0, "SM3"), pressure = (1 / BAR, "BARSA")),
)
const SUMMARY_PHASES = ((:orat, "O", :liquid), (:grat, "G", :gas), (:wrat, "W", :liquid))
const SUMMARY_NUM_NONE = -32676     # the number given to vectors that have none (time vectors)

"The simulation results a table is made from: one or several periods (a staged fractured-well run has one per start), and the deck data if there is any."
function summary_periods(x)
    if x isa JutulDarcy.ReservoirSimResult
        return [x], nothing
    elseif hasproperty(x, :runs) && !isempty(x.runs)                 # run_fracwell
        return [o.result for o in x.runs], x.runs[1].case
    elseif hasproperty(x, :run) && hasproperty(x.run, :result)       # run_fracwell without the list of periods
        return [x.run.result], x.run.case
    elseif hasproperty(x, :result) && x.result isa JutulDarcy.ReservoirSimResult      # run_deck and the surface drivers
        return [x.result], hasproperty(x, :case) ? x.case : nothing
    end
    error("summary_table: give a simulation result, or what run_deck or run_fracwell returns")
end

"""
    summary_table(run; unit_system = nothing, start = nothing, dims = nothing)

The summary vectors of a run: `run` is what `run_deck`, `run_fracwell` or a surface driver returns, or a bare
simulation result. Time: TIME (days), YEARS, DAY, MONTH, YEAR. Per well: WOPR, WGPR, WWPR (production, positive),
WOPT, WGPT, WWPT (their totals), WBHP, and WWIR, WGIR, WOIR with WWIT, WGIT, WOIT for a phase the well injects at any
time. Field: the same letters with F, as sums over the wells. Totals are sums of rate times the length of the step that
ends at each time (the first step starts at zero), which is how the engine itself advances. A well that does not exist
in some period of a staged run has zero rates and zero pressure there.

Unit system, start date and grid dimensions are taken from the deck when the run carries one (`FIELD` or metric,
`START`, `DIMENS`), else field units, 1 January 2020 and one cell; each can be given.
"""
function summary_table(x; unit_system = nothing, start = nothing, dims = nothing)
    periods, case = summary_periods(x)
    data = isnothing(case) ? nothing : case.input_data
    rs = (isnothing(data) || ismissing(data) || !haskey(data, "RUNSPEC")) ? Dict{String, Any}() : data["RUNSPEC"]
    usys = Symbol(something(unit_system, haskey(rs, "FIELD") ? :field : isempty(rs) ? :field : :metric))
    haskey(SUMMARY_UNITS, usys) || error("summary_table: unit system must be :field or :metric")
    U = SUMMARY_UNITS[usys]
    t0 = DateTime(something(start, haskey(rs, "START") ? rs["START"] : DateTime(2020, 1, 1)))
    nd = Tuple(Int.(something(dims, haskey(rs, "DIMENS") ? rs["DIMENS"][1:3] : [1, 1, 1])))
    # one time axis for all periods, each starting where the one before ended
    t = Float64[]; first_row = Int[]; offset = 0.0
    for res in periods
        push!(first_row, length(t) + 1); append!(t, offset .+ res.time); offset = t[end]
    end
    n = length(t); dt = diff(vcat(0.0, t))
    wells = sort(unique(vcat([collect(keys(res.wells.wells)) for res in periods]...)))
    series(w, key) = (v = zeros(n); for (p, res) in enumerate(periods)
            haskey(res.wells.wells, w) || continue
            q = well_series(res, w, key); isnothing(q) || (v[first_row[p]:first_row[p]+length(q)-1] .= q)
        end; v)
    vec = SummaryVector[]
    date = [t0 + Millisecond(round(Int, 1000 * s)) for s in t]
    push!(vec, SummaryVector("TIME", "", SUMMARY_NUM_NONE, "DAYS", t ./ DAY))
    push!(vec, SummaryVector("YEARS", "", SUMMARY_NUM_NONE, "YEARS", t ./ (365.25 * DAY)))
    push!(vec, SummaryVector("DAY", "", SUMMARY_NUM_NONE, "DAYS", Float64.(Dates.day.(date))))
    push!(vec, SummaryVector("MONTH", "", SUMMARY_NUM_NONE, "MONTHS", Float64.(Dates.month.(date))))
    push!(vec, SummaryVector("YEAR", "", SUMMARY_NUM_NONE, "YEARS", Float64.(Dates.year.(date))))
    field = Dict{String, Tuple{String, Vector{Float64}}}(); order = String[]
    add_field!(key, unit, v) = haskey(field, key) ? (field[key][2] .+= v) : (push!(order, key); field[key] = (unit, copy(v)))
    per_well = SummaryVector[]
    for w in wells
        name = String(w)
        for (key, letter, kind) in SUMMARY_PHASES
            q = series(w, key)                                        # m3/s, negative when the well produces
            rate_x, rate_u, tot_x, tot_u = getfield(U, kind)
            for (dir, sgn) in (("P", -1.0), ("I", 1.0))
                r = max.(sgn .* q, 0.0)
                dir == "I" && !any(>(0), r) && continue                # injection vectors only for what is injected
                dir == "P" && !any(res -> haskey(res.wells.wells, w) && haskey(res.wells.wells[w], key), periods) && continue   # a phase the model does not have
                rate = r .* rate_x; total = cumsum(r .* dt) .* tot_x
                push!(per_well, SummaryVector("W" * letter * dir * "R", name, 0, rate_u, rate)); push!(per_well, SummaryVector("W" * letter * dir * "T", name, 0, tot_u, total))
                add_field!("F" * letter * dir * "R", rate_u, rate); add_field!("F" * letter * dir * "T", tot_u, total)
            end
        end
        push!(per_well, SummaryVector("WBHP", name, 0, U.pressure[2], series(w, :bhp) .* U.pressure[1]))
    end
    for key in order
        push!(vec, SummaryVector(key, "", 0, field[key][1], field[key][2]))
    end
    append!(vec, per_well)
    return SummaryTable(t0, nd, usys, t ./ DAY, vec)
end

"""
    write_ecl_summary(run_or_table, basepath; unit_system, start, dims)

Write `basepath.SMSPEC` and `basepath.UNSMRY` (unified) for a run (see `summary_table` for what goes in and for the
keywords) or for a `SummaryTable` you built yourself. Every time is written as a report step of its own. Numbers are
stored as 4-byte reals, as the format requires, so about seven digits survive. Returns the two paths.
"""
function write_ecl_summary(x, basepath::AbstractString; kwarg...)
    T = x isa SummaryTable ? x : summary_table(x; kwarg...)
    nlist = length(T.vectors); nrow = length(T.time_days)
    nlist >= 1 && T.vectors[1].keyword == "TIME" || error("write_ecl_summary: the first vector must be TIME")
    all(v -> length(v.values) == nrow, T.vectors) || error("write_ecl_summary: every vector needs one value per time")
    spec = basepath * ".SMSPEC"; unsm = basepath * ".UNSMRY"
    open(spec, "w") do io
        ecl_write_array(io, "INTEHEAD", Int32[SUMMARY_UNITS[T.unit_system].id, 100])          # unit system; the program the files claim to come from (100: ECLIPSE 100 layout)
        ecl_write_array(io, "RESTART", fill("", 9))                                            # not a restarted run
        ecl_write_array(io, "DIMENS", Int32[nlist, T.dims[1], T.dims[2], T.dims[3], 0, -1])    # number of vectors, grid size, unused, no restart step
        ecl_write_array(io, "KEYWORDS", [v.keyword for v in T.vectors])
        ecl_write_array(io, "WGNAMES", [isempty(v.name) ? ECL_NO_NAME : v.name for v in T.vectors])
        ecl_write_array(io, "NUMS", Int32[v.num for v in T.vectors])
        ecl_write_array(io, "UNITS", [v.unit for v in T.vectors])
        s = T.start
        ecl_write_array(io, "STARTDAT", Int32[Dates.day(s), Dates.month(s), Dates.year(s), Dates.hour(s), Dates.minute(s), 1_000_000 * Dates.second(s) + 1000 * Dates.millisecond(s)])
    end
    open(unsm, "w") do io
        for k in 1:nrow
            ecl_write_array(io, "SEQHDR", Int32[0])
            ecl_write_array(io, "MINISTEP", Int32[k - 1])
            ecl_write_array(io, "PARAMS", Float32[v.values[k] for v in T.vectors])
        end
    end
    return (smspec = spec, unsmry = unsm)
end

"""
    read_ecl_summary(basepath)

Read `basepath.SMSPEC` and `basepath.UNSMRY`. Returns the times (days), start date, grid dimensions, unit system,
the list of vectors as (keyword, name, num, unit), the numbers as a matrix (one row per time, one column per
vector), and for each row its report step and ministep. Use `summary_vector(s, "WOPR", "W1")` to get one vector.
"""
function read_ecl_summary(basepath::AbstractString)
    base = endswith(uppercase(basepath), ".SMSPEC") || endswith(uppercase(basepath), ".UNSMRY") ? basepath[1:end-7] : basepath
    spec = ecl_read_arrays(base * ".SMSPEC")
    get1(key) = (i = findfirst(a -> a.keyword == key, spec); isnothing(i) ? nothing : spec[i].values)
    dimens = get1("DIMENS"); isnothing(dimens) && error("$base.SMSPEC has no DIMENS")
    nlist = Int(dimens[1]); keywords = get1("KEYWORDS"); units = get1("UNITS"); nums = get1("NUMS")
    names = something(get1("WGNAMES"), get1("NAMES"), fill(ECL_NO_NAME, nlist))
    isnothing(keywords) && error("$base.SMSPEC has no KEYWORDS")
    length(keywords) == nlist || error("$base.SMSPEC: DIMENS says $nlist vectors, KEYWORDS has $(length(keywords))")
    units = something(units, fill("", nlist)); nums = something(nums, fill(Int32(0), nlist))
    sd = get1("STARTDAT"); ih = get1("INTEHEAD")
    start = isnothing(sd) ? nothing : DateTime(sd[3], sd[2], sd[1], length(sd) >= 5 ? sd[4] : 0, length(sd) >= 5 ? sd[5] : 0) + Millisecond(length(sd) >= 6 ? div(sd[6], 1000) : 0)
    usys = isnothing(ih) ? :unknown : ih[1] == 1 ? :metric : ih[1] == 2 ? :field : ih[1] == 3 ? :lab : :unknown
    rows = Vector{Float32}[]; report = Int[]; mini = Int[]; step = 0; last_mini = -1
    for a in ecl_read_arrays(base * ".UNSMRY")
        if a.keyword == "SEQHDR"
            step += 1
        elseif a.keyword == "MINISTEP"
            last_mini = Int(a.values[1])
        elseif a.keyword == "PARAMS"
            length(a.values) == nlist || error("$base.UNSMRY: a row has $(length(a.values)) numbers, the specification says $nlist")
            push!(rows, a.values); push!(report, step); push!(mini, last_mini)
        end
    end
    M = isempty(rows) ? zeros(0, nlist) : Float64.(permutedims(reduce(hcat, rows)))
    clean(nm) = (nm == ECL_NO_NAME || isempty(nm)) ? "" : nm
    vectors = [(keyword = String(keywords[i]), name = clean(String(names[i])), num = Int(nums[i]), unit = String(units[i])) for i in 1:nlist]
    it = findfirst(v -> v.keyword == "TIME", vectors)
    return (time_days = isnothing(it) ? Float64[] : M[:, it], start = start, dims = (Int(dimens[2]), Int(dimens[3]), Int(dimens[4])), unit_system = usys, vectors = vectors, values = M,
        report_step = report, ministep = mini)
end

"One vector of a summary read with `read_ecl_summary`: by keyword and, for well vectors, well name. `num` picks between vectors that differ only in their number."
function summary_vector(s, keyword::AbstractString, name::AbstractString = ""; num = nothing)
    hits = [i for (i, v) in enumerate(s.vectors) if v.keyword == keyword && v.name == name && (isnothing(num) || v.num == num)]
    isempty(hits) && error("no summary vector $keyword" * (isempty(name) ? "" : " for $name"))
    length(hits) == 1 || error("several summary vectors $keyword" * (isempty(name) ? "" : " for $name") * ": give num")
    return s.values[:, hits[1]]
end
