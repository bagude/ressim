# Frac Pad Equipment Inventory (plug-and-perf, zipper frac)

Purpose: modeling reference for 3D assets. Rules used: a number appears only with a source tag [n] (list at end). "(snippet)" = read only in a search-result excerpt of that page, page not opened. "(est.)" = my estimate, not sourced. "not found" = I looked and did not find it. Field aliases and counts not tagged are industry convention or my judgment, not documented in a cited source; they are labeled "(convention)" or "(est.)".

Sourcing caveat: most hard dimensions below are Baker Hughes (BH) spec sheets (2025 editions). They are one vendor's units; other fleets (Halliburton, Liberty, ProFrac) differ. Halliburton, NexTier, Weir full outline drawings, Cameron tree dimensions and SandBox container dimensions were not found.

## Flow order and layout

Water (frac tanks / pits) -> transfer pumps + lay-flat -> hydration (gel jobs) -> blender (adds sand from silos/belts, chemicals from additive unit) -> suction side of missile -> frac pumps -> discharge side of missile -> high-pressure iron -> zipper manifold -> frac trees on each well. Wireline/pump-down tie in at the tree top. A BH description of the manifold trailer: blender manifold, connector pipe, pump suction manifold and pump discharge manifold; as many as 8 blender discharge hoses connect to the header; each 12 ft x 6 in suction manifold section serves two pump units "and provides adequate spacing between pump trucks" [4]. A patent describes the conventional pad as pump trucks connected to a missile manifold, plus a blending system and valve structure feeding wellheads, "generally not flexible regarding the number of pumps" [14].

## Equipment

### 1. Frac pump (diesel)
- Aliases: frac pump, pump truck, pumper, high-horsepower unit, "2500". (convention)
- Function: converts engine power to up to ~15,000 psi slurry flow.
- Count: not documented in cited source. Typical diesel fleet roughly 15-30 units (est.); one 2015 deck mentions "15 fracturing pumps" at a site (snippet, low reliability) [15].
- Dimensions/rating: BH Rhino unit, 2,000 HHP, 2,250 BHP engine, up to 15,000 psi, up to 22 bpm, L 61.25 x W 8 x H 13.5 ft, 400 gal fuel (4 h at max hp), Allison 9800 or CAT CX-48 transmission, triplex 4-5.75 in or quintuplex 4.5-5.5 in fluid ends [5]. Weight: not found for trailer unit. BH SC 2000 skid (Cummins QSK45 2,250 BHP, Allison S9800, SPM TWS 2250 triplex, 15,000 psi): engine skid 35,500 lb, 20 x 8 x 9.5 ft; pump skid 27,000 lb, 10 x 8 x 9.5 ft [6]. Weir SPM TWS 2250HD pump dry weight approx. 11,750 lb (snippet) [16]. Fluid-end-only dealer listings are not Weir data; ignored.
- Visual: tractor + gooseneck trailer; at the front-of-trailer end a big diesel engine with a tall vertical radiator package; transmission; driveshaft to a horizontal power end; fluid end (steel block with 3 or 5 plungers) with suction inlet manifold on one side and 3-in 1502 discharge on the other [6]; fuel tank; sound-wrapped exhaust stack.
- Position: in a row/two rows 40-100+ ft back from the wellheads, pump sides facing the missile (est.); discharge iron to missile.

### 2. Electric frac pump (e-frac)
- Aliases: e-pump, Zeus (Halliburton), digiFrac (Liberty), Clean Fleet (USWS/ProFrac). (names from [9],[10],[11])
- Function: electric-motor-driven quintuplex pump; VFD controlled.
- Count: Halliburton Zeus unit is 5,000 sustained HHP at 22 bpm and 9,500 psi; "34%" smaller footprint (baseline not given) [9]. So a fleet needs far fewer units than diesel (est.). USWS-style dual pump trailer rated 3,500 hhp, 28,000 hhp per fleet (snippet) [10]; Liberty digiFrac uses ten 400-hp motors per pump (snippet) [11].
- Dimensions/weight: not found.
- Visual: single trailer, no engine/radiator; instead, per [10], a VFD house with two independent VFDs where the radiator would be (snippet), large motor(s) on the power end, power cables from switchgear.
- Position: same row as diesel pumps; cabled to power plant instead of fueled.

