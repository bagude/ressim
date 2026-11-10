# Frac Challenge API

Start: `python game/server.py [--port 8765] [--static DIR] [--no-sim] [--open]` (from `ressim/`).
Serves `game/web/` at `/` and JSON under `/api/`. CORS is open. Field units; money in US dollars.
`--no-sim` serves levels and scores without starting Julia (run returns 503).

This is a game: illustrative economics, the SPE1 benchmark oil (not a real play), and a 2D one-layer model with
fracture geometry as an input. Say so in the UI.

## GET /api/status
`{"sim": "warming" | "ready" | "error" | "off"}`. Warm-up takes about 10-60 s after start.

## GET /api/levels
Array, in play order:
```
{ id, title, brief, lesson,
  lateral_ft, lease_width_ft, perm_md, months, thickness_ft, porosity, top_depth_ft, initial_pressure_psi,
  budget_usd: number|null,              // capex cap; designs over it are rejected before simulating
  facility_cap_stb_d: number|null,      // total oil rate limit, split evenly between stages
  controls: { stages:[min,max], half_length_ft:[min,max], conductivity_mdft:[min,max], bhp_psi:[min,max],
              per_stage: bool },        // min == max means fixed: hide the control
  prices: { oil_usd_stb, gas_usd_mscf, water_disposal_usd_stb },
  costs:  { well_base_usd, lateral_usd_ft, stage_usd, half_length_usd, conductivity_usd_mdft,
            lift_usd_per_kpsi, lift_free_bhp_psi, opex_usd_month, discount_rate },
  stars: [npv_1star, npv_2star, npv_3star] }
```
Stages are evenly spaced along the lateral: stage i (0-based) sits at `(i + 0.5) * lateral_ft / stages`.
Fractures run across the lateral, perpendicular to it; the lease extends `lease_width_ft / 2` either side of the well.

Capex, so the UI can show cost live before a run (same formula the server uses):
```
well_base_usd + lateral_usd_ft * lateral_ft
+ stage_usd * stages
+ sum over stages of half_length_usd * (half_length_ft / 100)^2
+ sum over stages of conductivity_usd_mdft * conductivity_mdft
+ lift_usd_per_kpsi * max(0, lift_free_bhp_psi - bhp_psi) / 1000
```

## POST /api/run
Request:
```
{ "level": "first-light", "player": "name (max 32 chars)",
  "design": { "stages": 6, "half_length_ft": 250 | [..one per stage..], "conductivity_mdft": 50 | [...], "bhp_psi": 1500 } }
```
Optional `"record": false` skips the leaderboard (for QA runs); `best` is then null.
Lists are accepted only when `controls.per_stage` is true. Fixed controls may be omitted. Out-of-range values are
errors, never clamped. A run takes 4-15 s; runs are serialised; an identical design returns instantly (`cached: true`).

Error (HTTP 400): `{ ok: false, errors: [string], cost?, over_budget? }`

Success (HTTP 200):
```
{ ok: true, errors: [], level, design (normalised: per-stage lists),
  cost:    { well_usd, stages_usd, fracture_size_usd, proppant_usd, lift_usd, total_usd },
  revenue: { oil_usd, gas_usd, water_usd (negative: disposal), opex_usd (negative), net_usd },   // undiscounted
  npv_usd, stars (0-3), star_thresholds_usd: [3], over_budget: false,
  totals:  { oil_stb, gas_mscf, water_stb },
  stages:  [ { stage, position_ft, half_length_ft, half_length_effective_ft, conductivity_mdft, oil_stb, gas_mscf, water_stb } ],
  monthly: { month: [1..months], oil_stb, gas_mscf, water_stb, cum_oil_stb, cash_usd, cum_disc_cash_usd },  // cum_disc starts at -capex
  sim_seconds, cached,
  run_id (16 hex chars; same design -> same id), has_field: bool,
  best: { player, npv_usd, stars, when, design, new_best: bool } }
```
`half_length_effective_ft` < `half_length_ft` means the fracture hit the lease line (you still paid for it).

## GET /api/field?run=<run_id>
Per-cell field for a run (404 if the run has none):
`{nx, ny, x_edges_ft[nx+1] (0 = heel-side model edge), y_edges_ft[ny+1] (0 = well centreline), frac_mask[ny*nx] (0 = rock,
k = stage), months[] (0 = initial), pressure_psi[months][ny*nx] (0.1 psi), sg[months][ny*nx] (0.001), initial_pressure_psi, bhp_psi}`.
Row-major with x fastest (index = j*nx + i).

## GET /api/scores?level=<id>
Top 10, best NPV per player: `[ { player, npv_usd, stars, when, design } ]`.

Stable: `controls`, `stages`, `monthly`, `stars` and every field above. Fields may be added, never renamed without a message.

---

# Career mode (slice 1)

You run an operator's asset team for 5 years, one month at a time. The server holds hidden truth: the rock, each
well's real production (ressim runs) and the actual costs. It sends only what the player has seen. Your plans run on
**belief**: your type curve and AFE estimates. Actuals run the same schedule engine on **truth**. Responses larger
than 2 KB are gzip-compressed when the request accepts it. Errors come back as HTTP 400/409/503:
`{ok: false, errors: [string]}`. Every money value is in USD and volumes are in bbl or Mcf; `units` says so where it appears.

