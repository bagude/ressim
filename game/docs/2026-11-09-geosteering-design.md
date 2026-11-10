# Frac Challenge: geosteering module

Date: 2026-11-09. Owner: game back end (session ressim-83). Front end: ressim-ab, in `game/web/`. Simulator: open-harnessess-f7.

## Intent

The user asked for a geosteering drilling module. Real lateral placement works like this:
- **Typelog correlation:** the gamma ray measured while drilling (MWD) is matched against a typelog from an offset vertical well. The geosteerer adjusts bed dip and vertical offset until a synthetic log projected along the lateral overlays the measured one. Workflows in the style of StarSteer also allow thickness changes, which are slower but geologically defensible.
- **Steering:** the bit is steered to stay inside a target window within limits on dogleg severity.

Time in zone is widely reported as a leading production driver. The game should make the player do that interpretation under uncertainty, and the reservoir simulator should decide what being out of zone costs.

## What the research supports (sources below)

- **The core loop:** typelog correlation by dip and offset, with an optional thickness change.
- **Synthetic projection:** the typelog is projected along the lateral as a synthetic log that updates live (StarSteer).
- **Decisions:** steering is a sequential decision problem, one stand at a time. NORCE's benchmark uses up to 14 decisions per well, each either a direction change for the next stand or a stop.
- **Competition:** ROGII runs the Geosteering World Cup, free and online, on StarSteer. It is proprietary, and no reusable open-source game was found.
- **Production impact:** a Marcellus URTeC study, reported second-hand, ranks time in zone first of 72 factors. Vendor case studies report 91-96 % in zone and unproductive out-of-zone stages. None of these numbers are peer-reviewed, so the game takes no production penalty from them. The penalty comes from the fracture-growth model and the reservoir simulator.

## Goals

1. **A drilling mini-game in two places.** It runs as a standalone level ("Stay in Zone") and inside career mode, where the player can steer each well of a pad or delegate it to staff.
2. **Hidden structure.** Along each lateral there is a hidden cross-section:
   - a target window (e.g. 20 ft) inside the pay;
   - pay top and base with gentle dip changes;
   - at most one fault with a throw (e.g. 5-25 ft);
   - a gamma signature per layer, taken from a typelog that the player can see.
3. **The loop, one stand at a time** (about 95 ft; a 5,280 ft lateral is about 55 stands, grouped into steering intervals of about 300 ft so a well has 15-20 decisions):
   1. The player sees MWD gamma up to the sensor, which lags about 50 ft behind the bit. They also see survey inclination and TVD at the bit.
   2. The player fits an interpretation (dip and offset per interval, with an optional thickness change), and the synthetic log updates.
   3. The player sets a target inclination for the next interval. The achievable change is capped by the dogleg limit (e.g. 3°/100 ft).
   4. Drilling the interval reveals more gamma.
   5. Optional actions, each with a cost:
      - slow down for a resistivity look-around, which costs rig time and reduces noise;
      - sidetrack after a fault, which costs days and lateral length.
4. **Outcome:**
   - **In zone:** percent in zone for the whole well.
   - **Stage landings:** each stage's landing offset from mid-pay, read at the stage's measured depth, which in turn sets its in-pay fracture share.
   - **Rig time:** steering changes and sidetracks add drilling days.
   - **Tortuosity:** it raises completion cost and screen-out risk slightly.
5. **Production from the simulator, not a lookup table.** Each stage's landing position sets its well-to-pay connection (see **Decisions**). Stages are grouped into landing classes, each simulated as a repeating stage, so runs stay at a few seconds.
6. **Career integration:**
   - **Delegate:** a staff geosteerer's hidden rating sets MWD gamma noise and the quality of an "auto-steer" option (slice 3 staff system).
   - **Steer yourself:** the player can take over any well.
   - **Forecast vs actual:** results feed the existing forecast-vs-actual loop, so a badly steered pad misses guidance on truth.

## Non-goals

- Azimuthal or deep resistivity forward modelling (only an optional "look-around" noise reduction stands in for it).
- 3D steering in azimuth.
- Real survey math beyond minimum curvature in the vertical plane.
- Torque and drag, and hole cleaning.

## Anti-goals

- **Showing the hidden cross-section before the well is drilled.** It is revealed only in the post-well lookback, as a real lookback would show it.
- **Presenting vendor in-zone statistics as model output.**
- **Stating the landing-offset fracture model as validated** while it is the geometric fallback. Until f7 adds an off-centre height model, the UI must say "game approximation: symmetric fracture height centred on the landing point; in-pay share is geometric overlap".

## Design notes

### Hidden structure (truth)
- **Seeding:** each career and section seeds a cross-section along the lateral's measured depth. Pay top follows a smooth random walk in dip (±0.5-2°, changing every 500-1,500 ft) plus at most one normal fault, with throw drawn per section.
- **Layers** (mid-pay = 0 ft relative depth): an upper barrier (high gamma), an upper pay layer, the target window (a low-gamma marker with a distinctive spike pattern), a lower pay layer and a lower barrier. A typelog with these layers is built per developed section from its analog wells, so the player can see it before drilling.
- **Stored server-side:** the truth stays on the server; the browser sees only revealed MWD.

