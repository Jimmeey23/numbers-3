# Physique 57 analytics app: metric and data audit

**Assessment: Needs revision. Coverage: Partial.** Reviewed on October 4, 2026, against the current checkout and newly downloaded configured Google Sheets. Application code was preserved; this delivery adds an audit report, aggregate evidence, and a reproduction harness.

## Scope and evidence

Reviewed ingestion, normalization, the registry of 237 metrics, shared aggregation/filter logic, the purposes and principal bindings of all 12 tabs, report calculations, insight generation, and custom widgets. Recomputed important results from source rows and used small fixtures for supported boundary cases. This is not certification of every chart, filter combination, or all 237 definitions.

All ten configured sheets returned CSV successfully between 09:23:12 and 09:23:47 IST on October 4. The eight primary imported tables contain **487,635 rows**; the **209,516 reconciled visits** are derived from those rows and must not be added as new business observations. Recurring and Teacher Recurring were downloaded but are ignored by the application's ingestion path.

Unless stated otherwise, numeric examples use **September 1–30, 2026**, compared with August, no dimension filters, imports excluded, and the default assumed instructor cost of **₹1,200/session**. “All-time payroll” examples use all 1,117 payroll rows. The app incorrectly infers its as-of date as October 11; examples reproducing its current maturity behavior retain that date explicitly.

Evidence:

- [Aggregate snapshot and calculation evidence](metric-audit-evidence-2026-10-04.json).
- [Repeatable defect harness](../scripts/audit-metric-correctness.mts).
- Fresh source CSVs remain in `/tmp/p57-audit-20261004`; they are not included in the repository.
- Additional runtime, cross-tab and server-render evidence is in that scratch directory. Existing runtime scripts deliberately force Sessions unavailable, so their derived-session results are not evidence for the current live Sessions path.

Browser discovery returned no available browser. Build and TypeScript checks passed. Existing server-render checks passed across 12 tabs and five scope scenarios, using the legacy fallback source path. Browser screenshots, pointer interactions, mobile layout, and client-side tooltip rendering were not verified. Source traces establish the actual erroneous tooltip inputs and formatters.

## Review scorecards

The component denominator is unknown because this review did not inventory every figure and control in the application. “Unknown” is intentional; counts of rows, metrics, or audit checks are not substitutes for chart-level coverage. Findings below describe demonstrated defects rather than an overall accuracy percentage.

### Dashboard best practices and quality

| Category | Observed defects | Assessment |
|---|---|---|
| Usefulness and completeness | Unknown | Membership acquisition stages lose their populated source data; payroll outcomes are all zero in September; source health does not settle two reachable sheets. |
| Analytical clarity | Unknown | Funnel, visit-transition, survival, forecast and revenue-bridge labels make unsupported interpretations. |
| Visual and interaction consistency | Unknown | Retention units are transformed incorrectly; hour-cell filtering broadens the selected population. Actual screenshots and interactions remain unverified. |

### Analytical correctness and robustness

| Category | Observed defects | Assessment |
|---|---|---|
| Source authority and confidence | Unknown | Fresh configured sheets were read; the membership-product column and duration column violate the assumed types. Business-policy ambiguities remain below. |
| SQL/value accuracy | Unknown | No SQL backend is present. JavaScript calculations demonstrably omit cost-bearing rows, use purchase dates as start dates, and collapse names/unknown identities. |
| Within-chart agreement | Unknown | Acquisition chart/table retention disagree; funnel and source composition violate their population bounds. |
| Complete source details | Unknown | Source references exist, but the displayed booking-time, historical-state and configured-threshold meanings are not consistently explained. |
| Cross-artifact consistency | Unknown | Overview, Acquisition, comparison rankings and the exported report use different acquisition populations; refresh can leave insight values stale. |
| Data-quality controls | Unknown | Future observations advance the clock; missing values can become zero/free/full coverage; two source loads remain pending. |
| Conclusion support | Unknown | Revenue drivers overlap, survival is not measured by period activity, lead-response prose can be false, and monetary overlap netting is approximate. |

