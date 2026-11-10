# Proppant models for a first transport and conductivity model

Researched 2026-11-09. Every formula and constant has a source tag in square brackets; the tags
are listed in "Sources" at the end. Equations from [RF], [DP14], [DP15], [REV], [UFD] and the
vendor PDF tables were read from page images; GEOS text is from the doc source files. "Derived" means arithmetic
or algebra done for this note from the cited inputs. "Not confirmed" means no opened source
states it. Symbols: d particle diameter, a = d/2, c proppant volume fraction, c_max packing
limit, mu fluid viscosity, rho_p and rho_f densities, w fracture width, g gravity.

## 1. Single-particle settling

**Stokes.** v_St = g d^2 (rho_p - rho_f) / (18 mu). [GEOS-PT; REV eq. 9]
- Range: "Stokes' law holds for particle Reynolds numbers (Re = wD/nu) below a value of about
  1" [FC04]. The review [REV] gives Re <= 2 (after Novotny 1977). Re = rho_f v d / mu.
- [RF sec. 8.3] says Stokes "greatly overestimates settling rate in low viscosity fluids".

**All-Reynolds corrections (pick one).**

| Name | Formula | Constants | Source |
|---|---|---|---|
| Ferguson-Church (used by ResFrac for Newtonian fluid) | v = R g d^2 / (C1 nu + sqrt(0.75 C2 R g d^3)), R = (rho_p - rho_f)/rho_f, nu = mu/rho_f | C1 = 18, C2 = 0.4 smooth spheres; C1 = 18, C2 = 1.0 "intermediate" values for natural sand with sieve diameter; C1 = 20, C2 = 1.1 with nominal diameter; C1 = 24, C2 = 1.2 angular extreme | [FC04 eq. 4 and text]; [RF eq. 8-6] uses 18 and C2 = 1 |
| Schiller-Naumann drag | C_D = (24/Re)(1 + 0.15 Re^0.687) for Re < 1000; C_D = 0.44 above; v = sqrt(4 g d (rho_p - rho_f) / (3 C_D rho_f)), solved by iteration | 24, 0.15, 0.687, 1000, 0.44 | constants from code [OF-SN]; the 1935 paper was not opened |
| Allen, intermediate Re (GEOS option) | v = 0.2 d^1.18 [g (rho_p - rho_f)/rho_f]^0.72 (rho_f/mu)^0.45 | 0.2, 1.18, 0.72, 0.45; Re range not stated | [GEOS-PT] |
| Newton, high Re (GEOS option) | v = 1.74 sqrt(g d (rho_p - rho_f)/rho_f) | same as C_D = 0.44 | [GEOS-PT] |

- [REV eq. 10-13] gives a different intermediate law for Re 2 to 500
  (v = (0.072 (rho_p - rho_f) g d^1.6 / (rho_f^0.4 mu^0.6))^0.71, C_D = 18.5/Re^0.6) and Newton
  above Re 500.
- Non-Newtonian fluid: [RF eq. 8-7, 8-8] uses Chien (1994) with shear rate = v/d. Not copied here.

**Derived example** (sand 2650 kg/m3 in water, 1000 kg/m3, 1 cP), settling speed in cm/s:

| d (mm) | Stokes | Re at Stokes speed | Ferguson-Church (C2 = 1) | Schiller-Naumann |
|---|---|---|---|---|
| 0.15 | 2.0 | 3.0 | 1.5 | 1.6 |
| 0.30 | 8.1 | 24 | 4.0 | 4.3 |
| 0.60 | 32 | 194 | 8.4 | 9.5 |

In water even 100-mesh sand is outside the Stokes range. Stokes is correct only for thick fluid.

**Sizes and densities.**

| Grade | Sieve range (mm) | Median diameter D50 (mm) | Source |
|---|---|---|---|
| 20/40 | 0.425 to 0.850 | 0.523 to 0.562 (sand); 0.730 (ceramic) | sieve [WO15 CARBO tables]; D50 [USS-W], [WO15] |
| 30/50 | 0.300 to 0.600 | 0.384 to 0.413 (sand); 0.522 (ceramic) | same |
| 40/70 | 0.212 to 0.425 | 0.292 to 0.302 (sand); 0.334 (ceramic) | same |
| 100 mesh | about 0.105 to 0.212 if sold as 70/140 | 0.165 to 0.185 | D50 [USS-100]; openings 70 = 0.212, 100 = 0.150, 140 = 0.105 mm [MESH] |

