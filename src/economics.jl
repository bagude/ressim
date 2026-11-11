# Economics of a forecast: prices, costs, taxes and discounting to cash flow, NPV, rate of return and payout.
# (stream 9, 2026-11-10)
#
# Monthly volumes in (oil in bbl, gas in Mscf, water in bbl), money out (US dollars), before income tax.
# Every convention is an argument of `EconTerms` with a stated default; research/economics-conventions.md says
# what the common evaluation tools do where they differ. In short, the defaults are:
#   interests    the owner holds `working_interest` of the costs and `net_revenue_interest` of the revenue
#                (working interest x (1 - royalty) unless given)
#   taxes        severance and ad valorem as rates on the owner's own revenue; ad valorem after severance
#   costs        a fixed cost per producing well per month and variable costs per barrel and per Mscf, at 8/8ths,
#                of which the owner pays the working-interest share; the same for capital
#   discounting  an effective annual rate, each month's operating cash taken at mid-month, capital at the start of
#                the month it is listed in (month 1 = time zero)
#   limit        production stops after the last month whose net operating income is positive
# Not here: income tax, depreciation and depletion, price and cost escalation (give a price deck by month instead),
# hedges, carried or reversionary interests, inflation.

"A value for month `m` from a number (the same every month) or a list by month (its last value holds after its end)."
by_month(x::Real, m) = Float64(x)
by_month(x::AbstractVector, m) = Float64(x[min(m, length(x))])

Base.@kwdef struct EconTerms
    oil_price_usd_bbl::Any                           # benchmark price: a number, or a list by month
    gas_price_usd_mscf::Any = 0.0
    oil_differential_usd_bbl::Float64 = 0.0          # added to the benchmark (negative for a discount)
    gas_differential_usd_mscf::Float64 = 0.0
    working_interest::Float64 = 1.0                  # share of costs and capital
    royalty::Float64 = 0.0                           # lessor's share of revenue
    net_revenue_interest::Float64 = NaN              # share of revenue; NaN: working_interest x (1 - royalty)
    severance_oil::Float64 = 0.0                     # rates, as shares of the taxed revenue
    severance_gas::Float64 = 0.0
    ad_valorem::Float64 = 0.0
    taxes_on::Symbol = :net_revenue                  # :net_revenue (the owner's own share) | :gross_revenue (the working-interest share before royalty)
    ad_valorem_after_severance::Bool = true          # ad valorem on the taxed revenue less severance tax (false: on the taxed revenue)
    fixed_usd_well_month::Float64 = 0.0              # 8/8ths
    oil_cost_usd_bbl::Float64 = 0.0
    gas_cost_usd_mscf::Float64 = 0.0
    water_cost_usd_bbl::Float64 = 0.0
    abandonment_usd::Float64 = 0.0                   # 8/8ths, paid in the last producing month
    discount_rate::Float64 = 0.10                    # per year
    rate_basis::Symbol = :effective                  # :effective: factor (1 + R)^(-t / 12) | :nominal: (1 + R / 12)^(-t), t in months
    discount_timing::Symbol = :mid_month             # when a month's operating cash is taken: :mid_month | :end_of_month
    capital_timing::Symbol = :start_of_month         # :start_of_month (month 1 = time zero) | :with_month (as that month's operating cash)
    limit_rule::Symbol = :stays_negative             # :stays_negative | :first_negative | :none (see `cash_flow`)
end

"A copy of the terms with some of them replaced."
with_terms(t::EconTerms; kw...) = EconTerms(; (f => getfield(t, f) for f in fieldnames(EconTerms))..., kw...)

"Discount factor for a time `t` in months from time zero."
function discount_factor(t, rate; basis = :effective)
    basis == :effective && return (1 + rate)^(-t / 12)
    basis == :nominal && return (1 + rate / 12)^(-t)
    error("rate_basis must be :effective or :nominal")
end

