# Ressim scorecard

Generated 2026-11-10 from `validation/results.toml` (tier `full`, run 2026-11-10), `features.toml` and a search of the installed engine source (JutulDarcy 0.3.11, Julia 1.11.9). Do not edit by hand; rerun `validation/scorecard.jl`.

## Summary

- Validation tests: **75 of 77 pass**.
- Features: **32 verified here**, 20 run here with self-consistency checks only, 2 run here but miss a bar, 0 not run in this tier, 19 in the engine but not run here, 2 only in our research track, **19 absent**.
- "Verified here" means a test in this suite passed on this machine. Nothing else in this file is a claim of parity with any vendor.

## Validation tests

Three kinds of evidence. *exact*: a closed-form solution, independent of any simulator. *cross*: another simulator's published results shipped with the benchmark data (agreement, not proof). *self*: symmetry or mesh sensitivity of our own run (stable, not shown to be right).

| Test | Kind | Result | Measures (value / bar) | Cells | Steps (cut) | Seconds |
| --- | --- | --- | --- | --- | --- | --- |
| Single-phase depletion, infinite-acting (square-root-of-time flow) (`exact_slab_inf`) | exact | **pass** | cum 0.08% / 0.25%; curve 0.26% / 0.50%; month1 0.71% / 1.00% | 57 | 333 (0) | 34.12 |
| Single-phase depletion, transient to boundary-dominated (`exact_slab_trans`) | exact | **pass** | cum 0.10% / 0.25%; curve 0.27% / 0.50%; month1 0.76% / 1.00% | 42 | 333 (0) | 0.24 |
| Single-phase depletion, drained to the well pressure (`exact_slab_depl`) | exact | **pass** | cum 0.01% / 0.25%; curve 1.29% / 2.00%; month1 0.98% / 1.00% | 33 | 333 (0) | 0.23 |
| Robustness: 1e5 mD strip against 2.5 microdarcy rock (`robust_contrast_1e5`) | exact | **pass** | cum 0.10% / 0.25%; curve 0.27% / 0.50%; month1 0.76% / 1.00%; cut_fraction 0.00% / 5.00% | 42 | 334 (0) | 0.27 |
| Robustness: 1e6 mD strip against 2.5 microdarcy rock (`robust_contrast_1e6`) | exact | **pass** | cum 0.10% / 0.25%; curve 0.27% / 0.50%; month1 0.76% / 1.00%; cut_fraction 0.00% / 5.00% | 42 | 334 (0) | 0.21 |
| Two-phase water flood, Buckley-Leverett front (`exact_buckley_leverett`) | exact | **pass** | L1_1000 1.17% / 2.00%; L1_ratio 17.75% / 33.33%; front 0.71% / 1.00%; injected 0.00% / 0.20% | 1000 | 1000 (0) | 17.28 |
| Fracture growth: fluid account with leak-off (`growth_volume_balance`) | exact | **pass** | balance 0.00% / 0.00% | 800 |  | 0.32 |
| Fracture growth without leak-off: length and opening against the similarity solution (`growth_no_leakoff`) | exact | **pass** | L_exponent 0.13% / 1.00%; w_exponent 0.01% / 1.00%; length 0.27% / 1.00%; opening 0.01% / 1.00%; grid 0.22% / 1.00%; similarity_volume 0.00% / 0.01%; published_length 0.00% / 0.20%; published_opening 0.02% / 0.20%; balance 0.00% / 0.00% | 800 |  | 0.38 |
| Fracture growth with heavy leak-off: length against the leak-off limit (`growth_leakoff_limit`) | exact | **pass** | length 2.89% / 3.00%; balance 0.00% / 0.00% | 800 |  | 0.45 |
| Height growth: cross-section formulas (stress intensity, area, opening) checked against each other (`height_section_formulas`) | exact | **pass** | uniform 0.00% / 0.10%; area 0.00% / 0.50%; tip 0.40% / 2.00%; interface 0.11% / 0.50% |  |  | 0.27 |
| Height growth with unbreakable barriers: must equal the constant-height model (`height_contained_limit`) | exact | **pass** | length 0.00% / 0.50%; pressure 0.00% / 0.50%; balance 0.00% / 0.00%; length_leakoff 0.00% / 0.50%; pressure_leakoff 0.00% / 0.50%; balance_leakoff 0.00% / 0.00% | 400 |  | 1.67 |
| Height growth through barriers: 870 psi and 435 psi stress contrast, and a barrier too weak to hold (`height_growth_barriers`) | self | **pass** | balance 0.00% / 0.00%; grid 0.91% / 2.00%; table 0.00% / 0.50%; table_height 0.00% / 0.50%; taller_when_weaker 0.00% / 50.00%; shorter_when_weaker 0.00% / 50.00%; runaway_reported 0.00% / 50.00% | 400 |  | 3.91 |
| Height growing through barriers: published laboratory-scale case at three toughness values (`height_growth_published`) | cross | **pass** | length_K0 0.03% / 3.00%; height_K0 0.73% / 3.00%; length_K1 0.15% / 3.00%; height_K1 0.04% / 3.00%; length_K094 0.33% / 3.00%; height_K094 0.79% / 3.00% | 400 |  | 1.6 |
| Stress shadow of one fracture on its neighbour: formula checks (`shadow_kernel`) | exact | **pass** | centre_line 0.00% / 0.00%; two_routes 0.00% / 0.00%; table 0.00% / 0.00%; height_average 0.04% / 0.10%; positive_definite 0.00% / 50.00%; positive_definite_grown 0.00% / 50.00% |  |  | 1.62 |
| Pressure drop through a cluster's perforations (`perforation_friction`) | exact | **pass** | by_hand 0.00% / 0.00%; published_constant 0.31% / 0.50% |  |  | 0.0 |
| A stage with one cluster must equal the single-fracture solver (with barriers, leak-off and proppant) (`multifrac_one_cluster`) | self | **pass** | length_contained 0.00% / 0.00%; pressure_contained 0.00% / 0.00%; height_contained 0.00% / 0.00%; proppant_contained 0.00% / 0.00%; leaked_contained 0.00% / 0.00%; length_barriers 0.00% / 0.00%; pressure_barriers 0.00% / 0.00%; height_barriers 0.00% / 0.00%; proppant_barriers 0.00% / 0.00%; leaked_barriers 0.00% / 0.00%; coupled_scheme_length 0.02% / 2.00%; coupled_scheme_height 0.06% / 2.00% | 200 |  | 3.25 |
| Two identical fractures side by side: must grow like one fracture in stiffer rock (`multifrac_pair_stiffer`) | exact | **pass** | length 0.55% / 1.00%; net_pressure 0.01% / 1.00%; shadow 0.07% / 1.00%; equal_split 0.00% / 0.00%; balance 0.00% / 0.00% | 300 |  | 2.44 |
| Three clusters far apart: equal shares, each the same as a fracture alone (`multifrac_far_apart`) | exact | **pass** | share 0.02% / 0.10%; length 0.00% / 0.10%; height 0.03% / 0.10% | 150 |  | 2.55 |
| Two clusters with 6 and 3 perforations, friction far above net pressure: the split must follow the perforation count (`multifrac_limited_entry`) | exact | **pass** | split 0.10% / 0.50%; friction 0.08% / 2.00% | 150 |  | 1.08 |
| Three and five clusters close together: the middle ones are squeezed, perforation friction evens the split (`multifrac_interaction`) | self | **pass** | mirror 0.00% / 0.00%; mirror_five 0.00% / 0.00%; reversal 0.00% / 0.00%; balance 0.00% / 0.00%; no_backflow 0.00% / 50.00%; assembly 0.00% / 0.00%; middle_squeezed 0.00% / 50.00%; friction_evens 0.00% / 50.00%; grid 0.00% / 2.00%; grid_length 1.28% / 2.00% | 150 |  | 21.25 |
| Five fractures 20 m apart against a planar-3-D reference (ILSA), with no perforation friction and with equal rates (`multifrac_published`) | cross | **pass** | share_outer 10.60% / 20.00%; share_inner 16.39% / 20.00%; share_middle 6.62% / 20.00%; total_area 13.92% / 15.00%; equal_rate_ratio 0.64% / 5.00%; equal_rate_total 10.86% / 15.00% | 200 |  | 14.75 |
| Stages with several clusters to production in one call: weak against strong perforation friction (`chain_clusters_to_production`) | self | **pass** | fractures 0.00% / 50.00%; shares_add_up 0.00% / 0.00%; mirror_growth 0.00% / 0.00%; friction_evens 0.00% / 50.00%; oil_positive 0.00% / 50.00% | 6480 | 109 (0) | 39.27 |
| Height in layered rock: cross-section formulas with unequal barriers, and equal barriers against the three-layer formulas (`layers_section_formulas`) | exact | **pass** | equal_top 0.00% / 0.00%; equal_bottom 0.00% / 0.00%; equal_area 0.00% / 0.00%; equal_flow 0.00% / 0.10%; area 0.00% / 0.00%; tip_up 0.27% / 2.00%; tip_down 0.03% / 2.00%; resting 0.00% / 0.00%; fluid_weight 0.56% / 2.00% |  |  | 3.02 |
| Height in layered rock with fluid weight: two published cases (three layers; six layers with a jump through a weak layer) (`layers_published`) | cross | **pass** | A_up_200 0.02% / 2.00%; A_down_200 0.24% / 2.00%; A_up_600 0.25% / 2.00%; A_down_600 0.15% / 2.00%; B_start 0.19% / 1.00%; B_start_no_toughness 0.55% / 1.00%; B_top_pressure 0.03% / 1.00%; B_lower_tip_ft 107.90% / 200.00% |  |  | 0.61 |
| Growth in layered rock with equal barriers must equal the three-layer height-growth solver (`layers_equal_barriers`) | exact | **pass** | length 0.00% / 0.50%; pressure 0.00% / 0.50%; height 0.00% / 0.50%; balance 0.00% / 0.00% | 200 |  | 1.14 |
| Growth with a strong barrier above and a weak one below: grows into the weak side, mirrors when the rock is turned over (`layers_unequal_barriers`) | self | **pass** | balance 0.00% / 0.00%; mirror 0.00% / 0.00%; into_the_weak_side 0.00% / 50.00%; height_between 0.00% / 50.00%; length_between 0.00% / 50.00%; table 0.00% / 0.50%; table_height 0.00% / 0.50% | 200 |  | 2.64 |
| Three clusters between unequal barriers: mirror image and fluid account (`layers_with_clusters`) | self | **pass** | mirror 0.00% / 0.00%; balance 0.00% / 0.00%; into_the_weak_side 0.00% / 50.00% | 150 |  | 1.57 |
| Stress left by an earlier stage: a uniform background changes nothing but the pressure; a nearby open fracture pushes fluid to the far clusters (`stage_shadow`) | self | **pass** | uniform_same_length 0.00% / 0.00%; uniform_same_pressure 0.00% / 0.00%; uniform_wellbore 0.00% / 0.00%; near_cluster_gets_less 0.00% / 50.00%; fades_with_waiting 0.00% / 50.00%; balance 0.00% / 0.00% | 150 |  | 6.5 |
| Stages pumped one after another: the first is unaffected, later ones lean away from the stage before (`chain_stage_shadow`) | self | **pass** | first_stage_same 0.00% / 0.00%; second_leans_away 0.00% / 50.00%; third_like_second 0.00% / 1.00%; shares_add_up 0.00% / 0.00% |  |  | 5.47 |
| Rock properties as random fields: the variogram asked for is the variogram obtained; reproducible; sampled anywhere (`geology_fields`) | exact | **pass** | transform 0.00% / 0.00%; variogram 0.68% / 6.00%; mean 0.04% / 5.00%; clipped_spectrum 0.00% / 1.00%; nugget 0.07% / 6.00%; two_ranges 0.71% / 6.00%; same_seed_same_field 0.00% / 0.00%; other_seed_other_field 0.00% / 50.00%; interpolation 0.00% / 0.00%; tied_properties 0.80% / 7.00% |  |  | 2.87 |
| Top-of-pay surface with faults: dip along a lateral, where a fault is crossed and by how much, base from gross thickness (`structure_surface`) | exact | **pass** | dip_ft 0.00% / 0.00%; along_strike_ft 0.00% / 0.00%; crossing_md_ft 0.00% / 0.00%; throw_mid_ft 0.00% / 0.01%; throw_quarter_ft 0.00% / 0.01%; other_way_ft 0.00% / 0.01%; no_crossing_past_tip 0.00% / 0.00%; die_out_ft 0.00% / 0.00%; base_ft 0.00% / 0.00%; own_md 0.00% / 0.00%; model_coordinates_ft 0.00% / 0.00%; same_seed_same_faults 0.00% / 0.00% |  |  | 0.23 |
| Sealing and leaky faults in a fractured-well model (`fracwell_faults`) | self | **pass** | open_fault_same 0.00% / 0.00%; sealed_equals_strip 0.03% / 2.00%; leakier_gives_more 0.00% / 50.00%; cut_fraction 0.00% / 5.00% | 2318 | 187 (0) | 10.5 |
| Pipe pressure drop, single-phase liquid: hydrostatic head and laminar friction (`hydraulics_exact`) | exact | **pass** | hydrostatic 0.00% / 0.01%; laminar 0.00% / 0.00%; colebrook_residual 0.00% / 0.00% |  |  | 0.0 |
| Gas-liquid tubing without slip: mixture density, liquid limit and step refinement (`lift_noslip_formulas`) | exact | **pass** | density 0.00% / 0.01%; gas_free_limit 0.00% / 0.00%; steps 0.00% / 0.10%; below_liquid_only 0.00% / 50.00% |  |  | 0.0 |
| Gas-liquid tubing with slip: gas fraction, no-slip limit, and its place between the two bounds (`lift_slip_formulas`) | exact | **pass** | gas_fraction 0.00% / 0.00%; no_slip_limit 0.00% / 0.00%; between_bounds 0.00% / 50.00%; weak_well_loads_up 0.00% / 50.00% |  |  | 0.0 |
| SPE1: three-phase black oil, gas injection (deck input) (`cross_spe1`) | cross | **fail** | PROD:orat 0.44% / 2.00%; PROD:grat 1.36% / 2.00%; PROD:bhp 1.72% / 1.00% ✗; INJ:bhp 0.49% / 1.00% | 300 | 129 (0) | 2.5 |
| Deck runner: field-unit summary file (SPE1 producer held at 20,000 stb/d) (`runner_summary_units`) | exact | **pass** | oil_rate 0.00% / 0.10%; run_file 0.00% / 50.00% | 300 | 129 (0) | 1.2 |
| Fractured well builder, standard mesh: full-width fractures, single-phase oil (`fracwell_exact_standard`) | exact | **pass** | cum 0.03% / 1.00%; curve 0.45% / 2.00%; month1 0.40% / 2.50% | 837 | 343 (0) | 7.86 |
| Fractured well builder, fine mesh: full-width fractures, single-phase oil (`fracwell_exact_fine`) | exact | **pass** | cum 0.16% / 0.25%; curve 0.19% / 0.50%; month1 0.05% / 1.00% | 3087 | 343 (0) | 3.34 |
| Fractured well builder: three identical stages, live oil with gas and water, 3,500 psi drawdown (`fracwell_blackoil`) | self | **pass** | oil_spread 0.00% / 0.10%; gas_spread 0.00% / 0.10%; cut_fraction 0.00% / 5.00% | 3705 | 344 (0) | 10.22 |
| Proppant carried with the slurry: pad-volume rule, conservation, concentration behind the front (`proppant_transport`) | exact | **pass** | pad_rule 0.02% / 1.00%; balance 0.00% / 0.00%; behind_front 0.00% / 0.50%; no_overshoot 0.00% / 0.00% | 800 |  | 1.03 |
| Proppant arithmetic: concentration units, propped width, pack permeability, settling limit (`proppant_formulas`) | exact | **pass** | ppa 0.00% / 0.00%; width 0.00% / 0.00%; permeability 0.00% / 0.01%; stokes_limit 0.61% / 1.00%; slower_than_stokes 0.00% / 50.00% |  |  | 0.0 |
| Proppant settling into a bank: closed slot against the exact solution, flowing slot, conservation in a growth run (`proppant_settling`) | exact | **pass** | hindered_speed 0.00% / 0.01%; meeting_time 0.01% / 0.10%; bank_half_way 0.00% / 0.00%; front_half_way 0.00% / 0.00%; bank_final 0.00% / 0.00%; finished_on_time 0.00% / 0.20%; line_plateau 0.00% / 0.10%; line_end 0.19% / 2.00%; line_balance 0.00% / 0.00%; carry_over_height 0.01% / 1.00%; carry_over_speed_published 0.02% / 0.50%; growth_balance 0.00% / 0.00%; never_over_packed 0.00% / 0.00%; faster_grains_bank_more 0.00% / 50.00% |  |  | 2.87 |
| Proppant bank to production: a weak barrier below the pay loses proppant out of zone; a thicker fluid banks less (`chain_settling_to_production`) | self | **pass** | weak_floor_loses_proppant 0.00% / 50.00%; thick_fluid_banks_less 0.00% / 50.00%; same_fracture_either_way 0.00% / 0.00%; oil_positive 0.00% / 50.00% | 3838 | 109 (0) | 16.27 |
| Fracture conductivity that falls as the well is drawn down, and stays down (`fracwell_conductivity_loss`) | self | **pass** | no_loss_same 0.00% / 0.20%; more_loss_less_oil 0.00% / 50.00%; permanent_costs_later 0.00% / 50.00%; same_when_never_recovering 0.00% / 0.20%; no_loss_same_after_drawdown 0.01% / 0.20%; connection_size 0.42% / 1.00%; cut_fraction 0.00% / 5.00% | 1121 | 187 (0) | 27.64 |
| Six clusters with limited entry (a reported case): lengths stay finite and steady (`multifrac_tip_position`) | self | **pass** | finite 0.00% / 50.00%; no_jumps 100.00% / 300.00%; mirror 0.00% / 0.00%; balance 0.00% / 0.00% | 200 |  | 11.97 |
| Rock, pumping and proppant to production: propped length and conductivity predicted (`chain_proppant_to_production`) | self | **pass** | propped_inside_created 0.00% / 50.00%; more_proppant_more_conductivity 0.00% / 50.00%; length_used 0.00% / 0.00%; settling_reported 0.00% / 50.00% | 3838 | 109 (0) | 4.71 |
| Rock and pumping to production in one call: three job sizes on one well (`chain_design_to_production`) | self | **pass** | longer_with_bigger_job 0.00% / 50.00%; more_oil_with_longer 0.00% / 50.00%; length_used 0.00% / 0.00%; cut_reported 0.00% / 50.00% | 3705 | 109 (0) | 8.45 |
| Wellbore coupling: rate-proportional tubing drop (20 psi per stb/d) on one stage (`surface_linear_tubing`) | exact | **pass** | cum 0.01% / 0.50%; curve 0.02% / 1.00%; mismatch_psi 0.50% / 0.50%; converged 0.00% / 50.00% | 1235 | 187 (0) | 21.15 |
| Wellbore coupling inside the timestep: rate-proportional tubing drop, one run (`surface_implicit_tubing`) | exact | **pass** | cum 0.05% / 0.50%; curve 0.05% / 1.00%; mismatch_psi 0.00% / 0.50% | 1235 | 187 (0) | 6.13 |
| Facility limit inside the timestep: oil capped at 20 stb/d, one run (`surface_implicit_cap`) | exact | **pass** | cum 0.00% / 0.50%; curve 0.00% / 1.00%; mismatch_psi 0.00% / 0.50% | 1235 | 187 (0) | 2.45 |
| Facility limit: oil rate capped at 20 stb/d on one stage, then decline at separator pressure (`surface_rate_cap`) | exact | **pass** | cum 0.01% / 0.50%; curve 0.01% / 1.00%; mismatch_psi 0.44% / 0.50%; converged 0.00% / 50.00% | 1235 | 187 (0) | 37.98 |
| One well with three stages, live oil, at a fixed separator pressure: must equal the three stage-wells (`surface_multistage_live_oil`) | exact | **pass** | oil 0.00% / 0.50%; gas 0.00% / 0.50%; curve 0.00% / 1.00%; cut_fraction 0.00% / 5.00% | 3705 | 188 (0) | 12.03 |
| Fracture growth, live-oil reservoir, 9,050 ft of tubing and a 15 stb/d facility limit in one run (`chain_growth_reservoir_surface`) | self | **pass** | mismatch_psi 0.00% / 0.50%; over_limit 0.00% / 0.10%; cut_fraction 0.00% / 5.00% | 3705 | 187 (0) | 7.56 |
| Three-stage live-oil well behind 9,050 ft of tubing: liquid-only against gas-liquid without slip (`lift_noslip_well`) | self | **pass** | mismatch_psi 0.01% / 0.50%; cut_fraction 0.00% / 5.00%; lower_bhp 0.00% / 50.00%; more_oil 0.00% / 50.00% | 3705 | 187 (0) | 9.81 |
| Step-by-step operating-point solver against the in-timestep solver (no-slip tubing) (`lift_marching_agrees`) | cross | **pass** | cum 0.00% / 0.50%; curve 0.01% / 1.00%; mismatch_psi 0.50% / 5.00% | 3705 | 376 (0) | 14.91 |
| Three-stage live-oil well behind 9,050 ft of tubing with gas-liquid slip (`lift_slip_well`) | self | **pass** | mismatch_psi 0.35% / 5.00%; cut_fraction 1.75% / 5.00%; between_bounds 0.00% / 50.00% | 3705 | 400 (7) | 25.81 |
| Two laterals 2,000 ft apart in the same rock: each must equal a lateral on its own (`pad_far_apart`) | exact | **pass** | same_as_alone 0.00% / 0.50%; mirror 0.00% / 0.00% | 5662 | 499 (0) | 34.48 |
| Two laterals in the same rock at 2,000, 800 and 550 ft spacing (500 ft tip-to-tip fracture span each) (`pad_interference`) | self | **pass** | mirror 0.00% / 0.00%; less_when_closer 0.00% / 50.00%; cut_fraction 0.00% / 5.00% | 5700 | 499 (0) | 46.3 |
| Two identical wells on a shared flowline (10 psi per stb/d of total liquid) (`field_twins_shared_line`) | exact | **pass** | cum 0.06% / 0.50%; curve 0.06% / 1.00%; twins 0.00% / 0.00%; mismatch_psi 0.50% / 0.50% | 2470 | 890 (0) | 16.19 |
| Two identical wells under a 40 stb/d facility oil limit (`field_twins_facility_cap`) | exact | **pass** | cum 0.00% / 0.50%; curve 0.01% / 1.00%; twins 0.00% / 0.00%; over_limit 0.01% / 0.10% | 2470 | 560 (0) | 3.22 |
| A strong and a weak well on one line under a 30 stb/d facility limit (`field_unequal_wells`) | self | **pass** | over_limit 0.01% / 0.10%; mismatch_psi 0.49% / 0.50%; node_common 0.00% / 0.50% | 2470 | 816 (0) | 3.33 |
| Pro-rata allocation, two identical wells under 40 stb/d: each must match one well under 20 stb/d (`field_pro_rata_twins`) | exact | **pass** | cum 0.00% / 0.50%; curve 0.00% / 1.00%; twins 0.00% / 0.00%; over_limit 0.00% / 0.10% | 2470 | 432 (0) | 3.58 |
| Priority allocation, two identical wells under 40 stb/d: the first well must match one well alone under 40 stb/d (`field_priority_twins`) | exact | **pass** | first_well_cum 0.00% / 0.50%; first_well_curve 0.00% / 1.00%; over_limit 0.00% / 0.10%; full_means_full 0.00% / 0.10% | 2470 | 432 (0) | 3.19 |
| Common choke with the limit far below flush rate: three unequal live-oil wells, 66.7 stb/d (`field_common_choke_flush`) | self | **pass** | over_limit 0.00% / 0.10%; same_total_as_pro_rata 0.03% / 0.50% | 2489 | 861 (0) | 15.48 |
| Fractured well in rock that varies across the map: pore volume and kh decide, water is immobile, the model reads a geology grid (`fracwell_maps`) | self | **pass** | uniform_maps_same 0.00% / 0.00%; same_volume_and_kh 0.00% / 0.00%; immobile_water 0.00% / 0.00%; rich_streak_helps_its_stage 0.00% / 50.00%; mirror 0.00% / 0.10%; geology_run 0.00% / 50.00%; cut_fraction 0.00% / 5.00% | 2318 | 187 (0) | 12.22 |
| Parent and child laterals: a later well drills into depleted rock, and takes from its parent (`fracwell_parent_child`) | self | **pass** | no_late_start_same 0.00% / 0.00%; far_child_leaves_parent 0.01% / 1.00%; far_child_like_new_well 0.03% / 2.00%; near_child_loses 0.00% / 50.00%; later_child_loses_more 0.00% / 50.00%; parent_loses_to_child 0.00% / 50.00%; child_quiet_before_start 0.00% / 0.00%; pressure_field_shape 0.00% / 50.00%; cut_fraction 0.00% / 5.00% | 2850 | 188 (0) | 52.03 |
| Fast and screening run modes for batches of runs: what they cost in accuracy (`fracwell_fast_modes`) | self | **pass** | fast_oil_12 0.94% / 2.00%; fast_oil_60 0.56% / 1.50%; fast_gas_60 1.05% / 2.50%; screening_oil_12 5.12% / 7.00%; screening_oil_60 1.53% / 3.00%; screening_gas_60 3.97% / 6.00%; fast_is_faster 0.00% / 50.00%; screening_is_fastest 0.00% / 50.00% | 12369 | 149 (0) | 26.98 |
| Fractured well builder: finite fracture (279 ft half-length, 6.6 md-ft) against our research model (`fracwell_vs_stage_sim`) | cross | **pass** | cum 0.31% / 2.00%; curve 0.80% / 3.00% | 7049 | 343 (0) | 3.1 |
| Fractured well builder: coarse against standard mesh, live oil (`fracwell_blackoil_mesh`) | self | **pass** | field_oil 0.00% / 5.00%; field_gas 1.49% / 5.00% | 11997 | 346 (0) | 9.58 |
| SPE1 against a second reference: MRST (`cross_spe1_mrst`) | cross | **pass** | PRODUCER:bhp 0.01% / 1.00%; INJECTOR:bhp 0.26% / 1.00%; PRODUCER:orat 0.00% / 2.00%; PRODUCER:grat 0.01% / 2.00% | 300 | 127 (0) | 11.54 |
| SPE3: gas condensate with oil vaporised in the gas, against MRST (`cross_spe3_mrst`) | cross | **fail** | PRODUCER:bhp 0.00% / 1.00%; PRODUCER:grat 3.70% / 2.00% ✗; PRODUCER:orat 0.18% / 2.00% | 324 | 31 (0) | 16.0 |
| A run that leaves the pressure range of its fluid tables is flagged (SPE3 is, SPE1 is not) (`fluid_table_warning`) | self | **pass** | flagged 0.00% / 50.00%; table_floor_psia 0.00% / 10.00%; not_flagged 0.00% / 50.00% |  |  | 1.36 |
| SPE9: black oil, 9,000 cells, 26 wells with control switching (`cross_spe9`) | cross | **pass** | field_oil 0.40% / 3.00%; field_gas 0.76% / 3.00%; field_water 2.93% / 3.00%; INJE1:bhp 0.00% / 1.00% | 9000 | 96 (0) | 14.26 |
| Egg: two-phase water flood, corner-point grid with inactive cells, 12 wells (`cross_egg`) | cross | **pass** | field_oil 0.55% / 3.00%; field_water 0.15% / 3.00% | 18553 | 175 (0) | 24.53 |
| Compositional: 3-component miscible gas displacement, equation of state (`cross_compositional`) | cross | **pass** | gas_sat@250 0.32% / 2.00%; mole_frac@250 0.38% / 2.00%; gas_sat@500 0.16% / 2.00%; mole_frac@500 0.12% / 2.00% | 1000 | 503 (0) | 24.5 |
| Polymer flood in black oil (mobility control, adsorption) (`cross_polymer`) | cross | **pass** | PROD01:oil 1.61% / 2.00%; INJE01:bhp 0.07% / 1.00% | 100 | 237 (4) | 27.66 |