- "100 mesh = 70/140" is trade usage seen only in search snippets: not confirmed from an opened
  source. The D50 above is consistent with it.
- US mesh openings: 12 = 1.70, 16 = 1.18, 20 = 0.850, 30 = 0.600, 40 = 0.425, 50 = 0.300,
  60 = 0.250, 70 = 0.212, 100 = 0.150, 140 = 0.105 mm [MESH table, parsed from the page HTML];
  the vendor sieve tables [WO15] give the same values for mesh 12 to 70.
- Density: sand specific gravity 2.65 (2.64 to 2.66), bulk density 1.48 to 1.60 g/cm3 [USS-W].
  Resin-coated sand 2.51 to 2.57, bulk 1.47 to 1.59 [WO15 Fairmount Santrol tables]. Ceramic:
  2.85 (bulk 1.60), 3.2 (bulk 1.88), 3.5 sintered bauxite (bulk 2.04), 3.65 (bulk 2.19)
  [WO15 Saint-Gobain tables]. All vendor data.

## 2. Hindered settling

**Frame matters.** With no net flow (batch settling), fixed-frame particle speed =
(1 - c) x slip speed relative to the fluid. So a fixed-frame exponent n equals a slip exponent
n - 1. [DP14, text after eq. 2.8] says this directly: alpha = 5.1 fixed-frame, 4.1 for slip.

| Model | Formula | Constants | Frame | Source |
|---|---|---|---|---|
| Richardson-Zaki | v = v_inf (1 - c)^n | n = 4.65 (Re < 0.2); 4.35 Re^-0.03 (0.2 to 1); 4.45 Re^-0.1 (1 to 500); 2.39 (Re > 500) | fixed | table in [RZ-T], a secondary source; the 1954 paper was not opened |
| Garside and Al-Dibouni (ResFrac) | v = v_inf (1 - c)^Z / (1 + 2.35 d/D_t), Z = (5.09 + 0.2839 Re^0.877) / (1 + 0.104 Re^0.87), Re = rho_f v d / mu, D_t = 2 w | as printed | fixed (fluidization correlation; ResFrac does not state it) | [RF eq. 8-9 to 8-11] |
| Dontsov-Peirce | drag coefficient eta = 9 mu c / (2 a^2 (1 - c)^4.1) | 4.1 = 5.1 - 1 | slip | [DP14 eq. 2.8] |
| Barree-Conway (GEOS) | u_slip = exp(-lambda_s c) u_settling | lambda_s = 5.9 default; 4.5 in the GEOS slot test | slip | [GEOS-PT], [GEOS-PF], [GEOS-SLOT] |
| Gadde et al. 2004 | v = v_inf (2.37 c^2 - 3.08 c + 1) | 2.37, 3.08 | not stated | [REV eq. 15], secondary; SPE 89875 was not opened |

- Jamming: ResFrac also multiplies settling and horizontal proppant velocity by
  1 - (c/c_max)^20 so both go to zero at c_max [RF sec. 8.2, 8.4].
- Clustered settling in shear-thinning gel can be 5 to 20 times faster than single-particle
  settling near c = 0.1; ResFrac uses its own empirical factor [RF sec. 8.5, eq. 8-14].
  Ignore it for a first Newtonian model.
- Daneshy (1978) hindered correlation: not confirmed (paper not opened). [REV eq. 14] prints a
  Clark-Quadir form "v = v_inf c / 10^(1.82(1-c))" which goes to zero at c = 0, so it looks
  misprinted; do not use it.

**Wall effect** (settling slows when w is a few diameters):
- ResFrac: divide by 1 + 2.35 d/D_t with D_t = 2 w. At w = 4 d the speed drops 23%. [RF sec. 8.4]
- Novotny (1977), Re < 1: f_w = 1 - 0.6526 (d/w) + 0.147 (d/w)^3 - 0.131 (d/w)^4
  - 0.0644 (d/w)^5; Re > 100: f_w = 1 - (d/(2w))^1.5; linear in Re between. [REV eq. 16]
- Liu and Sharma (2005): f_w = 1 - 0.16 mu^0.28 (d/w) for d/w < 0.9; else
  8.26 exp(-0.0061 mu)(1 - d/w). [REV eq. 17]; the unit of mu is not stated there: not confirmed.

## 3. Slurry rheology and transport

**Viscosity versus concentration** (mu_r = slurry viscosity / clean-fluid viscosity):