Field: a 6 x 3 block of 1-mile sections (`section_ft` 5280), named A1..A6 (row 0), B1..B6 (row 1), C1..C6 (row 2).
Four are already developed with inherited producing wells; the rest is open acreage. Rock varies smoothly across the
field (hidden), so analogs near a section predict it best. One pad per open section, holding 2-10
wells across the section (`well_spacing_ft` = 5280 / wells). Laterals are `lateral_ft` 4620 (the 5,280 ft section less 330 ft setbacks at each end) and run along the section. Inherited wells have 4,620, 7,260 or 9,900 ft laterals (1, 1.5 or 2 sections). Careers created before this change keep their old analog laterals.

## POST /api/career/new  `{name}`
Returns `{ok, career}` (the view below) with `status: "generating"`. The field's analog wells simulate for about
30-60 s; poll GET /api/career until `status` is `"active"` (`progress` 0..1). Every other career call returns 409 until then.

## GET /api/careers
`[{id, name, month, status, confidence}]`

## GET /api/career?id=<id>  -> `{ok, career}`
```
career: { id, name, created, status: generating|active|sacked|finished|error, progress, month (0 = start),
  year (1-based), career_months: 60, budget_needed: bool,   // true at the start of a year until the board approves a budget
  sections: [{section, col, row, developed}], section_ft, lateral_ft,
  reservoir: {top_ft: 9000, thickness_ft: 100 (nominal; true thickness is hidden and varies by section), tvd_ft: 9050, note},
  cash_usd, credit_line_usd, capital_limit_usd,
  history: {month[], oil[], gas[], water[], op_cash_usd[], capex_usd[], cash_usd[], oil_forecast[] (board-guidance forecast for that month, or null)},
  typecurves: { name: {analogs[], fits: {p10|p50|p90: {qi, di, b, dmin, rmse_log}}, gor_mcf_bbl, per_ft, created_month, eur_oil_per_1000ft: {p10,p50,p90}} },
  plan: <last board-approved plan or null>,
  pads_started: [{pad, section, wells, well_spacing_ft, rig, drill_start_month, online_month, afe_usd, actual_usd}],
  wells: [{id, pad, section, lateral_ft, stages, design, wells_per_section, online_month}],
  board: {confidence (0-100; below 20 = sacked), approved: {"<year_index>": usd}, guidance: {"<year_index>": oil_bbl},
          forecast: {"<year_index>": [12 monthly oil]}, reviews: [{year, oil_bbl, guidance_bbl, capex_usd, approved_usd,
          production_ratio, capex_ratio, confidence_change, parts: {...}, confidence}]},
  inbox: [{month, kind: board|operations|finance|report, title, body, data?}],
         // data on operations and finance items: {pad, wells?: [ids], well?, rig?, online_month?, afe_usd?, actual_usd?,
         //   earliest_start_month?, session? (well at TD), sessions?: {well: session} (manual steering), in_zone_pct?};
         // year reviews carry the review object
  score: null | {realised_pv10_usd, remaining_pv10_usd, value_usd, confidence},   // when finished
  sack_below: 20,
  projection: null | {year, months_done, oil_ytd_bbl, oil_forecast_ytd_bbl, oil_pace_bbl, guidance_bbl, production_ratio,
               capex_projected_usd, capex_committed_usd, approved_usd, capex_ratio, confidence_change, parts,
               confidence_after, sack_below, note},
        // the year-end review's own formula on today's pace (null at month 0 of a year). oil_pace = full-year guidance
        // x (ytd oil / ytd board forecast). capex = spent + committed by locked pads and task outcomes (unstarted pads excluded)
  limits: {design: {stage_spacing_ft:[150,400], half_length_ft:[100,450], conductivity_mdft:[5,200], bhp_psi:[1000,3000]},
           wells_per_section:[2,10], rigs:[1,3], crews:[1,2]},
  units }
```
Arps: `qi` is the volume per month at the aligned peak; `di` and `dmin` are nominal annual decline rates (1/yr); `b` is
the hyperbolic exponent. The curve switches to exponential `dmin` when the hyperbolic decline falls to it.

## GET /api/career/analogs?id=<id>
`{ok, month, units, analogs: [{id, section, owner: inherited|you, lateral_ft, wells_per_section, well_spacing_ft,
design: {stage_spacing_ft, half_length_ft, conductivity_mdft, bhp_psi}, online_month (negative = before you arrived),
history_months, oil[], gas[], water[]}]}`. Monthly history in bbl and Mcf, month 0 = first production. It includes
downtime and noise. The player's own wells join the list once they have a month of history.

## GET /api/career/field?id=<id>&well=<well id>
Pressure field behind a producing well (inherited or yours), in the same shape as `/api/field`. It is cut to the months
the player has seen: months are counted from the well's first production, and `months[]` is thinned to monthly up to
month 12, then every 6 months. Extra fields: `well, unit: "one repeating stage", stages, lateral_ft, stage_spacing_ft,
well_spacing_ft, note`. The grid is **one stage's share**: x spans one stage spacing with the fracture in the middle, and
y spans -well_spacing/2..+well_spacing/2 (no-flow halfway to the neighbouring wells). Tile it `stages` times along the
lateral and once per well across the pad. Every well on a pad shares one field. Inherited wells that share section,
design and spacing share one too. Works without the simulator (`--no-sim`). Returns 400 for an unknown well or one
not yet online.