### Interpretation model (belief)
- **What the player edits:** a list of intervals along measured depth, each with dip (°) and vertical offset (ft) relative to the previous interval, plus an optional thickness factor.
- **Synthetic log:** the server, or the client with the same formula, maps each drilled point's TVD to stratigraphic depth (TVT) through the interpretation and reads the typelog. API: `POST /steer/preview` returns the synthetic log and the bit's position in the window under the player's interpretation, without drilling.
- **Truth stays hidden:** the true TVT of the bit is never sent until lookback.

### Drilling (truth)
- **Trajectory:** the well path in the vertical plane is built from inclination per interval by minimum curvature, honouring the dogleg cap.
- **MWD gamma:** truth gamma at the sensor's TVT, plus noise set by the geologist rating or the look-around.
- **Drilling days:** base days plus a steering penalty (slide drilling for each inclination change), plus sidetrack days.

### From landing to production
See **Decisions** below: landing inside the pay changes nothing; landing in a barrier chokes the well-to-pay connection (game approximation). Superseded text removed.

### Scoring (standalone level)
- **Value:** NPV of the well, as in the other levels, with the drilling-day cost included.
- **Display:** percent in zone and the lookback cross-section.
- **Stars:** calibrated thresholds, like the other levels.

### API (additive, all server-side truth)
- `POST /api/steer/new {level|career_id+pad+well}` → `{steer_id, typelog: {tvt_ft[], gamma_api[]}, window: {top_ft, base_ft}, plan: {lateral_ft, interval_ft, dls_max_deg_100ft}, state}`
- `POST /api/steer/preview {steer_id, interpretation}` → `{synthetic[], bit_tvt_ft, in_window: bool}` (belief only)
- `POST /api/steer/drill {steer_id, interpretation, target_inclination_deg, look_around?: bool}` → `{revealed: {md_ft[], tvd_ft[], gamma_api[]}, survey, days, state}`
- `POST /api/steer/finish {steer_id}` → `{in_zone_pct, stages: [{md_ft, landing_offset_ft, share_in_pay}], lookback: {truth cross-section}, production via the simulator, economics}`

## Decisions

- **Interaction (user, 2026-11-09):** in career mode, staff steer by default. The player can take over any pad's wells (`pads[].steer = "manual"`), and the standalone level is the tutorial.
- **Builder's calls for v1:**
  - **Landing to production (corrected by f7, 2026-11-09):**
    - **Inside the pay:** a stage gets the same fracture geometry as a centred one, because height and position come from the stress layers, not the start point. Production is unchanged. The UI states that landing height within the pay changes nothing in this model; proppant placement relative to the wellbore and laminations are not modelled.
    - **In a barrier:** not modelled in Ressim. Game approximation: a penalty on the well-to-pay connection, `connection_multiple` interpolated log-linearly through (0 ft, 30), (3, 0.3), (7.5, 0.03), (15, 0.006), (30, 0.002), where d is the distance into the barrier. Ressim probes showed 20-year oil is insensitive above about 0.2 (a choke only delays depletion of the stage's drainage volume) and loses about two thirds at 0.002, so the penalty bites only for stages well into the barrier. This stands for the narrow, poorly propped neck between the wellbore and the pay.
    - **Simulation:** stages are bucketed by d (0, ≤5, ≤10, ≤20, >20 ft), and each bucket is one cached repeating-stage simulation.
    - **Later:** move to f7's asymmetric `grow_stage_barriers` (top_ft, bottom_ft, share_in_pay) and `design_well` with proppant when they exist.
  - **The zone:** the scored zone is the pay between the barriers, and the pay is thin in the standalone level (25-40 ft; 20 µD, 3 wells per section, scored over 20 years so a perfect well is worth about $2.6 MM). The marker window inside the pay is only a correlation aid.
  - **Manual steering in career:** time stops before a manual well's spud until its steering session is finished.
  - **Rig days:** extra days from steering are not charged in career v1. They are charged in the standalone level.
  - **Standalone stars:** they are relative to perfect steering on the same seed (80/90/97 % of the oracle well's NPV), so every seed is fair.

## Sources

- [ROGII: turning a lateral into a typewell in StarSteer](https://rogii.com/blog/steer-smarter-how-to-turn-a-drilled-lateral-into-a-typewell-in-starsteer)
- [StarSteer](https://rogii.com/starsteer/)
- [Patent: computer-assisted lateral drilling with typelog correlation (US9091140)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9091140)
- [Chinook: geosteering with resistivity forward modelling](https://chinookpetroleum.com/geosteering-with-resistivity-forward-modeling/)
- [Geosteering World Cup FAQ](https://rogii.com/blog/geosteering-world-cup-faq)
- [NORCE geosteering decision benchmark (arXiv 2011.00733)](https://arxiv.org/pdf/2011.00733)
- [DigiWells geosteering event 2022](https://digiwells.gitlab.io/events/geosteering-2022)
- [SLB Niobrara lateral measurements case study](https://www.slb.com/zh-cn/resource-library/case-study-with-navigation/st/mangrove-niobrara-cs)
- [Weatherford GuideWave case study](https://www.weatherford.com/documents/real-result/drilling/drilling-services/guidewave-tool-helps-to-land-multiple-wells,-successfully-drilling-laterals-in-narrow-pay-zones)
