# Minimal reproduction: cumulative totals from summary_result in field units.
using JutulDarcy, Jutul, GeoEnergyIO
path = GeoEnergyIO.test_input_file_path("SPE1", "SPE1.DATA")
case = setup_case_from_data_file(path)
res = simulate_reservoir(case, info_level = -1)
s = JutulDarcy.summary_result(case, res, :field)
w = s["VALUES"]["WELLS"]["PROD"]
t = s["TIME"].seconds
dt_days = diff([0; t]) ./ 86400
wopr = w["WOPR"]; wopt = w["WOPT"]
by_hand = cumsum(wopr .* dt_days)
println("final WOPR (field units, stb/day):      ", wopr[end])
println("final WOPT from summary_result:         ", wopt[end])
println("cumsum(WOPR * dt in days):              ", by_hand[end])
println("ratio WOPT / by hand:                   ", wopt[end] / by_hand[end])
