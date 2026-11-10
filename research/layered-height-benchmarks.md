# Layered equilibrium-height benchmarks (asymmetric / multi-layer)

Date of research: 2026-11-10.

## 1. Short answer

One open source gives everything needed: Songxia Liu's Texas A&M PhD dissertation (2017), chapter 4.
Its footnote says part of chapter 4 is reprinted from Liu and Valko, SPE 173335-PA (SPE Production & Operations, 2018). The SPE paper's own table numbers were not checked.

- **Best case (Case A):** asymmetric three-layer case, dissertation Tables 6 and 7. Complete inputs, four PRINTED result numbers, hydrostatic term included.
- **Second case (Case B):** six-layer case, Tables 2, 3 and 4. Two PRINTED numbers that test the stress-intensity routine alone (no solver), plus one PRINTED end state and a described tip jump.
- **Third case (Case C):** three-layer case with a second (non-physical) solution pair, Table 5 and Fig. 7. PRINTED pressure limits, rough DIGITISED tip depths.

Labels used in this file:

- **PRINTED**: the number is in a table or in the text of the source.
- **DIGITISED**: read from a figure by eye; uncertainty is given.
- **RECOMPUTED**: calculated in this review with an independent numerical integration of the source's Eq. 1. These numbers are NOT from the source. Do not use them as benchmark targets; they are only evidence for the conventions.
- **INFERRED**: a convention the source does not state, found because it is the one that reproduces the PRINTED numbers.

## 2. Source and access

| Item | Value |
|---|---|
| Title | Hydraulic Fracture Height: Modeling and Evaluation Using Microseismic Closure Window |
| Author | Songxia Liu, PhD dissertation, Texas A&M University, December 2017 (advisor P. P. Valko) |
| URL opened (full PDF, 159 pages) | http://web.archive.org/web/20240727091432id_/https://oaktrust.library.tamu.edu/bitstream/handle/1969.1/169597/LIU-DISSERTATION-2017.pdf |
| Repository handle | https://hdl.handle.net/1969.1/169597 (not opened: bot challenge page) |
| CORE copy | https://core.ac.uk/download/187124104.pdf (not opened: bot challenge page) |
| Page numbers | PDF page = printed page + 16 |

The chapter footnote (printed p. 19) says "Part of this chapter is reprinted with permission from" "A Rigorous Hydraulic-Fracture Equilibrium-Height Model for Multilayer Formations", Liu and Valko, SPE Production & Operations, SPE 173335-PA. The SPE paper itself was not opened (OnePetro paywall).

All equations below were transcribed from rendered page images, not from the text extraction.

## 3. Governing formulas, as printed

Source: dissertation section 4.2.1, Eqs. 1 to 10, printed pp. 22 to 24 (PDF pp. 38 to 40). Same URL as section 2.

### 3.1 Stress intensity at the two tips (Eq. 1)

```
K_I+ = sqrt(1/(pi*c)) * Integral[-c..c]  Pnet(x) * sqrt((c + x)/(c - x)) dx      (lower tip)
K_I- = sqrt(1/(pi*c)) * Integral[-c..c]  Pnet(x) * sqrt((c - x)/(c + x)) dx      (upper tip)
```

- `c = (tipd - tipu)/2` is the fracture half height. `tipu` and `tipd` are the upper and lower tip DEPTHS.
- `x` is measured from the middle of the fracture. `x = -c` is the top and `x = +c` is the bottom (the text calls `-c` the "fracture top"). So x is positive downward.
- The text says `K_I+` is the lower tip and `K_I-` is the upper tip (printed p. 21 and p. 23).

### 3.2 Net pressure with hydrostatic term (Eq. 2)

```
Pnet(x) = rho*g*x + Pmid - sigma_i
        = rho*g*x + [Pref + rho*g*(dmid - dref)] - sigma_i
        = m*x + b_i
m    = rho*g
b_i  = Pref + rho*g*(dmid - dref) - sigma_i
dmid = (tipd + tipu)/2
```

