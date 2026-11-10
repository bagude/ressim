# Validation suite. Usage: julia --project=<env> validation/suite.jl [quick|full]
# Two kinds of evidence, never mixed:
#   exact  - compared with a closed-form solution (independent of any simulator)
#   cross  - compared with published results of another simulator shipped with the benchmark data
#   self   - self-consistency only (symmetry, mesh sensitivity); shows the run is stable, not that it is right
# Pass bars are constants below. They were written before the first run of this suite (2026-11-09).
# A miss is reported as a miss; bars are not tuned to results.
#
# What changed after results were seen (no bar was moved):
#   - The slab bars and the step preset were chosen after an earlier refinement series on the same
#     problem, so they are not blind. The depleting case has almost no margin on month 1.
#   - SPE1 first ran on report steps; the comparison was switched to solver steps (as the engine's own
#     example does) after its first fail. It still fails.
#   - Egg first had an injector-pressure check; the reference file holds no pressures, so it was removed.
#   - The field-unit summary check was split out of the SPE1 test into its own test.
#   - The growth solver first ran at 400 cells and missed the heavy-leak-off bar (3.6% against 3%); its leak-off was
#     then coupled into the flow solve and the default raised to 800 cells (2.9%). The bar was not moved.
#   - The surface coupling loop first stalled on a few early steps (worst mismatch 655 psi after 40 iterations, and
#     the rate limit overshot) although cumulative oil already matched. The update was rewritten to follow time
#     order and the pressure clamp moved up to reservoir pressure. The bars were not moved.
#   - The multi-well tests first errored (the engine keeps the control object it was first given for a step, so
#     retries ignored the new node pressure), then missed the cumulative bar by 0.7-0.8% (each call started with
#     a one-day sub-step, and volumes were taken from end-of-step rates). Both were defects in my driver and were
#     fixed there. The bars were not moved.
#   - The height-growth cross-section first had its layer correction twice too large. Its own self-check caught
#     it before these tests existed; an interface-continuity check was added because the area check is blind to it.
#   - The priority-allocation test first also required the first well to out-produce the second whenever the
#     facility is full. That expectation was wrong, not the model: once the first well declines below the limit,
#     the rested second well fills the remainder and can exceed it. The check was removed; the first well still
#     has to match a well alone under the full limit, and the total still has to sit on the limit.
#   - The two-lateral tests first missed their mirror-symmetry bar (1e-4 against 1e-6). A diagnostic showed it is
#     solver tolerance (1e-11 at tight tolerances), so those tests now run tight. The bar was not moved.
#   - Several fractures growing together (2026-11-10). What changed after results were seen, no bar moved:
#       * The kernel, perforation and one-cluster checks first ran in a scratch script; their bars are not blind.
#         The tabulated kernel first missed its bar in the far field (2.5e-4 against 1e-5); the table now holds
#         (1 + x^2) times the kernel.
#       * The pair test first missed its length bar (1.23% against 1%) with the first flow scheme. That scheme and a
#         second one did not converge for close clusters and were replaced (upwind conductance with a correction from
#         the old pressures); the pair test passes with it at the same 300 cells.
#       * Because the coupled scheme now differs from the single-fracture one, the far-apart test compares against a
#         lone fracture solved with the same scheme instead of `p3d_grow`.
#       * The interaction test first required a closer spacing to starve the middle cluster more. That expectation
#         was wrong: the middle cluster's handicap is the shadow factor at one spacing minus the factor at two
#         spacings, which is small both for very close and for distant clusters. The check was removed. A run with
#         no perforation friction was added to the friction check after its result had been seen.
#       * The kernel first used the mean height of the two fractures. A diagnostic showed the coupling then stops
#         being positive definite once fractures grow about 15% taller than the pay (runs blew up); it now uses the
#         neighbour's own height. This was changed after the published five-fracture numbers had been delivered but
#         before any comparison with them, and it makes no difference for contained fractures (that case).
#       * The published five-fracture comparison passes its bars, but they are share-of-total bars: in absolute
#         area the two squeezed fractures come out about a third larger than the reference.
#       * After review three measures were added: positive definiteness for grown fractures at unequal pressures,
#         the coupled flow scheme against the exact-flow scheme with barriers and leak-off, and mesh sensitivity of
#         the lengths (150 against 300 cells; their values at 150, 300 and 600 cells had been seen: 0.8% and 1.4%).
#   - Height in layered rock (2026-11-10): the published-case test first reported the wrong pressure for the upper tip
#     reaching 8990 ft (5777 instead of about 6898 psi). The defect was in the test: a helper function overwrote the
#     search variable. A separate trace of tips against pressure showed the model at 6898 psi before the test was fixed.
#   - Proppant settling (2026-11-10): the chain now settles proppant into a bank by default. The older proppant chain test
#     (`chain_proppant_to_production`) was written for the even-spread model and one of its checks is that model's
#     warning, so it now asks for that model explicitly (`settling = false`). In the one full run where it used the new
#     default it passed, but that check passed by accident (a different note contains the same word).
#     `design_well` now grows every stage through the multi-cluster solver, also for one cluster.
#   - Conductivity loss with drawdown (2026-11-10): the first run showed no effect at all. The engine reads the rock
#     tables from the deck but ignores the per-cell ROCKNUM map (it uses PVTNUM), so every cell got the matrix table.
#     `Ressim.rock_regions!` now sets the map on the model. Review then pointed out that the engine's permanent mode also
#     makes PORE VOLUME permanent in every cell, which alone moved late production by 25% in that first run; pore volume
#     is now kept reversible, and two measures were added (no loss after a hard drawdown; connection size).
#   - A multi-cluster run from the game session returned an infinite length for the outer clusters (the tip estimate
#     divides by a pressure difference that can change sign next to a shorter neighbour). Fixed in the solver;
#     `multifrac_tip_position` is the regression test, written after the fix.
#   - Rock varying across the map (2026-11-10): the test of equal pore volume and kh first missed (1.2e-4 against 1e-6).
#     The well connection factor was computed from gross thickness; it now uses net pay at the well cell, and the two
#     runs agree exactly. The bar was not moved.
#   - After the map test's first full run, the generated geology gained a gross-thickness field (net = gross x net-to-gross),
#     so that test's geology-driven run now takes the largest gross thickness as the model thickness. Its other runs
#     and all bars are unchanged.
#   - SPE3 against MRST misses its gas-rate bar (3.7% against 2%) and is reported as a miss. Investigated 2026-11-10: the two
#     runs agree to 0.02% in rate and 0.003 bar in pressure for the first 15 years; cumulative gas is identical to four digits
#     up to the step in which the producer reaches its pressure limit. The whole difference is in the final blowdown, which
#     runs below the lowest pressure of the fluid table (1,214.7 psia; the limit is 1,050 psia). The engine conserves mass
#     exactly there but releases almost no gas per bar below the table (it holds the gas properties constant), while MRST
#     extrapolates. Neither is given by the data. The test and its bar are unchanged; it remains a miss.
#   - `design_well` now lets each stage feel what the stage before it still holds open (2026-11-10); the older chain tests
#     run with that default.
#   - SPE9's injector-pressure check is trivial (the injector sits on its pressure limit in both runs).
include(joinpath(@__DIR__, "..", "src", "Ressim.jl"))
using .Ressim
using Jutul, JutulDarcy, HYPRE, DelimitedFiles, Printf, TOML, Dates
include(joinpath(@__DIR__, "models.jl"))

const TIER = length(ARGS) >= 1 ? ARGS[1] : "quick"
# Only the full tier writes the record the scorecard is built from; the quick tier has its own file, so a quick check
# cannot overwrite the full record.
const OUT = joinpath(@__DIR__, TIER == "full" ? "results.toml" : "results_quick.toml")

# ---- pass bars ----------------------------------------------------------------------------------
const BAR_SLAB_CUM = 0.0025        # 24-month cumulative vs exact
const BAR_SLAB_CURVE = 0.005       # sum|V_m - V_exact| / sum V_exact, systems still producing at 24 months
const BAR_SLAB_CURVE_DEPL = 0.02   # same measure for a system that drains completely (stage-sim's frozen bar)
const BAR_SLAB_MONTH1 = 0.01       # first-month volume vs exact
const BAR_CUT_FRACTION = 0.05      # cut ministeps / accepted ministeps, robustness cases
const BAR_BL_L1 = 0.02             # 1000 cells: area between saturation profiles / volume injected
const BAR_BL_RATIO = 1 / 3         # error at 1000 cells must be below this fraction of the error at 100
const BAR_BL_FRONT = 0.01          # front position, fraction of length
const BAR_RATE = 0.02              # cross-simulator, single-well rate series (time-integrated relative difference)
const BAR_FIELD_RATE = 0.03        # cross-simulator, field totals of multi-well cases
const BAR_BHP = 0.01               # cross-simulator, bottom-hole pressure series
const BAR_PROFILE = 0.02           # cross-simulator, mean absolute difference of saturation / mole fraction profiles

# ---- bookkeeping --------------------------------------------------------------------------------
const TESTS = Dict{String, Any}[]
chk(name, value, bar) = Dict{String, Any}("name" => name, "value" => Float64(value), "bar" => Float64(bar),
    "pass" => isfinite(value) && abs(value) <= bar)

function record(f, id, title, kind, reference)
    d = Dict{String, Any}("id" => id, "title" => title, "kind" => kind, "reference" => reference)
    t = @elapsed try
        r = f()
        d["checks"] = r.checks
        d["status"] = all(c["pass"] for c in r.checks) ? "pass" : "fail"
        for k in (:cells, :ministeps, :cuts, :notes, :detail)
            haskey(r, k) && (d[String(k)] = getfield(r, k))
        end
    catch e
        d["status"] = "error"; d["checks"] = Dict{String, Any}[]
        d["detail"] = first(sprint(showerror, e), 400)
    end
    d["seconds"] = round(t, digits = 2)
    push!(TESTS, d)
    @printf("%-28s %-5s %6.1fs  %s\n", id, d["status"], t,
        join([@sprintf("%s=%.3g%s", c["name"], c["value"], c["pass"] ? "" : "(>" * @sprintf("%.3g", c["bar"]) * ")") for c in d["checks"]], "  "))
    d["status"] == "error" && println("    ", d["detail"])
    flush(stdout)
    open(io -> TOML.print(io, Dict("tier" => TIER, "date" => string(Dates.today()), "engine" => "JutulDarcy " * string(pkgversion(JutulDarcy)),
        "julia" => string(VERSION), "test" => TESTS)), OUT, "w")
end

# ---- exact: single-phase depletion --------------------------------------------------------------
function slab_checks(r; depleting = false)
    cum = (sum(r.sim) - sum(r.exact)) / sum(r.exact)
    curve = sum(abs.(r.sim .- r.exact)) / sum(r.exact)
    m1 = (r.sim[1] - r.exact[1]) / r.exact[1]
    checks = [chk("cum", cum, BAR_SLAB_CUM), chk("curve", curve, depleting ? BAR_SLAB_CURVE_DEPL : BAR_SLAB_CURVE),
        chk("month1", m1, BAR_SLAB_MONTH1)]
    return (checks = checks, cells = r.cells, ministeps = r.stats.ministeps, cuts = r.stats.cuts)
end

const SLAB_REF = "closed-form linear diffusion (series solution)"
record("exact_slab_inf", "Single-phase depletion, infinite-acting (square-root-of-time flow)", "exact", SLAB_REF) do
    slab_checks(run_slab(L = 99.0, k_m_ud = 1.0))
end
record("exact_slab_trans", "Single-phase depletion, transient to boundary-dominated", "exact", SLAB_REF) do
    slab_checks(run_slab(L = 49.0, k_m_ud = 2.5))
end
record("exact_slab_depl", "Single-phase depletion, drained to the well pressure", "exact", SLAB_REF) do
    slab_checks(run_slab(L = 24.0, k_m_ud = 6.0); depleting = true)
end
for (tag, kc) in (("1e5", 1.0e5), ("1e6", 1.0e6))
    record("robust_contrast_$tag", "Robustness: $(tag) mD strip against 2.5 microdarcy rock", "exact", SLAB_REF) do
        r = run_slab(L = 49.0, k_m_ud = 2.5, k_c_md = kc, WI = 2e-8)
        s = slab_checks(r)
        push!(s.checks, chk("cut_fraction", r.stats.cuts / r.stats.ministeps, BAR_CUT_FRACTION))
        s
    end
end

# ---- exact: two-phase displacement --------------------------------------------------------------
record("exact_buckley_leverett", "Two-phase water flood, Buckley-Leverett front", "exact", "Buckley-Leverett / Welge closed form") do
    a = run_bl(100); b = run_bl(1000)
    l1(r) = sum(abs.(r.sw .- r.exact)) / length(r.sw) / r.pvi
    checks = [chk("L1_1000", l1(b), BAR_BL_L1), chk("L1_ratio", l1(b) / l1(a), BAR_BL_RATIO),
        chk("front", b.x_front_sim - b.x_front, BAR_BL_FRONT), chk("injected", b.injected_check, 0.002)]
    (checks = checks, cells = 1000, ministeps = b.stats.ministeps, cuts = b.stats.cuts,
        detail = @sprintf("L1 at 100 cells %.4f, at 1000 cells %.4f; exact front at %.4f", l1(a), l1(b), b.x_front))
end

# ---- fracture growth (one contained fracture) ---------------------------------------------------
# Bars written before the first run of these tests (2026-11-09).
const BAR_GROW_VOLUME = 1e-9      # injected = in fracture + leaked off
const BAR_GROW_EXPONENT = 0.01    # time exponents of length (4/5) and inlet opening (1/5), no leak-off
const BAR_GROW_COEFF = 0.01       # length and inlet opening against the similarity solution
const BAR_GROW_GRID = 0.01        # half against full default resolution
const BAR_GROW_PUBLISHED = 0.002  # similarity constants against published four-digit values (added after the match was known)
const BAR_GROW_LEAK = 0.03        # length against the everything-leaks-off limit
const GROW = (height = 30.0, Eprime = 3.0e10, mu = 1.0e-3, q_wing = 25 * Ressim.BPM, t_end = 3600.0)

record("growth_volume_balance", "Fracture growth: fluid account with leak-off", "exact", "conservation: injected = in the fracture + leaked off") do
    r = Ressim.pkn_grow(; GROW..., C_L = 5e-5)
    (checks = [chk("balance", (r.V_injected - r.V_fracture - r.V_leaked) / r.V_injected, BAR_GROW_VOLUME)], cells = 800,
        detail = @sprintf("length %.0f m after 60 min, efficiency %.1f%%", r.L[end], 100 * r.efficiency))
end

record("growth_no_leakoff", "Fracture growth without leak-off: length and opening against the similarity solution", "exact",
        "similarity solution by shooting (a different numerical method), itself checked against published constants (PyFrac, Dontsov 2021)") do
    r = Ressim.pkn_grow(; GROW...); c = Ressim.pkn_grow(; GROW..., ncell = 400)
    sim = Ressim.pkn_similarity()
    k = findfirst(>=(GROW.t_end / 4), r.t)
    expo(y) = log(y[end] / y[k]) / log(r.t[end] / r.t[k])
    L_exact = sim.c_L * (GROW.Eprime * GROW.q_wing^3 / (GROW.mu * GROW.height^4))^(1 / 5) * GROW.t_end^(4 / 5)
    w_exact = sim.c_w * (GROW.mu * GROW.q_wing^2 / (GROW.Eprime * GROW.height))^(1 / 5) * GROW.t_end^(1 / 5)
    (checks = [chk("L_exponent", expo(r.L) - 0.8, BAR_GROW_EXPONENT), chk("w_exponent", expo(r.w0) - 0.2, BAR_GROW_EXPONENT),
            chk("length", r.L[end] / L_exact - 1, BAR_GROW_COEFF), chk("opening", r.w0[end] / w_exact - 1, BAR_GROW_COEFF),
            chk("grid", c.L[end] / r.L[end] - 1, BAR_GROW_GRID), chk("similarity_volume", sim.volume_check, 1e-4),
            # published constants, total rate Q0 = 2 q: PyFrac HF_reference_solutions.py `PKN_solution` (read 2026-11-09),
            # length 1.001 (1/(4 pi^3))^(1/5) = 0.3817, also Dontsov arXiv:2110.13088; maximum inlet opening (4/pi) 1.326 (pi^3/8)^(1/5)
            chk("published_length", sim.c_L * 8.0^(-1 / 5) / (1.001 * (1 / (4 * pi^3))^(1 / 5)) - 1, BAR_GROW_PUBLISHED),
            chk("published_opening", sim.c_w * 4.0^(-1 / 5) / (4 / pi * 1.326 * (pi^3 / 8)^(1 / 5)) - 1, BAR_GROW_PUBLISHED), chk("balance", (r.V_injected - r.V_fracture) / r.V_injected, BAR_GROW_VOLUME)],
        cells = 800, detail = @sprintf("similarity constants: length %.4f, inlet opening %.4f (rate per wing, plane-strain modulus)", sim.c_L, sim.c_w))
end

record("growth_leakoff_limit", "Fracture growth with heavy leak-off: length against the leak-off limit", "exact",
        "closed form when nearly all fluid leaks off: L = q sqrt(t) / (pi C h)") do
    C = 5e-4
    r = Ressim.pkn_grow(; GROW..., C_L = C)
    L_exact = GROW.q_wing * sqrt(GROW.t_end) / (pi * C * GROW.height)
    (checks = [chk("length", r.L[end] / L_exact - 1, BAR_GROW_LEAK), chk("balance", (r.V_injected - r.V_fracture - r.V_leaked) / r.V_injected, BAR_GROW_VOLUME)],
        cells = 800, detail = @sprintf("efficiency %.1f%%; the limit assumes 0%%, so the solver should sit slightly below it. Measured shortfall at 400 / 800 / 1,600 cells: 3.6%% / 2.9%% / 2.4%% (2026-11-09), i.e. the solver converges slowly here and about 1.5 points of the gap at 800 cells is numerical", 100 * r.efficiency))
end

# ---- fracture growth with height (pseudo-3-D) ---------------------------------------------------
# These bars are NOT blind: a diagnostic script had already printed the self-check, contained-limit and
# 200-vs-400-cell values when they were written (2026-11-09). Only the interface and table bars were unseen.
const BAR_P3D_TABLE = 0.005       # length, 240 against 480 pressure-table entries (unseen when written)
const BAR_SEC_UNIFORM = 1e-3      # Green's function against the uniform-pressure crack
const BAR_SEC_AREA = 5e-3         # area from the opening against the reciprocity formula
const BAR_SEC_TIP = 0.02          # stress intensity from the near-tip opening against the weight-function formula
const BAR_SEC_INTERFACE = 5e-3    # opening must be continuous across the pay/barrier boundary
const BAR_P3D_LIMIT = 0.005       # against the constant-height model when the barriers cannot break
const BAR_P3D_GRID = 0.02         # length, 200 against 400 cells

record("height_section_formulas", "Height growth: cross-section formulas (stress intensity, area, opening) checked against each other", "exact",
        "the uniform-pressure crack, the reciprocity area and the weight-function stress intensity (plane strain)") do
    st = Ressim.section_self_test()
    (checks = [chk("uniform", st.uniform, BAR_SEC_UNIFORM), chk("area", st.area, BAR_SEC_AREA), chk("tip", st.tip, BAR_SEC_TIP),
            chk("interface", st.interface, BAR_SEC_INTERFACE)],
        detail = "a first version had the layer correction twice too large; the area check could not see it (the error cancels in the integral), the uniform-load and tip checks did")
end

record("height_contained_limit", "Height growth with unbreakable barriers: must equal the constant-height model", "exact",
        "the constant-height model above (checked against published constants)") do
    checks = Dict{String, Any}[]
    for (tag, C) in (("", 0.0), ("_leakoff", 5e-5))
        a = Ressim.pkn_grow(; GROW..., C_L = C, ncell = 400)
        b = Ressim.p3d_grow(; pay = GROW.height, dsigma = 1.0e9, KIc = 0.0, Eprime = GROW.Eprime, mu = GROW.mu, q_wing = GROW.q_wing, t_end = GROW.t_end, C_L = C, ncell = 400)
        push!(checks, chk("length" * tag, b.L[end] / a.L[end] - 1, BAR_P3D_LIMIT), chk("pressure" * tag, b.p0[end] / a.pnet0[end] - 1, BAR_P3D_LIMIT),
            chk("balance" * tag, (b.V_injected - b.V_fracture - b.V_leaked) / b.V_injected, BAR_GROW_VOLUME))
    end
    (checks = checks, cells = 400)
end

