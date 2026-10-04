# Atlas — Physique 57 India performance

A fourteen-tab analytics environment for a boutique fitness operator: Overview, Sales, Leads, Acquisition, Retention, Classes, Slots, Bookings, Attendance, Trainers, Payroll, Late cancellations, Format comparison and Data health, in two themes (Matte black with neon accents, Gloss white lacquer with crimson/cobalt).

## Run

```
npm install
npm run dev        # http://localhost:5173 — app + same-origin /api/v1
npm run build      # dist/index.html — a single self-contained client file
npm run serve      # build, then serve the app + production HTTP API on :4173
```

Data is read live from Google Sheets in the browser; nothing is bundled.

## If a sheet will not load

The app tells you which one and why, in the banner and on **Data health**. The usual cause is that the
spreadsheet is private: Google answers every request with a redirect to its sign-in page, and a browser
cannot authenticate to `docs.google.com` from another origin.

1. Open the spreadsheet → **Share** → **General access** → **Anyone with the link**, role **Viewer** → **Done**.
2. Press **Refresh** in the title bar.
3. If your workspace blocks link sharing, open **Data health → Point at another source** and paste either a
   different spreadsheet link, or a **File → Share → Publish to web → CSV** link. The app tests it against the
   required columns before accepting it and remembers the choice.

## Connecting the sheets

Every tab is resolved **by title** from `src/data/sheets.config.ts` and read through the public CSV endpoint:

```
https://docs.google.com/spreadsheets/d/{spreadsheetId}/gviz/tq?tqx=out:csv&sheet={Title}
```

For that to work each spreadsheet must be shared as **Anyone with the link → Viewer**. Two of the six spreadsheets (the Sessions workbook and Bookings) are currently private; Data health names them and shows the fix. Until they are shared, the session and booking grains are rebuilt from Checkins and labelled as derived.

Because the endpoint silently serves the first sheet on an unknown title, every response is checked against the declared header schema and rejected (into Data health) if the required columns are missing.

### Service-account alternative

If you would rather keep the sheets private, put a tiny proxy in front of the v4 API:

1. Create a service account, enable the Sheets API, share each spreadsheet with the service-account email (Viewer).
2. Deploy a proxy that exchanges the key for a token and exposes `GET /sheet/:spreadsheetId/:title` returning CSV of `'{title}'!A:ZZ` (resolve title with `spreadsheets.get?fields=sheets.properties(sheetId,title)` — never by gid).
3. Change `sheetUrl` in `src/data/sheets.config.ts` to point at the proxy. Nothing else changes.

### Refresh cadence

Raw CSV responses are cached in the browser Cache API for **15 minutes**. The title-bar **Refresh** clears the cache and reloads; the status bar shows freshness and per-sheet status.

## Adding a metric

Append a `MetricDef` to `src/semantics/metrics.ts`. See `METRICS.md` for the aggregation kinds. Rates must be `weighted` with `num` and `den` — the engine recomputes them from sums at every level, so an average of averages cannot happen. Once defined, the id works in `KpiStrip`, `ColumnDef.metricId`, `MoMTable`, `RankingList` and insight rules.

## Adding a tab

1. Create `src/tabs/YourTab.tsx` exporting a component `({ scope }: { scope: Scope })`.
2. Follow the register order: KPI strip → primary chart → nested table (`id="drill-table"`) → two-up → heatmap → MoM → collapsed secondaries (`lazy`).
3. Register it in `TAB_IDS` and `TABS` in `src/state/view.ts` and in `LAZY` in `src/App.tsx`.
4. If it needs a new grouping dimension, add a `GroupKeyDef` to `GROUP_KEYS` in `src/semantics/aggregations.ts`.

## Adding an insight rule

Add a `Rule` to `src/insights/rules.ts`. Return `{ severity, entity, title, body, action, impactINR, n, tab, linkFilters }`. Thresholds live in `DEFAULT_THRESHOLDS` (`src/state/view.ts`) and are editable in Settings.

## Ask — answering questions in plain English

Three ways in: the **floating Ask button** at the bottom right of every screen, the **Ask** button in the title bar, or the **A** key. Questions are resolved against the metric registry, not against raw
sheet column names, so trade language works:

| You ask | It resolves to |
|---|---|
| "what is draw premium" | `draw_premium_pp` — definition, formula, and the current value |
| "worst slots by fill rate" | `v_fill_rate` ranked ascending by day+time, min-sample guarded |
| "attrition" · "one and done" · "speed to lead" | `churn_rate` · `zero_return_rate` · `response_time_hours` |
| "revenue per head" | `v_rev_per_visit` — and it does *not* mistake "per head" for a grouping |