"Time in months at which month `m`'s operating cash (or capital) is taken."
function cash_time(m, timing)
    timing == :mid_month && return m - 0.5
    timing == :end_of_month && return Float64(m)
    timing == :start_of_month && return m - 1.0
    error("timing must be :mid_month, :end_of_month or :start_of_month")
end
capital_time(m, t::EconTerms) = t.capital_timing == :start_of_month ? m - 1.0 : t.capital_timing == :with_month ? cash_time(m, t.discount_timing) :
    error("capital_timing must be :start_of_month or :with_month")

"Capital by month from a number (all in month 1), a list by month, or a list of (month, dollars) pairs."
function capital_by_month(capital, n)
    cap = zeros(n)
    if capital isa Real
        n >= 1 && (cap[1] = capital)
    elseif capital isa AbstractVector && all(x -> x isa Real, capital)
        length(capital) <= n || error("capital is listed for more months than the forecast has")
        cap[1:length(capital)] .= capital
    else
        for (m, usd) in capital
            1 <= m <= n || error("capital in month $m lies outside the forecast (1 to $n)")
            cap[Int(m)] += usd
        end
    end
    return cap
end

"""
    forecast_volumes(x)

Monthly oil (bbl), gas (Mscf) and water (bbl) from what the rest of the package returns: a `run_fracwell` result
(stages added up), a `run_field` result (wells added up; gas and water rebuilt from its report steps), anything with
`monthly_oil_stb`, a named tuple `(oil = , gas = , water = )`, or a plain list of monthly oil.
"""
function forecast_volumes(x)
    x isa AbstractVector && return (oil = Float64.(x), gas = zeros(length(x)), water = zeros(length(x)))
    cols(a) = a isa AbstractMatrix ? vec(sum(a, dims = 2)) : Float64.(collect(a))
    if haskey(x, :oil)
        oil = cols(x.oil); n = length(oil)
        return (oil = oil, gas = haskey(x, :gas) ? cols(x.gas) : zeros(n), water = haskey(x, :water) ? cols(x.water) : zeros(n))
    end
    haskey(x, :monthly_oil_stb) || error("forecast_volumes: nothing here that looks like a monthly forecast")
    x.monthly_oil_stb isa AbstractVector && !isempty(x.monthly_oil_stb) && first(x.monthly_oil_stb) isa AbstractVector &&
        error("this holds several alternative forecasts (a matched family): use economics_spread(x.monthly_oil_stb, terms)")
    haskey(x, :seeds) && error("this is an uncertainty run (its columns are draws, not wells): use ensemble_economics(x, terms)")
    oil = cols(x.monthly_oil_stb); n = length(oil)
    gas = zeros(n); water = zeros(n)
    if haskey(x, :monthly_gas_mscf)
        gas = cols(x.monthly_gas_mscf)
    elseif haskey(x, :gas_mscf_d) && haskey(x, :step_days)                 # a field run: per report step, per well
        gas = steps_to_months(vec(sum(x.gas_mscf_d, dims = 2)), x.step_days, n)
    end
    if haskey(x, :monthly_water_stb)
        water = cols(x.monthly_water_stb)
    elseif haskey(x, :liquid_stb_d) && haskey(x, :oil_stb_d) && haskey(x, :step_days)
        water = steps_to_months(vec(sum(x.liquid_stb_d, dims = 2)) .- vec(sum(x.oil_stb_d, dims = 2)), x.step_days, n)
    end
    return (oil = oil, gas = gas, water = water)
end

"Volumes per calendar month (30.4375 days) from average rates per day over report steps of the given lengths."
function steps_to_months(rate_per_day, step_days, months)
    t_end = cumsum(step_days)
    mi = clamp.(ceil.(Int, (t_end .- 1e-6) ./ MONTH_DAYS), 1, months)
    return [sum((rate_per_day .* step_days)[mi .== m]; init = 0.0) for m in 1:months]
end

