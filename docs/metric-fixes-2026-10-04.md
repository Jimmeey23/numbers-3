# Fix log — metric and data audit remediation

Date: 2026-10-04. Every defect recorded in [metric-audit-2026-10-04.md](metric-audit-2026-10-04.md)
and in the follow-up registry audit was fixed in application code. Three harnesses gate the work and
all three pass from a clean checkout:

```
npx tsx scripts/audit.mts                      # static registry: 0 high · 0 medium · 0 low
npx tsx scripts/audit-metric-correctness.mts   # 14 behavioural fixtures, exit 0
npx tsx scripts/audit-new.mts                  # 13 registry invariants, 0 failing
npx tsc --noEmit && npx vite build             # clean
npx tsx scripts/render-test.mts                # 12 tabs × 5 scopes
```

## Data layer

| Was | Now |
|---|---|
| "Today" was the latest timestamp in the sheets, so next week's scheduled classes counted as held sessions with zero attendance | `today` is the IST wall clock. `dataThrough` reports source freshness separately, and a defect row states how many occurrences are scheduled ahead |
| `Memberships Bought Post Trial` holds product names and was parsed with `num()`, erasing every populated row | Parsed as a product list; the count keeps only recurring-membership products, and the list is retained on the row |
| Visits with no member id were collapsed into one row | Unidentified rows are kept distinct — identity is not inferred from a shared date and time |
| Session rows were keyed on `slot_uid`, folding every week of a recurring slot into one occurrence | Keyed on the occurrence (`session_key`) |
| Cancellations were joined from Bookings `slot_uid` to Checkins `session_id` — different key spaces | Joined on the occurrence key both sources carry |
| Capacity was raised to meet attendance, capping every fill rate at 100% | Capacity is what the sheet recorded; overbooking is visible again |
| Tenure and renewal gaps read the purchase date as the membership start | `start_ts` is parsed separately and both metrics use it |
| Reachable sheets nothing ingests sat at "pending" forever | New `unused` load status: read successfully, deliberately not ingested, stated as such on Data health |
| The risk score silently substituted neutral defaults for missing inputs | Each membership records how many of the four inputs were observed; `risk_score` discloses coverage and `risk_confidence` reports it. `uncapped_memberships` separates a missing cap from an unlimited plan |

## Metric registry

- Weighted denominators used `field || null`, which dropped the whole row — including its cost
  numerator — whenever revenue or conversions were zero. Zero is now a real zero; only the aggregate
  denominator is guarded. Affected `p_margin`, `payroll_pct_of_revenue`, `p_cost_per_acquired`,
  `p_empty_rate`, `p_rev_per_session`, `p_rev_per_customer`, `p_conversion_rate`,
  `p_retention_rate`, `l_rev_per_session`, `l_discount_rate`.
- Count and distinct aggregations declared every row as contributing, so a count could never show
  low coverage. Both now honour a `contributes` predicate, and `v_cancelled` reports 0% coverage
  where Bookings does not reach.
- Voided line items leaked into `units`, `unique_buyers` and `avg_unit_price`; all three now exclude
  them, as every other sales metric does.
- `deferred_revenue` and `unused_session_liability` summed sale-level columns once per line item.
  Both now count each sale once.
- `transactions` and `aov` counted different populations when a row carried no Sale ID; they now
  share one key.
- Unknown payment was read as free (`v_complimentary_rate`, `complimentary_rate`, `c_complimentary`)
  and unknown sale value as zero (`zero_value_share`). Missing is now missing.
- `below_break_even` counted a session with no recorded revenue as a loss.
- `reliability` and `empty_session_rate` were not complements when `CheckedIn` was blank.
- `v_late_cancel_rate` divided by all bookings while show-up and no-show rates excluded
  cancelled-ahead. The three now share one base and sum to 100%.
- `survival_90` counted clients who had not yet had 90 days as failures.
- `class_hours` always applied the default duration; it now uses each occurrence's observed value
  and estimates only what is missing.
- 23 labels were duplicated across tables — four metrics called "No-shows", four "Late-cancel rate".
  Every label is now unique and names its grain. `rev_per_buyer`, an exact duplicate of `arpu`, was
  removed.
- Twelve descriptions restated a threshold the operator can change ("21 days", "60 or above",
  "₹12,599"). They now name the setting. The three mean-of-rates metrics declare `perRowRate` and
  say so in their own description.