- `exact_buckley_leverett`: L1 at 100 cells 0.0660, at 1000 cells 0.0117; exact front at 0.7186
- `growth_volume_balance`: length 698 m after 60 min, efficiency 18.1%
- `growth_no_leakoff`: similarity constants: length 0.5786, inlet opening 2.9217 (rate per wing, plane-strain modulus)
- `growth_leakoff_limit`: efficiency 1.2%; the limit assumes 0%, so the solver should sit slightly below it. Measured shortfall at 400 / 800 / 1,600 cells: 3.6% / 2.9% / 2.4% (2026-11-09), i.e. the solver converges slowly here and about 1.5 points of the gap at 800 cells is numerical
- `height_section_formulas`: a first version had the layer correction twice too large; the area check could not see it (the error cancels in the integral), the uniform-load and tip checks did
- `height_growth_barriers`: 98 ft pay, 60 min at 25 bpm per wing: 870 psi barrier gives 2267 ft half-length and 108 ft height at the well; 435 psi gives 2224 ft and 140 ft; 116 psi cannot contain the fracture
- `height_growth_published`: K0: 132.7 mm long, 126.6 mm high (published 132.7, 127.5); K1: 142.9 mm long, 76.8 mm high (published 143.1, 76.8); K094: 161.5 mm long, 52.6 mm high (published 162.0, 53.0)
- `shadow_kernel`: 2 to 10 contained fractures, spacing 0.01 to 5 heights: smallest eigenvalue of the coupling is 0.0065 with the height-weighted kernel (stable) and -0.039 with the centre-line value alone (unstable, not used). Grown fractures up to 1.5 times the pay height, equal and unequal pressures: smallest eigenvalue 0.071; positive definiteness is lost at 2.6 times the pay height for three clusters a quarter of a height apart and 1.8 times for five clusters a tenth apart
- `perforation_friction`: 0.01 m3/s through four 10 mm holes at Cd 0.7 costs 150 psi; field-unit constant 0.2376
- `multifrac_pair_stiffer`: 15 m apart in a 30 m pay the shadow factor is 0.483: half-length 2821 m against 2593 m alone
- `multifrac_limited_entry`: shares 0.6664 and 0.3336; friction 300 MPa against 2.9 MPa net pressure
- `multifrac_interaction`: 30 m pay, 60 bpm for 60 min. Three clusters 7.5 m apart: shares [0.468, 0.063, 0.468] with no perforation friction, [0.342, 0.317, 0.342] with 20 shots each, [0.334, 0.332, 0.334] with 6 shots. 15 m apart, 20 shots: [0.343, 0.314, 0.343]. Five clusters 3 m apart, 12 shots: [0.211, 0.195, 0.189, 0.195, 0.211]
- `multifrac_published`: no friction: areas [3418, 2352, 2390, 2352, 3418] m2 (reference 3359, 1775, 1969, 1775, 3359); equal rates: [2752, 2904, 2923, 2904, 2752] m2 (reference 2476, 2630, 2630, 2630, 2476)
- `chain_clusters_to_production`: three clusters 40 ft apart at 45 bpm per stage: 24 shots each gives shares [0.356, 0.289, 0.356] and half-lengths [493, 391, 493] ft; 4 shots each gives [0.334, 0.332, 0.334] and [457, 452, 457] ft
- `layers_section_formulas`: 30 m pay, barrier 4 MPa above and 2 MPa below, 1.5 MPa net pressure: the fracture grows 2.8 m up and 15.5 m down
- `layers_published`: A: 3.76 ft up and 1.62 ft down at 200 psi, 140 and 33 ft at 600 psi (printed 3.76, 1.62, 140, 33). B: starts at 5809 psi, 5777 psi without toughness (printed 5809, 5777); upper tip at 8990 ft at 6898 psi with the lower tip at 9500 ft (printed 6898 psi, 9501 ft)
- `layers_unequal_barriers`: 98 ft pay, 870 psi barrier above and 435 psi below, 60 min at 25 bpm per wing: 4060 ft half-length, 7 ft above the pay and 33 ft below it at the well (equal barriers: 7 ft each side at 870 psi, 30 ft at 435 psi)
- `layers_with_clusters`: shares [0.337, 0.327, 0.337]; growth above / below the pay at the well: 2 / 7 ft, 2 / 7 ft, 2 / 7 ft
- `stage_shadow`: three clusters 10 m apart, the earlier stage 20 m away: shares [0.343, 0.314, 0.343] alone, [0.329, 0.317, 0.354] half an hour after the earlier stage, [0.343, 0.314, 0.343] two days after; the earlier stage adds 59 psi at the nearest cluster and 28 psi at the farthest
- `chain_stage_shadow`: stages 150 ft apart, three clusters each, two hours between stages: shares [0.361, 0.278, 0.361] in the first stage, [0.353, 0.28, 0.367] in the second, [0.353, 0.28, 0.367] in the third; the earlier stage adds 20 psi at the nearest cluster
- `geology_fields`: 512 x 512 nodes, range 8 cells, three seeds: worst variogram miss 0.007 of the sill; porosity against log-permeability correlation 0.71 (asked 0.70)
- `structure_surface`: 2 degree dip: 209.5 ft deeper after 6,000 ft down dip, 3.6e-12 ft along strike; a 40 ft fault crossed at its middle steps the pay 40.0 ft, at a quarter of its length 30.0 ft
- `fracwell_faults`: 12-month oil: 13725 stb without faults; 2535 with two sealing faults 90 ft either side of the lateral (a model of just that strip gives 2534); 9565 when they leak at 1%
- `hydraulics_exact`: turbulent friction uses the Colebrook-White equation; its constants are from recall and were not checked against a source
- `lift_noslip_formulas`: 9,050 ft of 2.441 in tubing at 100 psia on top, 100 stb/d oil, 5 stb/d water, 300 Mscf/d gas: 189 psia at the bottom without slip, 3473 psia if the tubing were full of liquid
- `lift_slip_formulas`: 9,050 ft, 100 psia on top, 100 stb/d oil, 300 Mscf/d gas: 189 psia without slip, 1136 psia with slip, 3473 psia liquid-filled; at 1 stb/d the slip model gives 2766 psia
- `cross_spe1`: producer pressure misses its 1% bar. Diagnostic 2026-11-09: capping our timestep at 10 and 2 days moves the difference to 2.2% and 2.5% (further from the reference), and tighter tolerances leave it at 1.7%, so it is not our timestep or tolerance error. The difference sits around the producer's switch to its pressure limit. Unresolved without a fine-step independent reference.
- `fracwell_blackoil`: coarse mesh, 24 months, per stage: 3320 stb oil, 10795 Mscf gas, 8.1 stb water
- `proppant_transport`: proppant front at 1545 m of a 2600 m fracture after a 30% pad
- `proppant_formulas`: 0.2 mm sand in water settles 274.5 ft per hour; the settling law and the stress factor on pack permeability are taken from the sources in research/proppant-models.md and are not checked here
- `proppant_settling`: closed 30 m slot, 10% suspension: bank ends 5.00 m high after 2040 s; flowing slot: all settled by 798 m (exact 796 m); growth run: 51% of the proppant is immobile when pumping stops at a settling speed of 2 cm/s, 22% at 2 mm/s, and 19% with no settling at all (packed near the tip by leak-off and bridging)
- `chain_settling_to_production`: water, 600 psi barriers: 100% of the proppant banked during pumping, 99% of it ends in the pay, propped half-length 300 ft, 44.1 md-ft at the well (even spread: 300 ft, 2.9 md-ft; with no carry-over of grains above the bank: 217 ft, 44.1 md-ft); 300 psi below: 96% in the pay; 30 cp fluid: 96% banked
- `fracwell_conductivity_loss`: 12 months at 1000 psi: 4375 stb with no loss, 3928 with 2e-4 per psi, 3145 with 5e-4 per psi. After two months at 500 psi, months 3 to 12 at 3000 psi give 775 stb if the loss is permanent and 974 if it recovers (1277 had the well never been drawn down hard)
- `multifrac_tip_position`: half-lengths [492, 487, 487, 487, 487, 492] ft, shares [0.168, 0.166, 0.166, 0.166, 0.166, 0.168]
- `chain_proppant_to_production`: 8 bpm per fracture, 60 min, 0.2 mm sand from 30% of the job: created 256 ft, propped 241 ft; conductivity at the well 1.3 md-ft at 0.5 lb/gal and 4.9 md-ft at 2 lb/gal; 6-month oil 1161 stb per stage
- `chain_design_to_production`: 4 / 8 / 12 bpm per fracture for 60 min: created half-length 130 / 256 / 379 ft, 6-month oil 456 / 842 / 1211 stb (conductivity and the 60% conductive share are declared, not predicted)
- `surface_linear_tubing`: 20 loop iterations; bottom-hole pressure falls from 4475 to 1012 psi as rate declines from 174 to 0.6 stb/d; 12-month oil 713 stb; solver steps 187 against 187 without the loop
- `surface_implicit_tubing`: one run of 4.6 s; peak rate 174 stb/d at 4475 psi bottom-hole; 12-month oil 713 stb
- `surface_implicit_cap`: one run of 1.1 s; peak oil rate 20.000 stb/d; 12-month oil 717 stb
- `surface_rate_cap`: 44 loop iterations; well held at the limit for 3 days, peak oil rate 20.00 stb/d, 12-month oil 717 stb
- `chain_growth_reservoir_surface`: grown half-lengths 130 / 256 / 379 ft; facility full for 49 days; bottom-hole pressure 3472 to 4996 psi; 12-month oil 2332 stb
- `lift_noslip_well`: 12-month oil 3768 stb with liquid-filled tubing (final bottom-hole pressure 3472 psi), 7051 stb without slip (114 psi): the true answer lies between
- `lift_marching_agrees`: 376 step solves for 187 steps in 8.9 s
- `lift_slip_well`: 12-month oil: 3768 stb liquid-filled tubing, 4284 stb with slip, 7051 stb without slip; bottom-hole pressure with slip from 922 to 3276 psi; 400 step solves in 16.4 s
- `pad_far_apart`: 36-month oil per stage 6441 stb with the second lateral 2,000 ft away, 6441 stb alone
- `pad_interference`: 36-month oil per lateral (two stages, 5 microdarcy rock): 12883 stb at 2,000 ft, 12135 stb at 800 ft (-5.8%), 10459 stb at 550 ft (-18.8%)
- `field_twins_shared_line`: 890 step solves for 187 steps x 2 wells in 13.8 s; node pressure from 4475 down to 1012 psi; 12-month oil per well 713 stb
- `field_twins_facility_cap`: 560 step solves in 2.3 s; facility full for 2.6 days; peak total oil 40.005 stb/d
- `field_unequal_wells`: facility full for 4.0 days; 12-month oil: strong well 935 stb, weak well 493 stb (65% / 35%); 816 step solves in 3.3 s
- `field_pro_rata_twins`: facility full for 2.6 days; 432 step solves in 2.3 s
- `field_priority_twins`: facility full for 2.6 days; 12-month oil: first well 717 stb, second well 716 stb
- `field_common_choke_flush`: 861 step solves in 9.1 s; node pressure up to 1628 psi; 24-month oil by well 8138 / 4738 / 5629 stb (pro-rata: 8140 / 4739 / 5632)
- `fracwell_maps`: 12-month oil: 7258 stb uniform; 7258 with half the net pay and doubled porosity, permeability and conductivity; 8786 with a rich streak at stage 1 (that stage 5398 against 3629); 2811 stb reading a generated geology
- `fracwell_parent_child`: live oil, laterals 500 ft apart. A new well's first 12 months: 7535 stb alone; 6484 stb as a child 6 months after its parent; 5797 stb 24 months after. The parent's 36 months: 12580 stb alone, 11999 with a child from month 6. Lowest pressure in the rock at the end of the late-child run: 1501 psi
- `fracwell_fast_modes`: 60 months: standard 24.5 s; fast 2.0 s (oil -0.9% at 12 months, -0.6% at 60); screening 0.5 s (oil -5.1%, -1.5%)
- `fracwell_vs_stage_sim`: 24-month recovery 0.3637% of oil in place, reference 0.3648%; half-length on mesh 278.9 ft
- `fracwell_blackoil_mesh`: standard mesh, 24 months, three stages: 9959 stb oil, 32876 Mscf gas (coarse: 9960 stb, 32386 Mscf)
- `fluid_table_warning`: reservoir pressure fell to 1043 psia, below the lowest pressure of a fluid table (1215 psia); the engine holds gas properties constant below a table, so results past that point are not reliable. Extend the fluid tables.
- `cross_egg`: reference file has no pressure data; rates only