## Prioritized problems and proposed fixes

P0 invalidates a central result; P1 materially changes interpretation or a decision; P2 is localized cleanup or robustness. “Live” means observed in the October 4 snapshot. “Fixture” means reproduced for a supported input state, with live prevalence stated separately. Suggested fixes below were not applied to application code.

### 1. P0 — Membership buyer data is erased by the wrong parser

**Visible location:** Acquisition journey, membership-buyer metrics, exported funnel. **Evidence: Live; high confidence.**

`src/data/normalise.ts:629` applies `num()` to **Memberships Bought Post Trial**. The source column contains product descriptions, not a count: examples include `Studio 1 Month Unlimited`, `Studio 8 Class Package`, and comma-separated repeated purchases. All **3,909 populated rows** are nonnumeric and become `null`. September has **38 populated rows** and **38 converted newcomers**, but the application's membership-buyer stage reads zero.

**Fix (Proposed):** Preserve the product list in the normalized schema. Derive purchase counts and qualifying membership buyers from explicit product/category rules, or use a trusted numeric source column. Do not equate every listed product with a recurring membership: the list also contains single classes. Add a type check that rejects a populated categorical field passed into a numeric mapper.

### 2. P0 — Scheduled sessions move “today” into the future and depress performance

**Visible location:** Relative date presets, Overview, session KPIs, expiry worklists, maturity filtering, report freshness. **Evidence: Live; high confidence.**

`src/data/ingest.ts:233-235` chooses the latest timestamp across sessions, check-ins, sales and first visits, accepting timestamps up to **400 days ahead**. On October 4 it sets `today = 2026-10-11`. There are **199 sessions and 285 check-in/booking records after October 4**. All 199 sessions have zero attendance because they have not happened; all 285 check-in records say `Checked In = FALSE`.

For October MTD, including scheduled activity through October 11 gives **322 sessions, 4,017 seats, 515 attendees, 12.82% fill, and 230 “empty” sessions**. Restricting only to dates through October 4 gives **123 sessions, 1,539 seats, the same 515 attendees, 33.46% fill, and 31 zero-attendance sessions**. The latter still includes any sessions later on October 4; the definitive “held” population must use occurrence time in IST.

**Fix (Proposed):** Separate execution time, source freshness, scheduled session date, and completed-observation horizon. Operational “today” should come from the IST clock; historical reporting should use an explicit as-of date. Exclude uncompleted future occurrences from held-session, empty-session, no-show and fill metrics. Report freshness per source.

### 3. P1 — Payroll ratios omit costs when revenue or conversions are zero

**Visible location:** Payroll margin and cost-per-acquired metrics, rankings and custom queries. **Evidence: Live and fixture; high confidence.**

`src/semantics/metrics.ts:382-383,391` uses `field || null` for denominators. The weighted engine skips the entire row when the denominator is null (`:99`), including its numerator cost.

Across all payroll rows, **353 zero-conversion rows containing 5,377 sessions** are excluded from acquisition cost. Displayed **₹8,940.31** should be **₹11,335.41** under the published formula: a **21.13% understatement**. Another **28 zero-revenue rows containing 81 sessions** are omitted from margin: displayed **64.4800%**, independently recomputed **64.3666%**. September has no zero-revenue rows, so its margin is unaffected by this particular defect.

**Fix (Proposed):** Preserve denominator zero as zero and sum the cost numerator. Apply a zero guard to the aggregate denominator. Define how genuinely missing revenue/conversion inputs should affect coverage. The same pattern appears in `l_rev_per_session` (`:285`).

### 4. P1 — A retention fraction is multiplied by rupees and then formatted as percent

**Visible location:** Acquisition → “Conversion speed, value and retention.” **Evidence: Live and formatter reproduction; high confidence.**

