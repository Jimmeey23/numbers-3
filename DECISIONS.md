# DECISIONS — where the brief left room, and what was found in the data

## Source access — current state

Re-tested every endpoint at build time:

| Spreadsheet | Status | Rows |
|---|---|---|
| Sales, New, Payroll, Lapsed, Checkins, **Bookings**, **Leads** | Readable | 24,672 · 21,040 · 1,120 · 28,872 · 148,951 · **210,814** · **25,111** |
| **Sessions / Recurring / Teacher Recurring** (`16wFlke0…`) | **Still private — 401 on every method** | — |

The Sessions workbook was verified against `gviz`, `export?format=csv`, `htmlview` and the reference `gid`.
All four return **302 → `accounts.google.com/ServiceLogin`**, while a control request to the Checkins
spreadsheet returns 200 in the same second. The file requires authentication, and a browser cannot
authenticate cross-origin to `docs.google.com` (Google does not send `Access-Control-Allow-Credentials`
for these endpoints), so **no code change can read it**. Two things were built in response:

1. **A blocked-sheet banner and an action panel** on Data health that names the sheet, states exactly what
   Google returned, and gives the three-step fix (Share → Anyone with the link → Viewer).
2. **Source overrides** (`src/data/sources.ts`) — repoint any tab at a different spreadsheet, tab name, or a
   published-to-web CSV URL from inside the app. The candidate is live-tested against the required columns
   before it is accepted, and the choice persists locally. No rebuild, no code edit.

Until it is shared, the **session grain is rebuilt from Checkins** (24,219 sessions), which carries a real
`Capacity` per session — so fill rate is measured, not estimated. Bookings supplies the cancellations that
never reach a check-in row. An earlier build derived sessions from Bookings instead; that produced fill
rates above 100% because Bookings has no capacity column, and was reversed.

## Source access (as originally discovered)

| Sheet | Reality | Decision |
|---|---|---|
| `Sessions`, `Recurring`, `Teacher Recurring` (`16wFlke…`) | Spreadsheet is **private** — Google returns 401 to any unauthenticated read. | Attempted live on every load; failure is reported loudly in Data health with the exact fix ("Share → Anyone with the link → Viewer"). Until then the **session grain is derived from Checkins** (one row per `Session ID`: capacity, booked = booking rows, checked-in, late-cancelled, paid revenue, payment mix from `Cleaned Category`). Every affected register says so in its subtitle and the status bar shows `≈` instead of `✓`. When the sheet becomes readable, `mapSessions` takes over with no other change. |
| `Bookings` (`1OO-Pk7…`) | Private (401). | Same pattern: derived from Checkins (one row per booking). Pre-class cancellations are invisible in that source, so `cancellation_rate` reads 0 and the tab says so. |
| `Leads` | Readable but holds **only a header row** (with extra UTM/LTV columns beyond the declared schema). | Tab renders its full structure, KPIs show —, and an explicit empty state explains what will appear. Lead-response and untouched-lead rules are naturally silent. Registered as an open defect. |
| `Checkins` | Readable; **1,453 rows covering 1–20 Sep 2026 only**. `Month Year` arrives as two columns (`Month`, `Year`). `Duration (Minutes)` is corrupted in 100% of rows (Excel serial dates). | Month normalised from `Date (IST)`. Duration set to NULL, defect registered, every duration-derived metric carries ⚠ and uses a labelled 55-minute estimate. |
| `Sales` | 23,748 rows, Jul 2023 → Sep 2026. Header has `Paid In Money Credits` as one column (brief lists two). Categories include `Class Packages`, `Retail`, `Gift Cards`, `Money Credits`, `Privates`, `Others` beyond the four named. | Schema validated on the columns that exist; drift shown in Data health. All categories flow through untouched. |
| `New` | 20,732 rows; 9,517 have an empty `Is New` (imported history) and 8,167 are dated `Jan-2020` import rows. Locations include `Supreme HQ, Bandra`, pop-ups and partner venues. | `is_new` is true only when `Is New` starts with "New". Import rows are excluded by default (toggle in the drawer). Real location strings are kept canonical; `location_short` adds `Bandra`, `Colaba`, `Pop-up`. |
| `Lapsed` | 28,051 rows; `Status` has six values (`Renewed`, `Lapsed`, `Not Activated`, `Active`, `New`, `Frozen`), not two. Column is `Total Sessions Completed`, not `Completed Sessions`. `Sessions Limit` may be the word `Unlimited`. | Active = Active/Frozen/New. Churned = has `Churned Date` **or** status Lapsed. `Unlimited` → `sessions_limit = null`, `unlimited = true`; utilisation only over limited memberships. |
| `Payroll` | 27 rows, `Sep-2026` only. | Loaded as-is; MoM table shows a single populated column honestly. |

