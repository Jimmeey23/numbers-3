# Floor — audit

> **Status: historical.** This document describes a snapshot taken before the October 2026 review.
> Several of its findings have since changed in code, and its conclusion that "the arithmetic is
> correct" no longer reflects what was later found. Read
> [docs/metric-audit-2026-10-04.md](docs/metric-audit-2026-10-04.md) for the current assessment and
> [docs/metric-fixes-2026-10-04.md](docs/metric-fixes-2026-10-04.md) for what was fixed. Keep this
> file as evidence of the earlier state, not as certification of the current one.

Everything below was produced by running code against the live sheets, not by reading it. The four
harnesses are committed and repeatable:

```
npx tsx scripts/audit.mts            # static: registry, rates, provenance, dead metrics
npx tsx scripts/audit-runtime.mts    # runtime: coverage, reconciliation, joins, nulls, periods
npx tsx scripts/audit-deep.mts       # deep-dives into each discrepancy the runtime pass found
npx tsx scripts/audit-crosstab.mts   # the cardinal rule: same concept, different tabs
```

Dataset at time of audit: **453,538 rows** · today = 2026-10-10 · default scope Sep 2026 vs Aug 2026.

**Headline:** the data layer is sound and the arithmetic is correct — every metric I hand-checked against
the raw CSV matched exactly. The problems are not arithmetic. They are **semantic**: the app computes nine
different quantities, labels four of them "revenue" and four of them "active members", and lets the
operator believe they are the same number. Two headline KPIs are built on columns that are 88% empty.
And the risk score that drives the entire Retention triage has almost no discriminating power.

---

## Severity 1 — will mislead an operator into a wrong decision

### 1.1 Nine concepts show different numbers depending on which tab you open

This is the brief's own cardinal rule ("two numbers for the same metric on two tabs destroys the
product") and it is broken nine times. Measured, same period, same filters:

| Concept | What each tab shows | Spread |
|---|---|---|
| **Revenue** | Overview/Sales ₹59.54L · Classes ₹40.84L · Bookings ₹53.69L · Attendance ₹40.84L · Payroll ₹40.84L | **31%** |
| **Active members** | Overview 534 · Retention 1,647 · Acquisition 391 · Attendance 1,157 | **76%** |
| **Retention rate** | Acquisition 10.6% · Retention 30.4% | **65%** |
| **New clients** | Acquisition 388 · Attendance 395 · Payroll 0 | **100%** |
| **Conversion rate** | Acquisition 8.2% · Leads 5.7% | **31%** |
| **Attendance** | Classes/Attendance/Payroll 4,611 · Bookings 4,327 | 6% |
| **Sessions held** | Classes 836 · Payroll 860 | 3% |
| **Late-cancel rate** | Classes 12.6% · Bookings 12.0% | 5% |
| **No-show rate** | Classes 1.1% · Bookings 1.1% | <1% |

Several of these differences are *legitimate* — Sales books revenue at purchase, Sessions attributes it at
attendance, so ₹59.54L and ₹40.84L are both right and measure different things. **That is exactly the
problem.** Nothing on screen says so. The card says "Revenue" on both tabs.

The three "active" populations are the worst case: *holds a live membership* (534), *has bought any
membership ever, in scope* (1,647), *lifecycle flag says Active* (391), and *visited this month* (1,157).
All four are reasonable definitions. All four are displayed with near-identical labels.

**Not a formula bug — a naming and disclosure failure.** Fix is in §1 of the roadmap.

### 1.2 Utilisation — a headline KPI — is computed from 11.7% of the base

```
limited (numeric session cap) :  3,375
unlimited                     :  3,609
neither (blank limit)         : 21,897   ← 17,634 of these have completed sessions
→ utilisation sees 11.7% of memberships
headline reads 52.7%
```

`Sessions Used %` is populated on exactly the same 3,375 rows, so there is no fallback. The Retention tab
presents "Avg utilisation 52.7%" as a top-line KPI with no indication it describes one membership in nine.
Unlimited memberships have no meaningful denominator — fine — but the 21,897 blank-limit rows are a data
gap being silently treated as "not applicable".

