# Hydraulic fracture propagation: landscape and verification benchmarks

Researched 2026-11-09 from vendor pages, vendor documentation, papers and official repositories.
Each claim has a source URL. "Not confirmed" means no primary source was opened that states it.
Vendor web pages were read through a text extractor, so vendor quotes are short phrases only.
Formulas in section 6 were read from the paper text, page images or repository source code, and
checked for volume balance (injected volume = fracture volume when there is no leak-off). Two
exceptions are labelled where they appear: the Nordgren row in 6.2 (recalled, no source opened)
and the plane-strain stress formula in 6.5 (derived for this note).

## 1. Novi Labs

- Data-driven forecasting and analytics. No fracture propagation physics was found.
- The product list on the home page is: Forecast Engine ("AI-powered production forecasting"),
  Model Engine ("Self-serve machine learning"), Data Engine, Novi Insights, Novi Intelligence,
  well and proprietary data products. Source: https://novilabs.com/
- Forecast Engine "leverages Novi's proprietary machine learning models"; the page calls the
  models "data-driven". Source: https://novilabs.com/energy-analytics/forecast-engine/
- Model Engine lets users "build powerful machine learning models" for forecasting without code.
  Source: https://novilabs.com/energy-analytics/model-engine/
- Spacing, geology and parent-child effects go into the forecasts as machine-learning inputs
  ("uniquely integrates these variables in ML forecasts"). Source:
  https://novilabs.com/faq/how-do-tools-incorporate-spacing-geology-and-parent-child-effects
- No mention of fracture propagation, fracture simulation, geomechanics or physics-based
  simulation was found on the four pages opened above.

## 2. whitson (whitson+)

- A petroleum-engineering platform for PVT, production analysis, RTA, numerical reservoir models
  and forecasting. It does not grow fractures: fracture dimensions are inputs.
- Module list in the user manual: PVT (fluid definition, EOS model, black-oil tables), bottomhole
  pressure, decline curve analysis, material balance (flowing and static), analytical RTA
  (classical, fractional), numerical RTA, numerical model (history matching, sensitivities,
  probabilistics), nodal analysis and gas lift, multi-well forecasting and type wells, well
  testing (DFIT, PTA, Chow pressure group), virtual PVT lab, gas EOR PVT. Source:
  https://manual.whitson.com/
- The numerical model is a gridded reservoir simulation with a static fracture. The manual says:
  "The OPM Flow reservoir simulator, an open-source simulator using Eclipse 100 input syntax, is
  the engine of the tool." Fracture half-length, fracture height, number of fractures and
  dimensionless fracture conductivity are user inputs or history-match parameters. Source:
  https://manual.whitson.com/modules/well-performance/reservoir-simulation/
- "Geomechanical effects" in the manual means pressure-dependent permeability (a gamma
  multiplier on matrix and fracture permeability), not stress or fracture mechanics. Same source.
- The DFIT module is an interpretation tool (G-function, closure stress, pore pressure,
  permeability). It analyses the pressure decline; it does not simulate propagation. Source:
  https://manual.whitson.com/modules/well-performance/dfit/
- No fracture propagation model (toughness, stress shadow between fractures, proppant transport)
  was found on the manual pages opened: reservoir-simulation, numerical-rta, dfit,
  multi-well-numerical-model. The company site whitson.com refused automated requests (HTTP 403),
  so its marketing pages are not confirmed.

## 3. ResFrac

Main source: McClure et al., "ResFrac Technical Writeup", arXiv:1804.02092, version 21 (14 June
2026), https://arxiv.org/abs/1804.02092 . Section numbers below refer to that version.
The vendor site calls it "The industry's only fully coupled hydraulic fracturing and reservoir
simulator" (https://www.resfrac.com/).

**What it models**

- Geometry and mesh (Sec. 2.1, 17). Planar fractures are the primary approach. Fracture elements
  are rectangles, all the same size (user sets length and aspect ratio). Matrix elements are
  cuboids on a rectilinear or corner-point grid, with no adaptive refinement. The well is a chain
  of line segments. Fracture and matrix meshes are non-conforming.
- Elasticity and stress shadow (Sec. 10.1). Stresses from opening use the 3D displacement
  discontinuity method of Shou et al. (1997) with constant-displacement rectangular elements, for
  an infinite, homogeneous, linear elastic medium. Layered moduli are handled only approximately
  (averaged modulus). An open element has fluid pressure equal to normal stress. Shear sliding of
  fractures is not computed. The same method gives stress shadow between fractures and stages.
- Propagation (Sec. 10.2). Linear elastic fracture mechanics: the tip advances when the stress
  intensity factor reaches toughness. Toughness can differ horizontally and vertically, by layer,
  and can grow with the square root of fracture size (a tuning parameter). A new element is added
  ahead of the tip; there is no remeshing. Fractures are straight by default; curving is optional.
- Front tracking (Sec. 10.3). A newer option, MuLTipEl (multi-layer tip elements), tracks the
  front continuously inside tip elements and accounts for stress layers thinner than an element.
- Height containment (Sec. 10.2). Mainly by stress contrast between layers; also by user-placed
  "frictional interfaces" with raised toughness.
- Fluid flow in the fracture (Sec. 5). One set of constitutive equations covers an open fracture
  (cubic law), a closed unpropped fracture (joint-closure law) and a proppant pack, with smooth
  transitions. It includes Darcy and non-Darcy flow, non-Newtonian fluid and multiphase flow.
