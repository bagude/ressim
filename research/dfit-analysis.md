# DFIT (minifrac) analysis: sourced formulas, conventions, worked examples

Date of research: 2026-11-10. Purpose: formulas for a synthetic-DFIT simulator test and for checking the standard analysis against known inputs.

## How to read this file

Each item has one of these labels:

- **PRINTED**: read by me in the source (equation image or page image), with URL and equation/page.
- **DERIVED**: my algebra from PRINTED equations. The source equations are named. Not printed in that form anywhere I read.
- **NOT CONFIRMED**: recalled from memory, not read in an opened source. Do not use as a test oracle without a check.
- **not opened**: a source that I could not read (paywall or no open copy found).

## Sources

| Tag | Source | URL | Status |
|---|---|---|---|
| WS | Wang and Sharma, "New Variable Compliance Method for Estimating Closure Stress and Fracture Compliance from DFIT data", arXiv 1710.06464 | https://arxiv.org/pdf/1710.06464 | opened, pages 2-3 read as images |
| MC19 | McClure et al. 2019, "A Collaborative Study on DFIT Interpretation", URTeC-2019-123 (39 pages) | https://www.resfrac.com/wp-content/uploads/2024/06/McClure-2019-A-Collaborative-Study-on-DFIT-Interpretation.pdf | opened; Sections 2.2, 3.1 read as text; pages 30, 31, 35, 37, 38 read as images |
| IHS-PRE | S&P Global / IHS WellTest help, "Minifrac Pre-Closure Analysis" (WellTest 2024.1) | https://www.ihsenergy.ca/support/documentation_ca/WellTest/content/html_files/analysis_types/minifrac_test_analyses/minifrac-pre-closure_analysis.htm | opened; equation images equation216.svg to equation227.svg read |
| IHS-ACA | Same help, "Minifrac After-Closure Analysis" | https://www.ihsenergy.ca/support/documentation_ca/WellTest/content/html_files/analysis_types/minifrac_test_analyses/minifrac-after-closure_analysis.htm | opened; equation228.svg to equation251.svg read |
| FEK | Fekete, "Mini-Frac Analysis for Unconventional Reservoirs using F.A.S.T. WellTest", 16 Aug 2013 (44 slides) | https://www.petroleumengineers.ru/sites/default/files/mini-frac_analysis_for_unconventional_reservoirs_using_fast_welltest_16-aug-2013.pdf | opened; slide text read (plot annotations), equation images on slides NOT read |
| CRA | D. Cramer, "Characterizing Mechanical and Flow Properties using Injection Falloff Tests", EPA Hydraulic Fracturing Technical Workshop #3 (24 slides) | https://19january2017snapshot.epa.gov/sites/production/files/documents/characterizingmechanicalandflowpropertiesusinginjectionfallofftests.pdf | opened; slides 15, 21, 22 read as images; slides 17, 19 read as text |
| RF-BLOG | McClure, "Demystifying the G-function" (ResFrac blog, 2017) | https://www.resfrac.com/blog/demystifying-g-function | opened (text only, equations are images, not read) |
| - | Barree, Barree and Craig 2009, "Holistic Fracture Diagnostics", SPE 107877 | https://oa.mg/work/10.2118/107877-pa | **not opened** (used only through CRA slide 15 and IHS, which cite it) |
| - | Nolte 1979 (SPE 8341); Nolte, Maniere and Owens 1997 (SPE 38676); Talley et al. 1999; Soliman et al. 2005 (ARMA 05-658); McClure et al. 2016 SPE J "fracture-compliance method"; Economides and Nolte, Reservoir Stimulation ch. 9 | - | **not opened** |

IHS equation images are at `https://www.ihsenergy.ca/support/documentation_ca/WellTest/content/generatedimages/equations/equationNNN.svg`.

---

## 1. Before closure (Nolte G-function)

### 1.1 Dimensionless shut-in time, g and G

PRINTED (IHS-PRE, equation220, 217, 218, 219, 221, 222):

```
dtD = (t - tp) / tp                                            (t = total time, tp = pumping time)
G(dtD) = (4/pi) * ( g(dtD) - g0 )
g(dtD) = (4/3) * ( (1 + dtD)^1.5 - dtD^1.5 )                    for alpha = 1
g(dtD) = (1 + dtD) * asin( (1 + dtD)^-0.5 ) + dtD^0.5           for alpha = 0.5
g0 = 4/3   for alpha = 1
g0 = pi/2  for alpha = 0.5
```

PRINTED (WS, p. 3, Eq. 3-5): the same definitions with `te` for the time at the end of pumping. WS Eq. 5 labels the asin form "for low fluid efficiency" and the 4/3 form "for high fluid efficiency".