### 3. Fleet power for e-frac (turbines, gensets, switchgear)
- Function: gas turbine generators supply medium-voltage power to pump trailers. USWS design: electric compressors boost gas to a constant 300 psi for the turbine gensets (snippet) [10]. Liberty selected Rolls-Royce MTU gas gensets (page blocked; headline only) [12]. Halliburton pairs Zeus with VoltaGrid power (snippet) [9].
- Count/dimensions: not found. Power trailers, a switchgear/transformer/"power distribution" unit, and gas feed lines sit upwind/away from the pump row (est.).
- Visual: trailer-mounted turbine with intake filter house and exhaust stack; containerized switchgear; heavy orange/black cable bundles (convention).

### 4. Blender
- Aliases: blender, "the tub", mixer. 
- Function: mixes sand, water, chemicals into slurry and boosts to ~90 psi for the pumps.
- Count: 1 working + 1 spare typical (est.).
- Dimensions: BH 125E trailer blender: L 36 x W 8 x H 12.6 ft; up to 120 bpm clean water; proppant up to 30,000 lb/min; three 14-in sand screws; open-top 8 bbl horizontal Hydropace tub; two 500 hp deck engines; three 220 gal chemical totes; 380 gal fuel; densitometer after tub; 90 psi supercharge at 125 bpm [3]. Weight: not found. SANY 100-bbl class unit 12.8 x 2.5 x 4.0 m, 31,000 kg (snippet) [17].
- Visual: tall box trailer; screw augers angled up from sand hoppers at rear; suction/discharge hose manifolds along the sides; open tub; large stacked hose connections.
- Position: between sand storage and the missile, usually near the upstream (suction) end of the missile.

### 5. Hydration unit
- Aliases: hydration, hydration trailer, "hydro". 
- Function: hydrates gel concentrate/polymer with residence time before the blender (slickwater jobs may skip it).
- Count: 0-1 typical (est.).
- Dimensions: BH DOTF unit: L 43.8 x W 8 x H 13.25 ft; tanks up to 180 bbl; two 4-in dry gel feeders; 50 bpm conventional / 100 bpm concentrate [1]. BH mobile hydration unit: tanks up to 275 bbl, up to 600 BHP deck engine, 3-minute residence, up to 100 bbl/min to blender [2]. Weights: not found (DOTF dry powder "pod" 3,500 lb).
- Visual: long trailer with multi-compartment open tank, centrifugal pumps, dust-handling hopper.
- Position: between water tanks and blender.

### 6. Chemical additive unit
- Aliases: chem van, chem trailer, LAS unit, "chem truck".
- Function: meters liquid additives (friction reducer, biocide, scale inhibitor) into the blender.
- Count: 1-2 (est.).
- Dimensions: BH mobile chemical additive unit: 0.05-25 gpm to blender; 10 additive pumps; eight removable totes (four 350 gal, four 550 gal); two 100 BHP deck engines; capacity 3,600 gal plus eight totes; 65 gpm hydraulics [7]. L/W/H and weight: not found.
- Visual: flat trailer with a rack of white IBC-style totes, pumps and hoses between them, hydraulic agitator.
- Position: beside the blender.

### 7. Liquid additive storage / LFC transport
- Function: carries bulk liquid chemicals or liquid frac concentrate.
- BH mobile LFC unit: three tanks totaling 4,100 gal (3,000 LFC with two agitators, 800 buffer, 500 diesel); powered by tractor hydraulic wet kit [8]. Dimensions: not found. Chemical totes (IBC) in stacks near the additive unit (convention).

