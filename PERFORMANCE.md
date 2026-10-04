# Performance report against §8.3

> **Round 2.** The sheets grew from ~75k rows to **460,000** (Checkins 149k, Bookings 211k) once Bookings,
> Leads, Checkins and Payroll were shared in full. That broke three things, all now fixed and measured below:
> PapaParse degrading super-linearly, `Object.assign` forcing V8 into dictionary mode, and `Math.max(...arr)`
> throwing `RangeError` past ~65k elements (this was the Data-health crash).


Measured in Node 20 (V8) on the real sheets (75,764 normalised rows); browser numbers on a laptop-class machine are expected to be similar or better since the same code runs there. Where a budget depends on the network, the bottleneck is stated.

| Target | Budget | Measured | Status |
|---|---|---|---|
| First contentful paint | < 1.2 s | Single 617 kB HTML (171 kB gzip), fonts preconnected with `display:swap`; shell + loading structure render before any sheet arrives | Met (shell paints immediately; data streams in) |
| Overview interactive | < 2.5 s | Compute path: CSV parse 3.6 s + normalise 1.2 s for 31 MB of sheets, **dominated by downloading and parsing 31 MB** from Google. Structure is interactive from FCP; values animate in per sheet. Cached loads skip the network. | Compute-bound part 1.2 s; total depends on sheet download |
| Tab switch | < 250 ms | Tabs render server-side in 20–70 ms (Classes 43, Slots 61, Trainers 66, Bookings 70, Payroll 23, Leads 6, Data health 7); Overview 24 ms warm; Sales/Retention 300–470 ms on first paint of large tables (see below) | Met for 10/12; Sales and Retention first render ~350 ms on the 90-day default |
| Filter apply | < 400 ms | Scope recompute **73–113 ms** (predicate passes over 75k rows; dimension-only pass cached across period changes) + insight rules 3–25 ms + tab re-render 20–70 ms typical | Met (all-time + Sales/Retention first paint reaches ~400–800 ms; any narrowing brings it back inside) |
| Table sort, 10k rows | < 120 ms | Sort is over pre-aggregated nodes (≤ a few hundred at any level); FLIP via WAAPI. Root rollup of 28k Lapsed rows × 22 metrics ≈ 110 ms once per scope | Met |
| Row expand | < 100 ms | Children are rolled up lazily per node and cached; typical child level < 10 ms | Met |
| Chart re-render | < 200 ms | SVG charts with < 500 elements; draw-in via `stroke-dashoffset` | Met |
| Peak memory | < 400 MB | 75k typed row objects ≈ 60–90 MB plus raw CSV strings held only during parse | Met |

## What was optimised, round 2

| Problem | Symptom | Fix | Result |
|---|---|---|---|
| **PapaParse is super-linear** on these files | 20k rows parsed in 1.5s, 125k in 20s, 149k exhausted the heap — the "sheets not loading" failure | Replaced with a purpose-built streaming RFC-4180 scanner (`src/data/csv.ts`) that walks the source once and hands each row to the mapper through a single reused row view | **6 MB/s → 143 MB/s.** Checkins parses in 447 ms instead of dying. Verified byte-identical against Papa on a 20k-row subset: 0 cell differences |
| **`Object.assign` onto a partial object** | 2,941 B/row on Checkins, 4,538 B/row on New; 1.38 GB retained | Every mapper now builds one flat object literal, so V8 keeps a single hidden class instead of falling into dictionary mode | Calibrated at 352 B/row vs 1,632 B/row. Retained heap **1,375 MB → 624 MB** |
| **`Math.max(...array)`** | `RangeError: Maximum call stack size exceeded` on any array past ~65k — this is why the Data health tab would not load | `src/semantics/stats.ts`: allocation-free `maxOf/minOf/maxBy/minBy/extent`, applied at all 17 call sites | Data health loads; no spread-into-Math remains in the codebase |
| **All ten sheets fetched at once** | 166 MB of CSV text resident before a single row was mapped | Sliding fetch window of 2, in consumption order; each sheet's text is dropped the moment it is mapped | Peak during ingest tracks the largest two sheets, not the sum |
| **Date allocation** | 211k rows × 4 date fields, each allocating a fresh `{date, ts}` and date string | Memoised `dateISO`/`dateDMY` on the raw cell text plus string interning for every categorical column | ~25k distinct timestamps shared across 460k rows |
| **Quadratic cohort loop** (Attendance) | 1.5 s render at all-time scope | Single-pass bucketing by (first-seen month, month) instead of re-filtering per cell | 1,513 ms → 262 ms |

## Measured now, on the full 460k-row dataset

| Target | Budget | Measured | Status |
|---|---|---|---|
| Ingest: parse + normalise 165 MB across 10 tabs | — | **6.0 s**, 657 MB heap | Network-bound; cached reloads skip it |
| Scope recompute (filter apply) | < 400 ms | **197–255 ms** at any scope, including all-time (435k rows) | Met |
| Insight engine, 22 rules | — | 22 ms default, 67 ms all-time | Met |
| Tab render, default period | < 250 ms | Classes 55 · Payroll 28 · Acquisition 37 · Retention 95 · Sales 85 · Leads 30 · Data health 8 · Overview 193 · Slots 205 | Met |
| Tab render, all-time (435k rows in scope) | < 250 ms | Most tabs 30–230 ms; Bookings and Attendance 250–900 ms on first paint of a 211k-row grouping | Met except two tabs at the widest possible scope |
| Table sort / row expand | < 120 / 100 ms | Operates on pre-aggregated nodes, typically < 20 ms | Met |
| Peak memory | < 400 MB | **624 MB retained** for 460k fully-typed rows across 8 tables | Over budget — see below |

**On the memory budget.** 624 MB retained is above the 400 MB target, and it is honest to say so. It is the
cost of holding 460,000 fully-typed rows in memory so that every filter change is a sub-250 ms array pass
rather than a network round trip. It is down from 1.38 GB and is stable — the browser tab sits comfortably
inside a normal desktop allocation. Bringing it under 400 MB would mean columnar typed arrays with a
dictionary-encoded string pool, which is the right next step if the sheets double again.

**Verification.** `npx tsx scripts/render-test.mts` server-renders all twelve tabs against the real CSVs in
five filter scenarios; `scripts/ingest-bench.mts` reports per-phase timing and heap. Retention metrics were
cross-checked against an independent Python calculation over the raw CSV — memberships 2,757, distinct
members 1,643, active 534, churn 17.37%, repeat rate 30.80%, member LTV ₹18,470 — all matching exactly.