PRINTED (IHS-PRE, text): "The equation for alpha = 1.0 is for low leakoff, or high efficiency where the fracture area open after shut-in varies approximately linearly with time"; alpha = 0.5 "is for high leakoff, or low efficiency fluids". The same text is in FEK slide 14 ("alpha = 1.0 is for low leak-off; alpha = 0.5 is for high leak-off").

So: **alpha = 1 = upper bound = high efficiency (low leak-off); alpha = 1/2 = lower bound = low efficiency (high leak-off).**

PRINTED (MC19, p. 30, Eq. 16): "The most common form of the g-function is g(dt) = (4/3)[(1 + dt/te)^1.5 - (dt/te)^1.5]". MC19 p. 30 also says g0 "is a number in the narrow range between 4/3 and pi/2 (Equation 30 of the appendix from Gulrajani and Nolte, 2001)".

DERIVED (general alpha; consistent with both printed closed forms): if area grows as a/A = (tau/tp)^alpha and each element leaks with Carter's law from its exposure time tau,

```
g(dtD; alpha) = 2 * integral_0^1 sqrt( 1 + dtD - xi^(1/alpha) ) d xi
```

Check: alpha = 1 gives (4/3)[(1+dtD)^1.5 - dtD^1.5]; alpha = 1/2 gives (1+dtD) asin((1+dtD)^-0.5) + dtD^0.5. Use this integral (or the simulator's real exposure times) when the simulated area growth is not exactly one of the two bounds.

Late-time behaviour, DERIVED from the alpha = 1 form: g ~ 2 sqrt(dtD) for dtD >> 1, so G ~ (4/pi)(2 sqrt(dtD) - 4/3). RF-BLOG text: "Except at early time, the G-function is approximately proportional to the square root of shut-in time."

### 1.2 Leak-off volumes and the area convention

PRINTED (MC19, p. 30, Eq. 13 and 15; p. 31, Eq. 18):

```
V_L(dt)  = 2 * A * C_L * sqrt(te) * g(dt)                         (13) cumulative leak-off from start of injection
V_Ls(dt) = 2 A C_L sqrt(te) (g(dt) - g(0)) = (pi/2) A C_L sqrt(te) G(dt)   (15) leak-off after shut-in
V_Ls     = 4 A sqrt(dt) (P - Pres) sqrt(phi ct k / (pi mu)) = 4 A C_L sqrt(dt)    (18) instantaneous fracture, 1D constant-pressure solution
C_L      = (P - Pres) * sqrt( phi * ct * k / (pi * mu) )           (19)
```

PRINTED (MC19 nomenclature, p. 27): "A: fracture surface area; does not count both sides of the fracture - ie, defined so that a fracture with sides of length 1 ft has area of 1 ft^2"; "CL: leakoff coefficient (ft/min^0.5; m/s^0.5)"; "Lf: fracture length"; "te: duration of injection (min; s)".

Convention (printed definition of A above; the rest DERIVED from Eq. 18 and from Eq. 37-38 below): **A is the area of ONE face of the whole fracture** (both wings together). C_L is per face: velocity through one face is C_L / sqrt(t - tau), so the rate per unit fracture area through both faces is 2 C_L / sqrt(t - tau), and the cumulative volume is 4 A C_L sqrt(dt). For the radial case A = pi R^2. For PKN the printed Eq. 38 is consistent only with A = L_f * h_f, so L_f in MC19 is the full tip-to-tip length (if you use half-length x_f, A = 2 x_f h_f).

### 1.3 Pressure decline and the leak-off coefficient

PRINTED (WS, p. 2, Eq. 1 and Table 1, Eq. 2):

```
P_f(dtD) = ISIP - ( pi * r_p * C_L * S_f * sqrt(tp) / 2 ) * G(dtD)       (1)

Fracture stiffness S_f (Table 1):   PKN: 2 E' / (pi h_f)     KGD: E' / (pi x_f)     Radial: 3 pi E' / (16 R_f)
E' = E / (1 - nu^2)                                                      (2)
```

WS definitions (p. 2): tp total pumping time; r_p "productive fracture ratio, which is the ratio of fracture surface area that is subject to leak-off to the total fracture surface area"; C_L Carter leak-off coefficient; S_f fracture stiffness, the reciprocal of fracture compliance. Stated assumptions: power-law fracture growth, negligible spurt loss, constant fracture surface area after shut-in, Carter leak-off, S_f constant until closure.

Compliance (DERIVED as 1/S_f): c_f = pi h_f / (2 E') for PKN; pi x_f / E' for KGD; 16 R_f / (3 pi E') for radial. Mean width = c_f * (p - p_c). The modulus is the plane-strain modulus E'. The length scale is the height h_f for PKN, the half-length x_f for KGD, the radius R_f for radial.

Ratio of permeable to total height: in WS it enters as r_p (an area ratio). For a constant-height fracture with leak-off only over the permeable height h_p, r_p = h_p / h_f. (NOT CONFIRMED as printed; this is the usual Nolte definition.)

Slope and leak-off coefficient (DERIVED from WS Eq. 1 + Table 1; any consistent units):

```
PKN:     -dP/dG = r_p * C_L * E' * sqrt(tp) / h_f              C_L = (-dP/dG) * h_f / ( r_p * E' * sqrt(tp) )
KGD:     -dP/dG = r_p * C_L * E' * sqrt(tp) / (2 x_f)          C_L = (-dP/dG) * 2 x_f / ( r_p * E' * sqrt(tp) )
Radial:  -dP/dG = 3 pi^2 r_p C_L E' sqrt(tp) / (32 R_f)        C_L = (-dP/dG) * 32 R_f / ( 3 pi^2 r_p E' sqrt(tp) )
```

Units: with dP/dG in psi, E' in psi, lengths in ft, tp in min, C_L is in ft/min^0.5 (per face). With Pa, m, s, C_L is in m/s^0.5.

PRINTED alternative with wellbore storage (MC19, p. 31 Eq. 17; p. 35 Eq. 37-39). This is the second convention; it reduces to the forms above when C_w = 0 and r_p = 1:

```
dP/dG = (1/C_t) * dV/dG = constant                                    (17)   C_t = total system storage

C_L(radial) = -(dP/dG) * ( C_w + 16 R_f^3 / (3 E') ) / ( (pi^2/2) R_f^2 sqrt(te) )          (37)
C_L(PKN)    = -(dP/dG) * ( 2 C_w / pi + L_f h_f^2 / E' ) / ( L_f h_f sqrt(te) )             (38)

V_inj = C_w ( P(dt) - P_w,init ) + (A / S_f) ( P(dt) - Shmin ) + 2 A C_L sqrt(te) g(dt)     (39)
```

C_w is the wellbore storage coefficient (bbl/psi; m^3/MPa in the MC19 nomenclature). Eq. 39 is the mass balance used to get R_f or L_f. The same balance is printed in IHS-PRE equation225, with sqrt(tp) in place of sqrt(te). MC19 recommends dP/dG at its minimum and Eq. 39 at the effective ISIP.

NOT CONFIRMED (recalled, classic Nolte form): p* = dP/dG slope = pi r_p C_L sqrt(tp) / (2 c_f) with c_f = pi beta_s h_f / (2 E') for PKN and pi beta_s x_f / E' for KGD, and beta_s = (2n+2)/(2n+3+a) for PKN, about 0.9 for KGD. (I do not give the recalled radial form: I could not make it agree with the printed WS stiffness 3 pi E'/(16 R_f); use the WS value.) The beta_s factor (ratio of average net pressure to wellbore net pressure at shut-in) is the main difference between the Nolte convention and the uniform-pressure stiffness convention of WS and MC19. A simulator with uniform pressure in the fracture after shut-in should use beta_s = 1.

### 1.4 Efficiency, ISIP, closure, net pressure

PRINTED:

- Efficiency: `eta = G_c / (2 + G_c)` (IHS-PRE equation216; CRA slide 17; MC19 p. 38 Eq. 55, cited there as "Equation 9-60 from Gulrajani and Nolte, 2001"). G_c is G at closure.
- Efficiency definition: "the ratio of the stored volume within the fracture to the total fluid injected" (IHS-PRE; FEK slide 13). MC19 p. 38: volume remaining in the fracture at shut-in divided by volume injected into the fracture (total injected minus wellbore storage).
- MC19 Eq. 56 (mass-balance alternative): `eta = [ V_inj - C_w (P - P_w,init) - V_L(dt=0) ] / [ V_inj - C_w (P - P_w,init) ]`.
- ISIP: "ISIP = Final injection pressure - Pressure drop due to friction in the wellbore, perforations or slotted liner and tortuosity" (IHS-PRE). From a closure pick with normal leak-off: `ISIP = p_c + G_c * (dp/dG)` (IHS-PRE equation227, dp/dG taken as a positive number).
- Effective ISIP (MC19, Sec. 2.2 step 5 and Sec. 3.1.1): find the minimum dP/dG before contact and extrapolate the pressure-versus-G line back to G = 0.
- Closure pressure: equal to the minimum in-situ stress in the conventional reading (IHS-PRE). MC19 Sec. 1.3 says the term has several inconsistent definitions and defines "contact pressure" in its place.
- Net pressure: `dp_net = ISIP - Closure Pressure` (IHS-PRE; FEK slide 13).
- Gradients: ISIP gradient = ISIP / depth; closure gradient = closure pressure / depth (IHS-PRE).

DERIVED (from MC19 Eq. 13 and 15, with all fracture fluid leaked off at closure): `eta = G_c / ( G_c + 4 g0 / pi )`. With g0 = pi/2 (alpha = 1/2) this is exactly G_c / (2 + G_c). With g0 = 4/3 (alpha = 1) it is G_c / (G_c + 1.698). So the printed "2" is exact only for the alpha = 1/2 bound. A kappa-type printed form was not found in the opened sources.

### 1.5 G dP/dG diagnostic (Barree; Barree, Barree and Craig)

Source for this subsection: IHS-PRE page text, section "Fluid Leakoff Types" (read directly), and FEK slides 16-27. Both follow Barree; SPE 107877 itself was not opened. The tip-extension line is from a fetch summary of IHS-PRE plus FEK slide text, not a direct read of the full paragraph.

- Normal leak-off: fracture area is constant during shut-in and leak-off is through a homogeneous matrix. Pressure is linear in G, dP/dG is constant, and G dP/dG lies on a straight line through the origin. Closure is picked where G dP/dG departs (falls below) that line; this is the "tangent line method" (WS p. 3: "closure is picked at the tangential point between a straight line that passes the origin and the GdP/dG curve").
- Pressure-dependent leak-off (PDL): a "hump" in G dP/dG above the straight line through the normal leak-off data; the end of the hump is the "fissure opening pressure"; after it, normal leak-off.
- Height recession: G dP/dG falls below the straight line extrapolated through the normal leak-off data and is concave up; dP/dG is also concave up (leak-off area decreases as the fracture closes in impermeable layers).
- Tip extension: the fracture continues to grow after shut-in; G dP/dG lies on a straight line that extrapolates to a positive intercept on the y-axis (not through the origin), with concave-down curvature.
- Transverse storage (same signature as height recession): a secondary fracture network gives pressure support; G dP/dG below the line, concave up.

Criticism (McClure and co-authors) and their alternative pick:

- WS p. 3 (summary of McClure et al. 2016): a fully coupled simulator showed that the tangent line method "can severely underestimate closure pressure"; the "compliance method" picks closure "at the point where the fracture stiffness starts to increase".
- MC19 Sec. 3.1.3: the tangent technique "does not have theoretical or mathematical justification"; the tangent point is near the peak of G dP/dG, which occurs at the peak of t dP/dt and marks the transition from Carter leak-off to late-time impulse flow, not a stress.
- MC19 Sec. 3.1.2, the alternative pick: "The contact pressure occurs when dP/dG begins to increase from its minimum value. A rule of thumb is to pick the contact pressure when there has been a 10% increase from the minimum." Then "subtracting approximately 75 psi from the contact pressure is a good rule-of-thumb" for Shmin. A relative stiffness plot is the second tool.
- In MC19 the concave-up G dP/dG that Barree calls height recession or transverse storage is read as the stiffening of the fracture after wall contact.
- WS (the paper itself) says in turn that the compliance pick can be above the minimum stress, because closure on asperities is progressive.

---

## 2. After closure

Primary papers (Nolte 1997, Talley 1999, Soliman 2005, Barree 2009) were **not opened**. The formulas below are from the software help (IHS-ACA), the Cramer EPA slides (CRA) and MC19, which cite them.

### 2.1 Time functions

PRINTED (CRA slide 21):

```
F_L = (2/pi) * asin( sqrt( tc / t ) )      for t >= tc
t  = total test time (including injection time)
tc = time to fracture closure (including injection time)
"linear flow time function squared" = F_L^2 ; "In gas reservoirs, the pseudo-time function (ta) is used to adjust time."
```

PRINTED, different time origin (MC19, p. 37, Eq. 52 and 54; attributed there to Gulrajani and Nolte 2000):

```
F_L = (2/pi) * asin( sqrt( tc / dt ) )     (52)   "where tc is the shut-in time to 'closure.' F_L is only defined for dt >= tc"
F_L ~ (2/pi) * sqrt( tc / dt )             (54)   within 11% at dt = 2 tc, within 2% at dt = 10 tc
```

**Two conventions:** CRA measures t and tc from the start of injection; MC19 measures both from shut-in. State which one the simulator test uses.

PRINTED (IHS time-function reference pages, WellTest 2024.1; equation631, 632, 633):

- https://www.ihsenergy.ca/support/documentation_ca/WellTest/content/html_files/reference_materials/time_functions/minifrac_nolte_aca_linear_time.htm
- https://www.ihsenergy.ca/support/documentation_ca/WellTest/content/html_files/reference_materials/time_functions/minifrac_nolte_aca_radial_times.htm

```
F_L1 = (2/pi) * asin( tc / t )                                                   (equation631, printed WITHOUT a square root)
F_L2 = sqrt( 1 + (t - tc) / ( (16/pi^2) tc ) ) - sqrt( (t - tc) / ( (16/pi^2) tc ) )    (equation632)
F_R1 = (1/4) * ln[ 1 + (16/pi^2) * tc / (t - tc) ]                               (equation633)
```

So the constant is **chi = 16/pi^2 = 1.621**, printed as the fraction 16/pi^2 (the symbol chi is not used on the page). The page text: "FL1 is an approximation of FL2 and the two time functions converge quickly"; both are 1.0 at closure and 0.0 at infinite shut-in time; "FR1 is the time function described in Minifrac Reference 1" (Barree et al., SPE 107877). The time origin of t and tc is not stated on these pages.

Conflict to note: IHS equation631 prints asin(tc/t); CRA slide 21 and MC19 Eq. 52 print asin(sqrt(tc/t)). The square-root form is the one that equals 1 at t = tc and that F_L2 approximates (check at t = 2 tc: F_L2 = 0.486; (2/pi) asin(sqrt(1/2)) = 0.500; (2/pi) asin(1/2) = 0.333). The IHS equation631 is probably a typo; use the square-root form. (The numbers in this check are my arithmetic.)

Late-time limits (DERIVED): F_R1 -> (4/pi^2) tc / (t - tc); F_L^2 -> (4/pi^2) tc / t. So p versus F_L^2 and p versus F_R1 have the same late-time slope.

PRINTED (CRA slide 22), simpler radial function used on the Cartesian radial plot: `F_R = 1 / (t or ta, hr)`, "t = injection time + shut-in time".

PRINTED (MC19 p. 37-38): pressure versus F_L is equivalent to pressure versus reciprocal square root of time; pressure versus F_L^2 is equivalent to pressure versus reciprocal time. "kh is estimated from impulse radial flow using a plot of pressure versus F_L^2". F_L assumes Carter leak-off until closure and zero leak-off after closure, so it is least reliable from dt = tc to dt = 2 tc.

### 2.2 Cartesian plots and reservoir pressure

- Linear flow: p versus F_L is a straight line. "P* is the extrapolation of the linear line to FL = 0, which corresponds to an infinite shut-in time" (IHS-ACA).
- Radial flow: p versus F_R (IHS: FR1; CRA: F_L^2 or 1/t) is a straight line; "p* is therefore obtained from the extrapolation of the linear line to FR1 = 0" (IHS-ACA).
- MC19 Sec. 3.1.6: pore pressure by linear extrapolation of pressure versus 1/t (radial) or 1/sqrt(t) (linear) to zero.

### 2.3 Radial flow: transmissibility

PRINTED, Nolte/Barree form (IHS-ACA equation231 to 234; "As described in Reference 1 (Barree, 2007)"):

```
p_w(t) - p_i = 251,000 * ( Q_t * mu / ( k h * tc ) ) * F_R1
m_R1 = 251,000 * Q_t mu / ( k h tc )          (slope of p versus F_R1)
k h  = 251,000 * Q_t mu / ( m_R1 * tc )
```

F_R1 is the function in 2.1 (equation633). Units are not printed on the page. DERIVED from the comparison below: Q_t in bbl (injected volume), mu in cp, kh in md-ft, tc in MINUTES, pressure in psi.

PRINTED, Soliman/Craig form (IHS-ACA equation247, 249 to 251):

```
p_w(t) - p_i = 24 * 70.6 * ( V_inj * mu / ( k h ) ) * 1 / ( tp + dt )
m_R2 = 24 * 70.6 * V_inj mu / ( k h )         (slope of p versus 1/(tp + dt))
k    = 24 * 70.6 * V_inj mu / ( h * m_R2 )
```

PRINTED (CRA slide 22): `kh/mu = 24 x 70.6 [ V_i / M_R ]`, "Vi: bbls; k: md; MR: psi/cycle; h: ft; mu: cp", F_R = 1/t with t in hr. So the constant is 24 * 70.6 = 1694.4 with volume in bbl, time in HOURS, viscosity in cp, kh in md-ft, pressure in psi.

PRINTED, SI form (MC19, p. 37, Eq. 50): `P - Pres = ( V_inj - C_w (Pres - P_w,init) ) * mu / ( 4 pi k h ) * 1/dt` (consistent SI units; the wellbore-storage volume is taken out of the impulse volume).

Two constants compared (DERIVED): at late time F_R1 = (1/4) ln(1 + (16/pi^2) tc/(t - tc)) -> (4/pi^2) tc / t, so the Nolte form gives dp = 251,000 * (4/pi^2) * Q mu / (kh t[min]) = 101,727 Q mu / (kh t[min]); the Soliman form gives 1694.4 * 60 = 101,664 Q mu / (kh t[min]). They agree to 0.06%; 251,000 is a rounded value of 1694.4 * 60 * pi^2 / 4 = 250,845.

### 2.4 Linear flow

PRINTED, Nolte form (IHS-ACA equation228 to 230; printed as shown, the labels C_R and C_T are as on the page):

```
p_w(t) - p_i = 477 * C_T * sqrt( pi mu / ( k phi ct ) ) * F_L1
C_R = ( dp_total / 477 ) * sqrt( k phi ct / ( pi mu ) ),       dp_total = p_c - p_i
C_T = ( dp_reservoir / 477 ) * sqrt( k phi ct / ( pi mu ) ),   dp_reservoir = p@tc - p_i
```

"CT is the total fluid-loss coefficient. CR is the reservoir fluid-loss coefficient. p@tc is the extrapolation of the linear flow line at closure time, tc. Note: FL = 1.0 at tc." Units of the constant 477 are not printed. So the linear-flow slope gives p* (intercept) and, with a permeability from radial flow, the fluid-loss coefficients.

PRINTED, Soliman/Craig form (IHS-ACA equation242, 245, 246):

```
p_w(t) - p_i = 48.77 * ( V_inj / h ) * sqrt( mu / ( phi ct k X_f^2 ) ) * ( 1 / ( tp + dt ) )^(1/2)
X_f * sqrt(k) = 48.77 * ( V_inj / ( h m_L ) ) * sqrt( mu / ( phi ct ) )
```

So the linear-flow slope gives X_f sqrt(k) (fracture half-length times root permeability); "Permeability must be estimated in order to calculate fracture half-length." IHS-ACA notes that the constant in Craig's linear equation differs from Soliman's and that the software uses Craig's. Bilinear (equation237): `p_w - p_i = 264.6 (V_inj/h) mu^(3/4) (1/(phi ct k))^(1/4) (1/sqrt(k_f w_f)) (1/(tp + dt))^(3/4)`. Units for 48.77 and 264.6 are not printed (presumably the same field units as the radial form: bbl, hr, cp, md, ft, psi, 1/psi; NOT CONFIRMED).

MC19 p. 37: impulse linear flow gives A sqrt(k) from a plot of pressure versus F_L (or 1/sqrt(t)).

### 2.5 Log-log derivative slopes

PRINTED (CRA slide 15, table "From Barree (SPE 107877)"; x-axis is t, or pseudo-time ta for gas):

| Plotted quantity | Before closure: bilinear | Before closure: linear | After closure: bilinear | After closure: pseudolinear | After closure: pseudoradial |
|---|---|---|---|---|---|
| dp vs t | 1/4 | 1/2 | - | - | - |
| primary derivative d(dp)/dt | -3/4 | -1/2 | -7/4 | -3/2 | -2 |
| semi-log derivative t d(dp)/dt | 1/4 | 1/2 | -3/4 | -1/2 | -1 |
| impulse derivative t^2 d(dp)/dt | 5/4 | 3/2 | 1/4 | 1/2 | 0 |

Other statements of the same slopes:

- IHS-ACA (Nolte plot): "Impulse Linear and Radial flow have slopes of -1/2 and -1, respectively, when their semi-log derivative is plotted on the log-log Derivative plot." In impulse radial flow the pressure-difference curve overlays the derivative. FEK slide 40: the derivative is taken with respect to F_L^2 (axis label "(FL2^2) d dp / d(FL2^2)").
- IHS-ACA (Soliman/Craig plot): impulse derivative dt (tp + dt) dp/dt has slopes 1/4, 1/2, 0 for bilinear, linear, radial.
- MC19 Sec. 3.1.5: on a log-log plot of t dP/dt against actual shut-in time, "Impulse linear behavior scales with t^(-1/2) (a -1/2 slope on the log-log plot), and impulse radial scales with t^-1 (a -1 slope)". Use only after the peak of t dP/dt. An apparent -1 slope straight after the peak is often "false radial" in gas reservoirs.
- CRA slide 23 (linear flow check): pressure difference and derivative both on a half-slope line with the pressure difference 2x the derivative.

---

## 3. Worked examples

No single open source gave every requested quantity for one test. Three examples follow; missing items are marked.

### 3.1 Utica / Point Pleasant gas well (MC19, Sec. 3.1, pages 6-14)

| Quantity | Value | Where |
|---|---|---|
| Injected volume, pumping time | not found in the sections read | - |
| Literal ISIP | about 11,500 psi | Sec. 3.1.1 |
| Effective ISIP (extrapolated from minimum dP/dG) | 8330 psi | Sec. 3.1.1 |
| Contact pressure (dP/dG starts to rise; relative stiffness plot) | about 8100 psi | Sec. 3.1.2 |
| Shmin estimate | 8100 - 75 = 8025 psi | Sec. 3.1.2 |
| Tangent-method closure (G dP/dG) | 7633 psi | Sec. 3.1.3 |
| Near-wellbore coefficient (afterflow plot) | about 1600 psi/bpm^(1/2) | Sec. 3.1.4 |
| Peak of t dP/dt | 2000 min | Sec. 3.1.5 |
| Pore pressure (p vs 1/t extrapolation; "probably modestly lower") | 6825 psi | Sec. 3.1.6 |
| Geometry assumed | PKN, height 110 ft (radial alternative: diameter 180 ft, permeabilities about 30% lower) | Sec. 3.1.7 |
| Leak-off coefficient (G-function, Eq. 38-39) | 9.2e-5 ft/min^(1/2) | Sec. 3.1.7 |
| Permeability, G-function method | 27 nd | Sec. 3.1.7 |
| Permeability, h-function method | 14 nd | Sec. 3.1.7 |
| G_c, efficiency | not reported in the sections read | - |

### 3.2 Fekete deck (FEK), numbers from plot annotations

Example A (slides 15-27 pre-closure plot; slides 34-37 after-closure; the deck does not state that the two parts are the same well, the pressures are consistent):

| Quantity | Value |
|---|---|
| Injected volume | 3.99 bbl |
| ISIP | 7930.1 psia; datum 9650 ft; frac gradient 0.822 psi/ft |
| Closure | G_c = 21.014; tc = 159.76 min; p_c = 7308.4 psia |
| Net pressure ISIP - p_c | 621.7 psi (my arithmetic) |
| Efficiency G_c/(2 + G_c) | 0.913 (my arithmetic, not printed on the slide) |
| Pumping time | not printed. Back-calculated by me from G_c and tc with the alpha = 1 form: about 2.0 min (not from the source) |
| Nolte ACA derivative plot | impulse linear -1/2 line and impulse radial -1 line; k = 0.0165 md |
| Soliman/Craig | k = 0.0165 md; X_f sqrt(k) = 1.24 md^0.5 ft; X_f = 9.676 ft |
| Model match | p_i = 6592.0 psia; kh = 0.6138 md ft; h = 40 ft; k = 0.0153 md; X_f = 9.273 ft |
| Leak-off coefficient | not reported |

Example B ("Mini-frac Observations from Real Data", vertical well, formation depth 10,000 ft, gas; slides 38-42):

| Quantity | Value |
|---|---|
| Injected volume | 16.35 bbl; rate marker -1440 bbl/d (1 bbl/min) |
| Pumping time | not printed as such (a "Stop Injection" marker shows 0.31 h; 16.35 bbl at 1 bbl/min would be 16.35 min) |
| Breakdown pressure | 10,942.7 psia |
| ISIP | 9444.2 psia; datum 10,100 ft; frac gradient 0.935 psi/ft |
| Closure | tc = 166.76 min; p_c = 7217.0 psia; G_c value not captured in the slide text |
| Nolte ACA | semi-log derivative slope -1 after 5.64 h |
| Nolte radial plot (p vs FR) | kh = 0.1115 md ft; h = 60 ft; k = 1.8577e-3 md; p* = 5363.9 psia |
| Soliman/Craig model | kh = 0.1978 md ft; k = 3.2968e-3 md; p_i = 5461.7 psia; X_f = 1.572 ft; radial flow expected after about 50 h |
| Efficiency, leak-off coefficient | not reported |

### 3.3 Shale gas DFIT in the Cramer EPA slides (CRA slides 11, 19, 22)

Assumption: I take slides 11, 19 and 22 to be one test (the reservoir pressures agree: 4693 psi and p* 4692.9 psi). The deck does not say so in the text that I read.

| Quantity | Value |
|---|---|
| Injection | 1 bbl/min; "1 bbl of fluid injected following fracture initiation"; V_i used in the formula = 1.06 bbl |
| Fall-off | "14+ days of data" |
| Minimum horizontal stress from DFIT closure | 7269 psi |
| Radial-plot slope | M_R = 63,300 psi |
| kh/mu = 24 x 70.6 x 1.06 / 63,300 | 0.028 md-ft/cp (printed; my arithmetic gives 0.02837) |
| mu | 0.0258 cp |
| kh | 0.000732 md-ft |
| k | 0.000045 md = 45 nanodarcies |
| Reservoir pressure | 4693 psi (0.49 psi/ft); p* on the plot 4692.9 psi |
| ISIP, G_c, efficiency, leak-off coefficient | not reported |

This is the cleanest numerical check of the radial formula: 1694.4 * 1.06 / 63,300 = 0.0284.

---

## 4. Simulator test: constant-height fracture, Carter leak-off, no spurt, fixed area after shut-in

All of this section is DERIVED from WS Eq. 1 + Table 1 and MC19 Eq. 13, 15, 17, 18. Assumptions that the simulator must satisfy for the test to be exact: (a) leak-off velocity through each face C_L / sqrt(t - tau(x)), i.e. 2 C_L / sqrt(t - tau) per unit fracture area, independent of pressure; (b) no spurt loss; (c) area A = (tip-to-tip length) * h fixed after shut-in; (d) uniform pressure in the fracture after shut-in; (e) constant stiffness S_f = 2 E' / (pi h) (mean width = pi h (p - p_c) / (2 E')), until the mean width is zero; (f) no wellbore storage; (g) leak-off over the full height (r_p = 1), else multiply C_L by r_p = h_p / h.

Predictions:

1. Leak-off after shut-in: `V_Ls(dt) = 2 A C_L sqrt(tp) [ g(dtD) - g0 ] = (pi/2) A C_L sqrt(tp) G(dtD)`, where g must be the g of the simulator's own area history: `g = (2/A) * integral over area of sqrt( (t - tau(a)) / tp ) da`. If the simulated area grew as t^alpha, use the integral in 1.1. If alpha is exactly 1 or 1/2, use the closed forms. For a PKN fracture alpha lies between the bounds (no leak-off: length ~ t^(4/5); leak-off dominated: length ~ t^(1/2); these two exponents are NOT CONFIRMED, recalled).

2. Pressure is linear in G until closure:

```
p(dtD) = ISIP - m * G(dtD),      m = (pi/2) * C_L * S_f * sqrt(tp) = C_L * E' * sqrt(tp) / h
```

Test: fit the slope of p versus G; recover `C_L = m * h / ( E' * sqrt(tp) )`. Field-unit check: m [psi], h [ft], E' [psi], tp [min] gives C_L [ft/min^0.5]. dP/dG is constant, and G dP/dG is a straight line through the origin.

3. Net pressure at shut-in from the volume balance: `ISIP - p_c = S_f * V_f / A = 2 E' * eta * V_inj / ( pi h A )`, with `eta = 1 - 2 A C_L sqrt(tp) g0 / V_inj` (MC19 Eq. 13 at dt = 0).

4. Closure (mean width = 0, p = p_c) is at

```
G_c = (4 g0 / pi) * eta / (1 - eta)        <=>        eta = G_c / ( G_c + 4 g0 / pi )
alpha = 1/2 (g0 = pi/2):  G_c = 2 eta / (1 - eta),      eta = G_c / (2 + G_c)      (the printed formula)
alpha = 1   (g0 = 4/3):   G_c = 1.698 eta / (1 - eta),  eta = G_c / (1.698 + G_c)
```

and `ISIP - p_c = m * G_c` (the same statement as IHS-PRE equation227). For a general area history use g0 = g(0) from the simulator's exposure times. The printed eta = G_c/(2 + G_c) will be biased low (by up to 4/pi * (pi/2 - 4/3) = 0.30 in the denominator) if the simulated alpha is near 1.

Separate note, not derived from the equations above and not verified: an after-closure check needs a simulator that solves pressure diffusion in the reservoir (Carter leak-off alone has no reservoir pressure). If it does, the expected late-time results are those of Section 2: pressure linear in F_L or 1/sqrt(t) for linear flow with intercept p_i; for radial flow in a layer of thickness h, the slope of p versus 1/(tp + dt) gives kh = 1694.4 V_inj mu / m_R2 (bbl, cp, hr, psi, md-ft). Fix the F_L time origin first (2.1).

Factor-of-2 traps: (i) A is one face of both wings; if the code holds x_f (half-length), A = 2 x_f h. (ii) C_L is per face; if the code's coefficient already includes both faces, halve it before the comparison. (iii) The Nolte convention with beta_s is not the uniform-pressure convention used here.

---

## Open items

- F_R with 16/pi^2 is confirmed from the IHS reference page only (software help that cites Barree SPE 107877); Nolte 1997 itself was not read. IHS prints F_L1 without the square root, in conflict with CRA and MC19.
- Time origin of t and tc in F_L and F_R: CRA counts from the start of injection, MC19 from shut-in, IHS does not say.
- Nolte's classic C_L formula with beta_s: recalled only.
- Barree 2009 (SPE 107877), Nolte 1997, Talley 1999, Soliman 2005, McClure 2016: not opened. Their content is taken through IHS, CRA, WS and MC19.
- Units of the IHS constants 477, 48.77, 264.6, 251,000 are not printed on the help page; only the 251,000 unit set was inferred.
- No open example gave injected volume, pumping time, ISIP, closure, G_c, efficiency, C_L, reservoir pressure and permeability for one test.