### 8. Proppant storage (silos, boxes, conveyors)
- Aliases: Sand King, sand castle, sand silo, sandbox, "mountain mover" (conveyor) (convention; "Sand King" is also a BH trailer name).
- Function: stores and delivers proppant to the blender hopper.
- BH Sand King trailer: four compartments, 4,000 or 3,000 cu ft; 4,000 model L 56 x W 11 x H 13.5 ft; 3,000 model L 54.5 x W 8 x H 13.5 ft; hydraulic belt up to 22,500 lb/min; 110 BHP engine; support legs; blown or sack fill [13]. (The vertical silo "sand king" of the brief is a different product.)
- Solaris vertical silo "6-pack" with dual belt: approx 60 L x 61 H x 34 W ft (snippet) [18]. A 6-silo system is 2.5 million lb, a 12-silo system 5 million lb (snippet) [18]. Weights: not found.
- SandBox (U.S. Silica): 10-ft ISO-style containers; container holds up to 22.5 tons; chassis carries one full or two empty; each conveyor holds four containers (snippet) [19][20]. Container height: not found.
- Visual: silo = tall white/gray cylinders on a cross-braced frame with cone bottoms over a conveyor; trailer = long box with hatches on top, belt tail at rear; box system = rows of stacked boxes over belt.
- Count: 1-3 silo banks or 8-15 trailers on a conventional pad (est.).
- Position: behind/beside the blender (sand dumps onto the belt feeding the blender hopper).

### 9. Frac tanks, water tanks, ASTs
- Aliases: frac tank, 500-bbl tank, "upright" (vertical tank), water impoundment, pit. (convention)
- Function: store water; ~500 bbl (21,000 gal) each.
- Count: 10-30+ in a tank farm (est.); larger jobs use lined impoundments or flexible AST bladders (convention).
- Dimensions (listings, snippets of dealer pages, not manufacturer spec): lengths ~40-46 ft, width ~8.5 ft, heights ~9.5-11 ft, tare ~29,000 lb [21]. Treat as approximate.
- Visual: long rectangular steel tank on two axles, tractor-end gooseneck, top manway hatches, bottom outlet manifold; tank farm lines these side by side with a header manifold.
- Position: staged upstream of everything, along an edge of the pad or off-pad, inside lined containment (convention).

### 10. Water transfer pumps and lay-flat hose
- Function: move water between tanks/pits and the blender at high rate.
- Count/dimensions: not found (cited sources). Visual: diesel centrifugal pumps on skids or trailers, 8-12 in blue/black lay-flat hose, aluminum or steel manifold pipes (est.).

### 11. Missile / manifold trailer
- Aliases: missile, low-pressure/high-pressure manifold, manifold trailer, "trailer". 
- Function: collects blender discharge, distributes to pump suctions, and collects pump discharge to one high-pressure outlet.
- BH HP iron and manifold trailers: self-contained crane; removable iron racks; swivel mounts at waist height; large-bore 15K psi trailer; up to 110 bpm; 15,000 psi [4]. Trailer dimensions/weight: not found. Used tandem trailer listing: 15,000 psi, 70 bpm per outlet (snippet) [22].
- Visual: lowboy-style trailer with two long steel header pipes (suction low-pressure side with 4-6 in hammer unions, discharge high-pressure side with 3-in 1502 connections and plug valves), iron racks, small knuckle crane.
- Count: 1 (or 2 for dual-manifold/230 bpm designs [9]); position: between blender and pump row, on the pump-row centerline.

### 12. High-pressure treating iron
- Components: chiksan swivel joints, pup joints, plug valves, check valves, tees/wyes, hammer unions (1502 fig), flowline.
- Pressure: rated up to 15,000 psi (frac equipment) [4]. Typical iron diameters 2-3 in (a 2.5 in x 20 ft 15K assembly with 3-in 1502 ends exists, snippet) [23]. Weights: not found.
- Visual: gray/orange segmented pipe with rotating elbow joints and knuckle-shaped swivels, hammer-union lugs (winged nuts), labeled plug valves with long handles; iron racks hold them. Iron trailer (convention) carries these loose.

### 13. Zipper manifold
- Aliases: zipper, zipper manifold, "pump manifold". 
- Function: valved manifold that lets pumping alternate between wells (zipper frac); its valves are the primary barrier while ground valves stay open [24].
- Rating: Cameron/SLB frac trees and zipper manifolds up to 7 in and 15,000 psi (snippet) [24][25]. Dimensions/weight: not found.
- Visual: either a trailer/skid with a main header and several valved outlets, or a stack of valves on the ground between the missile and wells; outlet heads connect to each tree by short iron/hose.
- Position: between the missile and the wellheads, typically 20-100 ft in front of the wells (est.).

