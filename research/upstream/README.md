# Engine defects found here, ready to report upstream

Two defects in the engine's own packages, each reproduced with the engine alone (no code of this project) on the
installed versions. On the packages' `main` branches on 2026-11-10: the GeoEnergyIO lines are unchanged (the defect is
visible in the code itself); the JutulDarcy integration line is unchanged, but `main` was not run, so that one is shown
on 0.3.11 only. No existing report was found in either tracker. NOT yet filed.

| Report | Package | What | Reproduction |
|---|---|---|---|
| `geoenergyio_tops_nonuniform_cells.md` | GeoEnergyIO.jl 1.1.34 | with cells of unequal width, each cell's top is applied `(dx[i] - dx[1]) / 2` away from the cell | `repro_tops.jl` |
| `jutuldarcy_summary_totals_field_units.md` | JutulDarcy.jl 0.3.11 | `summary_result(..., :field)` totals are 86,400 times too large (per-day rates times seconds) | `repro_totals.jl` |

To file them (posts publicly from the signed-in GitHub account):

```
gh issue create --repo sintefmath/GeoEnergyIO.jl --title "TOPS applied at wrong positions for non-uniform DXV/DYV (cell_centers_from_deltas)" --body-file research/upstream/geoenergyio_tops_nonuniform_cells.md
gh issue create --repo sintefmath/JutulDarcy.jl --title "summary_result: cumulative totals (WOPT, FOPT, ...) are 86400 times too large in field units" --body-file research/upstream/jutuldarcy_summary_totals_field_units.md
```

Not reported, because the engine documents it as intended: `KilloughHysteresis(tol = 0.1)` changes the trapping
formula (the docstring calls `tol` a parameter for numerical stability). The tests here set `tol = 0`. Also noted
and not a defect: the engine lowers connate water by 1e-4 where it equals the critical saturation.

How this project lives with them: the depth error is bounded in the test `fracwell_depth` (a fraction of a foot on
a dipping, graded model; the deck written is the standard one); the totals are not used (`eclout.jl` integrates rates
with the solver's own step lengths).
