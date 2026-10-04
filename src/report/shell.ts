/* Document shell for generated reports.
 *
 * This is the master template. It owns the document — the stylesheet, the chrome, the hero, the
 * chapter headers, the appendix and the footer — so every report ever generated shares one
 * structure and one set of behaviours and the two cannot drift apart. Chapter bodies come from
 * `model.ts` and render into this shell.
 *
 * Reports are self-contained: the stylesheet and the one behaviour script are inlined, so a
 * downloaded file opens from disk with nothing behind it. The only external reference is the
 * Google Fonts link, which degrades to system fonts offline.
 */
import { CHAPTERS, type ReportBullet, type ReportChapter, type ReportKpi, type ReportModel, type ReportTable } from './model';

const esc = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── Stylesheet: the single source of truth for how a report looks. ── */
const CSS = `
:root{
  --ink:#0A0F1A; --ink-2:#3D4859; --ink-3:#6B7889;
  --paper:#FFFFFF; --paper-2:#F7F9FC; --paper-3:#EFF3F8;
  --rule:#E4E9F0; --rule-2:#C9D2DE;
  --accent:#1541C4; --accent-wash:#EAF0FE;
  --pos:#0A6B78; --pos-wash:#E6F2F3; --neg:#B80C33; --neg-wash:#FBEAEF; --warn:#8F5A00; --warn-wash:#FBF2E3;
  --serif:"Source Serif Pro",Georgia,serif; --sans:"Inter",system-ui,-apple-system,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  --shadow:0 1px 2px rgba(16,24,40,.05); --shadow-2:0 8px 24px -8px rgba(16,24,40,.14);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:74px}
body{margin:0;background:var(--paper-2);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.62;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums lining-nums}
h1,h2,h3,h4{margin:0;font-weight:600;letter-spacing:-.015em}
p{margin:0 0 .85em}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

/* chrome */
.topbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.93);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--rule)}
.scroll-progress{height:2px;background:var(--accent);width:0}
.topbar-inner{max-width:1180px;margin:0 auto;padding:11px 28px;display:flex;align-items:center;gap:22px}
.brand-text{font-family:var(--serif);font-size:17px;font-weight:700;line-height:1.1}
.brand-text small{display:block;font-family:var(--sans);font-size:11px;font-weight:500;color:var(--ink-3);letter-spacing:.01em}
.topnav{display:flex;gap:3px;margin-left:auto;flex-wrap:wrap}
.topnav a{font-size:12px;font-weight:600;color:var(--ink-3);padding:5px 10px;border-radius:999px}
.topnav a:hover,.topnav a.is-active{background:var(--accent-wash);color:var(--accent);text-decoration:none}
.topbar-actions{display:flex;gap:7px}
.btn{font:inherit;font-size:12px;font-weight:600;padding:7px 13px;border-radius:8px;border:1px solid var(--rule-2);
  background:#fff;color:var(--ink-2);cursor:pointer}
.btn:hover{background:var(--paper-3);color:var(--ink)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}

/* hero */
.hero{max-width:1180px;margin:0 auto;padding:52px 28px 34px}
.hero-eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.hero h1{font-family:var(--serif);font-size:46px;line-height:1.08;margin:12px 0 14px;letter-spacing:-.025em}
.hero-sub{font-size:17px;color:var(--ink-2);max-width:62ch}
.hero-meta{display:flex;gap:26px;flex-wrap:wrap;margin-top:26px;padding-top:20px;border-top:1px solid var(--rule)}
.hero-meta div{min-width:120px}
.hero-meta dt{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.hero-meta dd{margin:3px 0 0;font-size:15px;font-weight:600}

/* contents */
.contents{max-width:1180px;margin:0 auto 10px;padding:0 28px}
.contents-inner{background:#fff;border:1px solid var(--rule);border-radius:14px;padding:20px 24px;box-shadow:var(--shadow)}
.contents h2{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:12px}
.contents ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px}
.contents li a{display:flex;gap:10px;padding:7px 9px;border-radius:8px;font-size:13.5px;font-weight:500;color:var(--ink-2)}
.contents li a:hover{background:var(--paper-3);color:var(--ink);text-decoration:none}
.contents .no{font-family:var(--mono);font-size:11.5px;color:var(--accent);font-weight:600}

/* sections */
main{max-width:1180px;margin:0 auto;padding:0 28px 60px}
.chapter{background:#fff;border:1px solid var(--rule);border-radius:16px;padding:34px 36px;margin:22px 0;box-shadow:var(--shadow)}
.chapter-head{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:22px}
.chapter-no{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--accent);letter-spacing:.06em}
.chapter-head h2{font-family:var(--serif);font-size:30px;margin:5px 0 7px;letter-spacing:-.02em}
.standfirst{font-size:15px;color:var(--ink-2);max-width:70ch;margin:0}

/* kpis */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:12px;margin-bottom:26px}
.kpi{border:1px solid var(--rule);border-radius:12px;padding:14px 15px;background:var(--paper-2);position:relative}
.kpi-label{font-size:11.5px;font-weight:600;color:var(--ink-3);letter-spacing:.02em}
.kpi-value{font-size:27px;font-weight:700;letter-spacing:-.025em;margin:4px 0 2px;line-height:1.1}
.kpi-foot{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.badge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px}
.badge.up{background:var(--pos-wash);color:var(--pos)}
.badge.down{background:var(--neg-wash);color:var(--neg)}
.badge.flat{background:var(--paper-3);color:var(--ink-3)}
.kpi-prev{font-size:11.5px;color:var(--ink-3)}
.kpi-note{font-size:10.5px;color:var(--warn);margin-top:5px}
.spark{display:block;margin-top:8px}

/* narrative */
.narrative{font-family:var(--serif);font-size:16.5px;line-height:1.68;max-width:74ch;margin-bottom:22px}
.narrative p{margin:0 0 .75em}
.block{border:1px solid var(--rule);border-radius:12px;padding:18px 20px;margin-bottom:20px;background:var(--paper-2)}
.block-heading{font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3);margin-bottom:12px}
.bullets{list-style:none;margin:0;padding:0;display:grid;gap:13px}
.bullet{display:flex;gap:11px}
.bullet-dot{width:6px;height:6px;border-radius:999px;background:var(--accent);margin-top:8px;flex-shrink:0}
.bullet strong{display:block;font-size:14px;margin-bottom:2px}
.bullet-meaning{font-size:13.5px;color:var(--ink-2)}
.bullet-evidence{font-size:12px;color:var(--ink-3);font-family:var(--mono)}

/* tables */
.table-block{margin-bottom:24px}
.table-title{font-size:14px;font-weight:600;margin-bottom:3px}
.table-note{font-size:12px;color:var(--ink-3);margin-bottom:9px;max-width:76ch}
.scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:9px 13px;text-align:left;border-bottom:1px solid var(--rule);white-space:nowrap}
th{background:var(--paper-3);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-2);
  position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:var(--paper-2)}
tbody tr:hover{background:var(--accent-wash)}
.bar-cell{position:relative}
.bar-cell .bar{position:absolute;left:0;top:4px;bottom:4px;background:var(--accent);opacity:.1;border-radius:2px}
.bar-cell span{position:relative}

/* actions */
.actions{display:grid;gap:13px}
.action{border:1px solid var(--rule);border-left-width:3px;border-radius:12px;padding:16px 18px;background:#fff}
.action.high{border-left-color:var(--neg)} .action.medium{border-left-color:var(--warn)} .action.low{border-left-color:var(--ink-3)}
.action-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:7px}
.pill{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 8px;border-radius:999px}
.pill.high{background:var(--neg-wash);color:var(--neg)} .pill.medium{background:var(--warn-wash);color:var(--warn)}
.pill.low{background:var(--paper-3);color:var(--ink-3)}
.pill.meta{background:var(--paper-3);color:var(--ink-2);text-transform:none;letter-spacing:0;font-weight:600}
.action h4{font-size:14.5px;margin-bottom:4px}
.action p{font-size:13.5px;color:var(--ink-2);margin:0 0 7px}
.action-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--ink-3)}
.action-meta b{color:var(--ink-2);font-weight:600}

/* charts */
.chart{margin-bottom:24px}
.chart svg{display:block;width:100%;height:auto;overflow:visible}

/* appendix + footer */
.appendix .table-block{margin-bottom:28px}
footer{max-width:1180px;margin:0 auto;padding:30px 28px 56px;border-top:1px solid var(--rule);
  font-size:12.5px;color:var(--ink-3)}
footer b{color:var(--ink-2)}
.provenance{margin-top:14px;font-family:var(--mono);font-size:11px;line-height:1.75;color:var(--ink-3);
  background:var(--paper-3);border-radius:10px;padding:13px 15px;word-break:break-word}

@media(max-width:820px){
  .topnav{display:none} .hero h1{font-size:33px} .chapter{padding:22px 18px;border-radius:12px}
  .hero,.contents,main,footer{padding-left:16px;padding-right:16px}
}
@media print{
  body{background:#fff}
  .topbar,.topbar-actions,.contents{display:none}
  .chapter{break-inside:avoid;box-shadow:none;border:1px solid var(--rule);margin:0 0 14px;page-break-inside:avoid}
  .chapter-head{break-after:avoid} .table-block,.action,.kpi{break-inside:avoid}
  a{color:inherit}
  @page{size:A4;margin:14mm}
}
`;