"Today" for every relative period is the **latest observation across the sheets (2026-09-20)**, not the wall clock — otherwise "last 30 days" would be empty on a stale export.

## Architecture

- **No DuckDB-WASM.** The build target is a single inlined `index.html` (vite-plugin-singlefile); shipping a 30 MB WASM engine plus worker inside it is not viable, and the real volumes (75k rows across ten tabs) run comfortably in a typed in-memory query layer: a 28k-row four-level rollup builds in ~110 ms, a full scope recompute in ~150–300 ms. The metric registry keeps the SQL-style formula as documentation so a DuckDB backend can be slotted behind the same `MetricDef` contract later.
- **Sheets are read via the gviz CSV endpoint by tab title**, not the v4 API with a service account — a service-account key cannot live in a static browser bundle. gviz **silently serves the first sheet on an unknown title**, so every response's header row is validated against the declared schema and rejected with the found columns if the required set is missing (anti-pattern 11 defended by construction).
- **Cache**: raw CSV in the Cache API with a 15-minute TTL stamped in a custom header; Refresh clears it.
- **Charts** are bespoke SVG (visx/ECharts not used) so every chart shares one tooltip contract, one draw-in system and one click-to-filter path.
- **Motion**: CSS transitions + Web Animations API; a small FLIP hook keyed on `data-key` handles row reordering.

## Semantics

- **Lapsed period semantics**: a membership is in scope if it was **live during the period** (start ≤ period end and end ≥ period start, or currently Active). Filtering by purchase date would hide every long-running active membership from Retention.
- **Format classification** from class names: cycle → Cycle; barre → Barre 57; strength / FIT / Amped / Blaze → Strength; Mat / Pilates / Recovery → Pilates; hosted → Hosted.
- **Membership type** from product names: Unlimited · Class package · Single class · Newcomer · Complimentary · Private · Credit.
- **Prime time** = 07:00–10:00 and 17:30–20:00.
- **Draw premium** baseline is capacity-weighted studio fill for the same (location, day, time, format) slot across all dimension-filtered data — so a trainer is compared with everyone else who has taught that exact slot.
- **Slot verdict**: Cut = fill < 20% and below break-even · Move = fill < 35% or below break-even · Watch = fill < 50% · Keep · New = < 4 occurrences.
- **Risk score** weights exactly as specified (0.30/0.35/0.15/0.20); recency normalised to 60 days.
- **Revenue bridge** decomposition: volume = Δtransactions × prior AOV; price = ΔAOV × current transactions; mix = Δmembership share × current revenue; new members = gross from first-time clients; churn = 25% of value churned in period (proxy for lost renewals); residual labelled "Other".
- **Pipeline value / conversion value** use ₹12,599 (median first-membership price in the data) where a first-purchase average is not available in scope.
- **Median first membership** appears in the formula text so the ⓘ panel is honest about it.

## UX

- Default period: last 90 days; comparison: prior period; density: compact; theme: Matte; signal rail open ≥ 1600 px.
- Filter drawer edits a draft and applies on "Apply filters" so results change once, with the 90 ms crossfade, not on every checkbox.
- Transient chips (from charts, heatmaps, schedule grid, MoM cells) are dashed and individually clearable; drawer filters are solid.
- Comparison mode renders the comparison value under each figure in tables and cards and adds a ghosted series in charts; the title-bar toggle is persistent for the session.
- The Overview MoM register is split into four tables (Sales / Classes / Acquisition / Retention) because the twelve headline metrics come from four different grains and a single table would silently mix denominators.
- Print/PDF uses the browser's print with the active filter summary in the strip; per-module CSV headers state the active filters.

## Round-2 changes

- **Default period is now the previous calendar month, compared with the month before it.** Month presets
  use calendar-aware comparison, so September compares with August rather than with a rolling 30-day window.
- **Filters were already global** — one store, one predicate, every tab reads the same scope — but the drawer
  now scrolls (`max-height: min(58vh, 520px)` with an internal scroll area), closes on `Esc`, applies on
  `⌘/Ctrl+Enter`, and edits a draft so results change once rather than on every checkbox.