- `prime_time_share` and five payroll rates were raised from `minSample: 3` to 5.

## Tabs, report and signals

- **Overview** — the revenue bridge summed line items while the KPI above it counted each sale once:
  two revenue figures on one screen. Both now read the registry. The bridge is reduced to volume and
  price, which are exhaustive by construction; mix, first-time sales and churn exposure overlap with
  them and are reported beside it as context, so there is no residual "Other" plug. Product movers
  use allocated revenue.
- **Acquisition** — funnel stages are strict subsets, so continuation can no longer exceed 100%;
  source composition classifies each person once into mutually exclusive outcomes; a retention
  fraction is no longer multiplied by rupees and drawn on a currency axis; the comparison period
  gets the same maturity rule as the current one; the cohort triangle says it measures visit-span
  reach, not month-by-month activity.
- **Attendance** — reach-next follows the same members forward with a 30-day follow-up window
  instead of dividing one period's visit-number volumes by each other.
- **Retention** — the month-on-month table states that it shows today's status by purchase cohort;
  "Formats used" is renamed to what it counts; worklist totals come from the registry.
- **Heatmaps** — clicking an hour filters to that hour, not to its daypart.
- **Risk bands** — derived from the operator's high-risk cut-off instead of fixed 40/60/80.
- **Custom widgets** — strongest and weakest are selected from all eligible groups, respecting the
  metric's direction of improvement, rather than from the top and bottom of the truncated list.
- **Report** — the outlook excludes any month the reporting window does not fully cover and refuses
  to project from fewer than four complete months; the funnel chapter states which population it
  uses and where it differs from its own KPI cards; "median" is said only where a median is used.
- **Insights** — the cache is keyed on scope identity, so a refresh that keeps the row count still
  recomputes. Claims carry per-member amounts and netting applies a declared per-member-maximum
  policy rather than a count-weighted approximation. The slow-lead card counts answers inside the
  target instead of asserting there were none.
- **Payroll** — a month where sessions were taught but every New/Converted/Retained value is zero is
  treated as a missing partition: the seven affected metrics are marked suspect rather than scoring
  instructors at zero.
- **Settings** — the assumed class length joins the other assumptions, and the reset button restores
  every default rather than the subset it was written with.

## Open, by decision rather than by defect

The business-policy questions at the end of the audit still need an owner: which revenue basis is
canonical, whether Bookings `Sale Date` is reservation or payment time, product-category precedence,
and the intended grain of the New sheet. The metrics now carry distinct names and stated bases
(`Class revenue`, `Booking revenue`, `Membership revenue`), so the figures no longer collide — but
choosing which one leads is not a code change.

---

# Second pass — caching, cross-tab consistency, layout

## Sheets are cached until you ask for fresh data

Raw sheet text expired after fifteen minutes, so an ordinary page reload re-downloaded 165 MB. The
cache no longer expires. A page load — including a soft reload, a restored tab, back/forward —
reuses it and makes no network request. Fresh data comes from two places only: the Refresh button,
and a hard refresh.

Hard refresh is detected from the navigation entry's `transferSize`: a soft reload serves the
document from the browser's HTTP cache and reports zero, a hard refresh re-downloads and reports
more. That is the only signal the platform exposes, and the failure mode is safe — a misread
refetches sheets that were already cached. The status bar now says when the sheets were read and
how many came from the cache.

`src/state/data.ts` also refuses to reload while a dataset is in memory unless `force` is passed,
so nothing can refetch behind the operator's back.

## One concept, one metric

`src/semantics/concepts.ts` is the register of every question the app can answer more than one way:
the metric that is allowed to answer it, each remaining variant, and why the variant differs.
`scripts/audit-bindings.mts` enforces it statically — a tab that binds a variant instead of the
canonical metric fails. Data health renders the same register as a reconciliation panel, so where a
variant still exists the gap is visible with its cause rather than discovered as two numbers on two
screens.

Bindings corrected: **22 high findings → 0.**

- **Bookings** was reading canonical visit rows while computing Bookings-sheet metrics over them.
  `rev_per_booking` reads a column a visit row does not carry, so that KPI was silently null. The
  whole tab now uses the visit-grain metrics its own drill table already used.
- **Attendance** was bound to the raw Checkins sheet, so every attendance figure on it was a second
  answer to a question the rest of the app answers from `visits`. Rebound to the canonical grain.