record("height_growth_barriers", "Height growth through barriers: 870 psi and 435 psi stress contrast, and a barrier too weak to hold", "self",
        "its own conditions: fluid account, mesh sensitivity, taller and shorter with a weaker barrier, runaway reported") do
    run(ds; nc = 400) = Ressim.p3d_grow(; pay = GROW.height, dsigma = ds, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, q_wing = GROW.q_wing, t_end = GROW.t_end, C_L = 5e-5, ncell = nc)
    strong = run(6.0e6); weak = run(3.0e6); coarse = run(3.0e6; nc = 200)
    fine_table = Ressim.p3d_grow(; pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, q_wing = GROW.q_wing, t_end = GROW.t_end, C_L = 5e-5, ncell = 400, ntable = 480)
    ran_away = try
        run(0.8e6); false
    catch e
        occursin("runaway", sprint(showerror, e))
    end
    bal(r) = (r.V_injected - r.V_fracture - r.V_leaked) / r.V_injected
    (checks = [chk("balance", max(abs(bal(strong)), abs(bal(weak))), BAR_GROW_VOLUME), chk("grid", coarse.L[end] / weak.L[end] - 1, BAR_P3D_GRID),
            chk("table", fine_table.L[end] / weak.L[end] - 1, BAR_P3D_TABLE), chk("table_height", fine_table.h0[end] / weak.h0[end] - 1, BAR_P3D_TABLE),
            chk("taller_when_weaker", weak.h0[end] > strong.h0[end] ? 0.0 : 1.0, 0.5), chk("shorter_when_weaker", weak.L[end] < strong.L[end] ? 0.0 : 1.0, 0.5),
            chk("runaway_reported", ran_away ? 0.0 : 1.0, 0.5)],
        cells = 400, detail = @sprintf("98 ft pay, 60 min at 25 bpm per wing: 870 psi barrier gives %.0f ft half-length and %.0f ft height at the well; 435 psi gives %.0f ft and %.0f ft; 116 psi cannot contain the fracture",
            strong.L[end] / Ressim.FT, strong.h0[end] / Ressim.FT, weak.L[end] / Ressim.FT, weak.h0[end] / Ressim.FT))
end

# Published case for a fracture whose height is growing. Bars written before the first run, unseen (2026-11-09).
# Inputs: Dontsov & Peirce (2015), Eng. Fract. Mech. 142:116, section 2 / Fig. 8 (laboratory scale, no leak-off):
#   H = 0.05 m, stress contrast 4.3 MPa, E = 3.3 GPa, nu = 0.4, viscosity 30.2 Pa s, 1.7e-9 m3/s into both wings, t = 604 s.
# Expected half-length / height at the well for the classical equilibrium-height model, digitised from the figures
# (about 1%) by a research agent and cross-checked against Adachi, Detournay & Peirce (2010) Figs 9 and 11:
#   K_Ic = 0:                132.7 mm / 127.5 mm   (Adachi: 132.1 / 127.2)
#   K_Ic = dsig sqrt(H/2pi): 143.1 mm /  76.8 mm   (Adachi: 142.1 /  77.2)
#   K_Ic = 0.94 MPa m^0.5:   162.0 mm /  53.0 mm   (contained; the constant-height length is 161.6 mm)
# I did not re-open the papers; see research/p3d-benchmarks-and-interaction.md.
const BAR_P3D_PUBLISHED = 0.03
record("height_growth_published", "Height growing through barriers: published laboratory-scale case at three toughness values", "cross",
        "Dontsov & Peirce (2015) Fig. 8 and Adachi et al. (2010) Figs 9, 11, classical pseudo-3-D model (digitised, about 1%)") do
    H = 0.05; ds = 4.3e6; Ep = 3.3e9 / (1 - 0.4^2)
    cases = (("K0", 0.0, 0.1327, 0.1275), ("K1", ds * sqrt(H / (2 * pi)), 0.1431, 0.0768), ("K094", 0.94e6, 0.1620, 0.0530))
    checks = Dict{String, Any}[]; out = String[]
    for (tag, K, L_ref, h_ref) in cases
        r = Ressim.p3d_grow(; pay = H, dsigma = ds, KIc = K, Eprime = Ep, mu = 30.2, q_wing = 0.85e-9, t_end = 604.0, ncell = 400)
        push!(checks, chk("length_" * tag, r.L[end] / L_ref - 1, BAR_P3D_PUBLISHED), chk("height_" * tag, r.h0[end] / h_ref - 1, BAR_P3D_PUBLISHED))
        push!(out, @sprintf("%s: %.1f mm long, %.1f mm high (published %.1f, %.1f)", tag, 1e3 * r.L[end], 1e3 * r.h0[end], 1e3 * L_ref, 1e3 * h_ref))
    end
    (checks = checks, cells = 400, detail = join(out, "; "))
end

using LinearAlgebra
# ---- several fractures growing together from one stage (multifrac.jl) ------------------------------
# The shadow kernel was chosen and frozen on 2026-11-10 BEFORE any published multi-fracture numbers were read:
# Westergaard's plane-strain stress averaged over the neighbour's height with the weight of an elliptical opening.
# The kernel, perforation and one-cluster checks were first run in a scratch script, so their bars are not blind.
# The bars of the pair, far-apart, limited-entry and interaction tests were written before their first run.
const BAR_MF_KERNEL = 1e-6        # Westergaard field against Sneddon's formula; two routes to the weighted average
const BAR_MF_TABLE = 1e-5         # tabulated kernel against the quadrature
const BAR_MF_ROW = 1e-3           # plain height average against values computed independently for the research note (three digits)
const BAR_MF_SAME = 1e-8          # one cluster against the single-fracture solver
const BAR_MF_SPLIT = 1e-6         # identical clusters must take identical shares
const BAR_MF_LIMIT = 1e-3         # far-apart clusters against separate fractures
const BAR_MF_ENTRY = 0.005        # friction-dominated split against the ratio of perforation counts
const BAR_MF_GRID = 0.02          # middle cluster's share, 150 against 300 cells
const BAR_PERF_PUBLISHED = 0.005  # field-unit constant against the published 0.2369 (sources differ by 0.3%)