/* ── Inline SVG charts, so a report needs no chart library. ── */
function lineChart(labels: string[], values: (number | null)[], _fmt: string): string {
  const W = 880; const H = 180; const P = { l: 8, r: 8, t: 14, b: 22 };
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return '';
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v), 0);
  const span = max - min || 1;
  const x = (i: number) => P.l + (i / Math.max(1, values.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts[pts.length - 1].i).toFixed(1)},${y(min)} L${x(pts[0].i).toFixed(1)},${y(min)} Z`;
  const ticks = labels.map((l, i) => (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1
    ? `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#6B7889">${esc(l)}</text>` : '')).join('');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    <path d="${area}" fill="#1541C4" opacity=".07"/>
    <path d="${d}" fill="none" stroke="#1541C4" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.5" fill="#1541C4"/>
    ${ticks}</svg>`;
}

function barChart(labels: string[], values: (number | null)[]): string {
  const rowH = 30; const W = 880; const LBL = 220;
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const bars = labels.map((l, i) => {
    const v = values[i] ?? 0;
    const w = (v / max) * (W - LBL - 90);
    const y = i * rowH;
    return `<text x="${LBL - 12}" y="${y + 19}" text-anchor="end" font-size="12.5" fill="#3D4859">${esc(l)}</text>
      <rect x="${LBL}" y="${y + 6}" width="${Math.max(2, w).toFixed(1)}" height="17" rx="3" fill="#1541C4" opacity="${0.86 - i * 0.07}"/>
      <text x="${LBL + Math.max(2, w) + 9}" y="${y + 19}" font-size="12" font-weight="600" fill="#0A0F1A">${v.toLocaleString('en-IN')}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${labels.length * rowH + 6}" role="img" aria-label="Bar chart">${bars}</svg>`;
}