- The hydrostatic term IS included. The fluid pressure rises with depth at `rho*g`.
- `Pref` is the fluid pressure inside the fracture at depth `dref`. `dref` is "the depth of reference fracture pressure, e.g. the injection point at bottomhole, or vertical depth of perforation cluster/stage in a horizontal well".
- `sigma_i` is the in-situ (closure) stress of layer i, constant in the layer.
- All pressures are inside the fracture. Wellbore, perforation friction and tortuosity are not considered (printed p. 21).

### 3.3 Closed form per layer (Eqs. 4 to 9)

```
IntTopToX(m, b, x) = sqrt(1/(pi*c)) * Integral[-c..x] (m*x + b) * sqrt((c + x)/(c - x)) dx

  = { 2c*sqrt(c - x)*(2b + m*c)*asin( sqrt((c + x)/(2c)) )
      - (c - x)*sqrt(c + x)*(2b + m*(2c + x)) }  /  { 2*sqrt(pi*c*(c - x)) }          (4)

IntTopToX(m, b, -c) = 0                                                              (5)
IntTopToX(m, b,  c) = (1/2)*(2b + m*c)*sqrt(pi*c)                                    (6)

K_I+ = Sum over layers i [ IntTopToX(m, b_i, x2_i) - IntTopToX(m, b_i, x1_i) ]       (8)
K_I- = Sum over layers i [ IntTopToX(-m, b_i, -x1_i) - IntTopToX(-m, b_i, -x2_i) ]   (9)
```

`x1_i` and `x2_i` are the top and bottom of layer i in the x coordinate, clipped to (-c, c).

### 3.4 Equilibrium criterion (Eq. 10)

```
diffu = K_I- - K_IC(layer that contains the upper tip)
diffd = K_I+ - K_IC(layer that contains the lower tip)
```

A tip is stable if its `diff <= 0` and grows if `diff > 0`. The equilibrium tips solve `diffu = 0` and `diffd = 0`. The source also allows the state where one tip is stable (diff < 0) and the other grows.

### 3.5 Units and conventions

| Convention | Value | Status |
|---|---|---|
| Depth, thickness | ft | PRINTED (tables) |
| Stress, pressure | psi | PRINTED |
| Toughness | psi*sqrt(in) | PRINTED (table headers) |
| Length inside the K formula | inches (c in ft times 12) | INFERRED. The source does not state the conversion. It reproduces the PRINTED numbers. |
| Fluid gradient for 62.4 lbm/ft3 | 62.4/144 = 0.4333 psi/ft | INFERRED |
| Fluid gradient for SG 1.1 | 1.1 x 0.433 = 0.476 psi/ft | INFERRED |
| "Pnet" in Table 7 | Pref minus the stress of the perforated middle layer (7100 psi), with Pref at dref = 10,000 ft | INFERRED, and consistent with the source's Pbase definition below |

### 3.6 The source's definition of net-pressure base (section 4.2.3, printed pp. 27 to 28)

`Pbase` is "the minimum reference pressure at which the initial line crack (covering the perforated zone) will lose stability/equilibrium, or grow out of perforation zone, when the fracture toughness of the two layers containing the tips are artificially set to zero". Apparent net pressure is `Pref - Pbase`. The source says that for the simple 1+2 layer case this gives back the usual base, the in-situ stress of the middle layer.

Note (derived in this review, not from the source): with a hydrostatic gradient and dref at mid-layer, zero K at the lower tip of a uniform-stress crack gives Pref - sigma = -rho*g*c/2, about -8 psi for c = 37.5 ft. So this definition does not give exactly the middle-layer stress. The PRINTED Table 7 numbers reproduce with base = 7100 psi (see section 4.3), so use 7100.

### 3.7 Older formulas (reproduced by Liu in Table 1, printed pp. 8 to 10)

