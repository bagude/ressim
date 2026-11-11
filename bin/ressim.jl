# Command line entry point. Use the wrapper: .\ressim.ps1 <command> ...
#   run <deck.DATA> [outdir]   simulate an ECLIPSE-format deck, write a field-unit summary
#   fracwell <spec.toml> [outdir]  multi-stage fractured well from a small input file (see examples/)
#   validate [quick|full]      run the validation suite and rebuild SCORECARD.md
#   scorecard                  rebuild SCORECARD.md from the last validation run
using Printf
const ROOT = normpath(joinpath(@__DIR__, ".."))
cmd = isempty(ARGS) ? "help" : ARGS[1]

if cmd == "run" && length(ARGS) >= 2
    include(joinpath(ROOT, "src", "Ressim.jl"))
    using .Ressim
    deck = abspath(ARGS[2])
    out = length(ARGS) >= 3 ? abspath(ARGS[3]) : joinpath(dirname(deck), "ressim_out")
    o = Ressim.run_deck(deck; outdir = out)
    res = o.result
    dt = diff(vcat(0.0, res.time))
    f = Ressim.field_totals(res)
    @printf("%s: %d cells, %d report steps, %d solver steps (%d cut), %.1f s\n", basename(deck), o.cells,
        o.stats.report_steps, o.stats.ministeps, o.stats.cuts, o.wall_seconds)
    @printf("cumulative production over %.0f days: oil %.4g stb, gas %.4g Mscf, water %.4g stb\n", res.time[end] / Ressim.DAY,
        sum(f[:oil_prod] .* dt) / Ressim.STB, sum(f[:gas_prod] .* dt) / Ressim.MSCF, sum(f[:water_prod] .* dt) / Ressim.STB)
    @printf("cumulative injection: water %.4g stb, gas %.4g Mscf\n", sum(f[:water_inj] .* dt) / Ressim.STB, sum(f[:gas_inj] .* dt) / Ressim.MSCF)
    isempty(o.notes) || println("deck keywords not fully honoured:\n  ", join(o.notes, "\n  "))
    println("summary: ", joinpath(out, "summary_field.csv"))
    try          # the same results as the binary summary pair other tools read
        files = Ressim.write_ecl_summary(o, joinpath(out, uppercase(first(splitext(basename(deck))))))
        println("binary summary: ", files.smspec, " and .UNSMRY (layout not yet checked by another program)")
    catch err
        println("binary summary not written: ", sprint(showerror, err))
    end
elseif cmd == "fracwell" && length(ARGS) >= 2
    include(joinpath(ROOT, "src", "Ressim.jl"))
    using .Ressim
    spec = Ressim.load_fracwell(abspath(ARGS[2]))
    out = length(ARGS) >= 3 ? abspath(ARGS[3]) : joinpath(dirname(abspath(ARGS[2])), spec.name * "_out")
    r = Ressim.run_fracwell(spec; outdir = out)
    @printf("%s: %d stages, %s mesh, %d cells, %d solver steps (%d cut), %.1f s\n", spec.name, length(r.stages), spec.mesh,
        r.run.cells, r.run.stats.ministeps, r.run.stats.cuts, r.run.wall_seconds)
    @printf("%-6s %12s %16s %16s %12s %12s %12s\n", "stage", "position ft", "half-length ft", "conduct. md-ft", "oil stb", "gas Mscf", "water stb")
    for s in r.stages
        @printf("%-6d %12.0f %16.0f %16.4g %12.0f %12.0f %12.1f\n", s.stage, s.position_ft, s.half_length_ft, s.conductivity_mdft, s.oil_stb, s.gas_mscf, s.water_stb)
    end
    @printf("%-6s %12s %16s %16s %12.0f %12.0f %12.1f   (%d months)\n", "total", "", "", "", sum(s.oil_stb for s in r.stages),
        sum(s.gas_mscf for s in r.stages), sum(s.water_stb for s in r.stages), spec.months)
    println("half-length is the value represented on the mesh. Files: ", out, " (deck, summary_field.csv, stages.csv)")
    try
        files = Ressim.write_ecl_summary(r, joinpath(out, uppercase(replace(spec.name, r"[^A-Za-z0-9_]" => "_"))))
        println("binary summary: ", files.smspec, " and .UNSMRY (layout not yet checked by another program)")
    catch err
        println("binary summary not written: ", sprint(showerror, err))
    end
