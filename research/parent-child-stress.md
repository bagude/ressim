# Child fractures next to a depleted parent: what the model uses and where it comes from

Written 2026-11-10 for `src/parentchild.jl` and the two-wing mode of `src/multifrac.jl`.
Web sources were found by search on that date; where only a secondary source was seen, it says so.

## 1. Depletion lowers the closure stress

Rule used:

    change of least horizontal stress = A x change of pore pressure,   A = biot (1 - 2 nu) / (1 - nu)

This is the stress path of a wide, flat reservoir that cannot strain sideways (uniaxial strain) and whose
overburden load does not change. With biot = 0.7 and nu = 0.25, A = 0.467; with biot = 1 and nu = 0.2, A = 0.75.

- The formula in exactly this form (laterally extensive, homogeneous, isotropic reservoir, elastic properties
  close to the surrounding rock, vertical stress unchanged) is quoted in the patent text "Predicting changes in
  hydrofrac orientation in depleting oil and gas reservoirs" (US 7,848,895), a secondary source. The primary
  references usually cited are Geertsma (1957, 1966), Segall and Fitzgerald (1998), Addis (1997, SPE 38720) and
  Zoback, Reservoir Geomechanics, chapter 12. These were not opened; treat the citation chain as unverified.
- Field stress paths differ from the formula. Hettema et al. (2000) report measured ratios of 0.7 to 0.9 for
  uniaxial compaction of sandstone and note that the Groningen field departs from the uniaxial path; an AAPG
  abstract found in the same search says many reservoirs follow a path well below either ideal boundary
  condition. So A is an input (`biot`, `poisson`), not a prediction, and the default 0.467 is a mid value for
  tight rock, not a measurement.
- What the rule leaves out here: the stress change is taken as local (the stress at a point follows the pore
  pressure at that point). Real depletion around one fracture is a narrow zone, and the stress change of a narrow
  zone is smaller than the uniaxial value and spreads beyond it (it also turns the stress direction, which is
  why child fractures can curve). None of that is in the model.

## 2. Depletion raises leak-off

Rule used (the same one as `reservoir_leakoff` in `src/dfit.jl`, see `research/dfit-analysis.md`):

    C_L = (pressure in the fracture - pore pressure) x sqrt(k phi c_t / (pi mu))

so along a wing the coefficient is multiplied by

    (closure stress + its change - pore pressure) / (closure stress - initial pore pressure)
      = 1 + (1 - A) x (pressure drop) / (closure stress - initial pore pressure).

- This is leak-off controlled by flow in the rock (Carter's law with the coefficient written out for
  one-dimensional flow from a face at constant pressure; Howard and Fast 1957; Economides and Nolte, Reservoir
  Stimulation, chapter on fluid loss). An appendix of Wang and Sharma (arXiv 1710.06464) writes the leak-off
  velocity as (P_f - P_0) sqrt(k phi c_t / (pi mu t)), which has the same form. The search did not turn up a
  page that states the coefficient in exactly the units used here; the expression is the standard solution of
  the diffusion equation and is checked numerically in the `dfit_formulas` test.
- Left out: the fracture's net pressure (the closure stress stands in for the pressure in the fracture), filter
  cake and filtrate viscosity (both would make the dependence on pressure weaker, square root instead of
  linear), and any change of total compressibility when depleted rock is below the bubble point (more gas, more
  compressible, more leak-off than the rule gives).

## 3. What is known from the field and from other models

- Child fractures grow towards depleted parents: Agrawal and Sharma (URTeC 2018) and an SPE Hydraulic Fracturing
  Technology Conference paper (SPE-199700, 2020) both report asymmetric growth towards the depleted region in
  coupled models; a 2026 coupled study on an Eagle Ford case (SPE-230648) reports the same and ties it to the
  local pressure depletion and the stress change it causes. (Abstracts only were seen.)
- Mitigation by refilling the parent before the child is pumped (Zheng et al., SPE-195912) rests on the same
  mechanism: raise the parent's pore pressure, raise its stress, lose the pull.
- A paper titled "Advanced Modeling of Interwell Fracturing Interference: An Eagle Ford Shale Oil Study"
  (Marongiu-Porcu and co-authors) came up by title only; nothing is taken from it.

No published case was reproduced. The tests of this part of the code are checks of direction, symmetry, volume
balance and agreement with the one-wing solver in untouched rock.

## 4. The two-wing solver

The growth model normally solves one wing and mirrors it. With different rock on the two sides both wings are
solved as one fracture through the well: the cluster's rate (with perforation friction on the whole of it) enters
half into the first cell of each wing, and the face between those two cells carries fluid across by the same flow
rule as any other face. A change of the pay's closure stress along a wing enters the flow as part of the fluid
pressure. Because the barriers keep their stress, depleted pay holds the fracture in better: a cell whose stress
contrast is lambda times the one the cross-section table was built for reads the table at p / lambda and scales
area by lambda and conductance by lambda cubed. That rule is exact when toughness is zero (tested to round-off)
and stands for a toughness lambda times too large otherwise.

## 5. The frac hit

A hit is flagged when the wing towards the parent reaches as far as the tip of the nearest parent fracture.
After the hit the model lets the wing keep growing as if in rock. In the field the child's fluid then enters the
parent's fracture and well. The model has no such path, so what the wing does after the hit is not to be trusted,
and the geometry handed to the well model counts the child's wing only up to the parent's fracture tip.

Sources found by search (2026-11-10):
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7848895
- https://www.scribd.com/document/713564664/Hettema-2000
- https://www.searchanddiscovery.com/abstracts/html/1993/annual/abstracts/0189b.htm
- https://arxiv.org/pdf/1710.06464
- https://sharma.pge.utexas.edu/node/692
- https://sharma.pge.utexas.edu/node/718
- https://www.cmgl.ca/resources/coupled-geomechanical-analysis-of-parent-child-well-interactions-and-production-optimization-using-sealed-wellbore-pressure-monitoring-swpm/
- https://slb.com/resource-library/technical-paper/ost/spe-197078