"""
    cash_flow(oil_bbl, gas_mscf, water_bbl, terms; capital = 0.0, wells = 1)

The monthly cash flow of a forecast for one owner, before income tax. `capital` is at 8/8ths: a number (all in
month 1), a list by month, or (month, dollars) pairs; `wells` is the number of producing wells (a number or a list by
month) that the fixed cost is charged for.

Month by month: revenue at 8/8ths = volume x (benchmark price + differential); the owner's revenue is the net
revenue interest share of it; severance and ad valorem taxes are rates on the taxed revenue (`taxes_on`); operating
cost and capital are the working-interest share of the 8/8ths figures. Net operating income = revenue - taxes -
operating cost. The economic limit (`limit_rule`):
- `:stays_negative` (default): the last month whose net operating income is positive. Everything after it is cut.
- `:first_negative`: the month before net operating income first turns negative after having been positive.
- `:none`: the whole forecast.
After the limit there is no production, no cost and no capital (capital listed later is reported as dropped); the
abandonment cost falls in the limit month. Capital up to the first month of production is always spent, also when
the well never pays (the limit month is then 0, and the well is abandoned in its first month).
Returns the columns by month, `limit_month`, and the totals.
"""
function cash_flow(oil_bbl, gas_mscf, water_bbl, terms::EconTerms; capital = 0.0, wells = 1)
    n = length(oil_bbl); length(gas_mscf) == n && length(water_bbl) == n || error("oil, gas and water need the same number of months")
    t = terms
    0 <= t.working_interest <= 1 && 0 <= t.royalty <= 1 || error("working interest and royalty are shares between 0 and 1")
    nri = isnan(t.net_revenue_interest) ? t.working_interest * (1 - t.royalty) : t.net_revenue_interest
    t.taxes_on in (:net_revenue, :gross_revenue) || error("taxes_on must be :net_revenue or :gross_revenue")
    tax_share = t.taxes_on == :net_revenue ? nri : t.working_interest
    cap = capital_by_month(capital, n) .* t.working_interest
    gross_o = [oil_bbl[m] * (by_month(t.oil_price_usd_bbl, m) + t.oil_differential_usd_bbl) for m in 1:n]
    gross_g = [gas_mscf[m] * (by_month(t.gas_price_usd_mscf, m) + t.gas_differential_usd_mscf) for m in 1:n]
    revenue = (gross_o .+ gross_g) .* nri
    severance = (gross_o .* t.severance_oil .+ gross_g .* t.severance_gas) .* tax_share
    ad_valorem = t.ad_valorem .* ((gross_o .+ gross_g) .* tax_share .- (t.ad_valorem_after_severance ? severance : zeros(n)))
    fixed = [t.fixed_usd_well_month * by_month(wells, m) for m in 1:n] .* t.working_interest
    variable = (oil_bbl .* t.oil_cost_usd_bbl .+ gas_mscf .* t.gas_cost_usd_mscf .+ water_bbl .* t.water_cost_usd_bbl) .* t.working_interest
    noi = revenue .- severance .- ad_valorem .- fixed .- variable
    L = n
    if t.limit_rule == :stays_negative
        L = something(findlast(>(0), noi), 0)
    elseif t.limit_rule == :first_negative
        m0 = findfirst(>(0), noi)
        L = isnothing(m0) ? 0 : something(findfirst(m -> m > m0 && noi[m] < 0, 1:n), n + 1) - 1
    elseif t.limit_rule != :none
        error("limit_rule must be :stays_negative, :first_negative or :none")
    end
    live = [m <= L for m in 1:n]; cut(v) = v .* live
    # Capital up to first production is spent whatever comes after (the well is drilled before anyone knows); capital listed
    # after the limit is not. A well that produced is abandoned at its limit, or in its first month if it never paid.
    first_production = findfirst(m -> oil_bbl[m] > 0 || gas_mscf[m] > 0, 1:n)
    spend_until = isnothing(first_production) ? n : max(L, first_production)
    abandonment = zeros(n)
    t.abandonment_usd != 0 && !isnothing(first_production) && (abandonment[spend_until] = t.abandonment_usd * t.working_interest)
    dropped = sum(cap[spend_until+1:end]; init = 0.0)
    noi_c = cut(noi); cap_c = [m <= spend_until ? cap[m] : 0.0 for m in 1:n]
    net = noi_c .- cap_c .- abandonment
    return (months = n, limit_month = L, oil_bbl = cut(Float64.(oil_bbl)), gas_mscf = cut(Float64.(gas_mscf)), water_bbl = cut(Float64.(water_bbl)),
        gross_revenue_usd = cut(gross_o .+ gross_g), revenue_usd = cut(revenue), oil_revenue_usd = cut(gross_o .* nri), gas_revenue_usd = cut(gross_g .* nri),
        severance_usd = cut(severance), ad_valorem_usd = cut(ad_valorem), fixed_cost_usd = cut(fixed), variable_cost_usd = cut(variable),
        net_operating_income_usd = noi_c, capital_usd = cap_c, abandonment_usd = abandonment, net_cash_usd = net, cumulative_cash_usd = cumsum(net),
        capital_dropped_usd = dropped, net_revenue_interest = nri, net_operating_income_uncut_usd = noi)