`src/tabs/Acquisition.tsx:168` plots `retained * maxLtv`, while `src/components/charts/core.tsx:143` formats that transformed value as percent. For September's 1–7-day conversion bucket, actual retention is **93.75%**. With maximum bucket LTV **₹9,277.9375**, the plotted input is **8,698.0664**, yielding a tooltip of **869,806.6%**. Its table retains the correct fraction.

**Fix (Proposed):** Keep percentage data in percentage units and give it an appropriate axis or separate plot. If geometry uses an explicit scale transform, preserve the raw value and inverse transformation for tooltips. Do not put a percentage on a currency axis without an explained mapping.

### 5. P1 — Acquisition funnels subtract groups that are not nested

**Visible location:** Acquisition journey and source composition. **Evidence: Live; high confidence.**

`src/tabs/Acquisition.tsx:44-59` independently counts repeat visitors, purchasers and retained customers. The chart interprets these as sequential stages. The mature September cohort has **17 third visitors but 28 purchasers**, giving **164.7% continuation** and negative lost revenue. A purchase need not wait for a third visit. Leads created this month and newcomers visiting this month also are not one linked cohort.

Source composition (`:81`) subtracts these overlapping totals. **Website Form** has 21 first visitors, 4 returners and 5 purchasers: components **[17, −1, 5, 0]**. `src/components/charts/funnel.tsx:182` skips nonpositive components, so visible positive components total **22 for 21 people**.

**Fix (Proposed):** Show separate visit and purchase branches, or define genuinely nested member-ID populations. For composition, classify each person once into mutually exclusive outcomes. Price only defensible lost opportunities; do not infer lost revenue by subtracting overlapping populations.

### 6. P1 — Identically named acquisition metrics use inconsistent cohorts

**Visible location:** Overview, Acquisition KPIs/rankings/drill-down and report chapter 03. **Evidence: Live; high confidence.**

Acquisition defaults to a 21-day mature cohort (`Acquisition.tsx:26-31,133-135`). Overview uses all in-period rows (`Overview.tsx:96`). September therefore shows **387 first visits and 9.819% conversion** in Overview/report, versus **228 first visits and 12.281% conversion** in Acquisition. Return rates likewise differ: **12.920% versus 15.351%**. These are different populations, not an arithmetic disagreement.

The report's KPI builder uses all rows (`src/report/model.ts:88,299`), but its funnel uses mature rows (`:301-309`) while the prose says younger cohorts are held back (`:314`). Acquisition's prior-period ranking and table rows (`Acquisition.tsx:114,173`) also skip the maturity predicate applied by its KPI comparison.

**Fix (Proposed):** Show total newcomers separately from mature-cohort outcome rates, label eligibility beside each value, and apply the same policy to current/prior comparisons and report sections. Resolve the incorrect as-of clock before defining maturity.

### 7. P1 — “Reach next visit” is a ratio of unrelated period volumes

**Visible location:** Attendance → “The visit-number cliff.” **Evidence: Live; high confidence.**

`src/tabs/Attendance.tsx:23` divides the period's count of visit number n+1 by its count of visit number n. Those visits can belong to different member cohorts or fall across period boundaries. September contains **58 fourth visits and 70 fifth visits**, producing **120.69% reach-next**; visit 15→16 produces **125%**. The text at `:73` calls this the fraction of first-timers who came back.

**Fix (Proposed):** Track the same members forward from an eligible nth visit, allowing a declared follow-up window. Otherwise retain the counts as visit-number volumes and remove continuation/retention claims.

### 8. P1 — Survival measures include immature cohorts and infer missing activity

**Visible location:** Acquisition 90-day measures, journey and cohort triangle. **Evidence: Live and source trace; high confidence.**

`survival_90` (`src/semantics/metrics.ts:255`) includes every converted customer in the denominator, even if they have not had 90 days to survive. September's clients are all too young by October 4 or even the erroneous October 11 clock; the metric returns **0%**, representing an unobservable outcome as failure. The 21-day acquisition maturity switch is insufficient for a 90-day outcome.