## POST /api/career/typecurve  `{id, analogs: [ids], normalise?: true, dmin?: 0.08, save?: "name", overrides?: {p50: {qi?, di?, b?, dmin?}, ...}}`
```
{ ok, per_ft: 1000|null, gor_mcf_bbl, eur_oil: {p10,p50,p90}, months_with_enough_wells,
  wells: [{id, aligned_oil[] (normalised, peak-aligned), fit: {qi,di,b,dmin,rmse_log}}],
  percentile_series: {p10[], p50[], p90[]},      // only months with at least 3 wells
  fits: {p10,p50,p90: {qi,di,b,dmin,rmse_log}},
  fit_curves: {p10[240], p50[240], p90[240]},    // the fitted Arps curves, monthly
  saved?: <typecurve object as in career.typecurves> }
```
Without `save` it is a preview: call it freely while the player picks analogs or drags parameters. With `overrides`
the response adds `adjusted: {fits, eur_oil, fit_curves}` for the hand-adjusted parameters, saved or not (qi > 0,
other values >= 0, b <= 2.5). `fits`, `eur_oil` and `fit_curves` stay the automatic fit. With `save`, the overrides are stored. P10 is the high case (industry convention).

## POST /api/career/plan  `{id, plan}`  (on belief; fast, no simulation)
```
plan: { design: {stage_spacing_ft, half_length_ft, conductivity_mdft, bhp_psi},   // field-wide completion
        typecurve: "<saved name>", percentile: p10|p50|p90,
        pads: [{section, wells, typecurve?, percentile?}],   // drilling order; open sections only; started pads kept
                                           // automatically; a pad may use its own type curve (default: the plan's)
        rigs: 1-3, crews: 1-2,
        budget_request: {"<year_index>": usd} }   // year_index 0 = year 1
```
Response:
```
{ ok, plan (normalised), units,
  warnings: [string],          // e.g. design or well spacing outside the type curve's analogs
  board_check: null | {year, floor_applies, base_oil_bbl, guidance_floor_bbl, board_limit_usd,
                       max_guidance_bbl (this plan funded at the board limit), floor_reachable,
                       rejection_costs_confidence,
                       conditions: [{key: limit|economics|floor, passes: true|false|null (null = not applicable or
                                     no request yet), value, threshold, label, npv10_usd? (economics)}]},
                       // present while a budget meeting is due. `conditions` is the board's own verdict, computed by
                       // the same function the meeting uses: show it as is, don't re-implement the rules
  unscheduled: [pad ids],      // pads that fit no budget year
  afe_estimate_per_well: {stages, drill_days, frac_days, drilling:{rig_spread_usd, tangibles_usd, mobilisation_usd},
                          completion:{stages_usd, fracture_size_usd, proppant_usd}, facilities:{tie_in_usd, lift_usd},
                          drilling_usd, completion_usd, facilities_usd, total_usd},
  type_curve: {name, percentile, params, eur_oil_per_well_bbl, gor_mcf_bbl},
  gantt: <the agreed Gantt shape; bar status "delayed" for budget waits>,
  delays: [{pad, from_day, to_day, reason}], unbudgeted_years: [year numbers with no approved or requested budget],
  pads: [{pad, section, wells, well_spacing_ft, typecurve, percentile, started, drill_start_month, online_month, capex_usd, npv10_usd, pvi, irr}],
  forecast: {month[] (absolute, now .. now+119), oil_pdp[], oil_dev[], gas[], capex_usd[],
             capex_by_category_usd: {pad[], drilling[], completion[], facilities[]}, dev_op_cash_usd[], dev_cum_cash_usd[]},
  budget_by_year: [{year, year_index, planned_capex_usd, requested_usd, approved_usd, committed_usd, oil_forecast_bbl,
                    op_cash_forecast_usd, board_limit_usd (current year only, else null)}],
  measures: {npv10_usd, irr (annual fraction or null), payout_month (from now), peak_exposure_usd (negative),
             pv10_capex_usd, pvi (NPV10 / PV10 capex), capex_usd, fd_usd_boe} }   // development wells only
```
Schedule rules (state them in the UI):
- One rig per pad. Wells are batch drilled with a learning curve per rig, and a rig moves between pads.
- A frac crew starts a pad only after all its wells are drilled.
- Wells come online together after a 14-day tie-in.
- A pad waits for the next budget year if its cost would break the approved (or requested) budget.

## POST /api/career/budget  `{id, plan}`
The annual board meeting for the current year, required whenever `budget_needed` is true. The board approves if all of these hold:
- `budget_request[current year]` is no more than `board_limit_usd`: this year's forecast operating cash flow plus half
  the cash on hand, and never more than `capital_limit_usd` (cash + credit line - $5 MM reserve);
- the development plan clears NPV10 > 0 and PV10/I >= 0.2 **on your own forecast**;
- oil guidance is at least the **producing base plus 5 %**. The base is this year's oil from wells already producing
  or started, with no new pads. The board wants new wells, not managed decline. The floor is waived once every open
  section has been started.

Only the first rejection in a budget year costs confidence (3). Later attempts in the same year are free. Approval fixes that year's budget and oil guidance and makes this the active plan.
A rejection costs 3 confidence. Returns `{ok, decision: {approved, reasons[], conditions[], approved_usd?, guidance_oil_bbl?, confidence}, career}`. `reasons` are the labels of the failed conditions.