elseif cmd == "design" && length(ARGS) >= 2
    include(joinpath(ROOT, "src", "Ressim.jl"))
    using .Ressim
    base, rock, designs, propped, prop, hours = Ressim.load_design(abspath(ARGS[2]))
    d = Ressim.design_well(base, rock, designs; propped_fraction = propped, proppant = prop, hours_between_stages = hours)
    out = length(ARGS) >= 3 ? abspath(ARGS[3]) : joinpath(dirname(abspath(ARGS[2])), base.name * "_out")
    r = Ressim.run_fracwell(d.spec; outdir = out)
    println("fracture growth (predicted), then production with that geometry:")
    @printf("%-6s %-8s %9s %8s %14s %12s %10s %14s %12s %12s\n", "stage", "cluster", "bpm", "minutes", "created xf ft", "height ft", "in pay", "used xf ft", "oil stb", "gas Mscf")
    for (i, s) in enumerate(r.stages)
        g = d.growth[i]; st = d.stage_of[i]; dz = designs[st]
        bpm = dz.clusters == 1 ? dz.rate_bpm_per_fracture : g.fluid_share * dz.rate_bpm_per_fracture * dz.clusters     # average over the job
        @printf("%-6d %-8s %9.1f %8.0f %14.0f %12.0f %9.0f%% %14.0f %12.0f %12.0f\n", st, dz.clusters == 1 ? "-" : string(count(==(st), d.stage_of[1:i])), bpm, dz.minutes, g.half_length_ft,
            g.height_at_well_ft, 100 * g.share_in_pay, s.half_length_ft, s.oil_stb, s.gas_mscf)
    end
    @printf("total over %d months: %.0f stb oil, %.0f Mscf gas (%s mesh, %d cells, %.1f s)\n", base.months, sum(s.oil_stb for s in r.stages),
        sum(s.gas_mscf for s in r.stages), base.mesh, r.run.cells, r.run.wall_seconds)
    if isnothing(prop)
        @printf("declared, not predicted: conductivity %s md-ft, conductive share of created length %.0f%%\n", join(unique(base.conductivity_mdft), "/"), 100 * propped)
    else
        println(!prop.settling ? "predicted from the proppant pumped (even spread over the fracture height, no settling):" : prop.settle_until_closure ?
            "predicted from the proppant pumped (banked while pumping; what was still in suspension falls only until the fracture closes):" :
            "predicted from the proppant pumped (settled into a bank at the bottom of the fracture):")
        for (i, pk) in enumerate(d.packs)
            @printf("  fracture %d: propped half-length %.0f ft, conductivity at the well %.1f md-ft, %.2f lb/ft2 at the well, pack %.1f darcy, %.0f%% of proppant in the pay\n", i,
                pk.propped_half_length / Ressim.FT, d.spec.conductivity_mdft[i], pk.areal_lb_ft2[1], pk.pack_permeability_darcy, 100 * pk.share_in_pay)
        end
    end
    isempty(d.notes) || println("notes:\n  ", join(d.notes, "\n  "))
    println("files: ", out)
elseif cmd == "validate"
    tier = length(ARGS) >= 2 ? ARGS[2] : "quick"; chosen_tests = length(ARGS) >= 3 ? ARGS[3] : nothing     # validate full name1,name2 runs just those tests
    empty!(ARGS); push!(ARGS, isnothing(chosen_tests) ? tier : "full"); isnothing(chosen_tests) || push!(ARGS, chosen_tests)
    include(joinpath(ROOT, "validation", "suite.jl"))
    tier == "full" && isnothing(chosen_tests) ? include(joinpath(ROOT, "validation", "scorecard.jl")) : println("SCORECARD.md is built from a complete full-tier run only and was left as it is")
elseif cmd == "scorecard"
    include(joinpath(ROOT, "validation", "scorecard.jl"))
else
    println("usage: ressim run <deck.DATA> [outdir] | fracwell <spec.toml> [outdir] | design <design.toml> [outdir] | validate [quick|full] | scorecard")
end
