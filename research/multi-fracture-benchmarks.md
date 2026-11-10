# Benchmarks for simultaneous growth of parallel hydraulic fractures

Date: 2026-11-10. Reading only; no code was run against these cases.

## Answer first

- **Best case: Protasov, Peirce and Dontsov (ARMA 2018)**, five constant-height fractures, compared
  with the planar-3D code ILSA at t = 351 s. Inputs are complete for the two limiting cases (zero
  perforation friction, and "large" friction giving equal rate per fracture). Results are per-fracture
  **footprint area**; total area and volume are printed, per-fracture areas are digitised. For the
  zero-friction ILSA case the digitised areas sum to within 0.1 % of the printed total and agree
  between two separate figure panels.
- **What this case does not give:** per-fracture inflow rate or volume share, inlet pressure, and any
  finite perforation-friction coefficient. So it tests stress shadow in two limits, not the
  shadow-versus-perforation-friction balance at a finite coefficient.
- **Second case: Nikolskiy and Lecampion (ARMA 2019)**, four constant-height clusters with a printed
  entry-friction coefficient, per-fracture length and inflow rate against time (read from the vector
  curves in the PDF). It is the only source opened that gives a flow split at finite friction, but
  it also has wellbore friction, tortuosity friction and curving fractures, so it is not a clean
  stress-shadow test.
- No source opened gives all of: finite perforation friction, flow split, lengths and inlet pressure
  for a clean constant-height problem.

Marking used below: PRINTED = number appears as text in the source. DIGITISED = read from a figure by
me. DERIVED = my arithmetic from the numbers above. NOT CONFIRMED = recalled or inferred, not read.

---

## Case 1 (primary): Protasov, Peirce and Dontsov, ARMA 2018

Source: https://personal.math.ubc.ca/~peirce/ARMA_paper_2018_Protasov_Peirce_Dontsov.pdf
(opened, 8 pages; all numbers below are from this URL).

### 1.1 Problem and conventions

- Five planar, parallel, equally spaced fractures, transverse to the well, height fixed at h
  (Section 2.1, Fig. 1, p. 2). Well along y, fractures in the (x, z) plane, growth along x in both
  directions from the well.
- Numbering: fractures 1 to 5 along the well. By symmetry 1 = 5 (**outer**), 2 = 4 (**inner**),
  3 = **middle** (Fig. 1 caption, p. 2).
- Q0 is the **total wellbore rate for all five fractures, both wings** (Section 2.1 and eq. 13:
  sum of Q_k = Q0). Check: Q0 t = 0.03 x 351 = 10.53 m^3, and the figures print V(t) = 10.5 m^3.
- Result metric is A, the fracture surface (footprint) area of one fracture, one face. For the EDDM
  the front is flat, so A = h x (tip-to-tip length). ILSA fronts are curved (Section 3, p. 5), so
  length from A/h is an equivalent length only.
- Flow split rule (eq. 13, p. 4): sum of Q_k = Q0, and p_k + p_pf,k = p0 for every fracture, where
  p_k is the pressure at the injection point of fracture k and p_pf,k the perforation loss. No
  formula or coefficient for p_pf is printed. The two cases are described only as "without
  perforation friction" and "large perforation friction (which leads to a uniform flux
  distribution)" (Section 3, pp. 5-6).

### 1.2 Inputs (all PRINTED, Section 3, p. 5, unless marked)

| Quantity | Value (SI) | Note |
|---|---|---|
| Young's modulus E | 20e9 Pa | |
| Poisson's ratio nu | 0.2 | E' = E/(1-nu^2) = 20.83e9 Pa (DERIVED) |
| Toughness K_Ic | 1.6e6 Pa m^0.5 | |
| Viscosity mu | 3e-3 Pa s | Newtonian, laminar (Section 2.1) |
| Total rate Q0 | 0.03 m^3/s | per stage, all five fractures, both wings |
| Fracture height h | 20 m | "The fracture height is taken as 20 m in all cases" |
| Number of fractures | 5 | |
| Spacing Dy | 5 to 30 m stated; plots cover 10 to 30 m | ILSA points at 15, 20, 30 m (zero friction) and 15, 20 m (equal rate) |
| Time of comparison | 351 s | |
| Leak-off | zero | "we consider no fluid leak-off" |
| Perforation friction | zero, or "large" | no coefficient, count, diameter or discharge coefficient given |
| Fluid density | not given | not needed without a perforation formula |
| In-situ stress | not given | uniform far-field stress only shifts pressure |
| Mesh size, time step | not found in the paper | |