### 1.3 The risk score barely discriminates — 68% of members sit in one band

```
score distribution: 0s:27 10s:306 20s:636 30s:1666 40s:1255 50s:19686 60s:4348 70s:824 80s:126 90s:7
input coverage:     utilisation 11.7% · recency 81.7% · cancellations 100% · attendance 100%
```

Because utilisation is missing for 88% of rows, the model substitutes its neutral default (0.5) for a
weight of 0.30, and recency defaults for another 0.35 where absent. The result: **19,686 of 28,881
memberships (68%) score in the 50s** and the whole Retention triage — the four-band risk ladder, the save
list, the `high_risk_value` insight — rests on a score whose variance mostly reflects which fields happen
to be populated rather than who is actually at risk.

The 60+ cut-off then lands right on the edge of that pile-up, so small data changes move hundreds of
members across the "critical" threshold.

### 1.4 Year-to-date compares against a meaningless window

Calendar-aware comparison was implemented for `month` and `mtd` but not for the others:

| Preset | Current | Compares against | Should be |
|---|---|---|---|
| `month` | Sep 1–30 | Aug 1–31 ✓ | — |
| `mtd` | Oct 1–10 | Sep 1–10 ✓ | — |
| **`ytd`** | **Jan 1 – Oct 10 2026** | **Mar 24 – Dec 31 2025** ✗ | Jan 1 – Oct 10 2025 |
| **`quarter`** | **Oct 1–10** | **Sep 21–30** ✗ | Jul 1–10 |

YTD rolls back 283 calendar days, landing on a window that straddles spring and Christmas. For a seasonal
business every YTD delta on every tab is currently comparing against the wrong part of the year.

### 1.5 Settings thresholds do not reach the KPI cards

`dormant_actives` and `at_risk_actives` hardcode `> 21` days. The `dormant` insight rule correctly reads
`thresholds.dormantDays`. Change the threshold to 30 in Settings and the insight updates while the KPI
card next to it does not — two numbers, same concept, same screen. Same pattern for the risk cut-off
`>= 60`, hardcoded in four places.

---

## Severity 2 — degrades trust or hides real signal

### 2.1 Insight impacts are additive-looking but overlap

Total claimed impact ₹1.48Cr against ₹59.5L of period revenue — **2.5×**. The rail presents a sorted list
of rupee figures that an operator will naturally read as a total. They double-count:

- `dormant` (₹24.0L, 60 members) and `high_risk_value` (₹6.6L, 57 memberships) describe largely the same
  people — days-since-visit is an *input* to the risk score.
- `expiry_cliff` (₹19.2L) and `never_activated` (₹34.0L) both count amount-paid on live memberships.

Impacts are also inconsistently defined: some are revenue at risk, some are estimated upside, some are
sunk cost. They should not share a scale without a stated basis.

### 2.2 `avg_ltv` reports a mean on a distribution that is 78% zeros and heavily skewed

```
LTV > 0 : 4,693 clients   LTV = 0 : 16,350 clients
mean over everyone ₹7,542   ·   mean over buyers ₹33,819   ·   median over buyers ₹9,188
p90 ₹93,279 · p99 ₹3,60,014 · max ₹10,50,907
```

The mean over buyers is **3.7× the median**. Every LTV figure in the app, every LTV:CAC ratio, and the
`source_quality` rule all use the mean. A single ₹10.5L member moves a source's apparent quality.

### 2.3 Trainer→Payroll join loses 12.5% of trainers to whitespace

Four of 32 trainers in Sessions have no Payroll match: `Kajol  Kanchan`, `Richard  D'Costa`,
`Veena Narasimhan`, `Siya Mukund`. After a trim + case-fold, **all four match**. These are double-space
artefacts. Checkins trainer names are normalised with `.replace(/\s+/g,' ')`; Payroll and New are not.
Contribution margin and cost-per-acquired-member silently omit those trainers.

### 2.4 "Online" is a first-class location

