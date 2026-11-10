# Proppant bank equilibrium in a slot: sourced rules and a worked number

Date of research: 2026-11-10. Scope: a vertical slot of width W (a few mm), sand 0.1 to 0.4 mm, 2650 kg/m3, fluid 1 to 10 cP.

## Status labels used in this note

- **READ**: I opened the document and read the page (text or page image).
- **NOT OPENED**: I could not open the document. Anything said about it comes from the secondary source named next to it.
- **SEARCH SNIPPET**: the statement came only from a search-result summary; the page itself was not read. Treat as unverified.
- **COMPUTED FOR THIS NOTE**: my arithmetic, not a number printed in a source.

No value in this note is recalled from memory. Where a source was not opened, no constants are given for it.

## Sources opened

| Key | Document | URL | What it is |
|---|---|---|---|
| McC | McClure, "Bed load proppant transport during slickwater hydraulic fracturing: insights from comparisons between published laboratory data and correlations for sediment and pipeline slurry transport" | https://arxiv.org/pdf/1611.04020 | arXiv version (31 pages) of the J. Pet. Sci. Eng. 2018 paper. READ. |
| Pat | Patankar, Joseph, Wang, Barree, Conway, Asadi, "Power law correlations for sediment transport in pressure driven channel flows" | https://dept.aem.umn.edu/people/faculty/joseph/PL-correlations/docs-ln/expt-corr-pap.pdf | University of Minnesota **preprint** ("Last updated April 22, 2001"), not the Int. J. Multiphase Flow print. READ. |
| Wang | Wang, Joseph, Patankar (Conway, Barree), "Bi-power law correlations for sediment transport in pressure driven channel flows" | https://dept.aem.umn.edu/people/faculty/joseph/PL-correlations/docs-ln/Bi-Pwr-transport.pdf | University of Minnesota **preprint**, 24 pages, not the journal print. READ. |
| RF | ResFrac Technical Writeup | https://arxiv.org/pdf/1804.02092 | arXiv, current version, 187 pages. READ (sections 8.9 and 8.16). |

