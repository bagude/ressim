# Minimal reproduction: TOPS applied at the wrong position when DXV is not uniform.
using GeoEnergyIO, Jutul
dir = mktempdir(); path = joinpath(dir, "TOPS.DATA")
dx = [10.0, 20.0, 40.0, 80.0]                        # metres, not uniform
xc = cumsum(dx) .- dx ./ 2                           # true cell centres: 5, 20, 50, 110
tops = 1000.0 .+ 0.1 .* xc                           # a plane dipping 0.1 m per m, given at the cell centres
write(path, """
RUNSPEC
DIMENS
 4 1 1 /
METRIC
GRID
DXV
 $(join(dx, " ")) /
DYV
 10 /
DZV
 10 /
TOPS
 $(join(tops, " ")) /
PORO
 4*0.2 /
PERMX
 4*100 /
END
""")
data = parse_data_file(path)
g = mesh_from_grid_section(data["GRID"])
geo = tpfv_geometry(g)
z = geo.cell_centroids[3, :]
expected = tops .+ 5.0                               # top + half of DZ at each cell centre
println("cell centre x:        ", geo.cell_centroids[1, :])
println("centroid depth:       ", round.(z, digits = 3))
println("expected (plane):     ", round.(expected, digits = 3))
println("difference (m):       ", round.(z .- expected, digits = 3))
x_used, _ = GeoEnergyIO.CornerPointGrid.cell_centers_from_deltas(dx)
println("cell_centers_from_deltas(dx) = ", x_used, "   true centres = ", xc)
