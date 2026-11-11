# Ressim

An end-to-end simulator for unconventional wells, from the frac job to the sales line, built on the
JutulDarcy reservoir engine:

    pumping design + rock  ->  fracture growth  ->  proppant  ->  reservoir flow  ->  tubing  ->  shared facility

Every link exists in a simple form and is tested; the plan is to deepen each one, not to add links.
It also runs standard ECLIPSE-format decks. A validation suite says what has actually been checked
on this machine.

`SCORECARD.md` is the status of record. It is generated; do not edit it by hand.

## Use

```powershell
.\ressim.ps1 design <design.toml> [outdir]   # rock, pumping, clusters, proppant -> fractures -> production
.\ressim.ps1 fracwell <spec.toml> [outdir]   # multi-stage fractured well with fracture geometry you give
.\ressim.ps1 run <deck.DATA> [outdir]        # simulate an ECLIPSE-format deck; writes summary_field.csv and run.toml
.\ressim.ps1 validate quick                  # the fast tests (a few seconds each); does not touch SCORECARD.md
.\ressim.ps1 validate full                   # everything, about 15 minutes; rebuilds SCORECARD.md
.\ressim.ps1 scorecard                       # rebuild SCORECARD.md from the last validation run
```

Examples: `examples\design_with_clusters.toml` (clusters and limited entry),
`examples\design_with_proppant.toml`, `examples\design_to_production.toml`, `examples\five_stage_well.toml`.
Julia start-up and compilation add roughly a minute to every command.

## Layout, in the order of the chain

Fracture growth (written here; the engine has none):
- `src/fracgrow.jl` one contained, constant-height fracture: flow in the fracture, elastic opening, leak-off.
- `src/heightgrow.jl` length and height, breaking into symmetric stress barriers (pseudo-3-D). Reduces exactly
  to the contained model when the barriers hold. Not planar 3-D.