### 14. Frac tree and goat head
- Aliases: frac tree, frac stack, "Christmas tree" (production tree), goat head (a block with multiple 1502 inlets on top connecting iron, convention).
- Function: connects treating iron to the wellhead with master valves and wing valves (swab valve on top for wireline).
- Rating: Cameron composite frac tree is rated 10,000 and 15,000 psi and is 25% shorter than a conventional arrangement; absolute dimensions not found [25]. Frac valves available in 7-1/16 in bore at 10,000 psi (snippet) [26]. Weight/height: not found.
- Visual: stack of large gate valves (tall hydraulic actuators) over a flanged wellhead with a block top and side wings (two wing outlets), sometimes with a greasing system [24].

### 15. Wellheads
- Function: casing heads/tubing spool at the surface, holding casing strings; the tree attaches here.
- Rating: a patent example gives 10,000 psi wellheads [14]. Spacing between wells on a pad: not found in cited sources. Cellars or conductor steel visible; each well has a frac tree during stimulation.
- Position: in a line at pad edge (convention).

### 16. Data van
- Aliases: data van, control van, "the van", frac van, command center. (convention)
- Function: control room for pumps, blender, chemical unit; real-time pressure, rate, density.
- Dimensions: not found. SLB has "StimCommander process trailer" (snippet only, no specs) [27]. Visual: box trailer or cab-like van with antennas and satellite dish, multi-monitor operator stations. Position: near the missile/blender with a line of sight to the wellheads (est.).

### 17. Wireline unit, crane, lubricator, grease head
- Function: pump-down plug-and-perf on wireline. Lubricator seals wellbore pressure; the grease head contains pressure while braided line moves; a crane holds the lubricator over the tree [28][29].
- SLB's pumpdown fleet includes a perforating unit, a 40-ton US crane, and a parts trailer (snippet) [30]. Counts: 1 wireline truck, 1 crane, 1 support trailer per job (est.). Dimensions: not found.
- Visual: a wireline truck with an enclosed cab and drum, a telescoping crane with a lubricator hung from a hook and a tool string inside; a grease-head tower on top of the lubricator; control cabin.

### 18. Pump-down pump
- Function: a dedicated frac pump (or one of the fleet) used to pump the wireline tool string and plug down the lateral at about 6-12 bbl/min [31].
- Same appearance as a frac pump; 1-2 units dedicated, often with a separate small iron line to the wireline tree (est.). Plug example: Weatherford FracGuard composite plug [31].

### 19. Iron trailer
- Aliases: iron truck, iron trailer, "iron hauler". 
- Function: transports loose chiksan and flowline; staged behind the pumps. Dimensions: not found (see BH iron racks [4]).

### 20. Flowback / well test
- Components: sand separator (5,000/10,000/15,000 psi, vertical or spherical designs with on-skid bypass [32]); choke manifold (10,000-15,000 psi with dual choke options [33]); test separator (4-phase units 42-60 in diameter, rated to 2,000 psi per one vendor (snippet) [34]); flare stack and line; surge tanks.
- Dimensions/weights: not found. Visual: skid-mounted vertical vessels with piping, a choke manifold with hydraulic actuators, a flare stack on a skid. Position: set aside from the stimulation spread, near wells but upwind, with flare away from tanks/people (est.); flowback typically starts after frac, not concurrent.

### 21. Light towers
- Function: lighting for night operations. Count/size: not found. Visual: trailer-mounted telescoping mast with 4 lamp heads, diesel genset; spaced around the pad (est.).

### 22. Generators
- Function: power for light towers, offices, data van; large diesel gensets or microgrid for e-frac. Counts/size: not found for diesel fleet; see item 3 for e-frac.

