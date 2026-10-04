/* Export in every format an operator actually needs.
   Every export carries the scope in its header, so a table cannot be misread out of context. */
import type { Scope } from '../state/data';
import { csvEscape, downloadText } from '../components/hooks';

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'ndjson' | 'markdown' | 'html' | 'xlsx-xml' | 'clipboard' | 'print';

export const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'csv', label: 'CSV', hint: 'Comma-separated, Excel and Sheets ready' },
  { id: 'tsv', label: 'TSV', hint: 'Tab-separated — pastes straight into a spreadsheet cell grid' },
  { id: 'xlsx-xml', label: 'Excel (XML)', hint: 'SpreadsheetML — opens in Excel with types and a header block' },
  { id: 'json', label: 'JSON', hint: 'Structured, with the scope attached' },
  { id: 'ndjson', label: 'NDJSON', hint: 'One row per line, for pipelines and LLM ingestion' },
  { id: 'markdown', label: 'Markdown', hint: 'Pipe table — pastes into Notion, Slack or a doc' },
  { id: 'html', label: 'HTML', hint: 'Styled standalone page' },
  { id: 'clipboard', label: 'Copy to clipboard', hint: 'TSV on the clipboard' },
  { id: 'print', label: 'Print / PDF', hint: 'Browser print dialogue' },
];

export interface ExportPayload {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
  scopeLine: string;
  meta?: Record<string, string | number>;
}

export function scopeLine(scope: Scope): string {
  const f = scope.filters;
  const bits = [
    `${scope.period.label} (${scope.period.start} to ${scope.period.end})`,
    f.compare === 'none' ? 'no comparison' : `vs ${scope.period.prevLabel}`,
    f.locations.length ? `locations: ${f.locations.join('; ')}` : 'all locations',
    f.trainers.length ? `trainers: ${f.trainers.join('; ')}` : null,
    f.formats.length ? `formats: ${f.formats.join('; ')}` : null,
    f.sources.length ? `sources: ${f.sources.join('; ')}` : null,
    f.membershipTypes.length ? `membership types: ${f.membershipTypes.join('; ')}` : null,
    f.days.length ? `days: ${f.days.join('; ')}` : null,
    f.slots.length ? `time slots: ${f.slots.join('; ')}` : null,
    f.newVsReturning !== 'all' ? `${f.newVsReturning} only` : null,
    f.includeImports ? 'imported rows included' : 'imported rows excluded',
    ...f.transient.map((t) => `${t.dim} = ${t.value}`),
  ].filter(Boolean);
  return bits.join(' · ');
}

const esc = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const htmlEsc = (v: unknown) => esc(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function serialise(p: ExportPayload, format: ExportFormat): { text: string; mime: string; ext: string } {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  switch (format) {
    case 'csv': {
      const head = [`# ${p.name}`, `# Scope: ${p.scopeLine}`, `# Exported: ${stamp}`, ''];
      return { text: [...head, p.columns.map(csvEscape).join(','), ...p.rows.map((r) => r.map(csvEscape).join(','))].join('\n'), mime: 'text/csv', ext: 'csv' };
    }
    case 'tsv': {
      const clean = (v: unknown) => esc(v).replace(/[\t\n]/g, ' ');
      return { text: [p.columns.join('\t'), ...p.rows.map((r) => r.map(clean).join('\t'))].join('\n'), mime: 'text/tab-separated-values', ext: 'tsv' };
    }
    case 'json':
      return { text: JSON.stringify({ name: p.name, scope: p.scopeLine, exported: stamp, meta: p.meta ?? {}, columns: p.columns,
        rows: p.rows.map((r) => Object.fromEntries(p.columns.map((c, i) => [c, r[i]]))) }, null, 2), mime: 'application/json', ext: 'json' };
    case 'ndjson':
      return { text: [JSON.stringify({ _meta: { name: p.name, scope: p.scopeLine, exported: stamp } }),
        ...p.rows.map((r) => JSON.stringify(Object.fromEntries(p.columns.map((c, i) => [c, r[i]]))))].join('\n'), mime: 'application/x-ndjson', ext: 'ndjson' };
    case 'markdown': {
      const align = p.columns.map((_, i) => (typeof p.rows[0]?.[i] === 'number' ? '---:' : ':---'));
      return { text: [`**${p.name}**`, '', `_${p.scopeLine}_`, '',
        `| ${p.columns.join(' | ')} |`, `| ${align.join(' | ')} |`,
        ...p.rows.map((r) => `| ${r.map((v) => esc(v).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n'), mime: 'text/markdown', ext: 'md' };
    }
    case 'html': {
      const text = `<!doctype html><meta charset="utf-8"><title>${htmlEsc(p.name)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#101623}h1{font-size:20px;margin:0 0 4px}
p.scope{color:#4E5A6E;margin:0 0 20px;font-size:12px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid #E4E9F0;padding:7px 10px;text-align:right}th:first-child,td:first-child{text-align:left}
th{background:#F7F9FC;font-size:12px;text-transform:none;color:#3D4859}tr:hover td{background:#F7F9FC}</style>
<h1>${htmlEsc(p.name)}</h1><p class="scope">${htmlEsc(p.scopeLine)} · exported ${stamp}</p>
<table><thead><tr>${p.columns.map((c) => `<th>${htmlEsc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.rows.map((r) => `<tr>${r.map((v) => `<td>${htmlEsc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return { text, mime: 'text/html', ext: 'html' };
    }
    case 'xlsx-xml': {
      const cell = (v: string | number | null) => (typeof v === 'number' && Number.isFinite(v)
        ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${htmlEsc(v)}</Data></Cell>`);
      const text = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#F0F3F8" ss:Pattern="Solid"/></Style>
<Style ss:ID="m"><Font ss:Italic="1" ss:Color="#4E5A6E"/></Style></Styles>
<Worksheet ss:Name="${htmlEsc(p.name).slice(0, 28)}"><Table>
<Row><Cell ss:StyleID="m"><Data ss:Type="String">${htmlEsc(p.name)} — ${htmlEsc(p.scopeLine)}</Data></Cell></Row>
<Row></Row>
<Row>${p.columns.map((c) => `<Cell ss:StyleID="h"><Data ss:Type="String">${htmlEsc(c)}</Data></Cell>`).join('')}</Row>
${p.rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
      return { text, mime: 'application/vnd.ms-excel', ext: 'xls' };
    }
    default:
      return serialise(p, 'tsv');
  }
}

export async function runExport(p: ExportPayload, format: ExportFormat): Promise<string> {
  if (format === 'print') { window.print(); return 'Print dialogue opened'; }
  const { text, mime, ext } = serialise(p, format === 'clipboard' ? 'tsv' : format);
  if (format === 'clipboard') {
    try { await navigator.clipboard.writeText(text); return `${p.rows.length} rows copied`; }
    catch { return 'Clipboard blocked by the browser'; }
  }
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  downloadText(`${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`, text, mime);
  return `${p.rows.length} rows exported as ${ext.toUpperCase()}`;
}
