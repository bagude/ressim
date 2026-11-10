# Rock properties that vary across the map.
#
# A `GeoField` is one property on a regular grid in field coordinates (feet), sampled anywhere by
# bilinear interpolation. `gaussian_field` generates one as a Gaussian random field with a stated
# variogram model (spherical, exponential or gaussian), range, sill, nugget and anisotropy, reproducible
# from a seed. A `Geology` is a named set of fields (porosity, permeability, net thickness, water
# saturation, ...) that a well model, a log generator and a map can all read, so they describe the
# same rock.
#
# Method: circulant embedding (Dietrich and Newsam). The covariance is laid on a periodic grid at least
# twice the size of the field, its eigenvalues are its Fourier transform, and the field is the transform
# of white noise scaled by their square roots. It is exact when no eigenvalue is negative; the share
# that had to be clipped is returned so a caller can see when it is not. The transform is written
# here (radix 2) because the pinned environment has no FFT package to rely on.
#
# What this is not: no facies, no trends or drift (add your own mean surface), no conditioning to well
# data (that is the mapper's job), one layer (properties vary in map view only).

using Random

"In-place radix-2 fast Fourier transform of a complex vector (length a power of two), forward, unnormalised."
function fft_pow2!(a::AbstractVector{ComplexF64})
    n = length(a); ispow2(n) || error("fft_pow2!: length must be a power of two")
    j = 1
    for i in 1:n-1                                  # bit reversal
        i < j && ((a[i], a[j]) = (a[j], a[i]))
        m = n >> 1
        while m >= 1 && j > m
            j -= m; m >>= 1
        end
        j += m
    end
    len = 2
    while len <= n
        w = cis(-2 * pi / len)
        for s in 1:len:n
            u = complex(1.0)
            for k in 0:(len >> 1)-1
                x = a[s+k]; y = a[s+k+(len>>1)] * u
                a[s+k] = x + y; a[s+k+(len>>1)] = x - y
                u *= w
            end
        end
        len <<= 1
    end
    return a
end

"Two-dimensional forward transform of a complex matrix whose sides are powers of two."
function fft2_pow2(A::AbstractMatrix)
    B = ComplexF64.(A)
    for j in axes(B, 2)
        fft_pow2!(view(B, :, j))
    end
    for i in axes(B, 1)
        fft_pow2!(view(B, i, :))
    end
    return B
end

"Correlation at a lag of r ranges for a variogram model (1 at zero lag; the range is where it has, in practice, died out)."
function correlation_model(model::Symbol, r)
    model == :spherical && return r < 1 ? 1 - 1.5 * r + 0.5 * r^3 : 0.0
    model == :exponential && return exp(-3 * r)
    model == :gaussian && return exp(-3 * r^2)
    error("unknown variogram model $(model): use :spherical, :exponential or :gaussian")
end

"One property on a regular grid: node (i, j) sits at (x0 + (i-1) dx, y0 + (j-1) dy), feet."
struct GeoField
    x0::Float64; y0::Float64; dx::Float64; dy::Float64
    values::Matrix{Float64}
end

"Value at (x, y) by bilinear interpolation; outside the grid the nearest edge value is used."
function sample(f::GeoField, x, y)
    nx, ny = size(f.values)
    u = clamp((x - f.x0) / f.dx, 0.0, nx - 1.0); v = clamp((y - f.y0) / f.dy, 0.0, ny - 1.0)
    i = min(floor(Int, u) + 1, nx - 1); j = min(floor(Int, v) + 1, ny - 1)
    nx == 1 && (i = 1); ny == 1 && (j = 1)
    a = u - (i - 1); b = v - (j - 1)
    i2 = min(i + 1, nx); j2 = min(j + 1, ny)
    return (1 - a) * (1 - b) * f.values[i, j] + a * (1 - b) * f.values[i2, j] + (1 - a) * b * f.values[i, j2] + a * b * f.values[i2, j2]
end

"""
    gaussian_field(; nx, ny, cell_ft, range_ft, model = :spherical, sill = 1, nugget = 0, minor_range_ft = range_ft,
                     azimuth_deg = 0, seed = 1, x0 = 0, y0 = 0)

A zero-mean Gaussian random field on an nx by ny grid of square cells. `range_ft` is the variogram range
along `azimuth_deg` (degrees anticlockwise from the +x axis), `minor_range_ft` the range across it;
`sill` the total variance, of which `nugget` is uncorrelated from node to node. Returns the field and
the share of the spectrum that had to be clipped (0 means the field has exactly the stated covariance).
The same seed gives the same field on this installation.
"""
function gaussian_field(; nx, ny, cell_ft, range_ft, model = :spherical, sill = 1.0, nugget = 0.0, minor_range_ft = range_ft, azimuth_deg = 0.0, seed = 1, x0 = 0.0, y0 = 0.0)
    0 <= nugget <= sill || error("gaussian_field: nugget must lie between 0 and the sill")
    pad = ceil(Int, max(range_ft, minor_range_ft) / cell_ft)
    P = nextpow(2, max(2 * nx, nx + 2 * pad)); Q = nextpow(2, max(2 * ny, ny + 2 * pad))
    ca = cosd(azimuth_deg); sa = sind(azimuth_deg)
    C = zeros(P, Q)
    for j in 1:Q, i in 1:P
        # signed lag to the nearest image on the periodic grid, then rotated into the directions of the two ranges
        hx = cell_ft * (i - 1 <= P ÷ 2 ? i - 1 : i - 1 - P); hy = cell_ft * (j - 1 <= Q ÷ 2 ? j - 1 : j - 1 - Q)
        u = (hx * ca + hy * sa) / range_ft; v = (-hx * sa + hy * ca) / minor_range_ft
        C[i, j] = correlation_model(model, sqrt(u^2 + v^2))
    end
    lam = real.(fft2_pow2(C))
    neg = sum(x -> x < 0 ? -x : 0.0, lam); pos = sum(x -> x > 0 ? x : 0.0, lam)
    rng = Random.MersenneTwister(seed)
    W = [sqrt(max(lam[i, j], 0.0) / (P * Q)) * complex(randn(rng), randn(rng)) for i in 1:P, j in 1:Q]
    Z = real.(fft2_pow2(W))[1:nx, 1:ny]
    vals = sqrt(sill - nugget) .* Z
    nugget > 0 && (vals .+= sqrt(nugget) .* randn(rng, nx, ny))
    return (field = GeoField(x0, y0, cell_ft, cell_ft, vals), clipped = neg / max(pos, 1e-300))