| Name | Formula | Source |
|---|---|---|
| Eilers (used by ResFrac and GEOS) | mu_r = [1 + 1.25 c / (1 - c/c_max)]^2 | [RF eq. 8-15], [GEOS-PT] |
| Maron-Pierce | mu_r = (1 - c/c_max)^-2 | [KITP slide 7] |
| Krieger-Dougherty | mu_r = (1 - c/c_max)^(-2.5 c_max) | [KITP slide 7] |
| Generic power form | mu_r = (1 - c/c_max)^beta, beta between -3 and -1 | [REV eq. 20] (Adachi et al. 2007) |
| Einstein, dilute only | mu_r = 1 + 2.5 c | [REV eq. 18] |
| Dontsov-Peirce | no closed form: slurry flux q = -(w^3 / (12 mu)) Qs(c/c_max, w/a) grad p, Qs computed numerically. Limits: Qs = 1 at c = 0; Qs -> (4 / (5 c_max mu_1)) (1 - c/c_max)^1.5 near packing, mu_1 = 0.32 | [DP14 eq. 4.24, 4.14], [DP15 eq. 2, 4] |

- Power-law slurry: Keck et al. (1992) form in [RF eq. 8-16].
- All forms go to infinity at c_max; codes cap the viscosity [REV sec. 2.5].

**Maximum packing fraction c_max.**

| Value | Meaning | Source |
|---|---|---|
| 0.585 | maximum flowing fraction (Boyer et al. 2011) | [DP14 eq. 2.7], [DP15] |
| 0.6 | GEOS default; 0.62 in the GEOS slot test | [GEOS-PF], [GEOS-SLOT] |
| 0.5 to 0.66 | "random packing and moderately heterogeneous particles" | [RF sec. 5] |
| about 0.64 | random close packing of spheres | [KITP slide 7] |

**Bridging / screen-out criterion** (proppant cannot enter where w < N d):

| N | Statement | Source |
|---|---|---|
| 3 | blocking function B = 0 for w < 3 d, smooth cosine ramp, B = 1 for w > 4 d; "N = 3 is chosen for all examples" | [DP14 eq. 4.21], [DP15 eq. 3] |
| 3 | "a fracture width equal to three times the proppant diameter is felt to be necessary to avoid bridging" | [UFD ch. 7] |
| 1.25 to 1.75 | ResFrac default linear ramp, after Barree and Conway (2001) slot tests | [RF sec. 8.1, eq. 8-1 to 8-3] |
| 3 to 6 | "often assumed"; about 6 comes from perforation tests (Gruesbeck and Collins 1982) | [RF sec. 8.1] |
| user input | bridging aperture h_b = lambda_b d; default bridgingFactor = 0 | [GEOS-PT], [GEOS-PTD] |

Dontsov-Peirce blocking function, exact form [DP14 eq. 4.21]:
B = 0.5 H(w/(2a) - N) H((w_B - w)/(2a)) [1 + cos(pi (w_B - w)/(2a))] + H((w - w_B)/(2a)),
w_B = 2a(N + 1), H = Heaviside step. The proppant flux is multiplied by B.

**Advection: fluid speed or slip?**
- Simplest models move proppant at the slurry speed (no slip). GEOS default is no horizontal
  slip (isCollisionalSlip = 0) [GEOS-PF].
- Barree-Conway (1995): proppant speed / slurry speed = 1.27 - |c - 0.1|^1.5 (alpha = 1.27,
  c_slip = 0.1, beta = 1.5) [GEOS-PT]; [RF eq. 8-4] gives the same and a smooth polynomial:
  Qpr/Q = c (1 - (c/c_max)^20)(-3.74578663 c^4 + 6.18208260 c^3 - 4.35820344 c^2
  + 0.660118234 c + 1.23837722) [RF eq. 8-5].
- Dontsov-Peirce: proppant flux = B Qp_hat q_slurry; in the dilute limit Qp = (6/5)(c/c_max)
  and Qs = 1 [DP14 eq. 4.14a, 4.15a, 4.27], so proppant moves at 1.2 x mean slurry speed
  (derived). [DP15, conclusions]: "particles can reach the tip of the fracture even without
  leak-off".
- Dilute-limit settling in the same model equals Stokes: Gp = (8/3)(c/c_max) [DP14 eq. 4.20a]
  in [DP15 eq. 2] gives (2/9) a^2 (rho_p - rho_f) g / mu (derived).

## 4. Bed / bank formation