- **Tables scroll in both axes.** The scroll container owns overflow and the table sizes to its content
  (`width: auto; min-width: 100%`), so wide column sets scroll horizontally with the first column pinned
  instead of crushing. Every secondary table is wrapped in the same container.
- **In-table data ink was turned down deliberately.** Sparklines render in `--text-2` at 62% opacity with no
  draw animation, micro-distribution dots at 28–70% opacity, inline bars at 14% (22% on row hover), and heat
  fills are scaled to 85% of the ramp. The number is the signal; the ink is orientation.
- **Cohort maturity.** A client who visited yesterday cannot have "returned" yet. Acquisition now excludes
  first visits inside 21 days by default, with a toggle, and the first-visit-cliff and second-visit rules
  apply the same guard — otherwise last week's joiners are counted as losses.
- **Retention was rebuilt around the member, not the membership.** The Lapsed sheet is one row per
  membership; retention is a property of the person. A single pass builds member-level renewal depth,
  tenure, gaps between memberships, and lifetime spend, feeding 14 new metrics and five new rules.
- **Insight flooding fixed.** Each rule contributes at most five insights, the lead-response rule requires
  20+ leads and ranks to the worst three, and impact is measured against a studio-wide fast-vs-slow
  benchmark rather than asserted.

## The canonical visit grain (round 3)

Visits disagreed across tabs. The cause was not arithmetic:

- **`UniqueID1|UniqueID2` identifies the recurring *slot*, not one class.** In Sep 2026 there are 334
  UniqueID pairs but 822 actual class occurrences — a weekly slot shares one pair across every week.
  Anything keyed on it collapsed five weeks into one. `uid` is now `slot_uid`, and `session_key`
  (`date|slot`) identifies the occurrence.
- **Bookings is a strict subset of Checkins.** Of 4,610 member-session pairs, 4,327 appear in both and
  **283 exist only in Checkins** — not cancelled, simply absent. Six whole sessions are missing too.
  Checkins is therefore authoritative for attendance.
- A cancelled-booking fold-in was looking up `byUid` keyed by `session_id` — a silent no-op.

`buildVisits()` now produces **one row per (occurrence × member)**, Checkins authoritative, Bookings
contributing the booking lifecycle (pre-class cancellations never reach a check-in row). 25 canonical
metrics (`visits`, `v_no_show_rate`, `v_fill_rate`, …) read from it, and Classes, Slots, Bookings and
Attendance all now report **4,610 visits** where they previously reported 4,611 / 4,327 / 4,611.
The legacy per-sheet metrics remain, used only for the Data-health reconciliation.

**Sales net-of-VAT was also wrong.** `Price Excluding VAT In Currency` reads ₹400,000 on rows whose
payment is ₹42,000 and unit price ₹40,000, which made "Net of VAT" exceed gross revenue. Net is now
derived as payment minus VAT, falling back to unit price × quantity; the sheet column is retained
only to count the mismatch on Data health.

## Design: Lacquer and Matte

The light theme is now **pure white with neumorphism** — surfaces are extruded from the canvas with
paired light and shadow from a single top-left source, rather than painted on top of a grey page.
Controls physically depress when pressed or active (`--neu-pressed`), inputs and scroll containers
are recessed (`--neu-inset`), cards sit proud (`--neu-card`).

In Matte the same language is expressed as luminance rather than shadow — a 1px light edge above and
a dark edge below — because a shadow on true black is invisible.

Contrast was measured, not assumed: all body text, accent, status and control-boundary pairings meet
WCAG AA on both the page and the recessed surface in both themes (`/tmp/contrast.mjs`). Two tokens
were darkened to pass — tertiary text to `#5F6C7D` and the control boundary to `#7C8899` — and a
separate `--rule` token now carries decorative separators so the UI does not become heavy.

## Round 4 — identity, resolution and contrast

**UniqueID1|UniqueID2 is not a shared key.** It looks like one, and an earlier build joined on it.
Measured across September 2026, only **6 of 339** booking slot ids appear in Checkins, while
`date + time + member` matches **100%**. The pairs are generated per sheet. The consequence was severe:
visits were counted twice (8,938 instead of 4,610) and fill rate read 83.9% instead of 43.3%, because
the two sources never deduplicated. A class occurrence is now identified by **when and where it ran**
(`date|time|location|class`) and a visit by `date|time|member`. Fill rate now reconciles exactly between
the visit grain and the session grain — both 43.3%.

