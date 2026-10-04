# Reconciliation with physique57-analytics-hub

Source: `https://github.com/Jimmeey23/physique57-analytics-hub`, `METRIC_DEFINITIONS.md` (49 metrics,
dated 2026-06-15), cross-read against that repo's `src/`.

Where its document and its code disagreed, the document was treated as the intent. Where its
formula double-counts a multi-line sale, the sale-level dedupe this app already applies was kept,
and the difference is noted below rather than removed.

## Replicated — 13 metrics added

| # | Reference metric | Added here as | Note |
|---|---|---|---|
| 5 | Average Transaction Value | `atv_net` | Divides net of VAT. `aov` divides gross; both are kept — the gap is the tax. |
| 10 | Discount Efficiency | `discount_efficiency` | Revenue from discounted sales per rupee of discount given. |
| 12 | Package Sell-through % | `package_sell_through` | Credits used / credits sold, package products only. Reads low on a short window by construction; the description says so. |
| 14 | Purchase Frequency | `purchase_frequency` | Line items per distinct buyer. `units_per_transaction` is per sale, which is a different question. |
| 27 | Retention Rate | `retention_of_converted` | Retained / Converted. Our `retention_rate` divides by every new client; both are kept, because they answer different questions. On Sep 2026 the two read 84.2% and 12.9%. |
| 31 | Churn Rate | `churn_rate_ending` | Lapsed / memberships whose term ended in the period — the actuarially correct base. Our `churn_rate` divides by every membership in scope. Sep 2026: 28.1% against 16.4%. |
| 33 | Early Exit Rate | `early_exit_rate` | We had the count; this is the rate. |
| 34 | Average Sessions Used % | `avg_sessions_used_pct` | Mean of each membership's own percentage. `utilisation` pools the sessions, so it is size-weighted. Sep 2026: 55.0% against 56.1%. |
| 35 | Average Days Active | `avg_days_active` | — |
| 36 | Discount-Driven Lapse % | `discount_driven_lapse` | — |
| 41 | Trainer Score (composite) | `trainer_score` | Their weights exactly: class average 40%, fill 30%, conversion 20%, retention 10%, capped 0–100. |
| 43 | Trainer Retention Rate | ~~`p_retention_of_converted`~~ | **Withdrawn.** Retained / Converted is not computable on this export: the Payroll sheet's `Retained` is not a subset of its `Converted` — 441 of 1,117 trainer-months have Retained > Converted, and the metric read 129%. Both are independent outcomes of the New cohort. `p_retention_rate` divides by `New`, which holds on every row. |
| 49 | Session Intelligence Composite | `session_intelligence` | Their weights exactly: class avg ×5 at 40%, fill at 35%, session volume ×2 at 25%. |

`QueryContext` gained `periodStart` / `periodEnd` so a metric can use "rows whose own date falls
inside the window" as its denominator — `churn_rate_ending` needs it.

## Already equivalent — 29 metrics

Net sales, gross sales, session revenue, transactions, AUV, unique members, discount value,
discount penetration, VAT, repeat purchase rate, visits, sessions conducted, class average
(`avg_class_size_excl` already excludes empty sessions), fill rate, empty sessions, empty-session
share, late cancellations, new members, conversion rate, average LTV, average conversion span,
lapsed count, win-back rate, leads created, trials scheduled, lead yield, trainer conversion rate,
trainer utilisation, format class average and format fill rate, MoM and YoY growth.

## Deliberately different — 5

**Transactions, net sales, gross sales, ATV (#1, #2, #4, #5).** Their formulas count sheet rows.
The Sales sheet repeats sale-level fields on every line item, so a three-item basket is counted as
three transactions and its payment value three times. This app dedupes on `Sale ID` first. Their
own document flags the ambiguity under #5's "Known ambiguity". Not replicated.

**Unique Members (#7).** Theirs falls back to `Customer Email` when `Member ID` is blank. Mixing
identifiers in one distinct count can both double-count and under-count the same period, which
their document also flags. Ours counts `Member ID` only.

**Revenue per Visit (#21) and Revenue per New Client (#30).** Both divide Sales-sheet revenue by a
count from a different sheet. A membership bought in March funds April's visits, so the ratio
mixes two clocks. This app answers "what is a visit worth" with revenue attributed to the visit
(`v_rev_per_visit`), and the concept registry forbids a second answer to the same question.

**Late Cancellation Rate (#23).** Theirs divides by `Visits + Late Cancels`, which excludes
no-shows from the base. Ours divides by bookings that reached the class. Theirs reads higher on the
same data.

**Penalty Revenue (#24).** No `Charged Penalty Amount` column exists in the Check-ins export this
app reads. Not built; it needs the column.

## Not replicated, with cause

**Hosted-class detection.** Their regex ends in a `|x` alternation, so every class name containing
the letter "x" — Express, Mix, Max — matches as hosted.

**Capacity.** They assume 20 seats per session where real capacity exists in the Sessions sheet.

**`revenueScore`.** The composite their UI labels as a revenue score contains no revenue term; it
is #41, which is reproduced faithfully here as `trainer_score` under an accurate name.

**Their churn rate as implemented.** The prior-period figure is structurally 100% in their code.
The *definition* (#31) is sound and is what `churn_rate_ending` implements.

## Assets

25 trainer portraits and 3 studio photographs from that repo's `public/images`, resized to 128px
and 256px JPEGs (149 KB in total) under `public/trainers` and `public/studios`.

Matching is on full name only. Their `getTrainerImage` falls back to a first-name match, which on
the live roster would put Shruti Kulkarni's photograph beside Shruti Suresh.

Seven of the 32 trainers on the roster have no portrait and fall back to initials: Karanvir Bhatia,
Siddhartha Kusuma, Chaitanya Nahar, Shruti Suresh, Poojitha Bhaskar, Maysaa Nafis, Siya Mukund.
Their map points Karanvir at `Karanveer.jpg`, which does not exist in the repo, and separately
aliases "karanvir bhatia" to Karan Bhatia. Both names teach in the same months with comparable
volume, so they may be two people; until that is confirmed, Karanvir gets initials rather than
someone else's face.