/* ── Fragments ── */

function kpiCard(k: ReportKpi): string {
  const dir = k.delta === '—' ? 'flat' : k.good === null ? 'flat' : k.good ? 'up' : 'down';
  const arrow = dir === 'flat' ? '' : k.delta.startsWith('−') || k.delta.startsWith('-') ? '▼ ' : '▲ ';
  const low = k.sample > 0 && k.coverage !== null && k.coverage < 0.9;
  const spark = k.spark.filter((v) => v !== null).length > 1
    ? `<svg class="spark" viewBox="0 0 160 26" width="100%" height="26" preserveAspectRatio="none" aria-hidden="true">
        ${sparkPath(k.spark)}</svg>` : '';
  return `<div class="kpi">
    <div class="kpi-label" title="${esc(k.definition)}">${esc(k.label)}</div>
    <div class="kpi-value">${esc(k.formatted)}</div>
    <div class="kpi-foot">
      <span class="badge ${dir}">${arrow}${esc(k.delta)}</span>
      <span class="kpi-prev">was ${esc(k.prevFormatted)}</span>
    </div>
    ${low ? `<div class="kpi-note">⚠ measured on ${((k.coverage ?? 0) * 100).toFixed(0)}% of rows in scope</div>` : ''}
    ${spark}
  </div>`;
}

