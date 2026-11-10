# P3D height growth benchmarks, stress interaction, perforation friction, gas-liquid flow

Researched 2026-11-09. Each formula and number has a source URL. Labels: "read from page
image" = transcribed from a rendered PDF page, not from extracted text; "digitised" = read
from a figure's vector paths and axis ticks; "computed for this note" = my arithmetic or
numerical check, not a source statement; "NOT CONFIRMED" = no opened source states it.

The sibling file `frac-propagation-landscape.md` (section 6) holds the PKN, KGD and radial
coefficients and the PyFrac three-layer case; they are not repeated here.

## A. P3D with equilibrium height growth

### A.1 Adachi, Detournay and Peirce (2010): the classical model, exactly the one to check

Source: Int. J. Rock Mech. Min. Sci. 47:625-639,
https://personal.math.ubc.ca/~peirce/Adachi_Detournay_Peirce_IJRM_V47_p625_639_2010.pdf
(equations read from page images). Model: pay of thickness H, two semi-infinite barriers with
stress higher by dsig and the same elastic constants, plane strain in each vertical section,
uniform pressure in each section, height from K_I = K_Ic, Carter leak-off in the pay only,
Newtonian fluid, constant rate. The leading edge is vertical with height H and has no
propagation criterion (no lateral toughness).

**Conventions (eqs 1-14)**

| Item | Convention in the paper |
|---|---|
| Rate | Q0 is the total rate into both wings. Inlet condition (eq. 14): qbar(0,t) = Q0 / (2H) |
| Length | l(t) is the half-length (one wing) |
| Height | H is the full pay thickness; h(x,t) >= H is the full fracture height; penetration into each barrier is (h - H)/2 |
| Width | wbar = (1/H) * integral of w over the full height h (eq. 1). It is cross-section area divided by H, not by h |
| Viscosity | plain mu. Local flux q = -(w^3 / (12 mu)) dp/dx (eq. 10). No mu' |
| Modulus | E' = E / (1 - nu^2) |
| Leak-off | C' = 2 C_l; sink term C' / sqrt(t - t0(x)) per unit pay height (eq. 12) |
| Pressure | p = p_f - sigma0 is net pressure over the pay stress; the barriers see p - dsig |