### 23. Fuel trucks, bi-fuel/dual-fuel
- Function: on-site refueling of diesel pumps, blender, and generators; bi-fuel units burn natural gas and diesel. Count/size: not found. Visual: fuel tanker with reel hose; "fueler" parks alongside pump row. Fuel capacity of pump units: 400 gal Rhino [5], 380 gal blender [3] (shows refueling frequency).

### 24. Office trailers and doghouse
- Function: company-man trailer, safety meeting area, break room; "doghouse" = small shelter. Dimensions: not found. Position: farthest from pressure iron and flare, near the pad entrance (est.).

### 25. Pad: gravel, berms, liners, sound walls
- Typical pad area: Penn State course material says 5-10 acres depending on number of wells; Marcellus pad supporting 4-8 horizontal wells about 7.4 acres (snippet) [35][36]; average WV pad 1.6 acres (2007) rising to 2.4 acres (2014) (snippet) [37]. One engineering project example: 300 ft x 500 ft pad (snippet) [38]. Permian pad sizes: not found.
- Gravel surface with stormwater berms/liners, secondary containment under tank farms and pump rows (a frac tank battery with a containment berm is a standard feature, snippet) [38]; sound walls (stacked-panel noise barriers) beside tubing/pump rows near homes: not found in cited sources; convention only.

## Typical pad layout (approximate, mostly estimate)
- Pad: ~300 x 500 ft is a documented example [38]; real pads range ~2-10 acres [35]-[37] (1 acre = 43,560 sq ft).
- Wellheads in a row along one pad edge. Fleet is arranged behind them: zipper manifold nearest the wells, then missile, then a row of pumps, with blender and sand in the rear; water tank farm and hydration along another edge (convention, est.). No cited source gives pump-to-well distances; use estimates and label them as such.
- Pump trailer length is 61 ft [5] so a row of 15-20 pumps would span roughly 120-200 ft in two rows (est.).
- Egress: keep a clear lane for tractors; keep blender, sand and tanks reachable for trucks (est.).