- **Bank growth rate, GEOS:** dH/dt = c u_settling F(c) / c_s - Q_lift / (A c_s), with
  F(c) = exp(-lambda_s c), c_s the packing fraction, Q_lift a wash-out (bed-load) rate.
  The bed forms in the cell at the fracture bottom or above a cell already full. [GEOS-PT]
- **Exact mass balance (derived):** for fixed-frame settling speed v(c) onto a bank packed at
  c_max, dh_bank/dt = c v(c) / (c_max - c). The GEOS form drops the "- c" and the (1 - c)
  frame factor; the two agree for c << c_max.
- **ResFrac:** each cell at the top of the bed is sub-meshed vertically to find the share of
  proppant that has settled into "an immobile bed". A cell is "supported" if it is at the
  fracture bottom or the cell below is full of proppant or closed. Bed slumping moves proppant
  sideways out of a bed next to an unsupported cell (effective repose angle is mesh-dependent;
  sand is about 33 degrees). [RF sec. 8.9, 8.10]
- **Bed-load (wash-out) transport:** Wiberg-Smith correlation
  Q_s = W d sqrt(g d (rho_p - rho_f)/rho_f) (9.64 N_Sh^0.166)(N_Sh - N_Sh,c)^1.5,
  N_Sh = tau / (d g (rho_p - rho_f)), tau = 0.125 f rho_f u^2 [GEOS-PT]; critical Shields
  number 0.047 [RF sec. 8.9]. ResFrac's reading of the literature: bed load "is not a
  significant transport mechanism at the field scale" [RF sec. 8.9]. Leave it out at first.
- **Pseudo-3-D design tools:** vertical slices; proppant moves along the fracture with the
  fluid and settles in each slice into a bank; bank height = build-up minus wash-out; vertical
  particle speed = hindered settling speed (Hu et al. 2018 model as summarised in
  [REV sec. 3.1.1, eq. 28-31]). [REV eq. 29] prints the slurry speed above the bank as
  v = ((H - H_bed)/H)(w^2/(12 mu)) dp/dx, next to the sentence "the slurry velocity increases as
  the proppant bed builds up". At fixed flow rate, mass balance gives the inverse factor
  H/(H - H_bed) (derived); the printed factor is not confirmed against Hu et al. The UFM tool
  uses three layers: bank, slurry, clean fluid [REV fig. 6]. Daneshy (1978): not confirmed.
- **Propped height (judgement, no single source):** after closure the propped height in a
  slice is the bank height plus the suspended proppant that closes in place; a simple model
  takes total proppant volume per unit length / (c_max x width at closure).
- **Pack porosity values.** 0.3 assumed in the design example of [UFD ch. 7]. 1 - c_s = 0.4
  from the GEOS default [GEOS-PF]. Loose-pack porosity from vendor bulk density (derived,
  1 - bulk/grain): sand 0.40 to 0.44 [USS-W]; resin-coated 40/70 0.41 [WO15]. Porosity implied
  by vendor conductivity / permeability at 2,000 psi and 2 lb/ft2 (derived, section 5): about
  0.27 to 0.35. A single "standard" value is not confirmed; 0.30 to 0.35 spans these numbers.

## 5. From proppant to conductivity

**(a) Propped width.** w_p = C_a / ((1 - phi_p) rho_p), C_a = proppant mass per fracture area,
phi_p = pack porosity. From [UFD ch. 7, p. 118]: "V_p = M/[(1 - phi_p) rho_p]", "w_p = V_p/(x_f x h_f)".
- Field units (derived): w_p [in] = 12 C_a [lb/ft2] / ((1 - phi_p) x 62.43 x SG).
- Sand (SG 2.65): 1 lb/ft2 = 2.83 mm = 0.112 in at phi_p = 0.35; 3.07 mm at 0.40 (derived).

**(b) Pack permeability.** Kozeny-Carman: k = d^2 phi^3 / (36 kappa (1 - phi)^2).
- Carman: kappa = 4.8 +/- 0.3, rounded to 5, so 36 kappa = 180. Ergun / Blake-Kozeny:
  36 kappa = 150. [KC sec. 3] GEOS uses 180 with (s d)^2, s = sphericity [GEOS-PT].
- ResFrac: k_b = k_0b d^2 (phi - f_b)^3 / (1 - phi + f_b)^2 with user constants; its example
  uses k_0b = 0.007 (about 1/143) and f_b = 0 [RF eq. 5-21, fig. 7 caption].
- Measured, vendor data at 2 lb/ft2 and 150 F (test standard not stated on the sheets):