## POST /api/career/advance  `{id, months: 1-12}` or `{id, until_event: true, max_months?: 1-12 (default 12)}`
Runs the months on truth. It stops with an error at a year start that has no approved budget. A pad locks
(it can no longer be dropped or changed) when its pad construction starts, 30 days before spud. Budget holds and
unschedulable pads are reported in the inbox.
Returns `{ok, months_advanced, stop, new_messages: [inbox items], career}`.

**until_event** (Continue): runs months until something needs the player, never errors on a hard stop.
`stop` is null (ran max_months) or `{reason, reasons?, message, tasks?, wells?}`:
- before a month, no month run for it: `budget_needed`, `steer` (wells), `task_blocking` (tasks), `task_due` (optional
  tasks that lapse this month; returned once per task, the next call lets them lapse), `no_plan`.
- after a month that produced: `task_new`, `pad_online`, `pad_report`, `battery_full`, `cost_overrun`, `board` (reviews,
  sacking, career end), `budget_hold`, `budget_warning` (projection's confidence_after below sack_below + 10; once a year),
  `sacked` / `finished`. `reasons` lists all of them; `reason` is the first.
Plain `months` keeps the old behaviour (errors on a hard stop, optional tasks lapse silently).

**Pad report card:** once every well on a pad has produced 3 months, an operations item with
`data: {kind: "pad_report", pad, section, wells[], months, actual_oil_bbl, forecast_oil_bbl (the plan's type curve and
percentile for the pad, on the wells' actual online days), ratio, gap_bbl, split: {type_curve_vs_rock_bbl, execution_bbl},
split_note}` (`months`: whole months since the first well came on). Wells coming online: one operations item per pad and month, "Pad B4 online: 4 wells" (or "2 wells of 4"), `data: {pad, wells[]}`. type_curve_vs_rock = the simulator's expectation for the pad's design in that section (landed in pay,
average well luck) minus the forecast; execution = actual minus that expectation (steering, frac and flowback results,
frac hits, lift, well luck). Pads locked before this change have no card.
- **Pads starting a month:** they lock with their actual durations and costs. Non-productive time, screen-outs and service prices vary. An overrun of more than 10 % on the AFE raises a supplemental AFE and costs 2 confidence.
- **Year end:** the board reviews oil against guidance and capex against budget, and confidence changes. Missing
  guidance costs confidence; beating it by more than 10 % is sandbagging and costs confidence too. Half of the
  year's positive free cash flow is paid to shareholders (`shareholder_returns_usd` on the career, and
  `free_cash_flow_usd` and `shareholder_return_usd` in each review).
- **Sacking:** you're sacked if confidence falls below 20 or cash falls below the credit line.
- **Month 60:** the career ends with `score`, which is the realised PV10 plus the PV10 of the remaining production of every well on truth.

## End of career, staff benchmark
- Every ended career (finished, or sacked at any month) has `score: {realised_pv10_usd, remaining_pv10_usd, value_usd,
  confidence, status, months, by_year: [{year, realised_pv10_usd}]}`.