record("shadow_kernel", "Stress shadow of one fracture on its neighbour: formula checks", "exact",
        "Sneddon's centre-line formula; the height-weighted value by two independent routes; positive-definite coupling") do
    mid = maximum(abs(Ressim.shadow_field(x, 0.0, 1.0) / Ressim.shadow_midline(x) - 1) for x in (0.05, 0.2, 0.5, 1.0, 2.0, 4.0, 6.0))
    routes = maximum(abs(Ressim.shadow_weighted_quadrature(x; n = 4000) / Ressim.shadow_weighted_fourier(x) - 1) for x in (0.3, 0.5, 1.0, 2.0))
    table = maximum(abs(Ressim.shadow_weighted(x)[1] / Ressim.shadow_weighted_quadrature(x; n = 4000) - 1) for x in (0.11, 0.3, 0.77, 1.9, 6.3, 40.0))
    row = maximum(abs(Ressim.shadow_average(2 * dh) - v) for (dh, v) in ((0.1, 0.766), (0.25, 0.612), (0.5, 0.431), (1.0, 0.223), (1.5, 0.127), (2.0, 0.080), (3.0, 0.039)))
    lowest(kernel) = minimum(minimum(eigvals(Symmetric(Ressim.shadow_matrix(collect(0:n-1) .* x, 1.0; kernel = kernel)))) for n in 2:10, x in (0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2.0, 4.0, 10.0))
    e_w = lowest(x -> Ressim.shadow_weighted(x)[1]); e_mid = lowest(Ressim.shadow_midline)
    # the same question for fractures that have grown into the barriers, at equal and at unequal pressures (added after review).
    # First run: not positive definite at the top of the table (fractures 5 times the pay height). That is the model, not a
    # defect: see the header of multifrac.jl. The check now covers heights up to 1.5 times the pay and reports where it is lost.
    T = Ressim.section_table(pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, p_pkn = 1.2e6)
    e_tall = Inf; lost = Dict{Int, Float64}()
    for pos in ([0.0, 7.5, 15.0], collect(0.0:3.0:12.0)), f in 0.01:0.01:0.99, shape in (:equal, :outer_high, :middle_high)
        n = length(pos); ctr = (n + 1) / 2
        pr = [T.p_top * f * (shape == :equal ? 1.0 : (shape == :outer_high ? 0.5 + 0.5 * abs(k - ctr) / (ctr - 1) : 1.0 - 0.5 * abs(k - ctr) / (ctr - 1))) for k in 1:n]
        B = Ressim.shadow_increment(T, pos, pr; Eprime = GROW.Eprime)
        e = minimum(eigvals(Symmetric((B + B') / 2))); tall = maximum(Ressim.sec_lookup(T, v)[6] for v in pr) / (GROW.height / 2)
        tall <= 1.5 && (e_tall = min(e_tall, e))
        e <= 0 && (lost[n] = min(get(lost, n, Inf), tall))
    end
    (checks = [chk("centre_line", mid, BAR_MF_KERNEL), chk("two_routes", routes, BAR_MF_KERNEL), chk("table", table, BAR_MF_TABLE), chk("height_average", row, BAR_MF_ROW),
            chk("positive_definite", e_w > 0 ? 0.0 : 1.0, 0.5), chk("positive_definite_grown", e_tall > 0 ? 0.0 : 1.0, 0.5)],
        detail = @sprintf("2 to 10 contained fractures, spacing 0.01 to 5 heights: smallest eigenvalue of the coupling is %.4f with the height-weighted kernel (stable) and %.3f with the centre-line value alone (unstable, not used). Grown fractures up to 1.5 times the pay height, equal and unequal pressures: smallest eigenvalue %.3f; positive definiteness is lost at %.1f times the pay height for three clusters a quarter of a height apart and %.1f times for five clusters a tenth apart",
            e_w, e_mid, e_tall, get(lost, 3, Inf), get(lost, 5, Inf)))
end

record("perforation_friction", "Pressure drop through a cluster's perforations", "exact", "orifice equation by hand; field-unit constant against the published 0.2369") do
    v = 0.01 / (4 * pi * 0.01^2 / 4)                                   # 0.01 m3/s through 4 holes of 10 mm
    hand = 1000.0 * v^2 / (2 * 0.7^2)
    field = Ressim.perforation_drop(Ressim.BPM; shots = 1, diameter = Ressim.INCH, discharge = 1.0, density = Ressim.LB_GAL) / Ressim.PSI
    (checks = [chk("by_hand", Ressim.perforation_drop(0.01; shots = 4, diameter = 0.01, discharge = 0.7, density = 1000.0) / hand - 1, 1e-12),
            chk("published_constant", field / 0.2369 - 1, BAR_PERF_PUBLISHED)],
        detail = @sprintf("0.01 m3/s through four 10 mm holes at Cd 0.7 costs %.0f psi; field-unit constant %.4f", hand / Ressim.PSI, field))
end

record("multifrac_one_cluster", "A stage with one cluster must equal the single-fracture solver (with barriers, leak-off and proppant)", "self",
        "the single-fracture height-growth solver, itself checked against exact and published results") do
    checks = Dict{String, Any}[]
    for (tag, kw) in (("_contained", (dsigma = 1e9, KIc = 0.0, C_L = 0.0)), ("_barriers", (dsigma = 3.0e6, KIc = 1.0e6, C_L = 2e-5)))
        prop = (schedule = [(0.3 * GROW.t_end, 0.05)], diameter = 2e-4, bridge = 3.0)
        a = Ressim.p3d_grow(; pay = GROW.height, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, kw..., q_wing = GROW.q_wing, ncell = 200, proppant = prop)
        b = Ressim.stage_grow(; pay = GROW.height, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, kw..., q_stage = 2 * GROW.q_wing, positions = [0.0], ncell = 200, proppant = prop).fractures[1]
        push!(checks, chk("length" * tag, b.L[end] / a.L[end] - 1, BAR_MF_SAME), chk("pressure" * tag, b.p0[end] / a.p0[end] - 1, BAR_MF_SAME),
            chk("height" * tag, b.h0[end] / a.h0[end] - 1, BAR_MF_SAME), chk("proppant" * tag, b.proppant_in_fracture / a.proppant_in_fracture - 1, BAR_MF_SAME),
            chk("leaked" * tag, (b.V_leaked - a.V_leaked) / a.V_injected, BAR_MF_SAME))
        if tag == "_barriers"       # the flow scheme used once fractures interact, on its own, against the exact-flow scheme (added after review, result unseen)
            c = Ressim.stage_grow(; pay = GROW.height, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, kw..., q_stage = 2 * GROW.q_wing, positions = [0.0], ncell = 200, flow = :upwind).fractures[1]
            push!(checks, chk("coupled_scheme_length", c.L[end] / a.L[end] - 1, BAR_MF_GRID), chk("coupled_scheme_height", c.h0[end] / a.h0[end] - 1, BAR_MF_GRID))
        end
    end
    (checks = checks, cells = 200)
end

record("multifrac_pair_stiffer", "Two identical fractures side by side: must grow like one fracture in stiffer rock", "exact",
        "similarity solution with the modulus raised by the shadow factor (exact for two contained, identical fractures)") do
    d = 15.0; phi = Ressim.shadow_weighted(d / (GROW.height / 2))[1]
    coeff = Ressim.perforation_drop(1.0; shots = 6, diameter = 0.4 * Ressim.INCH, discharge = 0.7, density = 1020.0)
    r = Ressim.stage_grow(; pay = GROW.height, dsigma = 1e9, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, q_stage = 4 * GROW.q_wing, positions = [0.0, d],
        perf_coeff = [coeff, coeff], ncell = 300)
    f = r.fractures; sim = Ressim.pkn_similarity()
    Es = GROW.Eprime * (1 + phi)
    L_exact = sim.c_L * (Es * GROW.q_wing^3 / (GROW.mu * GROW.height^4))^(1 / 5) * GROW.t_end^(4 / 5)
    w_exact = sim.c_w * (GROW.mu * GROW.q_wing^2 / (Es * GROW.height))^(1 / 5) * GROW.t_end^(1 / 5)
    p_exact = GROW.Eprime * w_exact / (2 * GROW.height)                    # the fracture's own net pressure: opening times the ROCK modulus
    bal = maximum(abs(x.V_injected - x.V_fracture - x.V_leaked) for x in f) / r.V_injected
    (checks = [chk("length", f[1].L[end] / L_exact - 1, BAR_GROW_COEFF), chk("net_pressure", f[1].p0[end] / p_exact - 1, BAR_GROW_COEFF),
            chk("shadow", f[1].shadow0 / (phi * f[1].p0[end]) - 1, BAR_GROW_COEFF), chk("equal_split", f[1].share - 0.5, BAR_MF_SPLIT), chk("balance", bal, BAR_GROW_VOLUME)],
        cells = 300, detail = @sprintf("15 m apart in a 30 m pay the shadow factor is %.3f: half-length %.0f m against %.0f m alone", phi, f[1].L[end],
            sim.c_L * (GROW.Eprime * GROW.q_wing^3 / (GROW.mu * GROW.height^4))^(1 / 5) * GROW.t_end^(4 / 5)))
end

record("multifrac_far_apart", "Three clusters far apart: equal shares, each the same as a fracture alone", "exact", "the limit of no interaction (a lone fracture on the same grid with the same flow scheme)") do
    kw = (pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, ncell = 150, xmax = 1500.0)
    alone = Ressim.stage_grow(; kw..., q_stage = 2 * GROW.q_wing, positions = [0.0], flow = :upwind).fractures[1]
    r = Ressim.stage_grow(; kw..., q_stage = 6 * GROW.q_wing, positions = [0.0, 1500.0, 3000.0])
    f = r.fractures
    (checks = [chk("share", maximum(abs(3 * x.share - 1) for x in f), BAR_MF_LIMIT), chk("length", maximum(abs(x.L[end] / alone.L[end] - 1) for x in f), BAR_MF_LIMIT),
            chk("height", maximum(abs(x.h0[end] / alone.h0[end] - 1) for x in f), BAR_MF_LIMIT)], cells = 150)
end

record("multifrac_limited_entry", "Two clusters with 6 and 3 perforations, friction far above net pressure: the split must follow the perforation count", "exact",
        "friction-dominated limit: rate ratio equals the ratio of perforation counts") do
    q_stage = 4 * GROW.q_wing
    K = 3.0e8 / (2 * q_stage / 3)^2                                       # 300 MPa across the 6-shot cluster at two thirds of the rate
    r = Ressim.stage_grow(; pay = GROW.height, dsigma = 1e9, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, q_stage = q_stage, positions = [0.0, 1500.0],
        perf_coeff = [K, 4K], ncell = 150)
    f = r.fractures
    (checks = [chk("split", (f[1].share / f[2].share) / 2 - 1, BAR_MF_ENTRY), chk("friction", f[1].perf_drop / 3.0e8 - 1, 0.02)], cells = 150,
        detail = @sprintf("shares %.4f and %.4f; friction %.0f MPa against %.1f MPa net pressure", f[1].share, f[2].share, f[1].perf_drop / 1e6, f[1].p0[end] / 1e6))
end

TIER == "full" && record("multifrac_interaction", "Three and five clusters close together: the middle ones are squeezed, perforation friction evens the split", "self",
        "its own conditions: mirror symmetry, reversal, fluid account per fracture, direction of every effect, mesh sensitivity") do
    perf(shots) = Ressim.perforation_drop(1.0; shots = shots, diameter = 0.4 * Ressim.INCH, discharge = 0.7, density = 1020.0)
    run(pos, shots; nc = 150) = Ressim.stage_grow(; pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5,
        q_stage = 60 * Ressim.BPM, positions = pos, perf_coeff = fill(perf(shots), length(pos)), ncell = nc)
    near = [0.0, 7.5, 15.0]; wide = [0.0, 15.0, 30.0]
    open_near = run(near, 20); open_wide = run(wide, 20); tight_near = run(near, 6); fine = run(near, 20; nc = 300)
    bare = Ressim.stage_grow(; pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, q_stage = 60 * Ressim.BPM, positions = near, ncell = 150)
    uneven = run([0.0, 6.0, 16.0], 20); mirrored = run([0.0, 10.0, 16.0], 20)
    five = run(collect(0.0:3.0:12.0), 12)                                 # spacing one tenth of the height
    sh(r) = [x.share for x in r.fractures]
    bal(r) = maximum(abs(x.V_injected - x.V_fracture - x.V_leaked) for x in r.fractures) / r.V_injected
    f = uneven.fractures
    direct = Ressim.shadow_stress(uneven.table, [x.position for x in f], [x.p[1] for x in f]; Eprime = GROW.Eprime)
    all_runs = (open_near, open_wide, tight_near, fine, uneven, mirrored, five, bare)
    (checks = [chk("mirror", sh(open_near)[1] / sh(open_near)[3] - 1, BAR_MF_SPLIT), chk("mirror_five", max(abs(sh(five)[1] / sh(five)[5] - 1), abs(sh(five)[2] / sh(five)[4] - 1)), BAR_MF_SPLIT),
            chk("reversal", maximum(abs.(sh(uneven) ./ reverse(sh(mirrored)) .- 1)), BAR_MF_SPLIT),
            chk("balance", maximum(bal(r) for r in all_runs), BAR_GROW_VOLUME), chk("no_backflow", all(all(x.V_injected >= 0 for x in r.fractures) for r in all_runs) ? 0.0 : 1.0, 0.5),
            chk("assembly", maximum(abs.(direct .- [x.shadow0 for x in f])) / maximum(direct), 1e-9),
            chk("middle_squeezed", sh(open_near)[2] < sh(open_near)[1] && sh(open_wide)[2] < sh(open_wide)[1] ? 0.0 : 1.0, 0.5),
            chk("friction_evens", sh(bare)[2] < sh(open_near)[2] < sh(tight_near)[2] < 1 / 3 ? 0.0 : 1.0, 0.5),
            chk("grid", sh(fine)[2] / sh(open_near)[2] - 1, BAR_MF_GRID),
            chk("grid_length", maximum(abs(fine.fractures[k].L[end] / open_near.fractures[k].L[end] - 1) for k in 1:3), BAR_MF_GRID)],
        cells = 150, detail = @sprintf("30 m pay, 60 bpm for 60 min. Three clusters 7.5 m apart: shares %s with no perforation friction, %s with 20 shots each, %s with 6 shots. 15 m apart, 20 shots: %s. Five clusters 3 m apart, 12 shots: %s",
            string(round.(sh(bare), digits = 3)), string(round.(sh(open_near), digits = 3)), string(round.(sh(tight_near), digits = 3)), string(round.(sh(open_wide), digits = 3)), string(round.(sh(five), digits = 3))))
end

# Published case: five constant-height fractures 20 m apart in a 20 m layer, against the planar-3-D code ILSA.
# Bars written before the first run of this comparison (2026-11-10). Not blind in every respect: the reference areas were
# on screen when the bars were set, as were my own results for other three- and five-cluster cases, and both the flow
# scheme and the kernel height were changed after the reference had arrived (before this comparison was run).
# Source: Protasov, Peirce & Dontsov, ARMA 2018,
# Figs 3 and 4: E = 20 GPa, nu = 0.2, viscosity 3e-3 Pa s, 0.03 m3/s into the stage, no leak-off, t = 351 s.
# Footprint area per fracture, digitised (about 15 m2) by a research agent; I did not re-open the paper
# (research/multi-fracture-benchmarks.md). Zero perforation friction: outer 3359, next-to-outer 1775, middle 1969 m2,
# total printed 12229. Equal rate per fracture: outer 2476, the others 2630, total printed 12841.
# Known differences, stated before the run: the reference has rock toughness at the leading edge (1.6 MPa m^0.5)
# and full 3-D elasticity; this model has neither (local plane-strain shadow, no toughness along the length), and the
# inner fractures are only two heights long. The paper's own simplified model misses ILSA by +5 / -13 / +18 % per
# fracture at zero friction. The shadow kernel is the one frozen above; for contained fractures the later change of
# which height the kernel uses makes no difference.
const BAR_MF_PUBLISHED_SHARE = 0.20    # each fracture's share of total footprint area, zero friction
const BAR_MF_PUBLISHED_TOTAL = 0.15    # total footprint area
const BAR_MF_PUBLISHED_RATIO = 0.05    # equal rate: area of an inner fracture over an outer one (reference 1.062)
TIER == "full" && record("multifrac_published", "Five fractures 20 m apart against a planar-3-D reference (ILSA), with no perforation friction and with equal rates", "cross",
        "Protasov, Peirce & Dontsov (ARMA 2018) Figs 3, 4: ILSA footprint areas at 351 s (digitised, about 1%)") do
    H = 20.0; kw = (pay = H, dsigma = 1e9, Eprime = 20e9 / (1 - 0.2^2), mu = 3e-3, t_end = 351.0, q_stage = 0.03, positions = collect(0.0:20.0:80.0), ncell = 200)
    free = Ressim.stage_grow(; kw...)
    even = Ressim.stage_grow(; kw..., perf_coeff = fill(3.0e8 / (0.03 / 5)^2, 5))
    area(r) = [2 * x.L[end] * H for x in r.fractures]
    a = area(free); b = area(even); ref = [3359.0, 1775.0, 1969.0, 1775.0, 3359.0]
    (checks = [chk("share_outer", (a[1] / sum(a)) / (ref[1] / sum(ref)) - 1, BAR_MF_PUBLISHED_SHARE), chk("share_inner", (a[2] / sum(a)) / (ref[2] / sum(ref)) - 1, BAR_MF_PUBLISHED_SHARE),
            chk("share_middle", (a[3] / sum(a)) / (ref[3] / sum(ref)) - 1, BAR_MF_PUBLISHED_SHARE), chk("total_area", sum(a) / 12229.0 - 1, BAR_MF_PUBLISHED_TOTAL),
            chk("equal_rate_ratio", (b[2] / b[1]) / (2630.0 / 2476.0) - 1, BAR_MF_PUBLISHED_RATIO), chk("equal_rate_total", sum(b) / 12841.0 - 1, BAR_MF_PUBLISHED_TOTAL)],
        cells = 200, detail = @sprintf("no friction: areas %s m2 (reference 3359, 1775, 1969, 1775, 3359); equal rates: %s m2 (reference 2476, 2630, 2630, 2630, 2476)",
            string(round.(Int, a)), string(round.(Int, b))))
end

TIER == "full" && record("chain_clusters_to_production", "Stages with several clusters to production in one call: weak against strong perforation friction", "self",
        "its own conditions: shares add up, outer clusters mirror each other in growth and in production, strong friction evens the split") do
    base = Ressim.FracWellSpec(name = "chain_clusters", fluid = "oil", months = 6, mesh = "coarse", width_ft = 1600.0, positions_ft = [200.0, 400.0], edge_ft = 100.0,
        half_length_ft = [1.0, 1.0], conductivity_mdft = [50.0, 50.0], thickness_ft = 100.0)
    rock = Ressim.RockSpec(barrier_psi = 600.0, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.002)
    job(shots) = Ressim.StageDesign(rate_bpm_per_fracture = 15.0, minutes = 60.0, clusters = 3, cluster_spacing_ft = 40.0, shots_per_cluster = shots)
    d = Ressim.design_well(base, rock, [job(24), job(4)]; propped_fraction = 0.6, ncell = 150)
    r = Ressim.run_fracwell(d.spec)
    sh = [g.fluid_share for g in d.growth]; oil = [x.oil_stb for x in r.stages]
    spread(v) = maximum(v) / minimum(v) - 1
    (checks = [chk("fractures", length(d.growth) - 6, 0.5), chk("shares_add_up", max(abs(sum(sh[1:3]) - 1), abs(sum(sh[4:6]) - 1)), 1e-9),
            chk("mirror_growth", d.growth[1].half_length_ft / d.growth[3].half_length_ft - 1, BAR_MF_SPLIT),
            chk("friction_evens", spread(sh[4:6]) < spread(sh[1:3]) ? 0.0 : 1.0, 0.5), chk("oil_positive", all(>(0), oil) ? 0.0 : 1.0, 0.5)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts,
        detail = @sprintf("three clusters 40 ft apart at 45 bpm per stage: 24 shots each gives shares %s and half-lengths %s ft; 4 shots each gives %s and %s ft",
            string(round.(sh[1:3], digits = 3)), string(round.(Int, [g.half_length_ft for g in d.growth[1:3]])), string(round.(sh[4:6], digits = 3)), string(round.(Int, [g.half_length_ft for g in d.growth[4:6]]))))
end

# ---- fracture height in layered rock with unequal stresses (layers.jl) ----------------------------
# The cross-section formula checks were first run in a scratch script, so their bars are not blind.
# The bars of the two growth tests were written before their first run (2026-11-10).
const BAR_LAYER_SAME = 1e-9       # equal barriers: tips and area against the three-layer formulas
const BAR_LAYER_FLOW = 1e-3       # equal barriers: integral of opening cubed against the three-layer quadrature
const BAR_LAYER_AREA = 1e-6       # unequal barriers: area from the series opening against the reciprocity formula
record("layers_section_formulas", "Height in layered rock: cross-section formulas with unequal barriers, and equal barriers against the three-layer formulas", "exact",
        "the symmetric three-layer formulas; stress intensity read from the opening at both tips; area by two routes") do
    st = Ressim.layer_self_test()
    (checks = [chk("equal_top", st.symmetric_top, BAR_LAYER_SAME), chk("equal_bottom", st.symmetric_bottom, BAR_LAYER_SAME), chk("equal_area", st.symmetric_area, BAR_LAYER_SAME),
            chk("equal_flow", st.symmetric_flow, BAR_LAYER_FLOW), chk("area", st.area, BAR_LAYER_AREA), chk("tip_up", st.tip_up, BAR_SEC_TIP), chk("tip_down", st.tip_down, BAR_SEC_TIP),
            chk("resting", st.resting, BAR_LAYER_SAME), chk("fluid_weight", st.fluid_weight, BAR_SEC_TIP)],
        detail = @sprintf("30 m pay, barrier 4 MPa above and 2 MPa below, 1.5 MPa net pressure: the fracture grows %.1f m up and %.1f m down", st.up_m, st.down_m))
end

# Published cases for height in layered rock with fluid weight. Bars written before the first run, my results unseen (2026-11-10).
# Source: S. Liu, PhD dissertation, Texas A&M (2017), ch. 4 (partly reprinted from Liu & Valko, SPE 173335), read by a research
# agent who also recomputed the printed numbers with an independent script (research/layered-height-benchmarks.md); I did not
# open the source. Conventions found by that recomputation, not stated in the source: net pressure is taken at the middle
# of the perforated layer over that layer's stress; fluid gradient = density / 144 psi/ft.
#   A. Three layers: 7700 psi above, 7100 psi in a 75 ft perforated layer, 8100 psi below; toughness 1000 psi sqrt(in);
#      fluid 62.4 lbm/ft3. Printed growth out of the layer: 3.76 ft up and 1.62 ft down at 200 psi net; 140 ft up and 33 ft down at 600 psi.
#   B. Six layers, tops 8990 / 9080 / 9170 / 9340 / 9380 / 9455 ft, stresses 7150 / 7150 / 5700 / 7350 / 5800 / 8200 psi,
#      toughness 2000 psi sqrt(in), fluid specific gravity 1.1, pressure quoted at 9255 ft. Printed: a crack held from 9170 to
#      9380 ft starts to grow at 5809 psi, and at 5777 psi with zero toughness; the upper tip reaches 8990 ft at 6898 psi, where the
#      lower tip is at 9501 ft (it has jumped through the weak layer at 9380 to 9455 ft on the way).
const BAR_LAYER_PUBLISHED = 0.02       # growth distances of case A
const BAR_LAYER_PUBLISHED_PSI = 0.01   # pressures of case B, as a fraction of the net pressure
const BAR_LAYER_PUBLISHED_FT = 2.0     # lower tip of case B, ft
record("layers_published", "Height in layered rock with fluid weight: two published cases (three layers; six layers with a jump through a weak layer)", "cross",
        "S. Liu, Texas A&M dissertation (2017), Tables 2 to 7, printed values") do
    FTm = Ressim.FT; psi = Ressim.PSI; Kin = psi * sqrt(Ressim.INCH)
    A = Ressim.three_layers(75 * FTm, 600 * psi, 1000 * psi; KIc = 1000 * Kin, gamma = (62.4 / 144) * psi / FTm)
    grow(p) = (t = Ressim.layer_tips(A, p * psi, -37.5 * FTm, 37.5 * FTm); ((t[2] - 37.5 * FTm) / FTm, (-37.5 * FTm - t[1]) / FTm))
    u2, d2 = grow(200.0); u6, d6 = grow(600.0)
    depth = [8990.0, 9080.0, 9170.0, 9340.0, 9380.0, 9455.0]; stress = [7150.0, 7150.0, 5700.0, 7350.0, 5800.0, 8200.0]
    # elevations are minus depths; layers from the bottom up. The top layer is extended upward, which changes nothing while the tip is below 8990 ft.
    six(K) = Ressim.StressLayers(reverse(-depth[2:end] .* FTm), reverse(stress .* psi), fill(K * Kin, 6), 4; gamma = 1.1 * (62.4 / 144) * psi / FTm)
    start_p(K) = begin                                   # pressure at which the first tip of the held crack reaches the toughness
        local L = six(K); local lo = 0.0; local hi = 2000.0     # local: the search below uses the same names
        for _ in 1:60
            m = 0.5 * (lo + hi); Kl, Ku = Ressim.layer_K(L, -9380 * FTm, -9170 * FTm, m * psi)
            max(Kl, Ku) > K * Kin ? (hi = m) : (lo = m)
        end
        5700.0 + 0.5 * (lo + hi)
    end
    L = six(2000.0); lo = 0.0; hi = 2400.0
    for _ in 1:50                                        # pressure at which the upper tip reaches 8990 ft, growing out of the 9170 to 9340 ft layer
        m = 0.5 * (lo + hi); t = Ressim.layer_tips(L, m * psi, -9340 * FTm, -9170 * FTm)
        (t[3] || t[2] >= -8990 * FTm) ? (hi = m) : (lo = m)
    end
    t = Ressim.layer_tips(L, lo * psi, -9340 * FTm, -9170 * FTm)
    (checks = [chk("A_up_200", u2 / 3.76 - 1, BAR_LAYER_PUBLISHED), chk("A_down_200", d2 / 1.62 - 1, BAR_LAYER_PUBLISHED), chk("A_up_600", u6 / 140.0 - 1, BAR_LAYER_PUBLISHED),
            chk("A_down_600", d6 / 33.0 - 1, BAR_LAYER_PUBLISHED), chk("B_start", (start_p(2000.0) - 5809.0) / 109.0, BAR_LAYER_PUBLISHED_PSI),
            chk("B_start_no_toughness", (start_p(0.0) - 5777.0) / 77.0, BAR_LAYER_PUBLISHED_PSI), chk("B_top_pressure", (5700.0 + lo - 6898.0) / 1198.0, BAR_LAYER_PUBLISHED_PSI),
            chk("B_lower_tip_ft", -t[1] / FTm - 9501.0, BAR_LAYER_PUBLISHED_FT)],
        detail = @sprintf("A: %.2f ft up and %.2f ft down at 200 psi, %.0f and %.0f ft at 600 psi (printed 3.76, 1.62, 140, 33). B: starts at %.0f psi, %.0f psi without toughness (printed 5809, 5777); upper tip at 8990 ft at %.0f psi with the lower tip at %.0f ft (printed 6898 psi, 9501 ft)",
            u2, d2, u6, d6, start_p(2000.0), start_p(0.0), 5700.0 + lo, -t[1] / FTm))
end

record("layers_equal_barriers", "Growth in layered rock with equal barriers must equal the three-layer height-growth solver", "exact",
        "the symmetric height-growth solver (same equations, different cross-section code)") do
    kw = (Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, ncell = 200)
    a = Ressim.p3d_grow(; pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, kw..., q_wing = GROW.q_wing)
    b = Ressim.stage_grow(; layers = Ressim.three_layers(GROW.height, 3.0e6, 3.0e6; KIc = 1.0e6), kw..., q_stage = 2 * GROW.q_wing, positions = [0.0]).fractures[1]
    (checks = [chk("length", b.L[end] / a.L[end] - 1, BAR_P3D_LIMIT), chk("pressure", b.p0[end] / a.p0[end] - 1, BAR_P3D_LIMIT), chk("height", b.h0[end] / a.h0[end] - 1, BAR_P3D_LIMIT),
            chk("balance", (b.V_injected - b.V_fracture - b.V_leaked) / b.V_injected, BAR_GROW_VOLUME)], cells = 200)
end

record("layers_unequal_barriers", "Growth with a strong barrier above and a weak one below: grows into the weak side, mirrors when the rock is turned over", "self",
        "its own conditions: fluid account, mirror image, between the two equal-barrier cases, table sensitivity") do
    kw = (Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, ncell = 200, q_stage = 2 * GROW.q_wing, positions = [0.0])
    run(above, below; nt = 240) = Ressim.stage_grow(; layers = Ressim.three_layers(GROW.height, above, below; KIc = 1.0e6), kw..., ntable = nt).fractures[1]
    f = run(6.0e6, 3.0e6); g = run(3.0e6, 6.0e6); strong = run(6.0e6, 6.0e6); weak = run(3.0e6, 3.0e6); fine = run(6.0e6, 3.0e6; nt = 480)
    (checks = [chk("balance", (f.V_injected - f.V_fracture - f.V_leaked) / f.V_injected, BAR_GROW_VOLUME),
            chk("mirror", max(abs(f.up0 / g.down0 - 1), abs(f.down0 / g.up0 - 1), abs(f.L[end] / g.L[end] - 1)), 1e-9),
            chk("into_the_weak_side", f.down0 > f.up0 ? 0.0 : 1.0, 0.5),
            chk("height_between", strong.h0[end] < f.h0[end] < weak.h0[end] ? 0.0 : 1.0, 0.5), chk("length_between", weak.L[end] < f.L[end] < strong.L[end] ? 0.0 : 1.0, 0.5),
            chk("table", fine.L[end] / f.L[end] - 1, BAR_P3D_TABLE), chk("table_height", fine.h0[end] / f.h0[end] - 1, BAR_P3D_TABLE)],
        cells = 200, detail = @sprintf("98 ft pay, 870 psi barrier above and 435 psi below, 60 min at 25 bpm per wing: %.0f ft half-length, %.0f ft above the pay and %.0f ft below it at the well (equal barriers: %.0f ft each side at 870 psi, %.0f ft at 435 psi)",
            f.L[end] / Ressim.FT, (f.up0 - GROW.height / 2) / Ressim.FT, (f.down0 - GROW.height / 2) / Ressim.FT, (strong.h0[end] - GROW.height) / 2 / Ressim.FT, (weak.h0[end] - GROW.height) / 2 / Ressim.FT))
end

record("layers_with_clusters", "Three clusters between unequal barriers: mirror image and fluid account", "self",
        "its own conditions: outer clusters identical, fluid account per fracture, every fracture grows into the weak side") do
    perf = Ressim.perforation_drop(1.0; shots = 12, diameter = 0.4 * Ressim.INCH, discharge = 0.7, density = 1020.0)
    r = Ressim.stage_grow(; layers = Ressim.three_layers(GROW.height, 6.0e6, 3.0e6; KIc = 1.0e6), Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, ncell = 150,
        q_stage = 60 * Ressim.BPM, positions = [0.0, 7.5, 15.0], perf_coeff = fill(perf, 3))
    f = r.fractures
    (checks = [chk("mirror", max(abs(f[1].share / f[3].share - 1), abs(f[1].L[end] / f[3].L[end] - 1), abs(f[1].down0 / f[3].down0 - 1)), BAR_MF_SPLIT),
            chk("balance", maximum(abs(x.V_injected - x.V_fracture - x.V_leaked) for x in f) / r.V_injected, BAR_GROW_VOLUME),
            chk("into_the_weak_side", all(x.down0 > x.up0 for x in f) ? 0.0 : 1.0, 0.5)],
        cells = 150, detail = @sprintf("shares %s; growth above / below the pay at the well: %s", string(round.([x.share for x in f], digits = 3)),
            join([@sprintf("%.0f / %.0f ft", (x.up0 - GROW.height / 2) / Ressim.FT, (x.down0 - GROW.height / 2) / Ressim.FT) for x in f], ", ")))
end

# ---- stress left by an earlier stage (multifrac.jl, chain.jl) --------------------------------------
# Bars written before the first run (2026-11-10). One change after it: the chain test first used a leak-off of 0.002 ft/sqrt(min);
# with that, the earlier stage's fractures have closed completely after two hours (and the test pumps no proppant), so there was
# no effect to check. It now uses 0.0003 ft/sqrt(min). The bars were not changed.
TIER == "full" && record("stage_shadow", "Stress left by an earlier stage: a uniform background changes nothing but the pressure; a nearby open fracture pushes fluid to the far clusters", "self",
        "exact for a uniform background (same fracture, wellbore pressure higher by the background); otherwise direction of each effect and the fluid account") do
    kw = (pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, ncell = 150)
    # 1. one fracture under a background that is the same everywhere along its length
    flat = [(position = 40.0, dx = 1.0e5, area = [0.02], half_height = [15.0])]
    a = Ressim.stage_grow(; kw..., q_stage = 2 * GROW.q_wing, positions = [0.0], flow = :upwind)
    b = Ressim.stage_grow(; kw..., q_stage = 2 * GROW.q_wing, positions = [0.0], background = flat)
    S0 = b.fractures[1].earlier_stage0
    # 2. three clusters beside an earlier stage's fractures, weak perforation friction; the earlier stage is on the low side
    perf = Ressim.perforation_drop(1.0; shots = 20, diameter = 0.4 * Ressim.INCH, discharge = 0.7, density = 1020.0)
    stage(pos; back = nothing) = Ressim.stage_grow(; kw..., q_stage = 60 * Ressim.BPM, positions = pos, perf_coeff = fill(perf, 3), background = back)
    first = stage([0.0, 10.0, 20.0])
    residual(wait) = [Ressim.fracture_residual(f; pay = GROW.height, C_L = 2e-5, wait = wait) for f in first.fractures]
    soon = stage([40.0, 50.0, 60.0]; back = residual(1800.0)); late = stage([40.0, 50.0, 60.0]; back = residual(48 * 3600.0))
    sh(r) = [x.share for x in r.fractures]
    bal(r) = maximum(abs(x.V_injected - x.V_fracture - x.V_leaked) for x in r.fractures) / r.V_injected
    (checks = [chk("uniform_same_length", b.fractures[1].L[end] / a.fractures[1].L[end] - 1, 1e-9), chk("uniform_same_pressure", b.fractures[1].p0[end] / a.fractures[1].p0[end] - 1, 1e-9),
            chk("uniform_wellbore", (b.wellbore_pressure[end] - a.wellbore_pressure[end]) / S0 - 1, 1e-9),
            chk("near_cluster_gets_less", sh(soon)[1] < sh(first)[1] && sh(soon)[3] > sh(first)[3] ? 0.0 : 1.0, 0.5),
            chk("fades_with_waiting", abs(sh(late)[1] - sh(first)[1]) < abs(sh(soon)[1] - sh(first)[1]) ? 0.0 : 1.0, 0.5),
            chk("balance", max(bal(soon), bal(late)), BAR_GROW_VOLUME)],
        cells = 150, detail = @sprintf("three clusters 10 m apart, the earlier stage 20 m away: shares %s alone, %s half an hour after the earlier stage, %s two days after; the earlier stage adds %.0f psi at the nearest cluster and %.0f psi at the farthest",
            string(round.(sh(first), digits = 3)), string(round.(sh(soon), digits = 3)), string(round.(sh(late), digits = 3)), soon.fractures[1].earlier_stage0 / Ressim.PSI, soon.fractures[3].earlier_stage0 / Ressim.PSI))
end

TIER == "full" && record("chain_stage_shadow", "Stages pumped one after another: the first is unaffected, later ones lean away from the stage before", "self",
        "its own conditions: first stage identical with and without the effect; in later stages the cluster next to the earlier stage takes less than the far one") do
    base = Ressim.FracWellSpec(name = "chain_shadow", fluid = "oil", months = 6, mesh = "coarse", width_ft = 1600.0, positions_ft = [200.0, 350.0, 500.0], edge_ft = 100.0,
        half_length_ft = fill(1.0, 3), conductivity_mdft = fill(50.0, 3), thickness_ft = 100.0)
    rock = Ressim.RockSpec(barrier_psi = 600.0, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.0003)
    jobs = [Ressim.StageDesign(rate_bpm_per_fracture = 15.0, minutes = 60.0, clusters = 3, cluster_spacing_ft = 40.0, shots_per_cluster = 24) for _ in 1:3]
    with = Ressim.design_well(base, rock, jobs; propped_fraction = 0.6, ncell = 150); without = Ressim.design_well(base, rock, jobs; propped_fraction = 0.6, ncell = 150, hours_between_stages = nothing)
    sh = [g.fluid_share for g in with.growth]
    (checks = [chk("first_stage_same", maximum(abs(with.growth[k].half_length_ft / without.growth[k].half_length_ft - 1) for k in 1:3), 1e-12),
            chk("second_leans_away", sh[4] < sh[6] ? 0.0 : 1.0, 0.5), chk("third_like_second", maximum(abs.(sh[7:9] .- sh[4:6])), 0.01),
            chk("shares_add_up", maximum(abs(sum(sh[3k-2:3k]) - 1) for k in 1:3), 1e-9)],
        detail = @sprintf("stages 150 ft apart, three clusters each, two hours between stages: shares %s in the first stage, %s in the second, %s in the third; the earlier stage adds %.0f psi at the nearest cluster",
            string(round.(sh[1:3], digits = 3)), string(round.(sh[4:6], digits = 3)), string(round.(sh[7:9], digits = 3)), with.growth[4].earlier_stage_psi))
end

# ---- rock properties that vary across the map (geology.jl) -----------------------------------------
# Bars written before the first run (2026-11-10). The variogram bar is a statistical tolerance: with three fields of
# 512 x 512 nodes and a range of 8 cells, the sample variogram should sit within about 3.5% of the sill of the model.
using Random
const BAR_GEO_VARIOGRAM = 0.06     # sample variogram against the model asked for, as a share of the sill
record("geology_fields", "Rock properties as random fields: the variogram asked for is the variogram obtained; reproducible; sampled anywhere", "exact",
        "a direct Fourier sum; the variogram model the field was generated from (statistical tolerance); interpolation of a plane") do
    rng = Random.MersenneTwister(7)
    A = [complex(randn(rng), randn(rng)) for i in 1:8, j in 1:16]
    D = [sum(A[a, b] * cis(-2 * pi * ((a - 1) * (i - 1) / 8 + (b - 1) * (j - 1) / 16)) for a in 1:8, b in 1:16) for i in 1:8, j in 1:16]
    transform = maximum(abs.(Ressim.fft2_pow2(A) .- D)) / maximum(abs.(D))
    n = 512; a = 8; worst = 0.0; clipped = 0.0; mean_off = 0.0
    for model in (:spherical, :exponential)
        fs = [Ressim.gaussian_field(nx = n, ny = n, cell_ft = 100.0, range_ft = 100.0 * a, model = model, seed = s) for s in 1:3]
        clipped = max(clipped, maximum(f.clipped for f in fs)); mean_off = max(mean_off, abs(sum(sum(f.field.values) for f in fs) / (3 * n^2)))
        for lag in (2, 4, 8, 12), dir in (1, 2)
            g = sum(Ressim.field_variogram(f.field, lag; dir = dir) for f in fs) / 3
            worst = max(worst, abs(g - (1 - Ressim.correlation_model(model, lag / a))))
        end
    end
    # nugget, and different ranges in the two directions
    fn = Ressim.gaussian_field(nx = n, ny = n, cell_ft = 100.0, range_ft = 800.0, nugget = 0.3, seed = 11).field
    nug = abs(Ressim.field_variogram(fn, 1) - (0.3 + 0.7 * (1 - Ressim.correlation_model(:spherical, 1 / 8))))
    fa = Ressim.gaussian_field(nx = n, ny = n, cell_ft = 100.0, range_ft = 1600.0, minor_range_ft = 400.0, seed = 12).field
    aniso = max(abs(Ressim.field_variogram(fa, 4; dir = 1) - (1 - Ressim.correlation_model(:spherical, 0.25))), abs(Ressim.field_variogram(fa, 4; dir = 2) - 1.0))
    # reproducible from the seed; a plane is interpolated exactly; a rock model with tied properties
    f1 = Ressim.gaussian_field(nx = 64, ny = 64, cell_ft = 100.0, range_ft = 800.0, seed = 5).field; f2 = Ressim.gaussian_field(nx = 64, ny = 64, cell_ft = 100.0, range_ft = 800.0, seed = 5).field
    f3 = Ressim.gaussian_field(nx = 64, ny = 64, cell_ft = 100.0, range_ft = 800.0, seed = 6).field
    plane = Ressim.GeoField(1000.0, -500.0, 100.0, 50.0, [2.0 + 0.01 * (1000.0 + 100.0 * (i - 1)) - 0.03 * (-500.0 + 50.0 * (j - 1)) for i in 1:20, j in 1:30])
    interp = maximum(abs(Ressim.sample(plane, x, y) - (2.0 + 0.01 * x - 0.03 * y)) for (x, y) in ((1000.0, -500.0), (1234.5, 77.7), (2890.0, 940.0), (1999.9, -499.9)))
    g = Ressim.synthetic_geology(nx = 256, ny = 256, cell_ft = 100.0, range_ft = 1500.0, seed = 3)
    lp = log10.(vec(g.fields[:perm_md].values)); ph = vec(g.fields[:porosity].values)
    cor = sum((ph .- sum(ph) / length(ph)) .* (lp .- sum(lp) / length(lp))) / sqrt(sum((ph .- sum(ph) / length(ph)) .^ 2) * sum((lp .- sum(lp) / length(lp)) .^ 2))
    (checks = [chk("transform", transform, 1e-10), chk("variogram", worst, BAR_GEO_VARIOGRAM), chk("mean", mean_off, 0.05), chk("clipped_spectrum", clipped, 0.01),
            chk("nugget", nug, BAR_GEO_VARIOGRAM), chk("two_ranges", aniso, BAR_GEO_VARIOGRAM), chk("same_seed_same_field", maximum(abs.(f1.values .- f2.values)), 0.0),
            chk("other_seed_other_field", maximum(abs.(f1.values .- f3.values)) > 0.1 ? 0.0 : 1.0, 0.5), chk("interpolation", interp, 1e-10), chk("tied_properties", cor - 0.7, 0.07)],
        detail = @sprintf("512 x 512 nodes, range 8 cells, three seeds: worst variogram miss %.3f of the sill; porosity against log-permeability correlation %.2f (asked 0.70)", worst, cor))
end

# ---- structure and faults (structure.jl) ----------------------------------------------------------
# Bars written before the first run (2026-11-10).
record("structure_surface", "Top-of-pay surface with faults: dip along a lateral, where a fault is crossed and by how much, base from gross thickness", "exact",
        "plane geometry by hand: depth gain along a dipping plane, crossing position, parabolic throw along the trace, exponential die-out") do
    S = Ressim.synthetic_structure(nx = 121, ny = 61, cell_ft = 264.0, seed = 4, dip_deg = 2.0, dip_azimuth_deg = 30.0, residual_ft = 0.0)
    down = Ressim.lateral_structure(S; origin_ft = (8000.0, 6000.0), azimuth_deg = 30.0, length_ft = 6000.0)
    along = Ressim.lateral_structure(S; origin_ft = (8000.0, 6000.0), azimuth_deg = 120.0, length_ft = 6000.0)
    dip = maximum(abs.((down.top_tvd .- down.top_tvd[1]) .- down.md .* tand(2.0))); strike = maximum(abs.(along.top_tvd .- along.top_tvd[1]))
    flat = Ressim.synthetic_structure(nx = 121, ny = 61, cell_ft = 264.0, seed = 4, dip_deg = 0.0, residual_ft = 0.0)
    F = Ressim.Structure(flat.top, [Ressim.fault_from([[0.0, 5000.0], [10000.0, 5000.0]]; throw_ft = 40.0, transmissibility_multiplier = 0.1, decay_ft = 2000.0)])
    mid = Ressim.lateral_structure(F; origin_ft = (5000.0, 2000.0), azimuth_deg = 90.0, length_ft = 6000.0, gross = 120.0)
    quarter = Ressim.lateral_structure(F; origin_ft = (2500.0, 2000.0), azimuth_deg = 90.0, md = collect(0.0:50.0:6000.0))
    past_tip = Ressim.lateral_structure(F; origin_ft = (-100.0, 2000.0), azimuth_deg = 90.0, length_ft = 6000.0)
    back = Ressim.lateral_structure(F; origin_ft = (5000.0, 8000.0), azimuth_deg = 270.0, length_ft = 6000.0)        # the same crossing from the other side
    away = Ressim.top_at(F, 5000.0, 5000.0 + 3000.0) - 9000.0
    w = Ressim.well_faults(F; origin_ft = (1000.0, 4000.0), azimuth_deg = 90.0, width_ft = 1200.0)              # lateral running towards +y
    local_ok = maximum(abs.([w[1].points[1][1] - 1000.0, w[1].points[1][2] - 1600.0, w[1].points[2][1] - 1000.0, w[1].points[2][2] - (-8400.0)]))
    fs = Ressim.synthetic_faults(n = 3, seed = 9, x_extent = (0.0, 31680.0), y_extent = (0.0, 15840.0)); fs2 = Ressim.synthetic_faults(n = 3, seed = 9, x_extent = (0.0, 31680.0), y_extent = (0.0, 15840.0))
    (checks = [chk("dip_ft", dip, 1e-6), chk("along_strike_ft", strike, 1e-6), chk("crossing_md_ft", mid.crossings[1].md - 3000.0, 1e-6), chk("throw_mid_ft", mid.crossings[1].throw_ft - 40.0, 1e-4),
            chk("throw_quarter_ft", quarter.crossings[1].throw_ft - 30.0, 1e-4), chk("other_way_ft", back.crossings[1].throw_ft + 40.0, 1e-4),
            chk("no_crossing_past_tip", length(past_tip.crossings) + maximum(abs.(past_tip.top_tvd .- 9000.0)), 1e-9), chk("die_out_ft", away - 20.0 * exp(-1.5), 1e-9),
            chk("base_ft", maximum(abs.(mid.base_tvd .- mid.top_tvd .- 120.0)), 1e-9), chk("own_md", maximum(abs.(quarter.md .- collect(0.0:50.0:6000.0))), 0.0),
            chk("model_coordinates_ft", local_ok, 1e-9), chk("same_seed_same_faults", maximum(abs(a.throw_ft - b.throw_ft) + abs(a.trace[2][1] - b.trace[2][1]) for (a, b) in zip(fs, fs2)), 0.0)],
        detail = @sprintf("2 degree dip: %.1f ft deeper after 6,000 ft down dip, %.1e ft along strike; a 40 ft fault crossed at its middle steps the pay %.1f ft, at a quarter of its length %.1f ft",
            down.top_tvd[end] - down.top_tvd[1], strike, mid.crossings[1].throw_ft, quarter.crossings[1].throw_ft))
end

TIER == "full" && record("fracwell_faults", "Sealing and leaky faults in a fractured-well model", "self",
        "its own conditions: a multiplier of one changes nothing; two sealing faults leave the strip between them; leakier faults give more") do
    spec(; kw...) = Ressim.FracWellSpec(; name = "faults", fluid = "oil", mesh = "coarse", months = 12, width_ft = 1200.0, perm_md = 0.02, porosity = 0.08, thickness_ft = 100.0,
        positions_ft = [100.0, 300.0], edge_ft = 100.0, half_length_ft = [250.0, 250.0], conductivity_mdft = [50.0, 50.0], kw...)
    cum(r) = sum(x.oil_stb for x in r.stages)
    L = Ressim.fracwell_layout(spec()); edges = cumsum(L.dy)
    yb = edges[findfirst(>(600.0 + 90.0), edges)] - 600.0                      # a row boundary about 100 ft from the lateral, so the faults sit on cell faces
    pair(m) = [(points = [(-50.0, 600.0 + yb), (450.0, 600.0 + yb)], multiplier = m), (points = [(-50.0, 600.0 - yb), (450.0, 600.0 - yb)], multiplier = m)]
    plain = Ressim.run_fracwell(spec()); open_faults = Ressim.run_fracwell(spec(fault_traces = pair(1.0)))
    sealed = Ressim.run_fracwell(spec(fault_traces = pair(0.0))); leaky = Ressim.run_fracwell(spec(fault_traces = pair(0.01)))
    strip = Ressim.run_fracwell(spec(width_ft = 2 * yb, half_length_ft = [yb, yb]))
    (checks = [chk("open_fault_same", cum(open_faults) / cum(plain) - 1, 1e-9), chk("sealed_equals_strip", cum(sealed) / cum(strip) - 1, 0.02),
            chk("leakier_gives_more", cum(sealed) < cum(leaky) < cum(plain) ? 0.0 : 1.0, 0.5),
            chk("cut_fraction", maximum(r.run.stats.cuts / r.run.stats.ministeps for r in (sealed, leaky)), BAR_CUT_FRACTION)],
        cells = plain.run.cells, ministeps = sealed.run.stats.ministeps, cuts = sealed.run.stats.cuts,
        detail = @sprintf("12-month oil: %.0f stb without faults; %.0f with two sealing faults %.0f ft either side of the lateral (a model of just that strip gives %.0f); %.0f when they leak at 1%%",
            cum(plain), cum(sealed), yb, cum(strip), cum(leaky)))
end

# ---- wellbore and surface back-pressure (one well) -----------------------------------------------
# Bars written before the first run of these tests (2026-11-09). Both coupled-run checks compare the
# outer pressure loop with a plain engine run that needs no loop.
const BAR_SURF_CUM = 0.005        # cumulative oil, loop against the no-loop run
const BAR_SURF_CURVE = 0.01       # monthly oil curve, same comparison
const BAR_SURF_MISMATCH = 0.5     # psi, worst surface/reservoir mismatch left by the loop

record("hydraulics_exact", "Pipe pressure drop, single-phase liquid: hydrostatic head and laminar friction", "exact",
        "closed forms: rho g h, and Hagen-Poiseuille 128 mu L Q / (pi D^4)") do
    head = Ressim.liquid_pipe_drop(0.0; depth_ft = 1000.0, id_in = 2.441, density_lb_ft3 = 62.4, viscosity_cp = 1.0)
    q = 50.0; D = 2.441 * Ressim.INCH; L = 5000 * Ressim.FT
    fric = Ressim.liquid_pipe_drop(q; depth_ft = 0.0, length_ft = 5000.0, id_in = 2.441, density_lb_ft3 = 55.0, viscosity_cp = 100.0)
    hp = 128 * 0.1 * L * (q * Ressim.STB / Ressim.DAY) / (pi * D^4) / Ressim.PSI
    Re, rr = 1.0e5, 1.0e-4; f = Ressim.friction_factor(Re, rr)
    (checks = [chk("hydrostatic", head / (62.4 / 144 * 1000) - 1, 1e-4), chk("laminar", fric / hp - 1, 1e-10),
            chk("colebrook_residual", 1 / sqrt(f) + 2 * log10(rr / 3.7 + 2.51 / (Re * sqrt(f))), 1e-9)],
        detail = "turbulent friction uses the Colebrook-White equation; its constants are from recall and were not checked against a source")
end

# ---- gas-liquid flow in tubing, no slip ----------------------------------------------------------
# Bars written before the first run of these tests (2026-11-09), unseen.
record("lift_noslip_formulas", "Gas-liquid tubing without slip: mixture density, liquid limit and step refinement", "exact",
        "a hand calculation from the fluid tables, and the single-phase pipe formula in the gas-free limit") do
    # hand calculation at 2,014.7 psia, 100 stb/d oil, 300 Mscf/d gas: Rs 0.636, Bo 1.435, Bg 1.614 rb/Mscf
    #   volume (143.5 + 236.4 x 1.614) rb/d x 5.614583 = 2,947.935 ft3/d; mass 100 x 5.614583 x 53.66 + 300 x 53.3 = 46,117.85 lb/d
    #   density 15.6441 lb/ft3 -> 0.108640 psi/ft
    g = Ressim.noslip_gradient(2014.7, 100.0, 0.0, 300.0; id_in = 2.441)
    # gas-free: a column of dead oil (Bo 1.062, 1.04 cP) must equal the single-phase formula
    kw = (depth_ft = 9050.0, id_in = 2.441)
    dead = Ressim.noslip_bhp(100.0, 500.0, 0.0, 0.0; kw...) - 100.0
    single = Ressim.liquid_pipe_drop(500.0 * 1.062; kw..., density_lb_ft3 = 53.66 / 1.062, viscosity_cp = 1.04)
    coarse = Ressim.noslip_bhp(100.0, 100.0, 5.0, 300.0; kw...); fine = Ressim.noslip_bhp(100.0, 100.0, 5.0, 300.0; kw..., nseg = 960)
    liquid_only = 100.0 + Ressim.liquid_pipe_drop(105.0; kw..., density_lb_ft3 = 53.66, viscosity_cp = 1.0)
    (checks = [chk("density", g.weight / 0.108640 - 1, 1e-4), chk("gas_free_limit", dead / single - 1, 1e-6), chk("steps", coarse / fine - 1, 1e-3),
            chk("below_liquid_only", coarse < liquid_only ? 0.0 : 1.0, 0.5)],
        detail = @sprintf("9,050 ft of 2.441 in tubing at 100 psia on top, 100 stb/d oil, 5 stb/d water, 300 Mscf/d gas: %.0f psia at the bottom without slip, %.0f psia if the tubing were full of liquid", fine, liquid_only))
end

# ---- gas-liquid flow in tubing with slip ---------------------------------------------------------
# Bars written before the first run, unseen. The worked value is the doctest of the open-source `fluids`
# library (Nicklin_Wilkes_Davidson(0.4, 800., 2.5, m=1, D=0.3) = 0.6798826626721), which my hand arithmetic
# reproduces: gas flux 0.4 / (2.5 A), liquid flux 0.6 / (800 A), A = pi 0.3^2 / 4.
record("lift_slip_formulas", "Gas-liquid tubing with slip: gas fraction, no-slip limit, and its place between the two bounds", "exact",
        "an independent code's worked value for the gas fraction, and the exact limits of the relation") do
    A = pi * 0.3^2 / 4; vsg = 0.4 / (2.5 * A); vsl = 0.6 / (800 * A)
    alpha = Ressim.slip_gas_fraction(vsg, vsg + vsl, 0.3)
    kw = (depth_ft = 9050.0, id_in = 2.441)
    q = (100.0, 5.0, 300.0)
    noslip = Ressim.noslip_bhp(100.0, q...; kw...)
    as_noslip = Ressim.noslip_bhp(100.0, q...; kw..., slip = true, C0 = 1.0, drift = 0.0)
    slip = Ressim.noslip_bhp(100.0, q...; kw..., slip = true)
    liquid = 100.0 + Ressim.liquid_pipe_drop(105.0; kw..., density_lb_ft3 = 53.66, viscosity_cp = 1.0)
    weak = Ressim.noslip_bhp(100.0, 1.0, 0.05, 3.0; kw..., slip = true)          # a dying well: should be close to a liquid column
    (checks = [chk("gas_fraction", alpha / 0.6798826626721 - 1, 1e-6), chk("no_slip_limit", as_noslip / noslip - 1, 1e-9),
            chk("between_bounds", noslip < slip < liquid ? 0.0 : 1.0, 0.5), chk("weak_well_loads_up", weak > 0.5 * liquid ? 0.0 : 1.0, 0.5)],
        detail = @sprintf("9,050 ft, 100 psia on top, 100 stb/d oil, 300 Mscf/d gas: %.0f psia without slip, %.0f psia with slip, %.0f psia liquid-filled; at 1 stb/d the slip model gives %.0f psia",
            noslip, slip, liquid, weak))
end

# ---- cross-simulator: decks with shipped reference results ---------------------------------------
dataset(name) = Ressim.GeoEnergyIO.test_input_file_path(name)

function load_ref(dir)
    data, header = readdlm(joinpath(dir, "REFERENCE.CSV"), ',', header = true)
    h = String.(vec(header))
    col(name) = Float64.(data[:, findfirst(==(name), h)])
    total(suffix) = sum(max.(-Float64.(data[:, i]), 0.0) for i in eachindex(h) if endswith(h[i], suffix))
    return (t = Float64.(data[:, 1]), col = col, total = total, header = h)
end

deck_info(o) = (cells = o.cells, ministeps = o.stats.ministeps, cuts = o.stats.cuts, notes = o.notes)

record("cross_spe1", "SPE1: three-phase black oil, gas injection (deck input)", "cross", "OPM Flow results shipped with the benchmark") do
    dir = dataset("SPE1"); ref = load_ref(dir)
    o = Ressim.run_deck(joinpath(dir, "SPE1.DATA"); output_substates = true); res = o.result
    e(w, k, bar) = chk("$w:$k", Ressim.series_error(res.time, Ressim.well_series(res, w, k), ref.t, ref.col("$w:$k")), bar)
    (checks = [e(:PROD, :orat, BAR_RATE), e(:PROD, :grat, BAR_RATE), e(:PROD, :bhp, BAR_BHP), e(:INJ, :bhp, BAR_BHP)], deck_info(o)...,
        detail = "producer pressure misses its 1% bar. Diagnostic 2026-11-09: capping our timestep at 10 and 2 days moves the difference to 2.2% and 2.5% (further from the reference), and tighter tolerances leave it at 1.7%, so it is not our timestep or tolerance error. The difference sits around the producer's switch to its pressure limit. Unresolved without a fine-step independent reference.")
end

record("runner_summary_units", "Deck runner: field-unit summary file (SPE1 producer held at 20,000 stb/d)", "exact", "the deck's own rate control") do
    dir = dataset("SPE1"); tmp = mktempdir()
    o = Ressim.run_deck(joinpath(dir, "SPE1.DATA"); outdir = tmp)
    tab, head = readdlm(joinpath(tmp, "summary_field.csv"), ',', header = true)
    stb = -tab[1, findfirst(==("PROD:oil_stb_d"), String.(vec(head)))]
    (checks = [chk("oil_rate", stb / 20000 - 1, 1e-3), chk("run_file", isfile(joinpath(tmp, "run.toml")) ? 0.0 : 1.0, 0.5)], deck_info(o)...)
end

# ---- multi-stage fractured well (generated deck) -------------------------------------------------
# Bars for the well builder, written before its first run (2026-11-09): the fine mesh preset must meet
# the slab bars; the standard preset must meet stage-sim's frozen 1% / 2% bars with month 1 inside 2.5%.
const BAR_FW_STD = (cum = 0.01, curve = 0.02, month1 = 0.025)
const BAR_STAGE_SYMMETRY = 1e-3    # identical stages must produce the same
const BAR_MESH_SENS = 0.05         # coarse vs standard preset, 24-month field oil and gas

"Exact monthly oil (stb) for one stage of the full-width, high-conductivity, constant-compressibility case."
function fracwell_exact_monthly(s)
    c = s.oil_compressibility; X = c * (s.bhp_psi - s.pressure_psi)
    db = 1 - (1 + X + 0.5 * X^2)                                   # change of 1/Bo from initial to well pressure
    L = (s.positions_ft[2] - s.positions_ft[1] - s.fracture_width_ft) / 2
    A = s.width_ft * s.thickness_ft
    eta = s.perm_md * 1e-3 * Ressim.DARCY / (s.porosity * s.oil_viscosity_cp * 1e-3 * c / Ressim.PSI)   # m2/s
    cum = [(2 * A * s.porosity * L * Ressim.slab_recovery(eta * m * Ressim.MONTH_DAYS * Ressim.DAY / (L * Ressim.FT)^2) +
            s.porosity * s.fracture_width_ft * A) * db / 5.614583333 for m in 1:s.months]
    return diff(vcat(0.0, cum))
end

function fracwell_exact_checks(mesh, bars)
    s = Ressim.FracWellSpec(name = "exact_$mesh", fluid = "oil", width_ft = 100.0, half_length_ft = fill(60.0, 3),
        conductivity_mdft = fill(1e5, 3), pressure_psi = 5000.0, bhp_psi = 4700.0, rock_compressibility = 0.0, mesh = mesh)
    r = Ressim.run_fracwell(s)
    exact = fracwell_exact_monthly(s)
    worst = (cum = 0.0, curve = 0.0, month1 = 0.0)
    for i in 1:3
        sim = Ressim.stage_monthly_oil(r.run.result, Symbol(@sprintf("S%03d", i)), s.months)
        e = (cum = (sum(sim) - sum(exact)) / sum(exact), curve = sum(abs.(sim .- exact)) / sum(exact), month1 = (sim[1] - exact[1]) / exact[1])
        worst = (cum = abs(e.cum) > abs(worst.cum) ? e.cum : worst.cum, curve = max(e.curve, worst.curve), month1 = abs(e.month1) > abs(worst.month1) ? e.month1 : worst.month1)
    end
    (checks = [chk("cum", worst.cum, bars.cum), chk("curve", worst.curve, bars.curve), chk("month1", worst.month1, bars.month1)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts, notes = r.run.notes)
end

const FW_REF = "closed-form linear diffusion (series solution), worst of three stages"
record("fracwell_exact_standard", "Fractured well builder, standard mesh: full-width fractures, single-phase oil", "exact", FW_REF) do
    fracwell_exact_checks("standard", BAR_FW_STD)
end
record("fracwell_exact_fine", "Fractured well builder, fine mesh: full-width fractures, single-phase oil", "exact", FW_REF) do
    fracwell_exact_checks("fine", (cum = BAR_SLAB_CUM, curve = BAR_SLAB_CURVE, month1 = BAR_SLAB_MONTH1))
end

fracwell_blackoil(mesh) = Ressim.run_fracwell(Ressim.FracWellSpec(name = "blackoil_$mesh", mesh = mesh))
const FW_COARSE = Ref{Any}(nothing)
record("fracwell_blackoil", "Fractured well builder: three identical stages, live oil with gas and water, 3,500 psi drawdown", "self", "symmetry: identical stages must produce the same") do
    r = fracwell_blackoil("coarse"); FW_COARSE[] = r
    oil = [x.oil_stb for x in r.stages]; gas = [x.gas_mscf for x in r.stages]
    (checks = [chk("oil_spread", (maximum(oil) - minimum(oil)) / maximum(oil), BAR_STAGE_SYMMETRY),
            chk("gas_spread", (maximum(gas) - minimum(gas)) / maximum(gas), BAR_STAGE_SYMMETRY),
            chk("cut_fraction", r.run.stats.cuts / r.run.stats.ministeps, BAR_CUT_FRACTION)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts, notes = r.run.notes,
        detail = @sprintf("coarse mesh, 24 months, per stage: %.0f stb oil, %.0f Mscf gas, %.1f stb water", oil[1], gas[1], r.stages[1].water_stb))
end

# ---- proppant ------------------------------------------------------------------------------------
# The transport bars are NOT blind (a diagnostic run had shown 0.9998 for the pad rule at 800 cells and
# round-off for the balance). The formula bars compare with hand arithmetic written here.
record("proppant_transport", "Proppant carried with the slurry: pad-volume rule, conservation, concentration behind the front", "exact",
        "with no leak-off and no slip the fluid keeps its order, so the fracture volume ahead of the proppant front equals the pad volume") do
    c0 = Ressim.ppa_to_fraction(1.0)
    r = Ressim.p3d_grow(; pay = GROW.height, dsigma = 1.0e9, Eprime = GROW.Eprime, mu = GROW.mu, q_wing = GROW.q_wing, t_end = GROW.t_end, ncell = 800,
        proppant = (schedule = [(0.3 * GROW.t_end, c0)], diameter = 2.0e-4, bridge = 0.0))
    conc = r.proppant_per_length ./ max.(r.area, 1e-300)
    i = findlast(>(0.5 * c0), conc)
    ahead = sum(r.area[i+1:end]) * r.dx + 0.5 * r.area[i] * r.dx
    (checks = [chk("pad_rule", ahead / (0.3 * r.V_injected) - 1, 0.01), chk("balance", (r.proppant_pumped - r.proppant_in_fracture) / r.proppant_pumped, 1e-9),
            chk("behind_front", conc[i ÷ 2] / c0 - 1, 0.005), chk("no_overshoot", max(maximum(conc[1:i]) / c0 - 1, 0.0), 1e-6)],
        cells = 800, detail = @sprintf("proppant front at %.0f m of a %.0f m fracture after a 30%% pad", r.x[i], r.L[end]))
end

record("proppant_formulas", "Proppant arithmetic: concentration units, propped width, pack permeability, settling limit", "exact",
        "hand arithmetic from the definitions") do
    # 1 lb/gal of sand at 2,650 kg/m3: 119.826427 / 2650 = 0.0452175 volume of sand per volume of fluid -> 0.0432613 of the slurry
    # 1 lb/ft2 = 4.88242764 kg/m2; at 35% pack porosity: 4.88242764 / (0.65 x 2650) = 2.83450 mm
    # Kozeny-Carman, 0.3 mm grains, 35% porosity: 9e-8 x 0.042875 / (180 x 0.4225) = 5.07396e-11 m2 = 51.412 darcy
    (checks = [chk("ppa", Ressim.ppa_to_fraction(1.0) / 0.0432613 - 1, 1e-5), chk("width", Ressim.propped_width(Ressim.LB_FT2) / 2.83450e-3 - 1, 1e-5),
            chk("permeability", Ressim.pack_permeability(3e-4, 0.35) / Ressim.DARCY / 51.412 - 1, 1e-4),
            chk("stokes_limit", Ressim.settling_velocity(1e-5) / Ressim.stokes_velocity(1e-5) - 1, 0.01),
            chk("slower_than_stokes", Ressim.settling_velocity(3e-4) < Ressim.stokes_velocity(3e-4) ? 0.0 : 1.0, 0.5)],
        detail = @sprintf("0.2 mm sand in water settles %.1f ft per hour; the settling law and the stress factor on pack permeability are taken from the sources in research/proppant-models.md and are not checked here",
            Ressim.settling_velocity(2e-4) * 3600 / Ressim.FT))
end

# ---- proppant settling into a bank (proppant.jl) ---------------------------------------------------
# Bars written before the first run of these tests (2026-11-10). Two things changed after it:
#   - A check that a vanishing settling speed leaves no bank was wrong and was replaced: cells packed to the limit by
#     leak-off and bridging near the tip also count as immobile pack (16% of the proppant in that run). The check is
#     now that the immobile share rises with settling speed.
#   - Found later the same day: nothing stopped grains entering a cell that was already a full pack, so cells near the tip
#     held more than a pack can (and the proppant 'missing from the pay' was mostly that excess). A cell now holds at most
#     a full pack; the excess backs up towards the well, and what cannot be placed at all is reported. The growth balance
#     check includes it, and a check that no cell is over-packed was added.
#   - Three choices made after results had been seen, all in the direction of a more physical default: (a) grains above
#     the bank are carried on once the flow there is fast enough; the speed first came from Durand's pipe-flow rule with twice the width,
#     written from memory (0.57 m/s for 0.2 mm sand in a 5 mm slot). A research agent then found the published form
#     (Wicks' rule with the slot width, McClure 2018 eq. 12: 0.44 m/s, worked by the agent) and the default was switched
#     to it. It was checked by its source only on 8 mm laboratory slots, and it changes propped length a lot (the chain
#     test prints the result with and without it); (b) at
#     closure the pack fills an ellipse of the cross-section's height and area instead of a slab of its mean width;
#     (c) the two proppant examples were given less leaky rock so that they do not screen out.
#   - An early report that only about 60% of the proppant ends inside the pay was the over-packing defect above, not
#     physics; with it fixed the figure is 96 to 99%.
#   - The chain test's weak lower barrier was raised from 150 to 300 psi: at 150 psi the fracture is not contained at all
#     (the run stops with a height-runaway error before giving any result).
const BAR_SETTLE_EXACT = 1e-6     # closed slot: bank height and clear-fluid front against the exact (Kynch) solution
const BAR_SETTLE_FRONT = 0.02     # flowing slot: distance by which everything has settled, as a fraction of that distance
record("proppant_settling", "Proppant settling into a bank: closed slot against the exact solution, flowing slot, conservation in a growth run", "exact",
        "Kynch's solution for a uniform suspension in a closed slot; the steady settling line in a slot with uniform flow; conservation") do
    # 1. closed slot 30 m high, 5 mm wide, 10% suspension, pack at 60%
    H = 30.0; w = 5e-3; c0 = 0.1; cmax = 0.6; vf = 0.02
    v = Ressim.hindered_velocity(vf, c0); ub = c0 * v / (cmax - c0); t_meet = H / (v + ub)
    Vs = c0 * H * w; Hs = H * w; Vb = 0.0; n = 1000; dt = t_meet / n; half_bank = 0.0; half_front = 0.0; done_at = 0
    for k in 1:n+5
        Vs, Hs, Vb = Ressim.settle_cell(Vs, Hs, Vb, w, dt; v_free = vf, cmax = cmax)
        k == n ÷ 2 && (half_bank = Vb / (cmax * w); half_front = Hs / w)
        done_at == 0 && Vs == 0 && (done_at = k)
    end
    # 2. slot with uniform flow: 2% suspension enters over the full height; all of it has settled by x* = u H / (v + ub)
    c1 = 0.02; u = 0.5; v1 = Ressim.hindered_velocity(vf, c1); ub1 = c1 * v1 / (cmax - c1); xs = u * H / (v1 + ub1)
    M = 400; dx = 2 * xs / M; q = u * H * w; dts = 0.5 * dx / u
    S = zeros(M); Hl = zeros(M); B = zeros(M); area = fill(H * w, M); height = fill(H, M); qo = fill(q, M); opn = trues(M); lk = zeros(M)
    step!() = Ressim.proppant_sweep!(S, Hl, B; area = area, height = height, q_out = qo, open_next = opn, leak = lk, inflow_V = c1 * q * dts / dx, inflow_H = q * dts / dx,
        dt = dts, dx = dx, settle = (v_free = vf, n = 4.65, cmax = cmax, u_eq = Inf))
    for _ in 1:12M
        step!()
    end
    B0 = copy(B); S0 = sum(S)
    for _ in 1:M
        step!()
    end
    rate = (B .- B0) ./ (M * dts)                                    # deposition per unit length and time, steady
    plateau = c1 * (v1 + ub1) * w
    k_half = findfirst(<(plateau / 2), rate)
    x_half = (k_half - 1.5 + (rate[k_half-1] - plateau / 2) / (rate[k_half-1] - rate[k_half])) * dx + dx / 2
    # 2b. (added after review) the same slot with a carry-over speed: the bank must stop where the flow above it reaches that speed,
    # that is at a height H - q / (w u_eq), and stay there; the default speed comes from a correlation, checked by hand for one width
    ueq = 2.0; Sc = zeros(M); Hc = zeros(M); Bc = zeros(M)
    for _ in 1:40M
        Ressim.proppant_sweep!(Sc, Hc, Bc; area = area, height = height, q_out = qo, open_next = opn, leak = lk, inflow_V = c1 * q * dts / dx, inflow_H = q * dts / dx,
            dt = dts, dx = dx, settle = (v_free = vf, n = 4.65, cmax = cmax, u_eq = ueq, R = 1.65))
    end
    bank_stop = Bc[1] / (cmax * w); bank_stop_exact = H - q / (w * ueq)
    # 3. a growth run with barriers and leak-off: everything pumped is either suspended or banked; nearly no settling speed gives nearly no bank
    grow(vfree) = Ressim.stage_grow(; pay = GROW.height, dsigma = 3.0e6, KIc = 1.0e6, Eprime = GROW.Eprime, mu = GROW.mu, t_end = GROW.t_end, C_L = 2e-5, q_stage = 2 * GROW.q_wing,
        positions = [0.0], ncell = 200, proppant = (schedule = [(0.3 * GROW.t_end, 0.05)], diameter = 2e-4, bridge = 3.0, settle = (v_free = vfree, n = 4.65, cmax = 0.65, u_eq = Inf))).fractures[1]
    f = grow(0.02); mid = grow(0.002); slow = grow(1e-12)
    bk(x) = sum(x.proppant_banked) / sum(x.proppant_per_length)
    (checks = [chk("hindered_speed", Ressim.hindered_velocity(1.0, 0.1) / 0.6127 - 1, 1e-4), chk("meeting_time", t_meet * vf / H / 1.360 - 1, 1e-3),
            chk("bank_half_way", half_bank / (H / 12) - 1, BAR_SETTLE_EXACT), chk("front_half_way", half_front / (H / 2) - 1, BAR_SETTLE_EXACT),
            chk("bank_final", Vb / (cmax * w) / (H / 6) - 1, BAR_SETTLE_EXACT), chk("finished_on_time", (done_at - n) / n, 2e-3),
            chk("line_plateau", rate[2] / plateau - 1, 1e-3), chk("line_end", x_half / xs - 1, BAR_SETTLE_FRONT),
            chk("line_balance", (sum(rate) * dx + (sum(S) - S0) * dx / (M * dts)) / (c1 * q) - 1, 1e-6),
            chk("carry_over_height", bank_stop / bank_stop_exact - 1, 0.01), chk("carry_over_speed_published", Ressim.deposit_velocity(5e-3, 2e-4; R = 1.65) / 0.44 - 1, 5e-3),
            chk("growth_balance", (f.proppant_pumped - f.proppant_rejected - (sum(f.proppant_suspended) + sum(f.proppant_banked)) * f.dx) / f.proppant_pumped, BAR_GROW_VOLUME),
            chk("never_over_packed", max(maximum((f.proppant_suspended[i] + f.proppant_banked[i]) / f.area[i] for i in eachindex(f.area) if f.area[i] > 0) / 0.65 - 1, 0.0), 1e-9),
            chk("faster_grains_bank_more", bk(slow) < bk(mid) < bk(f) ? 0.0 : 1.0, 0.5)],
        detail = @sprintf("closed 30 m slot, 10%% suspension: bank ends %.2f m high after %.0f s; flowing slot: all settled by %.0f m (exact %.0f m); growth run: %.0f%% of the proppant is immobile when pumping stops at a settling speed of 2 cm/s, %.0f%% at 2 mm/s, and %.0f%% with no settling at all (packed near the tip by leak-off and bridging)",
            Vb / (cmax * w), t_meet, x_half, xs, 100 * bk(f), 100 * bk(mid), 100 * bk(slow)))
end

TIER == "full" && record("chain_settling_to_production", "Proppant bank to production: a weak barrier below the pay loses proppant out of zone; a thicker fluid banks less", "self",
        "its own conditions: direction of each effect, and the chain runs to production") do
    base = Ressim.FracWellSpec(name = "chain_settle", fluid = "oil", months = 6, mesh = "coarse", width_ft = 2000.0, positions_ft = [100.0, 300.0], half_length_ft = [1.0, 1.0],
        conductivity_mdft = [50.0, 50.0], thickness_ft = 100.0)
    jobs = [Ressim.StageDesign(rate_bpm_per_fracture = 10.0, minutes = 60.0), Ressim.StageDesign(rate_bpm_per_fracture = 10.0, minutes = 60.0, viscosity_cp = 30.0)]
    prop = Ressim.ProppantDesign(schedule = [(0.2, 1.0)])
    rock(below) = Ressim.RockSpec(barrier_psi = 600.0, barrier_above_psi = 600.0, barrier_below_psi = below, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.002)
    firm = Ressim.design_well(base, rock(600.0), jobs; proppant = prop, ncell = 200); weak = Ressim.design_well(base, rock(300.0), jobs; proppant = prop, ncell = 200)
    even = Ressim.design_well(base, rock(600.0), jobs; proppant = Ressim.ProppantDesign(schedule = [(0.2, 1.0)], settling = false), ncell = 200)
    nocarry = Ressim.design_well(base, rock(600.0), jobs; proppant = Ressim.ProppantDesign(schedule = [(0.2, 1.0)], equilibrium_velocity_ft_s = Inf), ncell = 200)
    banked(g) = sum(g.detail.proppant_banked) / sum(g.detail.proppant_per_length)
    r = Ressim.run_fracwell(firm.spec)
    (checks = [chk("weak_floor_loses_proppant", weak.packs[1].share_in_pay < firm.packs[1].share_in_pay ? 0.0 : 1.0, 0.5),
            chk("thick_fluid_banks_less", banked(firm.growth[2]) < banked(firm.growth[1]) ? 0.0 : 1.0, 0.5),
            chk("same_fracture_either_way", firm.growth[1].half_length_ft / even.growth[1].half_length_ft - 1, 1e-12),
            chk("oil_positive", all(x -> x.oil_stb > 0, r.stages) ? 0.0 : 1.0, 0.5)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts,
        detail = @sprintf("water, 600 psi barriers: %.0f%% of the proppant banked during pumping, %.0f%% of it ends in the pay, propped half-length %.0f ft, %.1f md-ft at the well (even spread: %.0f ft, %.1f md-ft; with no carry-over of grains above the bank: %.0f ft, %.1f md-ft); 300 psi below: %.0f%% in the pay; 30 cp fluid: %.0f%% banked",
            100 * banked(firm.growth[1]), 100 * firm.packs[1].share_in_pay, firm.spec.half_length_ft[1], firm.spec.conductivity_mdft[1], even.spec.half_length_ft[1], even.spec.conductivity_mdft[1], nocarry.spec.half_length_ft[1], nocarry.spec.conductivity_mdft[1],
            100 * weak.packs[1].share_in_pay, 100 * banked(firm.growth[2])))
end

# ---- fracture conductivity that falls with drawdown (engine rock tables, written into the fractured-well deck) ----
# Bars written before the first run (2026-11-10).
TIER == "full" && record("fracwell_conductivity_loss", "Fracture conductivity that falls as the well is drawn down, and stays down", "self",
        "its own conditions: no loss reproduces the plain run; more loss gives less oil; after a hard drawdown the permanent loss costs later production, the reversible one does not") do
    spec(; kw...) = Ressim.FracWellSpec(; name = "loss", fluid = "oil", mesh = "coarse", months = 12, width_ft = 1200.0, perm_md = 0.002, positions_ft = [100.0], edge_ft = 100.0,
        half_length_ft = [300.0], conductivity_mdft = [10.0], bhp_psi = 1000.0, kw...)
    cum(r) = sum(x.oil_stb for x in r.stages)
    plain = Ressim.run_fracwell(spec()); none = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 1e-9))
    some = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 2e-4)); more = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 5e-4))
    # two months at 500 psi, then ten months held back at 3000 psi
    base = spec(conductivity_loss_per_psi = 5e-4); steps = Ressim.fracwell_tstep(base); t_end = cumsum(steps)
    sched = [t <= 2 * Ressim.MONTH_DAYS + 1e-6 ? 500.0 : 3000.0 for t in t_end]
    gentle = fill(3000.0, length(steps))
    late(r) = sum(Ressim.stage_monthly_oil(r.run.result, :S001, 12)[3:12])
    perm_harsh = Ressim.run_fracwell(base; bhp_schedule = sched); rev_harsh = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 5e-4, conductivity_loss_reversible = true); bhp_schedule = sched)
    perm_gentle = Ressim.run_fracwell(base; bhp_schedule = gentle); rev_gentle = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 5e-4, conductivity_loss_reversible = true); bhp_schedule = gentle)
    # added after review: permanent mode with a negligible loss must equal the plain run on the hard-drawdown schedule too (the engine's
    # permanent mode would otherwise also freeze pore volume), and the result must not depend on the size of the well connection factor
    plain_harsh = Ressim.run_fracwell(spec(); bhp_schedule = sched); none_harsh = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 1e-9); bhp_schedule = sched)
    big_cf = Ressim.run_fracwell(spec(conductivity_loss_per_psi = 5e-4, connection_multiple = 10 * spec().connection_multiple))
    cuts = maximum(r.run.stats.cuts / r.run.stats.ministeps for r in (some, more, perm_harsh, rev_harsh))
    (checks = [chk("no_loss_same", cum(none) / cum(plain) - 1, 0.002), chk("more_loss_less_oil", cum(more) < cum(some) < cum(plain) ? 0.0 : 1.0, 0.5),
            chk("permanent_costs_later", late(perm_harsh) < late(rev_harsh) ? 0.0 : 1.0, 0.5),
            chk("same_when_never_recovering", late(perm_gentle) / late(rev_gentle) - 1, 0.002), chk("no_loss_same_after_drawdown", late(none_harsh) / late(plain_harsh) - 1, 0.002),
            chk("connection_size", cum(big_cf) / cum(more) - 1, 0.01), chk("cut_fraction", cuts, BAR_CUT_FRACTION)],
        cells = plain.run.cells, ministeps = more.run.stats.ministeps, cuts = more.run.stats.cuts,
        detail = @sprintf("12 months at 1000 psi: %.0f stb with no loss, %.0f with 2e-4 per psi, %.0f with 5e-4 per psi. After two months at 500 psi, months 3 to 12 at 3000 psi give %.0f stb if the loss is permanent and %.0f if it recovers (%.0f had the well never been drawn down hard)",
            cum(plain), cum(some), cum(more), late(perm_harsh), late(rev_harsh), late(perm_gentle)))