Fluid flow law used by the EDDM (eq. 12, p. 4): q = -(w^3 / (pi^2 mu)) dp/dx with w the
height-averaged opening (the PKN elliptic cross-section law). Tip: multiscale (toughness plus
viscosity) asymptote (Section 2.5).

### 1.3 Results, zero perforation friction (Fig. 3, p. 5)

PRINTED on Fig. 3a/3b titles, Dy = 20 m, t = 351 s:

| Model | Total area A (five fractures) | Total volume V |
|---|---|---|
| ILSA (planar 3-D, reference) | 12229 m^2 | 10.5 m^3 |
| EDDM | 12495 m^2 | 10.5 m^3 |

DIGITISED per-fracture area at t = 351 s, Dy = 20 m, from Fig. 3c (pixel read of the embedded
1800 x 1200 image, axis ticks used for calibration; estimated uncertainty +-15 m^2):

| Fracture | ILSA A (m^2) | EDDM A (m^2) | EDDM minus ILSA |
|---|---|---|---|
| 1 (outer) | 3359 | 3540 | +5 % |
| 2 (inner) | 1775 | 1540 | -13 % |
| 3 (middle) | 1969 | 2320 | +18 % |
| 2 A1 + 2 A2 + A3 | 12237 (printed 12229) | 12480 (printed 12495) | |

DERIVED from the ILSA column: share of total area 27.5 % / 14.5 % / 16.1 % (outer / inner / middle);
A1/A2 = 1.89, A3/A2 = 1.11; equivalent half-length A/(2h) = 84.0 / 44.4 / 49.2 m.

DIGITISED ILSA area history, Dy = 20 m, Fig. 3c (+-20 m^2; +-40 m^2 at 100 s, where solid and
dashed curves overlap):

| t (s) | A1 outer | A2 inner | A3 middle |
|---|---|---|---|
| 100 | 1150 | 660 | 735 |
| 200 | 2113 | 1124 | 1243 |
| 300 | 2963 | 1561 | 1730 |
| 351 | 3359 | 1775 | 1969 |

DIGITISED ILSA area against spacing at t = 351 s, Fig. 3d (marker centres; +-25 m^2, the inner
value at 30 m is +-40 m^2 because the cross is hidden under the circle):

| Dy (m) | A1 outer | A2 inner | A3 middle | A1/A2 (DERIVED) |
|---|---|---|---|---|
| 15 | 3800 | 1237 | 1603 | 3.07 |
| 20 | 3361 | 1773 | 1969 | 1.90 |
| 30 | 2835 | 2196 | 2206 | 1.29 |

The Dy = 20 m row agrees with the independent read of Fig. 3c to within 2 m^2.

