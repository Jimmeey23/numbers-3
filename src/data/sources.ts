/* Per-sheet source overrides.
 *
 * The Sessions workbook (Sessions / Recurring / Teacher Recurring) is private: every access method
 * — gviz, export?format=csv, htmlview — 302s to accounts.google.com/ServiceLogin. A browser cannot
 * authenticate cross-origin to docs.google.com (Google does not send Access-Control-Allow-Credentials),
 * so no code change can read it. It has to be shared, or pointed at a readable URL.
 *
 * This module lets an operator repoint any tab at a different spreadsheet, tab name or direct CSV URL
 * from the Data health tab, persisted locally, without a rebuild.
 */
import type { SheetKey } from './types';
import { SHEETS, sheetUrl, type SheetConfig } from './sheets.config';

export interface SourceOverride {
  spreadsheetId?: string;
  title?: string;
  /** A complete CSV URL — used verbatim, bypassing the gviz builder. */
  url?: string;
}

const KEY = 'floor.sources.v1';

export function readOverrides(): Partial<Record<SheetKey, SourceOverride>> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
export function writeOverride(key: SheetKey, o: SourceOverride | null) {
  const all = readOverrides();
  if (o === null) delete all[key]; else all[key] = o;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}
export const clearOverrides = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

/** Pull a spreadsheet id out of a pasted URL, or accept a bare id. */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

/** Apply any override to a sheet config. */
export function resolveConfig(cfg: SheetConfig, overrides = readOverrides()): SheetConfig {
  const o = overrides[cfg.key];
  if (!o) return cfg;
  return { ...cfg, spreadsheetId: o.spreadsheetId ?? cfg.spreadsheetId, title: o.title ?? cfg.title };
}

export function resolveUrl(cfg: SheetConfig, overrides = readOverrides()): string {
  const o = overrides[cfg.key];
  if (o?.url) return o.url;
  return sheetUrl(resolveConfig(cfg, overrides));
}

export const configFor = (key: SheetKey) => SHEETS.find((c) => c.key === key)!;

/** Live-test a candidate source and report what came back, so the operator is never guessing. */
export async function testSource(cfg: SheetConfig, o: SourceOverride): Promise<{ ok: boolean; message: string; columns?: string[] }> {
  const url = o.url ?? sheetUrl({ ...cfg, spreadsheetId: o.spreadsheetId ?? cfg.spreadsheetId, title: o.title ?? cfg.title });
  let res: Response;
  try { res = await fetch(url, { redirect: 'follow' }); }
  catch (e) { return { ok: false, message: `Network error: ${(e as Error).message}` }; }
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'Google returned 401 — this spreadsheet is still private. Share it as "Anyone with the link · Viewer".' };
  if (!res.ok) return { ok: false, message: `Google returned ${res.status}.` };
  const text = await res.text();
  if (!(res.headers.get('content-type') ?? '').includes('csv')) return { ok: false, message: 'That URL did not return CSV. Use the sheet link, or a published-to-web CSV link.' };
  const header = (text.slice(0, text.indexOf('\n') + 1 || 2000)).split(',').map((c) => c.replace(/^"|"$/g, '').trim()).filter(Boolean);
  const present = new Set(header.map((c) => c.toLowerCase()));
  const missing = cfg.required.filter((c) => !present.has(c.toLowerCase()));
  const rows = text.length;
  if (missing.length) return { ok: false, message: `Reachable, but this is not the ${cfg.title} tab — missing ${missing.join(', ')}. Found: ${header.slice(0, 6).join(', ')}…`, columns: header };
  return { ok: true, message: `Reachable — ${header.length} columns, ${(rows / 1e6).toFixed(1)} MB. Press Refresh to load it.`, columns: header };
}