**The ask resolver.** An agent reporting "draw premium is not defined in these sheets" was reading sheet
columns instead of the registry, where `draw_premium_pp` is defined and computable. `src/api/resolve.ts`
resolves any business term against metric labels, ids, descriptions and an explicit operator-vocabulary
table (~140 phrases), returning a confidence and alternatives. `src/api/ask.ts` turns a question into an
intent — value, breakdown, rank, trend, compare, define, signals — runs the real computation and answers
with the number, the scope and the provenance. Two refinements proved necessary in testing: a grouping is
only applied when explicitly requested, otherwise "revenue per head" and "speed to lead" silently became
breakdowns on "head" and "lead"; and rank wording describes standing ("weakest is…") rather than
magnitude, which was inverted for lower-is-better metrics.

**Contrast was genuinely broken.** Accent text on its own 12% wash — every active button, chip and view
tab — measured **2.25:1** for the neutral domain, which is the "text and background the same colour"
symptom on the Data health tab, and 4.37:1 for violet in Matte. A separate `--hue-ink` token now carries
the readable form of each accent for type, leaving the raw accent for fills and strokes. All twelve
pairings across both themes now clear 4.5:1. Tab hover sets colour and background together so neither can
inherit a matching value.

**Sales net-of-VAT** was derived from a column that reads ₹400,000 where the payment is ₹42,000; it is
now payment minus VAT, and the discrepancy is counted on Data health.

## Why the chat was invisible

It was built, wired and in the bundle — and unreachable. Two causes, one of them a trap worth recording:

1. **The title bar had no overflow handling.** Ten controls in a single non-wrapping flex row came to
   roughly 1,355px of content. At 1,280px — the layout's own documented minimum — the rightmost
   controls, Ask among them, were clipped past the viewport edge with no scroll and no indication.
   Chrome (brand, location list) now truncates and hides at breakpoints; the control cluster never
   shrinks. Content now fits at 1,280 / 1,440 / 1,600 / 1,920.
2. **A chat assistant cannot be the ninth button in a toolbar.** There is now a floating Ask dock at
   the bottom right, present on every tab, with a one-time hint showing two example questions. The
   title-bar entry and the `A` shortcut remain as secondary paths.

**The trap:** my server-render harness reported the panel rendering 0 bytes even with `askOpen: true`,
which looked like proof it was broken. It was not. Zustand v5 passes `getInitialState()` to
`useSyncExternalStore` as the *server* snapshot, so any `setState` before `renderToString` is invisible
to the component — it always sees creation-time state. Store-gated visibility therefore cannot be
asserted server-side at all. The harness has been replaced with `scripts/verify-ask.mts`, which tests
the resolver and the answer engine directly (17 assertions, all passing) rather than trying to prove a
React component is visible without a DOM.

## Widgets are specifications, not snapshots

A pinned widget stores *what to measure and how to cut it*, never the resulting numbers. It
recomputes from the live scope on every render, so a table pinned in March shows September's figures
in September and honours whatever filters are active. The alternative — freezing values at creation —
would make the dashboard a collection of stale screenshots. Verified: one spec reads 4,609 visits
scoped to a month and 133,494 all-time.

Two constraints are enforced at save time rather than discovered at render time:

- **One grain per widget.** Metrics from different tables cannot be grouped onto shared rows, so the
  builder filters its own metric list to companions of the first choice, and `normaliseSpec` rejects
  mixed grains with a reason.
- **Groupings must exist on that grain.** Offered keys come from the endpoint definition for the
  metric's table, so a lead dimension can never be applied to payroll rows.

Specs are also clamped (row limits to 1–200), given an inferred home tab when none is named, and
titled automatically. A malformed agent call returns `{ error }` and changes nothing — it cannot
leave a broken widget on a tab.

## Report structure, and the one place it departs from the template

The monthly report follows the Studio Pulse template: seven numbered chapters in the order
money → demand → funnel → retention → outlook → actions, a month-on-month appendix fed by a registry
each chapter writes into, one master shell owning the document, and a single chapter list driving the
nav, the contents and the anchors so they cannot disagree. Output is one self-contained HTML file.

**The departure is the narrative.** The template calls an LLM per section and caches the result. Floor
composes the prose from the metric registry and the insight engine instead. That is a deliberate
trade: it gives up range of expression and gains the guarantee that the number in a sentence and the
number in the table beneath it are the same computation. A cached LLM narrative can describe last
month's figures beside this month's table; this cannot.

