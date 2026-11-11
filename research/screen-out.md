# Proppant acting back on the flow (screen-out): relations used and where they come from

Written 2026-11-10 for `proppant_feedback = true` in `src/multifrac.jl` and `flow_factor` in `src/proppant.jl`.
Status of each source is stated. Nothing here was checked against a measured screen-out.

## 1. Slurry viscosity against concentration

Used: `mu_slurry / mu_fluid = 1 / (1 - c / c_max)^2.5`, c the grain volume fraction, c_max the fraction at which
grains touch (a full pack; 0.65 for pack porosity 0.35).

- Source as read: the Itasca 3DEC manual, section "Proppant transport", equation 11, which states that 3DEC
  "uses the relationship described in Mack and Warpinski (2000)" and gives exactly this form with exponent 2.5.
  https://docs.itascacg.com/pfc700/3dec/docproject/source/theory/fluid/fluid_proppant.html (read 2026-11-10).
- Original: Mack, M.G. and Warpinski, N.R. (2000), "Mechanics of hydraulic fracturing", chapter 6 of
  Economides and Nolte (eds.), Reservoir Stimulation, 3rd edition. NOT opened. So the formula is confirmed
  through one secondary source only.
- Other exponents are in use (the review by Adachi, Siebrits, Peirce and Desroches, 2007, Int. J. Rock Mech.
  Min. Sci. 44, 739-757, gives the same form with an exponent that differs between authors; that paper was
  not opened either, only its citation was confirmed). The exponent is a keyword (`slurry_exponent`).
- The form has no upper limit as c nears c_max. 3DEC caps c / c_limit at 0.9. Here the cap is physical: a
  part of the cross-section is never taken as slower than a full pack of the same width (next section).

## 2. A packed part of the cross-section

Used: flow through a full pack follows Darcy's law with the Kozeny-Carman permeability already in
`proppant.jl` (`pack_permeability`, k = d^2 phi^3 / (180 (1 - phi)^2), from research/proppant-models.md).
Per unit height an open slot of width w conducts w^3 / (12 mu) and a pack of the same width k w / mu, so the
pack keeps 12 k / w^2 of the slot's conductance: about 1e-5 for 0.2 mm sand in a 5 mm fracture.

- That a slurry channel goes over from slot (Poiseuille) flow to Darcy flow as the concentration nears a pack
  is the stated result of Dontsov and Peirce (2014), "Slurry flow, gravitational settling and a proppant
  transport model for hydraulic fractures", J. Fluid Mech. 760, 567-590 (abstract read; the paper's own
  blending function between the two was NOT used). Here the two regimes are simply joined: the viscosity
  relation of section 1 down to the pack value, then the pack value.

## 3. Three parts side by side

The cross-section is taken at its mean width (area / height), as the settling model does while pumping, and
split by height into clear fluid, laden slurry and bank. The three flow along the fracture under the same
pressure gradient, so their conductances add:

    factor = share_clear + share_laden * max((1 - c / c_max)^2.5, 12 k / w^2) + share_bank * 12 k / w^2

This is this model's own construction (parallel channels), not taken from a source. It is the simplest form
of "the bank narrows the flow path": a bank that fills 60% of the height leaves 40% of the conductance.
What it leaves out: the real cross-section is widest in the middle, so a bank in the narrow bottom takes
less than its height share of the conductance (this model overstates the effect of a low bank); the clear
layer over a bank flows faster than the mean and can carry grains along the top of the bank.

## 4. Tip screen-out

No rule of its own. Grains cannot enter a cell narrower than `bridge` grain diameters (already in the
transport model); fluid still can, and leak-off takes carrier fluid, so the cell in front of the narrow tip
gains grains until it is a pack. With the factor above, that cell then passes almost no fluid: the tip stops
and the fracture behind it stores the pumped fluid by widening, which is the standard description of a tip
screen-out (Nolte and Smith's pressure interpretation; Smith and others' tip-screen-out designs; not
re-opened here, described from general knowledge). The blocking-function treatment of bridging in Dontsov
and Peirce (2015, Int. J. Solids Struct. 63, 206-218; abstract read) is the careful version of the same
idea; it was not implemented.

## 5. Numerical form

The factor of each cell is computed from the proppant and the cross-section at the start of a time step and
held fixed during the step; a face between two cells carries the harmonic mean of their factors (two
half-cells in series). The dependence on the time step is tested by halving it.