### Deck keywords the parser could not fully honour

- `cross_polymer`: Parser: RUNSPEC/PIMTDIMS - Unsupported keyword. It will be ignored.
- `cross_polymer`: Parser: RUNSPEC/OPTIONS - Unsupported keyword. It will be ignored.
- `cross_polymer`: Parser: GRID/MESSAGES - Unsupported keyword. It will be ignored.

## Features

`Known for` is from recall of vendor products, not looked up.

### Physics

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Single-phase depletion (transient and boundary-dominated) | all | **verified here** | passes against exact solution: exact_slab_inf, exact_slab_trans, exact_slab_depl |
| Two-phase immiscible displacement | all | **verified here** | passes against exact solution: exact_buckley_leverett |
| Three-phase black oil with dissolved gas, gravity, equilibrium initialisation | ECLIPSE 100, IMEX, Nexus, tNavigator, ECHELON, Tempest MORE | runs here, misses its bar | cross_spe1 |
| SPE1 black oil against a second reference (MRST) | ECLIPSE 100, IMEX, Nexus, tNavigator, ECHELON, Tempest MORE | **verified here** | passes against a reference run from another model or simulator: cross_spe1_mrst — the row above misses on producer pressure against the OPM Flow reference; this row is the same benchmark against MRST |
| Gas condensate: oil vaporised in the gas (SPE3) | ECLIPSE 100/300, GEM, tNavigator | runs here, misses its bar | cross_spe3_mrst — agrees with MRST to 0.02% for 15 years; the miss is all in the final blowdown below the lowest pressure of the fluid table, where the engine holds gas properties constant and MRST extrapolates. Keep fluid tables wider than the pressures a run will reach |
| Warning when a run leaves the pressure range of its fluid tables | ECLIPSE, IMEX, tNavigator (as input checks) | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fluid_table_warning — written here after the SPE3 finding: below a table the engine holds gas properties constant |
| Compositional flow with an equation of state | ECLIPSE 300, GEM, INTERSECT, tNavigator | **verified here** | passes against a reference run from another model or simulator: cross_compositional |
| Polymer flooding | ECLIPSE, STARS, tNavigator | **verified here** | passes against a reference run from another model or simulator: cross_polymer |
| Thermal flow (hot and cold water, conduction) | STARS, ECLIPSE thermal, INTERSECT | in engine, not run here | src/thermal — the shipped reference case has 472,500 cells, too large for a seconds-long suite |
| CO2 storage properties | GEM, ECLIPSE CO2STORE, tNavigator | in engine, not run here | src/CO2Properties |
| Geothermal | STARS, tNavigator | in engine, not run here | src/Geothermal |
| Tracers | ECLIPSE, INTERSECT, tNavigator | in engine, not run here | src/Tracers |
| Relative-permeability hysteresis | ECLIPSE, IMEX/GEM | in engine, not run here | src/variables/relperm/hysteresis.jl |
| End-point scaling | ECLIPSE, INTERSECT | in engine, not run here | src/variables/relperm/endscale.jl |
| Flow in a given discrete fracture network | INTERSECT, tNavigator, GEM | in engine, not run here | src/DFM |
| Steam injection / SAGD | STARS | **absent** | no engine source file matches /SAGD/steam.?(injection/flood/chamber/quality)/ |
| Chemical reactions / in-situ combustion | STARS | **absent** | no engine source file matches /REACRATE/in.?situ.?combustion/chemical.?reaction/ |
| Surfactant and foam | STARS, ECLIPSE | **absent** | no engine source file matches /surfactant/foam/ |
| Dual porosity / dual permeability | ECLIPSE, IMEX/GEM, tNavigator | **absent** | no engine source file matches /dual.?poro/DUALPORO/DPGRID/dual.?perm/ |
| Geomechanics | GEM, STARS, ResFrac, INTERSECT with VISAGE | **absent** | no engine source file matches /geomech/poroelast/biot/ |
| Non-Darcy (Forchheimer) flow | ECLIPSE, IMEX/GEM | **absent** | no engine source file matches /non.?darcy/forchheimer/ |
| Gas adsorption / coalbed methane | GEM, ECLIPSE | **absent** | no engine source file matches /langmuir/COALBED/ |

