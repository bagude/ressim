# Frac Challenge: planning and budgeting, well and field level

Date: 2026-11-09. Owner: game back end (session ressim-83). Front end: ressim-ab, in `game/web/`.

## Intent

The user wants planning and budgeting modelled the way operators actually run the business. There are two levels:
- **Well level:** the AFE (Authorization for Expenditure) cycle.
- **Field level:** field development planning. The user pointed to Enersight and similar tools as the reference.

The game should teach how those decisions trade off, with the real simulator underneath. Economics stay illustrative, and the UI labels them as a game. The fluid is the SPE1 benchmark oil, not a real play.

## Reference: what planning tools do (sources below)

Enersight (Quorum, formerly Aucerna) is a field development planning tool. Its documented capabilities:
- **Development inventory:** pads and wells at scale.
- **Schedule engine with a Gantt chart:** rig adds and drops change development pace, production and economics. Drilling and completions are scheduled together: pre-drill steps, rigs and frac.
- **Unconventional effects:** offset-frac shut-ins with ramp-back, and water handling.
- **Facilities and network:** wells are assigned to facilities. Facility curtailment, takeaway capacity and flow split across sales points are modelled, and bottlenecks are flagged.
- **Constraints and goals:** inventory, production and capital goals, plus resource limits. The engine builds a schedule that honours them.
- **Economics on the schedule:** scenario comparison across shared assumptions.

Aucerna Portfolio adds portfolio and capital-allocation work: multi-goal, multi-constraint optimisation, with timing, working interest and dependencies taken into account. Aucerna AFE and Enverus cover the AFE workflow, including approval and benchmarking.

Published development-planning methods add these scheduling rules:
- Drilling days depend on crews, start dates and learning curves.
- Rig moves between pads take time, and drilling several wells on one pad saves time.
- Only one rig works a pad at a time.
- Frac crews are assigned to wells once they are drilled.
- Rigs and frac crews must keep a distance from each other.

## Goals

1. **Well level, the AFE cycle.**
   - **AFE:** a line-item estimate with contingency.
   - **Sanction:** approval against hurdle rates.
   - **Execution:** actual costs come in with variance, and an overrun past 10 % needs a supplemental AFE.
   - **Lookback:** comparison against plan.
2. **Field level, the development plan.**
   - **Plan inputs:** inventory, spacing, completion design, pad sequence, rig and frac-crew counts, facility sizing and phasing, and an annual capital budget.
   - **Schedule:** the engine builds a schedule that honours the constraints.
   - **Field forecast:** the sum of the wells along the schedule, curtailed by facility capacity.
   - **Field cash flow and measures:** NPV10, IRR, peak cash exposure, payout, PV10/I, F&D cost per BOE, capex by year against budget.
   - **Scenarios:** saved and compared side by side.
3. **The real simulator stays in the loop.** The type curve for each completion design and spacing is a ressim `run_fracwell` run, not a table.

## Non-goals

- Reserves booking and SEC rules.
- M&A.
- Multi-zone stacking.
- Pipeline networks beyond one battery-and-takeaway capacity per facility.
- Full portfolio optimisation: the player is the optimiser, and the tool only checks constraints.

## Anti-goals

- **Presenting numbers as a real play.** Every screen says game, illustrative costs, SPE1 oil.
- **Black-box economics.** Every number on the cash-flow screen must trace to a line item the player can open.
- **A schedule that silently breaks a constraint.** If the budget or capacity can't be honoured, the engine either delays the work or says so.
- **Editing files outside `game/`.** f7 owns `src/`; ressim-ab owns `game/web/`.

## Design

### Shared economics (operator-style)

- **Price deck:** an oil price ($/bbl) and a gas price ($/Mcf), each with a regional differential. The deck is flat, with an optional strip.
- **Interests:** working interest (WI) of 100 % by default, and net revenue interest NRI = WI × (1 − royalty). Royalty is 20 %.
- **Taxes:** severance tax of 4.6 % oil and 7.5 % gas on revenue after royalty, plus 2 % ad valorem.
- **LOE:** a fixed amount per well per month, plus a variable charge per BOE.
- **Other operating costs:** gathering and transport per Mcf, and water disposal per bbl.
- **Discounting:** monthly cash at 10 % per year, with mid-month convention.
- **Measures:** NPV10, IRR, payout month, PV10/I (NPV10 / discounted capex), F&D cost = capex / EUR (BOE, 6 Mcf = 1 BOE), and peak negative cumulative cash.
- **Forecast:** the simulator runs the whole 20-year well life, with no decline-curve extrapolation. Probe result: about 10 s per run at `dt_max_days = 30`, and the first 24 months match a fine-step run to within 0.4 %.