end

TIER == "full" && record("multifrac_tip_position", "Six clusters with limited entry (a reported case): lengths stay finite and steady", "self",
        "regression test for a defect: the tip estimate returned infinity where pressure rises towards the tip") do
    r = Ressim.grow_stage_clusters(; pay_ft = 132.0, barrier_psi = 686.0, youngs_psi = 3.14e6, leakoff_ft_sqrtmin = 0.0014, viscosity_cp = 3.0, stage_rate_bpm = 90.0, minutes = 60.0,
        cluster_positions_ft = [-104.16666666666666, -62.5, -20.833333333333332, 20.833333333333332, 62.5, 104.16666666666666], shots = 4, perf_diameter_in = 0.4, ncell = 200)
    f = [c.detail for c in r.clusters]
    jump = maximum(maximum(abs.(diff(x.L))) / x.dx for x in f)                 # largest change of length in one time step, in cells
    (checks = [chk("finite", all(all(isfinite, x.L) for x in f) ? 0.0 : 1.0, 0.5), chk("no_jumps", jump, 3.0), chk("mirror", f[1].L[end] / f[6].L[end] - 1, BAR_MF_SPLIT),
            chk("balance", maximum(abs(x.V_injected - x.V_fracture - x.V_leaked) for x in f) / r.detail.V_injected, BAR_GROW_VOLUME)],
        cells = 200, detail = @sprintf("half-lengths %s ft, shares %s", string(round.(Int, [c.half_length_ft for c in r.clusters])), string(round.([c.fluid_share for c in r.clusters], digits = 3))))