Liu's Table 1 reprints the formulas of Simonson et al. (1978), Ahmed (1984) / Newberry et al. (1985) / Economides et al. (2012), Fung et al. (1987), Mack and Warpinski (2000, Reservoir Stimulation Eqs. 6-46 and 6-47) and Weng et al. (2011, Eq. 9), and lists errors Liu found in them. The original publications were **not opened**. What Liu prints:

- Mack and Warpinski, Reservoir Stimulation Eqs. 6-46 / 6-47 (as reprinted by Liu):
  `K_Iu = sqrt(pi*hf/2) * ( p_cp - sigma_n + rho*g*(h_cp - (3/4)*hf) ) + sqrt(2/(pi*hf)) * Sum[i=1..n-1] (sigma_(i+1) - sigma_i) * [ (hf/2)*acos((hf - 2*h_i)/hf) - sqrt( h_i - (hf - h_i) ) ]`
  and `K_Id` the same with `(1/4)*hf` in place of `(3/4)*hf`.
  Liu's note: the last term "will yield complex number when 2hi < hf. It should be sqrt(h_i*(hf - h_i)) which is correct in Weng et al (2011) model."
- Weng et al. (2011) Eq. 9 (as reprinted by Liu): same structure, with `sqrt(h_i*(hf - h_i))`, a minus sign before that root for `K_Iu` and a plus sign for `K_Id`, and hydrostatic terms `rho*g*(h_cp - 3*hf/4)` and `rho*g*(h_cp - hf/4)`. Symbol meanings are INFERRED from Liu's Fig. 2 (a picture reprinted from Cohen et al. 2017) and are NOT CONFIRMED against the originals: `h_i` is the height of the top of layer i above the fracture bottom, `h_cp` the height of the reference (initiation) depth above the fracture bottom, `p_cp` the pressure there, `sigma_n` the stress of the top layer. Liu states that this form gives the same results as the MFEH model (section 4.5.2, printed p. 35, Fig. 9: the two height maps "overlap very well" for SG 1, 2 and 5).
- Ahmed / Newberry / Economides (Petroleum Production Systems) form: Liu says the printed constants C1 = 0.163, C2 = 3.91, C3 = 0.0069 are wrong and gives "right values" C1 = 0.2303, C2 = 2.764, C3 = 0.0069, with K_IC in psi*sqrt(in) and the acos term in radians. Liu also says the derivation substitutes the stresses wrongly, so this form is not a valid target.

## 4. Case A (best): asymmetric three-layer, Tables 6 and 7

Source: dissertation section 4.5.1, printed p. 34 (PDF p. 50). URL in section 2.

Note: the source calls this a "3-layer symmetric problem". The stresses are not symmetric (7700 psi above, 8100 psi below). It is an asymmetric case.

### 4.1 Inputs (all PRINTED, Table 6)

| Layer | Top depth, ft | Thickness, ft | Stress, psi | Toughness, psi*sqrt(in) | Perforated |
|---|---|---|---|---|---|
| 1 | 8962.5 | 1000 | 7700 | 1000 | False |
| 2 | 9962.5 | 75 | 7100 | 1000 | True |
| 3 | 10037.5 | 1000 | 8100 | 1000 | False |

- Fracturing fluid density: 62.4 lbm/ft3.
- Reference depth dref: 10,000 ft (the middle of layer 2).

### 4.2 Results (all PRINTED, Table 7)

`dh_u` and `dh_d` are the "height outside perforated interval": growth above the top of layer 2 (9962.5 ft) and below the bottom of layer 2 (10037.5 ft).

| Pnet, psi | Quantity | MFEH model, ft | PPS/Newberry method, ft | "Error of other models over MFEH" |
|---|---|---|---|---|
| 200 | dh_u | 3.76 | 2.79 | 26% |
| 200 | dh_d | 1.62 | 0.97 | 40% |
| 600 | dh_u | 140 | 62.1 | 56% |
| 600 | dh_d | 33 | 13.3 | 60% |

Equivalent tip depths (arithmetic from the PRINTED values): at 200 psi, tipu = 9958.74 ft and tipd = 10039.12 ft, height 80.38 ft. At 600 psi, tipu = 9822.5 ft and tipd = 10070.5 ft, height 248 ft.