- Leak-off (Sec. 2.1, 9.2, 22). Leak-off is real flow from fracture elements into matrix
  elements, computed with a 1D subgrid method so a coarse matrix mesh still gives the
  square-root-of-time behaviour. A filtercake model is included. It is tested against Carter's
  law, not built on it.
- Proppant (Sec. 8). Transport with bridging and screen-out, viscous drag, gravitational,
  hindered and clustered settling, gravitational convection, bed-load transport, bed slumping,
  trapping, flowback and wellbore proppant dynamics.
- Wellbore and perforations (Sec. 6). Momentum balance along the well with friction and
  hydrostatic head. Perforation pressure drop follows Cramer (1987), with perforation erosion
  (Long and Xu, 2017) and near-wellbore tortuosity. These terms distribute flow between clusters
  (limited entry).
- Reservoir flow (Sec. 3, 4, 14). Finite volume; one molar balance per component; black-oil or
  compositional fluid; Darcy flow in the matrix. Capillary pressure and non-Darcy flow in the
  matrix are neglected (Sec. 4.1). The same model runs fracturing, shut-in and production.
- Thermal and poroelastic (Sec. 3, 7, 11). Optional energy balance; optional poroelastic and
  thermoelastic stress change from depletion.

**Inputs the user must supply (Sec. 15)**

1. Versus depth: permeability, porosity, initial saturations, initial pressure, minimum
   principal stress. Also Young's modulus, Poisson's ratio, toughness and tensile strength per
   layer (Sec. 10.1, 23).
2. Well path, inner diameter, stage and cluster locations, perforation diameter and count.
3. Relative permeability curves per layer.
4. A fluid model: black-oil table or compositional description.
5. Injection schedule (rate, fluid type and viscosity, proppant type and concentration) and
   producing bottomhole pressure.
6. Orientation of the minimum principal stress.

**Typical workflow (Sec. 16, 20)**

1. Match the instantaneous shut-in pressure (ISIP) and, if known, fracture length by tuning
   toughness and its scale-dependence. The writeup advises against matching treating pressure
   during pumping first.
2. Optionally match wellhead pressure with a wellbore friction factor.
3. Match production by tuning relative permeability, matrix permeability, and propped and
   unpropped fracture conductivity. Restart files avoid rerunning the frac stage.
4. Run sensitivity analysis and Monte Carlo uncertainty runs on the matched model (Sec. 20).
   The writeup lists a separate tutorial for diagnostic fracture injection tests (DFIT) (Sec. 1).

**Its own test suite (Sec. 22)**: Sneddon crack stresses; radial and PKN propagation; Carter
leak-off; DFIT leak-off recovery; SPE1, SPE3, Norne; thermal and poroelastic solutions.

## 4. Other tools that model fracture propagation

Most model classes below come from vendor-returned factsheets in a UK Environment Agency review
of fracturing software (about 2018), cited as "EA review":
https://assets.publishing.service.gov.uk/media/619f8afee90e07043d677d6e/Review_of_software_used_by_the_oil_and_gas_industry_to_model_hydraulic_fracturing_-_report.pdf

| Tool | Model class | Coupling to reservoir flow | Sources |
|---|---|---|---|
| GOHFER (Barree, Halliburton) | Planar 3D, finite-difference grid ("not pseudo-three-dimensional") | Not confirmed. "Coupled" on the vendor page refers to fluid and solids inside the fracture | https://barree.net/resources/gohfer-software/ |
| Kinetix (SLB) | Three options: pseudo-3D (P3D), planar 3D by displacement discontinuity, and UFM (fracture network that interacts with natural fractures, built on the P3D approach, vertical branches) | Workflow link to the INTERSECT reservoir simulator; stress via VISAGE finite elements | https://www.slb.com/resource-library/blogs/di/modeling-hydraulic-fractures ; EA review |
| Mangrove (SLB) | "Unconventional fracture modeling" on natural-fracture scenarios inside Petrel. Planar options not confirmed | Production modelling in the same workflow; simulator not confirmed | https://www.slb.com/resource-library/case-study-with-navigation/st/mangrove-western-canada-cs |
| StimPlan (NSI) | Pseudo-3D quick-look plus finite-element planar 3D ("fully 3D" in vendor words means gridded planar) | Built-in single-phase 3D reservoir simulator | EA review ; https://www.petroleumengineers.ru/sites/default/files/nsi-stimplan-software-profile-revised-2.pdf (NSI sheet on a third-party host) |
| FracPro (LINQX) | Not confirmed. Vendor says "3-D hydraulic fracture modeling" | Exports geometry to CMG, Eclipse | https://linqx.io/solutions/fracpro/ |
| MFrac / MShale (Baker Hughes) | MFrac: planar pseudo-3D. MShale: discrete fracture network with user-set orthogonal network spacing | Single-phase analytical production tool (MProd); export to reservoir simulators | EA review ; https://dam.bakerhughes.com/m/49f680603e77b666/original/Jewelsuite-Reservoir-Stimulation-MFrac-Suite.pdf |
| XSite (Itasca) | 3D lattice method derived from the distinct element method; handles natural-fracture networks | Own fracture and matrix flow; exports upscaled properties to reservoir simulators. Multiphase not confirmed | https://www.itascacg.com/software/xsite ; https://www.itascacg.com/software/xsite-background |
| FrackOptima | Three codes: non-planar 3D, planar 3D, plane strain. Numerical method not stated | Not confirmed (leak-off only) | http://frackoptima.com/software (pages dated 2014) |
| CMG GEM | Compositional reservoir simulator with coupled finite-element geomechanics. Class of its propagation model not confirmed. CMG also imports geometry from GOHFER, StimPlan, FracPro | It is the reservoir simulator (multiphase) | https://www.cmgl.ca/solutions/software/gem/ ; https://www.cmgl.ca/resources/integrate-third-party-hydraulic-fracturing-tools/ |
| tNavigator (RFD) | "a full P3D fracture propagation simulator". Whether P3D means pseudo-3D is not spelled out | Integrated with its own reservoir simulator and coupled geomechanics | https://rfdyn.com/wp-content/uploads/2024/10/tNavigator-for-Unconventional-Reservoirs.pdf |
| Elfen TGR (Rockfield) | Finite element with discrete fracturing and local remeshing; "True 3D fracture propagation with arbitrary non-planar paths" | Internal flow in fractures and matrix. Multiphase not confirmed | https://www.rockfieldglobal.com/software/elfen-tgr-hydraulic-fracturing/ |