end

"Present value at annual rate `rate` of the cash flow `cf` (from `cash_flow`) under the timing conventions of `terms`."
function present_value(cf, terms::EconTerms; rate = terms.discount_rate)
    v = 0.0
    for m in 1:cf.months
        d_op = discount_factor(cash_time(m, terms.discount_timing), rate; basis = terms.rate_basis)
        v += (cf.net_operating_income_usd[m] - cf.abandonment_usd[m]) * d_op
        cf.capital_usd[m] == 0 || (v -= cf.capital_usd[m] * discount_factor(capital_time(m, terms), rate; basis = terms.rate_basis))
    end
    return v
end

"The cash items of a cash flow in order of time: (time in months, dollars). Capital of a month comes before its operating cash when both fall at the same time."
function cash_events(cf, terms::EconTerms)
    ev = Tuple{Float64, Float64}[]
    for m in 1:cf.months
        cf.capital_usd[m] == 0 || push!(ev, (capital_time(m, terms), -cf.capital_usd[m]))
        x = cf.net_operating_income_usd[m] - cf.abandonment_usd[m]
        x == 0 || push!(ev, (cash_time(m, terms.discount_timing), x))
    end
    return sort(ev; by = first)            # stable: capital stays ahead of the same month's cash
end

"""
    rate_of_return(cf, terms; lowest = -0.99, highest = 1.0e4)

The annual rates at which the present value of the cash flow is zero, on the same basis and timing as the NPV.
Returns `rate` (the rate if there is exactly one, otherwise NaN), `rates` (all found), `status` (`:one`, `:none`
or `:several`), `sign_changes` (how often the time-ordered cash changes sign: with one change there is at most one
rate) and a sentence. Rates are looked for between `lowest` and `highest` on a fine grid and then closed in on;
two rates closer together than the grid can be missed, which `sign_changes` warns of.
"""
function rate_of_return(cf, terms::EconTerms; lowest = -0.99, highest = 1.0e4, grid = 4000)
    ev = [x[2] for x in cash_events(cf, terms)]; signs = [sign(x) for x in ev if x != 0]
    changes = count(i -> signs[i] != signs[i-1], 2:length(signs))
    isempty(signs) && return (rate = NaN, rates = Float64[], status = :none, sign_changes = 0, note = "there is no cash flow")
    all(>(0), signs) && return (rate = NaN, rates = Float64[], status = :none, sign_changes = 0, note = "the cash flow is never negative: there is nothing to earn a return on")
    all(<(0), signs) && return (rate = NaN, rates = Float64[], status = :none, sign_changes = 0, note = "the cash flow is never positive: the money is not returned at any rate")
    f(r) = present_value(cf, terms; rate = r)
    # equal steps in log(1 + r)
    rs = [(1 + lowest) * ((1 + highest) / (1 + lowest))^(k / grid) - 1 for k in 0:grid]
    fs = f.(rs); roots = Float64[]
    for k in 1:grid
        fs[k] == 0 && (push!(roots, rs[k]); continue)
        fs[k] * fs[k+1] < 0 || continue
        lo, hi, flo = rs[k], rs[k+1], fs[k]
        for _ in 1:200
            mid = 0.5 * (lo + hi); fm = f(mid)
            (mid == lo || mid == hi) && break
            flo * fm <= 0 ? (hi = mid) : ((lo, flo) = (mid, fm))
        end
        push!(roots, 0.5 * (lo + hi))
    end
    fs[end] == 0 && push!(roots, rs[end])
    status = isempty(roots) ? :none : length(roots) == 1 ? :one : :several
    note = status == :none ? "no rate between $(lowest) and $(highest) makes the present value zero" :
        status == :one ? (changes > 1 ? "one rate found, but the cash changes sign $changes times, so there may be others" : "one rate") :
        "the present value is zero at $(length(roots)) rates; a single rate of return does not describe this cash flow"
    return (rate = status == :one ? roots[1] : NaN, rates = roots, status = status, sign_changes = changes, note = note)