### Geology

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Rock properties as correlated random fields with a stated variogram (model, range, sill, nugget, two ranges), sampled at any map position | Petrel, GeoGraphix, Petra, Kingdom (as the truth these tools estimate) | **verified here** | passes against exact solution: geology_fields — written here; unconditional fields only: no conditioning to wells, no facies, no trends, one layer; the rock model has porosity, permeability, gross thickness, net-to-gross and water saturation |
| Fractured well in rock that varies across the map: net pay, porosity, water saturation, permeability per cell | ECLIPSE, IMEX, tNavigator, Nexus | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_maps — one layer; water is immobile (it only reduces the oil-filled pore volume); no outside reference |
| Structure: top-of-pay surface with fault traces and throws, read along any lateral (top, base, fault crossings) | Petrel, GeoGraphix, Petra, Kingdom; geosteering packages | **verified here** | passes against exact solution: structure_surface — written here; geometric faults (throw largest mid-trace, dying out with distance), no fault dip or drag; a synthetic surface is a dipping plane plus a correlated residual |
| Sealing and leaky faults in the well model (transmissibility multipliers along fault traces) | ECLIPSE, IMEX, tNavigator, Nexus | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_faults — the trace seals the cell faces it crosses, fractures included; throw itself does not act in a one-layer model |
| Depth of the reservoir varying across a well model (dip, gravity), layers, juxtaposition across faults | ECLIPSE, IMEX, tNavigator, Nexus | **absent** | no engine source file matches /fault.?trace/ |