The cohort triangle (`Acquisition.tsx:178`) checks first-to-last visit span. A member visiting in month 0 and month 6 is counted as “still visiting” during months 1–5 without activity in those months.

**Fix (Proposed):** Require 90-day observation eligibility, distinguish unavailable/immature cohorts, and define the event that counts as survival. Use actual visit-month activity for monthly retention, or accurately label the existing metric as observed visit-span reach.

### 9. P1 — Revenue bridge double-counts drivers and cancels them in “Other”

**Visible location:** Overview → “Why revenue moved.” **Evidence: Algebra and fixture; high confidence.**

`src/tabs/Overview.tsx:45` uses volume and price terms that already exactly explain the revenue change: `(newTx−oldTx)×oldAOV + (newAOV−oldAOV)×newTx = newRevenue−oldRevenue`. It then adds mix, total newcomer sales and an assumed churn exposure (`:47-51`). “Other” is forced to offset these overlapping additions.

Example: revenue ₹1,000→₹1,200 is fully explained by ₹200 volume. Adding ₹100 mix, ₹200 newcomer sales and −₹50 churn creates **−₹250 Other** purely as a balancing plug. It is not evidence for another revenue driver.

**Fix (Proposed):** Keep the exhaustive volume/price bridge; show mix, newcomer sales and assumed renewal exposure as separate contextual analyses, or build a mutually exclusive decomposition from source-level contributions.

### 10. P1 — Historical retention charts use current status and purchase cohorts

**Visible location:** Retention monthly tables, churn rates, active memberships and historical report comparisons. **Evidence: Source trace; high confidence.**

`src/state/filters.ts:179-183` selects membership records overlapping a period. Metrics then use today's `active`, `churned` and `Status=Renewed` flags (`src/semantics/metrics.ts:262-265`) rather than status at period end or churn/renewal events inside that period. `src/components/MoMTable/MoMTable.tsx:26-28` groups these records by their purchase month. Its “active memberships” history consequently means **currently active memberships by purchase cohort**, not historical monthly active membership stock.

**Fix (Proposed):** Separate current snapshots, purchase cohorts and period events. Reconstruct period-end active status from start/end/freeze history when supported; count churn dates and eligible opening memberships for period churn. If historical state is unavailable, label current-state-by-cohort honestly instead of presenting a historical stock chart. Choosing the churn denominator requires business policy.

### 11. P1 — Tenure calculations use purchase dates or contractual duration

**Visible location:** Retention member tenure, renewal gaps and tenure-at-churn charts. **Evidence: Fixture and source trace; high confidence.**

`src/data/normalise.ts:671-672` assigns `r.ts` to purchase time. `member_tenure` and `avg_gap_between_memberships` (`src/semantics/metrics.ts:296,305`) use it as membership start. Purchases Jan 1/18, starts Jan 10/25, and ends Jan 20/30 give **29-day tenure and no gap**, instead of **20-day tenure and a five-day gap** under the published definitions. The gap's even-sample median also uses the upper-middle observation.

“Days to churn” and Retention survival/timing (`metrics.ts:298`, `Retention.tsx:104-123`) use `Membership Duration (Days)`, not explicitly start-to-churn elapsed time. Contract duration cannot establish when churn happened unless the source guarantees that semantics.

**Fix (Proposed):** Parse start timestamps separately. Derive tenure and gaps from start/end dates with one median convention. Confirm whether duration is contractual or observed; use actual churn dates for churn timing when available.

### 12. P1 — Member grouping merges different people who have the same name

**Visible location:** Attendance member rankings, concentration and drill-downs; other member-grouped views. **Evidence: Live and fixture; high confidence.**

`GROUP_KEYS.member` and `member_name` (`src/semantics/aggregations.ts:35,51`) use display names before member IDs as grouping keys. September Checkins contains **two name collisions involving four IDs**; across all history there are **420 colliding names involving 927 IDs**. A two-ID/same-name fixture yields one group. Some IDs may be duplicate CRM identities, but the app cannot establish that simply from a shared name.