| Closure stress (psi) | 2,000 | 4,000 | 6,000 | 8,000 | 10,000 | Source |
|---|---|---|---|---|---|---|
| 100 mesh sand, k (darcy) | 31 | 22 | 15 | 9 | 4 | [USS-100] |
| 100 mesh sand, k w (md-ft) | 515 | 333 | 184 | 96 | 44 | [USS-100] |
| 40/70 white sand, k (darcy) | 58 | 48 | 33 | 19 | 10 | [USS-W] |
| 40/70 white sand, k w (md-ft) | 1,082 | 877 | 598 | 323 | 168 | [USS-W] |
| 20/40 white sand, k (darcy) | 202 | 150 | 86 | 40 | 20 | [USS-W] |
| 20/40 white sand, k w (md-ft) | 3,678 | 2,685 | 1,484 | 652 | 321 | [USS-W] |
| 40/70 low-density ceramic, k w (md-ft, 250 F) | 2,200 | 1,660 | 1,270 | 870 | 555 | [WO15 CARBOLITE] |

  So at low stress: 100 mesh is of order 10 to 30 darcy, 40/70 sand of order 50 darcy.
- Check (derived): Kozeny-Carman with 180, phi = 0.35: d = 0.297 mm gives 50 darcy (vendor 58);
  d = 0.175 mm gives 17 darcy (vendor 31; phi = 0.40 gives 31).
- Check (derived): k w / k at 2,000 psi gives w = 5.7 mm (40/70) and 5.1 mm (100 mesh) for
  2 lb/ft2, so phi_p = 0.35 and 0.27 by the formula in (a).

**(c) Loss with closure stress.**
- Exponential form: k = k_0 exp(-c_k (sigma_n - P)) [RF eq. 5-22]; the ResFrac example uses
  c_k = 7e-4 1/psi [RF fig. 7 caption]. ResFrac also accepts tables of multipliers versus
  stress.
- Fit to the vendor sand rows above between 2,000 and 10,000 psi (derived): c_k = 2.2e-4 1/psi
  (40/70), 2.6e-4 1/psi (100 mesh). One exponential is a rough fit: for 40/70 the local slope
  rises from 0.9e-4 1/psi (2,000 to 4,000 psi) to 3.2e-4 1/psi (8,000 to 10,000 psi) (derived).
- The tables are vendor data; the sheet says the values "are not specifications" [USS-W].
  How far field conductivity falls below such lab values: not confirmed.

**(d) Dimensionless fracture conductivity.** C_fD = k_f w / (k x_f); k_f pack permeability,
w propped width, k formation permeability, x_f half-length. [UFD eq. 3-12] (F_CD is the same
quantity.)
- Optimum C_fD = 1.6 for proppant number N_prop < 0.1, N_prop = I_x^2 C_fD
  = 2 k_f V_prop / (k V_res) [UFD eq. 3-13, 3-14 and text].
- "When the dimensionless fracture conductivity is high (e.g., greater than 100), the behavior
  is similar to that of an infinite conductivity fracture" [UFD ch. 3]. Other thresholds seen in
  the industry (10, 30) are not confirmed here.
- Worked check in [UFD ch. 7]: k_f = 60e-12 m2, w = 0.002 m, k = 5e-16 m2, x_f = 152 m gives 1.6.

## 6. Unit conversions

- 1 lb/gal = 119.826 kg/m3; 1 lb/ft2 = 4.8824 kg/m2 (derived from 1 lb = 0.45359237 kg,
  1 US gal = 3.785411784e-3 m3, 1 ft = 0.3048 m).
- ppa (lb proppant added per gal clean fluid) to volume fraction (derived):
  r = ppa x 119.826 / rho_p [kg/m3]; c = r / (1 + r).
  Sand 2650 kg/m3: 0.5 ppa = 0.022; 1 = 0.043; 2 = 0.083; 4 = 0.153; 8 = 0.266.
- Mass per slurry volume c_m to mass per clean-fluid volume: c_a = c_m / (1 - c_m/rho_p)
  [UFD eq. 7-18]. Also c_m = rho_p c.
- Areal concentration from the model: C_a = rho_p c w (suspended) or rho_p c_max w (bank).

## 7. Verification cases