### Fracture growth

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Growth of one contained fracture: flow in the fracture, elastic opening, leak-off (constant height) | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | **verified here** | passes against exact solution: growth_volume_balance, growth_no_leakoff, growth_leakoff_limit — written here, not in the engine; the no-leak-off constants match the published values (PyFrac reference solution, Dontsov 2021) to four digits; heavy leak-off is checked against the closed-form limit only |
| Height-growth model: static cross-section formulas, and the contained limit (height does not grow in these checks) | FracPro, MFrac, StimPlan, GOHFER | **verified here** | passes against exact solution: height_section_formulas, height_contained_limit |
| Height growing through symmetric stress barriers (pseudo-3-D: equilibrium height in every cross-section) | FracPro, MFrac, StimPlan, GOHFER | **verified here** | passes against a reference run from another model or simulator: height_growth_published — written here; the reference is a published laboratory-scale case digitised from figures (about 1%); a planar 3-D model gives a lower height for the same case, so this checks the model class, not reality |
| Height growth at field scale with leak-off and toughness (mesh, table and trend checks) | FracPro, MFrac, StimPlan, GOHFER | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: height_growth_barriers |
| Height in layered rock with unequal stresses above and below: cross-section formulas, and equal barriers against the three-layer solver | FracPro, MFrac, StimPlan, GOHFER | **verified here** | passes against exact solution and a reference run: layers_section_formulas, layers_equal_barriers, layers_published — written here; any number of layers with their own stress and toughness, fluid weight optional; one stiffness for all layers; landing depth inside the pay has no effect in this model class |
| Growth between unequal barriers, alone and with several clusters (mirror, fluid account, trend checks) | FracPro, MFrac, StimPlan, GOHFER | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: layers_unequal_barriers, layers_with_clusters — the height against pressure is checked against published cases in the row above; the growing fracture (length and height in time) between unequal barriers has no outside reference |
| Rock and pumping to production in one call (length and height predicted; conductivity and conductive share declared) | ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: chain_design_to_production — the pieces are checked separately; the chained result has no outside reference, and without a proppant model it is not a prediction end to end |
| Planar 3-D fracture (non-local elasticity, arbitrary layers, vertical flow) | ResFrac, Kinetix, GOHFER | **absent** | no engine source file matches /hydraulic.?fractur/fracture.?propagat/fracture.?growth/ |
| Stress shadow between the fractures of one stage: formula, and two identical fractures against the exact stiffer-rock solution | ResFrac, Kinetix, GOHFER | **verified here** | passes against exact solution: shadow_kernel, multifrac_pair_stiffer, multifrac_far_apart — written here; local plane-strain shadow (a neighbour acts only where it is open at the same position along the length), uniform over the height |
| Several clusters growing together against a planar 3-D reference (five fractures, with and without perforation friction) | ResFrac, Kinetix | **verified here** | passes against a reference run from another model or simulator: multifrac_published — passes share-of-area bars of 20%; in absolute area the squeezed inner fractures are about a third larger than the reference, which has full 3-D elasticity and rock toughness at the leading edge |
| Clusters close together (a tenth to a quarter of the height apart): symmetry, fluid account, direction of effects | ResFrac, Kinetix | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: multifrac_interaction, multifrac_one_cluster — no outside reference at this spacing, which is where simplified shadow models are known to lose accuracy |
| Stress left by the stage before: what its fractures still hold open shadows the next stage | ResFrac, Kinetix | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: stage_shadow, chain_stage_shadow — written here; the earlier fractures close by leak-off down to their proppant pack and do not respond to the new stage; exact only for a uniform background; no outside reference |
| Fractures turning, merging or reopening earlier ones | ResFrac, Kinetix | **absent** | no engine source file matches /stress.?shadow/ |
| Proppant carried with the slurry: placement along the fracture, bridging in narrow sections, concentration by leak-off | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | **verified here** | passes against exact solution: proppant_transport, proppant_formulas — written here; no slip along the fracture, and the flow does not feel proppant or screen-out |
| Propped half-length and conductivity predicted from the proppant pumped, fed to the production run | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: chain_proppant_to_production — pack permeability law and stress factor are from the literature, not checked here; no outside reference for the chained result |
| Proppant settling into a bank at the bottom of the fracture (hindered settling, bank growth) | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | **verified here** | passes against exact solution: proppant_settling — written here; exact for a closed slot (Kynch) and for the settling distance in a uniform flow; the speed at which the flow carries grains over the bank is a published pipe rule adapted to slots (McClure 2018), checked by its source only on 8 mm laboratory slots; the bank does not narrow the flow path |
| Proppant bank through to production: only the bank inside the pay conducts | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: chain_settling_to_production — no outside reference for the chained result |
| Screen-out pressure, proppant slowing the slurry, the bank narrowing the flow path | ResFrac, GOHFER, StimPlan, FracPro, Kinetix | **absent** | no engine source file matches /proppant/ |
| Perforation friction and the split of the stage rate between clusters (limited entry) | ResFrac, Kinetix | **verified here** | passes against exact solution: perforation_friction, multifrac_limited_entry — written here; one wellbore pressure for all clusters (no friction along the casing), fixed discharge coefficient (no erosion) |
| Multi-cluster stages through to production in one call | ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: chain_clusters_to_production |