### Well-level AFE cycle (a level mode)

- **AFE line items.** The design sets quantities; the unit costs come from a "vendor bid sheet" for each level. Where a cost is a player choice, it's marked "choice".
  - **Drilling, intangible:**
    - Rig days × day rate. Rig days = vertical + build + lateral ft / ROP, with a learning factor.
    - Mud and chemicals per day, and bits per 1,000 ft.
    - Directional services per day, cementing, and mobilisation.
  - **Drilling, tangible:** casing per ft (surface, intermediate, production) and the wellhead.
  - **Completion:**
    - Pumping: hydraulic horsepower and hours, from the stage count and pump time per stage.
    - Proppant in tonnes and fluid in bbl, both set by half-length and conductivity through simple design ratios (labelled game assumptions).
    - Water sourcing, plugs and perforating per stage, coiled-tubing drill-out, and flowback.
  - **Facilities and lift:** a share of the battery, plus artificial lift chosen from bottom-hole pressure.
  - **Contingency:** a percentage chosen by the player, typically 5-15 %.
- **Sanction.** Management approves the AFE if NPV10 > 0, PV10/I ≥ the level's hurdle (e.g. 1.3) and IRR ≥ its hurdle (e.g. 20 %). The forecast used here is the player's own pre-run estimate: an estimate of EUR, entered or taken from the previous type curve. That way, sanction rests on what the operator believes, not on the answer.
- **Execution.**
  - **The well is simulated:** the real run gives the actual production.
  - **Costs vary:** actual costs come in with seeded, deterministic variance per run. Rig days carry non-productive-time risk. A screen-out risk rises with proppant concentration. Steel and sand prices move ±.
  - **Supplemental AFE:** if actual cost > AFE × 1.10, a supplemental AFE is raised and counted against the player.
- **Score:** value created (actual NPV10) plus estimate quality, i.e. how close the AFE came to actual cost and the forecast EUR to actual. Stars depend on both.

### Field-level development plan (a campaign mode)

Field: a 4 × 2 block of 1-mile sections. Each section has one landing zone. Pads hold 2-8 wells; laterals are 1 mile (5,280 ft).

**What the player plans**
1. **Spacing:** wells per section, from 2 to 10. This sets the inter-well distance, 5,280 ft / wells.
2. **Completion design:** stages per 1,000 ft, half-length, conductivity, and BHP.
3. **Pad sequence:** the player orders the pads, either by drag order or with auto-rank by PV10/I.
4. **Resources:** 1-3 rigs and 1-2 frac crews.
5. **Facilities:** the battery capacity (oil bbl/d, gas Mcf/d, water bbl/d) and when each phase is built. Each phase has a capex and a lead time.
6. **Capital:** an annual capex budget for years 1-5.

**Type curve from the real simulator**
- One `run_fracwell` run per distinct completion design and spacing. The model is one repeating stage (width = stage spacing, edge = spacing/2), with lease width = inter-well spacing, scaled by the stage count of the 5,280 ft lateral. A probe confirmed that every stage of an evenly spaced well produces the same volume. No-flow at half the spacing is the symmetry boundary of a row of identical wells produced together, so spacing interference is physical. Probe, 20 years: 528 ft spacing gives 86k stb, 1,056 ft gives 141k and 2,640 ft gives 146k for the same 5-stage segment.
- Stated limits:
  - Wells are assumed to be produced together, so parent/child timing effects are not simulated. A parent-child degradation factor is applied to child wells drilled more than 6 months after an adjacent parent, and is labelled a game assumption.
  - The repeating stage ignores toe and heel end effects.
- Result caching means re-planning without changing the design costs no simulator time.

