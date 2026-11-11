# ECLIPSE binary summary files (SMSPEC / UNSMRY): the layout written by `src/eclout.jl`

Written 2026-11-10. This note says what bytes `write_ecl_summary` produces, where each part of the layout comes
from, and how sure each part is.

## Evidence, plainly

- No summary file from another simulator was found on this machine (searched the engine's shipped data under
  `~/.julia`, the project folders and the Python environments: the benchmark cases ship CSV references only).
- No independent reader was available. The engine's IO package (GeoEnergyIO) has `read_summary` and
  `write_jutuldarcy_summary`, but both call the Python package `resdata`, which is not installed here (nor are
  `resfo` or the OPM Python tools), and installing packages was outside this task.
- So the layout rests on its published description, read through web search summaries of the sources below (the
  pages themselves could not be opened from this session), on what the author knows of the libecl and OPM writers,
  and on tests that compare the files with bytes assembled by hand from this description. A wrong belief about the
  layout that is shared by the writer and the hand-assembled bytes would not be caught.
- The vector VALUES are checked against independent code: the engine's own `JutulDarcy.summary_result`.
- To close the gap: read one file written here with `resfo` (pure Python: `pip install resfo` in a throwaway
  environment) or `resdata`, or open it in ResInsight. That needs a yes from the owner of this machine.

## Record layer (all ECLIPSE binary files)

Fortran unformatted sequential records, all numbers big-endian. A record is: 4-byte integer byte count, the bytes,
the same byte count again.

Every named array is a header record followed by data records:

| part | bytes |
|---|---|
| header record | 16 bytes: keyword (8 ASCII characters, blank padded), number of items (4-byte integer), type (4 characters) |
| data records | the items, at most 1000 per record for numbers and logicals, at most 105 per record for 8-character strings |

Types: `INTE` 4-byte integer, `REAL` 4-byte real, `DOUB` 8-byte real, `LOGI` 4-byte logical, `CHAR` 8-character
string, `MESS` no data, `C0nn` strings of nn characters (newer files, for long names).