22,504 bookings (10.7%) carry location `Online`, of which 22,498 are attended and total revenue is ₹855.
These are backfill/virtual rows. They appear in the location multi-select, the location scorecard and the
Overview small-multiples next to physical studios, where a location with 22k attendances and ₹855 of
revenue distorts every per-location comparison. Imports are excluded by default, but the *option* remains
in the filter list and the label implies a studio.

### 2.5 Churn and renewal are mutually exclusive only by luck

`churned = has churn date OR status Lapsed`. In the current data these coincide exactly (8,702 = 8,702 =
8,702 overlap), so `churn_rate` and `renewal_rate` behave. But nothing enforces it: a single row with
status `Renewed` and a populated `Churned Date` would be counted in both, and the two rates could sum
above 100% with no warning. The audit checks for this and currently reports zero — it should stay a check,
not an assumption.

### 2.6 Sessions and Bookings disagree on attendance by 6.2% over identical sessions

4,611 vs 4,327 attended across the *same 336 sessions* (UniqueID-matched). This is a genuine upstream
source disagreement, correctly surfaced on Data health — but it means the Bookings tab's effective-
attendance and no-show rates are computed on a base 6% smaller than every other tab's.

---

## Severity 3 — correctness and craft

| # | Finding | Evidence |
|---|---|---|
| 3.1 | Three rates average per-row rates instead of weighting: `l_attendance_rate`, `l_cancel_rate`, `new_late_cancel_rate`. Defensible (the source column is already a per-member rate) but it contradicts the stated "rates never average" rule and is not documented. | `audit.mts` |
| 3.2 | Two metrics share the label "Revenue per buyer" on the same table (`arpu`, `rev_per_buyer`) — indistinguishable in the column picker. They are also the same formula. | `audit.mts` |
| 3.3 | 22 registry metrics are never surfaced anywhere: `winback_rate`, `at_risk_value`, `single_location_share`, `avg_gap_between_memberships`, `dormant_actives`, `zero_usage_memberships`, `overbooked_sessions`, `paid_attendance`… Dead weight in the ⌘K palette. | `audit.mts` |
| 3.4 | `teaching_hours` and `trainer_dependency_index` cite source columns from tables they do not read — the ⓘ tooltip misattributes provenance. | `audit.mts` |
| 3.5 | Seven payroll rates carry `minSample: 1` — a margin computed off one row renders as a confident number. | `audit.mts` |
| 3.6 | Three heatmaps have no `ChartModule` wrapper, so no "view as table", no CSV, no PNG: the Leads response-time heatmap, `DayTimeHeatmap`, `CohortTriangle`. The brief makes "view as table" the accessibility alternative, so these are the three charts a screen-reader user cannot read. | grep |
| 3.7 | 13 inline metric computations remain in tab files (`reduce((a,r) => a + …)`) — Overview 5, Retention 6, Classes 1, Acquisition 1. Anti-pattern #3. | grep |
| 3.8 | 18 clickable `<div>`s without `role`/`tabIndex`; 31 raw `toLocaleString` calls bypassing the formatter (inconsistent grouping on counts). | grep |
| 3.9 | `Sales.member → New` 2.1%, `Lapsed → New` 1.7%, `Bookings → New` 1.5% orphan rates. Low, reported on Data health, no action needed — recorded for trend. | `audit-runtime.mts` |
| 3.10 | `lapsed.amount_paid` is 44.7% zero and `newc.ltv` 77.7% zero. Both are real zeros, not nulls, and are handled correctly — but any *average* over them is dominated by the zeros. | `audit-deep.mts` |

## What is genuinely sound

Worth stating plainly, because it constrains what the roadmap needs to touch:

- **Arithmetic is correct.** Independent Python recomputation over raw CSV matched the app exactly on
  memberships (2,757), distinct members (1,643), active (534), churn (17.37%), repeat rate (30.80%),
  member LTV (₹18,470), never-activated (233 / ₹32.3L).
- **Weighted rates work.** Total fill rate 43.28% weighted vs 45.97% as a naive average of locations — a
  2.70pp error the engine correctly avoids at every level.