The MFEH column is the benchmark target. The PPS/Newberry column is the result of a formula the source calls erroneous; do not test against it.

### 4.3 Convention check (RECOMPUTED, not from the source)

Independent numerical integration of Eq. 1 with Pref = 7100 + Pnet at 10,000 ft, lengths in inches inside K, both tips at K = 1000:

| Pnet, psi | Gradient | dh_u, ft | dh_d, ft |
|---|---|---|---|
| 200 | 0.4333 psi/ft | 3.76 | 1.62 |
| 600 | 0.4333 psi/ft | 139.65 | 32.95 |
| 200 | 0 (no gravity) | 4.23 | 1.47 |
| 600 | 0 (no gravity) | 112.50 | 22.50 |

The rows with gravity agree with all four PRINTED numbers. The rows without gravity do not. So the case tests the hydrostatic term, and a calculator without it must not be expected to match.

Suggested tolerance: 0.01 ft at 200 psi; 0.5 ft at 600 psi (the source prints only integers there).

## 5. Case B: six-layer case, Tables 2, 3 and 4

Source: dissertation sections 4.2.3 and 4.3, printed pp. 27 to 29 (PDF pp. 43 to 45). URL in section 2. The source says the formation data are based on Warpinski et al. (1994) (not opened).

### 5.1 Inputs (all PRINTED, Table 3)

| Layer | Top depth, ft | Thickness, ft | Stress, psi | Toughness, psi*sqrt(in) | Perforated |
|---|---|---|---|---|---|
| 1 | 8990 | 90 | 7150 | 2000 | False |
| 2 | 9080 | 90 | 7150 | 2000 | False |
| 3 | 9170 | 170 | 5700 | 2000 | True |
| 4 | 9340 | 40 | 7350 | 2000 | False |
| 5 | 9380 | 75 | 5800 | 2000 | False |
| 6 | 9455 | 195 | 8200 | 2000 | False |

- Fracturing fluid specific gravity: 1.1.
- Reference depth dref: 9255 ft (the middle of layer 3).
- Model bottom is 9650 ft (9455 + 195).

### 5.2 Fixed-tip check of the stress-intensity routine (PRINTED, Table 2)

This check needs no solver: the tips are fixed and only the K routine is tested.

The text says "we set layer 3 and 4 as perforated interval", so the initial crack is 9170 to 9380 ft. This is a variant used only for Table 2; the Table 2 numbers reproduce only with the 9170 to 9380 ft crack (see 5.5). The height map and Table 4 use Table 3 as printed, with only layer 3 perforated (Fig. 6a starts at 9170 / 9340 ft).

| Quantity | "Our method" | Thickness-weighted stress | Stress at perforation centre |
|---|---|---|---|
| Pref_min, psi (minimum Pref for the initial crack to grow, K = K_IC) | 5809 | 5809 | 5809 |
| Pbase, psi | 5777 | 6014 | 5700 |
| Apparent Pnet, psi | 32 | -205 | 109 |

All nine values are PRINTED.

### 5.3 Height map results

| Item | Value | Status |
|---|---|---|
| Why the calculation stopped | "Upper boundary was reached" | PRINTED, Table 4 |
| Maximum pressure (Pref at 9255 ft) | 6,898 psi | PRINTED, Table 4 |
| Maximum height | 511.4 ft | PRINTED, Table 4 |
| tipu at end | 8,990 ft | PRINTED, Table 4 |
| tipd at end | 9,501 ft | PRINTED, Table 4 |
| Lower-tip jump | "The lower tip drops abruptly from the 4th layer through the 6th layer around 6550 psi, because the 5th layer has much lower in-situ stress 5,800 psi, compared to 7,350 psi and 8,200 psi in the neighboring layers." | PRINTED text, printed p. 28 |
| Lower tip just after the jump | about 9465 to 9470 ft (just below the 9455 ft interface) | DIGITISED from Fig. 6a, +/- 20 ft |
| Upper tip at the jump | about 9120 ft, with a small kink upward | DIGITISED from Fig. 6a, +/- 20 ft |