end

record("chain_proppant_to_production", "Rock, pumping and proppant to production: propped length and conductivity predicted", "self",
        "its own conditions: propped length inside created length, more proppant gives more conductivity, the result is used unchanged by the well model") do
    base = Ressim.FracWellSpec(name = "chain_prop", fluid = "oil", months = 6, mesh = "coarse", width_ft = 2000.0, positions_ft = [100.0, 300.0],
        half_length_ft = fill(1.0, 2), conductivity_mdft = fill(1.0, 2))
    rock = Ressim.RockSpec(barrier_psi = 600.0, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.002)
    jobs = [Ressim.StageDesign(rate_bpm_per_fracture = 8.0, minutes = 60.0) for _ in 1:2]
    lean = Ressim.design_well(base, rock, jobs; proppant = Ressim.ProppantDesign(schedule = [(0.3, 0.5)], settling = false))
    rich = Ressim.design_well(base, rock, jobs; proppant = Ressim.ProppantDesign(schedule = [(0.3, 2.0)], settling = false))
    r = Ressim.run_fracwell(rich.spec)
    created = rich.growth[1].half_length_ft; propped = rich.packs[1].propped_half_length / Ressim.FT
    (checks = [chk("propped_inside_created", propped <= created * (1 + 1e-9) ? 0.0 : 1.0, 0.5),
            chk("more_proppant_more_conductivity", rich.spec.conductivity_mdft[1] > lean.spec.conductivity_mdft[1] ? 0.0 : 1.0, 0.5),
            chk("length_used", r.stages[1].half_length_ft / propped - 1, 1e-6),
            chk("settling_reported", any(occursin("settle", n) for n in rich.notes) ? 0.0 : 1.0, 0.5)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts,
        detail = @sprintf("8 bpm per fracture, 60 min, 0.2 mm sand from 30%% of the job: created %.0f ft, propped %.0f ft; conductivity at the well %.1f md-ft at 0.5 lb/gal and %.1f md-ft at 2 lb/gal; 6-month oil %.0f stb per stage",
            created, propped, lean.spec.conductivity_mdft[1], rich.spec.conductivity_mdft[1], r.stages[1].oil_stb))
end

# ---- rock and pumping to production --------------------------------------------------------------
record("chain_design_to_production", "Rock and pumping to production in one call: three job sizes on one well", "self",
        "its own conditions: a bigger job gives a longer fracture and more oil; an over-long fracture is cut and reported") do
    base = Ressim.FracWellSpec(name = "chain", fluid = "oil", months = 6, mesh = "coarse", width_ft = 1300.0, positions_ft = [100.0, 300.0, 500.0],
        half_length_ft = fill(1.0, 3), conductivity_mdft = fill(50.0, 3))
    rock = Ressim.RockSpec(barrier_psi = 600.0, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.002)
    jobs = [Ressim.StageDesign(rate_bpm_per_fracture = q, minutes = 60.0) for q in (4.0, 8.0, 12.0)]
    d = Ressim.design_well(base, rock, jobs; propped_fraction = 0.6)
    r = Ressim.run_fracwell(d.spec)
    xf = [g.half_length_ft for g in d.growth]; oil = [s.oil_stb for s in r.stages]
    big = Ressim.design_well(base, rock, [Ressim.StageDesign(rate_bpm_per_fracture = 60.0, minutes = 120.0) for _ in 1:3])
    (checks = [chk("longer_with_bigger_job", issorted(xf) && xf[3] > xf[1] ? 0.0 : 1.0, 0.5), chk("more_oil_with_longer", issorted(oil) && oil[3] > oil[1] ? 0.0 : 1.0, 0.5),
            chk("length_used", maximum(abs.([s.half_length_ft for s in r.stages] ./ (0.6 .* xf) .- 1)), 1e-6),
            chk("cut_reported", (any(occursin("cut", n) for n in big.notes) && all(h -> h <= base.width_ft / 2 + 1e-9, big.spec.half_length_ft)) ? 0.0 : 1.0, 0.5)],
        cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts,
        detail = @sprintf("4 / 8 / 12 bpm per fracture for 60 min: created half-length %.0f / %.0f / %.0f ft, 6-month oil %.0f / %.0f / %.0f stb (conductivity and the 60%% conductive share are declared, not predicted)",
            xf[1], xf[2], xf[3], oil[1], oil[2], oil[3]))
end

if TIER == "full"
    surf_well(; kw...) = Ressim.FracWellSpec(; fluid = "oil", positions_ft = [100.0], half_length_ft = [250.0], conductivity_mdft = [50.0],
        oil_compressibility = 1e-6, rock_compressibility = 0.0, months = 12, mesh = "coarse", kw...)
    monthly(r, s) = Ressim.stage_monthly_oil(r.run.result, :S001, s.months)
    function loop_checks(c, plain, s)
        a = monthly(c.run, s); b = monthly(plain, s)
        ([chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("mismatch_psi", c.mismatch_psi[end] / 100, BAR_SURF_MISMATCH / 100), chk("converged", c.converged ? 0.0 : 1.0, 0.5)], a, b)
    end

    # A tubing drop proportional to rate is, for one connection, the same as a weaker connection at the
    # separator pressure. The loop must reproduce that plain run.
    record("surface_linear_tubing", "Wellbore coupling: rate-proportional tubing drop (20 psi per stb/d) on one stage", "exact",
            "the same well run without the loop, with the tubing resistance folded into the connection") do
        Rt = 20.0; psep = 1000.0
        s = surf_well(name = "surf_loop")
        c = Ressim.run_fracwell_surface(s, Ressim.SurfaceSpec(separator_psi = psep, tubing = q -> Rt * q))
        Lay = Ressim.fracwell_layout(s)
        unit = 0.001127 * s.conductivity_mdft[1] * s.thickness_ft / Lay.dy[Lay.jw]       # connection factor per unit multiple
        cf = 1 / (1 / (s.connection_multiple * unit) + Rt / s.oil_viscosity_cp)           # series resistance, Bo taken as 1
        plain = Ressim.run_fracwell(surf_well(name = "surf_plain", bhp_psi = psep, connection_multiple = cf / unit))
        checks, a, _ = loop_checks(c, plain, s)
        (checks = checks, cells = c.run.run.cells, ministeps = c.run.run.stats.ministeps, cuts = c.run.run.stats.cuts,
            detail = @sprintf("%d loop iterations; bottom-hole pressure falls from %.0f to %.0f psi as rate declines from %.0f to %.1f stb/d; 12-month oil %.0f stb; solver steps %d against %d without the loop",
                c.iterations, maximum(c.bhp_psi), c.bhp_psi[end], maximum(c.oil_stb_d), c.oil_stb_d[end], sum(a), c.run.run.stats.ministeps, plain.run.stats.ministeps))
    end

    # The same two checks for the in-timestep form (no outer loop): one run each. Bars as above, written
    # before the first run. The mismatch is measured from the run's own pressure and rate series.
    function implicit_checks(r, plain, s, sf)
        res = r.result
        a = Ressim.stage_monthly_oil(res, :W1, s.months); b = monthly(plain, s)
        bhp = Ressim.well_series(res, :W1, :bhp) ./ Ressim.PSI
        qo = -Ressim.well_series(res, :W1, :orat) .* (Ressim.DAY / Ressim.STB)
        off = [min(bhp[k] - Ressim.required_bhp(sf, qo[k]), (sf.oil_cap_stb_d - qo[k]) * (s.pressure_psi - sf.separator_psi) / sf.oil_cap_stb_d) for k in eachindex(bhp)]
        isfinite(sf.oil_cap_stb_d) || (off = bhp .- Ressim.required_bhp.(Ref(sf), qo))
        ([chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("mismatch_psi", maximum(abs, off) / 100, BAR_SURF_MISMATCH / 100)], a, qo, bhp)
    end

    record("surface_implicit_tubing", "Wellbore coupling inside the timestep: rate-proportional tubing drop, one run", "exact",
            "the same well with the tubing resistance folded into the connection") do
        Rt = 20.0; psep = 1000.0
        s = surf_well(name = "impl_tubing"); sf = Ressim.SurfaceSpec(separator_psi = psep, tubing = q -> Rt * q)
        r = Ressim.run_fracwell_implicit(s, sf)
        Lay = Ressim.fracwell_layout(s)
        unit = 0.001127 * s.conductivity_mdft[1] * s.thickness_ft / Lay.dy[Lay.jw]
        cf = 1 / (1 / (s.connection_multiple * unit) + Rt / s.oil_viscosity_cp)
        plain = Ressim.run_fracwell(surf_well(name = "impl_plain", bhp_psi = psep, connection_multiple = cf / unit))
        checks, a, qo, bhp = implicit_checks(r, plain, s, sf)
        (checks = checks, cells = r.cells, ministeps = r.stats.ministeps, cuts = r.stats.cuts,
            detail = @sprintf("one run of %.1f s; peak rate %.0f stb/d at %.0f psi bottom-hole; 12-month oil %.0f stb", r.wall_seconds, maximum(qo), maximum(bhp), sum(a)))
    end

    record("surface_implicit_cap", "Facility limit inside the timestep: oil capped at 20 stb/d, one run", "exact",
            "the engine's own rate target with a pressure limit") do
        cap = 20.0; psep = 1000.0
        s = surf_well(name = "impl_cap"); sf = Ressim.SurfaceSpec(separator_psi = psep, oil_cap_stb_d = cap)
        r = Ressim.run_fracwell_implicit(s, sf)
        plain = Ressim.run_fracwell(surf_well(name = "impl_cap_plain", bhp_psi = psep); oil_rate_target = cap)
        checks, a, qo, _ = implicit_checks(r, plain, s, sf)
        (checks = checks, cells = r.cells, ministeps = r.stats.ministeps, cuts = r.stats.cuts,
            detail = @sprintf("one run of %.1f s; peak oil rate %.3f stb/d; 12-month oil %.0f stb", r.wall_seconds, maximum(qo), sum(a)))
    end

    # A facility oil-rate limit: the loop chokes the well back; the engine's own rate target with a
    # pressure limit does the same thing without a loop.
    record("surface_rate_cap", "Facility limit: oil rate capped at 20 stb/d on one stage, then decline at separator pressure", "exact",
            "the engine's own rate target with a pressure limit (the control path SPE9 exercises)") do
        cap = 20.0; psep = 1000.0
        s = surf_well(name = "cap_loop")
        c = Ressim.run_fracwell_surface(s, Ressim.SurfaceSpec(separator_psi = psep, oil_cap_stb_d = cap))
        plain = Ressim.run_fracwell(surf_well(name = "cap_plain", bhp_psi = psep); oil_rate_target = cap)
        checks, a, _ = loop_checks(c, plain, s)
        capped_days = sum(c.step_days[c.bhp_psi .> psep + 1])
        (checks = checks, cells = c.run.run.cells, ministeps = c.run.run.stats.ministeps, cuts = c.run.run.stats.cuts,
            detail = @sprintf("%d loop iterations; well held at the limit for %.0f days, peak oil rate %.2f stb/d, 12-month oil %.0f stb", c.iterations, capped_days, maximum(c.oil_stb_d), sum(a)))
    end

    # ---- the single-well form with several stages and live oil -------------------------------------
    # Bars written before the first run (2026-11-09), unseen: the in-timestep surface path had only been
    # exercised on one-stage, single-phase wells.
    record("surface_multistage_live_oil", "One well with three stages, live oil, at a fixed separator pressure: must equal the three stage-wells", "exact",
            "the same model with every stage as its own well at that pressure (no surface condition involved)") do
        s = Ressim.FracWellSpec(name = "multi_single", mesh = "coarse", months = 12)
        r = Ressim.run_fracwell_implicit(s, Ressim.SurfaceSpec(separator_psi = s.bhp_psi))
        plain = Ressim.run_fracwell(Ressim.FracWellSpec(name = "multi_stagewells", mesh = "coarse", months = 12))
        res = r.result; dt = diff(vcat(0.0, res.time))
        gas = sum(-Ressim.well_series(res, :W1, :grat) .* dt) / Ressim.MSCF
        a = Ressim.stage_monthly_oil(res, :W1, s.months)
        b = sum(Ressim.stage_monthly_oil(plain.run.result, Symbol(@sprintf("S%03d", i)), s.months) for i in 1:3)
        (checks = [chk("oil", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("gas", gas / sum(x.gas_mscf for x in plain.stages) - 1, BAR_SURF_CUM),
                chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE), chk("cut_fraction", r.stats.cuts / r.stats.ministeps, BAR_CUT_FRACTION)],
            cells = r.cells, ministeps = r.stats.ministeps, cuts = r.stats.cuts)
    end

    # ---- growth, reservoir and surface in one run ---------------------------------------------------
    # Bars written before the first run, unseen. Liquid-only tubing on a live-oil well overstates the
    # bottom-hole pressure (no gas in the column); the check is that the pieces run together and close.
    record("chain_growth_reservoir_surface", "Fracture growth, live-oil reservoir, 9,050 ft of tubing and a 15 stb/d facility limit in one run", "self",
            "its own conditions: surface condition closed at every step, limit honoured, few cut steps") do
        base = Ressim.FracWellSpec(name = "chain_surface", mesh = "coarse", months = 12, width_ft = 1300.0, positions_ft = [100.0, 300.0, 500.0],
            half_length_ft = fill(1.0, 3), conductivity_mdft = fill(50.0, 3))
        d = Ressim.design_well(base, Ressim.RockSpec(barrier_psi = 600.0, youngs_psi = 4.0e6, leakoff_ft_sqrtmin = 0.002),
            [Ressim.StageDesign(rate_bpm_per_fracture = q, minutes = 60.0) for q in (4.0, 8.0, 12.0)]; propped_fraction = 0.6)
        cap = 15.0
        sf = Ressim.SurfaceSpec(separator_psi = 100.0, oil_cap_stb_d = cap,
            tubing = Ressim.liquid_tubing(depth_ft = 9050.0, id_in = 2.441, density_lb_ft3 = 53.66, viscosity_cp = 1.0))
        r = Ressim.run_fracwell_implicit(d.spec, sf); res = r.result
        bhp = Ressim.well_series(res, :W1, :bhp) ./ Ressim.PSI
        qo = -Ressim.well_series(res, :W1, :orat) .* (Ressim.DAY / Ressim.STB)
        qw = -Ressim.well_series(res, :W1, :wrat) .* (Ressim.DAY / Ressim.STB)
        sc = (d.spec.pressure_psi - sf.separator_psi) / cap
        off = [min(bhp[k] - Ressim.required_bhp(sf, qo[k] + qw[k]), (cap - qo[k]) * sc) for k in eachindex(bhp)]
        dt = diff(vcat(0.0, res.time)) ./ Ressim.DAY
        (checks = [chk("mismatch_psi", maximum(abs, off) / 100, BAR_SURF_MISMATCH / 100), chk("over_limit", max(maximum(qo) / cap - 1, 0.0), 1e-3),
                chk("cut_fraction", r.stats.cuts / r.stats.ministeps, BAR_CUT_FRACTION)],
            cells = r.cells, ministeps = r.stats.ministeps, cuts = r.stats.cuts,
            detail = @sprintf("grown half-lengths %.0f / %.0f / %.0f ft; facility full for %.0f days; bottom-hole pressure %.0f to %.0f psi; 12-month oil %.0f stb",
                d.growth[1].half_length_ft, d.growth[2].half_length_ft, d.growth[3].half_length_ft, sum(dt[qo .> cap * (1 - 1e-3)]), minimum(bhp), maximum(bhp), sum(qo .* dt)))
    end

    # A live-oil well on the same tubing twice: full of liquid, and gas-liquid without slip. Bars unseen.
    record("lift_noslip_well", "Three-stage live-oil well behind 9,050 ft of tubing: liquid-only against gas-liquid without slip", "self",
            "its own conditions: surface condition closed at every step, few cut steps, lower bottom-hole pressure and more oil with gas in the column") do
        s = Ressim.FracWellSpec(name = "lift_well", mesh = "coarse", months = 12)
        kw = (depth_ft = 9050.0, id_in = 2.441)
        lift = Ressim.noslip_lift(; kw...)
        a = Ressim.run_fracwell_implicit(s, Ressim.SurfaceSpec(separator_psi = 100.0, tubing = Ressim.liquid_tubing(; kw..., density_lb_ft3 = 53.66, viscosity_cp = 1.0)))
        b = Ressim.run_fracwell_implicit(s, Ressim.SurfaceSpec(separator_psi = 100.0, lift = lift))
        series(r, k, u) = -Ressim.well_series(r.result, :W1, k) .* (Ressim.DAY / u)
        bhp(r) = Ressim.well_series(r.result, :W1, :bhp) ./ Ressim.PSI
        cum(r) = sum(series(r, :orat, Ressim.STB) .* diff(vcat(0.0, r.result.time)) ./ Ressim.DAY)
        qo, qw, qg = series(b, :orat, Ressim.STB), series(b, :wrat, Ressim.STB), series(b, :grat, Ressim.MSCF)
        off = [bhp(b)[k] - lift(100.0, qo[k], qw[k], qg[k]) for k in eachindex(qo)]
        (checks = [chk("mismatch_psi", maximum(abs, off) / 100, BAR_SURF_MISMATCH / 100), chk("cut_fraction", b.stats.cuts / b.stats.ministeps, BAR_CUT_FRACTION),
                chk("lower_bhp", bhp(b)[end] < bhp(a)[end] ? 0.0 : 1.0, 0.5), chk("more_oil", cum(b) > cum(a) ? 0.0 : 1.0, 0.5)],
            cells = b.cells, ministeps = b.stats.ministeps, cuts = b.stats.cuts,
            detail = @sprintf("12-month oil %.0f stb with liquid-filled tubing (final bottom-hole pressure %.0f psi), %.0f stb without slip (%.0f psi): the true answer lies between",
                cum(a), bhp(a)[end], cum(b), bhp(b)[end]))
    end

    # With slip the tubing curve is not monotone, so this well is marched step by step (run_fracwell_marching).
    # First check that the marching solver agrees with the in-timestep one on a curve both can handle. Bars unseen.
    record("lift_marching_agrees", "Step-by-step operating-point solver against the in-timestep solver (no-slip tubing)", "cross",
            "the in-timestep surface condition on the same well and tubing") do
        s = Ressim.FracWellSpec(name = "march_check", mesh = "coarse", months = 12)
        sf = Ressim.SurfaceSpec(separator_psi = 100.0, lift = Ressim.noslip_lift(depth_ft = 9050.0, id_in = 2.441))
        m = Ressim.run_fracwell_marching(s, sf); i = Ressim.run_fracwell_implicit(s, sf)
        b = Ressim.stage_monthly_oil(i.result, :W1, s.months); a = m.monthly_oil_stb
        (checks = [chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("mismatch_psi", maximum(abs, m.mismatch_psi) / 100, 10 * BAR_SURF_MISMATCH / 100)],
            cells = m.cells, ministeps = m.step_solves, cuts = m.cut_steps,
            detail = @sprintf("%d step solves for %d steps in %.1f s", m.step_solves, length(m.step_days), m.wall_seconds))
    end

    record("lift_slip_well", "Three-stage live-oil well behind 9,050 ft of tubing with gas-liquid slip", "self",
            "its own conditions: operating point closed at every step, few cut steps, oil between the liquid-only and no-slip runs") do
        s = Ressim.FracWellSpec(name = "slip_well", mesh = "coarse", months = 12)
        kw = (depth_ft = 9050.0, id_in = 2.441)
        cum(r) = sum(-Ressim.well_series(r.result, :W1, :orat) .* diff(vcat(0.0, r.result.time))) / Ressim.STB
        lo = Ressim.run_fracwell_implicit(s, Ressim.SurfaceSpec(separator_psi = 100.0, tubing = Ressim.liquid_tubing(; kw..., density_lb_ft3 = 53.66, viscosity_cp = 1.0)))
        hi = Ressim.run_fracwell_implicit(s, Ressim.SurfaceSpec(separator_psi = 100.0, lift = Ressim.noslip_lift(; kw...)))
        m = Ressim.run_fracwell_marching(s, Ressim.SurfaceSpec(separator_psi = 100.0, lift = Ressim.driftflux_lift(; kw...)))
        tot = sum(m.monthly_oil_stb)
        (checks = [chk("mismatch_psi", maximum(abs, m.mismatch_psi) / 100, 10 * BAR_SURF_MISMATCH / 100), chk("cut_fraction", m.cut_steps / m.step_solves, BAR_CUT_FRACTION),
                chk("between_bounds", cum(lo) <= tot <= cum(hi) ? 0.0 : 1.0, 0.5)],
            cells = m.cells, ministeps = m.step_solves, cuts = m.cut_steps,
            detail = @sprintf("12-month oil: %.0f stb liquid-filled tubing, %.0f stb with slip, %.0f stb without slip; bottom-hole pressure with slip from %.0f to %.0f psi; %d step solves in %.1f s",
                cum(lo), tot, cum(hi), minimum(m.bhp_psi), m.bhp_psi[end], m.step_solves, m.wall_seconds))
    end

    # ---- two laterals in the same rock. Bars written before the first run, unseen. ----
    # The mirror checks are run with tight solver tolerances: at the default tolerances two mirror-image stages
    # differ by about 1e-4 (solver noise), at tight tolerances by 1e-11. Found after the first run; bar unchanged.
    TIGHT = (tol_cnv = 1e-7, tol_mb = 1e-11, rtol = 1e-10)
    pad(tag, gap; months = 36) = Ressim.FracWellSpec(name = "pad_$tag", fluid = "oil", mesh = "coarse", months = months, width_ft = 3000.0, perm_md = 0.005,
        positions_ft = [100.0, 300.0, 100.0, 300.0], half_length_ft = fill(250.0, 4), conductivity_mdft = fill(50.0, 4),
        center_ft = [1500.0 - gap / 2, 1500.0 - gap / 2, 1500.0 + gap / 2, 1500.0 + gap / 2])
    record("pad_far_apart", "Two laterals 2,000 ft apart in the same rock: each must equal a lateral on its own", "exact",
            "one lateral alone in the same model (the other absent)") do
        both = Ressim.run_fracwell(pad("far", 2000.0); TIGHT...)
        s1 = Ressim.FracWellSpec(name = "pad_alone", fluid = "oil", mesh = "coarse", months = 36, width_ft = 3000.0, perm_md = 0.005,
            positions_ft = [100.0, 300.0], half_length_ft = fill(250.0, 2), conductivity_mdft = fill(50.0, 2), center_ft = [500.0, 500.0])
        alone = Ressim.run_fracwell(s1; TIGHT...)
        a = [x.oil_stb for x in both.stages]; b = alone.stages[1].oil_stb
        (checks = [chk("same_as_alone", maximum(abs.(a ./ b .- 1)), 0.005), chk("mirror", abs(a[1] / a[3] - 1), 1e-6)],
            cells = both.run.cells, ministeps = both.run.stats.ministeps, cuts = both.run.stats.cuts,
            detail = @sprintf("36-month oil per stage %.0f stb with the second lateral 2,000 ft away, %.0f stb alone", a[1], b))
    end

    record("pad_interference", "Two laterals in the same rock at 2,000, 800 and 550 ft spacing (500 ft tip-to-tip fracture span each)", "self",
            "its own conditions: mirror-image laterals equal, and each makes less the closer they are") do
        r = [Ressim.run_fracwell(pad("gap$(Int(g))", g); TIGHT...) for g in (2000.0, 800.0, 550.0)]
        per = [sum(x.oil_stb for x in ri.stages) / 2 for ri in r]
        mirror = maximum(abs(ri.stages[1].oil_stb / ri.stages[3].oil_stb - 1) for ri in r)
        (checks = [chk("mirror", mirror, 1e-6), chk("less_when_closer", per[1] > per[2] > per[3] ? 0.0 : 1.0, 0.5),
                chk("cut_fraction", maximum(ri.run.stats.cuts / ri.run.stats.ministeps for ri in r), BAR_CUT_FRACTION)],
            cells = r[3].run.cells, ministeps = r[3].run.stats.ministeps, cuts = r[3].run.stats.cuts,
            detail = @sprintf("36-month oil per lateral (two stages, 5 microdarcy rock): %.0f stb at 2,000 ft, %.0f stb at 800 ft (%.1f%%), %.0f stb at 550 ft (%.1f%%)",
                per[1], per[2], 100 * (per[2] / per[1] - 1), per[3], 100 * (per[3] / per[1] - 1)))
    end

    # ---- several wells on one facility -----------------------------------------------------------
    # Bars written before the first run (2026-11-09). Two identical wells must each behave like one well
    # on its own with the equivalent surface condition, which the single-well tests above already check.
    BAR_FIELD_TWIN = 1e-6      # identical wells must produce the same
    BAR_FIELD_CAP = 1e-3       # total oil against the facility limit while it binds
    field_well(tag; kw...) = surf_well(; name = "field_$tag", kw...)

    record("field_twins_shared_line", "Two identical wells on a shared flowline (10 psi per stb/d of total liquid)", "exact",
            "one such well alone with twice the line resistance as its tubing (in-timestep form)") do
        Rl = 10.0; psep = 1000.0
        s = field_well("a")
        f = Ressim.run_field(Ressim.FieldSpec(wells = [s, field_well("b")], separator_psi = psep, line = q -> Rl * q))
        one = Ressim.run_fracwell_implicit(field_well("one"), Ressim.SurfaceSpec(separator_psi = psep, tubing = q -> 2 * Rl * q))
        b = Ressim.stage_monthly_oil(one.result, :W1, s.months); a = f.monthly_oil_stb[:, 1]
        (checks = [chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("twins", maximum(abs.(f.monthly_oil_stb[:, 1] .- f.monthly_oil_stb[:, 2])) / maximum(a), BAR_FIELD_TWIN),
                chk("mismatch_psi", maximum(abs, f.mismatch_psi) / 100, BAR_SURF_MISMATCH / 100)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("%d step solves for %d steps x 2 wells in %.1f s; node pressure from %.0f down to %.0f psi; 12-month oil per well %.0f stb",
                f.step_solves, length(f.step_days), f.wall_seconds, maximum(f.node_psi), f.node_psi[end], sum(a)))
    end

    record("field_twins_facility_cap", "Two identical wells under a 40 stb/d facility oil limit", "exact",
            "one such well alone under a 20 stb/d limit (in-timestep form, itself checked against the engine's rate target)") do
        psep = 1000.0
        s = field_well("c")
        f = Ressim.run_field(Ressim.FieldSpec(wells = [s, field_well("d")], separator_psi = psep, oil_cap_stb_d = 40.0))
        one = Ressim.run_fracwell_implicit(field_well("cap1"), Ressim.SurfaceSpec(separator_psi = psep, oil_cap_stb_d = 20.0))
        b = Ressim.stage_monthly_oil(one.result, :W1, s.months); a = f.monthly_oil_stb[:, 1]
        tot = vec(sum(f.oil_stb_d, dims = 2))
        (checks = [chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("twins", maximum(abs.(f.monthly_oil_stb[:, 1] .- f.monthly_oil_stb[:, 2])) / maximum(a), BAR_FIELD_TWIN),
                chk("over_limit", max(maximum(tot) / 40.0 - 1, 0.0), BAR_FIELD_CAP)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("%d step solves in %.1f s; facility full for %.1f days; peak total oil %.3f stb/d", f.step_solves, f.wall_seconds,
                sum(f.step_days[f.node_psi .> psep + 1]), maximum(tot)))
    end

    record("field_unequal_wells", "A strong and a weak well on one line under a 30 stb/d facility limit", "self",
            "its own conditions: limit honoured, node equation closed, both wells at the common node pressure") do
        psep = 1000.0; Rl = 5.0; cap = 30.0
        strong = field_well("strong", half_length_ft = [350.0], conductivity_mdft = [100.0])
        weak = field_well("weak", half_length_ft = [150.0], conductivity_mdft = [20.0])
        f = Ressim.run_field(Ressim.FieldSpec(wells = [strong, weak], separator_psi = psep, line = q -> Rl * q, oil_cap_stb_d = cap))
        tot = vec(sum(f.oil_stb_d, dims = 2)); full = tot .> cap * (1 - 1e-3)
        cum = vec(sum(f.monthly_oil_stb, dims = 1))
        (checks = [chk("over_limit", max(maximum(tot) / cap - 1, 0.0), BAR_FIELD_CAP), chk("mismatch_psi", maximum(abs, f.mismatch_psi) / 100, BAR_SURF_MISMATCH / 100),
                chk("node_common", maximum(abs.(f.bhp_psi[:, 1] .- f.bhp_psi[:, 2])) / 100, BAR_SURF_MISMATCH / 100)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("facility full for %.1f days; 12-month oil: strong well %.0f stb, weak well %.0f stb (%.0f%% / %.0f%%); %d step solves in %.1f s",
                sum(f.step_days[full]), cum[1], cum[2], 100 * cum[1] / sum(cum), 100 * cum[2] / sum(cum), f.step_solves, f.wall_seconds))
    end

    # ---- allocation rules under a facility limit. Bars written before the first run, unseen. ----
    record("field_pro_rata_twins", "Pro-rata allocation, two identical wells under 40 stb/d: each must match one well under 20 stb/d", "exact",
            "one such well alone under a 20 stb/d limit (in-timestep form)") do
        psep = 1000.0; s = field_well("pr1")
        f = Ressim.run_field(Ressim.FieldSpec(wells = [s, field_well("pr2")], separator_psi = psep, oil_cap_stb_d = 40.0, allocation = :pro_rata))
        one = Ressim.run_fracwell_implicit(field_well("pr0"), Ressim.SurfaceSpec(separator_psi = psep, oil_cap_stb_d = 20.0))
        b = Ressim.stage_monthly_oil(one.result, :W1, s.months); a = f.monthly_oil_stb[:, 1]
        tot = vec(sum(f.oil_stb_d, dims = 2))
        (checks = [chk("cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("twins", maximum(abs.(f.monthly_oil_stb[:, 1] .- f.monthly_oil_stb[:, 2])) / maximum(a), BAR_FIELD_TWIN),
                chk("over_limit", max(maximum(tot) / 40.0 - 1, 0.0), BAR_FIELD_CAP)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("facility full for %.1f days; %d step solves in %.1f s", sum(f.step_days[f.facility_full]), f.step_solves, f.wall_seconds))
    end

    record("field_priority_twins", "Priority allocation, two identical wells under 40 stb/d: the first well must match one well alone under 40 stb/d", "exact",
            "one such well alone under a 40 stb/d limit (no shared line, so the first well cannot feel the second)") do
        psep = 1000.0; s = field_well("pri1")
        f = Ressim.run_field(Ressim.FieldSpec(wells = [s, field_well("pri2")], separator_psi = psep, oil_cap_stb_d = 40.0, allocation = :priority, priority = [1, 2]))
        one = Ressim.run_fracwell_implicit(field_well("pri0"), Ressim.SurfaceSpec(separator_psi = psep, oil_cap_stb_d = 40.0))
        b = Ressim.stage_monthly_oil(one.result, :W1, s.months); a = f.monthly_oil_stb[:, 1]
        tot = vec(sum(f.oil_stb_d, dims = 2)); full = f.facility_full
        (checks = [chk("first_well_cum", sum(a) / sum(b) - 1, BAR_SURF_CUM), chk("first_well_curve", sum(abs.(a .- b)) / sum(b), BAR_SURF_CURVE),
                chk("over_limit", max(maximum(tot) / 40.0 - 1, 0.0), BAR_FIELD_CAP),
                chk("full_means_full", any(full) ? maximum(abs.(tot[full] ./ 40.0 .- 1)) : 1.0, BAR_FIELD_CAP)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("facility full for %.1f days; 12-month oil: first well %.0f stb, second well %.0f stb", sum(f.step_days[full]),
                sum(f.monthly_oil_stb[:, 1]), sum(f.monthly_oil_stb[:, 2])))
    end

    # Regression for a failure reported from the game back end (2026-11-10): three unequal live-oil wells behind
    # liquid tubing with a facility limit far below their flush rate. The common choke has to hold the node within a
    # fraction of a psi of shut-in, where rate changes by thousands of stb/d per psi. Bars written with the fix.
    record("field_common_choke_flush", "Common choke with the limit far below flush rate: three unequal live-oil wells, 66.7 stb/d", "self",
            "its own conditions: the run completes, the limit is honoured, and the total matches the pro-rata run of the same field") do
        gw(name, perm, thick, half) = Ressim.FracWellSpec(name = name, fluid = "blackoil_spe1", mesh = "coarse", months = 24, dt_max_days = 30.0, positions_ft = [125.0],
            edge_ft = 125.0, width_ft = 880.0, conductivity_mdft = [50.0], perm_md = perm, thickness_ft = thick, half_length_ft = [half])
        ws() = [gw("W1", 0.0076, 113.0, 300.0), gw("W2", 0.0036, 72.0, 400.0), gw("W3", 0.0064, 83.0, 300.0)]
        tube = [Ressim.liquid_tubing(depth_ft = 9000.0, id_in = 2.441, density_lb_ft3 = 53.66, viscosity_cp = 1.0) for _ in 1:3]
        f = Ressim.run_field(Ressim.FieldSpec(wells = ws(), tubing = tube, separator_psi = 100.0, oil_cap_stb_d = 66.7, allocation = :common_choke))
        g = Ressim.run_field(Ressim.FieldSpec(wells = ws(), tubing = tube, separator_psi = 100.0, oil_cap_stb_d = 66.7, allocation = :pro_rata))
        tot = vec(sum(f.oil_stb_d, dims = 2))
        (checks = [chk("over_limit", max(maximum(tot) / 66.7 - 1, 0.0), BAR_FIELD_CAP), chk("same_total_as_pro_rata", sum(f.monthly_oil_stb) / sum(g.monthly_oil_stb) - 1, 0.005)],
            cells = sum(f.cells), ministeps = f.step_solves, cuts = f.cut_steps,
            detail = @sprintf("%d step solves in %.1f s; node pressure up to %.0f psi; 24-month oil by well %s stb (pro-rata: %s)", f.step_solves, f.wall_seconds, maximum(f.node_psi),
                join(round.(Int, vec(sum(f.monthly_oil_stb, dims = 1))), " / "), join(round.(Int, vec(sum(g.monthly_oil_stb, dims = 1))), " / ")))
    end

    # Finite half-length and finite conductivity: one stage set up like stage-sim's weak__sym case and
    # compared with that research model's 3x-refined run (read-only). Bars written before the first run:
    # 24-month recovery within 2%, monthly curve within 3%, standard mesh.
    # Rock that varies across a fractured-well model. Bars written before the first run (2026-11-10).
    record("fracwell_maps", "Fractured well in rock that varies across the map: pore volume and kh decide, water is immobile, the model reads a geology grid", "self",
            "its own conditions: uniform maps equal single values; equal pore volume, kh and fracture capacity give equal production; mirror image; direction of a rich streak") do
        spec(; kw...) = Ressim.FracWellSpec(; name = "maps", fluid = "oil", mesh = "coarse", months = 12, width_ft = 1200.0, perm_md = 0.002, porosity = 0.08, thickness_ft = 100.0,
            positions_ft = [100.0, 300.0], edge_ft = 100.0, half_length_ft = [250.0, 250.0], conductivity_mdft = [50.0, 50.0], kw...)
        cum(r) = sum(x.oil_stb for x in r.stages)
        plain = Ressim.run_fracwell(spec())
        same = Ressim.run_fracwell(spec(porosity_map = (x, y) -> 0.08, perm_map = (x, y) -> 0.002, net_thickness_map = (x, y) -> 100.0, sw_map = (x, y) -> 0.0))
        # half the net pay, twice the porosity, permeability and fracture conductivity: the same pore volume, kh and fracture capacity
        thin = Ressim.run_fracwell(spec(porosity_map = (x, y) -> 0.16, perm_map = (x, y) -> 0.004, net_thickness_map = (x, y) -> 50.0, conductivity_mdft = [100.0, 100.0]))
        # water in 30% of the pores, with porosity raised so that the oil-filled pore volume is unchanged
        wet = Ressim.run_fracwell(spec(porosity_map = (x, y) -> 0.08 / 0.7, sw_map = (x, y) -> 0.3))
        rich = Ressim.run_fracwell(spec(perm_map = (x, y) -> x < 200 ? 0.006 : 0.002))                 # better rock around the first stage only
        tilt(sgn) = (x, y) -> 0.002 * (1 + 0.5 * sgn * (y - 600.0) / 600.0)                              # a trend across the model, and its mirror image about the lateral
        up = Ressim.run_fracwell(spec(perm_map = tilt(1))); down = Ressim.run_fracwell(spec(perm_map = tilt(-1)))
        g = Ressim.synthetic_geology(nx = 64, ny = 64, cell_ft = 132.0, range_ft = 1500.0, seed = 3)
        real = Ressim.run_fracwell(spec(; thickness_ft = maximum(g.fields[:gross_ft].values), Ressim.well_maps(g; origin_ft = (3000.0, 4000.0), azimuth_deg = 30.0, width_ft = 1200.0)...))
        (checks = [chk("uniform_maps_same", cum(same) / cum(plain) - 1, 1e-9), chk("same_volume_and_kh", cum(thin) / cum(plain) - 1, 1e-6), chk("immobile_water", cum(wet) / cum(plain) - 1, 1e-9),
                chk("rich_streak_helps_its_stage", rich.stages[1].oil_stb > 1.05 * plain.stages[1].oil_stb && rich.stages[1].oil_stb > rich.stages[2].oil_stb ? 0.0 : 1.0, 0.5),
                chk("mirror", cum(up) / cum(down) - 1, BAR_STAGE_SYMMETRY), chk("geology_run", cum(real) > 0 ? 0.0 : 1.0, 0.5),
                chk("cut_fraction", maximum(r.run.stats.cuts / r.run.stats.ministeps for r in (thin, rich, up, real)), BAR_CUT_FRACTION)],
            cells = plain.run.cells, ministeps = real.run.stats.ministeps, cuts = real.run.stats.cuts,
            detail = @sprintf("12-month oil: %.0f stb uniform; %.0f with half the net pay and doubled porosity, permeability and conductivity; %.0f with a rich streak at stage 1 (that stage %.0f against %.0f); %.0f stb reading a generated geology",
                cum(plain), cum(thin), cum(rich), rich.stages[1].oil_stb, plain.stages[1].oil_stb, cum(real)))
    end

    # Parent and child wells: stages that start later, in rock the earlier ones have depleted. Bars written before the first run (2026-11-10).
    record("fracwell_parent_child", "Parent and child laterals: a later well drills into depleted rock, and takes from its parent", "self",
            "its own conditions: no late start equals the plain run; a far-away child leaves the parent alone; a near child loses to depletion, more so the later it comes; the parent loses to the child") do
        spec(; kw...) = Ressim.FracWellSpec(; name = "pc", fluid = "blackoil_spe1", mesh = "coarse", months = 36, width_ft = 3000.0, perm_md = 0.005,
            positions_ft = [100.0, 100.0], edge_ft = 100.0, half_length_ft = [250.0, 250.0], conductivity_mdft = [50.0, 50.0], kw...)
        at(gap) = [1500.0 - gap / 2, 1500.0 + gap / 2]
        child_window(r, start) = sum(r.monthly_oil_stb[start+1:start+12, 2])                   # the child's first twelve months
        together = Ressim.run_fracwell(spec(center_ft = at(500.0))); zeros_given = Ressim.run_fracwell(spec(center_ft = at(500.0), start_month = [0, 0]))
        alone = Ressim.run_fracwell(Ressim.FracWellSpec(; name = "pc1", fluid = "blackoil_spe1", mesh = "coarse", months = 36, width_ft = 3000.0, perm_md = 0.005,
            positions_ft = [100.0], edge_ft = 100.0, half_length_ft = [250.0], conductivity_mdft = [50.0]))
        far = Ressim.run_fracwell(spec(center_ft = [600.0, 2600.0], start_month = [0, 12]))
        soon = Ressim.run_fracwell(spec(center_ft = at(500.0), start_month = [0, 6])); late = Ressim.run_fracwell(spec(center_ft = at(500.0), start_month = [0, 24]))
        p = Ressim.pressure_field(late)
        (checks = [chk("no_late_start_same", sum(zeros_given.monthly_oil_stb) / sum(together.monthly_oil_stb) - 1, 1e-9),
                chk("far_child_leaves_parent", far.stages[1].oil_stb / alone.stages[1].oil_stb - 1, 0.01),
                chk("far_child_like_new_well", child_window(far, 12) / sum(alone.monthly_oil_stb[1:12, 1]) - 1, 0.02),
                chk("near_child_loses", child_window(soon, 6) < sum(alone.monthly_oil_stb[1:12, 1]) ? 0.0 : 1.0, 0.5),
                chk("later_child_loses_more", child_window(late, 24) < child_window(soon, 6) ? 0.0 : 1.0, 0.5),
                chk("parent_loses_to_child", soon.stages[1].oil_stb < alone.stages[1].oil_stb ? 0.0 : 1.0, 0.5),
                chk("child_quiet_before_start", sum(late.monthly_oil_stb[1:24, 2]), 0.0),
                chk("pressure_field_shape", size(p.psi) == (late.layout.nx, late.layout.ny) && minimum(p.psi) > 1000 && maximum(p.psi) <= 5000.01 ? 0.0 : 1.0, 0.5),
                chk("cut_fraction", maximum(r.run.stats.cuts / r.run.stats.ministeps for r in (soon, late, far)), BAR_CUT_FRACTION)],
            cells = late.run.cells, ministeps = late.run.stats.ministeps, cuts = late.run.stats.cuts,
            detail = @sprintf("live oil, laterals 500 ft apart. A new well's first 12 months: %.0f stb alone; %.0f stb as a child 6 months after its parent; %.0f stb 24 months after. The parent's 36 months: %.0f stb alone, %.0f with a child from month 6. Lowest pressure in the rock at the end of the late-child run: %.0f psi",
                sum(alone.monthly_oil_stb[1:12, 1]), child_window(soon, 6), child_window(late, 24), alone.stages[1].oil_stb, soon.stages[1].oil_stb, minimum(p.psi)))
    end

    # Fast run modes for batches. The bars were set AFTER a scratch measurement (120 months: fast -1.9 / -0.9 / -0.6 % oil at 3 / 12 / 60
    # months, screening -3.9 / -5.1 / -1.5 %), with some margin; this test re-measures them on a 60-month run.
    record("fracwell_fast_modes", "Fast and screening run modes for batches of runs: what they cost in accuracy", "self",
            "the standard mesh with default time steps on the same well (mesh and time-step sensitivity, not an outside check)") do
        base = Ressim.FracWellSpec(name = "fastmodes", fluid = "blackoil_spe1", mesh = "standard", months = 60, width_ft = 1320.0, perm_md = 0.005, positions_ft = [100.0, 300.0, 500.0],
            half_length_ft = fill(300.0, 3), conductivity_mdft = fill(50.0, 3))
        t0 = @elapsed ref = Ressim.run_fracwell(base)
        t1 = @elapsed fast = Ressim.run_fracwell(Ressim.fast_spec(base)); t2 = @elapsed scr = Ressim.run_fracwell(Ressim.fast_spec(base; level = :screening))
        e(r, f, m) = sum(getfield(r, f)[1:m, :]) / sum(getfield(ref, f)[1:m, :]) - 1
        (checks = [chk("fast_oil_12", e(fast, :monthly_oil_stb, 12), 0.02), chk("fast_oil_60", e(fast, :monthly_oil_stb, 60), 0.015), chk("fast_gas_60", e(fast, :monthly_gas_mscf, 60), 0.025),
                chk("screening_oil_12", e(scr, :monthly_oil_stb, 12), 0.07), chk("screening_oil_60", e(scr, :monthly_oil_stb, 60), 0.03), chk("screening_gas_60", e(scr, :monthly_gas_mscf, 60), 0.06),
                chk("fast_is_faster", t1 < t0 / 4 ? 0.0 : 1.0, 0.5), chk("screening_is_fastest", t2 < t1 ? 0.0 : 1.0, 0.5)],
            cells = ref.run.cells, ministeps = fast.run.stats.ministeps, cuts = fast.run.stats.cuts,
            detail = @sprintf("60 months: standard %.1f s; fast %.1f s (oil %+.1f%% at 12 months, %+.1f%% at 60); screening %.1f s (oil %+.1f%%, %+.1f%%)", t0, t1,
                100 * e(fast, :monthly_oil_stb, 12), 100 * e(fast, :monthly_oil_stb, 60), t2, 100 * e(scr, :monthly_oil_stb, 12), 100 * e(scr, :monthly_oil_stb, 60)))
    end

    record("fracwell_vs_stage_sim", "Fractured well builder: finite fracture (279 ft half-length, 6.6 md-ft) against our research model", "cross",
            "stage-sim weak__sym on its 3x-refined mesh (same engine, independently built model)") do
        ref_dir = normpath(joinpath(@__DIR__, "..", "..", "stage-sim", "results_v3", "weak__sym__mesh3"))
        tab, head = readdlm(joinpath(ref_dir, "steps.csv"), ',', header = true); h = String.(vec(head))
        meta = TOML.parsefile(joinpath(ref_dir, "meta.toml"))
        col(n) = Float64.(tab[:, findfirst(==(n), h)])
        t_ref = col("t_days"); frac_ref = cumsum(col("q2") .* col("dt_days") .* Ressim.DAY) ./ (meta["inventory0_kg"] / 3)
        m = 1 / Ressim.FT
        s = Ressim.FracWellSpec(name = "vs_stage_sim", fluid = "oil", thickness_ft = 10m, width_ft = 410m, perm_md = 1e-3, porosity = 0.08,
            pressure_psi = 300e5 / Ressim.PSI, bhp_psi = 100e5 / Ressim.PSI, rock_compressibility = 0.5e-9 * Ressim.PSI,
            oil_compressibility = 1.5e-9 * Ressim.PSI, oil_viscosity_cp = 1.0, positions_ft = [100m], half_length_ft = [85m],
            conductivity_mdft = [2m], edge_ft = 100m, fracture_width_ft = 2m, mesh = "standard")
        r = Ressim.run_fracwell(s)
        x0 = s.rock_compressibility * (s.pressure_psi - 14.7)
        ooip = s.porosity * (200m * 410m * 10m) / 5.614583333 * (1 + x0 + 0.5 * x0^2)        # stb, Bo = 1 at initial pressure
        sim = cumsum(Ressim.stage_monthly_oil(r.run.result, :S001, s.months)) ./ ooip
        ref = Ressim.interp1(t_ref, frac_ref, [k * Ressim.MONTH_DAYS for k in 1:s.months])
        dsim = diff(vcat(0.0, sim)); dref = diff(vcat(0.0, ref))
        (checks = [chk("cum", sim[end] / ref[end] - 1, 0.02), chk("curve", sum(abs.(dsim .- dref)) / sum(dref), 0.03)],
            cells = r.run.cells, ministeps = r.run.stats.ministeps, cuts = r.run.stats.cuts,
            detail = @sprintf("24-month recovery %.4f%% of oil in place, reference %.4f%%; half-length on mesh %.1f ft", 100 * sim[end], 100 * ref[end], r.stages[1].half_length_ft))
    end

    record("fracwell_blackoil_mesh", "Fractured well builder: coarse against standard mesh, live oil", "self", "the same model on the finer mesh preset") do
        a = FW_COARSE[]; b = fracwell_blackoil("standard")
        tot(r, k) = sum(getfield(x, k) for x in r.stages)
        (checks = [chk("field_oil", tot(a, :oil_stb) / tot(b, :oil_stb) - 1, BAR_MESH_SENS), chk("field_gas", tot(a, :gas_mscf) / tot(b, :gas_mscf) - 1, BAR_MESH_SENS)],
            cells = b.run.cells, ministeps = b.run.stats.ministeps, cuts = b.run.stats.cuts,
            detail = @sprintf("standard mesh, 24 months, three stages: %.0f stb oil, %.0f Mscf gas (coarse: %.0f stb, %.0f Mscf)", tot(b, :oil_stb), tot(b, :gas_mscf), tot(a, :oil_stb), tot(a, :gas_mscf)))
    end

    # ---- a second, independent reference: MRST solutions shipped with the engine's own tests ----------
    # Bars written before the first run, unseen (2026-11-09): the same 1% pressure / 2% rate bars as above.
    mrst_path(name) = joinpath(dirname(dirname(Base.find_package("JutulDarcy"))), "test", "mrst", name * ".mat")
    function mrst_checks(name, items)
        t = @elapsed res = simulate_mrst_case(mrst_path(name), info_level = -1)
        ref = res.extra[:mrst]["extra"][1]["mrst_solution"]
        names = vec(ref["names"]); checks = Dict{String, Any}[]
        for (w, key, mkey, bar) in items
            j = findfirst(isequal(String(w)), names)
            push!(checks, chk("$w:$key", Ressim.series_error(res.time, abs.(res.wells.wells[w][key]), res.time, abs.(vec(ref[mkey][:, j]))), bar))
        end
        st = Ressim.step_stats(res)
        (checks = checks, cells = number_of_cells(reservoir_domain(res.extra[:case].model)), ministeps = st.ministeps, cuts = st.cuts)
    end

    record("cross_spe1_mrst", "SPE1 against a second reference: MRST", "cross", "MRST solution shipped with the engine's tests") do
        mrst_checks("spe1", ((:PRODUCER, :bhp, "bhp", BAR_BHP), (:INJECTOR, :bhp, "bhp", BAR_BHP), (:PRODUCER, :orat, "qOs", BAR_RATE), (:PRODUCER, :grat, "qGs", BAR_RATE)))
    end

    record("cross_spe3_mrst", "SPE3: gas condensate with oil vaporised in the gas, against MRST", "cross", "MRST solution shipped with the engine's tests") do
        mrst_checks("spe3", ((:PRODUCER, :bhp, "bhp", BAR_BHP), (:PRODUCER, :grat, "qGs", BAR_RATE), (:PRODUCER, :orat, "qOs", BAR_RATE)))
    end

    # Written after its two outcomes had been seen in a scratch run (2026-11-10); first included in the suite after that day's last full run.
    record("fluid_table_warning", "A run that leaves the pressure range of its fluid tables is flagged (SPE3 is, SPE1 is not)", "self",
            "its own conditions: the note appears for SPE3, names the table's lowest pressure, and does not appear for SPE1") do
        low = simulate_mrst_case(mrst_path("spe3"), info_level = -1); fine = simulate_mrst_case(mrst_path("spe1"), info_level = -1)
        note = Ressim.fluid_table_note(low.extra[:case], low); floors = Ressim.fluid_table_floors(reservoir_model(low.extra[:case].model))
        (checks = [chk("flagged", isnothing(note) ? 1.0 : 0.0, 0.5), chk("table_floor_psia", maximum(floors) / Ressim.PSI - 1214.7, 0.1),
                chk("not_flagged", isnothing(Ressim.fluid_table_note(fine.extra[:case], fine)) ? 0.0 : 1.0, 0.5)],
            detail = something(note, "no note"))
    end

    record("cross_spe9", "SPE9: black oil, 9,000 cells, 26 wells with control switching", "cross", "OPM Flow results shipped with the benchmark") do
        dir = dataset("SPE9"); ref = load_ref(dir)
        o = Ressim.run_deck(joinpath(dir, "SPE9.DATA"); output_substates = true); res = o.result
        f = Ressim.field_totals(res)
        checks = [chk("field_oil", Ressim.series_error(res.time, f[:oil_prod], ref.t, ref.total(":orat")), BAR_FIELD_RATE),
            chk("field_gas", Ressim.series_error(res.time, f[:gas_prod], ref.t, ref.total(":grat")), BAR_FIELD_RATE),
            chk("field_water", Ressim.series_error(res.time, f[:water_prod], ref.t, ref.total(":wrat")), BAR_FIELD_RATE),
            chk("INJE1:bhp", Ressim.series_error(res.time, Ressim.well_series(res, :INJE1, :bhp), ref.t, ref.col("INJE1:bhp")), BAR_BHP)]
        (checks = checks, deck_info(o)...)
    end

    record("cross_egg", "Egg: two-phase water flood, corner-point grid with inactive cells, 12 wells", "cross", "OPM Flow results shipped with the benchmark") do
        dir = dataset("EGG"); ref = load_ref(dir)
        o = Ressim.run_deck(joinpath(dir, "EGG.DATA"); output_substates = true); res = o.result
        f = Ressim.field_totals(res)
        # The shipped reference holds no pressures (every bhp column is zero), so only rates are compared.
        # The first run of this suite had a pressure check here; it was removed as a defect of the test, not a miss.
        checks = [chk("field_oil", Ressim.series_error(res.time, f[:oil_prod], ref.t, ref.total(":orat")), BAR_FIELD_RATE),
            chk("field_water", Ressim.series_error(res.time, f[:water_prod], ref.t, ref.total(":wrat")), BAR_FIELD_RATE)]
        (checks = checks, deck_info(o)..., detail = "reference file has no pressure data; rates only")
    end

    record("cross_compositional", "Compositional: 3-component miscible gas displacement, equation of state", "cross", "ECLIPSE 300 results shipped with the benchmark") do
        dir = dataset("SIMPLE_COMP")
        ref = Jutul.JLD2.load(joinpath(dir, "reference.jld2"))["e300"]
        o = Ressim.run_deck(joinpath(dir, "SIMPLE_COMP.DATA")); st = o.result.states
        @assert length(st) == length(ref)
        checks = Dict{String, Any}[]
        for ix in (250, 500)
            push!(checks, chk("gas_sat@$ix", sum(abs.(st[ix][:Saturations][2, :] .- ref[ix][:Saturations][2, :])) / 1000, BAR_PROFILE))
            push!(checks, chk("mole_frac@$ix", maximum(sum(abs.(st[ix][:OverallMoleFractions] .- ref[ix][:OverallMoleFractions]), dims = 2)) / 1000, BAR_PROFILE))
        end
        (checks = checks, deck_info(o)...)
    end

    record("cross_polymer", "Polymer flood in black oil (mobility control, adsorption)", "cross", "OPM-tests reference results shipped with the benchmark") do
        dir = dataset("BOPOLYMER_NOSHEAR")
        tab, header = readdlm(joinpath(dir, "result.txt"), header = true)
        h = String.(vec(header)); d = Float64.(tab[2:end, :])            # first row holds the units
        col(n) = d[:, findfirst(==(n), h)]
        o = Ressim.run_deck(joinpath(dir, "BOPOLYMER_NOSHEAR.DATA"); output_substates = true); res = o.result
        t_ref = col("TIME") .* DAY
        checks = [chk("PROD01:oil", Ressim.series_error(res.time, -Ressim.well_series(res, :PROD01, :orat) .* DAY, t_ref, col("WOPR:PROD01")), BAR_RATE),
            chk("INJE01:bhp", Ressim.series_error(res.time, Ressim.well_series(res, :INJE01, :bhp) ./ BAR, t_ref, col("WBHP:INJE01")), BAR_BHP)]
        (checks = checks, deck_info(o)...)
    end
end

@assert Ressim.exact_self_test()
np = count(t -> t["status"] == "pass", TESTS)
println("\n", np, " of ", length(TESTS), " pass (tier ", TIER, "). Results: ", OUT)