**Fix (Proposed):** Group on stable member ID and render the name as a label. Keep unresolved identity duplicates distinct until explicitly merged at source. Apply the same rule to lead/name groupings.

### 13. P1 — A successful refresh can leave insight amounts stale

**Visible location:** Signal rail, insight APIs and report recommendations. **Evidence: Actual engine fixture; high confidence.**

`src/insights/engine.ts:10-11` caches by row count, filter, period, thresholds and assumed cost. It excludes dataset revision, timestamps and values. Changing a dormant membership from **₹100 to ₹99,999** while keeping row counts/filters produces an insight still worth **₹100**.

**Fix (Proposed):** Invalidate on dataset/scope identity or include a stable data revision in the cache key. Changing values without changing row count is a normal source refresh, not an edge case.

### 14. P1 — Monetary risk netting is a count-weighted approximation

**Visible location:** Insight impact summaries and report claims about net rupee exposure. **Evidence: Actual engine fixture; high confidence.**

`src/insights/engine.ts:49-51` removes a proportional fraction of each card's monetary total based on duplicated member counts. Individual members need not have equal values. Card A claims a=₹100,b=₹900; card B claims a=₹800,c=₹100. The engine returns **₹1,450**. A per-member maximum policy yields **₹1,800**; retaining the first card's claimed values yields **₹1,100**. Neither matches the engine's implied equal-value assumption.

**Needs input / Fix (Proposed):** Choose a per-member monetary overlap policy and retain claim amounts, not just IDs. Until that exists, disclose net totals as population-weighted approximations, not exact financial deduplication. Keep different monetary bases separate.

### 15. P1 — Outlook includes partial months while saying they are complete

**Visible location:** Report “Predictions and forward view.” **Evidence: Source trace; high confidence.**

`src/report/model.ts:229` builds the month series relative to data “today.” `:432-433` includes the reporting month even for MTD/partial custom scopes. `:456` calls the inputs the last three complete months. A report month outside the latest 12-month series gives `cut=-1`, causing current history to be retained for a historical report.

**Fix (Proposed):** Anchor the history to the actual report window and explicitly exclude incomplete months. Reject insufficient historical coverage instead of using current months. Retain the description that the projection is a run-rate scenario rather than a probabilistic forecast.

### 16. P1 — Custom-widget “Weakest” means the bottom of the top N

**Visible location:** Saved strongest/weakest widgets. **Evidence: Source trace and ordering reproduction; high confidence.**

`src/components/Widgets/CustomWidget.tsx:29-32` sorts and truncates all groups before `:134-137` splits them into strongest and weakest. With 100 descending groups and limit 12, “Weakest” contains **ranks 7–12**, not the actual bottom. Ascending sorting can also invert both labels.

**Fix (Proposed):** Select the strongest and weakest independently from all eligible groups. Use the metric's direction of improvement, with sample rules applied before selection.

### 17. P2 — Reachable recurring sheets remain pending and their contents are ignored

**Visible location:** Data Health and recurring-session source expectations. **Evidence: Live; high confidence.**

Both Recurring and Teacher Recurring returned valid CSV. `src/data/ingest.ts:188-189` passes `null` mappers; `consume()` only validates headers and sets status/rows inside its mapper branch (`:140-146`). Both loads therefore remain **pending with zero rows after the dataset is ready**. Their source-defined calculations are not consumed or reconciled.

**Fix (Proposed):** Either consume and validate those source tables, or mark them explicitly as unused/derived. Never show a completed successful fetch as still pending. Decide which source definitions own recurring metrics before comparing source aggregates with recomputed facts.

### 18. P1 — September payroll outcome fields are zero throughout

**Visible location:** Payroll/trainer new-client, conversion and retention metrics. **Evidence: Live; source completeness issue, not proven arithmetic error.**