- **Overview**'s headline attendance now reads `visits`, the same figure every other tab shows.
- Six visit-grain metrics were added so the canonical grain could answer everything the Checkins
  grain used to: `v_unique_bookers`, `v_mau`, `v_complimentary`, `v_class_hours`,
  `v_rev_per_attendee_hour`, `v_days_between_visits`.

Schedule-side questions — sessions held, seats offered, empty sessions, capacity, fill — stay on
the Sessions grain, because the visit feed cannot see an occurrence nobody attended. Those tabs are
declared source tabs in the concept map and the reconciliation panel shows what each one measures.

## Layout

The canvas was capped at 1920px inside a flex parent that filled the window, so on a wide monitor
the content stopped mid-screen. The cap is gone. A single `--gutter` token —
`clamp(20px, 2.6vw, 56px)` — insets the title bar, filter strip, tab rail, canvas and status bar
identically, so every edge lines up and the inset grows with the viewport.

Measured at 2560px: all five surfaces inset 56px, canvas 2516px wide, a two-up splits 1186/1186, a
three-column table spans 2402px, no horizontal page scroll. Previously the canvas stopped at 1920px.

Also: tables span their panel instead of huddling left (`width:100%` with `min-width:100%` so wide
sets still scroll), column padding scales up past 1700px, plain tables get subtle zebra striping
scoped so it cannot fight the nested table's own level backgrounds, scrollbars are styled to the
surface, and the filter strip no longer reads "vs undefined" before the first dataset arrives.

---

# Third pass — Attendance crash, fixtures, metric cards

## The render test was passing on nothing

`scripts/render-test.mts` read whatever CSVs happened to be in `/tmp`, and with none there it
rendered every tab against **zero rows** — the one state in which no aggregation, join or chart
scale can fail. Every tab reported "ok" while a real dataset crashed one of them. Its file map
also omitted Sessions, so the live session path was never the path under test.

`scripts/make-fixtures.mts` now generates a deterministic synthetic dataset — 592 sessions, 4,354
check-ins, 3,430 bookings, 890 sale lines, 220 clients, 420 memberships, 36 payroll rows, 300
leads. The values are invented; the shapes are not. Columns, date formats, flag spellings and the
null patterns come from the declared schema, and it deliberately reproduces the live hazards:
blank session caps, the date-corrupted duration column, sale-level fields repeated across line
items, two members sharing a display name, product descriptions in the membership-count column,
empty classes, pre-class cancellations, and one trainer-month with sessions taught and no outcome
enrichment.

```
npx tsx scripts/make-fixtures.mts
FLOOR_FIXTURES=/tmp/floor-fixtures npx tsx scripts/render-test.mts
```

## The Attendance crash

`Cannot read properties of undefined (reading 'suspect')` — [Attendance.tsx:128](../src/tabs/Attendance.tsx#L128).

When the tab was rebound from the Checkins grain to the canonical visit grain, the rename covered
quoted metric ids and `values.<id>` reads but missed a direct property access on a
`metricValues(...)` result: `metricValues(rows, ['v_class_hours'], ctx).class_hours.suspect`. The
array said `v_class_hours`, the property still said `class_hours`, so the lookup returned
`undefined`. Nothing caught it because the renderer only ever saw zero rows, and with no rows the
line is not reached.

Fixed, and the same stale-property sweep was applied across both rebound tabs. All twelve tabs now
render against the fixtures in five filter scenarios.

## Metric cards

Every operating tab now leads with **exactly eight** cards. Trainers and Slots showed six, Overview
six, Late cancellations five, and Format comparison had no strip at all. `audit-bindings.mts`
enforces the count, so a tab cannot quietly drift back.

The card itself moved out of inline styles into `.kpi-card`, and got smaller: 132px tall → **112**
(hero 180 → 130), with tighter padding, an 11px two-line label, a smaller delta pill and a shorter
sparkline. Eight fit across from 1360px up; below that the strip falls back to four, then scrolls.

Two things the measurements caught and the eye would not have:

- Rupee totals were being **ellipsised** on narrow cards — `₹59,54,1…`. The value now scales with
  the card (`clamp(15px, 11.5cqw, 22px)` on a container query) so the figure shrinks rather than
  truncating. Verified clip-free at 1366, 1440 and 1600 across every tab.
- A card whose label wrapped to two lines dropped its value a line below its neighbours. Two label
  lines are now always reserved, so the figures read as one row.