- `src/layers.jl` the fracture's cross-section in layered rock: any number of layers with their own stress and
  toughness, fluid weight optional. Used when the barriers above and below differ (`barrier_above_psi`,
  `barrier_below_psi` in a design file's `[rock]`).
- `src/multifrac.jl` all the clusters of a stage grown together: one wellbore pressure, perforation friction
  per cluster, and each fracture squeezed by its neighbours (stress shadow). The split of the stage rate is
  solved. The shadow is local and plane strain. The stage before is included through what its fractures
  still hold open when the next one is pumped.
- `src/proppant.jl` proppant carried with the slurry, settling into a bank at the bottom of the fracture, then
  closed into a conductivity along the fracture (only the bank inside the pay counts). No screen-out pressure.
- `src/chain.jl` `design_well`: grows every stage and builds the well to simulate. With layers in the well model,
  the height each fracture reaches above and below the pay (or, with a proppant design, where the pack ended)
  decides which layers it drains. `design_child_well`: a parent produces, a child is fractured into the rock it
  left, and both produce in one model. `child_factors` turns that into the two numbers a pad plan needs (what the
  child loses to the parent, and the parent to the child); `job_minutes_for_length` sizes a job to a target length.
- Screen-out (`proppant_feedback` in `src/multifrac.jl`, `flow_feedback` in a `ProppantDesign`): the flow feels the sand.
  Slurry thickens, a packed cell passes fluid only as a porous pack, a tip that packs off stops and the pressure
  behind it rises; a pressure limit can stop the job. Off by default.
- A pump schedule in steps, and a job that can be stopped and continued (`start_stage`, `pump_step`, `finish_stage`,
  `save_stage`, `load_stage` in `src/multifrac.jl`): each step has its own minutes, rate, viscosity and sand; the grid is
  fixed by a plan at the start, so a job continued step by step equals the same schedule run in one call, exactly.
- `src/closure.jl` where the sand is when the fracture closes: suspended sand falls only until closure (set by the
  fracture's fluid efficiency), the rest stays where it is. Optional (`settle_until_closure` in a `ProppantDesign`).
- `src/parentchild.jl` a child stage beside a depleted parent: both wings of each fracture are solved, lower stress
  and pore pressure on the parent's side pull the fracture that way, and reaching the parent's fracture is flagged.

Geology:
- `src/geology.jl` rock properties that vary across the map: seeded random fields with a stated variogram,
  sampled at any (x, y), and `well_maps` to hand them to a well model. One source of truth for wells, logs and maps.
- `src/structure.jl` the top of the pay across the field with fault traces and throws; `lateral_structure`
  reads top, base and fault crossings along any lateral; `well_faults` turns traces into flow barriers in a well model.

Reservoir:
- `src/Ressim.jl` deck runner, field-unit summary, comparison measures; `src/exact.jl` closed-form solutions.
- `validation/enginefeat.jl` small models that put engine features behind tests for the first time (tracers, heat
  conduction, hysteresis, end-point scaling, segmented wells, coarsening, the CPR solver, adjoint gradients).
- `src/eclout.jl` results as the binary summary pair other tools read (SMSPEC / UNSMRY), and a reader for such files.
  The values are checked against the engine; the file layout has not yet been opened by another program.
- `src/fracwell.jl` multi-stage fractured well as a standard ECLIPSE-format deck (portable to other
  simulators). Stages can sit on different laterals in the same rock, so wells interfere. Fracture
  conductivity can fall with drawdown and stay down (`conductivity_loss_per_psi`). Net pay, porosity, water
  saturation and permeability can vary cell by cell (`*_map` fields). Stages can start in different months
  (`start_month`), so a child well drills into rock its parent has depleted; `pressure_field` reads the grid. The default fluid
  is the SPE1 benchmark's live oil, for illustration only; `fluid = "drygas"` gives a dry-gas well on the same gas table. The rock can be a stack of layers (`layers`), the model can
  dip, the lateral can land in any layer (`landing_ft`), and each fracture drains only the layers its height covers
  (`fracture_above_ft`, `fracture_below_ft`). With none of these set the model is one flat layer, as before.
  A lateral can cross its fracture off the middle (`lateral_ft`), with a conductivity profile for each wing.
  Frac water left beside a fracture can flow back (`frac_water_bbl`; `water_from_rock` separates what the rock gives
  back from what stood in the engine's wellbore).
- `src/match.jl` history matching: fit chosen inputs of a well model to a production history, report which
  combinations of them the data fix and which they leave open, and forecast from the whole family of equally good fits.
- `src/economics.jl` money from any forecast: cash flow from prices, interests, taxes and costs; NPV, rate of return,
  payout, economic limit, break-even price, a sensitivity table, and the spread of NPV over an uncertainty run.
  Before income tax; every convention is an argument with a stated default.
- `src/ensemble.jl` decline curves (Arps: rate, cumulative, fit to monthly volumes, EUR) and uncertainty runs: the
  same well in many draws of the rock, with P90 / P50 / P10 of its oil.

- `src/welltest.jl` flow then shut-in on a fractured well, with the pressure-derivative diagnostic an analyst plots.
- `src/dfit.jl` a synthetic diagnostic fracture injection test from the fracture model, and the standard analysis
  (G-function, closure, efficiency, leak-off, pore pressure, permeability) to read it with. After closure the
  record is a stiffer fracture that still holds fluid and bleeds it into the rock; closure itself is sharp.

Wellbore and surface:
- `src/surface.jl` separator pressure, a tubing curve and a facility oil-rate limit for one well, solved
  inside every timestep.
- `src/lift.jl` gas and liquid in the tubing, without slip or with drift flux (SPE1 fluid).
- `src/vfp.jl` lift tables: tabulate a tubing model, read and write the standard VFPPROD table, and produce a well
  through a table (for tubing curves that come from another tool).
- `src/nodal.jl` inflow curve from the reservoir model, its meeting point with the tubing curve, lift-gas response
  and the split of a limited amount of lift gas between wells.
- `src/pvtlab.jl` the classic laboratory tests (expansion, liberation, separator) read off the built-in fluid tables.
- `src/field.jl` several wells on one separator and facility limit, marched through time together, with
  three allocation rules (common choke, pro rata, priority). A reservoir model may hold several wells
  (`well_of_stage`), so wells can interfere through the rock and share the facility; each well has its own
  start month, and a later well starts in the rock as the earlier ones left it.

Evidence:
- `validation/suite.jl` tests and their pass bars, and a header listing everything changed after a result
  was seen; `validation/models.jl` small models for the exact tests.
- `validation/scorecard.jl` builds `SCORECARD.md` from the test results, `features.toml` and a search of the
  engine source. `features.toml` is the feature list; status is derived from evidence, never typed in.
- `research/` sourced notes: vendors and open codes, proppant models, published benchmarks.
- `game/` belongs to other sessions (a game built on this simulator). It must not edit `src/`, `validation/`, `bin/`.

## Rules

- Pass bars live in `validation/suite.jl`, are written before the first run and are not tuned to results.
  A miss is reported as a miss; anything changed after seeing a result is listed in the suite header.
- Three kinds of evidence, never mixed: exact (closed form), cross (another simulator's published numbers),
  self (symmetry and mesh sensitivity). A feature backed only by self checks is listed as such.
- "Verified here" means a test passed on this machine. An engine capability that has not been run here is
  listed as such.
- Give fluid tables a pressure range wider than the run will reach: below the lowest tabulated pressure the
  engine holds gas properties constant (found on SPE3).
- This package only reads the Julia environment in `../stage-sim/.venv/julia_env`. Do not add packages there;
  the stage-sim research runs depend on it reproducing byte for byte.