### Grids

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Corner-point grids with inactive cells | all | **verified here** | passes against a reference run from another model or simulator: cross_egg |
| Consistent / multipoint discretisations | INTERSECT | in engine, not run here | src/flux_nfvm.jl |
| Model coarsening | ECLIPSE, tNavigator | in engine, not run here | src/coarsening |
| Local grid refinement | ECLIPSE, IMEX/GEM, tNavigator | **absent** | no engine source file matches /CARFIN/local.?grid.?refine/ |

### Wells and facilities

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Many wells on rate and pressure limits with control switching | all | **verified here** | passes against a reference run from another model or simulator: cross_spe9 |
| Pipe pressure drop, single-phase liquid (hydrostatic and laminar exact; turbulent friction not independently checked) | all majors, PIPESIM, PROSPER | **verified here** | passes against exact solution: hydraulics_exact |
| One well coupled to tubing and separator back-pressure, solved inside each timestep (liquid-only tubing or a declared curve) | Nexus, INTERSECT with PIPESIM, tNavigator, ResFrac | **verified here** | passes against exact solution: surface_linear_tubing, surface_implicit_tubing — written here, not in the engine; gas lightening the column is not modelled |
| Facility oil-rate limit on one well (choke back, then decline) | all majors | **verified here** | passes against exact solution: surface_rate_cap, surface_implicit_cap |
| One well with several stages and live oil in the single-well form used by the surface condition | all | **verified here** | passes against exact solution: surface_multistage_live_oil |
| Fracture growth, live-oil reservoir, liquid-only tubing and a facility limit in one run | ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: chain_growth_reservoir_surface — liquid-only tubing overstates bottom-hole pressure on a gassy well; conductivity and conductive share are declared |
| Several wells on a shared flowline and separator, marched through time together | Nexus, INTERSECT with PIPESIM, tNavigator | **verified here** | passes against exact solution: field_twins_shared_line — written here; wells are separate reservoir models (no interference through the rock); one node, not a general network |
| Facility oil-rate limit across identical wells (one common choke) | all majors | **verified here** | passes against exact solution: field_twins_facility_cap |
| Facility oil-rate limit across unequal wells (one common choke; the split follows the reservoirs) | all majors | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: field_unequal_wells, field_common_choke_flush |
| Allocation rules under a facility limit: pro-rata and priority (checked on identical wells) | all majors | **verified here** | passes against exact solution: field_pro_rata_twins, field_priority_twins — potentials are taken from an unconstrained solve of the same step; no economic or water-cut based rules |
| Gas-liquid flow in tubing without slip (understates bottom-hole pressure; liquid-only overstates it) | PIPESIM, PROSPER, Nexus, ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: lift_noslip_formulas, lift_noslip_well — written here for the SPE1 fluid only; brackets the answer with the liquid-only curve, it is not a calibrated lift correlation |
| Gas-liquid flow in tubing with slip: drift flux, one flow pattern, vertical pipe | PIPESIM, PROSPER, Nexus, ResFrac | **verified here** | passes against exact solution: lift_slip_formulas — the gas-fraction relation reproduces an independent code's worked value; no published pressure-drop case was found to check the whole tubing calculation |
| A well behind tubing with gas-liquid slip, solved with the reservoir step by step | PIPESIM, PROSPER, Nexus, ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: lift_marching_agrees, lift_slip_well — the in-timestep method cannot solve a tubing curve that bends back at low rate; this one searches the operating point each step |
| Calibrated multi-pattern lift correlations, lift tables, artificial lift | PIPESIM, PROSPER, Nexus | **absent as a feature** | 33 file(s) mention the term: src/cpr.jl, src/deck_types.jl |
| Multi-segment wells | ECLIPSE, INTERSECT, Nexus | in engine, not run here | test/mswells.jl |
| Group and field production controls | all majors | **absent** | no engine source file matches /GCONPROD/GCONINJE/group.?control/ |
| Lift tables (VFP) | all majors | **absent** | no engine source file matches /VFP/ |
| Coupled surface network | Nexus, INTERSECT with PIPESIM, tNavigator | **absent** | no engine source file matches /pipe.?network/network.?(solver/coupling/balanc)/ |
| Scripted field logic (ACTIONX / UDQ) | ECLIPSE, INTERSECT, tNavigator | **absent** | no engine source file matches /UDQ/ACTIONX/ |