end

"""
Time in months (from time zero) at which the running total of the cash first comes back to zero after being negative.
Capital arrives at its point in time; a month's operating cash flows evenly through the month. `discounted = true`
does the same on discounted cash. Returns 0.0 if the total is never negative and NaN if it never comes back.
"""
function payout_time(cf, terms::EconTerms; discounted = false, rate = terms.discount_rate)
    d(t) = discounted ? discount_factor(t, rate; basis = terms.rate_basis) : 1.0
    total = 0.0; was_negative = false
    for m in 1:cf.months
        cap = cf.capital_usd[m]; op = cf.net_operating_income_usd[m] - cf.abandonment_usd[m]
        if terms.capital_timing == :start_of_month
            cap == 0 || (total -= cap * d(capital_time(m, terms)))
        else
            op -= cap                                   # capital with the month: it flows with the month's cash
        end
        total < 0 && (was_negative = true)
        flow = op * d(cash_time(m, terms.discount_timing))
        after = total + flow
        if was_negative && total < 0 && after >= 0
            return (m - 1) + (-total / flow)            # the month's cash taken as even through the month
        end
        total = after
        total < 0 && (was_negative = true)
    end
    return was_negative ? NaN : 0.0
end

"""
    economics(oil_bbl, gas_mscf, water_bbl, terms; capital = 0.0, wells = 1)
    economics(forecast, terms; capital = 0.0, wells = 1)

Cash flow and the standard measures of a forecast (see `cash_flow` and `EconTerms` for the conventions). `forecast`
is anything `forecast_volumes` understands. Returns:
- `net_cash_usd` (undiscounted, after capital), `npv_usd` at `terms.discount_rate`, `pv_operating_usd`, `pv_capital_usd`
- `rate_of_return` (annual, NaN when there is none or more than one), `rate_of_return_status`, `rates_of_return`, `rate_of_return_note`
- `payout_months`, `discounted_payout_months` (see `payout_time`)
- `return_on_investment` = undiscounted net cash / capital; `discounted_return_on_investment` = NPV / present value of
  capital; `discounted_profitability_index` = present value of operating cash / present value of capital (= the former + 1)
- `limit_month`, `eur_oil_bbl`, `eur_gas_mscf`, `eur_boe` (to the limit; 6 Mscf = 1 BOE), `capital_usd`, `peak_exposure_usd`
- `cash`: the monthly table.
"""
function economics(oil_bbl, gas_mscf, water_bbl, terms::EconTerms; capital = 0.0, wells = 1, boe_mscf = 6.0)
    cf = cash_flow(oil_bbl, gas_mscf, water_bbl, terms; capital = capital, wells = wells)
    npv = present_value(cf, terms)
    pv_cap = sum(cf.capital_usd[m] * discount_factor(capital_time(m, terms), terms.discount_rate; basis = terms.rate_basis) for m in 1:cf.months; init = 0.0)
    cap = sum(cf.capital_usd); net = sum(cf.net_cash_usd)
    ror = rate_of_return(cf, terms)
    running = 0.0; peak = 0.0
    for (_, x) in cash_events(cf, terms)
        running += x; peak = min(peak, running)
    end
    return (net_cash_usd = net, npv_usd = npv, pv_operating_usd = npv + pv_cap, pv_capital_usd = pv_cap, rate_of_return = ror.rate, rate_of_return_status = ror.status,
        rates_of_return = ror.rates, rate_of_return_note = ror.note, payout_months = payout_time(cf, terms), discounted_payout_months = payout_time(cf, terms; discounted = true),
        return_on_investment = cap > 0 ? net / cap : NaN, discounted_return_on_investment = pv_cap > 0 ? npv / pv_cap : NaN,
        discounted_profitability_index = pv_cap > 0 ? (npv + pv_cap) / pv_cap : NaN, limit_month = cf.limit_month, eur_oil_bbl = sum(cf.oil_bbl), eur_gas_mscf = sum(cf.gas_mscf),
        eur_boe = sum(cf.oil_bbl) + sum(cf.gas_mscf) / boe_mscf, capital_usd = cap, peak_exposure_usd = peak, cash = cf)
