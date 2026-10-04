/* Indian number formatting. Currency is INR throughout. */
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const dec1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const DASH = '—';
export type Fmt = 'currency' | 'percent' | 'integer' | 'decimal' | 'ratio' | 'days' | 'hours' | 'score' | 'pp';

export const isNil = (v: unknown): v is null | undefined => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));

export function fmtCurrency(v: number | null | undefined, compact = true): string {
  if (isNil(v)) return DASH;
  const a = Math.abs(v); const sign = v < 0 ? '−' : '';
  /* One decimal at most. ₹15.4L is a figure an operator reads at a glance; ₹15.39L invites a
     precision the underlying number does not have, and two decimals on a crore is noise. */
  if (compact && a >= 1e7) return `${sign}₹${dec1.format(a / 1e7)}Cr`;
  if (compact && a >= 1e5) return `${sign}₹${dec1.format(a / 1e5)}L`;
  return `${sign}₹${inr.format(Math.round(a))}`;
}
/** Unabbreviated rupees, still never more than one decimal place. */
export const fmtCurrencyFull = (v: number | null | undefined) => (isNil(v) ? DASH : `${v < 0 ? '−' : ''}₹${inr1.format(Math.abs(v))}`);
export const fmtPercent = (v: number | null | undefined, dp = 1) => (isNil(v) ? DASH : `${(v * 100).toFixed(dp)}%`);
export const fmtInt = (v: number | null | undefined) => (isNil(v) ? DASH : inr.format(Math.round(v)));
export const fmtDecimal = (v: number | null | undefined, dp = 1) => (isNil(v) ? DASH : (dp === 1 ? dec1 : dec2).format(v));
export const fmtRatio = (v: number | null | undefined) => (isNil(v) ? DASH : `${dec2.format(v)}×`);
export const fmtDays = (v: number | null | undefined) => (isNil(v) ? DASH : `${dec1.format(v)}d`);
export const fmtHours = (v: number | null | undefined) => (isNil(v) ? DASH : v < 1 ? `${Math.round(v * 60)}m` : `${dec1.format(v)}h`);

export function formatValue(fmt: Fmt, v: number | null | undefined, opts?: { full?: boolean }): string {
  switch (fmt) {
    case 'currency': return opts?.full ? fmtCurrencyFull(v) : fmtCurrency(v);
    case 'percent': return fmtPercent(v);
    case 'integer': return fmtInt(v);
    case 'decimal': return fmtDecimal(v);
    case 'ratio': return fmtRatio(v);
    case 'days': return fmtDays(v);
    case 'hours': return fmtHours(v);
    case 'score': return isNil(v) ? DASH : Math.round(v).toString();
    case 'pp': return isNil(v) ? DASH : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}pp`;
  }
}

/** Delta: pp for rates, relative % for counts/currency. */
export function fmtDelta(fmt: Fmt, current: number | null | undefined, previous: number | null | undefined): { text: string; value: number | null; kind: 'pp' | 'rel' } {
  if (isNil(current) || isNil(previous)) return { text: DASH, value: null, kind: fmt === 'percent' ? 'pp' : 'rel' };
  if (fmt === 'percent') {
    const d = current - previous;
    return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}pp`, value: d, kind: 'pp' };
  }
  if (previous === 0) return { text: current === 0 ? '0%' : 'new', value: current === 0 ? 0 : null, kind: 'rel' };
  const d = (current - previous) / Math.abs(previous);
  return { text: `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`, value: d, kind: 'rel' };
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const fmtMonth = (ym: string | null | undefined) => (!ym ? DASH : `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`);
export const fmtMonthShort = (ym: string | null | undefined) => (!ym ? DASH : `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`);
export const fmtDate = (d: string | null | undefined) => (!d ? DASH : `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`);
export const fmtDateShort = (d: string | null | undefined) => (!d ? DASH : `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`);
export const fmtTime12 = (t: string | null | undefined) => {
  if (!t) return DASH;
  const h = +t.slice(0, 2); const m = t.slice(3, 5);
  return `${((h + 11) % 12) + 1}:${m}${h < 12 ? 'am' : 'pm'}`;
};
export const fmtAgo = (ts: number) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
export const fmtN = (n: number, unit = 'rows') => `n = ${inr.format(n)} ${unit}`;