### Input and output

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| ECLIPSE-format deck input | ECLIPSE; read by tNavigator, ECHELON | **verified here** | passes against a reference run from another model or simulator: cross_spe9, cross_egg, cross_compositional, cross_polymer |
| Field-unit well and field summary | all | **verified here** | passes against exact solution: runner_summary_units |
| INTERSECT-format (AFI) input | INTERSECT | in engine, not run here | src/AFISetup |
| ECLIPSE binary summary / restart output | ECLIPSE; written by tNavigator, ECHELON | **absent** | no engine source file matches /UNRST/SMSPEC/UNSMRY/ |
| 3-D plots of grids, wells and results (no GUI) | Petrel RE, tNavigator, CMG Builder/Results offer full GUIs | in engine, not run here | ext/JutulDarcyGLMakieExt — plotting only; needs GLMakie, which is not installed |

### Workflows

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| History matching with adjoint gradients | Tempest ENABLE, CMOST, tNavigator | in engine, not run here | src/HistoryMatching |
| Rate optimisation | CMOST, tNavigator | in engine, not run here | examples/workflow/rate_optimization.jl |
| Ensembles for uncertainty | tNavigator, CMOST, Tempest ENABLE | in engine, not run here | examples/workflow/five_spot_ensemble.jl |
| Well-test and rate-transient analysis | KAPPA Rubis / Saphir / Topaze | **absent** | no engine source file matches /rate.?transient/pressure.?transient/build.?up/ |

