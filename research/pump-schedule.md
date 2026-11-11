# A pump schedule in steps, and a job that can be stopped and continued

Written 2026-11-10 for `stage_start`, `stage_run`, `stage_pump`, `stage_result` (SI) and `start_stage`,
`pump_step`, `finish_stage`, `save_stage`, `load_stage` (field units) in `src/multifrac.jl`.

## Why it could not be done before

A one-call job (`stage_grow`, `grow_stage_clusters`) sizes everything from the whole job: the grid's length
from rate, viscosity and total time; the cross-section table from the same; and the time steps as
`t = T (k / n)^2`, so every step length depends on the total time `T`. Re-running the first half of a job
therefore did not reproduce the first half of the full run, and there was one rate and one fluid per job.

## The choices

1. **A plan fixes what must not change.** `q_plan`, `mu` and `t_plan` (or a grid length given outright) fix,
   when the job starts: the grid, the cross-section table and the law of the time steps. The rules are the
   one-call job's own, applied to the plan. What is pumped later changes none of them.
2. **Time steps are the plan's, cut at schedule boundaries.** The plan's step times are `t_plan (k / n)^2`,
   and beyond the planned time they go on at the plan's last step length. A schedule step ends exactly where
   it says; if that is not a plan time, one time step is shortened to end there. A boundary within a
   billionth of the planned time of a plan step ends on it. So the time steps depend on the plan and the
   schedule, never on how the schedule is split between calls.
3. **The job is plain data, and pumping returns a new job.** See "What a job holds". Because nothing in it is
   a function and nothing is changed in place, a job can be kept, copied, written to a file, read back, and
   continued in two different ways from the same point.
4. **Continued equals uninterrupted, to the last bit.** Each call does, for each time step, the same
   floating-point operations in the same order whether the step is the first of a call or not: every call
   rebuilds the fixed parts from `init` by the same code and copies in the carried state, and no work array's
   left-over content is read before it is written. So the difference is exactly zero, not "small".
5. **Viscosity is one number for the whole fracture at a time.** The table is built for the plan's viscosity;
   a step with another viscosity multiplies every flow by plan viscosity / step viscosity. The fluid already
   in the fracture is not followed separately: there is no fluid front. The settling speed follows the
   step's viscosity (`v_free` per step; the field-unit front end works it out).
6. **A job that outgrows what was fixed ends, and says so.** A one-call job that outruns its grid or its table
   is run again with a larger one. A continued job cannot be: the earlier part would change. If a fracture
   reaches the end of the grid, or the net pressure leaves the table or reaches what the barriers hold, the
   job ends at the start of that time step (`state.dead`, `state.reason`). It can still be read
   (`stage_result`, `finish_stage`), not continued. To make this rare the table of a stepped job reaches four
   times the usual pressure range by default (`table_reach`), with four times the entries.
7. **A pressure limit ends the call, not the job.** If the limit given at the start is passed while pumping,
   the call returns at the end of that time step with `limit_hit`; the rest of that schedule step is not
   pumped. The job can be continued (a flush, a lower rate, the shut-in).
8. **The file format is Julia's Serialization** (a standard library; no package was added). It is exact to
   the last bit. It is tied to the Julia version and to this module's types, so it is for keeping a job
   between calls of one installation, not for exchange. The job is plain data so that another format could
   replace it without touching the solver.

## What a job holds

- `init`: every keyword the solver is started with: cluster positions, rock (`pay`, `dsigma`, `KIc` or
  `layers`), `Eprime`, leak-off, perforation coefficients, the plan (`q_stage`, `q_ref`, `t_end`, `mu`), the
  grid (`ncell`, `xmax`), the table (`ntable`, `table_extra`, `table_reach`), the proppant's properties,
  `two_wings`, `proppant_feedback`, `slurry_exponent`, `pressure_limit`, `background`.
- `fields`: worked out once at the start. Per cell: stress from an earlier stage plus any stress change along
  the wing (`S_ext`), the stress change alone (`Soff`), the leak-off factor (`LF`), the stress contrast over
  the table's (`ctr`); the functions that produced them are not kept. And the cross-section table `T`
  (numbers only): building it takes 1.5 s for a stepped job's 960 entries, against hundredths of a second
  for a dozen time steps, so a continued call must not build it again.
- `state`: net pressure per cell `p` (zero = held or dry; the wet and held flags follow from it and the
  residual); first-wetting times `tau` (the leak-off history); closing times `tclose`; pressures at the last
  pumping step `p_shut`; rates `q` and wellbore pressure `pwb` (also the next solve's starting guess);
  cumulative `leaked`, `injected`, stage volume `V_stage`; the proppant arrays: suspended `Vp`, laden-slurry
  area `Hs`, bank `Vb`, pumped `Vp_in`, rejected `Vp_rej`, `first_pack`, `plug_t`, `plug_x`; cross-section
  heights at the end of the last step `hprev` (what the feedback reads); time `t`, the last pumping time, the
  index of the next plan time step `kgrid`, the Newton count; `dead` and `reason`; `limit_at`; and `hist`,
  the history so far (times, lengths, inlet pressures, heights, rates, wellbore pressure).
- `grid`: for the reader: `xmax`, `dx`, `cells`, the table's top and cap, the plan's time and steps.
- `field` (field-unit front end only): pay and barriers in field units and the proppant's properties, for
  the summaries and the unit conversions.

## Not modelled

A fluid front (see 5), wellbore volume between surface and perforations (a change of fluid or sand acts at
the perforations at once), a rate ramp inside a step (a step has one rate), proppant of more than one size
in a job, changing the pressure limit after the start.