- `benchmark`: a staff autopilot career on the same field, seed and oil price, computed in the background after
  generation (`careers/<id>/benchmark.json`). Its policy is in its `note`. While the career is active the view shows only
  `{status: "computing" | "ready" | "failed", note, reviews_so_far: [{year, confidence, production_ratio}]}` (staff reviews
  up to the player's own). After the career ends it is `{value_usd, realised_pv10_usd, remaining_pv10_usd, confidence,
  status, months, wells, pads, by_year, reviews, note}`, and `score` adds `benchmark`, `ratio` (base.relative) and
  `grade`: A ≥ 1.2, B ≥ 1.0, C ≥ 0.8, D below.
- `board.start_confidence`.
- Plan AFEs cost wells at the year's expected contracting factor: a played rig, water or facility job's result, or the
  staff 1.15. The factor is set when the yearly job is created, so letting the job lapse is the same as delegating it.

## Geology
- `view.geology`: the interim company map, `{sections: [{section, thickness_est_ft, porosity_est, perm_est_md,
  kh_est_md_ft}], noise, note}`. It is noisy and derived from the seed.
- `GET /api/career/geology?id=` → `{ok, wells, units, faults_known: [], structure: {top_tvd_ft: 9000, note},
  attributes, geomodels, company_map, gr_cutoff, note}`.
  - `wells[]`, verticals: `{id, type: "vertical", x_ft, y_ft, section, status: p&a|deeper producer|swd|dry hole,
    year_drilled, vintage: pre-1970|1970-89|1990+, td_tvd_ft, kb_ft, curves[], derived_curves[], log, picks_auto}`.
    - Curves by vintage: pre-1970 sp, rt and sometimes dt; 1970-89 gr, rt, and dt or rhob; 1990+ gr, rhob, nphi, rt
      and sometimes pe. Missing curves are absent.
    - Derived curves: phi from rhob or dt (matrix 2.65 g/cc / 55.5 µs/ft, fluid 1.0 / 189); sw from Archie (Rw 0.05,
      m = n = 2).
    - Scout tickets: `log: null`, `tops: {"Pay top", "Pay base"}`.
    - Some old logs are off depth or read on their own GR scale.
  - `wells[]`, horizontals: `{id, type: "horizontal", section, owner, x_ft, y_ft, heel, toe, lateral_ft, curves: ["gr"],
    log: {md_ft, tvd_ft, gr}}`, which is MWD gamma along the lateral.
  - Frame: x east, y south, in ft from the field's NW corner (col × 5280, row × 5280).
  - `planned[]`: `{id, pad, section, heel, toe, azimuth_deg, lateral_ft}` for every undrilled well on the active plan. Laterals run N-S (azimuth_deg 90: f7's convention, (cos, sin) in the x-east, y-south frame, so 0 = east and 90 = south), with the heel 300 ft inside the section's north line and slot i of n across the section.
  - No log measures permeability.
- `POST /api/career/geomodel {id, name, sections: {"A1": {gross_ft, net_ft, phi, sw, hcpv, ...}}, picks?, grids?, faults?,
  cutoffs?}` saves a named interpretation as belief. At most 12. Attribute names are lower-case words, values are
  non-negative, and picks, grids, faults and cutoffs are stored as sent (≤ 2 MB).
- `POST /api/career/typecurve {..., normalise_to: {geomodel: name | "company map", attribute}}` (the legacy
  `normalise_geology: true` means the company map's kh) returns `geology: {exponent, raw_slope, r2, n, ref_value,
  points: [{id, section, value, oil_6m_per_1000ft}], source, values, note}`.
  - The exponent is a log-log fit of 6-month oil per 1,000 ft on the attribute at each analog's section, clamped 0-1.5.
  - Saving stores it, with a snapshot of the section values.
  - Plan pads use factor = (value at pad / ref_value) ^ exponent, clamped 0.25-4 (`pads[].geology_factor`), and so does
    the pad report card's forecast.
- Staff (benchmark): auto-picks on the verticals, inverse distance to section centres, HCPV, used when r2 ≥ 0.2.
- Plan warnings flag step-outs, pads 2+ sections from any well in their type curve, when the curve is not normalised.

## Structure and the geosteering link (careers created on the geology grid)
- **Truth:** new careers carry f7's `synthetic_geology` grid (porosity, permeability, gross, net-to-gross, Sw) and
  `synthetic_structure` with 2-5 faults. Each section's simulated rock is the net-, HCPV- and kh-weighted mean of the
  grid over the section, run through the simulator's map path. Older careers keep uniform rock and a flat top.
- **Verticals:** legacy verticals log the rock at their own (x, y), with shale streaks making up gross − net, at the
  faulted top there.
- **Inherited horizontals:** their MWD TVD follows the true top along the well.
- `faults_known`: faults the legacy seismic resolves (throw ≥ 25 ft), `{id, trace: [[x, y], ...], throw_ft, source:
  "seismic", note}`. Traces are about ±250 ft off; the down side is not given.
- **Career steer sessions:**
  - `session.geo` = `{heel_x_ft, heel_y_ft, azimuth_deg, heel_mid_pay_tvd_ft}`. The hidden structure is the field's
    top along the well's real path, fault steps included, and pay = the section's gross.
  - `POST /api/steer/prognosis {id, target_ft (landing depth below the top), top_tvd_along: [{md, tvd}] (absolute),
    type_well?, type_well_picks?: {top_tvd, base_tvd}}`, before the first drill. With a type well (a vertical with
    GR), its gamma, stretched to this well's pay between the picks (picks_auto by default), becomes the session's
    typelog. The view shows `prognosis`.
  - After finish: `lookback.top_tvd_abs_ft[]`, `lookback.x_ft[]` and `lookback.y_ft[]` along md;
    `result.in_zone_plan_pct` (the prognosis line itself against the true pay) beside `result.in_zone_pct`.

## Planning and diagnostics additions (Phase A)
- **#6 diagnostics:** `GET /api/career/diagnostics?id=` → `{ok, month, wells: [{id, pad, section, months, from_month,
  actual_oil_bbl, forecast_oil_bbl, ratio, split: {type_curve_vs_rock_bbl, execution_bbl}, in_zone_pct, monthly:
  {actual_oil_bbl[], forecast_oil_bbl[]}}], summary: {wells, actual_oil_bbl, forecast_oil_bbl, ratio_p10, ratio_p50,
  ratio_p90, type_curve_vs_rock_bbl, execution_bbl, bigger_gap, outliers[]}, notes[]}`.
  - Wells are your drilled wells with at least one producing month. The forecast is the pad's type curve at lock.
  - Monthly arrays run from `from_month`, the well's first calendar month.
  - Outliers: ratio outside 0.7-1.3, or more than 2σ from the rest in log ratio.
- **#7 proximity auto-forecast:** `POST /api/career/typecurve {..., proximity: {pad: section | x_ft, y_ft, n: 8,
  radius_ft: 21120}}` picks the n nearest producing wells with 6+ months of history, by mid-lateral distance, in place
  of `analogs`. The response adds `proximity: {analogs: [{id, distance_ft}], note}`. Fewer than 3 in range is a 400.
- **#5 scenarios:** `POST /api/career/plan {id, plan, scenarios: [{name, oil_usd_bbl?, oil_price_factor?, gas_usd_mcf?,
  gas_price_factor?, capex_factor? (0.3-3), delay_months? (0-24)}]}` (up to 10) adds `scenarios: {cases: [{name,
  oil_usd_bbl, gas_usd_mcf, capex_factor, delay_months, npv10_usd, irr, pvi, payout_month, peak_exposure_usd,
  fd_usd_boe, npv10_change_usd}], notes[]}` (opecon.measures field names: `payout_month`). The first case is the plan itself. Development only, on your forecast.
- **#13 schedule risk:**
  - Truth: a quarter of pads start 7-40 days late (permit, weather, frac crew late, pad construction). The draw is
    fixed per pad, and an operations item "Pad X started N days late" carries `{pad, delay_days, cause}`.
  - The plan response's `pads[]` add `online_month_p10`, `online_month_p50` and `online_month_p90`: the
    point-of-production band from 60 sampled delays (the odds are known, the draws are not).
- **Steering target (grid careers):** wells are steered in the field's clean net bench, not the whole gross.
  `session.geo.target_zone = {top_offset_ft (below the top of the gross pay), thickness_ft, note}`, with
  `geo.gross_ft` and `geo.gross_top_offset_ft`. The bench sits at the same stratigraphic position across the field
  (a share of the gross from the seed), with thickness 35 % of net (20-40 ft); the verticals' logs show it as a clean
  interval. `prognosis.target_ft` is the landing depth below the top of the gross pay. Live: staff steering 94 % in
  zone, a flat prognosis line 44 %.

## Reserves (#3)
- **Opening booking** at the first budget meeting; then a booking at each year-end review. `view.reserves = {latest,
  history: [{year, month, price_usd_bbl, pdp_bbl, pdnp_bbl, pud_bbl, proved_bbl, reserve_replacement,
  audit_developed_bbl, audit_over_pct, roll_forward, parts}], notes[]}`, or null before the first budget.
- **Price:** the trailing 12-month average realised oil price, flat.
- **Categories:**
  - PDP: each producing well's own Arps fit, using the booking standard (b capped at 0.6, terminal decline
    10 %/yr), to the economic limit or the end of the well's 20-year life. Calibrated: it books 0.65-1.04× truth.
  - PDNP: drilled wells not yet online, on their pad's forecast.
  - PUD: plan pads not started that are scheduled to start within 5 years, on their type curve at P90 with the
    geology factor. A PUD carried more than 5 years from its first booking is removed.
- **Roll-forward:** `{opening_bbl, production_bbl (−), extensions_bbl (new PUDs), pud_conversions_bbl (moved to
  developed; net zero), pud_removals_bbl (−), revisions_bbl (the rest), closing_bbl}`. It balances: opening +
  production + extensions + removals + revisions = closing.
- **Audit:** an independent engineer's developed reserves (PDP + PDNP) from the wells' true remaining production.
- **Year review:** `parts` gain `reserve_replacement` (±3, from (extensions + revisions) / production − 1),
  `reserve_revisions` (negative revisions beyond 5 % of opening cost up to −8) and `reserves_audit` (booking more than
  15 % above the auditor costs up to −15). `reviews[].reserves` carries the year's numbers.
- Volumes are gross oil, the same basis as the rest of the career.

## Workovers (#12) and share codes (#15)
- `GET /api/career/workovers?id=` → `{ok, price_usd_bbl, wells: [{well, pad, history_months, current_rate_bbl_month,
  options: [{kind: refrac|cleanout, label, cost_usd, uplift_mean, uplift_sd, fade_months, incremental_oil_bbl,
  expected_npv10_usd, note}]}], notes[]}`.
  - Wells: your producing wells. Options are open once a well is old enough (refrac 18 months, cleanout 6), once per
    kind.
  - The economics are your expectation: the well's own decline (booking standard), the mean uplift and today's price.
- `POST /api/career/workover {id, well, kind}` charges the cost and applies the hidden uplift as a multiplier that fades
  over `fade_months`. Returns `{ok, workover, career}`. Uplift is a game rule (in notes): refrac mean +60 % ± 30 %
  over 36 months for $2.4 MM; cleanout +8 % ± 5 % over 18 months for $150k.
- `GET /api/career/share?id=` → `{ok, code: "RS1-...", note}`. `POST /api/career/new {name, share}` starts a career on
  the same starting field (seed). No decisions are carried.

## Mid-year revision
`POST /api/career/plan {id, plan, revise_guidance?: bool, budget_usd?: number}` outside a budget meeting returns
`revision` (a preview, beside `board_check`, which is null then). `POST /api/career/revise` with the same body applies
it and returns `{ok, revision, errors, career}` (400 with `errors` = `revision.reasons` when not allowed).
```
revision: {year, months_done, allowed, reasons[], guidance_bbl, original_guidance_bbl, new_guidance_bbl, revise_guidance,
  guidance_confidence, approved_usd, original_approved_usd, budget_usd, board_limit_usd, budget_confidence,
  confidence_change, planned_capex_year_usd, guidance_revised_this_quarter}