### Performance and robustness

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| No timestep cuts with 1e5 to 1e6 mD strips beside microdarcy rock (1-D slab, default tolerances) | all | **verified here** | passes against exact solution: robust_contrast_1e5, robust_contrast_1e6 |
| Pressure-preconditioned (CPR) linear solver | all | in engine, not run here | src/cpr.jl |
| GPU linear solver | ECHELON, tNavigator, INTERSECT | in engine, not run here | ext/JutulDarcyCUDAExt — needs CUDA.jl, which is not installed |
| Distributed-memory parallel runs (MPI) | all majors | in engine, not run here | ext/JutulDarcyPartitionedArraysExt |
| Nonlinear domain decomposition | INTERSECT | in engine, not run here | src/NLDD |

### Unconventional

| Feature | Known for | Status | Evidence |
| --- | --- | --- | --- |
| Fractured-well builder: grid, units and per-stage accounting (full-width, high-conductivity fractures, single-phase) | GEM, tNavigator, ECLIPSE, ResFrac | **verified here** | passes against exact solution: fracwell_exact_standard, fracwell_exact_fine |
| Fractured well with finite half-length and finite conductivity, single-phase | GEM, tNavigator, ECLIPSE, ResFrac | **verified here** | passes against a reference run from another model or simulator: fracwell_vs_stage_sim — the reference is our own stage-sim research model on its 3x-refined mesh: same engine, independently built grid, wells and accounting |
| Multi-stage fractured well, live oil with gas and water | GEM, tNavigator, ECLIPSE, ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_blackoil, fracwell_blackoil_mesh — checked for symmetry and mesh sensitivity only; there is no exact solution or outside reference for this case |
| Two laterals in the same rock: far apart they must not feel each other | GEM, tNavigator, ECLIPSE, ResFrac | **verified here** | passes against exact solution: pad_far_apart |
| Two laterals in the same rock interfering (well spacing) | GEM, tNavigator, ECLIPSE, ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: pad_interference — single-phase oil; no outside reference for the size of the loss; not yet combined with the shared-facility model, which keeps wells in separate rock |
| Fast and screening run modes for batches of runs, with a measured accuracy cost | ComboCurve, whitson+ (as fast forecasting back ends) | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_fast_modes — about 14 and 60 times faster than the standard mesh; errors measured on one well and stated in the code, bars set after that measurement |
| Parent and child wells: a later well in rock the earlier one has depleted (staged starts, full state carried over) | GEM, tNavigator, ResFrac, whitson+ | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_parent_child — pressure, free gas and dissolved gas are carried; the child's fractures do not exist before its start; the child's fracture GROWTH does not feel the parent's depletion; no outside reference for the size of the loss |
| Fracture conductivity that falls with drawdown, permanently or reversibly | GEM, tNavigator, ResFrac | runs here, self-consistent only | symmetry / mesh checks pass, no outside check: fracwell_conductivity_loss — the engine's rock tables, written into the fractured-well deck; exponential loss with the pressure drop in each fracture cell; no outside reference |
| Well-interference (frac-hit) analogue with imposed connection | ResFrac, GEM | in our research track, not in this package | ../stage-sim/src/frac_hit.jl |
| Decline-curve (Arps) fitting | KAPPA, whitson, Aries / PHDwin | in our research track, not in this package | ../arps-core |

