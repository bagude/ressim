# ComboCurve and whitson+ feature inventory

Date: 2026-11-10. Purpose: pick features for the reservoir-engineering career game.

Conventions: **[P]** primary (vendor site, docs, manual). **[S]** secondary or search-snippet only. **[INF]** inferred, not stated by the source.

## Identification of "Witsen"

- Almost certainly **whitson** (whitson AS; product **whitson+**). Evidence: whitson+ is a web-based all-in-one petroleum engineering platform covering PVT, decline curves, type wells, RTA, nodal analysis and numerical models [S: SPE GCS event https://spegcs.org/events/print-view/6782; P: manual https://manual.whitson.com/]. Whitson's training and software courses are run by the same company (https://ti.to/courses/software-course-01oct2025). The spelling "Witsen" is a voice transcription; no competing product with a similar name and overlapping scope turned up. "Norwegian AS" is from the brief, not confirmed by me.
- Access caveat: whitson.com and web.archive.org returned 403 to my fetches. whitson+ features below come from the official **user manual** (manual.whitson.com), which is primary, plus release notes. Marketing-page claims (pricing, packaging, "modules" as sold) are not confirmed.
- ComboCurve access caveat: docs.combocurve.com is a JS shell (no content) and support.combocurve.com returned 403 to fetch. ComboCurve features below come from combocurve.com product and blog pages (primary, marketing), the API docs and ComboUniversity, plus search snippets of help-centre articles (marked S).

---

# 1. ComboCurve (combocurve.com)

Product family: **ComboCore** (forecast/type curve/economics/reserves platform), **ComboSync** (data integration), **ComboCarbon** (emissions) [P: https://combocurve.com/ , https://combocurve.com/solutions/combocore-forecast/].

## 1.1 Data and integrations
| Feature | What it does for the engineer | Source |
|---|---|---|
| Bulk import | Load databases from ComboCurve, ARIES, PHDwin or public data; map overlay and instant analysis | https://combocurve.com/ (blog links) |
| CSV / manual upload | Export, map, import CSV, ARIES, PHDWin files at no cost; can go stale | https://combocurve.com/solutions/combosync/ |
| Self-serve REST API | Programmatic access to wells, production, forecasts, type curves, econ models and runs; API key + service account | https://docs.api.combocurve.com/ [S snippet]; https://combocurve.com/solutions/combosync/ |
| ComboSync | Bidirectional automated ingestion/extraction on any cadence, no client coding | https://combocurve.com/solutions/combosync/ |
| Nightly/weekly production refresh | Updates production from sources like Enverus without manual pulls | https://combocurve.com/blog/better-forecasting-arrington-oil-and-gas/ |
| Share codes | Copy a full package (forecasts + economics scenarios) between users/companies | https://combocurve.com/blog/deal-evaluation-in-combocurve/ ; https://combocurve.com/blog-oil-and-gas-reservoir-teams-need-combocurve/ |
| Merge | Merge forecasts, scenarios, projects; merge a closed deal into reserves/budget database | https://combocurve.com/solutions/combocore-forecast/ ; deal-evaluation blog |
| Migration of ARIES/PHDWin forecasts and workflows | Move historical forecasts into the tool | reservoir-teams blog above |

## 1.2 Decline-curve forecasting
| Feature | Description | Source |
|---|---|---|
| Auto-forecast | Forecast up to 25,000 wells in minutes; 30+ configurable variables; saved regional configs | combocore page; Arrington blog; deal-evaluation blog |
| Multi-segment Arps rate and ratio DCA | Customizable mass forecasting | reservoir-teams blog |
| Manual edit modes | Precise hand-tuning of a forecast | reservoir-teams blog |
| Proximity mode (offset-well forecasts) | Forecast early-life wells from nearby analogs; criteria include landing zone, operator, history, search radius | combocore page; deal-evaluation blog |
| Diagnose / outliers | Statistical screen for wells with biggest actual-vs-forecast gap; correct manually | combocore page; https://combocurve.com/blog/combocurve-reserves-diagnostics-tool/ |
| Variance reports and distribution plots | Compare forecast vs actual over custom periods; EUR/cum outlier flags; reforecast in place | diagnostics blog |
| Compare and merge forecasts | Show change between past and current forecast (reserves roll-forward) | combocore page |
| Workover economics | Incremental economics for workover decisions | combocore page |
| Production start-date prediction | Estimate first production for acquisition candidates | Arrington blog |

## 1.3 Type curves
| Feature | Description | Source |
|---|---|---|
| Probabilistic P10/P50/P90 multi-segment type curves | Built to SPEE guidelines | combocore page |
| Basin-wide analysis | Type curves from production and forecast volumes | combocore page |
| EUR matching | Align type-curve EUR with existing well EURs | combocore page |
| Point-and-click diagnostics | Interactively adjust type curves | combocore page |
| Map-based well selection | Pick wells on a map; lat/long and shapefile filters | combocore page; deal-evaluation blog |
| Data normalization | Compare wells across variables (e.g. lateral length) | Arrington blog |
| Baseline type curves for 40+ areas | Prebuilt starting points | Arrington blog |

## 1.4 Economics
| Feature | Description | Source |
|---|---|---|
| Scenarios / assumptions | Ownership, costs, pricing, differentials, production taxes, stream properties, reserves category, risking | combocore page; https://support.combocurve.com/portal/en/kb/inside-petroleum-inc/scenario-page/economic-assumptions [S snippet] |
| Daily strip pricing | Henry Hub, Brent, WTI | combocore page |
| Cut-offs | Automatic economic limit in the first pass | combocore page |
| Multiple scenarios ("Combos") | Up to 10 combinations at once; up to 75,000 wells per run | combocore page FAQ |
| Project and one-line economics | Both calculated at once | combocore page |
| Custom economic models | Ownership, reversion, cutoffs, CAPEX, OPEX, pricing, taxes, risking | combocore page |
| Qualifiers | Layer custom CAPEX/pricing assumptions over base data | deal-evaluation blog; support article snippets |
| Waterfall chart | Show value walk from seller case to your case | deal-evaluation blog |
| Drilling delays and POP sensitivities | Sensitivity on timing | https://support.combocurve.com/portal/en/kb/articles/combocurve-drilling-delays-pop-sensitivities [S: title only] |
| Cash-flow forecasting, OBO elections, A&D evaluation | Use cases | workflows blog https://combocurve.com/blog/combocurve-workflows-forecasting-type-curves-economics/ |

## 1.5 Scheduling
| Feature | Description | Source |
|---|---|---|
| Scheduling module | Build schedules (timing of first production and capital) and assign them to scenarios; costs tie to drill-end / completion-end milestones | https://support.combocurve.com/portal/en/kb/articles/combocurve-utilizing-schedules-in-scenarios [S snippet] |
| Custom activity steps and resources, Gantt resource view, enhanced optimizing engine | Newer scheduler | https://support.combocurve.com/portal/en/kb/articles/scheduling-model-details [S snippet; page not readable] |
| Import schedules | Load schedules from files | https://support.combocurve.com/portal/en/kb/articles/combocurve-importing-schedules [S: title only] |
| Not confirmed: explicit rig-count / crew constraints | Could not read; do not assume | - |

## 1.6 Reserves
| Feature | Description | Source |
|---|---|---|
| Reserves reporting with SEC support | Reconciliation, reporting groups, validation tools, audit trail | https://combocurve.com/industry/reserves/ |
| Configurable data hierarchies | Reporting at each level | reserves page |
| Forecast approval workflow and role-based permissions | Team controls | reserves page |
| Price scenario analysis | Multiple price decks and asset-change effects | reserves page |
| Merge separate engineer forecasts into one reserves forecast | [S] search snippet of help centre | https://support.combocurve.com/ (3-6 in search result) |

## 1.7 A&D / deal evaluation
Run auto-forecasts against the seller case, QC with diagnostics, build Combos, recommend bid vs seller offer, branded PDF reports, merge into the reserves database [P: https://combocurve.com/blog/deal-evaluation-in-combocurve/]. Conversion tracking PUD to permit to PDP by operator [P: Arrington blog].

## 1.8 Emissions (ComboCarbon) [P: https://combocurve.com/solutions/combocarbon/]
- Emissions forecasting alongside production and reserves forecasts.
- GHG economics (capital for equipment in CAPEX, GHG costs in expenses).
- Carbon network models (nodes for assets, flows, sources); side-by-side reduction scenarios.
- Decarbonization planning: pick the best combination of network, CAPEX and expense models.

## 1.9 Collaboration, reporting, security
- Shared datasets, share codes, cloud access for engineers, geologists, field ops, management; admin controls [P: reservoir-teams blog].
- Maps and heatmaps of forecasts, type curves, EUR/ft, NPV, IRR; header filtering [P: combocore page FAQ].
- Excel and PDF exports; integrated Power BI reports for economic sensitivities [P: combocore page FAQ].
- SOC 2 Type II, SSO/2FA, role-based access, audit-ready workflows [P: https://combocurve.com/llms.txt; reservoir-teams blog says SOC 2].
- Economics tie-outs before each release [P: reservoir-teams blog].
- ComboUniversity certification courses: Updating Reserves, Deal Evaluation, ComboCurve 101, Workover Evaluation [P: https://combocurve.com/combouniversity-certification-courses/].

---

# 2. whitson+ (whitson.com; manual at manual.whitson.com)

Source for everything below unless stated: whitson+ User Manual navigation (https://manual.whitson.com/) and September 2026 release notes (https://manual.whitson.com/release_notes/September_2026_Release_Notes/). Module pages are at https://manual.whitson.com/modules/... .

No economics, scheduling or reserves-booking module appears in the manual navigation. [INF: whitson+ is an engineering/analysis tool, not an economics tool; it exports to ARIES and Val Nav formats, which supports this.]

## 2.1 Data and hierarchy
| Feature | Description | Source |
|---|---|---|
| Fields / Projects / Wells / Scenarios hierarchy | Organize wells; attribute order defines tree levels | manual /modules/hierarchy/ |
| Mass upload | Enerdeq, PRISM, Drillinginfo, geoSCOUT, ARIES, Novi, custom, Secretaria de Energia | Sept 2026 notes |
| Production data (stock tank, separator, flowback, monthly) | Inputs; separator rates converted to stock-tank rates | manual; type-well page |
| Bottomhole pressure calculations | Convert wellhead pressure/temperature to BHP using deviation survey, diameter, roughness, multiphase correlations | https://manual.whitson.com/modules/well-performance/bottomhole-pressure-calculations/ |
| External API | Python-style workflows: ARIES, Snowflake, BHP input, gas lift optimizer | manual API Connection section |
| Filters, GIS map, colour by attribute, shapefiles, lasso | Well selection and mapping | Sept 2026 notes |

## 2.2 PVT and phase behaviour
| Feature | Description | Source |
|---|---|---|
| Fluid definition and EOS model | Build fluid from composition; Peng-Robinson / SRK cubic EOS with BIPs | https://manual.whitson.com/modules/data_initialization/eos_model/ |
| Black-oil PVT table | Generated from EOS, extrapolated to critical pressure | manual "PVT Table" |
| Virtual PVT lab | Simulated lab study (SSF, CCE, DLE, CVD, multi-stage separator), saturation pressure, flash calculation, NGL calculation, simple material balance, PVT report repository | https://manual.whitson.com/modules/virtual-pvt-lab/sim-pvt-study/ |
| Gas EOR PVT | MMP (first and multi-contact) and gas huff-n-puff experiment; EOR efficiency, recovery | https://manual.whitson.com/modules/eor/mmp/ , /eor/hnp/ |

## 2.3 Decline curves, type wells, multi-well forecasting
| Feature | Description | Source |
|---|---|---|
| Decline curve analysis (DCA) | Single-well forecasts; ARIES table support | manual; Sept 2026 notes |
| Pressure-normalised-rate (PNR) DCA | Decline on rate divided by drawdown (oil; gas with pseudo-pressure) | https://manual.whitson.com/modules/well-performance/pnr-dca/ |
| Auto-forecast / bulk autofit | Mass fits, rate vs cum basis, EUR matching, transient hyperbolic, linear + constant | Sept 2026 notes |
| Type well and type well manager | Type wells from stock-tank rates; geometric vs arithmetic mean; probit plot, EUR/ft, PowerPoint export | https://manual.whitson.com/modules/multi-well-analysis/type-well/ |
| Group forecasting | Aggregate by pad, formation, lateral length; average or fit the aggregate | https://manual.whitson.com/modules/multi-well-analysis/group_forecasting/ |
| Forecast manager | Compare reserves cases or prior AFE forecasts, unity plots, volume deltas | https://manual.whitson.com/modules/multi-well-analysis/forecast-manager/ |
| Comparison plot | 2x2 multi-well comparison | Sept 2026 notes |

## 2.4 RTA and material balance
| Feature | Description | Source |
|---|---|---|
| Classical / analytical RTA, type-curve analysis | Linear flow parameter, contacted volume | manual nav |
| Fractional RTA | Linear-flow analysis with superposition improvements | https://manual.whitson.com/modules/well-performance/fractional_rta/ |
| Numerical RTA ("Bowie plot") | Match water cut and GOR to interpret multiphase RTA (Bowie and Ewert 2020) | https://manual.whitson.com/modules/well-performance/numerical-rta/ |
| Multiphase flowing material balance, gas FMB, recovery factor analysis, static MB | Contacted pore volume without relperm; refrac effect | https://manual.whitson.com/modules/material-balance/multiphase/ |

## 2.5 Numerical modeling
| Feature | Description | Source |
|---|---|---|
| Single-well numerical model with history matching | Tight unconventional depletion; engine is open-source OPM Flow | https://manual.whitson.com/modules/well-performance/reservoir-simulation/ |
| Sensitivities (per-layer) | Vary parameters | Sept 2026 notes |
| Probabilistics | Latin-hypercube sampling, 10 to 1000 cases, P90/P50/P10 with error filter | https://manual.whitson.com/modules/well-performance/probabilistics/ |
| Multi-well numerical model | Several wells with symmetry element, parent-child style | https://manual.whitson.com/modules/multi-well-analysis/multi-well-numerical-model/ |
| Refrac option; WHP forecasting; drag-and-drop schedule | Sept 2026 notes |

## 2.6 Nodal analysis and artificial lift
| Feature | Description | Source |
|---|---|---|
| IPR/VLP nodal analysis, gradient calculator | Intersect inflow and outflow | manual nav |
| IPR forecasting | Future performance, case compare | Sept 2026 notes |
| Gas lift optimizer, gas lift design | Optimum injection rate; valve placement, mandrel spacing | https://manual.whitson.com/modules/well-performance/nodal-analysis-gaslift-optimizer/ |
| Multi-well gas lift optimizer | Allocate limited lift gas across wells for max oil | https://manual.whitson.com/modules/multi-well-analysis/multi-well-gl/ |
| ESP, rod pump, foamer injection, parallel flow, multi-ESP | Lift modelling | Sept and March 2026 notes |

## 2.7 Well testing and interference
| Feature | Description | Source |
|---|---|---|
| Chow pressure group (CPG) | Quantify pressure interference from offset POP | https://manual.whitson.com/modules/well-performance/chow_pressure_group/ |
| DQI (Devon Quantification of Interference) | Interference test to diffusivity, fracture conductivity, degree of interference | https://manual.whitson.com/modules/well-performance/dqi/ |
| DFIT | Min stress, pore pressure, permeability, leakoff from injection test | https://manual.whitson.com/modules/well-performance/dfit/ |
| PTA | Pressure transient analysis | https://manual.whitson.com/modules/well-performance/pta/ |

## 2.8 Learning and collaboration
- Certification tracks (Comparison Plot, Auto-Forecast/Type Well, BHP, PNR DCA, RTA, Nodal, Well Test, Multi-well NM) and training [P: manual nav].
- Software course (free to subscribers) [P: https://ti.to/courses/software-course-01oct2025].
- Restricted project/scenario editing, project import/export between domains, reusable plot templates [P: Sept 2026 notes].

---

# 3. Not yet in the game

Ranked by gameplay or realism added. Ranking is my judgement [INF].

1. Interference and parent-child effects (Chow pressure group, DQI, multi-well numerical model): infill spacing becomes a real tradeoff, tied to the existing physics engine.
2. Probabilistic reserves/EUR range via sampled history match (whitson probabilistics, ComboCurve P10/P50/P90 reserves categories PDP/PUD): replaces single-point outcomes with risked decisions.
3. Reserves booking and SEC-style categories (PDP/PUD/PUD removal, forecast approval workflow, reserves roll-forward and forecast-change compare): gives the board meeting a year-end audit.
4. A&D / deal evaluation (seller case vs yours, bid price, waterfall chart, merge into portfolio): a new mission type.
5. Pricing scenarios and Combos (multiple price decks, up to 10 scenarios, sensitivities on capex, price, schedule delay): extends the NPV10 screen and hedging.
6. Diagnose outliers and variance report across wells (actual vs forecast distribution, unity plots): extends the pad report cards to a portfolio view.
7. Auto-forecast with proximity mode (forecast new wells from nearby analogs): partly present (analogs); adds a "forecast quality" skill check.
8. Nodal analysis with IPR/VLP and gas lift design / multi-well lift-gas allocation: deepens the existing artificial lift and facility features.
9. Pressure transient tests (DFIT, PTA, well test): a diagnostic minigame that reveals permeability and stress.
10. Rate transient analysis (flowing material balance, Bowie plot, linear flow parameter): lets players diagnose contacted volume from production.
11. Virtual PVT lab (CCE, CVD, saturation pressure, MMP, huff-n-puff): fluid-sampling minigame; fits gas-condensate and EOR plots.
12. Workover economics (incremental economics of a workover vs decline): a simple decision card.
13. Schedule Gantt and resource optimizer, delays and POP sensitivity (partly covered by the rig and crew schedule): add delay events.
14. Carbon network and decarbonization planning (ComboCarbon): an optional ESG/regulatory track.
15. Data import, share codes, API, role-based permissions, SOC 2: little game value; share codes could be a save or scenario exchange.

## Limits of this inventory
- whitson.com marketing pages were not readable; commercial packaging is unconfirmed.
- ComboCurve help-centre pages were partly unreadable; scheduler and scenario details rest on search snippets (marked S).
- docs.combocurve.com is a JS shell and was not read.