EDDM curve in Fig. 3d (DIGITISED, +-40 m^2; shown only as the paper's own cheap-model result):
Dy = 10 m: 4150 / 260 / 410; Dy = 15 m: 3780 / about 700 / 2050; Dy = 20 m: 3360 / 1630 / 2130;
Dy = 30 m: about 2800 / 2230 / 2230 (outer / inner / middle). **Inconsistency in the source:** the
EDDM values at Dy = 20 m in Fig. 3d (sum 12100 m^2) do not equal the EDDM end values of Fig. 3c
(sum 12480 m^2, which matches the printed 12495). The ILSA values are consistent between the two
panels. Use ILSA as the target.

Not given for this case: per-fracture inflow rate or volume, inlet (wellbore) pressure.

### 1.4 Results, large perforation friction = equal rate per fracture (Fig. 4, p. 6)

PRINTED on Fig. 4a/4b titles, Dy = 20 m, t = 351 s: ILSA A = 12841 m^2, EDDM A = 13413 m^2,
V = 10.5 m^3 for both.

DIGITISED from Fig. 4c at t = 351 s, Dy = 20 m (+-15 m^2):

| Fracture | ILSA A (m^2) | EDDM A (m^2) |
|---|---|---|
| 1 (outer) | 2476 | 2566 |
| 2 (inner) | 2630 (hidden under curve 3; value fixed by closure with the printed total) | about 2765 |
| 3 (middle) | 2630 | about 2756 |
| 2 A1 + 2 A2 + A3 | 12842 (printed 12841; not an independent check, see inner row) | 13418 (printed 13413) |

The inner value 2630 is supported independently by the Fig. 4d markers (2631 and 2634).

DIGITISED ILSA markers in Fig. 4d (+-30 m^2): Dy = 15 m: 2485 / 2742 / 2722; Dy = 20 m:
2436 to 2476 / 2631 / 2634 (outer / inner / middle; the outer diamond is partly clipped, Fig. 4c
value 2476 is the better one). No ILSA point at 30 m in this panel. EDDM curves in Fig. 4d
(+-40 m^2): Dy = 10 m: 2570 / 3180 / 2850; 15 m: 2480 / 2860 / 2710; 20 m: 2440 / 2660 / 2640;
30 m: about 2420 / 2490 / 2500. Same panel inconsistency as in Fig. 3 for the EDDM (4d sum at 20 m
is 12880, 4c gives 13418).

PRINTED statement (Section 3, p. 6-7): large friction gives "an almost uniform flux distribution",
all fractures have "approximately the same volume", and inner fractures "are longer and have larger
surface area compared to the outer ones".

DERIVED: flow share 20 % each (2.1 m^3 per fracture) by construction; inner and middle area is 6 %
above outer; equivalent half-length A/(2h) = 61.9 m outer, 65.8 m inner and middle; mean
half-length 64.2 m.

Sanity check (DERIVED, my arithmetic): the viscosity-dominated PKN estimate printed as eq. 9 of
Nikolskiy and Lecampion (https://infoscience.epfl.ch/record/267525/files/ARMA2019-1617-Nikolskiy-etal-final.pdf),
L ~ (E' Qn^3 / (4 pi^3 mu H^4))^(1/5) t^(4/5), with Qn = 0.006 m^3/s gives L = 65 m. That paper
calls it an order-of-magnitude estimate, so the close match to 64.2 m is not a validation, only a
rough consistency check. The conventions are fixed instead by the printed totals: V/A =
10.5 / 12229 = 0.86 mm mean width, inside the 0 to 1.5 mm colour bar of Fig. 3; a two-face area
would need a mean width above the bar maximum.

### 1.5 Propagation regime of this case (DERIVED)

Dontsov (arXiv:2110.13347, https://arxiv.org/pdf/2110.13347, eq. 6 and eq. 11) prints for a
constant-height fracture: tau = 2 pi^0.5 E'^4 mu Q0^2 t / (H^3.5 K_Ic^5); toughness regime below
tau = 0.11, viscosity regime above tau = 2.3e3. For case 1 at t = 351 s: tau = 67 with Q0 = rate
per fracture (0.006 m^3/s), tau = 1.7e3 with the stage rate. Both are inside the transition band,
so **toughness is not negligible**. The same paper's tip condition (eq. 3) is a net pressure at
the tip of 2 K_Ic / (pi H)^0.5 = 0.40 MPa here; the PKN net pressure for a 0.9 to 1 mm mean width,
p = 2 E' w / (pi H) (eq. 1), is about 0.6 to 0.7 MPa. A PKN model with zero tip toughness will
over-predict length.

---

## Case 2 (secondary): Nikolskiy and Lecampion, ARMA 2019, Section 5

Source: https://infoscience.epfl.ch/record/267525/files/ARMA2019-1617-Nikolskiy-etal-final.pdf
(opened, 11 pages).

### 2.1 Model and conventions

- Constant-height fractures, 2-D displacement-discontinuity elasticity with the Wu and Olson (2015)
  simplified 3-D kernel and height correction (Section 2.1). The paper states this kernel errs by
  about 10 to 15 % against full 3-D when spacing is below 0.25 of the height.
- Fracture flow law: q = -(w^3 / (12 mu)) dp/ds with w the opening in the mid-plane (eq. 3). This
  is the parallel-plate law, **not** the PKN elliptic law of case 1.
- Fractures may curve (mixed-mode criterion, Section 2.5). Universal tip asymptote.
- Wellbore flow is solved with pipe friction (eqs. 4-5); in Section 5 the fluid is slickwater with a
  drag-reduction (MDR) friction model.
- Entry loss (eq. 6): p_w,I - p_in,I = f_p Q_I^2 + f_t Q_I^beta, Q_I = total rate into fracture I.
  f_p = 0.807249 rho / (n_p^2 D_p^2 C^2) is printed as the empirical formula, with C "typically
  between 0.5 and 0.9"; the runs specify f_p directly.
- "Lfrac" in Fig. 13: not defined in the text. The curves start at 4.8 m (DIGITISED) and Section
  4.2 gives an "initial half-length" of 2.5 m, so Lfrac is most probably the full tip-to-tip
  length. NOT CONFIRMED.

### 2.2 Inputs (PRINTED, Section 5, p. 7)

| Quantity | Value (SI) |
|---|---|
| Clusters | 3 or 4 (figures show the 4-cluster run) |
| Height H | 35 m |
| Spacing S | 25 m |
| Initial length Lo | 2.5 m |
| E, nu, K_Ic | 25e9 Pa, 0.2, 1e6 Pa m^0.5 |
| Leak-off | zero |
| In-situ stress | sigma_h = 48e6 Pa, sigma_H = 67e6 Pa |
| Viscosity | 0.05 Pa s |
| Pump rate Q0 | 0.19 m^3/s, total for the stage |
| Duration | 600 s |
| Perforation friction f_p | 8e6, 8e7, 8e8 Pa (s/m^3)^2, same for all clusters |
| Tortuosity term | beta_t = 0.5; uniform f_t = 4.59e6 Pa (s/m^3)^0.5 for 4 clusters (3.97e6 for 3), stated to give 1 MPa at nominal rate |
| Well depth | 2250 m |
| Not given | wellbore diameter, roughness, fluid density, perforation count and diameter, mesh |

DERIVED: at the nominal 0.0475 m^3/s per cluster, f_p = 8e7 gives a perforation drop of 0.18 MPa.

### 2.3 Results for 4 clusters, equal f_t, f_p = 8e7, at t = 600 s

Read from the vector paths of Figs. 13 and 16 (p. 8), calibrated on the axis tick marks; precision
about +-1 m and +-0.0003 m^3/s. Curve-to-fracture assignment is read from the figure: each curve
end joins a leader line that ends at its "frac N" label. "Outer" and "inner" assume the fractures
are numbered in order along the well, which the paper does not state.

| Fracture | Inflow rate (m^3/s) | Share | Lfrac (m) |
|---|---|---|---|
| 1 (outer) | 0.0497 | 26.1 % | 393.5 |
| 2 (inner) | 0.0445 | 23.4 % | 388.4 |
| 3 (inner) | 0.0449 | 23.6 % | 390.4 |
| 4 (outer) | 0.0510 | 26.8 % | 400.0 |
| Total | 0.1901 (Qtotal curve reads 0.1899; printed 0.19) | | |

Fracture 4 has both the highest rate and the greatest length. Rates are nearly constant after about 100 s
(curve mid-points within 0.001 m^3/s of the end values).

Cross-check (DERIVED): sample standard deviation of the four rates over their mean = 0.069; the
paper's Table 4 prints 0.06977 for 4 clusters, f_p = 8e7, equal f_t. Match.

### 2.4 Printed tables (p. 9), relative standard deviation at 600 s, equal f_t

| f_p, Pa (s/m^3)^2 | 8e6 | 8e7 | 8e8 |
|---|---|---|---|
| dL/<L>, 3 clusters (Table 1) | 0.02600 | 0.01271 | 0.01261 |
| dQ/<Q>, 3 clusters (Table 2) | 0.09706 | 0.06977 | 0.01826 |
| dL/<L>, 4 clusters (Table 3) | 0.02414 | 0.00747 | 0.01224 |
| dQ/<Q>, 4 clusters (Table 4) | 0.09706 | 0.06977 | 0.01826 |

**Flag:** Tables 2 and 4 are identical to every digit as printed, so one of them is probably a
copy error; the digitised 4-cluster rates support the 4-cluster value. The digitised 4-cluster
lengths give dL/<L> = 0.013, which is nearer the Table 1 (3-cluster) number than Table 3. Treat
the length tables as uncertain.

Section 4.2 of the same paper (3 clusters, H = 20 m, E = 25e9 Pa, nu = 0.2, K_Ic = 1e6 Pa m^0.5,
mu = 0.01 Pa s, Q = 0.15 m^3/s total, f_p from 1e2 to 1e9, 300 s) gives only scatter plots of
relative standard deviation against two dimensionless groups. Printed conclusion: partitioning is
equalised for Gamma_m << 1, localised for Gamma_m > 1, with dL/<L> and dQ/<Q> levelling at "around
25 - 30 %". The paper also states that the pressure drop along the stage has more effect than the
stress interaction (Section 6). Spacing values for those plots were not extracted.

---

## Other sources

- **Dontsov, arXiv:2110.13347** (https://arxiv.org/pdf/2110.13347, opened). Five constant-height
  fractures in ResFrac, uniform flux by large perforation friction. Table 1 (p. 5) PRINTED: cases
  K / MK / M with K_Ic = 5 / 3 / 3 MPa m^0.5, H = 80 m, E = 10 / 10 / 25 GPa, nu = 0.25,
  mu = 0.003 / 0.01 / 0.05 Pa s, zero leak-off, Q0 = 0.1 / 0.1 / 0.2 m^3/s, t = 1 h,
  tau = 0.35 / 15 / 1.2e4; spacings 10, 20, 40, 80, 160 m. Results are footprint pictures only; no
  lengths or areas are printed. Not usable as a number benchmark. Useful printed statement: at
  spacing equal to twice the height "there is almost no interaction between the fractures". Note
  (DERIVED): the printed tau = 0.35 is reproduced only if 0.1 m^3/s is used directly as Q0 in the
  tau formula.
- **Lecampion and Desroches 2015, JMPS 82:235-258** (radial fractures; record
  https://infoscience.epfl.ch/record/211172). Not opened: an automated fetch of the record page showed no file link; a
  copy may still exist there.
- **Lecampion and Desroches 2015, Rock Mech. Rock Eng., limited-entry robustness**
  (https://infoscience.epfl.ch/record/216739). Not opened: the file download returned a CAPTCHA page.
- Wu and Olson 2015, Bunger / Cheng C5Frac, PyFrac multi-fracture examples: not opened in this pass.

---

## What a constant-height model with a local plane-strain stress shadow should reproduce

This section is my reasoning, not a cited result, except where a source is named.

Target = case 1, ILSA values. Yardstick = the EDDM-versus-ILSA gap in the same paper, since the EDDM
is itself a constant-height, elliptic-cross-section model, but with a full (non-local) elastic
kernel along the length.

Should reproduce:

1. Volume balance: total volume 10.53 m^3 at 351 s, exactly.
2. Equal-rate case, Dy = 20 m: inner and middle fractures longer than outer by a few percent
   (ILSA: +6 % in area), total area near 12841 m^2. The EDDM is +4.5 % on total and +4 to +5 % per
   fracture; a local model within about 10 % per fracture is a reasonable pass. Here every
   half-length (62 to 66 m) is about three times the spacing and the height, and neighbours have
   nearly equal length, which is the condition under which the same-position plane-strain shadow
   is a fair approximation.
3. Zero-friction case, Dy = 20 m: the ordering outer > middle > inner, and outer fractures taking
   about 55 % of the total area between the two of them (ILSA: 2 x 27.5 %). The EDDM misses
   per-fracture areas by +5 %, -13 %, +18 %, so 15 to 20 % per fracture is the honest tolerance,
   and A1/A2 = 1.9 within perhaps +-0.3.
4. Trend with spacing in the zero-friction case: A1/A2 falling from about 3.1 at 15 m to 1.9 at
   20 m to 1.3 at 30 m.

Should not be expected to reproduce:

1. Spacing below the height (Dy < 20 m). The paper states that the elliptic cross-section
   assumption "becomes inaccurate when spacing is equal or lower than the fracture height", and
   the EDDM is already far off at 15 m (inner area about 700 against 1237 m^2). A local model
   shares that assumption.
2. Early time, while half-length is of the order of the height or the spacing (roughly the first
   tens of seconds here; ILSA areas at 100 s are already 660 to 1150 m^2, half-lengths 16 to
   29 m). The fractures are then closer to radial and the plane-strain shadow is too strong.
3. The region within about one height of each tip, and wherever a fracture is next to a neighbour
   that is much longer or shorter (zero-friction case: 84 m outer against 44 m inner). A local
   model applies the full plane-strain shadow of the long neighbour right up to the short
   fracture's tip, and zero shadow on the long fracture beyond the short one's tip; the true
   field is smoothed over a distance of the order of the height and spacing. Expect the local
   model to exaggerate the inner/outer contrast in the zero-friction case.
4. Curved fronts. ILSA fronts are curved, so ILSA "length" is an area-equivalent length; compare
   area, not tip position.
5. Results with zero tip toughness. Case 1 is in the viscosity-toughness transition (Section 1.5),
   and the reference codes use a tip law with toughness.
6. Inlet pressure and flow split in case 1: there is nothing printed to compare with. In the
   zero-friction case the split is set by equal inlet pressure in all five fractures; only its
   consequence (area) can be checked.
7. Case 2 beyond trend level. Its rates depend on wellbore friction between clusters and on the
   tortuosity term, its flow law is parallel-plate with mid-plane width, and its kernel is the Wu
   and Olson approximation. Use it only for: outer clusters take more fluid than inner ones by a
   few percent of the stage rate at f_p = 8e7 with a 1 MPa tortuosity loss (26 to 27 % against
   23 to 24 %), and dQ/<Q> falls from about 0.10 to 0.02 as f_p goes from 8e6 to 8e8.

Suggested use: run case 1 at Dy = 20 m and 30 m in both limits (equal inlet pressure; equal rate),
compare per-fracture area at 351 s with the ILSA tables in 1.3 and 1.4, and report the miss next to
the EDDM miss. For a finite-friction test there is no clean published target among the sources
opened; the two limits of case 1 bracket it.