```
- Plan changes (unstarted pads, design for new pads, rigs, crews, who runs completion, flowback and steering) inside
  the approved budget are free, any time. Started pads stay as they are.
- `budget_usd` above the approval is a top-up: costs 2 + 20 x (increase / original approval − 5 %) confidence, up to
  the board limit (year-to-date op cash + forecast remainder + half the cash at the start of the year, within the
  capital limit). Lowering it is free.
- `revise_guidance: true` resets the year's guidance to year-to-date actual oil plus the plan's forecast for the rest of
  the year (the server computes it; you cannot type a number). Lowering it costs 1 + 40 x shortfall share x (0.5 + 0.5 x
  months done / 12): an early honest warning costs less than the year-end miss, a late one does not. Raising it is free.
  Once a quarter.
- Year end: production is scored against the current guidance, but beating a lowered guidance earns nothing above the
  original, and the +5 "delivered" bonus needs both the original guidance and the original budget.
- `board.original: {"<y>": {approved_usd, guidance_bbl}}`, `board.revisions[]`, and `projection.original_guidance_bbl` /
  `original_approved_usd` show the original promise. A "Year N plan revised" board item carries the revision.
- Yearly optional jobs now lapse at the end of their year (before, they could survive into the next).

---

# Geosteering

Design: `docs/2026-11-09-geosteering-design.md`. The structure along the lateral is hidden until the well is finished.
Coordinates: `md` (ft along the lateral from the heel), `tvd` (ft, positive down, relative: 0 = mid-pay at the heel),
`s` (stratigraphic position, ft from mid-pay, positive = below). Pay is |s| <= pay_ft/2; outside it is barrier.

**State in the UI (`note` in every session):** inside the pay, landing height does not change fracture geometry in
this model (height is set by the stress layers); proppant placement and laminations are not modelled. A stage landed
in a barrier gets a choked well-to-pay connection: a game approximation, simulated by ressim.

## Session view (`session` in every response)
```
{ id, link: null | {career, well}, lateral_ft (4620), interval_ft (300), sensor_lag_ft (50), dls_max_deg_100ft (3),
  typelog: {s_ft[], gamma_api[]}, pay_ft_on_typelog, heel: {s_ft, note},
  survey: [{md, tvd, inc}],              // inc in degrees from vertical: 90 = horizontal, above 90 = drilling up
  gamma: [{md, tvd, gamma_api}],         // MWD gamma at the sensor, 50 ft behind the bit, with noise
  bit: {md, tvd, inc}, days, decisions, at_td, finished, note,
  result?: {...}, lookback?: {md_ft[], pay_top_tvd_ft[], pay_base_tvd_ft[], segments, fault, pay_ft} }   // after finish only