For contrast, the ResFrac writeup states why it stays planar and does not model complex
fracture networks (Sec. 17, https://arxiv.org/abs/1804.02092).

## 5. Open-source codes to learn from or test against

Licences and dates were read from the repositories on 2026-11-09 (GitHub, GitLab, Dryad APIs).

**Propagation simulators**

| Code | Licence | Language | Model class | Maintained? | Link |
|---|---|---|---|---|---|
| PyFrac (EPFL) | GPL v3 or later per README and LICENSE.TXT; the licence file adds extra clauses and a commercial offer, and GitHub detects no standard licence. Read it before reuse | Python, optional C++ kernel | Planar 3D, implicit level set front tracking with multiscale tip asymptote; toughness, viscosity, Carter leak-off, stress layers, closure. No reservoir coupling seen | Last push 2026-09-10. README says no support capacity | https://github.com/GeoEnergyLab-EPFL/PyFrac |
| GEOS (LLNL, Stanford, TotalEnergies) | LGPL-2.1 | C++ | Fully 3D finite-element mechanics with finite-volume fracture flow; fractures grow by splitting element faces (`HydrofractureSolver`, `SurfaceGenerator`). Also phase-field and embedded-fracture solvers, and a proppant transport solver. Multiphase flow coupled to a growing fracture: not confirmed | Very active (pushes daily) | https://github.com/GEOS-DEV/GEOS |
| OpenGeoSys 6 | BSD-3-style | C++ | Phase-field hydro-mechanical fracture (`HMPhaseField`), with a KGD test case | Active, release 6.5.9 in 2026-09 | https://gitlab.opengeosys.org/ogs/ogs ; https://www.opengeosys.org/docs/benchmarks/phase-field/ |
| PhiPsi | MIT | Fortran | XFEM, 2D and 3D hydraulic fracturing with natural fractures (per README) | Last commit 2026-07 | https://github.com/PhiPsi-Software/PhiPsi |
| EP3D-HF-simulator (Dontsov) | Permissive, MIT-like text | MATLAB/Octave | Enhanced pseudo-3D with symmetric stress barriers (Dontsov and Peirce 2015) | Last commit 2021-11 | https://github.com/egordontsov/EP3D-HF-simulator |
| HMPhaseField | MIT | Julia scripts, not a package | 2D phase-field hydraulic fracture in porous media | Last commit 2026-01 | https://github.com/hhutyou/HMPhaseField |

GEOS verification pages (KGD toughness and viscosity, penny toughness and viscosity, PKN, KGD
against a laboratory test, proppant slot test):
https://geosx-geosx.readthedocs-hosted.com/en/latest/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/Index.html

**Reference-solution codes (fast, for tests)**

| Code | Licence | What it gives | Link |
|---|---|---|---|
| Dontsov rapid solutions: KGD, radial, PKN | Permissive, MIT-like text; MATLAB/Octave; last commit 2021-11 | Length, width, efficiency versus time for any toughness, viscosity and leak-off, plus the four limits | https://github.com/egordontsov/KGD-HF-rapid-solution ; https://github.com/egordontsov/Radial-HF-rapid-solution ; https://github.com/egordontsov/PKN-HF-rapid-solution |
| Dryad data set for Dontsov (2016) | CC0 | Closed-form radial and KGD solution code | https://doi.org/10.5061/dryad.gh469 |
| PyFrac `HF_reference_solutions.py` | as PyFrac | Radial M, K, M~, K~; PKN; KGD K | https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/src/HF_reference_solutions.py |
| hydraulic-fracture-benchmarks | MIT | Notebooks and CSV data against KGD limits | https://github.com/hhutyou/hydraulic-fracture-benchmarks |
| StressCorrectedAsymptote (Valov, Dontsov) | MIT, Python | Tip asymptote across stress layers | https://github.com/alexander-valov/StressCorrectedAsymptote |

**Julia.** No registered Julia package for hydraulic fracture propagation was found.
JutulDarcy.jl (MIT) has a discrete fracture model for flow in static fractures (`src/DFM/`); a
code search for "geomechanics" and "poroelastic" in it returned nothing.
https://github.com/sintefmath/JutulDarcy.jl . Jutul.jl and Fimbul.jl likewise have static
embedded or pre-defined fractures only. https://github.com/sintefmath/Jutul.jl ;
https://github.com/sintefmath/Fimbul.jl

**MRST** (GPL-3.0, MATLAB, active). Fracture modules are static-fracture flow only: `hfm`
(embedded discrete fractures), `dfm`, `shale` (projection-based embedded fractures), dual
porosity. Mechanics modules (`ad-mechanics`, `vemmech`, and others) have no fracture growth. No
propagation module was found. https://github.com/SINTEF-AppliedCompSci/MRST

**Not public.** Peirce's ILSA MATLAB code, C2Frac/C3Frac, HFPx, FRACOD: no public source found.

## 6. Verification benchmarks with formulas

### 6.0 Symbols and conventions

| Symbol | Meaning |
|---|---|
| E' | plane-strain modulus, E' = E / (1 - nu^2) |
| mu' | mu' = 12 mu (mu = fluid viscosity) |
| K' | K' = 4 (2/pi)^(1/2) K_Ic = (32/pi)^(1/2) K_Ic, about 3.192 K_Ic |
| C' | C' = 2 C_L (C_L = Carter leak-off coefficient, m/s^0.5) |
| Q0 | constant injection rate. Radial and PKN: total volumetric rate (m^3/s), both wings. KGD: total rate per unit fracture height (m^2/s), both wings |
| l, R | fracture half-length (KGD, PKN) or radius |
| H | fracture height (PKN) |
| xi, rho | x / l or r / R |

These definitions are equation 2.1 of Dontsov (2016),
https://pmc.ncbi.nlm.nih.gov/articles/PMC5210692/ , and the same K' and mu' are used by Lecampion
et al. (2013), https://personal.math.ubc.ca/~peirce/Lecampion_et_al_BenchmarkPaper_2013.pdf .
GEOS writes K_p = 8 / (2 pi)^(1/2) K_Ic, which is the same number as K'.

Older petroleum texts use shear modulus G and (1 - nu) instead: G / (1 - nu) = E' / 2. They also
often use the rate into one wing, q = Q0 / 2. Check both before comparing coefficients.

A cheap check for any no-leak-off solution: the integral of width over the fracture area must
equal Q0 t. The Dontsov and PyFrac no-leak-off formulas below were checked this way and pass to
within 0.3 percent (the GEOS inlet-only values cannot be checked like this).

### 6.1 Carter leak-off

- Leak-off velocity through one fracture face: u_L = C_L / sqrt(t - t0(x)), where t0(x) is the
  time the front first reached point x.
- Sink term in the width equation (both faces): C' / sqrt(t - t0(x)).
- Cumulative leaked volume per unit fracture area (both faces): 2 C' sqrt(t - t0(x)).
- Source: Dontsov (2016), equations 2.2 and 2.6, https://pmc.ncbi.nlm.nih.gov/articles/PMC5210692/
- Spurt loss (an extra instant volume per area) is not in these papers' models. ResFrac tests
  its matrix leak-off against Carter's law (writeup Sec. 22, test 11).

### 6.2 PKN (constant height H, length much greater than H)

Model assumptions: each vertical section is an ellipse in plane strain.
w(x, y) = (4/pi) wbar(x) sqrt(1 - (2y/H)^2); net pressure p(x) = 2 E' wbar(x) / (pi H), which is
the same as p = E' w_max / (2H). wbar is the height-averaged width; maximum width is
(4/pi) wbar. Source: Dontsov, "Analysis of a constant height hydraulic fracture",
arXiv:2110.13088, equation 1, https://arxiv.org/abs/2110.13088 . In that paper Q0 is the total
rate (each wing gets Q0/2) and l is the half-length.

**No leak-off, viscosity-dominated (M)** — Dontsov (2021), equations 20, 25, 26:

    l(t)       = 0.3817 (E' Q0^3 / (mu H^4))^(1/5) t^(4/5)
                 [paper prints 0.38; exact form c (5 / (48 pi^3))^(1/5), c = (224/167)^(3/5) = 1.193]
    wbar(x,t)  = 1.76 (mu Q0^2 / (E' H))^(1/5) t^(1/5) (1 - xi)^(1/3) (1 - (1 - xi)/96)
    p(x,t)     = 1.12 (mu E'^4 Q0^2 / H^6)^(1/5) t^(1/5) (1 - xi)^(1/3) (1 - (1 - xi)/96)
    at the inlet: wbar = 1.742, w_max = 2.218, p = 1.108 times the same groups

Note this uses mu, not mu'. The paper calls it an approximate solution (the inlet condition is
not met exactly) that matches Economides and Nolte, Reservoir Stimulation, "to within a few
percent".

The same case in other sources:

| Source | l coefficient | inlet max width coefficient | Notes |
|---|---|---|---|
| Dontsov 2021 (above) | 0.3817 | 2.218 | total rate, E' |
| PyFrac `PKN_solution` | 1.001 (Q0^3 E' t^4 / (4 pi^3 mu H^4))^(1/5) = 0.3817 | wbar(0) = 1.326 (pi^3 mu Q0^2 t / (8 E' H))^(1/5), so w_max = 2.214 | cites Perkins-Kern in the paper; profile (1 - xi)^(1/3) |
| GEOS docs | 0.3817 | w0 = 3 (mu Q0 l / E')^(1/4) = 2.358 ; p0 = (16 mu Q0 E'^3 l / (pi H^4))^(1/4) = 1.181 | cites Kovalyshen and Detournay (2010) and Economides and Nolte |
| Nordgren (1972), recalled by the author of this note; NO SOURCE OPENED | L = 0.68 [G q^3 / ((1 - nu) mu h^4)]^(1/5) t^(4/5) | w(0) = 2.5 [(1 - nu) mu q^2 / (G h)]^(1/5) t^(1/5) ; p = 2.5 [G^4 mu q^2 / ((1 - nu)^4 h^6)]^(1/5) t^(1/5) | NOT CONFIRMED. If q is the rate per wing (Q0/2) these convert to 0.391, 2.18, 1.09, within 2 percent of Dontsov. Do not use as a reference without the paper |

Sources: https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/src/HF_reference_solutions.py ;
https://github.com/GEOS-DEV/GEOS/blob/develop/src/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/pknFracViscosityDominated/Example.rst

Disagreement to note: length agrees everywhere (0.38 to 0.39). Inlet width and pressure in the
GEOS documentation are about 6 percent higher than Dontsov and PyFrac. A likely reason (an
inference, not sourced): the GEOS width formula has the form of a steady-flow result, while the
others include fluid storage along the fracture. Use length as the primary check.

**Large leak-off, viscosity-dominated (M~)** — Dontsov (2021), equations 29, 31, 32:

    l(t)      = Q0 t^(1/2) / (pi C' H)          [= q t^(1/2) / (pi C_L H) with q per wing]
    wbar(x,t) = (2 pi mu Q0^2 / (E' C' H))^(1/4) t^(1/8) g(xi)
    p(x,t)    = (32 mu E'^3 Q0^2 / (pi^3 C' H^5))^(1/4) t^(1/8) g(xi)
    g(xi)     = [ xi (asin(xi) - pi/2) + sqrt(1 - xi^2) ]^(1/4),   g(0) = 1

The paper states this "coincides precisely" with Economides and Nolte. Nordgren's original
large-leak-off formulas were not opened: NOT CONFIRMED.

**Toughness-dominated limits** — Dontsov (2021), equations 35 and 38. Width and pressure are
uniform along the fracture:

    wbar = K_Ic sqrt(pi H) / E'        p = 2 K_Ic / sqrt(pi H)
    no leak-off (K):     l = E' Q0 t / (sqrt(4 pi) K_Ic H^(3/2))
    large leak-off (K~): l = Q0 t^(1/2) / (pi C' H)

**Regime parameters** — Dontsov (2021), equations 43, 45, 46:

    tau = t / t*,  t* = H^(7/2) K_Ic^5 / (2 pi^(1/2) E'^4 mu Q0^2)
    phi = (H^5 K_Ic^6 C'^4 / (4 pi^3 E'^4 mu^2 Q0^4))^(1/4)
    no leak-off:  K valid for tau < 0.11 ; M reached for tau > 2.3e3
    K to K~ :     tau phi^2      from 5.7e-5 to 3.1e3
    K~ to M~ :    tau phi^-2     from 0.18 to 6.5e4
    M to M~ :     tau phi^(10/3) from 2.0e-7 to 2.9e3

A PKN fracture starts at K and ends at M~, the reverse of a radial fracture. The ResFrac writeup
(equation 10-3) and arXiv:2110.13347 (equation 11) use the same tau, rounded to 0.1 and 2e3.

### 6.3 KGD (plane strain)

Scaling (Lecampion et al. 2013, equation 1,
https://personal.math.ubc.ca/~peirce/Lecampion_et_al_BenchmarkPaper_2013.pdf ):

    l = gamma (E' Q0^3 t^4 / mu')^(1/6)
    w = Omega (mu' Q0^3 t^2 / E')^(1/6)
    p = Pi (mu' E'^2 / t)^(1/3)
    dimensionless toughness: K_m = K' / (E'^(3/4) mu'^(1/4) Q0^(1/4))

Without leak-off K_m does not change with time, so a KGD fracture stays in one regime. The same
paper states the viscosity solution is the hard case numerically and compares codes at
K_m = 0.01, 0.1 and 0.5. (The paper's printed pressure scale shows mu'^(2/3); dimensions require
mu'^(1/3) as written here.)

The four limits below are from Dontsov's own code for his 2017 plane-strain approximate
solution (Int. J. Fracture 205:221, doi 10.1007/s10704-017-0192-4; the paper is paywalled and
was not opened): file `KGDVertexSolutions.m`,
https://github.com/egordontsov/KGD-HF-rapid-solution . Its driver sets K' = sqrt(32/pi) K_Ic,
mu' = 12 mu, C' = 2 C_L and passes Q0 / H as the rate.

**Viscosity-dominated (M, K_m -> 0)**

    l(t)     = 0.6159 (Q0^3 E' t^4 / mu')^(1/6)
    w(x,t)   = 1.1265 (mu' Q0^3 t^2 / E')^(1/6) (1 + xi)^0.588 (1 - xi)^(2/3)
    pressure: not in the code. GEOS gives w0 p0 = 0.62 (mu' Q0 E')^(1/2) at the inlet.

The same limit in the GEOS documentation, citing Adachi and Detournay (2002):
l = 0.6152 (E' Q0^3 / mu')^(1/6) t^(2/3); w0^2 = 2.1 (mu' Q0 / E')^(1/2) l, which gives
w0 = 1.137 (mu' Q0^3 / E')^(1/6) t^(1/3); w0 p0 = 0.62 (mu' Q0 E')^(1/2), which gives
p0 = 0.545 (mu' E'^2 / t)^(1/3). Source:
https://github.com/GEOS-DEV/GEOS/blob/develop/src/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/kgdViscosityDominated/Example.rst
Disagreement: length 0.6159 against 0.6152 (0.1 percent); inlet width 1.1265 against 1.137
(1 percent, and the GEOS figure comes from a two-digit coefficient). The paywalled originals
(Adachi and Detournay 2002; Detournay 2004; Garagash) were not opened, so which inlet width is
closer to theirs is NOT CONFIRMED.

**Viscosity, large leak-off (M~)**

    l(t)     = 0.3183 Q0 t^(1/2) / C'                         [0.3183 = 1/pi]
    w(x,t)   = 0.8165 (mu' Q0^3 t / (E' C'^2))^(1/4) (1 + xi)^0.520 (1 - xi)^(5/8)

**Toughness, large leak-off (K~)**

    l(t)     = 0.3183 Q0 t^(1/2) / C'
    w(x,t)   = 0.3989 (K'^4 Q0^2 t / (E'^4 C'^2))^(1/4) sqrt(1 - xi^2)

Pressures for M~ and K~ are not in the code. For K~ the pressure is uniform and follows from
w0 p0 = K'^2 / (8 E').

**Toughness-dominated, no leak-off (K, K_m -> infinity)** — exact; uniform pressure, elliptic
opening:

    l(t)     = (2 / pi^(2/3)) (E' Q0 t / K')^(2/3)            = 0.9324 (E' Q0 t / K')^(2/3)
    w(x,t)   = pi^(-1/3) (K'^2 Q0 t / E'^2)^(1/3) sqrt(1 - xi^2) = 0.6828 (...) sqrt(1 - xi^2)
    p(t)     = (pi^(1/3) / 8) (K'^4 / (E' Q0 t))^(1/3)        = 0.1831 (K'^4 / (E' Q0 t))^(1/3)
    equivalent: w0 = (K'/E') sqrt(l/2),  w0 p0 = K'^2 / (8 E')

Sources: GEOS documentation (citing Bunger et al. 2005), written with
X = (256 / (3 pi^2)) K_Ic^4 / (mu Q0 E'^3) = K_m^4:
https://github.com/GEOS-DEV/GEOS/blob/develop/src/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/kgdToughnessDominated/Example.rst ;
PyFrac `KGD_solution_K` (0.932388, 0.682784, 0.183074):
https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/src/HF_reference_solutions.py .
Dontsov's code gives the same 0.9324 and 0.6828. In the PyFrac function, length and width use
rate per unit height (Q0 / height) but the pressure line uses Q0; treat that line with care.

**Which regime**, from `PlotKGDParametricSpace.m` in the same repository (boundary values as
coded; the paper's wording of them was not opened):

    K_m   = (K'^4 / (mu' Q0 E'^3))^(1/4)         tau = t / t_mm~ ,  t_mm~ = mu' Q0^3 / (E' C'^6)
    M to K (small tau):    M for K_m < 0.70 ; K for K_m > 4.80
    M~ to K~ (large tau):  M~ for K_m < 0.90 ; K~ for K_m > 4.80
    M to M~ :              M for tau < 1.21e-13 ; M~ for tau > 2.36e6
    K to K~ :              K for tau K_m^-4 < 1.25e-14 ; K~ for tau K_m^-4 > 1.76e5

### 6.4 Radial (penny-shaped)

All four limits and the regime map are from Dontsov (2016), R. Soc. Open Sci. 3:160737, open
access: https://pmc.ncbi.nlm.nih.gov/articles/PMC5210692/ (equations 4.7, 4.15, 4.21, 4.28).
F(rho, lambda, delta) is a pressure shape function defined by an integral (equation 3.6) and
evaluated numerically.

**Viscosity, no leak-off (M)**

    R(t)     = 0.6944 (Q0^3 E' t^4 / mu')^(1/9)
    w(rho,t) = 1.1901 (mu'^2 Q0^3 t / E'^2)^(1/9) (1 + rho)^0.487 (1 - rho)^(2/3)
    p(rho,t) = 2.4019 (mu' E'^2 / t)^(1/3) F(rho, 0.487, 2/3)

**Toughness, no leak-off (K)** — exact

    R(t)     = (3 / (sqrt(2) pi))^(2/5) (E' Q0 t / K')^(2/5)   = 0.8546 (...)
    w(rho,t) = (3 / (8 pi))^(1/5) (K'^4 Q0 t / E'^4)^(1/5) sqrt(1 - rho^2) = 0.6537 (...)
    p(t)     = (pi/8) (pi/12)^(1/5) (K'^6 / (E' Q0 t))^(1/5)   = 0.3004 (...)

**Viscosity, large leak-off (M~)**

    R(t)     = (sqrt(2)/pi) (Q0^2 t / C'^2)^(1/4)              = 0.4502 (...)
    w(rho,t) = 1.0574 (mu'^4 Q0^6 t / (E'^4 C'^2))^(1/16) (1 + rho)^0.397 (1 - rho)^(5/8)
    p(rho,t) = 3.0931 (mu'^4 E'^12 C'^6 / (Q0^2 t^3))^(1/16) F(rho, 0.397, 5/8)

**Toughness, large leak-off (K~)** — exact

    R(t)     = 0.4502 (Q0^2 t / C'^2)^(1/4)
    w(rho,t) = 0.4744 (K'^8 Q0^2 t / (E'^8 C'^2))^(1/8) sqrt(1 - rho^2)
    p(t)     = 0.4139 (K'^8 C'^2 / (Q0^2 t))^(1/8)

**Which regime** (Dontsov 2016, equations 5.1 to 5.12). A radial fracture starts at M and ends
at K~.

    t_mk  = (mu'^5 E'^13 Q0^3 / K'^18)^(1/2)     tau = t / t_mk
        M valid for tau < 4.54e-2 ; K reached for tau > 2.59e6 (no leak-off)
    t_mm~ = (mu'^4 Q0^6 / (E'^4 C'^18))^(1/7)
        M valid for t / t_mm~ < 7.41e-6 ; M~ reached for t / t_mm~ > 7.20e2
    t_kk~ = (K'^8 Q0^2 / (E'^8 C'^10))^(1/3)
        K valid for t / t_kk~ < 5.96e-8 ; K~ reached for t / t_kk~ > 4.81e2
    leak-off parameter: phi = mu'^3 E'^11 C'^4 Q0 / K'^14

Dimensionless toughness is K_m = tau^(1/9) (Lecampion et al. 2013, section 2.2). That paper
uses looser limits: the M solution "up to" K_m = 1 and toughness regime near K_m = 3.5
(tau about 70000). The difference is the error tolerance, not the physics.

**Sources disagree in the third digit for the M limit**

| Source | R coefficient | w(0) coefficient |
|---|---|---|
| Dontsov 2016 approximation | 0.6944 | 1.1901 |
| Savitski and Detournay (2002), as reproduced in GEOS docs (original paywalled, not opened) | 0.6955 | 1.1977 |
| PyFrac `M_vertex_solution` (code) | 0.6976 | 1.1953 (evaluated from the code's series) |
| Economides and Nolte eq. 6C-5, as quoted in ResFrac writeup eq. A1 | R = 0.52 [E Q^3 / ((1 - nu^2) mu)]^(1/9) t^(4/9), i.e. 0.52 with mu instead of mu' ; 0.6955 / 12^(1/9) = 0.528 | not given |

Sources: https://github.com/GEOS-DEV/GEOS/blob/develop/src/docs/sphinx/advancedExamples/validationStudies/hydraulicFracture/pennyFracViscosityDominated/Example.rst ;
https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/src/HF_reference_solutions.py ;
https://arxiv.org/abs/1804.02092 (Sec. 22). Spread is 0.5 percent in radius (1.5 percent for the
two-digit 0.52). A test tolerance tighter than about 1 percent on radius must name which
reference it uses. The GEOS page also gives the Savitski-Detournay inlet-singular pressure shape
Pi(xi) = A1 [2.479 - 2 / (3 (1 - xi)^(1/3))] - B [ln(xi/2) + 1], A1 = 0.3581, B = 0.09269.

The K limit agrees in all sources (GEOS pennyFracToughnessDominated page, PyFrac
`K_vertex_solution`, Dontsov). ResFrac writeup equation A4 as printed omits K_Ic; from its own
A2 and A3 the result is R = [3 Q t E' / (8 sqrt(pi) K_Ic)]^(2/5), which equals the 0.8546 form.

**All regimes at once.** Dontsov (2016) builds a closed-form approximation for any toughness,
viscosity and leak-off: width w = ((1 + rho)/2)^lambda (1 - rho)^delta w_a, where w_a comes from
the three-process tip asymptote, plus global volume balance, solved as two algebraic equations
(equation 3.12) for each time. Stated accuracy: "within a fraction of a per cent". Code:
https://github.com/egordontsov/Radial-HF-rapid-solution and Dryad doi:10.5061/dryad.gh469,
https://datadryad.org/dataset/doi:10.5061/dryad.gh469 . The PKN and KGD equivalents are
https://github.com/egordontsov/PKN-HF-rapid-solution and
https://github.com/egordontsov/KGD-HF-rapid-solution . PyFrac's
paper uses that code as its reference for the M to K~ transition test (arXiv:1908.10788, Fig. 3).

### 6.5 Static checks (no propagation) and stress shadow

- Uniformly pressurised circular crack, net pressure dp, radius R: volume
  V = 16 R^3 (1 - nu^2) dp / (3 E) and K_I = 2 dp sqrt(R / pi). Source: ResFrac writeup
  equations A2, A3, https://arxiv.org/abs/1804.02092 .
- Stress around a pressurised crack, Sneddon (1946): ResFrac's first validation test holds a
  circular crack at constant pressure and compares stresses on a grid of points with Sneddon's
  solution (writeup Sec. 22 test 1; Sec. 10.1 shows the near-element artefacts of the
  displacement discontinuity method). The Sneddon formulas themselves were not opened.
- Plane-strain version, useful for a height-contained fracture: on the line through the centre,
  normal to a crack of half-height a with net pressure dp, the added normal stress at distance s
  is d_sigma = dp [1 - s^3 / (s^2 + a^2)^(3/2)]. This is a derivation for this note from the
  Westergaard stress function; the same expression appears in US patent 10,753,181
  (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10753181, not opened in
  full). Treat as NOT CONFIRMED against Sneddon's paper.
- Several parallel propagating fractures: no closed-form solution was found. The one
  reproducible case found is code-to-code and qualitative: Dontsov, arXiv:2110.13347, Table 1
  and Figures 3 and 4 (https://arxiv.org/abs/2110.13347), run in ResFrac. Five fractures grow
  at once in an 80 m layer, nu = 0.25, no leak-off, t = 1 h, spacing swept from 10 m to 160 m:

  | Case | K_Ic (MPa m^0.5) | E (GPa) | mu (Pa s) | Q0 (m^3/s) | tau |
  |---|---|---|---|---|---|
  | K | 5 | 10 | 0.003 | 0.1 | 0.35 |
  | MK | 3 | 10 | 0.01 | 0.1 | 15 |
  | M | 3 | 25 | 0.05 | 0.2 | 1.2e4 |

  Expected result: toughness case gives irregular fractures that avoid each other; viscosity
  case gives near-identical fractures; at spacing of twice the height there is "almost no
  interaction". There are no reference numbers to match, only fracture shapes. For the radial
  case the paper cites Dontsov and Suarez-Rivera (2020, Int. J. Rock Mech. Min. Sci.
  128:104270, not opened). A quantitative benchmark for stress shadowing between propagating
  fractures: NOT CONFIRMED.

### 6.6 Planar-3D benchmarks with height containment

- PyFrac, radial to PKN transition (Zia and Lecampion 2020, arXiv:1908.10788, section 5.2,
  https://arxiv.org/abs/1908.10788). Three layers: 1 MPa in the middle, 7.5 MPa above and below.
  E' = 35.2 GPa, K_Ic = 0, mu = 1.1e-3 Pa s, Q = 1e-3 m^3/s. Start domain [-20, 20] x
  [-2.3, 2.3] m, 125 x 35 cells, remeshed to double size. Result follows the radial M solution
  first, then the PKN solution. Script:
  https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/examples/Ex2_height_contained_CPC.py
  (the script sets E = 33 GPa, nu = 0.4, barriers at |y| > 3 m, which gives E' = 39.3 GPa, not
  the paper's 35.2 GPa; check before reuse).
- Laboratory benchmark, Wu, Bunger, Jeffrey and Siebrits (2008, ARMA): fracture between two
  PMMA blocks growing into a lower-stress zone. E = 3.3 GPa, nu = 0.4, K_Ic = 0, no leak-off;
  stresses 11.2, 7 and 5 MPa in three zones with boundaries at -25 mm and +25 mm. Parameters as
  given by Valov, Dontsov, Baykin and Golovin, arXiv:2305.13714, section 5.2
  (https://arxiv.org/abs/2305.13714). PyFrac script (mu = 30 Pa s, stepped rate):
  https://github.com/GeoEnergyLab-EPFL/PyFrac/blob/master/examples/Experiment_Wu_et_al.py
- Valov et al. (same paper) also test a constant-height fracture against an enhanced-PKN
  reference with mesh convergence, and radial fractures against the limits in 6.4
  (Q0 = 0.01 m^3/s for 1000 s).
- ResFrac mesh-sensitivity tests (writeup Sec. 10.3, Tables 1 and 2): radial and constant-height
  cases in M, transition and K regimes, meshes from 5 ft to 160 ft, against Dontsov (2016) and
  Dontsov (2021). Constant-height set: H = 200 ft, E = 6e6 psi, nu = 0.25, Q0 = 20 bbl/min,
  t = 1 h. Table 2 prints K_Ic = 4000, 8000, 15000 psi in^0.5 with mu = 3, 30, 80 cP and
  tau = 4e3, 30, 0.2 for the M, transition and K columns. Source inconsistency: with those
  inputs the tau formula gives 140, 44 and 5. With the viscosity row reversed (80, 30, 3 cP) it
  gives 3.7e3, 44 and 0.19, which fits the printed tau. Assume the viscosity row is printed in
  reverse order, and recompute tau before using the table.
- ResFrac PKN tests (writeup Sec. 22 test 5): perfect height confinement at 328 ft; radial at
  first, then PKN; with and without leak-off, against Valko and Economides (1995) equations
  9.13, 9.41 and 9.42 (book, not opened).
- Layered elastic modulus: Peirce and Siebrits (2001) section 5.1 case, a uniformly pressurised
  crack across a thin stiff layer; reference lobe apertures 1.8 mm and 0.9 mm, ResFrac's
  approximate method gives 2.3 mm and 1.18 mm (writeup Sec. 10.1).
- A closed-form equilibrium-height formula for symmetric stress barriers (Simonson et al. 1978)
  is widely used as a static height check: NOT CONFIRMED here (no source opened).

Mesh note: Lecampion et al. (2013) find that codes using only the linear-elastic tip condition
need a fine mesh in the viscosity regime, while codes using the multiscale tip asymptote match
on a coarse mesh; they propose the KGD and radial limits as the minimum benchmark set.
https://personal.math.ubc.ca/~peirce/Lecampion_et_al_BenchmarkPaper_2013.pdf

## 7. Bottom line

Of the three, only ResFrac models fracture propagation from physics: planar 3D fractures with
linear elastic fracture mechanics, displacement-discontinuity stress shadowing, proppant
transport and a coupled multiphase reservoir (section 3). Novi Labs is machine-learning
forecasting and spacing analytics with no fracture mechanics found (section 1). whitson+ is PVT,
RTA and reservoir-model forecasting on OPM Flow, where fracture half-length and height are
inputs (section 2). Judgement, not sourced: the smallest credible first version is a single
planar fracture on a fixed rectangular grid in one homogeneous elastic layer, with
displacement-discontinuity elasticity, lubrication flow of one Newtonian fluid, Carter leak-off
and a toughness tip condition, and no proppant, no wellbore and no reservoir coupling. It should
pass, in this order: (a) static opening and volume of a pressurised circular crack (6.5);
(b) radial K limit, which is exact (6.4); (c) radial M limit to about 2 percent in radius, with
the reference named (6.4); (d) the M to K~ transition against Dontsov's 2016 approximation with
leak-off on; (e) a three-layer stress barrier case that goes radial then PKN (6.2, 6.6). KGD is
optional for a planar-3D code. Only after those pass is it worth replacing Carter leak-off with
flow into the reservoir grid, then adding a second fracture and checking the stress shadow
against a Sneddon-type static solution.