All **41 September payroll rows** say **New=0, Converted=0, Retained=0**, despite recording **860 sessions and 4,653 customers**. The New sheet records 387 first visits and 38 converted newcomers in September. The sources need not attribute outcomes identically, but an all-zero outcome partition cannot be assumed to measure genuine instructor performance without validating the upstream computation.

**Needs input / Fix (Proposed):** Confirm whether payroll outcome enrichment has run for that month and document its attribution policy. Mark the outcomes unavailable if the upstream calculation is incomplete; do not score instructors as producing zero conversions from an unverified partition.

### 19. P1 — Utilisation and risk scores have sharply different input coverage

**Visible location:** Retention utilisation and risk triage. **Evidence: Live; demonstrated completeness limitation.**

Of 29,035 membership rows, only **3,388 (11.67%)** have numeric caps; **3,628** are unlimited and **22,019** lack a cap. **17,736 blank-cap rows** nevertheless have completed sessions. The current utilisation metric opts into a coverage warning, an improvement over the old audit; unlimited plans legitimately lack a cap.

Risk (`src/data/normalise.ts:645-668`) substitutes neutral utilisation for the remaining rows and neutral recency for **5,314 rows**. **19,748 rows (68.0%)** sit in the 50s score band. This proves heavy imputation and compressed scores, not that the model has zero predictive value. The averaged risk metric reports full contribution because every row receives a constructed score.

**Fix (Proposed):** Expose observed-input coverage separately from score coverage, distinguish unlimited plans from missing caps, and validate risk bands against actual later outcomes. Do not interpret the score as a calibrated churn probability without validation.

### 20. P1 — Nearly every visit duration is corrupted upstream

**Visible location:** Teaching hours, attendee-hours, seat-hours and revenue/hour metrics. **Evidence: Live; known source issue already disclosed.**

**149,133 of 149,533 Checkins rows (99.73%)** contain date-like values in Duration (Minutes). Ingestion sets them to null and applies a disclosed 55-minute estimate. The app's warnings mitigate interpretation; they do not make the duration measured. `class_hours` (`src/semantics/metrics.ts:357`) always uses the default duration for distinct session IDs, even if valid per-session durations are present.

**Fix (Proposed):** Repair the upstream column format and preserve true minute values. Aggregate one observed duration per session, estimating only missing durations. Keep explicit estimate labels until source correction is verified.

### 21. P1 — Session fallback changes the measured population and misjoins cancellations

**Visible location:** Session KPIs when the Sessions source becomes unavailable. **Evidence: Snapshot comparison and fixture; fallback currently inactive for the live Sessions source.**

Fresh Sessions includes **860 September occurrences**, whereas the Checkins-derived session path includes **836**. Empty occurrences absent from the visit feed cannot be recovered, so fallback reliability/fill metrics need a completeness qualification.

`src/data/normalise.ts:369-376` also joins cancellation rows by Bookings `slot_uid` against Checkins `session_id`, despite the source-key warning at `:230-235`. A fixture with two attended rows and one same-occurrence cancelled booking produces two session bookings but three canonical visit bookings.

**Fix (Proposed):** Join cancellations by a tested occurrence key. Prefer a complete schedule/session fact for denominator-sensitive measures. If only visits are available, disclose that observed sessions omit zero-visit occurrences; do not claim schedule completeness.

### 22. P2 — Missing-data states can become free attendance, lost rows or full coverage

**Visible location:** Booking metrics, canonical visits and period filtering. **Evidence: Fixtures; no current null-paid or missing-member rows in downloaded Checkins/Bookings.**

- `v_complimentary_rate`, `complimentary_rate` and derived non-paid counts treat `paid=null` as free; a missing-payment fixture yields 100% complimentary with full coverage.
- Canonical visit deduplication (`src/data/normalise.ts:393-398`) collapses two unidentified attendees in the same occurrence to one.
- Count aggregation (`src/semantics/metrics.ts:83-87`) declares every row contributing, so `v_cancelled`'s coverage warning cannot reflect rows absent from Bookings.
- `buildPredicate()` admits undated rows into every date scope. The downloaded primary sources contain no undated rows, but the fixture demonstrates the failure.