Every answer states the number, the scope behind it, and — under **Show working** — the formula, the
source columns, the grain and any coverage caveat. If a term genuinely is not in the registry it says so
and lists the nearest metrics; it never claims the data does not exist when it does.

The thread persists across reloads, ↑/↓ recalls earlier questions, any answer can be pinned to a tab as
a signal card, and the whole conversation exports. The same resolver is on the agent API as
`atlas.ask('draw premium')`, so an external agent gets identical answers.

## Custom decision reports

Press **R** or the **Report** button. Choose any relative or custom date range, one or more locations,
and class formats without changing the dashboard. Atlas then emits a self-contained HTML or JSON report
with eleven decision chapters plus a month-on-month appendix.

| # | Chapter | What it carries |
|---|---|---|
| 01 | Executive summary | Six headline figures, the period narrative, location breakdown |
| 02 | Revenue and sales performance | Gross, net, AOV, discounting; by category, product and salesperson |
| 03 | Location and product portfolio | Sales, attendance economics, product and acquisition quality by site |
| 04 | New client conversion funnel | Leads → trial → first visit → return → purchase → membership → 90-day survival |
| 05 | Sessions and class performance | What ran, how full it was and what it earned by format, slot and trainer |
| 06 | Member engagement and attendance | Audience breadth, repeat frequency, power users and new-client mix |
| 07 | Lapsed memberships deep dive | Churn, renewal, risk bands and expiry pipeline |
| 08 | People and unit economics | Payroll, trainer contribution, empty cost and acquisition value |
| 09 | Strategic recommendations | Fired rules as actions with priority, impact, timeline and owner |
| 10 | Predictions and forward view | Run-rate sensitivity range plus money already committed |
| 11 | Data confidence and methodology | Grain, coverage, formulas, sources, caveats and null policy |
| 12 | Month-on-month appendix | Each eligible chapter's thirteen-month grid, through the same month of the prior year |

Structural choices taken straight from the template:

- **One master shell.** `src/report/shell.ts` owns the document — stylesheet, chrome, hero, chapter
  headers, appendix, footer. Chapter bodies render into it, so two reports can only differ in their data.
- **One chapter list.** `CHAPTERS` in `src/report/model.ts` drives the top nav, the contents list and
  the anchor each header prints, so the three cannot disagree.
- **A MoM registry.** Chapters register their history grid as they build; the appendix collects them.
- **Self-contained output.** CSS and the scroll-chrome script are inlined and there is no chart library —
  charts are inline SVG. The file opens from disk with nothing behind it and prints to A4.

**Grounded AI, not free-written copy.** Every chapter regenerates a deterministic decision brief from live KPI deltas,
trend shape, coverage, sample size and the insight-rule engine. Each finding prints its evidence, confidence,
recommended next step and calculation method. The figure in a sentence and the figure in the adjacent table
come from the same registry computation, so the narrative cannot drift or hallucinate a number.

For a second analytical layer, open **Settings → AI intelligence**, enter your own OpenAI API key and choose
a model. **Generate smarter report with AI** sends a compact version of the scoped report evidence, adds a
cross-functional executive interpretation and saves the finished copy in IndexedDB. The report fingerprint
includes its data, scope and model: requesting the exact report again reuses the saved copy and does not call
OpenAI a second time. API keys remain session-only unless **Remember API key** is explicitly enabled. The
Signals rail uses the same saved-by-fingerprint behavior through **Generate with AI**.

Agents can generate the deterministic artefact: `atlas.report('html')` or `atlas.report('json')`.

## Building widgets

The assistant doesn't only answer — it builds. Ask for something and it proposes a widget you can
review and pin:

```
"add fill rate by location to the classes tab"   → table,   Classes
"build a chart of visits by day"                 → column,  Classes
"create a heatmap of no-show rate by day"        → heatmap, Classes
"pin revenue as a card"                          → metric,  Sales
"add visits over time"                           → trend,   Attendance
```

Any answer can also become a widget via **Build widget**, and every tab has a **+ Build a widget**
button opening a four-step composer: what to show (9 kinds), what to measure, how to cut it, and
where it lives.

**Widgets store a specification, not a snapshot.** A table pinned in March shows September's numbers
in September and respects whatever filters are active — verified: the same spec reads 4,609 visits
scoped to one month and 133,494 all-time. They persist on the device, can be reordered, edited,
moved between tabs, pinned to the top or bottom of any tab, and export in all nine formats.