end
economics(forecast, terms::EconTerms; kw...) = (v = forecast_volumes(forecast); economics(v.oil, v.gas, v.water, terms; kw...))

"""
    breakeven_oil_price(oil_bbl, gas_mscf, water_bbl, terms; capital = 0.0, wells = 1, highest = 1.0e4)

The flat benchmark oil price (USD/bbl, before the differential, replacing any price deck) at which the NPV at
`terms.discount_rate` is zero, everything else as given and the economic limit applied afresh at each price.
0.0 if the NPV is already positive at a price of zero; NaN if it is still negative at `highest`.
With a limit rule other than `:none` the NPV can step DOWN as the price rises (a later month that turns profitable
brings in the loss-making months before it), so the price returned is where the NPV changes sign, found by halving.
"""
function breakeven_oil_price(oil_bbl, gas_mscf, water_bbl, terms::EconTerms; capital = 0.0, wells = 1, highest = 1.0e4)
    f(p) = present_value(cash_flow(oil_bbl, gas_mscf, water_bbl, with_terms(terms; oil_price_usd_bbl = p); capital = capital, wells = wells), terms)
    f(0.0) >= 0 && return 0.0
    hi = 100.0
    while f(hi) < 0
        hi *= 2; hi > highest && return NaN
    end
    lo = 0.0
    for _ in 1:200
        mid = 0.5 * (lo + hi)
        (mid == lo || mid == hi) && break
        f(mid) < 0 ? (lo = mid) : (hi = mid)
    end
    return hi
end
breakeven_oil_price(forecast, terms::EconTerms; kw...) = (v = forecast_volumes(forecast); breakeven_oil_price(v.oil, v.gas, v.water, terms; kw...))