| # | Case | Expected result | Status |
|---|---|---|---|
| 1 | Front with no leak-off, no slip | fracture volume ahead of the front = pad volume | exact (already known) |
| 2 | Rigid slot, plug advection: width w, height H, rate Q, slurry starts at t_pad | front at x = lambda Q (t - t_pad) / (w H); lambda = 1 no slip, 1.2 Dontsov-Peirce dilute, 1.238 Barree-Conway at c -> 0; proppant volume in slot = injected volume | derived; tests upwinding and mass balance |
| 3 | Batch settling of uniform suspension c_0 in a closed vertical slot of height H (Kynch theory, mode MS-1: two shocks) | clear-fluid front falls at v(c_0); bank top rises at c_0 v(c_0) / (c_max - c_0); they meet at t = H (c_max - c_0) / (c_max v(c_0)); final bank height = H c_0 / c_max | theory [KONA sec. 3, fig. 6]; speeds derived from the jump condition |
| 4 | Steady settling line in a rigid slot: uniform speed u, inlet c_0, dilute | top of slurry at z = H - v_s x / u; all proppant banked by x = u H / v_s | derived |
| 5 | Dehydration by leak-off in a rigid slot: steady, leak-off speed u_L per face, no slip, no settling | Q(x) = Q_0 - 2 u_L H x; c(x) = c_0 Q_0 / Q(x); packs (c = c_max) at x = (Q_0 / (2 u_L H))(1 - c_0/c_max) | derived |
| 6 | Nolte ramp on PKN with Carter leak-off, efficiency eta | eps = (1 - eta)/(1 + eta); V_pad = eps V_i; c(t) = c_e ((t - t_pad)/(t_e - t_pad))^eps; M = eta c_e V_i; concentration about uniform = c_e at end of pumping | [UFD table 7-8, eq. 7-17]; a design rule, so expect near-uniform, not exact |
| 7 | Bridging | no proppant in any cell with w < N d; with [DP14] B, flux scales by B between 3 d and 4 d | [DP14 eq. 4.21] |
| 8 | Dilute and packed limits of the flux functions | c -> 0: clean-fluid flow, Stokes settling; c -> c_max: proppant flux -> 0, slurry flux -> small Darcy value | [DP14 eq. 4.14 to 4.20, 4.26 to 4.28] |
| 9 | Tip screen-out | after the front bridges near the tip, length growth stops or slows, width and net pressure rise; with no leak-off mean width grows at q/(H L) per wing (derived) | behaviour [UFD ch. 5], [DP15 sec. 3, 4] |
| 10 | Conductivity chain | 2 lb/ft2 of 40/70 sand (SG 2.65), phi_p = 0.35, k = 58 darcy gives w_p = 5.67 mm and k w = 1,079 md-ft (vendor: 1,082) | derived from [USS-W] |

Notes on the cases.
- **Case 3 numbers** (derived): Richardson-Zaki n = 4.65, c_0 = 0.1, c_max = 0.6:
  v(c_0) = 0.6127 v_inf; bank speed 0.1225 v_inf; meet at t = 1.360 H / v_inf; bank height
  H/6. With a slip-type law (GEOS) use v(c) = (1 - c) F(c) u_settling. The bank formula needs
  zero settling flux at c_max, so cap the law there (plain Richardson-Zaki is not zero at 0.6).
  The two-shock picture holds when the straight line from (c_0, c_0 v(c_0)) to (c_max, 0) stays
  below the flux curve c v(c); otherwise a fan forms under the bank (modes MS-2, MS-3 in
  [KONA]) and the bank top does not rise at constant speed. It holds for the numbers above
  (checked numerically).
- **Case 6 worked example** [UFD ch. 7]: eta = 19.3%, eps = 0.677, t_pad = 27.8 min, ramp
  length 13.3 min, c_e = 875 kg/m3 of slurry (7.3 lb/gal), M = 8,760 kg per wing, x_f = 152.4 m.
- **Dontsov-Peirce benchmark.** [DP15] solves KGD and pseudo-3-D fractures with plug growth and
  settling and reports figures only, no tables. Example inputs include mu' = 12 mu = 1.2 Pa s,
  Q_0 = 2e-2 m3/s (P3D) and stress barrier 2.5 MPa. It defines a dimensionless settling number
  for P3D that "does not directly depend on the viscosity of the fluid" (formula not copied:
  the text extract was unclear). Use it for qualitative comparison only.
- **GEOS slot test.** Simulation of the Chun et al. (2020) slickwater slot experiment: slot
  4 ft x 1 ft, gap 0.3 in, three inlets, 30 s injection, d = 0.45 mm, rho_p = 2550 kg/m3,
  mu = 0.001 Pa s, c_s = 0.62, Stokes settling, lambda_s = 4.5. Comparison is by figure; no
  tabulated values on the page. [GEOS-SLOT]