Two consequences worth stating:

- **Actions are the fired rules, not prose.** Each carries its own impact, basis and sample size.
  Owner and timeline are mapped — severity to timeline, tab to owner — and that mapping is a
  convention in `model.ts`, not something the data knows.
- **The outlook is a run-rate, not a forecast.** The midpoint is the trailing three-month mean plus the
  slope of the last six; the band is the larger of that slope or eight per cent of the mean. The report
  says so in the chapter. It assumes nothing changes, which is exactly what a forecast should not assume,
  so it is labelled as a projection and sits beside the committed pipeline — expiring memberships and
  open leads — which is the part that is actually knowable.

Ordering inside tables is explicit rather than incidental: ordinal dimensions (risk bands, dayparts)
keep their natural sequence, and the "weakest slots" table sorts ascending by fill with a minimum of
eight bookings, so a single empty one-off cannot head the list.

## Round 5 — "Aperture": the surface rebuilt

The whole visual layer was rebuilt rather than adjusted. Three things were wrong with the old one:
the chrome competed with the data, the light theme's neumorphism aged badly at small sizes, and a
horizontal strip of fourteen tabs gave no sense of where a tab sat in the business.

**Tokens.** `src/design/tokens.css` is a new three-tier system: a raw palette, then semantic surfaces
(`--surface-1/2/3`, `--surface-inset`, `--glass`), text (`--text-1/2/3`), lines (`--hairline`,
`--hairline-strong`) and elevation (`--shadow-1/2/3`). Eight themes — matte, gloss, carbon, aurora,
paper, contrast, linen, blueprint — each define the same contract, so no component knows which theme
is on. The neumorphic recipes (`--neu-*`) are gone: depth is now a hairline plus a soft shadow plus a
translucent surface, which survives both dark themes and 12px type.

**Domain hue.** Every tab carries `data-domain`, which rebinds `--hue`, `--hue-ink`, `--hue-wash`,
`--hue-edge` and `--hue-veil`. The accent is therefore a property of *where you are* — revenue tabs
are warm, floor tabs cool — and no component hardcodes a colour.

**Typography.** Archivo (variable, display) for numbers, labels and headings; Instrument Sans for
prose. A single scale — `t-display-*`, `t-heading-*`, `t-body-*`, `t-label-*` — with tabular,
width-narrowed figures for every measured value, so columns of numbers align on the decimal.

**Navigation.** The tab strip became a persistent, collapsible side rail grouped into
Pulse · Commercial · Floor · People · Quality (`TAB_GROUPS` in `src/state/view.ts`), with a line icon
per tab, the keyboard shortcut shown on the right, a failed-sheet badge on Data health, and the row
count in scope pinned to the foot. Collapse persists in `localStorage['floor.nav.collapsed']`. The old
horizontal rail is retained for viewports under 1100px, where the side rail is hidden.

**Page header.** Every tab now opens with the same block: its group as an eyebrow, the tab name, a
one-line statement of what the view answers (`blurb` on each `TabMeta`), and four qualifiers —
period, rows in scope, comparison basis and studios. Period is a button that opens the filter drawer.

**Top bar.** Reduced to identity (tab name, period pill, rows in scope), a search field that opens the
command palette, and three clusters: produce (Ask · Report · Export), configure (Compare · Views ·
Density · Theme) and system (Settings · Refresh).

Nothing about the numbers changed. No metric, aggregation or rule was touched in this pass.

## Not done / honest gaps

- Visual screenshots could not be produced — there is no browser binary in this environment. The app is instead exercised by server-rendering all twelve tabs against the real sheets in five filter scenarios (`scripts/render-test.mts`), and the retention figures were cross-checked against an independent Python calculation over the raw CSV.
- Peak memory is 624 MB against a 400 MB target. Honest trade: 460k fully-typed rows resident is what makes every filter change a sub-250 ms array pass. Columnar typed arrays would close it if the data doubles again.
- Bookings and Attendance take 250–900 ms for a first paint at the widest possible scope (all time, 435k rows). Any narrowing brings them inside budget.
- Web Worker aggregation and true virtualisation via TanStack were not needed at these volumes; the nested table windows rows above 120 with spacer rows.
- The Sankey is a compact two/three-column implementation, not a general layout engine.