- **No duplicate metric ids, no missing metric references, no undefined group keys, no orphaned rule ids.**
- **Null ≠ zero holds** throughout ingest.
- **Capacity is real, not estimated**, for 24,216 of 24,220 sessions; zero sessions report attendance above
  capacity.
- **Performance:** ingest 6.0s for 453k rows, scope recompute 175–255ms at any scope including all-time,
  every tab renders, 0 type errors.

---

## Fixed in this pass

Sprint 1 of the roadmap, implemented and verified while writing this audit:

| # | Fix | Verified |
|---|---|---|
| 1.4 | **Calendar-aware comparison for every preset.** QTD now compares with the same days of the previous quarter (Jul 1–10, was Sep 21–30); YTD with the same dates last year (Jan 1 – Oct 10 2025, was Mar 24 – Dec 31 2025). Each window carries an explicit label — "same days of Q3", "2025 to the same date". | `/tmp/per.mts` — all presets now match their natural comparison |
| 1.5 | **Thresholds reach the metrics.** `dormantDays`, `riskHigh`, `zeroUsageDays`, `matureDays` and `medianFirstMembership` are on `QueryContext`. Hardcoded `21`, `60`, `12599` removed from metrics, rules and tabs. The Retention risk ladder now derives its bands from the operator's threshold, so cards, bands and insights move together. | typecheck + render |
| 2.3 | **Trainer-name normalisation.** One `personName()` normaliser, memoised and interned, applied at all 16 person-name sites. | Sessions→Payroll unmatched trainers **4 → 0** |
| 1.2 | **Coverage disclosure.** Every `MetricResult` now carries `contributing` and `coverage`. Metrics opt in with `coverageMatters` so filtered sums do not false-positive, and supply a plain-language `coverageReason`. Utilisation now reads *"Measured on 309 of 2,767 rows in scope (11.2%). Memberships with no session cap … have no denominator and are excluded."* with a ⚠ on the card. 14 metrics opted in. | `/tmp/cov.mts` |
| 2.1 | **Non-overlapping impact accounting.** Insights declare a `basis` (at-risk / sunk / upside) and the member ids they `claim`. `summariseImpact()` nets overlap within a basis. The rail shows the netted figure and the card shows its basis. | ₹1.48Cr naive → **₹48.82L at risk (238 members, 41 duplicate claims removed) + ₹35.32L unused (211 members)** |
| 2.2 | **`median_ltv` and `avg_ltv_buyers`** added and put on the Acquisition strip in place of the raw mean; `avg_ltv` remains available as a hidden column. | registry |
| 3.2/3.4/3.5 | `rev_per_buyer` relabelled to disambiguate from `arpu`; provenance strings on `teaching_hours` and `trainer_dependency_index` corrected; seven payroll rates raised from `minSample: 1` to 3. | static audit: **0 high, 6 medium → 0 high, 3 medium** |
| 3.6 | **`ChartModule` on the three bare heatmaps** — `DayTimeHeatmap`, `CohortTriangle`, Leads response-time. All now have view-as-table, CSV and PNG. | grep |

Static audit after the pass: **0 high · 3 medium · 7 low**, down from 0 high · 6 medium · 8 low. The three
remaining medium findings are the averaged per-row rates (§3.1), which are defensible but still need the
documentation note. All twelve tabs render in five filter scenarios; scope recompute 119–230 ms.

Still open, by design, for the sprints below: the nine cross-tab naming conflicts (§1.1), the risk-model
rebuild (§1.3), "Online" as a location (§2.4), and the Bookings/Checkins 6.2% source disagreement (§2.6).

---

# Roadmap — the next version

Ordered by what changes a decision, not by what is easiest.

## Phase 1 — Make every number mean one thing (fixes §1.1, 1.4, 1.5)