**Schedule engine** (deterministic, daily resolution, rolled to months)
- **Pad construction:** a lead time (e.g. 30 days) and a capex.
- **Drilling:** one rig per pad at a time. Wells on a pad are batch drilled. Drilling days come from the AFE drilling model, with a learning curve per rig (e.g. −3 % per well down to a floor). A rig moves to the next pad in the sequence after a move time.
- **Completion:** a frac crew starts a pad only after all its wells are drilled and the rig has left. Days = stages / stages per day. Then drill-out and flowback, after which the well is online.
- **Offset-frac shut-ins:** producing wells on an adjacent pad are shut in while it's fracked, then ramp back over N days.
- **Capital constraint:** before a pad is released to a rig, the engine checks that year's committed capex. If the pad would break the budget, it waits until the next budget year. The engine reports every delay with its reason.
- **Facility constraint:** wells online can't exceed the facility phases built. Field rate above capacity is curtailed pro rata. Curtailed volume is deferred, not lost: each well's rate follows its rate-versus-cumulative curve.

**Outputs** (the API returns all of them)
- **Gantt:** rows for pads, rigs and crews.
- **Monthly field forecast:** oil, gas and water, with the capacity line and curtailment shaded.
- **Capex by month and by year:** against the budget, split into D&C, facilities and pads.
- **Cash flow and measures:** monthly cash flow, cumulative cash and peak exposure, plus NPV10, IRR, payout, PV10/I and F&D $/BOE.
- **Per-pad economics.**
- **Constraint report:** what was delayed or curtailed, and why.

**Scenarios:** the player saves named plans and compares them side by side on the field measures, as planning tools do.

**Campaign scoring:** a set of field scenarios with an objective:
- maximise NPV10 under a $X MM per year budget;
- hit a production target in month 18 with minimum F&D;
- size facilities without curtailing more than 5 %.

Stars are set by calibrated thresholds, as for the levels.

## Constraints

- **Code location:** Python standard library only, in `game/`. The Julia worker uses only public Ressim calls. The shared Julia environment is not modified.
- **Runtime:** a field plan with already-simulated type curves evaluates in under 1 s. Each new type curve costs about 5-10 s.
- **API:** changes are additive and recorded in `game/API.md`; ressim-ab is told about each one.
- **Tests:** fast unit tests for the scheduler, economics and AFE with no Julia, plus one end-to-end smoke test.

## Left to the builder

- Exact unit-cost defaults, sized for a plausible illustrative onshore horizontal well of about $6-9 MM D&C per mile lateral.
- The Gantt JSON shape is agreed with ressim-ab:
  `{start_month, months, lanes:[{id, kind: rig|frac_crew|facility|pad, label}],
  bars:[{id, lane, kind: drill|complete|facility_build|tie_in|wait, pad?, wells?, start_month, end_month (exclusive, fractional), label, status?: planned|curtailed|delayed}],
  links:[{from, to, type: finish_start}], milestones:[{month, label, kind: first_oil|facility_online|payout}]}`.
  Monthly series are parallel arrays. A `units` object goes wherever money or volumes appear. Each pad carries a `wells` count and `well_spacing_ft`.
- The variance distributions.
- The campaign scenario parameters and calibration.

## Revision 2: career mode, belief vs truth (user feedback, 2026-11-09)

The user asked for two things: type curves built the way ComboCurve does it, and a Football Manager aspect. Both point at one gap in revision 1: it didn't separate what the player **believes** from what is **true**.