Not opened (paywalled or blocked): Kern, Perkins and Wyant 1959; Babcock, Prokop and Kehle 1967; Schols and Visser 1974; Medlin, Sexton and Zumwalt 1985; Biot and Medlin 1985; Durand 1952; Mack, Sun and Khadilkar 2014 (SPE 168637); Sahai, Miskimins and Olson; Tong and Mohanty; Alotaibi and Miskimins; the MDPI Energies review 13(21) 5665 (https://www.mdpi.com/1996-1073/13/21/5665/xml returned HTTP 403).

## The main point: there are two different thresholds

McClure separates two conditions, and they differ by a factor of about 2 to 4 in velocity (McC, sections 2.3 to 2.5 and 3.1 to 3.3):

1. **Erosion threshold**: clean fluid flows over a bed that already exists. The bed erodes until the gap velocity falls to a threshold. A Shields criterion predicts it. Measured in the Patankar "Case 1" tests: 0.25 to 0.40 m/s (McC p. 12 to 13).
2. **Deposition threshold**: slurry is injected and the bank grows until the gap velocity is high enough that no more sand deposits. This is the condition asked about. Pipeline deposition-velocity rules predict it when the pipe diameter D is replaced by the slot width W. Measured in the Patankar "Case 2" tests: about 0.6 m/s at very low sand concentration, rising to 1.6 m/s at about 0.2 volume fraction (McC p. 18).

A bank-growth model that uses the Shields number alone will make the equilibrium gap too tall (velocity too low). McClure says this directly: "The Shields criterion is appropriate for predicting erosion of proppant from an existing proppant bed, not transport of proppant that has not yet settled" (McC p. 25, section 4.2).

## 1. Classic results

### Kern, Perkins and Wyant (1959). NOT OPENED; reported through McClure

- Slot: 0.25 m tall, 0.56 m long, 0.00635 m wide (McC p. 3, section 1.1).
- They reported only a plot of equilibrium velocity against sand injection rate. They did not report bed height or total flow rate (McC p. 22, section 3.5).
- "At very low proppant injection rates, they found that the equilibrium velocity was 0.3 - 0.6 m/s." The velocity rose non-linearly with injection rate. Around 1 to 1.5 m/s large increases in sand rate needed little more velocity. Maximum sand rate about 0.4 kg/s at about 1.5 m/s (McC p. 22).
- McClure's warning: the slot was only 0.56 m long, so inlet turbulence and simple carry-through affected the whole slot. He states the results "cannot be considered to be representative of field conditions" (McC p. 22).
- **Sand size and fluid: McClure does not give them.** A search-result summary said "water and 20-40 mesh sand", velocity 0.6 to 1.5 m/s, slot 0.56 m x 0.19 m x 6.35 mm. SEARCH SNIPPET only; the source page was not identified (a candidate, the Energies 13(21) 5665 review, returned HTTP 403). Note the 0.19 m height disagrees with McClure's 0.25 m. Unverified.

### Babcock, Prokop and Kehle (1967). NOT OPENED

- McClure says only that Babcock et al. (1967) and Alderman and Wendorff (1970) saw equilibrium bed height behaviour and "developed correlations to predict the critical velocity at equilibrium", mostly with viscous gel and some water (McC p. 3 to 4). McClure does not print the correlation.
- I found no open source that prints the Babcock correlation or its constants. **Not reported here.**

### Schols and Visser (1974). NOT OPENED

- McClure says only that they gave "a more detailed mathematical description" of the Kern bank-building mechanism (McC p. 3). No formula found in an open source. **Not reported here.**

### Medlin, Sexton and Zumwalt (1985). NOT OPENED; reported through McClure

- Slot: 0.305 m tall, 6.1 m long, 0.0095 m wide (McC p. 4).
- Conclusion quoted by McClure: "bed load transport ... is unimportant on the scale of field treatments because it does not scale up with slot height" (McC p. 4).
- Sand rates in the range Kern reported needed a much higher velocity in Medlin's long slot, about 3 to 4 m/s (McC p. 22).
- When the bed-load layer exceeded about 2 cm an equilibrium could not be established; the bed kept growing (McC p. 21).
- The moving (bed-load) layer was at most about 2.6 W thick in both the Medlin and Patankar data, apart from one observation of 4.0 W at 4.9 m/s (McC p. 21).
- McClure's upper bound on bed-load sand rate, built on that: Qs,max = 2.6 x 0.3 x (...) = 0.8 x (...) (McC Eq. 13, p. 23; the factors 2.6, 0.3 and 0.8 are as printed, the symbols were lost in my text extraction). From the surrounding text I reconstruct it as 2.6 W x 0.3 x W x V = 0.8 W^2 V; that reconstruction is mine. "This relation is based on experiments with sand and water."

### Patankar et al. (2002). READ (preprint)

Slot: 8 mm wide, 30.5 cm tall, 2.44 m long (Pat p. 13 to 14; McC p. 4).

Definitions (Pat p. 15):

- Fluid Reynolds number on width: Rq = rho_f V~ W / eta = rho_f Qf / (W eta), with V~ = Qf / W^2. **V~ is a scaling velocity, not the gap velocity.** The gap velocity is Qf / (H W).
- Gravity Reynolds number: RG = rho_f (rho_p - rho_f) g d^3 / eta^2.
- H = height of the clear gap above the bed; W = slot width; d = grain diameter; eta = viscosity.

**Case 1, erosion, no sand injected (H1 = H2 = H).** Pat Eq. 12, p. 16: Rq = a (H/W)^n. Fitted lines printed on Pat Fig. 8, p. 15:

| RG | Correlation |
|---|---|
| 86.838 (light beads, 1.05 g/cc) | Rq = 300.09 (H/W)^1.618 |
| 521.37 to 20342.9 (sands, ceramics, bauxite in water) | Rq = 2053.4 (H/W)^1.0937 |
| 100415.8 (16/20 Carbolite in hot water) | Rq = 5158.1 (H/W)^1.1394 |

Pat p. 17: "a and n may be regarded as constants for 521.37 <= RG <= 20342.9".

Pat Eq. 13 and 14, p. 18: effective Reynolds number Reff = Rq (W/H)^n, and the critical value is Reff_cr = a(RG).

**Case 2, sand injected (H1 = gap above the immobile bed, including the moving layer; H2 = clear fluid gap).** Pat Fig. 10 and Eq. 15 to 18, p. 21, combined 20/40 Ottawa and 16/30 Carbolite data, with Reff = Rq (W/H2)^1.0937:

- Regime 1 (bed erosion): Reff - Reff_cr = 26838 ln(H1/H2). Fitted line on the figure: Reff = 26838 ln(H1/H2) + 2053.4.
- Regime 2 (bed expansion): Reff = 8177 (H1/H2)^1.1648.
- Transition "may be estimated to begin at Reff = 20000".

Pat Eq. 19 to 22 give a single blended form and a second correlation for the sand rate. I did not transcribe them; see Pat p. 21 to 23.

### Wang, Joseph, Patankar et al. (2003). READ (preprint)

Slot width W = 7.94 mm (Wang p. 5). Definitions (Wang Eq. 1 to 4, p. 5 to 6):

- RG = rho_f (rho_p - rho_f) g d^3 / eta^2
- lambda = (eta / rho_f) / (W^(3/2) sqrt(g))
- Rf = rho_f V~ W / eta = rho_f Qf / (W eta), with V~ = Qf / W^2
- Rp = rho_p V~ W / eta = rho_p Qp / (W eta), with V~ = Qp / W^2

**Erosion case**, Wang Eq. 5 and Table 1, p. 7: H/W = a(RG) Rf^m(RG)

| RG | 86.8 | 521 to 2.03e4 | 1.00e5 |
|---|---|---|---|
| a | 0.0294 | 9.36e-4 | 5.52e-4 |
| m | 0.618 | 0.914 | 0.878 |

This is the Patankar Case 1 law inverted. COMPUTED FOR THIS NOTE: (1/2053.4)^(1/1.0937) = 9.36e-4 and 1/1.0937 = 0.914, which match Table 1.

**Bed load case**, Wang Eq. 6 and 7 (p. 8), final forms Eq. 14 (p. 11) and Eq. 15 (p. 12):

- H1/W = [-2.30e-4 ln(RG) + 2.92e-3] x Rf^(1.2 - 1.26e-3 lambda^(-0.428) [15.2 - ln(RG)]) x Rp^(-0.0172 ln(RG) - 0.120)   (Eq. 14)
- H2/W = [-1.15e-4 ln(RG) + 1.33e-3] x Rf^(1.2 - 1.30e-6 lambda^(-1.28) [11.67 - ln(RG)]) x Rp^(-7.16e-3 ln(RG) - 0.304)   (Eq. 15)

Fitted range (Wang Table 3, p. 11): RG from 25.8 to 7.35e4, lambda from 2.09e-4 to 3.96e-3. Fluids were water, hot water, and 5 and 10 cP glycol (Wang Fig. 6, p. 10; Table A.2, p. 23). All at W = 7.94 mm.

Transcription check, COMPUTED FOR THIS NOTE. I read Eq. 14 and 15 from page images, so I recomputed the Table 3 coefficients from them:

- Eq. 14 (H1) reproduces Table 3 for c1, n1 and m1 at RG = 27.5, 3.50e3 and 7.35e4 to three figures. Example, RG = 3.50e3, lambda = 4.52e-4: c1 = 1.043e-3 (table 1.04e-3), n1 = -0.260 (table -0.260), m1 = 0.960 (table 0.961).
- Eq. 15 (H2) as printed does **not** reproduce Table 3. The printed prefactor gives c2 = 3.92e-4 at RG = 3.50e3 (table 4.00e-4) and 4.1e-5 at RG = 7.35e4 (table 2.31e-5). The printed exponent constant 7.16e-3 gives n2 = -0.362 at RG = 3.50e3 (table -0.370); a value of 8.16e-3 would reproduce all three table rows. The PDF text layer shows the same printed constants, so the mismatch is inside the preprint. **Check Eq. 15 against the journal print before use.**
- Eq. 14 against the paper's own data (Wang Table 2, 20/40 Ottawa in water, RG = 3.50e3): predicted H1/W = 1.79, 3.17, 7.51 against measured 2.90, 3.91, 7.31. The scatter is visible in Wang Fig. 8 too.

McClure's verdict on these correlations: they have been put in field simulators, but "the use of the Wang et al. (2003) correlations at the field scale is not recommended" (McC p. 24, section 4.2), because the tests were at low rates and a gap aspect ratio near 1.

## 2. More recent sources

### McClure (2018), arXiv:1611.04020. READ

Shields number and bed shear (McC Eq. 3 to 5, p. 9):

- N_Sh = tau_b / ((rho_s - rho_f) g d)
- u* = sqrt(tau_b / rho_f)
- For slot flow: tau_b = (1/8) fD rho_f V^2, with fD the Darcy friction factor (attributed to Biot and Medlin 1985, Appendix A).

Erosion threshold velocity (McC Eq. 6, p. 10):

- **Vc = sqrt(8 N_Sh,c R g d / fD)**, with R = (rho_s - rho_f) / rho_f (R is defined under McC Eq. 1, p. 5).

Constants McClure used, without tuning (McC p. 9, 10, 13):

- N_Sh,c = 0.047 (the Meyer-Peter and Muller value). The critical Shields number "varies between 0.03 and 0.06" for boundary Reynolds number Re* above 1.
- fD = 0.04 for turbulent flow in Plexiglas slots 6 to 9.5 mm wide (0.045 at the onset of turbulence, about 0.03 at very high Reynolds number). Laminar: fD = 64/Re. Very rough walls (relative roughness above about 0.05): about 0.0775.
- Reynolds number uses the hydraulic diameter; for parallel plates that is twice the width. Critical Reynolds number for a rectangular duct is 1800 (aspect ratio near 1.5) to 2800 (parallel plates) (McC p. 7).

Result for the erosion tests: measured equilibrium velocities were 0.25 to 0.40 m/s, and Eq. 6 predicted the gap height with R^2 = 0.75 (McC p. 12 to 13, Fig. 2). Light near-buoyant beads moved at as low as 0.07 m/s.

Deposition threshold, pipeline rules with D set to W (McC Eq. 10 to 12, p. 11):

- Durand (1952): VD = FL sqrt(2 g D R)   (Eq. 10)
- Thomas (1962) concentration correction: uD* = u0* (1 + 2.8 (Vt / u0*)^(1/3) C^(1/2))   (Eq. 11), in shear velocities; convert with u* = V sqrt(fD / 8). C is the solid volume fraction, Vt the settling velocity.
- Wicks (1968), dilute limit: **VD,0 = 1.87 (d/D)^(1/6) sqrt(2 g D R)**   (Eq. 12)

Result for the slurry tests: Eq. 11 with D = W and fD = 0.04 predicted the gap height with R^2 = 0.81. Velocity rose "from around 0.6 m/s at very low concentrations to 1.6 m/s at high concentrations (at a maximum volume fraction of about 0.2)" (McC p. 18, Fig. 5). Kern's low-rate 0.3 to 0.6 m/s "is in the range that would be expected from Equation 12" (McC p. 22).

Limits McClure states (McC p. 11 to 12, 19, 24):

- Eq. 11 with D = W is expected to hold only when the flowing gap has aspect ratio (height/width) close to 1. In the Patankar slurry tests it was 2.1 to 7.25. In the Medlin tests (4.7 to 17.3) the velocity "was not well-predicted by Equation 11".
- Eq. 12 "should be applicable to slot flow for sufficiently dilute concentrations (replacing D with W)", but what counts as dilute shrinks as the slot gets taller.
- His overall conclusion is that bed-load transport is negligible at field scale; most sand travels in suspension before it settles.

Settling velocity (McC Eq. 1, p. 5, Ferguson and Church 2006). On the page image I read Vt = R g d^2 / (18 mu / rho_f + sqrt(0.75 R g d^3)). The viscosity symbol in the first denominator term was not legible at my image resolution. Check, COMPUTED FOR THIS NOTE: with mu = 0.3 cP and d = 0.84, 0.42 and 0.15 mm this form gives 0.127, 0.081 and 0.031 m/s, which match the 0.12, 0.08 and 0.03 m/s McClure states for 20, 40 and 100 mesh (McC p. 6).

### ResFrac technical writeup, arXiv:1804.02092. READ

- Section 8.9 (p. 39 to 40): ResFrac does not use an equilibrium-height rule. It adopts McClure's conclusion that bed load is not significant at field scale and implements the Wiberg and Smith (1989) bed-load rate: Qs = W (d sqrt(g d R)) (9.64 N_Sh^0.166) (N_Sh - N_Sh,c)^(3/2), with N_Sh,c = 0.047 (RF Eq. 8-20; same as McC Eq. 7, p. 10, where I read the rendered form).
- Section 8.16 (p. 47): an optional washout model (attributed to Kryvenko 2025) remobilises settled proppant when velocity exceeds a critical washout velocity u_c = sqrt(8 N_sh,c d_p g (rho_p - rho_f) / (f rho_f)). This is the same expression as McC Eq. 6. The writeup gives no default value for f on that page.

### Mack, Sun and Khadilkar (2014), SPE 168637. NOT OPENED

- McClure reports that they used a Shields-number correlation for the critical flow rate to start proppant movement and proposed it for field design, and that they measured a "coefficient of reptation" for different proppants (McC p. 4 and p. 24). McClure prints no constants from the paper. **No values reported here.**

### Alotaibi and Miskimins; Sahai, Miskimins and Olson; Tong and Mohanty. NOT OPENED

- A search-result summary (source page not identified; Colorado School of Mines repository items were among the results, for example https://repository.mines.edu/server/api/core/bitstreams/a636593c-2e2e-47ae-be66-20bdd93ff723/content) said dunes reached more than 90% of the "equilibrium dune level" at a slurry velocity of 14.5 ft/min and 1.00 ppg, and that concentration scales the level by a power law. SEARCH SNIPPET only; the conditions behind that number are unknown to me. Do not use it as an equilibrium velocity.
- No equilibrium velocity or critical Shields number from Sahai et al. or Tong and Mohanty was found in an open source. **No values reported here.**

## 3. Durand limit-deposit velocity

- Form as printed by McClure: VD = FL sqrt(2 g D R), R = (rho_s - rho_f)/rho_f, which is the same as FL sqrt(2 g D (s - 1)). "D is the pipe diameter, and FL is a function of particle diameter and volumetric proppant concentration that varies between 0.75 and 1.5" (McC Eq. 10, p. 11). Durand 1952 itself: NOT OPENED.
- **Does anyone apply it to fracture slots? Yes, McClure does, with D replaced by the slot width W, not by a hydraulic diameter.** He tests Thomas (Eq. 11) and Wicks (Eq. 12) with D = W against the Patankar slurry data, and states that for those tests "the predicted VD from the simpler Durand (1952) equation is 0.57 m/s", which "reasonably predicts VD at dilute concentration, but underpredicts VD at higher concentration" (McC p. 18 to 19). He does not state the FL behind the 0.57 m/s.
- His argument for W over the hydraulic diameter: bed-load lift comes from contact with the surface underneath, so capacity scales with the horizontal extent of that surface, which is the diameter for a pipe and the width for a slot (McC p. 11 to 12).
- I found no source that uses a hydraulic-diameter (2W) version of Durand for a fracture slot.

## 4. Worked number: 0.2 mm sand, water, 5 mm slot

All of this section is COMPUTED FOR THIS NOTE from the formulas above.

Inputs: d = 2.0e-4 m, W = 5.0e-3 m, rho_f = 1000 kg/m3, rho_s = 2650 kg/m3, so R = 1.65; g = 9.81 m/s2; mu = 1.0e-3 Pa s.

### A. Deposition threshold (the bank-growth equilibrium), dilute slurry

Common factor: sqrt(2 g W R) = sqrt(2 x 9.81 x 0.005 x 1.65) = sqrt(0.16187) = 0.4023 m/s.

- **Wicks, McC Eq. 12, D = W:** (d/W)^(1/6) = 0.04^(1/6) = 0.5848. V_eq = 1.87 x 0.5848 x 0.4023 = **0.44 m/s**.
- Durand, McC Eq. 10, D = W: 0.75 x 0.4023 = 0.30 m/s to 1.5 x 0.4023 = 0.60 m/s.
- Thomas correction, McC Eq. 11, with fD = 0.04 and Vt = 0.023 m/s (from the Ferguson and Church form above): u0* = 0.44 x sqrt(0.04/8) = 0.0311 m/s. At C = 0.02: factor 1 + 2.8 x (0.0232/0.0311)^(1/3) x 0.02^(1/2) = 1.36, so V_eq = 0.60 m/s. At C = 0.05: 0.69 m/s. At C = 0.10: 0.79 m/s.

Check of the constants, COMPUTED FOR THIS NOTE: for the Patankar conditions (d = 0.6 mm, W = 8 mm, water) Wicks gives 0.62 m/s and Thomas at C = 0.2 gives 1.58 m/s, which match the "around 0.6 m/s" and "1.6 m/s" McClure states (McC p. 18).

Neither Wicks nor Durand contains viscosity, so the same 0.44 m/s results at 10 cP. In the Thomas form viscosity enters only through Vt (0.0034 m/s at 10 cP), which gives 0.52 m/s at C = 0.02.

### B. Erosion threshold (lower bound; clean fluid over an existing bank)

- McC Eq. 6, N_Sh,c = 0.047, fD = 0.04: Vc = sqrt(8 x 0.047 x 1.65 x 9.81 x 2.0e-4 / 0.04) = sqrt(0.03043) = **0.17 m/s**. With N_Sh,c from 0.03 to 0.06: 0.14 to 0.20 m/s.
- Check on the friction factor: Re = rho V (2W) / mu = 1000 x 0.174 x 0.010 / 0.001 = 1740, at or just below the 1800 to 2800 transition, so fD = 0.04 (a turbulent value) is doubtful here. With the laminar fD = 64/Re, Eq. 6 becomes Vc = N_Sh,c R g d rho_f W / (4 mu) = 0.047 x 1.65 x 9.81 x 2.0e-4 x 1000 x 0.005 / 0.004 = 0.19 m/s (Re = 1900). The two agree, so 0.17 to 0.19 m/s.
- Boundary Reynolds number: u* = sqrt(0.047 x 1.65 x 9.81 x 2.0e-4) = 0.0123 m/s, Re* = 1000 x 0.0123 x 2.0e-4 / 0.001 = 2.5. Above 1, so the 0.03 to 0.06 range applies.
- At 10 cP: Re* = 0.25 and Re is about 20 to 170. This is laminar and outside the Re* > 1 range for which McClure quotes 0.03 to 0.06. Eq. 6 with these constants is not supported there.

### C. Patankar and Wang correlations (extrapolation; shown for comparison only)

RG = 1000 x 1650 x 9.81 x (2.0e-4)^3 / (1.0e-3)^2 = 129.5. lambda = 1.0e-6 / (0.005^1.5 x sqrt(9.81)) = 9.03e-4.

- RG = 129.5 lies between the light-bead fit (RG = 86.8) and the constant plateau (RG from 521 upward). W = 5 mm is outside the single width tested (8 mm). Both are extrapolations.
- Erosion, plateau law Rq = 2053.4 (H/W)^1.0937. Gap velocity V = Qf/(H W) = 2053.4 (H/W)^0.0937 mu / (rho_f W). At W = 8 mm in water this gives 0.27 to 0.32 m/s for H/W from 2 to 10, consistent with the 0.25 to 0.40 m/s McClure reports. Scaled to W = 5 mm it gives 0.43 to 0.53 m/s, and the light-bead law gives 0.16 to 0.39 m/s. The 1/W scaling is an artefact of a fit made at one width; I would not rely on it.
- Bed load, Wang Eq. 14 at Q = 2.0e-4 m3/s, C = 0.02 (Rf = 3.92e4, Rp = 2120): H1/W = 7.7, H1 = 0.039 m, mean velocity over H1 = 1.03 m/s. At Q = 5.0e-5 m3/s, C = 0.02 (Rf = 9800, Rp = 530): H1/W = 2.8, H1 = 0.014 m, velocity 0.72 m/s. At these inputs Eq. 15 as printed gives H2 > H1, which is not physical, so the correlation is outside its valid range here.
- At 10 cP, RG = 1.3, far below the lowest fitted value of 25.8. Not usable.

### D. Equilibrium open height at a stated rate

H_eq = Q / (W x V_eq), where Q is the volume rate through this one slot.

| Rate Q through the slot | V_eq = 0.44 m/s (Wicks, deposition, dilute) | V_eq = 0.17 m/s (Shields, erosion) |
|---|---|---|
| 5.0e-5 m3/s (50 cm3/s, lab scale) | 5.0e-5 / (0.005 x 0.44) = 0.023 m | 5.0e-5 / (0.005 x 0.174) = 0.057 m |
| 1.0e-2 m3/s (about 3.8 bbl/min, one fracture wing) | 1.0e-2 / (0.005 x 0.44) = 4.5 m | 1.0e-2 / (0.005 x 0.174) = 11.5 m |

At lab scale the gap aspect ratio is 0.023/0.005 = 4.5, similar to the tests the rule was checked against. At field scale it is about 900, far outside them.

## Recommended rule for a simple slot model

1. Bank stops growing where the gap velocity reaches the deposition threshold: **V_eq = 1.87 (d/W)^(1/6) sqrt(2 g W (rho_s - rho_f)/rho_f)** (Wicks, McC Eq. 12 with D = W). For sand rates that are not dilute, apply the Thomas factor (McC Eq. 11); it raised V_eq from about 0.6 to 1.6 m/s in the data McClure fitted.
2. A settled bank is re-eroded by clean fluid only above **Vc = sqrt(8 x 0.047 x R g d / fD)**, fD = 0.04 turbulent or 64/Re laminar (McC Eq. 6; same form as ResFrac's washout velocity).
3. Open height: H_eq = Q / (W V_eq).

Limits to carry with the rule:

- Checked only against 8 mm (Patankar) slots, sand of 20/40 mesh and coarser, mostly water. Kern's 6.35 mm slot results are consistent at low sand rate but McClure distrusts that apparatus.
- Supported only for gap aspect ratio near 1 to 7 and dilute slurry. At field heights McClure's own conclusion is that the equilibrium picture matters little because suspension transport dominates and the bed-load rate is capped near 0.8 W^2 V (my reconstruction of McC Eq. 13, see section 1).
- No slot data at 0.1 to 0.2 mm sand or at 10 cP was read for this note. The 0.2 mm, 5 mm numbers above are extrapolations of the formulas, not measurements.
- The viscosity effect is weak or absent in the deposition rules, and the Shields constants are not supported at 10 cP (Re* below 1).

## Gaps left open

- Kern 1959 sand size, fluid and the actual plotted points (primary not opened).
- Babcock 1967 and Schols and Visser 1974 formulas (no open reprint found).
- Mack 2014, Sahai et al., Tong and Mohanty, Alotaibi and Miskimins: no values read.
- Wang Eq. 15 constants need checking against the journal print (Int. J. Multiphase Flow 29(3), 475-494, 2003).
- Durand's FL chart (dependence on d and C) was not opened; only the 0.75 to 1.5 range quoted by McClure is given.