The builder only offers what is computable: metric choices are filtered to a single grain (so rows
line up) and groupings to those the grain actually carries. Invalid specs are rejected with a reason
rather than rendering an empty box — mixed grains, missing groupings, unknown metrics and
heatmaps without a second axis are all caught.

Agents build the same way:

```js
atlas.addWidget({ tab: 'classes', kind: 'column', metrics: ['v_fill_rate'],
                  groupBy: 'daypart', title: 'Fill by time of day', placement: 'top' })
atlas.listWidgets() · atlas.updateWidget(id, patch) · atlas.removeWidget(id) · atlas.widgetKinds()
```

## Agent and streaming APIs

### HTTP API

`/api/v1` is a discovery document. Every normalized source has paginated JSON and streaming NDJSON/SSE
endpoints; the consolidated stream lets an agent consume multiple grains in one connection. A stream starts
with a schema event (field roles, grain, null policy, sampled coverage and semantic-layer link), then record
events with provenance, then a completion cursor. Names, emails and phones are removed and identifiers are
pseudonymised by default.

```text
GET /api/v1/sources/sales?start=2026-04-01&end=2026-04-30
GET /api/v1/sources/visits/stream?location=Kenkere%20House
GET /api/v1/consolidated/stream?sources=sales,visits,memberships
GET /api/v1/semantic-layer?table=sales
GET /api/v1/ask?q=how%20much%20did%20Kwality%20House%20do%20in%20April%202026
GET /api/v1/report?format=json&preset=last_week&location=Kenkere%20House
```

Run these same-origin endpoints with `npm run dev`, `npm run preview`, or `npm run serve`.

### In-page API

Every tab is also addressable from the browser console or an automation. The surface is published on
`window.atlas` and rebuilt on every filter change, so it always reflects what is on screen. Every
response carries the scope it was computed under — an agent cannot quote a number without knowing
the period and filters behind it.

```js
await atlas.describe()                       // catalogue: 14 endpoints, 9 methods
await atlas.get('retention')                 // KPIs, grouped breakdown, groupings, metrics, signals
await atlas.get('classes', { groupBy: 'daypart', limit: 10 })
await atlas.query({ tab: 'bookings',
  metrics: ['visits', 'v_no_show_rate', 'v_lead_time'],
  groupBy: ['location', 'day'], sortBy: 'visits' })   // up to four grouping levels
await atlas.insights()                       // netted rupee impact by basis
await atlas.metrics()                        // the whole registry with formulas and sources
atlas.push({ tab: 'retention', severity: 'critical', title: '…', body: '…', action: '…', impactINR: 180000 })
atlas.setFilters({ preset: 'month', locations: ['Kenkere House'] })
atlas.export('sales', 'markdown')            // json · csv · markdown
```

Cards pushed by an agent appear in that tab's Signal rail marked "From an agent" and persist across
reloads. The full reference, with a live endpoint table, is on the **Data health** tab.

## Exporting

Every chart, table and tab exports in **CSV, TSV, Excel (SpreadsheetML), JSON, NDJSON, Markdown and
HTML**, plus copy-to-clipboard and print/PDF. Each export carries the active scope in its header, so
a table cannot be misread out of context. Charts additionally raster to 2× PNG.

Every chart has five views — **Chart, Table, Records, Summary, Share** — so the visual is never the
only way to read it.

## Keyboard

`1–9 0 - =` tabs · `A` ask · `R` report · `F` filters · `S` signal rail · `D` density · `T` theme · `C` comparison · `/` table search · `⌘K` command palette · arrows / `←→` / `Enter` / `Space` in tables · `Esc` closes panels.

## Verification without a browser

```
npx tsx scripts/render-test.mts   # server-renders all 12 tabs against the real CSVs in 4 filter scenarios
npx tsx scripts/smoke.mts         # prints headline metrics and rollup timings
npx tsx scripts/gen-metrics.mts   # regenerates METRICS.md from the registry
```

The render test expects the sheet CSVs in `/tmp/{Sales,New,Lapsed,Checkins,Payroll,Leads}.csv` (download them with the gviz URL above).

## Files

```
src/data        sheets.config · ingest (fetch, validate, cache) · normalise (§1.3 rules, mappers) · types
src/semantics   metrics (single source of truth) · aggregations (weighted rollup, group keys) · formats (Indian numbers)
src/design      tokens.css (both themes) · typography.css · ramps.ts
src/state       filters (URL-synced, period resolution, predicates) · view · data (memoised scope) · drill
src/components  shell · MetricCard · NestedTable · MoMTable · charts · RankingList · InsightCard · DrillPanel · Tooltip
src/tabs        one file per tab · common.tsx shared registers
src/insights    rules · engine
```