| item | status |
|---|---|
| header layout, 16 bytes | confirmed (ecl-data-io / resfo format page, via search summary) |
| big-endian | confirmed (same page) |
| 1000 numbers / 105 strings per record | confirmed (same page) |
| type codes | INTE, REAL, DOUB, CHAR, LOGI, MESS from the author's knowledge of libecl; the page lists the codes but the summary seen named only some |
| LOGI true stored as -1 | NOT confirmed (author's recollection of libecl). Not used by summary files. The reader takes any non-zero value as true |

## SMSPEC (specification), as written here, in this order

| keyword | type, items | content written | status |
|---|---|---|---|
| INTEHEAD | INTE, 2 | unit system (1 metric, 2 field), program id (100) | size and the two meanings confirmed (libecl `ecl_kw_magic.hpp` as shown in the ResInsight API pages); the codes 1 / 2 and 100 are from the author's knowledge of the OPM writer, not confirmed. Optional for readers |
| RESTART | CHAR, 9 | blanks (not a restarted run) | keyword confirmed; libecl's own constant is 8 items, ECLIPSE and OPM write 9 (author's recollection). Readers take the array's own length |
| DIMENS | INTE, 6 | number of vectors, NX, NY, NZ, 0, -1 (no restart step) | item positions 0 to 3 and 5 confirmed (same header) |
| KEYWORDS | CHAR, n | TIME, YEARS, ..., WOPR, ... | confirmed (ecl3 summary page: parallel arrays KEYWORDS / WGNAMES / UNITS) |
| WGNAMES | CHAR, n | well name, or `:+:+:+:+` for a vector that belongs to no well | confirmed, including the dummy name (ecl3 page) |
| NUMS | INTE, n | -32676 for the time vectors, 0 for field and well vectors | keyword confirmed. The two values are convention from the author's recollection of OPM output; readers identify field and well vectors by keyword and name, not by this number |
| UNITS | CHAR, n | DAYS, YEARS, MONTHS, STB/DAY, MSCF/DAY, STB, MSCF, PSIA (metric: SM3/DAY, SM3, BARSA) | keyword confirmed; the strings are the usual ones, not checked against a file |
| STARTDAT | INTE, 6 | day, month, year, hour, minute, microseconds | first three positions confirmed (same header, which gives the size as 3); the six-item form is what newer writers use (author's recollection). The reader here takes 3 or 6 |

Not written: MEASRMNT, RUNTIMEI / RUNTIMED, LGRS and the other optional arrays.

## UNSMRY (unified results), as written here

For every time: `SEQHDR` (INTE, 1 item, value 0), `MINISTEP` (INTE, 1 item, counting from 0), `PARAMS` (REAL, one
number per vector, in the order of KEYWORDS).

Status: the sequence SEQHDR, then MINISTEP / PARAMS pairs, and PARAMS having as many items as DIMENS says, are
confirmed (ecl3 summary page; sizes from the same libecl header). A report step in other simulators' files usually
holds several MINISTEP / PARAMS pairs after one SEQHDR; here every time is its own report step, which the format
allows. The value inside SEQHDR is not read by any reader the author knows; 0 is written.

Numbers are 4-byte reals, as the format requires: about seven digits. A total of 5.15e7 STB is stored to the
nearest 4 STB.

## Vectors and units (set in one place: `summary_table` and `SUMMARY_UNITS`)

The engine gives a well's surface rates in m3/s, negative when the well produces, and absolute pressure in Pa.

| vector | meaning | field unit | conversion from SI |
|---|---|---|---|
| TIME, YEARS, DAY, MONTH, YEAR | time since start; calendar date of the row | DAYS, YEARS, DAYS, MONTHS, YEARS | s / 86400; days / 365.25; from the start date |
| WOPR, WWPR | oil, water production rate (positive) | STB/DAY | max(-q, 0) x 86400 / 0.158987294928 |
| WGPR | gas production rate | MSCF/DAY | max(-q, 0) x 86400 / 28.316846592 |
| WOPT, WWPT, WGPT | totals of the above | STB, MSCF | sum of rate x step length; the step that ends at a time is used, the first starts at zero |
| WOIR, WWIR, WGIR and WOIT, WWIT, WGIT | injection, only for a phase the well injects at some time | as production | max(q, 0), same factors |
| WBHP | bottom-hole pressure, absolute | PSIA | Pa / 6894.757293168 |
| FOPR ... FGIT | field: sums over the wells of the same letters | as wells | |

Metric: SM3/DAY, SM3, BARSA.

Found while checking against the engine: `JutulDarcy.summary_result(case, result, :field)` (JutulDarcy 0.3.11)
returns totals that are the rate in field units per day multiplied by the step length in seconds, so they are 86,400
times too large. Rates and pressures agree with the vectors here to 6e-8. The test divides the engine's totals by
86,400 and says so.

## Not written

Restart files (.UNRST), grid files (.EGRID, .INIT), the formatted (text) variants (.FSMSPEC, .FUNSMRY), non-unified
results (.S0001 ...), group, region, block, completion, segment and aquifer vectors, well names longer than eight
characters (refused with an error), LGRs.

## Sources

- ecl3 documentation, summary format: https://ecl3.readthedocs.io/en/latest/c/summary.html
- ecl-data-io (now resfo) documentation, "The File Format": https://ecl-data-io.readthedocs.io/en/latest/the_file_format.html
- libecl `ecl_kw_magic.hpp` constants as listed in the ResInsight API reference: https://opm-project.org/apidoc/latest/ResInsight/html/ecl__kw__magic_8hpp.php
- resfo, a pure-Python reader and writer of this format (not used here; the suggested independent check): https://github.com/equinor/resfo
- ResInsight user documentation, summary data: https://opm.github.io/ResInsight-UserDocumentation/import/eclipsesummarydata
- Engine source read on this machine: `GeoEnergyIO/ext/GeoEnergyIOPythonCallExt` (how the engine's author writes summaries through resdata), `JutulDarcy/src/io.jl` (`summary_result`).
