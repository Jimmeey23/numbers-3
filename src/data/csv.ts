/* A streaming RFC-4180 CSV scanner.
 *
 * Why not PapaParse: on these sheets its `step` mode degrades super-linearly — 20k rows of the
 * Checkins export parse in 1.5s, 125k rows take 20s, and 149k rows exhaust the heap. The sheets
 * are 60 MB each, so the parser has to be linear in both time and memory. This scanner walks the
 * source once, reuses a single cell buffer, and hands each row to a callback that maps it
 * immediately, so no raw row array is ever materialised.
 */

export interface CsvOptions {
  /** Called once with the trimmed header row. Return false to abort (schema rejected). */
  onHeader?: (header: string[]) => boolean | void;
  /** Called per data row with the raw cells, aligned to the header. */
  onRow: (cells: string[], rowIndex: number) => void;
  /** Stop after this many data rows (used by the header sniffer). */
  limit?: number;
}

const QUOTE = 34;      // "
const COMMA = 44;      // ,
const CR = 13;
const LF = 10;

/** Parse `text` in one pass. Returns the number of data rows emitted. */
export function parseCsv(text: string, opts: CsvOptions): number {
  const len = text.length;
  let i = 0;
  let header: string[] | null = null;
  let cells: string[] = [];
  let rowIndex = 0;

  while (i < len) {
    cells.length = 0;
    let done = false;

    // ── one record ────────────────────────────────────────────
    while (!done) {
      let value: string;
      if (text.charCodeAt(i) === QUOTE) {
        // quoted field: scan to the closing quote, handling "" escapes
        i++;
        const start = i;
        let piece = '';
        let hasEscape = false;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q === -1) { piece += text.slice(i); i = len; break; }
          if (text.charCodeAt(q + 1) === QUOTE) {          // escaped quote
            piece += text.slice(i, q + 1); i = q + 2; hasEscape = true;
          } else { piece += text.slice(i, q); i = q + 1; break; }
        }
        value = hasEscape ? piece : (piece || text.slice(start, i - 1 < start ? start : i - 1));
        if (!hasEscape) value = piece;
      } else {
        // bare field: run to the next comma or newline
        let end = i;
        for (;;) {
          const c = text.charCodeAt(end);
          if (c === COMMA || c === LF || c === CR || Number.isNaN(c) || end >= len) break;
          end++;
        }
        value = text.slice(i, end);
        i = end;
      }
      cells.push(value);

      // ── delimiter or record end ─────────────────────────────
      const c = text.charCodeAt(i);
      if (c === COMMA) { i++; continue; }
      if (c === CR) { i++; if (text.charCodeAt(i) === LF) i++; done = true; }
      else if (c === LF) { i++; done = true; }
      else if (i >= len) { done = true; }
      else { i++; }                                        // stray char after a quoted field
    }

    if (header === null) {
      header = cells.map((c) => c.trim());
      if (opts.onHeader && opts.onHeader(header) === false) return 0;
      cells = [];
      continue;
    }

    // skip fully blank lines
    let blank = true;
    for (let k = 0; k < cells.length; k++) if (cells[k] !== '') { blank = false; break; }
    if (!blank) {
      opts.onRow(cells, rowIndex++);
      if (opts.limit !== undefined && rowIndex >= opts.limit) return rowIndex;
    }
    cells = [];
  }
  return rowIndex;
}

/** Read just the header without walking the body. */
export function readHeader(text: string): string[] {
  let out: string[] = [];
  parseCsv(text.slice(0, Math.min(text.length, 1 << 16)), { onHeader: (h) => { out = h; return false; }, onRow: () => {} });
  return out;
}

/** Builds a reusable row view: one object whose properties are refreshed per row.
 *  Mappers read it synchronously and copy what they need, so a single object serves every row. */
export function makeRowView(header: string[]): { view: Record<string, string>; set: (cells: string[]) => void } {
  const view: Record<string, string> = {};
  // Seed every key up front so V8 keeps one hidden class for the whole parse.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < header.length; i++) {
    let k = header[i];
    if (k === '') { keys.push(''); continue; }
    while (seen.has(k)) k = `${k}_`;
    seen.add(k); keys.push(k); view[k] = '';
  }
  const n = keys.length;
  const set = (cells: string[]) => {
    for (let i = 0; i < n; i++) { const k = keys[i]; if (k !== '') view[k] = i < cells.length ? cells[i] : ''; }
  };
  return { view, set };
}