**1.1 A measurement-basis system.** Extend `MetricDef` with a `basis` field — `booked` | `attributed` |
`recognised` for money; `membership` | `member` | `visitor` for people. Render the basis as a small caption
under any metric whose concept appears on more than one tab, and make the ⓘ panel state *"Revenue here is
attributed at attendance. The Sales tab books it at purchase — those figures will differ and both are
correct."* Add a **Reconciliation card** that shows the same concept across all bases side by side with the
bridge between them.

**1.2 Rename the four "active" metrics** to what they actually count: *Live memberships* (534),
*Members with a membership in scope* (1,647), *Clients flagged Active* (391), *Members who visited this
month* (1,157). Pick one as the canonical Overview figure and link the others to it.

**1.3 Calendar-aware comparison for every preset.** QTD → same days of the previous quarter; YTD → same
dates last year; add an explicit *Same period last year* option on all presets, and print the resolved
comparison window under the delta on hover.

**1.4 Every threshold reads from Settings.** Delete hardcoded `21`, `60`, `12599`, `55`. Route through
`QueryContext`, so a card and the insight beside it can never disagree.

## Phase 2 — Make the risk model actually discriminate (fixes §1.2, 1.3, 2.2)

**2.1 Coverage-aware metrics.** Every metric reports the share of rows that could contribute. Below a
configurable floor (say 40%) the card renders the value dimmed with *"measured on 11.7% of memberships"*
rather than presenting it as a base-wide fact. This one change makes §1.2 self-disclosing everywhere.

**2.2 Rebuild the risk score on available signal.** Re-weight per member across *present* inputs rather
than substituting neutral defaults, and add a **confidence** dimension (how much of the model could be
evaluated). Show risk as a 2-D grid — severity × confidence — so "high risk, low confidence" is visibly
different from "high risk, well measured". Replace fixed 60/80 cut-offs with distribution-relative bands
(quintiles of the actual population) so the ladder stays meaningful as data changes.

**2.3 Derive utilisation from behaviour, not entitlement.** For the 21,897 memberships with no session
cap, compute expected visit cadence from the member's own first-30-day rate and score against that. Use
the Checkins table — which has 149k real visits — instead of relying on a column that is 88% empty.

**2.4 Report distributions, not just means.** LTV, conversion span, class size and lead response all get
median + p90 alongside the mean, and the KPI card shows a micro-histogram on hover. Default the *displayed*
LTV to median; keep mean available.

## Phase 3 — Insights that survive scrutiny (fixes §2.1)

**3.1 Non-overlapping impact accounting.** Each insight declares the entity set it claims. The engine
subtracts already-claimed entities before summing, and the rail shows *"₹41L across 312 distinct members,
after removing double-counting"*. Each impact also declares its basis (revenue at risk / estimated upside /
sunk cost) and only like bases are summed.

**3.2 Insight provenance and back-testing.** Every insight links to the exact filtered view *and* records
the metric value at the time it fired. Next period, show whether it moved — *"you were told about this
4 weeks ago; fill has since fallen another 6pp"*. An insight that never resolves is either wrong or being
ignored, and both are worth knowing.

**3.3 Anomaly detection instead of fixed thresholds.** Replace `fill < 20%` with a seasonal-baseline
comparison: rolling median by slot and week-of-year, flag deviations beyond 2σ with sample-size guards.
Catches "Saturday 9am is fine in absolute terms but is the worst it has been in 14 months".

## Phase 4 — Advanced analytics

**4.1 Forecasting.** 8-week attendance and revenue projection per location and per slot (Holt-Winters on
weekly series, which the data supports — 2.5 years of history). Prediction intervals shown, not point
estimates. Feeds a *projected* month-end revenue on Overview against target.

**4.2 Churn propensity, learned rather than assumed.** The current risk score is a hand-weighted formula.
With 28,881 membership outcomes there is enough to fit a simple logistic model on visit cadence decay,
utilisation trajectory, cancellation trend, discount depth, freeze history and format breadth. Ship it as
a *second* score beside the heuristic, with a calibration curve on Data health, and only promote it once
it beats the heuristic on held-out data.