Fig. 6a (printed p. 29) is the full curve of tip depths against Pref from about 5700 to 6900 psi. Only the points above were read. They were read after the recomputation in 5.5, so they are not independent of it.

### 5.4 "Full map" variant (incomplete inputs)

Table 4 also prints a "full map case": calculation stopped because "Lower tip lost stability", maximum pressure 7,583 psi, tipu at end 7,930 ft. The source says the top and bottom layer thicknesses were extended "to large enough values" but does not print them. Fig. 6b suggests a top at about 7700 ft. Inputs are incomplete, so use this only as a rough check.

### 5.5 Convention check (RECOMPUTED, not from the source)

With gradient 1.1 x 0.433 psi/ft, lengths in inches inside K:

- Fixed crack 9170 to 9380 ft: upper tip reaches K = 2000 at Pref = 5809.2 psi; upper tip reaches K = 0 at Pref = 5777.4 psi. These agree with the PRINTED 5809 and 5777. So "Pref_min" and "Pbase" are both set by the upper tip of this crack.
- With tipu fixed at 8990 ft and both tips at K = 2000: Pref = 6897.6 psi and tipd = 9499.9 ft (height 509.9 ft). The source prints 6,898 psi, 9,501 ft and 511.4 ft. The source finds tips by interpolation on a discretised grid of tip positions, which probably explains the 1 to 1.5 ft difference. Suggested tolerance: 1 psi on pressure and 2 ft on tip depth.
- The recomputed primary branch has the lower tip reaching the 9380 ft interface at about 6560 psi and then landing near 9470 ft. This agrees with the PRINTED "around 6550 psi".

## 6. Case C: second solution pair, Table 5 and Figs. 3, 7, 8

Source: dissertation section 4.4, printed pp. 30 to 34 (PDF pp. 46 to 50); also Fig. 3, printed p. 11. URL in section 2.

### 6.1 Inputs (all PRINTED, Table 5)

| Layer | Top depth, ft | Thickness, ft | Stress, psi | Toughness, psi*sqrt(in) | Perforated |
|---|---|---|---|---|---|
| 1 | 0 | 9975 | 6500 | 1000 | False |
| 2 | 9975 | 50 | 6000 | 1000 | True |
| 3 | 10025 | 1000 | 7000 | 1000 | False |

- Fracturing fluid density: 62.4 lbm/ft3. Reference depth: 10,000 ft.

### 6.2 Results

| Item | Value | Status |
|---|---|---|
| Pressure range where the second solution pair exists | 6666.5 to 6780.4 psi | PRINTED text, printed pp. 30 and 33 |
| Third and fourth solution pairs | exist between 6672 and 6676 psi | PRINTED text, printed p. 33 |
| Maximum pressure with any solution | at 6780.5 psi "no solution exists"; the lower tip loses stability, "shooting from 10400 ft to infinity"; "6780.5 psi is the maximum treating pressure inside fracture we can use" | PRINTED text, printed p. 33 |
| Primary pair at about 6780 psi | upper tip about 9100 ft, lower tip about 10400 ft | DIGITISED from Fig. 7, +/- 40 ft (the 10400 ft value is also PRINTED) |
| Primary pair at 6700 psi | upper tip about 9400 ft, lower tip about 10100 ft | DIGITISED from Fig. 7, +/- 40 ft |
| Second pair at about 6667 psi (its start) | upper tip about 9780 ft, lower tip about 11050 ft | DIGITISED from Fig. 7, +/- 50 ft |

RECOMPUTED (not from the source), same conventions as Case A: primary pair at 6700 psi is tipu 9372.8 ft, tipd 10109.3 ft; at 6780 psi it is tipu 9113.1 ft, tipd 10356.2 ft; a second root at 6700 psi is tipu 9453.8 ft, tipd 10913.9 ft. These are consistent with the DIGITISED reads. The PRINTED limits (6666.5, 6780.4 and 6780.5 psi) were not independently reproduced; a root was found at 6780.4 psi but 6780.5 psi was not tested. Suggested tolerance on the limits: about 1 psi.