**Fix (Proposed):** Preserve unknown payment state, use defensible row identity when member identity is incomplete, track observability separately from count hits, and exclude or separately disclose undated observations in dated scopes.

### 23. P1 — Clicking a heatmap hour selects an entire daypart

**Visible location:** Shared day/hour heatmaps on several tabs. **Evidence: Source trace; client click not browser-verified.**

`src/tabs/common.tsx:75` turns a 09:00 cell into `slot=Morning`, rather than filtering to 09:00. Resulting metrics cover all morning hours, although the cell represents one hour. Global dimensions are also silently ignored on tables that do not carry them (`src/state/filters.ts:164-176,189-196`), so one global filter can leave some Overview KPIs unchanged.

**Fix (Proposed):** Use an exact hour predicate for the cell, and disclose filter applicability for cross-table metrics. Preserve intentional source-specific dimensions rather than implying that every global filter reaches every table.

### 24. P2 — Settings, group labels and formula metadata still disagree

**Visible location:** Attendance dormancy, risk grouping, KPI definition details. **Evidence: Source trace; high confidence.**

The registry and main Retention ladder now read configured thresholds, but Attendance's worklist still hardcodes **21 days** (`src/tabs/Attendance.tsx:59,92`). `GROUP_KEYS.risk_band` still hardcodes **40/60/80** (`src/semantics/aggregations.ts:63`). Registry formulas/descriptions also say “21” or “60” even when operators change the thresholds.

**Fix (Proposed):** Resolve thresholds consistently in predicates, grouping and explanatory metadata. Retain fixed descriptive recency bands only where they are explicitly independent of configurable alert thresholds.

### 25. P2 — Several labels and assertions contradict their calculations

**Visible location:** Report narratives, lead alerts, Retention comparison table. **Evidence: Formatter/engine reproduction and source trace; high confidence.**

- Report says “median” conversion time (`src/report/model.ts:319`) but uses `avg_conversion_span`, a mean (`:299`).
- The slow-response insight says “none were answered inside the target” when an unrelated studio-wide lift cannot be estimated (`src/insights/rules.ts:84-85`). A fixture with one one-hour response and nineteen ten-hour responses still generates that false assertion.
- Retention “Formats used” (`src/tabs/Retention.tsx:154`) counts membership product types, populated at `:70`, not session formats.

**Fix (Proposed):** Match mean/median wording to the selected statistic, count actual within-target responses, and rename product breadth or derive true session-format breadth.

### 26. P1 — Existing audits provide false confidence about the current source path

**Visible location:** Repository audit documentation and scripts. **Evidence: Fresh-source comparison and source trace; high confidence.**

`AUDIT.md` describes an older snapshot and concludes the arithmetic is correct. Several of its issues have already changed in current code: calendar comparisons and primary threshold plumbing are implemented. Runtime scripts use a fixed file mapping that deliberately omits **Sessions, Recurring and Teacher Recurring**, forcing a fallback even though all three are reachable now. `scripts/audit-deep.mts` checks obsolete `uid` properties, producing zero distinct source sessions. Cross-tab audits compare some legacy metrics/populations instead of the actual tab's full binding path.

**Fix (Proposed):** Make audit source loading configurable, include all configured sources, validate harness field names against types, and map each comparison to the actual displayed binding. Retain the old document as historical evidence, not current certification. The new harness provides both fixture and optional snapshot modes.

## Definitions that need an explicit business decision

These are additional risks, not claims that every numerical difference is a bug:

