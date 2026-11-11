### What happens

`summary_result(case, res, :field)` returns cumulative totals (`WOPT`, `WGPT`, `FOPT`, ...) that are 86,400 times too large. The rates (`WOPR`, ...) are right.

### Reproduction

```julia
using JutulDarcy, Jutul, GeoEnergyIO
path = GeoEnergyIO.test_input_file_path("SPE1", "SPE1.DATA")
case = setup_case_from_data_file(path)
res = simulate_reservoir(case, info_level = -1)
s = JutulDarcy.summary_result(case, res, :field)
w = s["VALUES"]["WELLS"]["PROD"]
t = s["TIME"].seconds
dt_days = diff([0; t]) ./ 86400
wopr = w["WOPR"]; wopt = w["WOPT"]
by_hand = cumsum(wopr .* dt_days)
println("final WOPR (stb/day):          ", wopr[end])
println("final WOPT from summary:       ", wopt[end])
println("cumsum(WOPR * dt in days):     ", by_hand[end])
println("ratio:                         ", wopt[end] / by_hand[end])
```

Output:

```
final WOPR (stb/day):          5758.768450484855
final WOPT from summary:       4.453078871720752e12
cumsum(WOPR * dt in days):     5.1540264718990184e7
ratio:                         86400.0
```

### Cause

In `expand_summary!` (`src/io.jl`) the totals are built from the rates after they have been converted to the output unit system:

```julia
dt = diff([0; summary["TIME"].seconds])
...
d[k][dest_key] = cumsum(d[k][src_key].*dt.*factor)
```

With `:field` the rates are per day while `dt` is in seconds, so every total carries a factor of 86,400. I have only checked `:field`; any unit system whose rate is not per second would be affected in the same way. Integrating before the unit conversion, or using the time step in the unit system's own time unit, would fix it.

### Versions

JutulDarcy 0.3.11, Julia 1.11.9, Windows. The same lines are in `src/io.jl` on `main` today.

*(This report was prepared with the help of an AI coding assistant; the reproduction above was run locally.)*