"""
    sensitivity_table(oil_bbl, gas_mscf, water_bbl, terms; capital = 0.0, wells = 1, changes = [-0.2, -0.1, 0.1, 0.2],
                      items = (:oil_price, :gas_price, :capital, :operating_cost))

NPV with one thing changed at a time by the given fractions: the oil price (benchmark, every month), the gas price,
all capital, all operating costs (fixed and variable). Returns `base_npv_usd` and `rows`, each with `item`, `change`,
`npv_usd` and `npv_change_usd`. The economic limit is applied afresh in every case.
"""
function sensitivity_table(oil_bbl, gas_mscf, water_bbl, terms::EconTerms; capital = 0.0, wells = 1, changes = [-0.2, -0.1, 0.1, 0.2],
        items = (:oil_price, :gas_price, :capital, :operating_cost))
    n = length(oil_bbl); cap = capital_by_month(capital, n)
    scaled(x, c) = x isa Real ? x * (1 + c) : collect(x) .* (1 + c)
    npv(t, k) = present_value(cash_flow(oil_bbl, gas_mscf, water_bbl, t; capital = k, wells = wells), t)
    base = npv(terms, cap); rows = NamedTuple[]
    for item in items, c in changes
        t = terms; k = cap
        if item == :oil_price
            t = with_terms(terms; oil_price_usd_bbl = scaled(terms.oil_price_usd_bbl, c))
        elseif item == :gas_price
            t = with_terms(terms; gas_price_usd_mscf = scaled(terms.gas_price_usd_mscf, c))
        elseif item == :capital
            k = cap .* (1 + c)
        elseif item == :operating_cost
            t = with_terms(terms; fixed_usd_well_month = terms.fixed_usd_well_month * (1 + c), oil_cost_usd_bbl = terms.oil_cost_usd_bbl * (1 + c),
                gas_cost_usd_mscf = terms.gas_cost_usd_mscf * (1 + c), water_cost_usd_bbl = terms.water_cost_usd_bbl * (1 + c))
        else
            error("sensitivity_table: unknown item $item")
        end
        v = npv(t, k)
        push!(rows, (item = item, change = c, npv_usd = v, npv_change_usd = v - base))
    end
    return (base_npv_usd = base, rows = rows)
end
sensitivity_table(forecast, terms::EconTerms; kw...) = (v = forecast_volumes(forecast); sensitivity_table(v.oil, v.gas, v.water, terms; kw...))

"""
    economics_spread(draws, terms; capital = 0.0, wells = 1)

The economics of every draw of an uncertainty run, and the spread of their NPV. `draws` is a list of forecasts
(anything `forecast_volumes` understands). Returns `results` (one `economics` per draw), `npv_usd` (per draw),
`npv` (`spread_summary`: `p90` is the low case, exceeded with 90% probability), `chance_of_loss` (share of draws
with a negative NPV) and `eur_oil` (the same summary of oil to the limit).
"""
function economics_spread(draws, terms::EconTerms; capital = 0.0, wells = 1)
    res = [economics(d, terms; capital = capital, wells = wells) for d in draws]
    npvs = [r.npv_usd for r in res]
    return (results = res, npv_usd = npvs, npv = spread_summary(npvs), chance_of_loss = count(<(0), npvs) / length(npvs), eur_oil = spread_summary([r.eur_oil_bbl for r in res]))
end

"""
    ensemble_economics(ens, terms; capital = 0.0, wells = 1)

`economics_spread` for a `run_ensemble` result, with each draw's own oil, gas and water by month. (A result from before
the run kept monthly gas, or one put together by hand without it, has its total gas spread over the months in
proportion to oil, and water taken as zero.)
"""
function ensemble_economics(ens, terms::EconTerms; kw...)
    nd = size(ens.monthly_oil_stb, 2)
    draws = map(1:nd) do j
        oil = ens.monthly_oil_stb[:, j]; total = sum(oil)
        hasproperty(ens, :monthly_gas_mscf) && return (oil = oil, gas = ens.monthly_gas_mscf[:, j], water = hasproperty(ens, :monthly_water_stb) ? ens.monthly_water_stb[:, j] : zeros(length(oil)))
        (oil = oil, gas = total > 0 ? oil .* (ens.cum_gas_mscf[j] / total) : zeros(length(oil)), water = zeros(length(oil)))
    end
    return economics_spread(draws, terms; kw...)
end