function sparkPath(series: (number | null)[]): string {
  const pts = series.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return '';
  const max = Math.max(...pts.map((p) => p.v)); const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * 158 + 1;
  const y = (v: number) => 24 - ((v - min) / span) * 22;
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<path d="${d}" fill="none" stroke="#1541C4" stroke-width="1.4" opacity=".6"/>`;
}

function tableBlock(t: ReportTable): string {
  const numeric = new Set(t.numeric);
  // Inline bars need a scale; read the bar column where the value parses as a number.
  let barMax = 0;
  if (t.barColumn !== undefined) {
    for (const r of t.rows) {
      const n = Number(String(r[t.barColumn] ?? '').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) barMax = Math.max(barMax, Math.abs(n));
    }
  }
  const head = t.columns.map((c, i) => `<th class="${numeric.has(i) ? 'num' : ''}">${esc(c)}</th>`).join('');
  const body = t.rows.map((r) => `<tr>${r.map((cell, i) => {
    const cls = numeric.has(i) ? 'num' : '';
    if (i === t.barColumn && barMax > 0) {
      const n = Number(String(cell ?? '').replace(/[^0-9.-]/g, ''));
      const w = Number.isFinite(n) ? (Math.abs(n) / barMax) * 100 : 0;
      return `<td class="${cls} bar-cell"><span class="bar" style="width:${w.toFixed(1)}%"></span><span>${esc(cell)}</span></td>`;
    }
    return `<td class="${cls}">${esc(cell)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-block">
    <div class="table-title">${esc(t.title)}</div>
    ${t.note ? `<div class="table-note">${esc(t.note)}</div>` : ''}
    <div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
}

const bulletList = (bullets: ReportBullet[], heading: string): string => (!bullets.length ? '' : `
  <div class="block">
    <div class="block-heading">${esc(heading)}</div>
    <ul class="bullets">${bullets.map((b) => `<li class="bullet"><span class="bullet-dot"></span><div>
      <strong>${esc(b.headline)}</strong>
      <div class="bullet-meaning">${esc(b.meaning)}</div>
      ${b.evidence ? `<div class="bullet-evidence">${esc(b.evidence)}</div>` : ''}
    </div></li>`).join('')}</ul>
  </div>`);

function chapterHtml(c: ReportChapter, actions: ReportModel['actions']): string {
  const chart = c.chart
    ? `<div class="chart"><div class="table-title">${esc(c.chart.title)}</div>${
        c.chart.kind === 'line' ? lineChart(c.chart.labels, c.chart.values, c.chart.fmt) : barChart(c.chart.labels, c.chart.values)
      }</div>`
    : '';
  const actionCards = c.id !== 'recommendations' ? '' : `<div class="actions">${actions.map((a) => `
    <div class="action ${a.priority}">
      <div class="action-head">
        <span class="pill ${a.priority}">${a.priority} priority</span>
        <span class="pill meta">${esc(a.timeline)}</span>
        <span class="pill meta">${esc(a.owner)}</span>
      </div>
      <h4>${esc(a.title)}</h4>
      <p>${esc(a.description)}</p>
      <div class="action-meta"><span><b>Impact</b> ${esc(a.impact)}</span></div>
    </div>`).join('')}</div>`;
  return `<section class="chapter" id="${c.id}">
    <div class="chapter-head">
      <div class="chapter-no">${esc(c.no)}</div>
      <h2>${esc(c.title)}</h2>
      <p class="standfirst">${esc(c.standfirst)}</p>
    </div>
    ${c.kpis.length ? `<div class="kpis">${c.kpis.map(kpiCard).join('')}</div>` : ''}
    ${c.narrative.length ? `<div class="narrative">${c.narrative.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    ${chart}
    ${bulletList(c.bullets, c.id === 'recommendations' ? 'What the rules found' : 'What these numbers tell us')}
    ${actionCards}
    ${c.tables.map(tableBlock).join('')}
  </section>`;
}

/* ── The document ── */

export function renderReport(m: ReportModel): string {
  const nav = CHAPTERS.map((c) => `<a href="#${c.id}">${esc(c.nav)}</a>`).join('');
  const contents = CHAPTERS.map((c) =>
    `<li><a href="#${c.id}"><span class="no">${esc(c.no)}</span><span>${esc(c.title)}</span></a></li>`).join('')
    + `<li><a href="#appendix"><span class="no">08</span><span>Month-on-month appendix</span></a></li>`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(m.meta.studio)} · Performance report · ${esc(m.meta.periodLabel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Source+Serif+Pro:wght@400;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap"/>
<style>${CSS}</style>
</head><body>

<div class="topbar">
  <div class="scroll-progress" id="scroll-progress"></div>
  <div class="topbar-inner">
    <div class="brand-text">${esc(m.meta.studio)} Pulse<small>Performance report · ${esc(m.meta.periodLabel)}</small></div>
    <nav class="topnav" aria-label="Report chapters">${nav}</nav>
    <div class="topbar-actions"><button class="btn btn-primary" onclick="window.print()">Print or save as PDF</button></div>
  </div>
</div>

<header class="hero">
  <div class="hero-eyebrow">Monthly performance report</div>
  <h1>${esc(m.meta.studio)}<br/>${esc(m.meta.periodLabel)}</h1>
  <p class="hero-sub">Seven chapters running money, demand, funnel and retention through to an outlook and the
  actions that follow from them. Every figure is computed from the source sheets at the moment this report was
  generated, and each chapter contributes its history to the appendix.</p>
  <dl class="hero-meta">
    <div><dt>Period</dt><dd>${esc(m.meta.periodLabel)}</dd></div>
    <div><dt>Compared with</dt><dd>${esc(m.meta.comparedWith)}</dd></div>
    <div><dt>Rows in scope</dt><dd>${m.meta.rowsInScope.toLocaleString('en-IN')}</dd></div>
    <div><dt>Data through</dt><dd>${esc(m.meta.dataThrough)}</dd></div>
    <div><dt>Generated</dt><dd>${esc(m.meta.generated)}</dd></div>
  </dl>
</header>

<div class="contents"><div class="contents-inner">
  <h2>Contents</h2><ol>${contents}</ol>
</div></div>

<main>
  ${m.chapters.map((c) => chapterHtml(c, m.actions)).join('')}
  <section class="chapter appendix" id="appendix">
    <div class="chapter-head">
      <div class="chapter-no">08</div>
      <h2>Month-on-month appendix</h2>
      <p class="standfirst">Each chapter registers its history grid here, so twelve months of every headline
      figure sit in one place rather than scattered through the report.</p>
    </div>
    ${m.appendix.map(tableBlock).join('')}
  </section>
</main>

<footer>
  <b>${esc(m.meta.studio)} · ${esc(m.meta.periodLabel)}</b> — generated ${esc(m.meta.generated)} from the live source sheets.
  Rates are recomputed from their numerators and denominators at every level, never averaged from sub-totals.
  Where a metric could only be measured on part of the scope, the card says so.
  <div class="provenance">Scope: ${esc(m.meta.scopeLine)}</div>
</footer>

<script>
(function(){
  var bar=document.getElementById('scroll-progress');
  var links=[].slice.call(document.querySelectorAll('.topnav a'));
  var sections=links.map(function(a){return document.querySelector(a.getAttribute('href'));});
  function onScroll(){
    var h=document.documentElement;
    var p=h.scrollTop/((h.scrollHeight-h.clientHeight)||1);
    if(bar) bar.style.width=(p*100).toFixed(2)+'%';
    var active=-1;
    for(var i=0;i<sections.length;i++){
      if(sections[i] && sections[i].getBoundingClientRect().top<=120) active=i;
    }
    links.forEach(function(a,i){ a.classList.toggle('is-active', i===active); });
  }
  document.addEventListener('scroll',onScroll,{passive:true});
  onScroll();
})();
</script>
</body></html>`;
}