- **ResFrac.** No proppant transport case was found in its validation section (sec. 22). [RF]
- **PyFrac, MRST, OPM.** Shallow clones of the default branches on 2026-11-09 contain no
  occurrence of the word "proppant" (PyFrac, opm-simulators, MRST). [PYFRAC], [OPM], [MRST]
- A published 1-D proppant transport test with tabulated results: not found, not confirmed.

## 8. Bottom line (my judgement, not a sourced fact)

Smallest credible first model for a constant-height or pseudo-3-D fracture:

1. **State per cell:** suspended volume fraction c and bank height h_bank (or bank volume).
2. **Advection:** move suspended proppant with the slurry flux already computed by the
   lubrication solver, first-order upwind, no slip (lambda = 1) as default. Keep lambda as a
   parameter (1.2 to 1.27) because slip changes the front position by about 20%.
3. **Leak-off:** removes clean fluid only, so c rises along the fracture.
4. **Slurry viscosity:** Eilers or Maron-Pierce with c_max = 0.6, capped; feed it back to the
   flow solve.
5. **Bridging:** block proppant flux into cells with w < N d, N = 3 default, exposed as an
   input (published range 1.25 to 6). Cells at c_max carry no proppant flux.
6. **Settling:** Ferguson-Church single-particle speed (not bare Stokes), times (1 - c)^n with
   n near 4.65 to 5.1 in the fixed frame, times the ResFrac wall factor. Bank grows at
   c v / (c_max - c). No bed-load, no slumping, no clustering at first.
7. **At closure:** C_a per cell gives w_p = C_a / ((1 - phi_p) rho_p) with phi_p = 0.35; k from
   a vendor table versus stress (or Kozeny-Carman x exp(-c_k sigma)); conductivity = k w_p;
   propped length = distance to the last cell with C_a above a small threshold (for example one
   grain layer); propped height = bank plus closed-in suspension.

Checks it should pass: cases 1, 2, 3, 5 exactly (to grid error); proppant mass conserved to
round-off in every run; case 6 within a stated tolerance; case 7 as a hard rule; case 10 as a
unit test of the conductivity chain; and a time-step / grid refinement study of the front
position.

## Items where sources disagree or a constant is not confirmed

- Bridging factor N: 3 [DP14, DP15, UFD]; 1.25 to 1.75 [RF defaults]; 3 to 6 quoted as common
  [RF]; GEOS has no default.
- c_max: 0.585, 0.6, 0.62, 0.5 to 0.66, 0.64 (table in section 3). Pack porosity after closure:
  0.3 [UFD] versus 0.35 to 0.44 from vendor densities (derived).
- Low-Re hindered exponent: 4.65 (Richardson-Zaki) versus 5.1 (Garside and Al-Dibouni, used by
  [DP14]; 5.09 in [RF]). GEOS uses an exponential with 5.9 (default) or 4.5 (slot test).
- Richardson-Zaki constants 4.35, 4.45, 2.39 come from a secondary table [RZ-T]. Rounded values
  4.4, 4.4, 2.4 and the d/D wall terms of the original paper: not confirmed.
- [RF eq. 8-10] prints exponents 0.877 and 0.87; the original paper was not opened.
- Stokes range: Re below about 1 [FC04] versus Re <= 2 [REV].
- Schiller-Naumann upper limit 1000 is from code [OF-SN]; the original paper was not opened.
- [REV eq. 29] bank-speed factor is printed as (H - H_bed)/H; mass balance gives the inverse.
- [UFD] is a third-party hosted copy of the book, not a publisher page.
- [RF] cites "Ferguson and Church (2006)"; the paper opened is dated 2004 (J. Sed. Res. 74(6)).
- Eilers formula is credited to Keck et al. (1992) in [RF] and [GEOS-PT], to Nicodemo et al.
  (1974) in [REV].
- Intermediate-Re law differs between [GEOS-PT] and [REV]; [REV eq. 12] prints d^2 under the
  root where d is needed for consistent units.
- Kozeny-Carman constant: 180 or 150; ResFrac example 1/0.007 = 143.
- Proppant slip factor: 1.0 (GEOS default), 1.2 (Dontsov-Peirce dilute, derived), 1.27 at
  c = 0.1 (Barree-Conway).
- Stress coefficient c_k: 7e-4 1/psi in the ResFrac example versus 2.2e-4 to 2.6e-4 1/psi
  fitted to vendor sand (derived).
