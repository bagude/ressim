# Economics conventions (src/economics.jl)

Written 2026-11-10 for stream 9. Every convention below is an argument of `EconTerms`; this note says what the
default is, why, and what the common evaluation tools do where that could be found. Where a statement about another
tool could not be confirmed from a source that could be opened, it says so.

## What is computed

Monthly, for one owner, before income tax:

| line | formula |
|---|---|
| revenue at 8/8ths | volume x (benchmark price + differential), oil and gas |
| owner's revenue | 8/8ths revenue x net revenue interest |
| severance tax | rate x taxed oil revenue + rate x taxed gas revenue |
| ad valorem tax | rate x (taxed revenue - severance tax), or rate x taxed revenue |
| operating cost | working interest x (fixed per well-month x wells + per bbl oil + per Mscf + per bbl water) |
| net operating income | owner's revenue - taxes - operating cost |
| capital, abandonment | working interest x the 8/8ths figures |
| net cash | net operating income - capital - abandonment |

## Conventions and their defaults

**Interests.** `working_interest` is the share of costs; the net revenue interest is the share of revenue,
`working_interest x (1 - royalty)` unless `net_revenue_interest` is given (overriding royalties and other burdens make
it smaller than that product). This is the ordinary lease arithmetic; the game's module (game/opecon.py) does the same.

**What the taxes are charged on** (`taxes_on`). Default `:net_revenue`: each owner pays tax on its own share, so the
working-interest owner's tax is rate x revenue x net revenue interest; the royalty owner pays the rest. The other
choice, `:gross_revenue`, charges the working-interest share of the 8/8ths revenue (the owner carries the royalty
owner's tax, as some leases and some state rules for particular royalties require). Not confirmed from a source which
of these each commercial tool assumes by default; the game uses the first.

**Ad valorem base** (`ad_valorem_after_severance`). Default `true`: ad valorem on revenue less severance tax. This is
how I recall ARIES treating its ad valorem percentage, and ComboCurve offers a "deduct severance tax" choice for it;
neither could be confirmed from a page that opened (searches returned nothing on the point). The game charges ad
valorem on revenue without deducting severance; set `false` for that. The difference is the ad valorem rate times the
severance tax: with a 2% rate and severance near 5% of revenue, about 0.1% of revenue.

**Discount rate basis** (`rate_basis`). Default `:effective`: the factor for a time t in months is (1 + R)^(-t / 12).
ComboCurve's default and recommended setting is yearly compounding (N = 1) and it reports that this is the only one of
its methods that matches ARIES' recommended "MONTHLY" method [1][2]. SPEE's Recommended Evaluation Practice on rate of
return (REP 10, seen only as a third-party copy [3]) says a monthly rate should be converted to an annual one by the
twelfth power, which is the same thing. `:nominal` uses (1 + R / 12)^(-t), for comparison with spreadsheet practice.

**When a month's cash is taken** (`discount_timing`). Default `:mid_month`: month m's operating cash is discounted
from t = m - 0.5. ComboCurve's "cash accrual time" offers mid-month or end of month, mid-month being the one that
matches ARIES [1][2]. Checked here: for an exponential decline the mid-month figure is within 0.006% of continuous
discounting, the end-of-month figure 0.4% low (test `econ_discounting`).

**When capital is taken** (`capital_timing`). Default `:start_of_month`: capital listed in month m is discounted from
t = m - 1, so capital in month 1 is at time zero and undiscounted. That is the conservative reading of "drill, then
produce". `:with_month` takes it with the month's operating cash (the game's career module does this; its level-score
module puts all capital at time zero and takes cash at month ends). Not confirmed how ARIES and ComboCurve time an
investment inside its month.

**Economic limit** (`limit_rule`). Default `:stays_negative`: production stops after the last month whose net
operating income is positive. `:first_negative` stops at the first loss-making month after a profitable one; `:none`
keeps the whole forecast. The first avoids shutting a well in for one bad month under a price deck; the second is the
strict reading of "produce until operating income goes negative". Capital listed after the limit is dropped; capital
up to first production is always spent. Abandonment cost falls in the limit month. Not confirmed which rule each
commercial tool uses by default (they generally offer a choice of cut-off). With a limit rule on, NPV is not always
increasing in price: a later month that turns profitable brings in the loss-making months before it.

**Rate of return.** The annual rate at which the present value is zero, on the same basis and timing as the NPV (as
REP 10 asks [3]). All rates between -99% and 1,000,000% are looked for; with none or with several, no single number
is returned and the result says why. The count of sign changes of the time-ordered cash is reported: with one change
there is at most one rate.

**Payout.** The time from time zero at which the running total of net cash (capital included) first returns to zero
after being negative, with each month's operating cash taken as flowing evenly through the month, so it is a
fractional number of months. The game counts whole months (the first month at whose end the total is not negative):
the ceiling of this package's figure. Discounted payout does the same on discounted cash. No source was found for a
tool-specific definition; ComboCurve's help describes a break-even as the price giving zero cumulative cash flow,
which is a different measure [1].

**Returns on investment.** Three, named for what they are, because the names in use overlap:
`return_on_investment` = undiscounted net cash / capital; `discounted_return_on_investment` = NPV / present value of
capital (the game's "PV10/I"); `discounted_profitability_index` = present value of operating cash / present value of
capital, which is the former plus one.

**Break-even price.** The flat benchmark oil price at which NPV at the stated rate is zero, gas price and everything
else as given, the economic limit applied afresh at each trial price.

**BOE.** 6 Mscf = 1 BOE (`boe_mscf`), an energy convention, not a value one.

## Against the game's own NPV

game/opecon.py (career mode): royalty 20%, taxes on revenue after royalty, ad valorem not after severance, 8,000 a
well-month and 6 a BOE of operating cost, 0.40 per Mscf gathering, 1 per bbl water, 10% a year effective, mid-month,
capital with its month, no economic limit. Set to those conventions this package reproduces it to round-off on a
48-month made-up forecast with capital in months 1 and 13 (test `econ_against_game`): NPV 964,061, rate of return
51.04%, payout in month 16. On this package's defaults the same forecast gives NPV 955,394 (0.9% lower), 47.64%
and 15.8 months: capital at the start of its month costs more present value than ad valorem after severance saves.
game/economics.py (level scores) differs again: capital at time zero, cash at month ends, a flat monthly cost, no
royalty or taxes.

## Not modelled

Income tax, depreciation, depletion and amortisation; escalation of prices and costs (give a price deck by month
instead; costs are flat); hedges; carried, reversionary or back-in interests and payout-triggered changes of
interest; processing, shrink and natural gas liquids; inflation and real-against-nominal money; salvage; overhead.
Uncertainty runs: `run_ensemble` keeps only each draw's total gas, so `ensemble_economics` spreads gas over the months
in proportion to oil.

## Sources

1. ComboCurve help, "General Options" (discount method and cash accrual time; yearly N = 1 with mid-month is the
   default and the match to ARIES): https://support.combocurve.com/portal/en/kb/articles/combocurve-general-options
2. ComboCurve help, "ARIES Discounted Cashflow: Comparison": https://support.combocurve.com/portal/en/kb/articles/discounting-combocurve-vs-aries
3. SPEE Recommended Evaluation Practice 10 (rate of return), third-party copy, seen through a search summary only:
   https://www.scribd.com/document/412354497/REP10-IRR . REP 5 (discounting) itself was not found.

Both ComboCurve pages were read through search summaries, not opened. Everything about ARIES here is either what
ComboCurve says of it or my recollection, and is marked as such.
