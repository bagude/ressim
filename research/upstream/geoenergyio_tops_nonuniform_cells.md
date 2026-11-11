### What happens

For a grid given as `DXV` / `DYV` / `DZV` + `TOPS` with **non-uniform** cell sizes, the top surface is applied at the wrong horizontal positions, so cell depths are off wherever `TOPS` varies (a dipping layer, for example). With uniform cell sizes everything is right.

### Reproduction

```julia
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
println("centroid depth:   ", round.(z, digits = 3))
println("expected (plane): ", round.(expected, digits = 3))
println("difference (m):   ", round.(z .- expected, digits = 3))
x_used, _ = GeoEnergyIO.CornerPointGrid.cell_centers_from_deltas(dx)
println("cell_centers_from_deltas(dx) = ", x_used, "   true centres = ", xc)
```

Output:

```
centroid depth:   [1005.5, 1006.625, 1008.875, 1013.375]
expected (plane): [1005.5, 1007.0, 1010.0, 1016.0]
difference (m):   [0.0, -0.375, -1.125, -2.625]
cell_centers_from_deltas(dx) = [5.0, 25.0, 65.0, 145.0]   true centres = [5.0, 20.0, 50.0, 110.0]
```

### Cause

`cell_centers_from_deltas` in `src/CornerPointGrid/interface.jl`:

```julia
x[1] = dx[1]/2.0 + x0
for i in 2:nx
    x[i] = x[i-1] + dx[i]
end
```

The centre of cell `i` is the centre of cell `i-1` plus half of each of the two widths, so the loop should read

```julia
x[i] = x[i-1] + (dx[i-1] + dx[i])/2
```

As written, cell `i` is placed `(dx[i] - dx[1])/2` away from its true centre. These positions are the abscissas of the interpolant that `mesh_from_dxdydz_and_tops` uses to move the mesh nodes, so the given tops end up shifted by that distance; the depth error is that distance times the local dip.

### Versions

GeoEnergyIO 1.1.34, Julia 1.11.9, Windows. The same lines are on `main` today.

*(Found while building graded meshes around hydraulic fractures on a dipping layer. This report was prepared with the help of an AI coding assistant; the reproduction above was run locally.)*