**Governing equations**

    K_I = sqrt(8h/pi) [ p * int_0^{H/2} ds/sqrt(h^2-4s^2) + (p-dsig) * int_{H/2}^{h/2} ds/sqrt(h^2-4s^2) ]   (3)
    equilibrium height:  2 asin(H/h) - (1 - p/dsig) pi = sqrt(2 pi/H) (K_Ic/dsig) sqrt(H/h)                 (8)
    width profile, with chi = sqrt(h^2-4z^2), psi = sqrt(h^2-H^2):                                          (7)
      w(z) = (2/E')(p-dsig) chi + (4 dsig/(pi E')) { chi asin(H/h)
             - z ln|(H chi + 2 z psi)/(H chi - 2 z psi)| + (H/2) ln|(chi + psi)/(chi - psi)| }
    flux:        qbar = -(psi'/mu) wbar^3 dp/dx ,  psi' = 1/pi^2 when h = H (PKN)                            (11)
    continuity:  d(qbar)/dx + d(wbar)/dt + C'/sqrt(t - t0(x)) = 0                                           (12)
    tip:         wbar = qbar = 0 and h = H at x = l(t)                                                      (13)
    PKN limit:   wbar = M0 p ,  M0 = pi H / (2 E')

Eq. 8 is credited by the paper to Simonson et al. (1978). Solved for pressure it reads
p = dsig [1 - (2/pi) asin(H/h)] + K_Ic / sqrt(pi h / 2). Dontsov and Peirce (2015) eq. 2 prints
the same relation, and their eq. 1 is the same width profile as eq. 7 (A.2).

**Scales and dimensionless groups (eqs 15-18)**

    l* = pi H^4 dsig^4 / (4 E'^3 mu Q0)        t* = pi^2 H^6 dsig^5 / (4 mu E'^4 Q0^2)
    w* = pi H dsig / (2 E') = M0 dsig          p* = dsig      q* = Q0/(2H)      h* = H
    gamma = l/l*,  lambda = h/H,  Pi = p/dsig,  Omega_bar = wbar/w*,  tau = t/t*,  xi = x/l
    toughness number:  K = sqrt(2 pi/H) K_Ic / dsig                                             (17)
    leak-off number:   C = C' H^2 dsig^(3/2) / (mu^(1/2) E' Q0)                                 (18)

The whole solution depends only on K and C. The paper says both lie between 0.01 and 1 in
most practical cases.

**Closed-form results**

    height, any toughness:   Pi = 1 - (2/pi) asin(1/lambda) + K / (pi sqrt(lambda))             (19)
    height, zero toughness:  lambda = csc[ (pi/2)(1 - Pi) ]                                      (20)
    mean width:              Omega_bar = (1/pi) ( K lambda^(3/2) + 2 sqrt(lambda^2 - 1) )        (23)
    zero toughness:          (pi/2) Omega_bar = tan( pi Pi / 2 )                                 (26)
    compliance correction:   wbar/p = c M0,
        c = sqrt(lambda) (K lambda^(3/2) + 2 sqrt(lambda^2-1)) / ( K + sqrt(lambda) [pi - 2 asin(1/lambda)] )   (25)
    breakthrough (height growth starts):  Omega_bar_b = K/pi                                     (37)
        in SI: wbar = K_Ic sqrt(pi H/2) / E' , p = K_Ic sqrt(2/(pi H))   [computed for this note]
    runaway height:   lambda_u = (8 + sqrt(K^4 + 64)) / K^2 ,  K > 0                             (21)
    runaway width:    Omega_bar_u = (16 + sqrt(K^4+64)) sqrt(8 + sqrt(K^4+64)) / (pi K^2)        (50)

- Runaway: for K > 0, Pi(lambda) has a maximum at lambda_u. Beyond it the equilibrium-height
  model is invalid; it is reached first at the inlet, when Omega_bar(0, tau) = Omega_bar_u.
  For K = 0 the pressure rises monotonically toward dsig and there is no finite runaway height.
- Checks computed for this note: lambda_u from eq. 21 equals the numerical maximum of eq. 19
  (K = 1: 16.06; K = 2.45: 3.00); eq. 50 equals eq. 23 evaluated at lambda_u; eq. 23 equals
  Dontsov and Peirce eq. 5 term by term.
- **Source inconsistency.** Eq. 22 (scaled width profile) as printed is
  (8/pi^2)[ (K/(2 sqrt(lambda))) sqrt(lambda^2-4 zeta^2) - 2 zeta ln|..| + ln|..| ]. Integrated
  over the height it gives twice the K = 0 part of eq. 23. With -zeta ln|..| + (1/2) ln|..| it
  reproduces eq. 23 and the dimensional eq. 7. Use eq. 7 (computed for this note).

**Time-dependent results**

    PKN similarity, no leak-off (M):   gamma = gamma_m0 tau^(4/5),  Omega_bar(0) = 1.326 tau^(1/5)      (48)
    PKN similarity, large leak-off:    gamma = (2/(pi C)) tau^(1/2), Omega_bar(0) = 2/(pi^(1/2) C^(1/4)) tau^(1/8)   (49)
    storage regime if C^(10/3) tau < about 1e-5 ; leak-off regime if C^(10/3) tau > about 1e3
    breakthrough time, storage:   tau_b = (K / (pi * 1.326))^5 = 0.797e-3 K^5 ,  for C^(2/3) K < about 0.66   (53)
    breakthrough time, leak-off:  tau_b = C^2 K^8 / (2^8 pi^4) ,                 for C^(2/3) K > about 8.5    (54)

- **Source inconsistency.** Section 4.1 prints gamma_m0 = 1.006; Appendix A prints 1.00063.
  In SI, l = gamma_m0 (E' Q0^3 t^4 / (4 pi^3 mu H^4))^(1/5), so 1.00063 gives the coefficient
  0.3816 that agrees with the PKN value 0.3817 in the sibling file; 1.006 gives 0.3836. Use
  1.00063 (computed for this note).
- Four simulations with height growth, K and C each 0 or 1, run to tau = 100 or lambda(0) = 5
  (Figs 9, 11, 13). The paper's finding: length and mean width stay close to PKN; height and
  pressure depend strongly on K. Values below are **digitised** from the curve vertices and
  interpolated in log(tau); uncertainty about 1 percent. Self-check: Pi(0) from Fig. 13 equals
  eq. 19 applied to lambda(0) from Fig. 11 to within 0.005 at every row.

| tau | C=0,K=0: gamma / lambda(0) / Pi(0) | C=0,K=1 | C=1,K=0 | C=1,K=1 |
|---|---|---|---|---|
| 0.01 | 0.0237 / 1.37 / 0.480 | 0.0248 / 1.06 / 0.515 | 0.0188 / 1.32 / 0.453 | 0.0196 / 1.04 / 0.482 |
| 0.1 | 0.136 / 2.05 / 0.674 | 0.146 / 1.33 / 0.732 | 0.0919 / 1.80 / 0.623 | 0.0959 / 1.22 / 0.672 |
| 0.3 | 0.305 / 2.79 / 0.766 | 0.329 / 1.64 / 0.832 | 0.186 / 2.26 / 0.706 | 0.194 / 1.41 / 0.762 |
| 1 | 0.711 / 4.41 / 0.853 | 0.774 / 2.31 / 0.924 | 0.387 / 3.14 / 0.792 | 0.403 / 1.77 / 0.854 |
| 3 | (stopped at tau 1.42, lambda 5.1) | 1.62 / 3.49 / 0.984 | 0.728 / 4.68 / 0.861 | 0.758 / 2.36 / 0.925 |

- Similarity solution with height growth: none usable. The paper finds one for C = K = 0 at
  large time (length tending to a constant, width proportional to time, t* its time scale) and
  calls it "a mathematical curiosity devoid of any physical interest" because it violates the
  assumption of mainly horizontal flow. Height against time must come from the curves above.
- Caveat stated by the paper: for K = 0 the fracture is never contained, so the PKN M-solution
  used to start the run is not the true early-time solution. Early K = 0 values depend on that
  start; the K = 1 curves do not have this problem (breakthrough at tau_b = 8.0e-4).
- Reference code: colP3D (MATLAB, fourth-order collocation), cited by the paper as
  http://hdl.handle.net/2429/19969 (reference 31 of the paper). The code was not opened or run.

### A.2 Dontsov and Peirce (2015): SI cases for the classical model, plus a planar-3D reference

Source: Eng. Fract. Mech. 142:116-139,
https://personal.math.ubc.ca/~peirce/Dontsov_and_Peirce_Engineering_Fracture_Mechanics_V142_p116_139_2015.pdf
(equations read from page images). Section 2 restates the classical model of A.1 (their
"original P3D", citing Adachi et al.), with no leak-off in the examples.

    w(x,z): identical to Adachi eq. 7                                                                (1)
    p = dsig [ 1 + sqrt(2/(pi H)) (K_Ic/dsig) sqrt(H/h) - (2/pi) asin(H/h) ]                       (2)
    wbar = (1/H) int w dz = (H/E') ( sqrt(pi/(2H)) K_Ic (h/H)^(3/2) + dsig sqrt(h^2/H^2 - 1) ) ,  h > H     (4, 5)
    d(wbar)/dt + d(qbar_x)/dx + C'/sqrt(t - t0(x)) = (Q0/H) delta(x)                                (6)
    qbar_x = -(1/(H mu')) dp/dx int w^3 dz ,   mu' = 12 mu ,  C' = 2 C_L                             (7)

Conventions: "Q0 is the total fluid volume pumped into the fracture per unit time" (both
wings, source at x = 0); h is full height; l is half-length; mu' = 12 mu here, plain mu in
Adachi, same physics.

What the paper adds (the enhanced model, EP3D): an apparent toughness for viscous height
growth, non-local elasticity, lateral toughness and a curved tip. Its reference is ILSA, a
planar-3D code. Stated outcome: classical P3D overestimates height when toughness is small
and overestimates length when toughness is large; EP3D stays within about 10 percent of ILSA
in the extreme cases.

**Laboratory-scale case (their Figs 2 and 8).** Inputs as printed: H = 0.05 m, mu = 30.2 Pa s,
nu = 0.4, E = 3.3 GPa, Q0 = 1.7 mm^3/s (1.7e-9 m^3/s, total), dsig = 4.3 MPa, no leak-off,
results at t = 604 s. The parameters (except toughness) come from the experiments of Jeffrey
and Bunger (2007), SPE 106030 (not opened). Fig. 8 plots height at the wellbore and
half-length against K_Ic for ILSA, EP3D and the original P3D. **Digitised** marker centres
(uncertainty about 1 mm):

| K_Ic (MPa m^0.5) | Original P3D: h (mm) | Original P3D: l (mm) | EP3D: h (mm) | EP3D: l (mm) |
|---|---|---|---|---|
| 0 | 127.5 | 132.7 | 88.5 | 134.8 |
| 0.16 | 99.5 | 135.1 | 82.7 | 135.9 |
| 0.39 | 76.8 | 143.1 | 73.3 | 136.3 |
| 0.47 | 71.6 | 146.5 | 69.7 | 133.5 |
| 0.55 | 67.3 | 149.8 | 66.9 | 129.7 |
| 0.78 | 57.2 | 158.6 | 62.5 | 113.8 |
| 0.94 | 53.0 | 162.0 | 61.6 | 102.0 |
| 1.10 | 50.8 | 163.0 | 62.0 | 91.4 |

The ILSA curve runs close to the EP3D markers (the paper's point). K_Ic values other than 0,
0.16, 0.47 and 0.94 are read from marker positions, not printed.

**Extreme field-scale case (their Fig. 10 and text).** H = 10 m, mu = 0.1 Pa s, nu = 0.2,
Q0 = 0.01 m^3/s, dsig = 0.25 MPa, E = 2 GPa. For K_Ic = 0 the text states: "the original P3D
model predicts a fracture half-length of 31.5 m and half-height of 293 m for t = 800 s". The
height far exceeds the length, so the model assumptions fail; it is a stated number, not a
sensible physical case. For K_Ic = 1.5 MPa m^0.5 the paper gives the runaway height from
Adachi's formula as about 14 m (eq. 21 gives K = 4.756, lambda_u = 1.414, h_u = 14.1 m,
computed for this note): one number confirmed by both papers.

Code: https://github.com/egordontsov/EP3D-HF-simulator (MATLAB/Octave, implements EP3D, not
the classical model). Default inputs in `EP3D_main.m`: K_Ic = 1 MPa m^0.5, H = 20 m,
dsig = 0.75 MPa, E = 9.5 GPa, nu = 0.2, C_l = 0.521/2 * 1e-2 mm/s^0.5, mu = 0.1 Pa s,
Q0 = 10 L/s (total; the code injects Q0/2 per wing), t from 20 s to 3600 s, 50 grid points.
The repository reports no result numbers for this case. Not run here.

### A.3 Best complete case: inputs in SI and expected outputs

The laboratory-scale case of A.2, classical model, no leak-off. Two independent sources agree
on it: Dontsov and Peirce Fig. 8 ("original P3D" markers) and Adachi et al. Figs 9 and 11
converted with the scales of A.1 (computed for this note).

    Inputs:  H = 0.05 m, dsig = 4.3 MPa, E = 3.3 GPa, nu = 0.4 (E' = 3.929 GPa), mu = 30.2 Pa s,
             Q0 = 1.7e-9 m^3/s total (0.85e-9 per wing), C_l = 0, t = 604 s
    Scales:  l* = 0.5391 m, t* = 2726 s, w* = 85.97 micron, tau = 604/2726 = 0.2216, C = 0

| K_Ic (MPa m^0.5) | K | Dontsov Fig. 8: l, h (mm) | Adachi curves at tau = 0.2216: l, h (mm) |
|---|---|---|---|
| 0 | 0 | 132.7, 127.5 | 132.1, 127.2 (gamma 0.245, lambda 2.544) |
| 0.39 (K = 1 is 0.384) | 1.02 | 143.1, 76.8 | 142.1, 77.2 (gamma 0.2635, lambda 1.544) |
| 0.94 | 2.45 | 162.0, 53.0 | not plotted; breakthrough at t_b = 192 s (eq. 53), PKN M length 161.6 mm |

- For K_Ic = 0 the wellbore values implied by eqs 7, 8 and 23 at lambda = 2.544 are net
  pressure 3.19 MPa, mid-height width 110.5 micron, mean width 128 micron (computed for this
  note). Dontsov Fig. 2 shows about 3.2 MPa and about 110 micron for the classical model
  (read by eye).
- A suggested tolerance is 2 percent on l and h. Mind the K = 0 start-up caveat in A.1.
- The classical-P3D numbers are the implementation check. The ILSA and EP3D numbers measure
  model error: at K_Ic = 0 the planar-3D height is about 89 mm against 127 mm, so a correct
  classical P3D code must not match them.

### A.4 Other sources asked about

- Simonson, Abou-Sayed and Clifton (1978), SPE J. 18(1):27-32, doi 10.2118/6089-PA: paywalled,
  **not opened**. Its height relation is given above as printed by Adachi et al. (eq. 8) and
  Dontsov and Peirce (eq. 2). Adachi et al. state that it mentions unstable growth but gives
  no criterion.
- PyFrac, GEOS, ResFrac: no three-layer case with a reported length and height history for
  growing height was found. PyFrac has `Ex2_height_contained_CPC.py` (barriers hold) and
  `Experiment_Wu_et_al.py` (lab block test, same material as A.3); see the sibling file, 6.6.
  GEOS has `inputFiles/hydraulicFracturing/heterogeneousInSitu_*.xml`
  (https://github.com/GEOS-DEV/GEOS/tree/develop/inputFiles/hydraulicFracturing) with no
  reference history found: NOT CONFIRMED.

## B. Stress interaction between parallel fractures

### B.1 Closed forms on the line through the crack centre, normal to the crack plane

Stress component: the change in normal stress acting perpendicular to the crack plane (the
component that adds to the closure stress of a parallel neighbour). Sign: compression
positive, so the factor Phi = d_sigma / p_net is between 0 and 1 and equals 1 at the crack
face. p_net is uniform net pressure. d is the perpendicular distance.

    Plane strain (infinitely long crack of height h):
        Phi = 1 - (2d/h)^3 / [ 1 + (2d/h)^2 ]^(3/2)
    Penny-shaped crack of diameter 2a (set 2a = h to compare):
        Phi = (2/pi) [ atan(a/d) - a d (d^2 - a^2) / (d^2 + a^2)^2 ]
        far field: Phi -> (16/(3 pi)) (a/d)^3

| d/h | 0.1 | 0.25 | 0.5 | 1 | 1.5 | 2 | 3 |
|---|---|---|---|---|---|---|---|
| Plane strain, mid-height line | 0.993 | 0.911 | 0.646 | 0.284 | 0.146 | 0.087 | 0.040 |
| Plane strain, average over the neighbour's height | 0.766 | 0.612 | 0.431 | 0.223 | 0.127 | 0.080 | 0.039 |
| Penny-shaped, axis | 0.987 | 0.858 | 0.500 | 0.142 | 0.052 | 0.024 | 0.0075 |

Sources and status:

- Plane strain. US patent 11,280,165 (Roussel, ConocoPhillips), EQU. 2, credits Sneddon (1946)
  and Sneddon and Elliott (1946) and prints Phi = 1 - (s_f/h_f)^3 [1 + (s_f/h_f)^2]^(-3/2),
  with h_f the fracture half-height and s_f the distance "on a line perpendicular to a dilated
  fracture and going through its center". https://patents.google.com/patent/US11280165B2/en
  With h = 2 h_f this is the form above. Checked for this note against the Westergaard stress
  function at seven distances (agreement to 4 digits).
- Full plane-strain field. US patent 10,544,667 (Wu, Kresse, Weng, Cohen, Gu; the UFM
  authors), eq. 6, credited to Warpinski and Teufel (1987):
  sigma_x = p [ 1 - (L / sqrt(L1 L2)) cos(theta - (theta1 + theta2)/2)
  - (L / (L1 L2)^(3/2)) sin(theta) sin( (3/2)(theta1 + theta2) ) ], lengths normalised by h/2,
  L, L1, L2 the distances from the crack centre and the two tips, theta, theta1, theta2 the
  matching angles. https://patents.google.com/patent/US10544667B2/en . The page text is
  machine-extracted; the square root in the first term and the angle branches are my reading.
  With angles measured from the crack line it reduces on the centre normal to the closed form
  above (computed for this note).
- Penny-shaped. The same Roussel patent, EQU. 3, prints the two terms above, but the extracted
  text is garbled in sign and grouping, so the patent's exact form is NOT CONFIRMED. The form
  above was checked for this note by integrating the displacement-discontinuity kernel over
  the elliptical opening of a pressurised circular crack (agreement to 4 digits).
- Sneddon (1946, Proc. R. Soc. A 187:229) and Sneddon and Elliott (1946, Q. Appl. Math.
  4:262): both refused automated download (HTTP 403). The originals are **not opened**.
- The height-average row is computed for this note from the Westergaard field; it has no
  source. The UFM patent says an average over the fracture height "may be used".

### B.2 How simplified multi-fracture models apply it

- **Added to closure stress.** UFM (patent text, same authors as Kresse et al. 2013): "the
  original in-situ stresses at each fracture element may be modified by adding the additional
  normal stress due to the stress shadow effect". For parallel fractures with a PKN-type
  model: "The increase in closure stress may be approximated by averaging the computed stress
  from Eq. 6 over the entire fracture." https://patents.google.com/patent/US10544667B2/en
- **Olson's finite-height correction** (same patent, eqs 8 and 9). Stresses on element i come
  from 2-D plane-strain displacement-discontinuity coefficients C_ij (Crouch and Starfield),
  each multiplied by

      A_ij = 1 - d_ij^beta / [ d_ij^2 + (h/alpha)^2 ]^(beta/2)

  with h the fracture height, d_ij the distance between elements i and j, and alpha, beta
  "fitting parameters" calibrated against the plane-strain solution of B.1. The patent prints
  no values and Olson (2004, Geol. Soc. Spec. Publ. 231:73-87) was not opened: constants
  **NOT CONFIRMED**. (Recalled by the author of this note, no source opened: alpha = 1,
  beta = 2.3. Do not use without the paper.) Note the role: A_ij scales each element-pair
  coefficient in a boundary-element sum. It has the shape of the B.1 formula but is not a
  stand-in for it.
- Kresse, Weng, Gu and Wu (2013), Rock Mech. Rock Eng. 46:555: only the abstract could be
  opened ("enhanced 2D displacement discontinuity method with correction for finite fracture
  height"). https://link.springer.com/article/10.1007/s00603-012-0359-2
- **Wu and Olson (2015) simplified 3-D kernel**, as described by Nikolskiy and Lecampion (ARMA
  2019): a kernel from the full 3-D rectangular displacement-discontinuity solution with
  correction factors for fracture height, stresses taken in the horizontal mid-plane; "about
  10-15% difference compared to a full 3D scheme" when spacing is below 0.25 of the height.
  https://infoscience.epfl.ch/record/267525/files/ARMA2019-1617-Nikolskiy-etal-final.pdf
  The Wu and Olson papers (SPE J. 20:337; Int. J. Fract. 193:191), Olson (2008, ARMA) and
  Cheng (2012) are paywalled: **not opened**, formulas NOT CONFIRMED.
- **Elliptic displacement discontinuity (EDDM)**, Protasov, Peirce and Dontsov (ARMA 2018):
  constant-height fractures, each element has an elliptic opening over the height, so no
  correction factor is needed. Test: five fractures, E = 20 GPa, nu = 0.2,
  K_Ic = 1.6 MPa m^0.5, mu = 3e-3 Pa s, Q0 = 0.03 m^3/s, height 20 m, spacing 5 to 30 m,
  compared with ILSA at t = 351 s. Result: agreement when spacing exceeds the height; a
  discrepancy with zero perforation friction once spacing is comparable to or below the
  height. https://personal.math.ubc.ca/~peirce/ARMA_paper_2018_Protasov_Peirce_Dontsov.pdf
- **Sequential stages** (Roussel patent, EQU. 4 and 5): shadow after n stages
  d_sigma(n+1) = Phi [ sigma_load + d_sigma(n) ], plateau Phi sigma_load / (1 - Phi).
- Dontsov's multi-fracture comparison (arXiv:2110.13347, sibling file 6.5) finds "almost no
  interaction" at a spacing of twice the height; B.1 gives Phi = 0.087 there.

## C. Perforation friction and limited entry

    SI (consistent units):  dp = 8 rho Q^2 / (pi^2 N^2 d^4 C_d^2) = 0.8106 rho Q^2 / (N^2 d^4 C_d^2)
        Q total rate through the cluster (m^3/s), rho (kg/m^3), N perforations, d diameter (m)
    Field units:            dp = 0.2369 rho Q^2 / (N^2 d^4 C_d^2)
        dp (psi), Q (bbl/min), rho (lbm/gal), d (in)

- Field form with 0.2369 and these units: Wu et al. (2022), Processes 10:1058, eq. 1, open
  access, https://doi.org/10.3390/pr10061058 . It credits the form to Bernoulli's equation and
  gives C_d as "0.56-0.90 during the fracturing process".
- **Sources disagree in the third digit.** The orifice equation dp = rho v^2 / (2 C_d^2) gives
  8/pi^2 = 0.8106 in SI, which converts to 0.2376 in field units (computed for this note).
  The quoted 0.2369 converts back to 0.8081 in SI. ResFrac prints 0.808 in consistent units
  (writeup eq. 6-2, credited to Cramer 1987, https://arxiv.org/abs/1804.02092). Nikolskiy and
  Lecampion print f_p = 0.807249 rho / (n_p^2 D_p^2 C^2), credited to Crump and Conway (1988);
  the exponent 2 on D_p is a misprint for 4 on dimensional grounds (URL in B.2). The spread is
  0.4 percent, far below the uncertainty in C_d. Pick one and state it.
- Discharge coefficient. Before erosion about 0.56, after about 0.89: "the discharge
  coefficient increased from 0.56 to 0.89 with the passage of approximately 2000 lbm of
  proppant through the perforation" (Romero 2000 fit of Crump and Conway data, as reported by
  Wu et al. 2022; originals not opened). Nikolskiy and Lecampion: "typically between 0.5 and
  0.9". ResFrac uses the Long and Xu (2017) erosion model: C_d rises quickly to a limit, then
  the diameter grows slowly (formula not opened).
- Near-wellbore tortuosity. ResFrac eq. 6-3: dp_nw = A_nw Q^alpha_nw (credited to Wright 2000),
  coefficients from a step-down test. Nikolskiy and Lecampion eq. 6: p_w - p_in = f_p Q^2
  + f_t Q^beta. No standard exponent is printed in either source; the common choice of 0.5 is
  NOT CONFIRMED.
- Cramer (1987, SPE 16189) and Crump and Conway (1988, SPE 15474): paywalled, **not opened**.

## D. Gas-liquid flow in tubing

No primary paper could be opened (Zuber and Findlay 1965, Harmathy 1960, Nicklin 1962, Hasan
and Kabir 1988 and 2010 are paywalled). Everything here is from secondary sources that
reproduce them; each is named.

**Recommended first model: drift flux with two regimes**

    v_g = C0 v_m + v_d ,   v_m = v_sg + v_sl               (gas velocity; mixture superficial velocity)
    alpha_g = v_sg / (C0 v_m + v_d) ,   H_L = 1 - alpha_g
    rho_m = alpha_g rho_g + (1 - alpha_g) rho_l
    C0 = 1.2 in bubbly and slug flow
    bubbly:  v_d = 1.53 [ g sigma (rho_l - rho_g) / rho_l^2 ]^(1/4)                    (Harmathy)
    slug:    v_d = 0.35 sqrt( g D (rho_l - rho_g)/rho_l ) sqrt(sin th) (1 + cos th)^1.2   (Taylor bubble)
    bubbly if v_sg < sin(th) (C0 v_sl + v_d,bubbly) / (4 - C0), i.e. gas fraction below 0.25; else slug
    dp/dz = rho_m g sin(th) + f rho_m v_m^2 / (2 D)   (acceleration neglected)

- Relation and holdup: Choi et al. (2012), Energies 5:5294, eqs 1 and 2 and Table 3, open
  access, https://mdpi-res.com/d_attachment/energies/energies-05-05294/article_deploy/energies-05-05294.pdf
- Constants, transition and pressure gradient: Bikbulatov, Khasanov and Zagurenko,
  arXiv:physics/0504083, eqs 2 to 6 and 10 (a restatement of the Hasan-Kabir model),
  https://arxiv.org/abs/physics/0504083 . It also gives C0 = 2.0 when D > 0.12 m and
  v_sl < 0.02 m/s, friction factor from the Moody diagram with Reynolds number
  rho_l v_m D / mu_l, and says acceleration "can be neglected during all but the annular-flow
  pattern".
- Angle: th is from horizontal in the form above (my reading; the factor is 1 for a vertical
  well). The same correlation written from vertical, 0.35 sqrt(cos th)(1 + sin th)^1.2
  sqrt(g D): Liu et al. (2021), Energies 14:578, eq. 7,
  https://psecommunity.org/wp-content/plugins/wpor/includes/file/2304/LAPSE-2023.34462-1v1.pdf
- Other regimes, from open-source code only (MOSKITO, `MoskitoDFHK`): C0 = 1.15 churn, 1.0
  annular with v_d = 0, 1.12 downflow; annular when v_sg exceeds
  3.1 [g sigma (rho_l - rho_g)/rho_g^2]^(1/4); error raised beyond 45 degrees from vertical.
  Constants in https://github.com/MGK-Lab/moskito/blob/master/include/userobjects/MoskitoDFHK.h ,
  criteria in https://github.com/MGK-Lab/moskito/blob/master/src/userobjects/MoskitoDFHK.C .
  Not confirmed against Hasan, Kabir and Sayarpour (2010).
- Disagreement: the density ratio (rho_l - rho_g)/rho_l inside the Taylor-bubble term is
  present in the arXiv paper and MOSKITO and absent in Liu et al. and in the code below.
- Hagedorn-Brown needs chart-based holdup and cannot be given compactly: not reproduced.
  Beggs-Brill constants were found only in code (CalebBell/fluids `two_phase.py`): not
  reproduced here.

**Check case.** No published worked example with inputs and a resulting pressure gradient or
bottom-hole pressure could be opened for a drift-flux tubing model: NOT CONFIRMED. The arXiv
paper compares calculated and measured pump-intake pressure for 85 wells only as a cross-plot
(its Fig. 3), with no per-well inputs. The best open check is a code doctest:
`Nicklin_Wilkes_Davidson(0.4, 800., 2.5, m=1, D=0.3)` returns 0.6798826626721 in
https://github.com/CalebBell/fluids/blob/master/fluids/two_phase_voidage.py (quality 0.4,
rho_l 800, rho_g 2.5 kg/m^3, 1 kg/s, D 0.3 m, vertical; code uses C0 = 1.2 and
v_d = 0.35 sqrt(g D)). Reproduced for this note: v_sg = 2.26354, v_sl = 0.010610,
v_m = 2.27415, v_d = 0.600329 m/s, alpha_g = 0.679883. It checks only the gas-fraction
relation with the slug constants and no density ratio; it does not check Harmathy, the regime
switch or a pressure gradient.

## E. Bottom line (judgement)

- **Best outside check for the growing-height case.** Run the A.3 case: the laboratory-scale
  inputs of Dontsov and Peirce (2015), no leak-off, t = 604 s. Expected with zero barrier
  toughness: half-length 132 to 133 mm and wellbore height 127 mm. With K_Ic = 0.384 MPa m^0.5
  (K = 1): 142 mm and 77 mm. Two papers, two codes, agreement within 1 percent. Then sweep
  time against the Adachi table in A.1 for K = 1 with C = 0 and C = 1; this also exercises
  leak-off and has no start-up caveat. Before the transient runs, test the static pieces
  exactly: eq. 8 or 19 for height, eq. 23 for mean width, eq. 21 for runaway (h_u = 14.1 m for
  the A.2 extreme case), eq. 53 for breakthrough time.
- **What the check does not show.** It confirms the code solves the classical model. The same
  paper shows that model overestimates height by about 40 percent in the zero-toughness
  laboratory case against planar 3-D results.
- **Simplest sourced stress interaction for a P3D model.** Add to each fracture's closure
  stress the sum over neighbours of Phi(d/h) times the neighbour's net pressure, using the
  plane-strain form in B.1 with the neighbour's local height and net pressure at the same
  position along the length. This is the approach the UFM authors describe for a PKN-type
  model ("the stress shadow can be represented by the superposition of stresses from
  neighboring fractures"). Unsourced approximation to flag: B.1 assumes one uniform net
  pressure over the whole height, but a section that has grown into the barriers carries p in
  the pay and p - dsig outside. Use the uniform pressure that gives the same section area,
  p_eq = 2 E' H wbar / (pi h^2) (my choice, not from a source). The height-average row in B.1
  assumes an aligned neighbour of equal height. Other limits: it ignores finite length (near
  the tips the true shadow is smaller), and at spacing below about one height the sourced
  comparisons show simplified kernels losing accuracy. If a boundary-element sum is added later, use Olson's A_ij factor or the elliptic
  element of Protasov et al. Pair the interaction with perforation friction (section C),
  because the two together set the flow split between clusters.

## Unconfirmed or disagreeing

Each item is marked where it appears: search this file for "NOT CONFIRMED", "not opened",
"inconsistency" and "disagree".