```

## POST /api/steer/new `{seed?}` -> `{ok, session}`
A standalone well, the "Stay in Zone" level: 25-40 ft pay, 20 µD, 3 wells per section, scored over 20 years.

## GET /api/steer?id=<id> -> `{ok, session}`

## POST /api/steer/preview `{id, interpretation}` (belief only; free to call while the player drags)
`interpretation: [{md, dip_deg, throw_ft?, thickness_factor?}]` (dip positive = beds deepen with md; `throw_ft` is a
step at that md, positive = down). Returns `{ok, synthetic: [{md, gamma_api, s_ft}], bit_s_ft, bit_in_pay,
parallel_inclination_deg}`. `synthetic` lines up with `session.gamma` point by point.
`parallel_inclination_deg` is the inclination that stays parallel to the last segment's beds.

## POST /api/steer/drill `{id, target_inclination_deg, look_around?, interpretation?}` or `{id, sidetrack_to_md}`
Drills one interval (300 ft). The inclination change is capped at 3°/100 ft (9° per interval), and the bit walks slightly.
- **Rig days:** footage at 1,500 ft/day, plus 0.08 day per degree of steering (slide drilling).
- **Look-around:** costs 0.15 day and cuts gamma noise to 30 % for that interval.
- **Sidetrack:** goes back up to 1,500 ft behind the bit. It costs 1 day plus re-drill time and discards the logs beyond that point.

Returns `{ok, session, preview?}`, where `preview` uses the last interpretation sent.

## POST /api/steer/autosteer `{id}`
A staff geosteerer (rating 0.6) drills the rest of the well. It's a hint for the tutorial, and also the career default.

## POST /api/steer/finish `{id}` (at total depth only)
- **Standalone level:** simulates the well. Each stage's landing bucket is one ressim run, so it takes about 5-25 s the
  first time. Result:
  `{in_zone_pct, stages: [{stage, md_ft, s_ft, into_barrier_ft, bucket_ft, connection_multiple}], bucket_counts,
  extra_rig_days, capex_usd, measures: {npv10_usd, irr, payout_month, pvi, fd_usd_boe, ...}, oil_bbl_20yr,
  expert_oil_bbl_20yr, expert_npv10_usd, expert_in_zone_pct, value_ratio, stars, stars_rule, design, note}`.
  Stars are 80 / 90 / 97 % of the NPV10 an expert geosteerer gets on the same structure.
- **Career wells:** the result has `in_zone_pct`, `stages`, `bucket_counts` and `extra_rig_days`. The career well is
  marked finished, and its truth production uses the landing.
- **After finish:** the session includes `lookback`, the true pay top and base along the path.

## Career integration
- **Choosing who steers:** /api/career/plan and /api/career/budget take `pads[].steer: "staff" | "manual"`
  (default "staff").
- **Staff wells** are steered automatically when the pad locks (rating 0.6). In thick pay (60-150 ft) in-zone is
  usually high.
- **Manual wells** each get a session. `career.steer_pending` lists the wells whose sessions aren't finished, and
  /api/career/advance refuses to pass a pending well's spud: the error names the wells.
- **Each career well** carries `steer: {mode, session, finished, in_zone_pct?}`, plus `spud_month`.

---

# Minigames

`GET /api/mg` -> `[{kind, title, blurb, status: live|coming, sim}]`. Every game uses the same calls:
- `POST /api/mg/<kind>/new {params?: {seed?}}` -> `{ok, session}`
- `POST /api/mg/<kind>/act {id, action, ...args}` -> `{ok, session, events[]}`
- `GET /api/mg/<kind>?id=` -> `{ok, session}`

```
session = {id, kind, title, status: active|finished, turn, notes[] (always show), log[],
           link: null | {career, task, pad?, well?, year?, parents?},
           actions: [{name, label, args: {name: {type: number|int|enum|bool|list, min?, max?, step?, options?, unit?, default?, length?, max_length?}}}],
           view: {...game-specific}, result?: {score, stars (0-3, or null for career-only commits), headline, breakdown, lookback}}