- Gadde, Novotny and Liu-Sharma formulas are quoted from the review [REV], not the originals.
- PetroWiki could not be opened (redirect, then HTTP 403); nothing here relies on it.

## Sources

- [RF] McClure et al., ResFrac Technical Writeup, arXiv:1804.02092, version served on 2026-11-09: https://arxiv.org/abs/1804.02092
- [DP14] Dontsov and Peirce, J. Fluid Mech. 760 (2014) 567-590: https://personal.math.ubc.ca/~peirce/Dontsov_Peirce_JFM_760_p_567_590_2014.pdf
- [DP15] Dontsov and Peirce, Int. J. Solids Struct. 63 (2015) 206-218: https://personal.math.ubc.ca/~peirce/Dontsov_Peirce_IJSS_V63_p206_218_2015c.pdf
- [GEOS-PT] GEOS Proppant Transport Solver documentation: https://geosx-geosx.readthedocs-hosted.com/en/latest/coreComponents/physicsSolvers/fluidFlow/docs/ProppantTransport.html
- [GEOS-PF] GEOS ParticleFluid parameter table: https://geosx-geosx.readthedocs-hosted.com/en/latest/_sources/docs/sphinx/datastructure/ParticleFluid.rst.txt
- [GEOS-PTD] GEOS ProppantTransport parameter table: https://geosx-geosx.readthedocs-hosted.com/en/latest/_sources/docs/sphinx/datastructure/ProppantTransport.rst.txt
- [GEOS-SLOT] GEOS Proppant Slot Test example: https://geosx-geosx.readthedocs-hosted.com/en/latest/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/proppantSlotTest/Example.html and input https://github.com/GEOS-DEV/GEOS/blob/develop/inputFiles/proppant/ProppantSlotTest_base.xml
- [FC04] Ferguson and Church, J. Sedimentary Research 74(6) (2004) 933-937: http://geoweb.uwyo.edu/geol5330/FergusonChurch_GrainSettling_JSR04.pdf
- [OF-SN] OpenFOAM SchillerNaumannDrag.C: https://cpp.openfoam.org/v13/SchillerNaumannDrag_8C_source.html
- [RZ-T] Table 1 (Richardson-Zaki exponents) in a 2007 open-access paper: https://www.redalyc.org/pdf/816/81620574002.pdf
- [REV] Barboza, Chen and Li, "A review on proppant transport modelling", J. Pet. Sci. Eng. 204 (2021) 108753, accepted manuscript: https://cronfa.swan.ac.uk/Record/cronfa56693/Download/56693__19706__fc460f1caa9a4a3f90eb8fd82d48ecd8.pdf
- [UFD] Economides, Oligney and Valko, Unified Fracture Design (2002), online copy: https://www.petroleumengineers.ru/sites/default/files/sample_chapters.pdf
- [KITP] Guazzelli, "Rheology of dense granular suspensions", KITP 2018 slides: https://online.kitp.ucsb.edu/online/suspensions-c18/guazzelli/pdf/Guazzelli_Suspensions18Conf_KITP.pdf
- [KC] De Paoli et al., arXiv:2310.04068, section 3 (Kozeny-Carman constants): https://arxiv.org/abs/2310.04068
- [KONA] Concha and Buerger, KONA Powder and Particle Journal 20 (2002) 38-70: https://www.jstage.jst.go.jp/article/kona/20/0/20_2002009/_pdf
- [USS-W] U.S. Silica White data sheet USS2001 (vendor): https://www.ussilica.com/sites/default/files/data-sheets/USS2001_US-Silica-Technical-Data-Sheet_US-Silica-White-Version-2.pdf
- [USS-100] U.S. Silica 100 Mesh product page (vendor): https://ussilica.com/products/us-silica-100-mesh
- [WO15] World Oil 2015 Proppant Tables (vendor data): https://www.worldoil.com/media/3025/proppant-tables-2015.pdf
- [MESH] Miedema, Slurry Transport, Appendix C, list of mesh sizes: https://eng.libretexts.org/Bookshelves/Civil_Engineering/Slurry_Transport_(Miedema)/11%3A_Appendices/11.03%3A_Appendix_C-_List_of_Mesh_Sizes
- [PYFRAC] https://github.com/GeoEnergyLab-EPFL/PyFrac ; [OPM] https://github.com/OPM/opm-simulators ; [MRST] https://github.com/SINTEF-AppliedCompSci/MRST