## Sources
1. Baker Hughes, DOTF hydration unit spec. https://dam.bakerhughes.com/m/349f7564d29c6a1f/original/DOTF-hydration-unit-spec.pdf
2. Baker Hughes, Mobile hydration units. https://dam.bakerhughes.com/m/6cd22a5f20cde91e/original/Mobile-hydration-unit-spec.pdf
3. Baker Hughes, 125E blender. https://dam.bakerhughes.com/m/bea6c46ad82282b/original/125E-trailer-mounted-blender-unit.pdf
4. Baker Hughes, HP iron and manifold trailers. https://dam.bakerhughes.com/m/302855c615397735/original/HP-Iron-Manifold-spec.pdf
5. Baker Hughes, Rhino 2000 HHP pump. https://dam.bakerhughes.com/m/5fa281a765aa0f01/original/Rhino-2000-hhp-high-pressure-pump-units-spec.pdf
6. Baker Hughes, SC 2000 frac pump. https://dam.bakerhughes.com/m/25dc8d6dd18a2f77/original/SC-2000-frac-pump-spec.pdf
7. Baker Hughes, Mobile chemical additive unit. https://dam.bakerhughes.com/m/663fe419576784ce/original/Mobile-chemical-additive-unit-spec.pdf
8. Baker Hughes, Mobile LFC transport unit. https://dam.bakerhughes.com/m/84491c307e54cb6/original/Mobile-LFC-transport-unit-spec.pdf
9. Halliburton, Zeus electric pumping unit. https://www.halliburton.com/en/products/zeus-electric-pumping-unit (also halliburton.com Zeus electric manifold trailer, 230 bpm, and oilfieldtechnology.com VoltaGrid article, snippets)
10. Hart Energy, electric powered pressure pumping. https://hartenergy.com/exclusives/electric-powered-pressure-pumping-solves-regulatory-cost-concerns-175907 (snippet)
11. Liberty Energy, electric/hybrid completions. https://libertyenergy.com/?p=59 (snippet)
12. Hart Energy, Liberty selects Rolls-Royce MTU gensets. https://hartenergy.com/exclusives/liberty-selects-rolls-royces-mtu-gas-generator-sets-power-electric-frac-pumps-195696 (403; headline only)
13. Baker Hughes, Sand King trailer. https://dam.bakerhughes.com/m/681d83733a44c59d/original/Sand-King-unit-spec.pdf
14. US patent 11339637, packaging and deployment of a frac pump on a frac pad. https://patents.google.com/patent/US11339637
15. Shale gas slide deck (low reliability). https://www.scribd.com/document/329508876/2015-Shale-Gas (snippet)
16. Weir TWS 2250HD listing. https://www.environmental-expert.com/products/model-tws-2250hd-well-service-stimulation-pumps-358008 (snippet)
17. SANY HSC100 blender. https://www.sanyglobal.com/product/petroleum_equipment/fracking_unit/23/449 (snippet)
18. Solaris proppant management. https://solaris-energy.com/solutions/proppant-management-system ; Business Wire 2015 release https://businesswire.com/news/home/20150810005379/en/ (snippets)
19. U.S. Silica / SandBox. https://ussilica.com/sandbox-logistics ; https://ussilica.gcs-web.com/node/10106 (snippets)
20. SandBox patent background. https://patents.google.com/patent/US9932181 (snippet)
21. Frac tank listings, e.g. https://www.truckpaper.com/listing/for-sale/221539563/2026-ace ; https://www.flowtechenergy.com/?p=3600 (snippets; dealer data)
22. Used manifold trailer. https://www.indpress.com/used-for-sale/p/trailers-manifold-cn4x6-lpjsc (snippet)
23. Austin Hose 15K frac assembly. https://www.austinhose.com/itemdetail/0000695141 (snippet)
24. SLB, Cameron frac trees and zipper manifolds. https://www.slb.com/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/frac-trees-and-zipper-manifolds (snippet); zipper patent US11180979 https://patents.google.com/patent/US11180979
25. SLB composite frac tree. https://www.slb.com/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/composite-frac-tree (snippet)
26. SLB Cameron frac valves. https://www.slb.com/zh-cn/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/frac-valves (snippet)
27. SLB StimCommander process trailer. https://slb.com/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/stimcommander-automated-stimulation-delivery-platform/stimcommander-process-trailer (snippet)
28. Hunting pressure control equipment. https://huntingplc.com/products-services/well-intervention-equipment/pressure-control-equipment (snippet)
29. Lubricator patent. https://patents.google.com/patent/US11041355 (snippet)
30. SLB quiet wireline pumpdown fleet. https://www.slb.com/completions/stimulation/pumpdown-perforating/quiet-wireline-pumpdown-perforating-fleet (snippet)
31. Weatherford FracGuard plug. https://www.weatherford.com/documents/technical-specification-sheet/products-and-services/completions/fracguard-pumpdown-composite-plug (snippet)
32. SLB sand separators. https://www.slb.com/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/sand-separators (snippet)
33. SLB choke manifolds. https://slb.com/products-and-services/innovating-in-oil-and-gas/completions/stimulation/frac-and-flowback-equipment/choke-manifolds (snippet)
34. EnerCorp flowback brochure. https://enercorp.zippywp.com/wp-content/uploads/2018/02/EnerCorp-Brochure-Sand-Flowback-web.pdf (snippet)
35. Penn State e-education. https://www.e-education.psu.edu/earth109/node/941 (snippet)
36. Penn State Moodhe capstone 2021. https://handbook.geospatial.psu.edu/sites/default/files/capstone/Moodhe_Geog596Bpaper_20210401.pdf (snippet)
37. ProPublica WV well pads. https://projects.propublica.org/graphics/wva-well-pads (snippet)
38. Larson Design Group, Lycoming County well pad. https://www.larsondesigngroup.com/projects/lycoming-county-well-pad-design/ (snippet)

## Known gaps
No dimensions/weights found for: electric pump trailers, turbines/gensets, zipper manifold, frac trees, wellhead, data van, wireline truck/crane, transfer pumps, light towers, office trailers, fuel trucks, flowback skids, SandBox container. Weir SPM QWS 2500 official sheet not retrieved (two SPM pages timed out). Pad spacing and well-to-fleet distances not found in any primary source; regulator pad plans (PA DEP, Texas RRC, NM OCD) are the next place to look.