```
Kinds: pump-job, flowback, facility, lift, land-auction, rig-contracts, hedging, diagnostics, well-control, frac-hits, water.
**pump-job clusters** (standalone only): the `pump` action takes `clusters` (1-6, default 3) and `shots_per_cluster`
(2-24, default 8); `rate_bpm` is per cluster and the stage rate (rate x clusters) is capped at 100 bbl/min. The view
adds `clusters: [{fluid_share, half_length_ft, propped_half_length_ft, perf_drop_psi, shadow_psi, share_in_pay,
height_at_well_ft, position_ft}]` and `perf_friction_psi`; `series.rate_bpm` is the stage rate. The company standard is
3 clusters, 8 shots, 15 bbl/min each. Friction is charged as pumping horsepower. A design the model cannot grow returns
a 400 with nothing charged. In career mode the plan's stage spacing already sets fracture spacing, so the job is one
cluster and the args are not offered.
The simulator-backed kinds (pump-job, flowback, facility, lift, diagnostics) take 2-30 s per action. Game-specific
view fields were sent to the front-end session as each game landed. Each game's module docstring in
`game/minigames/<kind>.py` describes what is physics and what is a game rule.

# Career tasks (minigames inside career mode)

The career view has `tasks: [{id, kind, label, link, session, blocking, due_day, due_month, created_month,
status: open|done|delegated|lapsed, result_headline?, staff_outcome: {headline},
played_vs_staff?: {metric, unit: usd|pct|points, yours, staff, delta (positive = you beat staff), better, worse, note?},
staff_result?}]`. `played_vs_staff` is set when you finish the game: pump-job (well NPV10 against the standard design),
flowback (against the flat drawdown closest to the plan's BHP), well-control (kick cost against staff's 4 days),
rig-contracts/water/facility (cost % against staff's 115 %), land-auction (value created against no bids), diagnostics
(confidence against 0), lift (pad production % against 100), frac-hits (game value against standard practice), hedging
(no number: settles monthly). `staff_result` is the frac-hits outcome when staff handled it. Open a task's minigame with its `kind` and `session`. When the
session finishes, its result is applied to the career immediately, and an inbox item of kind "task" carries
`data: {task, kind, session, ...link}`.

**Triggers:**
- **When a pad locks** (construction starts):
  - pump-job, if `pads[].completion == "manual"`. Blocking, due at frac start.
  - flowback, if `pads[].flowback == "manual"`. Blocking, due when the pad comes online.
  - well-control: a random kick, 4 % per well. Blocking, due at that well's spud.
  - frac-hits, when producing wells sit in a neighbouring section. Optional, due at frac start.
- **At the board's budget approval**, optional tasks that lapse at year end: hedging (career mode: place the book,
  then `commit`; no prices are revealed), rig-contracts, water, facility (needs wells), land-auction, and diagnostics
  (one of your wells online for 6 months or more).
- **After a pad has produced for 12 months:** lift. Optional, 3 months to decide.

**Plan fields:** `pads[].completion` and `pads[].flowback` are each `"standard"` (default) or `"manual"`, beside `steer`.

**Blocking and delegating:**
- `/api/career/advance` refuses to pass a blocking task's due point, and its error names the tasks.
- `POST /api/career/task/delegate {id, task}` hands a task to the crew: the standard outcome applies and the minigame is
  skipped. Returns `{ok, outcome, career}`.

**Effects on the career's truth:**

| Task | Effect |
|---|---|
| pump-job | Your propped half-length and conductivity, relative to the company's standard job in the same rock (same models), scale the plan's design for the pad's wells (×0.3-3 length, ×0.2-5 conductivity). A runaway shortens them. |
| flowback | The pad's wells produce on your monthly bottom-hole pressure schedule (simulated). |
| well-control | Non-productive time; a lost well costs a $2.5 MM redrill. |
| hedging | The book settles every month against the career's hidden WTI path. |
| rig-contracts | This year's rig cost factor = 100 / score (0.9-1.4). Skipped or delegated: 1.15, staff-typical timing. |
| water | This year's completion cost factor = 100 / score (0.9-1.4). Skipped: 1.15. |
| facility | This year's facility cost factor from your battery against the contractor's standard on your wells (0.85-1.4). Skipped: 1.15. |
| land-auction | Won tracts become new open sections in a new row; lease bonus and appraisal are charged to cash. |
| diagnostics | ±4 board confidence. |
| lift | A production factor on the pad from now on, relative to standard lift practice, plus lift costs. |
| frac-hits | Production losses on the parent wells. Skipped or delegated: standard practice (standard job, every parent shut in beforehand, no pre-load) on the same draws, so hits still cost half their damage. |

**New career fields:**
- `history.wti_usd_bbl[]`: the realised oil price. Revenue now uses a hidden, mean-reverting monthly WTI path, no longer a flat price.
- `history.hedge_usd[]`, `hedge_books[]`.
- `oil_cap_bbl_d` (null means no limit; there is no limit by default). Plan responses add `battery_limit_bbl_d` and `curtailed_months`.
- Career-linked sessions never contain hidden rock (`perm_md`, porosity, truth): it is stripped from view and result.
