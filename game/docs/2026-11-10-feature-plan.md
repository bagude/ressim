# Feature plan: everything from the ComboCurve and whitson+ inventory

The user decided on 2026-11-10 to build all 15 "not yet in the game" items from
`docs/research/2026-11-10-combocurve-whitson-features.md`, plus the work already under way.

**Owners:**
- **83** (ressim-83): the game back end, `game/` except `game/web/`.
- **ab** (ressim-ab): the front end, `game/web/`.
- **f7** (open-harnessess-f7): the simulator, `src/`.

Each item names who builds what. The API contract lives in `game/API.md`, and 83 messages ab on every shape change.

## Phase 0: under way
| Item | 83 | ab | f7 |
|---|---|---|---|
| One hidden rock: new careers on f7's `synthetic_geology` grid (logs, maps and production agree) | built, testing | maps already wired | done |
| Structure and faults into geosteering and the geology desk (`session.geo`, prognosis, `lookback.top_tvd_abs_ft`, plan vs execution score) | next | ready to wire | done (`synthetic_structure`, `lateral_structure`, `well_faults`) |

## Phase A: back end only (no new physics)
| # | Item | 83 builds | ab draws |
|---|---|---|---|
| 5 | Price and cost scenarios ("Combos"): up to 10 scenarios per plan (price deck, capex ±, delay), run side by side | `POST /api/career/plan` takes `scenarios[]`; returns measures per scenario | scenario table and waterfall |
| 3 | Reserves booking: PDP, PDNP and PUD (SEC 5-year rule, reasonable certainty = P90-ish), year-end roll-forward (production, revisions, extensions, PUD conversions, price), and a reserves audit at the board review | `reserves` block in view and year review; the board scores reserve-replacement ratio and revisions | reserves report, roll-forward waterfall |
| 6 | Portfolio diagnostics: actual vs forecast for every well, unity plot, outliers | `GET /api/career/diagnostics` | unity plot, outlier list |
| 7 | Auto-forecast with proximity: a type curve from the N nearest wells to a pad, distance-weighted | `typecurve` takes `proximity: {pad or x, y, n, radius_ft}` | "auto-forecast" button |
| 12 | Workovers: refrac, cleanout, ESP swap on a producing well, with incremental economics and a decision card | task kind `workover`, physics from existing runs | decision card |
| 13 | Schedule risk: delay events (permits, weather, frac crew) and point-of-production (POP) sensitivity | delay events in the schedule; plan returns a P10/P90 POP band | Gantt shows the band |
| 15 | Share codes: export and import a career's starting field and seed, or a plan, as a code | `GET /api/career/share`, `POST /api/career/new {share}` | share dialog |

## Phase B: needs simulator work
| # | Item | f7 provides | 83 builds | ab draws |
|---|---|---|---|---|
| 1 | Interference, parent-child: pressure depletion around producing wells lowers the child's rock pressure and frac performance; infill spacing becomes a real trade-off | multi-well (parent + child) model in one deck, or a depletion-map hook: initial pressure per cell from a parent's depletion | truth for child pads near producing parents; frac-hits gets real physics | depletion map layer |
| 2 | Probabilistic EUR from sampled history matches | a run-many entry point (or 83 batches through the worker) | sample rock and design uncertainty around a well's history, keep matches, P10/P50/P90; feeds reserves (#3) | fan chart |
| 10 | RTA: flowing material balance, a √t linear-flow plot, contacted volume | none (analytics on production data); f7 sanity-checks the formulas | `GET /api/career/rta?well=` | RTA plots |
| 8 | Nodal analysis (IPR/VLP) and multi-well gas-lift allocation | IPR from a run, VLP from `driftflux_lift` (exists); allocation under a gas limit | the lift minigame gains nodal; new allocation minigame on a pad | nodal plot, allocation sliders |
| 9 | DFIT and well test: injection-falloff and buildup minigame that reveals closure stress, permeability and pore pressure | injection-falloff (G-function) and buildup runs | diagnostics minigame gains DFIT/PTA; results feed the pump job and geology | G-function and log-log derivative plots |
| 11 | Virtual PVT lab: CCE, differential liberation and separator tests on the SPE1 black oil (sampling decisions; bad samples mislead) | lab functions from the black-oil tables (no EOS; MMP and huff-n-puff not possible without a compositional model, so labelled out of scope) | PVT minigame; results inform the flowback and facility games | PVT plots |

## Phase C: new modes
| # | Item | 83 builds | ab draws |
|---|---|---|---|
| 4 | A&D: an asset for sale (its own field and seed), a seller's data room with a rosy seller case, and you bid. Win it and it merges into your career | deal mission, data room, bid vs rivals (land-auction style), merge | data room, bid screen |
| 14 | Emissions (ComboCarbon): flaring, venting and fuel CO2e per month, an intensity target from the board, a carbon price and abatement capex | emissions accounting from flowback, facility and lift; board target | emissions dashboard |

## Order
Phase 0 → Phase A (#6, #7, #5, #13, #3, #12, #15: ab's order) → Phase B (#10, #2, #1, #8, #9, #11) → Phase C (#4, #14).
f7's Phase B order: #1 as staged starts in one model (pressure, saturations and Rs carried; no stress-dependent growth yet),
then a cheap-mesh error study, buildup then DFIT, nodal, then PVT.
Shapes: every new block carries `notes[]` and units in field names; reserves parts go into the year review's `parts`.
Screens: Asset (Field, Maps, Type curve, Diagnostics, Plan); Company (Board, Reserves, Finances); Deals (A&D);
minigames (nodal, DFIT/PTA, PVT, workover).
Phase B items start as soon as f7 confirms an entry point; 83 builds the analytics side (#10) without waiting.

## Rules that carry over
- Belief and truth stay separate. New screens show only what an operator could know.
- Every non-physics rule is labelled in `notes`.
- Each feature lands with fast tests, a live smoke run against the real simulator, and a staff-benchmark check (staff still survive at about 0.8-1.2 of guidance).