**4.3 Slot-level yield optimisation.** Given capacity, observed demand curves by day-hour-format, and the
rate card, recommend the schedule that maximises contribution — "move Wed 07:30 Barre to 09:00, expect
+4.2 attendees, +₹6,800/month" — with the counterfactual stated and confidence attached.

**4.4 Cohort-based LTV curves.** Cumulative revenue per member by months-since-first-visit, split by
acquisition source, with an extrapolated 24-month LTV. Turns "Hosted Class produces low-LTV clients" into
"Hosted Class pays back in month 7 versus month 3 for referrals".

**4.5 Trainer causal attribution.** Draw premium is already slot-adjusted. Extend to a proper fixed-effects
decomposition — separate the trainer effect from slot, format, location and seasonality — so a trainer who
only ever teaches prime Saturday slots is not credited with the slot's own pull.

**4.6 Member journey timeline.** In the drill panel, one horizontal track per member: visits, purchases,
freezes, cancellations, membership spans, lead touches. Makes "why did this person churn" answerable in
one glance instead of five tabs.

## Phase 5 — Operator workflow

**5.1 Worklists become actual work.** Check off a call, log the outcome, snooze, assign. Persist locally,
export to CSV for a CRM. Then measure: *save-list contact rate*, *saved vs lapsed after contact*. The app
currently ends at "here is who to call" — the next version should close the loop.

**5.2 Scheduled digests.** A Monday-morning summary rendered to a shareable static HTML: what moved, what
fired, what to do. Derived from the existing insight engine and saved views.

**5.3 Goals and variance.** Per-location monthly targets for revenue, fill and new members, entered in
Settings. Every KPI card gains pace-to-target; Overview gains a variance waterfall.

**5.4 Annotations.** Mark a date range with a note ("Diwali", "Bandra AC failure", "influencer campaign").
Annotations render on every time series and are excluded from baselines, so a known one-off stops
polluting anomaly detection.

**5.5 What-if console.** Adjust rate card, price, capacity or a slot's schedule and see contribution
recompute across every affected tab before committing. The rate-card slider already proves the mechanism.

## Phase 6 — Platform

**6.1 Columnar store.** 624MB retained is the price of row objects. Dictionary-encoded columnar arrays
would cut it to roughly 120MB and make the group-by kernels several times faster — necessary before the
sheets double again.

**6.2 Worker-based ingest.** Parse and normalise off the main thread; the UI stays responsive during the
6-second load and can stream tables in as they land.

**6.3 Incremental refresh.** Fetch only rows newer than the cached high-water mark instead of re-reading
165MB every 15 minutes.

**6.4 Server-side option.** A thin service-account proxy solves the private-spreadsheet problem
permanently, enables scheduled digests, and allows a nightly materialisation of the heavy rollups.

**6.5 Close the §3 craft items** — `ChartModule` on the three bare heatmaps, `role`/`tabIndex` on the 18
clickable divs, route the 31 raw `toLocaleString` calls through the formatter, delete or surface the 22
unused metrics, dedupe `arpu`/`rev_per_buyer`, fix the two provenance strings, raise the seven
`minSample: 1` payroll rates, and normalise trainer names at ingest so the Payroll join stops losing 12.5%
of trainers.

---

## Suggested order

| Sprint | Contents | Why first |
|---|---|---|
| 1 | §1.4 trainer-name normalisation, §1.5 thresholds from Settings, calendar-aware periods, the §3 craft list | Small, safe, removes four sources of contradiction |
| 2 | Measurement-basis system + reconciliation card + renaming the four "active" metrics | Fixes the cardinal-rule breach; everything else is easier once numbers are unambiguous |
| 3 | Coverage-aware metrics + risk-model rebuild + distributions | Makes the Retention tab trustworthy rather than merely detailed |
| 4 | Insight overlap accounting + back-testing + anomaly baselines | Makes the rail defensible |
| 5 | Forecasting, LTV curves, journey timeline | The genuinely new analytical capability |
| 6 | Worklist actions, goals, annotations | Closes the loop from insight to action |
| 7 | Columnar store, worker ingest, incremental refresh | Only needed when data grows again |
