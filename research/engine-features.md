# Engine features run for the first time (stream 7, 2026-11-10)

The scorecard had a group of rows marked "in the engine but not run here". This note records, for each one, what was
run, against what, where the feature lives in the installed engine (JutulDarcy 0.3.11, Jutul 0.4.31, GeoEnergyIO), and
what was left out. The models are in `validation/enginefeat.jl`; the tests are between the STREAM 7 markers of
`validation/suite.jl`. Engine paths are relative to `~/.julia/packages/JutulDarcy/4XRqw/`.

## What was run

| Test | Feature | Engine source | Model | Compared with | Kind |
|---|---|---|---|---|---|
| `engine_tracer` | Tracers | `src/Tracers/` | Water through a water-filled 1-D reservoir, injector to producer, 200 and 400 cells; tracer 1 injected at concentration 1, tracer 2 at 0 | Material balance (reservoir plus wellbores); front position = water injected / water in place | exact |
| `engine_heat_conduction` | Thermal model | `src/thermal/` | Bar of rock at rest, first cell held hot by a very large heat capacity, 50 / 100 / 200 cells | Error-function solution for a half-space | exact |
| `engine_hysteresis_curves` | Hysteresis | `src/variables/relperm/hysteresis.jl` | `kr_hysteresis` called directly on drainage and imbibition curves with known formulas | Carlson's rule (imbibition curve moved sideways to the turning point) and Killough's rule with Land's trapping, both written out from the end points | exact |
| `engine_hysteresis_trapping` | Hysteresis in a run | same | Gas into 40 water-filled cells, then 12 pore volumes of water | Land's trapped saturation from the largest gas saturation each cell saw; the same flood without hysteresis | exact |
| `engine_endpoint_scaling` | End-point scaling from a deck | `src/variables/relperm/endscale.jl`, `src/input_simulation/data_input.jl` (`set_scaling_arguments!`), `mrst_input.jl` (`deck_relperm`) | 50-cell water flood deck with `ENDSCALE`, `SWL`, `SWCR`, `SWU`, `SOWCR` | The same deck with the scaled table written out by hand (two-point rule) and no scaling keywords | exact |
| `engine_multisegment_well` | Multi-segment wells | `src/facility/wells/mswells_equations.jl` (`SegmentWellBoreFrictionHB`) | Column of rock, producer open only at the bottom, injector for pressure support; one-node well against segmented well, 0.3 m and 0.04 m tubing | The one-node well; Darcy-Weisbach pressure drop with the Colebrook-White factor | exact |
| `engine_consistent_schemes` | Averaged multipoint and nonlinear two-point fluxes | `src/flux_nfvm.jl` (`kgrad = :avgmpfa`, `:ntpfa`) | SPE1, first 20 report steps | The two-point scheme, which is exact on this grid | cross |
| `engine_coarsening` | Coarsening | `src/coarsening/coarsening.jl` (`coarsen_reservoir_case`) | 50-cell depletion deck coarsened to 5 cells | Pore volume; oil produced at full depletion (material balance) | exact |
| `engine_nldd` | Nonlinear domain decomposition | `src/NLDD/` (`method = :nldd`) | SPE1, first 30 report steps | Newton's method on the same case | cross |
| `engine_adjoint_gradients` | Adjoint gradients | Jutul `solve_adjoint_sensitivities` | Two-phase displacement, 12 cells, 12 steps | Central differences from re-running the model | exact |
| `engine_cpr_solver` | CPR preconditioner | `src/cpr.jl` (`precond = :cpr`) | SPE9, first 8 report steps | Incomplete LU (`precond = :ilu0`) at the same linear tolerance | cross |
| `engine_co2_properties` | CO2 and brine properties | `src/CO2Properties/` (`compute_co2_brine_props`) | Two property evaluations | Gas law with the second virial coefficient at 1 bar and 300 K; compressed water at 250 bar and 30 C | cross |