end

"Half the mean squared difference between nodes `lag` cells apart along x (dir = 1) or y (dir = 2): the sample variogram."
function field_variogram(f::GeoField, lag::Int; dir = 1)
    v = f.values; nx, ny = size(v); s = 0.0; n = 0
    if dir == 1
        for j in 1:ny, i in 1:nx-lag
            s += (v[i+lag, j] - v[i, j])^2; n += 1
        end
    else
        for j in 1:ny-lag, i in 1:nx
            s += (v[i, j+lag] - v[i, j])^2; n += 1
        end
    end
    return s / (2 * n)
end

"A named set of fields over the same area: the rock that wells, logs and maps all read."
struct Geology
    fields::Dict{Symbol, GeoField}
end
sample(g::Geology, name::Symbol, x, y) = sample(g.fields[name], x, y)
Base.keys(g::Geology) = keys(g.fields)

"A new field from one or more fields of the same grid: `map_fields(f, a, b)` applies f node by node."
map_fields(f, a::GeoField, rest::GeoField...) = GeoField(a.x0, a.y0, a.dx, a.dy, map(f, a.values, (r.values for r in rest)...))

"""
    synthetic_geology(; nx, ny, cell_ft, range_ft, seed, ...)

A plausible shale-play rock model from correlated Gaussian fields, for games and tests (not a
description of any real rock): porosity, permeability (log-normal, tied to porosity), gross thickness,
net-to-gross (so net pay = gross x net-to-gross, and thick rock tends to have more net), and water
saturation (lower where porosity is higher). Each property is given as a mean and a spread;
`correlation` ties permeability and water saturation to porosity. `gross_ft` may also be one number.
Fields: `:porosity`, `:perm_md`, `:gross_ft`, `:ntg`, `:net_ft`, `:sw`.
"""
function synthetic_geology(; nx, ny, cell_ft, range_ft, seed = 1, model = :spherical, minor_range_ft = range_ft, azimuth_deg = 0.0, nugget = 0.0,
        porosity = (mean = 0.08, sd = 0.012), perm_md = (median = 5e-4, decades = 0.25, correlation = 0.7), gross_ft = (mean = 100.0, sd = 15.0),
        net_to_gross = (mean = 0.8, sd = 0.08), sw = (mean = 0.30, sd = 0.05, correlation = -0.6), x0 = 0.0, y0 = 0.0)
    z(k) = gaussian_field(; nx = nx, ny = ny, cell_ft = cell_ft, range_ft = range_ft, model = model, minor_range_ft = minor_range_ft, azimuth_deg = azimuth_deg,
        nugget = nugget, seed = seed + k, x0 = x0, y0 = y0).field
    zp = z(0); zk = z(1); zn = z(2); zs = z(3); zg = z(4)
    tie(a, b, rho) = map_fields((u, v) -> rho * u + sqrt(1 - rho^2) * v, a, b)          # unit variance, correlation rho with a
    phi = map_fields(u -> clamp(porosity.mean + porosity.sd * u, 0.01, 0.35), zp)
    k = map_fields(u -> perm_md.median * 10.0^(perm_md.decades * u), tie(zp, zk, perm_md.correlation))
    gross = gross_ft isa Number ? map_fields(u -> Float64(gross_ft), zg) : map_fields(u -> max(gross_ft.mean + gross_ft.sd * u, 0.2 * gross_ft.mean), zg)
    ntg = map_fields(u -> clamp(net_to_gross.mean + net_to_gross.sd * u, 0.05, 1.0), zn)
    net = map_fields(*, gross, ntg)
    water = map_fields(u -> clamp(sw.mean + sw.sd * u, 0.05, 0.9), tie(zp, zs, sw.correlation))
    return Geology(Dict(:porosity => phi, :perm_md => k, :net_ft => net, :ntg => ntg, :sw => water, :gross_ft => gross))
end

"""
    well_maps(g; origin_ft, azimuth_deg, width_ft)

Functions of a fractured-well model's own coordinates (x along the lateral, y across the model, feet)
that read the geology under it. `origin_ft` is the map position of the point on the lateral where the
model's x is zero; the lateral runs from there along `azimuth_deg` (anticlockwise from +x); the lateral
sits at y = width_ft / 2. Pass the result's fields to `FracWellSpec` as `porosity_map`, `perm_map`,
`net_thickness_map` and `sw_map`; give the spec a `thickness_ft` at least as large as the net pay anywhere
under the model (for example the largest gross thickness of the geology).
"""
function well_maps(g::Geology; origin_ft, azimuth_deg = 0.0, width_ft)
    ca = cosd(azimuth_deg); sa = sind(azimuth_deg)
    at(name) = (x, y) -> sample(g, name, origin_ft[1] + x * ca - (y - width_ft / 2) * sa, origin_ft[2] + x * sa + (y - width_ft / 2) * ca)
    return (porosity_map = at(:porosity), perm_map = at(:perm_md), net_thickness_map = at(:net_ft), sw_map = at(:sw))
end