### 6.3 How the source chooses the solution

- The source calls the second pair "unrealistic": "if net pressure gradually increases and two tips gradually grow apart, it is impossible for the upper tip to recede back, and impossible for the lower tip to jump over a stable interval to a far, deep position" (printed p. 34).
- Selection rule (usetabs subroutine, printed pp. 25 to 26, Fig. 5): discretise the possible upper and lower tip positions, ordered from nearest to farthest from the perforated interval. For every tip pair compute the minimum Pref at which the upper tip loses stability and the minimum Pref at which the lower tip loses stability. For a given Pref, start from the nearest upper-tip position, find the first lower-tip position that is stable, then check that the upper tip is also stable there; if not, move to the next upper-tip position and repeat. Then interpolate. "Because we always start from the smallest upper tip and find the smallest corresponding lower tip locations", the height map follows the primary path. (The Fig. 5 flowchart words the upper-tip check the opposite way, "lose stability"; the body text is followed here.)
- In short: the primary solution is the smallest fracture, reached by growing continuously outward from the perforated interval. A tip may jump only when it loses stability (a real jump through a low-stress layer, as in Case B). A jump across an interval where the tip would be stable is not allowed.
- When no stable pair exists for the given pressure, one or both tips go to infinity and the calculation stops.
- Related finding (printed p. 20): "Tip jump is caused by low in-situ stress; tip stability is imposed by large fracture toughness and/or large in-situ stress."

## 7. Other candidates

| Candidate | Status |
|---|---|
| Liu and Valko, SPE 173335-MS (2015), "An Improved Equilibrium-Height Model..." | not opened (paywall). The dissertation says the 2015 work covered up to 6 layers. |
| Liu and Valko, SPE 173335-PA (SPE Prod & Oper, 2018) | not opened (paywall). Dissertation chapter 4 is its reprint. |
| Economides and Nolte, Reservoir Stimulation 3rd ed., Mack and Warpinski, Eqs. 6-46 / 6-47 | not opened. Formula known only through Liu's Table 1, which also reports a misprint in the last term (see 3.7). |
| Weng et al. (2011), Eq. 9 | not opened. Formula known only through Liu's Table 1. |
| Simonson et al. (1978); Ahmed (1984); Newberry et al. (1985); Fung et al. (1987, SPE 14140); Warpinski and Smith (1989) | not opened. Liu's Table 1 reprints Simonson Eq. 7, the Ahmed/Newberry form and Fung Eq. 3, with a list of errors. No worked numbers from these were found. |
| Open code with a documented test case (GitHub or similar) | none found in one web search. |
| MShale / FracPro comparison (dissertation Table 8, Figs. 10 and 11) | opened. Seven-layer Fayetteville cases; the layer inputs are shown only as stress-profile figures, so the inputs are incomplete. Not usable as a benchmark. |

## 8. Suggested test set for a calculator

1. Case B fixed-tip check: crack 9170 to 9380 ft, SG 1.1, dref 9255 ft. Upper tip K = 2000 psi*sqrt(in) at Pref = 5809 psi; upper tip K = 0 at Pref = 5777 psi (PRINTED, tolerance 1 psi).
2. Case A: Pref = 7300 psi at 10,000 ft gives growth 3.76 ft up and 1.62 ft down; Pref = 7700 psi gives 140 ft up and 33 ft down (PRINTED).
3. Case B end state: Pref = 6898 psi gives tipu = 8990 ft and tipd = 9501 ft (PRINTED, tolerance 2 ft); the lower tip jumps through layer 5 at about 6550 psi (PRINTED).
4. Case C: a primary solution exists up to 6780.4 psi and none at 6780.5 psi; a second root exists from 6666.5 psi and must not be selected (PRINTED).