### Core split
- **Truth (hidden):** each location has hidden rock (perm, porosity, thickness, initial pressure ≥ 4,100 psi so the live-oil deck stays valid). Its production is the ressim simulation, a 20-year run of one repeating stage scaled to the lateral, about 2 s each. Actual costs are variance draws seeded per career. None of this reaches the browser.
- **Belief (the player's):** type curves the player builds from analog data, and AFEs the player writes. Plans, sanction and budgets are all computed on belief.
- **One steppable engine runs on either source.** The forecast is the engine run forward on belief; actuals are the same engine on truth, one month at a time. "Forecast vs actual" is the game's core feedback loop, as it is in a real asset team.

### Type-curve workbench (in the style of ComboCurve)
ComboCurve's own pages (read 2026-11-09: combocurve.com, /solutions/combocore-forecast/) list these features:
- map-based analog well selection;
- outlier diagnosis and correction;
- auto-forecast;
- offset-well forecasts from nearby analogs ("Proximity Mode");
- probabilistic multi-segment P10/P50/P90 type curves "based on SPEE guidelines";
- matching type-curve EURs to existing EURs.

The pages do not give the method. The workbench steps below are therefore the standard SPEE-style workflow, a builder's call:
1. **Analogs:** producing wells in the field (pre-simulated truth wells). Their history is the monthly rate so far, with downtime noise, unequal history lengths and different completions and lateral lengths.
2. **Select:** the player picks analogs on the map and filters by completion, spacing and vintage.
3. **Normalise:** per 1,000 ft of lateral, with optional proppant normalisation.
4. **Align:** by peak month.
5. **Fit:** the player fits a multi-segment Arps curve (qi, Di, b, terminal Dmin), either by auto-fit or by dragging.
6. **Distribution:** P10/P50/P90 across the analog set.
7. **Apply:** the type curve is assigned to undrilled locations. Plans, AFE sanction and the board budget use the chosen percentile.

The UI can show the hidden truth only after the fact, in the well's lookback.

### Football Manager mechanics (a reading for the user to correct; mechanics only, no names, look or assets from that game)
- **Career clock:** you run the asset team of a small operator. Time advances month by month: plan, advance, read the inbox, re-plan. The year ends with the budget cycle.
- **Board:** each year it approves your capital budget (your pitch is built on belief). It sets targets: production, capex discipline, NPV and return on capital. A confidence meter falls when actuals miss the plan, and you can be sacked.
- **Staff (the squad):**
  - Roles: reservoir engineer, geologist, drilling engineer, completions engineer and landman.
  - Each has hidden ratings, a salary and morale.
  - Ratings scale terms the engine already has:
    - forecast noise on analogs;
    - cost overrun and non-productive-time variance;
    - appraisal precision;
    - screen-out risk.
  - Hiring, firing and contract renewals happen in a staff market.
- **Scouting = appraisal:** spend on cores, seismic or a pilot well to narrow the estimate of a location's hidden rock. Precision depends on the geologist's rating.
- **Transfer market = land market (a later phase):** buy and sell acreage of hidden quality, bidding against rival operators.
- **League table:** you're ranked against rival operators (AI) on production growth, F&D cost and return.
- **Inbox events:** price moves, frac hits on offset wells, rig availability, staff asking for a raise, partner AFE elections.

### Build order: a thin playable slice first
1. **Slice 1:**
   - one field with hidden rock and about 20 pre-simulated analog wells;
   - the type-curve workbench;
   - a field plan (spacing, design, pad order, rigs and crews) with the schedule engine;
   - advance by month, with forecast against actual;
   - an annual board budget meeting with a confidence meter.

   The seven existing levels become the tutorial.
2. **Slice 2:** the well AFE cycle (sanction, variance, supplemental, lookback) and facilities with curtailment.
3. **Slice 3:** staff ratings, hiring and morale; appraisal spend; inbox events.
4. **Slice 4:** the land market, rival operators and the league table.

### Architecture
- **Careers:** saved under `game/careers/<id>/` as JSON plus truth runs, with a seeded RNG.
- **Server:** it holds truth and serves only what the player has revealed.
- **New endpoints** (additive):
  - career new/load;
  - analogs;
  - type-curve fit;
  - plan evaluate;
  - advance;
  - inbox;
  - board.

  The existing level API is unchanged.

## Sources

- [ComboCurve ComboCore forecasting](https://combocurve.com/solutions/combocore-forecast/)
- [ComboCurve workflows blog](https://combocurve.com/blog/combocurve-workflows-forecasting-type-curves-economics/)

- [Quorum: Enersight](https://www.quorumsoftware.com/solutions/planning-economics-reserves/enersight/)
- [How Enersight accelerates asset development decisions](https://www.quorumsoftware.com/blog/posts/unlocking-smarter-asset-development-with-enersight/)
- [Enersight and field development planning](https://www.quorumsoftware.com/blog/posts/digital-transformation-in-oil-and-gas-the-role-of-advanced-field-development-planning/)
- [Enersight new modules (2013)](https://www.prnewswire.com/news-releases/enersight-announces-new-software-modules-for-their-petroleum-planning-system-186227802.html)
- [Aucerna Portfolio datasheet](https://resources.quorumsoftware.com/datasheets/aucerna-portfolio-improves-your-e-p-strategic-decision-making)
- [Aucerna AFE](https://www.sourceforge.net/software/product/Aucerna-AFE)
- [Horizontal well development planning patent (US10832183)](https://patents.google.com/patent/US10832183)
- [Rig scheduling with optimal fleet sizing (US11321788)](https://patents.google.com/patent/US11321788)