1. **Revenue basis:** September sales receipts are **₹59,54,184.94**; session-attributed revenue is **₹40,78,685.88**. Purchase revenue and consumed-session attribution legitimately differ. They should retain distinct names and dates. Legacy Bookings sums **₹55,49,130** from sale values, while the canonical attended-visit revenue is **₹40,76,094**. Confirm whether Sale Value is an individual visit allocation or a funding/payment value before calling it session revenue.
2. **Booking lead time:** `v_lead_time` and related metrics use Checkins Order At and Bookings Sale Date. Confirm whether Sale Date represents reservation creation or funding/payment time; otherwise it is a payment-to-session proxy. Do not standardize the label until source semantics are established.
3. **Cancellation and attendance averages:** `new_late_cancel_rate`, `l_cancel_rate` and `l_attendance_rate` average per-record rates. This is valid for an explicitly defined average member/membership rate, but is not the pooled studio incident rate. Publish which interpretation each value serves; use numerator/denominator weights for pooled rates.
4. **Product categories:** Generic `month`, `class`, `pack` and `session` matching precedes Newcomer, complimentary and private matching (`src/data/normalise.ts:210-218`). Examples such as “Complimentary Single Session” and “Private Session” are classified as Single class. Establish category precedence or use governed source category fields.
5. **Lifetime value and stock metrics:** `member_ltv` sums memberships in the selected overlap scope, not all lifetime purchases. Label it scoped membership spend unless complete history is deliberately used. Deferred-revenue sums are period-purchase-row measures; a current liability stock requires current balances across the complete eligible membership base.
6. **New sheet grain:** 181 IDs have multiple first-visit records at different locations/dates, and the duplicates are not all marked new. This may represent per-location acquisition, not exact duplicate records. Confirm the intended grain before merging or deduplicating. September's 387 newcomer rows have 387 distinct IDs.

## Supported checks and reconciliations

- Fresh September Sessions attendance, checked-in visits and Payroll customers all reconcile to **4,653**. Sessions and Payroll both have **860 sessions**; attributed revenue agrees to rounding. The old audit's claim that Sessions/Payroll necessarily disagree is not true for the currently reachable source.
- Reconciled visit grain preserves additional attendance coverage: raw September Bookings records **4,484 attended rows**, versus **4,653** reconciled attended visits. This source gap should not be mistaken for duplicate attendance.
- September gross receipts recompute to ₹59,54,184.94 and **867 distinct Sale IDs**. Their ratio matches AOV **₹6,867.57**.
- The configured Sales snapshot contains only succeeded payments. Missing payment-status exclusion is not a demonstrated current defect.
- Membership IDs in the Sales snapshot are unique among populated IDs, so summing money-left does not currently duplicate those IDs. The stock-vs-purchase-cohort interpretation still needs care.
- Calendar month, quarter and YTD comparison branches exist in current code. The old document's broad claim that these branches are absent was not carried forward.
- Main Retention risk thresholds and several coverage warnings are already improved in current code. Remaining inconsistent paths are listed specifically above.

## Reproduction and repair sequence

Run fixtures without downloading or modifying source data:

```sh
npx tsx scripts/audit-metric-correctness.mts
```

For the snapshot retained during this review:

```sh
npx tsx scripts/audit-metric-correctness.mts /tmp/p57-audit-20261004
```

The harness intentionally exits **1** while demonstrated invariants are violated. Its fixture results distinguish mathematical defects from source-policy decisions; the aggregate JSON preserves the values observed during this review.

Suggested repair order:

1. Correct the membership-product schema and reporting clock; remove future unheld sessions from observed performance.
2. Correct zero-denominator payroll handling, chart units and member identity keys.
3. Establish cohort policies and rebuild nonnested funnels, member progression and survival eligibility.
4. Separate historical snapshots/events, correct tenure dates and forecast inputs, then invalidate dependent insights.
5. Clarify monetary overlap and proxy definitions; repair source status, configurable metadata and audit coverage.

Recheck affected values, comparison populations, report exports and tooltip inputs after each coherent batch. Complete browser verification once a browser is available. The proposed source-policy changes require an explicit agreed definition; they are not substitutes for correcting the proven implementation defects.