## Findings

1. **End-point scaling is honoured in a deck, exactly.** The run with the keywords and the run with the table scaled by
   hand agree to 2e-10. One wrinkle: where a cell's connate and critical water saturations are equal (true of most
   tables, and of the default when the keywords are absent), `get_kr_scalers` lowers the connate value by 1e-4. That
   moves the top of the oil curve by the same amount, so switching `ENDSCALE` on with the table's own end points changes
   the oil relative permeability by up to 3.5e-4 and this flood's oil by 7e-5. The test confirms the cause by matching
   that run to a hand-scaled table with the same 1e-4 shift (1e-10).
2. **Nonlinear domain decomposition misses its bar.** It runs, and takes 33 global Newton steps where Newton takes 139
   to 204. But over the first four report steps of SPE1 its producer pressure is up to 1.3% from a tightly converged
   Newton run, and setting tight tolerances does not change that. The default Newton run is within 0.2% of the tight
   one. The engine's own test asks for 1% in the norm of the whole series, which is a weaker demand and is met.
3. **Tracer in the wellbore.** A balance over the reservoir alone comes out 4e-5 short: that is the traced water
   standing in the injector's wellbore. Counted, the balance closes to 1e-6.
4. **CPR at equal tolerance.** The two preconditioners have different default linear tolerances (5e-3 for CPR, 1e-2 for
   incomplete LU). At their own defaults CPR needed 148 linear iterations against 282; at the same tolerance, 148
   against 332.
5. **The engine's default Killough hysteresis is not the published rule.** Its `tol = 0.1` changes the trapping formula
   for numerical stability (0.1684 against 0.1671 at the test point). The tests set `tol = 0`.

## Not run, and why

- **Geothermal** (`src/Geothermal/`): closed-loop and borehole heat-exchanger wells. Needs a well-loop model and
  property tables; no exact answer short of a published case. Not attempted.
- **Flow in a discrete fracture network** (`src/DFM/`): needs cut meshes and an embedded fracture mesh (the engine's own
  test is 670 lines of set-up). Not attempted; a natural next test is one fracture across a block against the
  series-parallel conductance.
- **INTERSECT-format input** (`src/AFISetup/`): no input file in that format is shipped with the engine or its test data.
- **Thermal flow with moving water**: only conduction was tested. Hot or cold water injection, wells with temperature,
  and heat loss to the surroundings were not.
- **Three-point end-point scaling, maximum-value keywords, capillary-pressure scaling**: not run.
- **Multi-segment wells from a deck** (`WELSEGS`, `COMPSEGS`, `WSEGVALV`), valves, branches, two-phase flow in segments: not run.
- **Consistent schemes on a skewed grid or with tilted permeability**: not shown. On SPE1 all schemes must agree, and do.
- **The engine's own history-matching and rate-optimisation workflows**: only the adjoint gradient they rest on was tested.
- **Plots, GPU solver, MPI**: need packages that are not installed (GLMakie, CUDA, MPI).

## Reference values that were recalled, not fetched

- Second virial coefficient of CO2 at 300 K: about -121 cm3/mol.
- Water at 30 C and one atmosphere: 995.65 kg/m3; isothermal compressibility about 4.35e-10 per Pa up to 250 bar.
- Colebrook-White and Darcy-Weisbach, Carlson (1981), Killough (1976) and Land (1968): the standard forms.

## Honesty notes

- Bars were written before the first run of each test. Six tests were changed after a first result; each change is
  told in a comment at the test. In every case the bar stayed as written and either the model or the measurement was
  corrected (wellbore tracer, equal linear tolerance, pressure support for the well test, oil read from oil in place),
  or the check was restated around a real property of the engine (the 1e-4 end-point shift).
- The two CO2 property values were printed during a first look at the function before their bars were written.
- Names of states and parameters were explored in a scratch script on other cases (`scratchpad/stream7/explore.jl`).
