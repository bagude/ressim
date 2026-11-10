# Builds SCORECARD.md from validation/results.toml, features.toml and a search of the installed
# engine source. Usage: julia --project=<env> validation/scorecard.jl
using TOML, Printf, Dates

const ROOT = normpath(joinpath(@__DIR__, ".."))
const RES = TOML.parsefile(joinpath(@__DIR__, "results.toml"))
const FEAT = TOML.parsefile(joinpath(ROOT, "features.toml"))["feature"]
const ENGINE = dirname(dirname(Base.find_package("JutulDarcy")))

const TEST = Dict(t["id"] => t for t in RES["test"])

function source_hits(pattern)
    rx = Regex(pattern, "i"); hits = String[]
    for top in ("src", "ext"), (dir, _, files) in walkdir(joinpath(ENGINE, top)), f in files
        endswith(f, ".jl") || continue
        p = joinpath(dir, f)
        occursin(rx, read(p, String)) && push!(hits, replace(relpath(p, ENGINE), '\\' => '/'))
    end
    return hits
end

"Returns (rank, status, evidence). Rank orders the summary counts."
function status(f)
    if haskey(f, "tests")
        ts = f["tests"]
        missing_t = [t for t in ts if !haskey(TEST, t)]
        isempty(missing_t) || return (7, "not run in this tier", "needs: " * join(missing_t, ", "))
        st = [TEST[t]["status"] for t in ts]
        kinds = unique(TEST[t]["kind"] for t in ts)
        if all(==("pass"), st) && "self" in kinds      # a row is only as strong as its weakest test
            return (2, "runs here, self-consistent only", "symmetry / mesh checks pass, no outside check: " * join(ts, ", "))
        end
        kinds = filter(!=("self"), kinds)
        how = kinds == ["exact"] ? "exact solution" : kinds == ["cross"] ? "a reference run from another model or simulator" : "exact solution and a reference run"
        all(==("pass"), st) && return (1, "verified here", "passes against " * how * ": " * join(ts, ", "))
        bad = [t for t in ts if TEST[t]["status"] != "pass"]
        return (3, "runs here, misses its bar", join(bad, ", "))
    elseif haskey(f, "engine")
        ok = ispath(joinpath(ENGINE, f["engine"]))
        return ok ? (4, "in engine, not run here", f["engine"]) : (6, "absent", "expected " * f["engine"] * ", not found")
    elseif haskey(f, "local")
        ok = ispath(joinpath(ROOT, f["local"]))
        return ok ? (5, "in our research track, not in this package", f["local"]) : (6, "absent", f["local"] * " not found")
    else
        h = source_hits(f["absent"])
        return isempty(h) ? (6, "absent", "no engine source file matches /" * f["absent"] * "/") :
            (6, "absent as a feature", string(length(h), " file(s) mention the term: ", join(first(h, 2), ", ")))
    end
end

rows = [(f, status(f)...) for f in FEAT]
count_rank(r) = count(x -> x[2] == r, rows)

open(joinpath(ROOT, "SCORECARD.md"), "w") do io
    println(io, "# Ressim scorecard\n")
    println(io, "Generated ", Dates.today(), " from `validation/results.toml` (tier `", RES["tier"], "`, run ", RES["date"], "), `features.toml` and a search of the installed engine source (", RES["engine"], ", Julia ", RES["julia"], "). Do not edit by hand; rerun `validation/scorecard.jl`.\n")
    np = count(t -> t["status"] == "pass", RES["test"])
    println(io, "## Summary\n")
    println(io, "- Validation tests: **", np, " of ", length(RES["test"]), " pass**.")
    println(io, "- Features: **", count_rank(1), " verified here**, ", count_rank(2), " run here with self-consistency checks only, ", count_rank(3), " run here but miss a bar, ", count_rank(7), " not run in this tier, ",
        count_rank(4), " in the engine but not run here, ", count_rank(5), " only in our research track, **", count_rank(6), " absent**.")
    println(io, "- \"Verified here\" means a test in this suite passed on this machine. Nothing else in this file is a claim of parity with any vendor.\n")

    println(io, "## Validation tests\n")
    println(io, "Three kinds of evidence. *exact*: a closed-form solution, independent of any simulator. *cross*: another simulator's published results shipped with the benchmark data (agreement, not proof). *self*: symmetry or mesh sensitivity of our own run (stable, not shown to be right).\n")
    println(io, "| Test | Kind | Result | Measures (value / bar) | Cells | Steps (cut) | Seconds |")
    println(io, "| --- | --- | --- | --- | --- | --- | --- |")
    for t in RES["test"]
        m = join([@sprintf("%s %.2f%% / %.2f%%%s", c["name"], 100 * abs(c["value"]), 100 * c["bar"], c["pass"] ? "" : " ✗") for c in t["checks"]], "; ")
        t["status"] == "error" && (m = "error: " * replace(get(t, "detail", ""), '\n' => ' ', '|' => '/'))
        println(io, "| ", t["title"], " (`", t["id"], "`) | ", t["kind"], " | **", t["status"], "** | ", m, " | ", get(t, "cells", ""), " | ",
            haskey(t, "ministeps") ? string(t["ministeps"], " (", t["cuts"], ")") : "", " | ", t["seconds"], " |")
    end
    println(io)
    for t in RES["test"]
        haskey(t, "detail") && t["status"] != "error" && println(io, "- `", t["id"], "`: ", t["detail"])
    end
    noted = [t for t in RES["test"] if !isempty(get(t, "notes", String[]))]
    if !isempty(noted)
        println(io, "\n### Deck keywords the parser could not fully honour\n")
        for t in noted, n in t["notes"]
            println(io, "- `", t["id"], "`: ", n)
        end
    end

    println(io, "\n## Features\n")
    println(io, "`Known for` is from recall of vendor products, not looked up.\n")
    for area in unique(f["area"] for f in FEAT)
        println(io, "### ", area, "\n")
        println(io, "| Feature | Known for | Status | Evidence |")
        println(io, "| --- | --- | --- | --- |")
        for (f, _, st, ev) in rows
            f["area"] == area || continue
            haskey(f, "note") && (ev *= " — " * f["note"])
            println(io, "| ", f["name"], " | ", f["known_for"], " | ", st in ("verified here", "absent", "absent as a feature") ? "**" * st * "**" : st, " | ", replace(ev, '|' => '/'), " |")
        end
        println(io)
    end
end
println("wrote ", joinpath(ROOT, "SCORECARD.md"))
