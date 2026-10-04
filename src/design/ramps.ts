/* Colour ramps per theme. Format colours are fixed and never reassigned. */
export type Theme = 'matte' | 'gloss';

export const RAMPS = {
  matte: {
    diverging: ['#F2718F', '#C25874', '#7A4356', '#2A2F38', '#2C6B66', '#3DA891', '#4FC3F7'],
    seqAttendance: ['#0E1116', '#102A3A', '#13455F', '#176488', '#2E92C4', '#4FC3F7'],
    seqRevenue: ['#0E1116', '#2C1620', '#4E2335', '#7C354F', '#B9526F', '#F2718F'],
    categorical: ['#4FC3F7', '#F2718F', '#43D9A3', '#F5B74E', '#A78BFA', '#7AD3F9', '#F794AB', '#6FE3BA', '#F8CA7E', '#C0ABFC'],
    format: { 'Barre 57': '#F2718F', Cycle: '#4FC3F7', Strength: '#F5B74E', Pilates: '#A78BFA', Hosted: '#43D9A3', Other: '#43D9A3', Unknown: '#49515F' } as Record<string, string>,
    domain: { attendance: '#4FC3F7', revenue: '#F2718F', growth: '#43D9A3', people: '#A78BFA', risk: '#F5B74E', neutral: '#49515F' } as Record<string, string>,
    pos: '#43D9A3', neg: '#F2666F', warn: '#F5B74E', text3: '#78828F', hairline: '#232833', surface: '#0E1116',
  },
  gloss: {
    diverging: ['#8C1D3D', '#C2325C', '#DE4473', '#EFA7BA', '#F1F4F9', '#A8C2EE', '#3B7FE8', '#2563C9', '#123A70'],
    seqAttendance: ['#F4F7FC', '#DCE7F8', '#B4CBF0', '#7CA3E2', '#3B7FE8', '#2563C9', '#123A70'],
    seqRevenue: ['#FCF3F6', '#F6D9E1', '#EBAEC0', '#DD7D99', '#C2325C', '#8C1D3D'],
    categorical: ['#2563C9', '#C2325C', '#17876B', '#A5700F', '#7449C6', '#3B7FE8', '#DE4473', '#1BA383', '#C48D28', '#9268D6'],
    format: { 'Barre 57': '#C2325C', Cycle: '#2563C9', Strength: '#A5700F', Pilates: '#7449C6', Hosted: '#17876B', Other: '#17876B', Unknown: '#AFB8C6' } as Record<string, string>,
    domain: { attendance: '#2563C9', revenue: '#C2325C', growth: '#17876B', people: '#7449C6', risk: '#A5700F', neutral: '#AFB8C6' } as Record<string, string>,
    pos: '#17876B', neg: '#C2325C', warn: '#A5700F', text3: '#8390A3', hairline: '#DFE4EC', surface: '#FFFFFF',
  },
};

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Sample a ramp at t ∈ [0,1] with linear interpolation. */
export function sample(ramp: string[], t: number): string {
  // Missing/invalid analytical values should disappear into the neutral midpoint, never crash a
  // view while a user switches a table from absolute values to MoM or index mode.
  const safe = Number.isFinite(t) ? t : 0.5;
  const x = Math.max(0, Math.min(1, safe)) * (ramp.length - 1);
  const i = Math.floor(x); const f = x - i;
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  const a = hex(ramp[i]); const b = hex(ramp[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

/** Diverging fill: t ∈ [-1,1]; 0 disappears into the surface. */
export const diverging = (theme: Theme, t: number) => sample(RAMPS[theme].diverging, (Math.max(-1, Math.min(1, t)) + 1) / 2);
export const sequential = (theme: Theme, kind: 'attendance' | 'revenue', t: number) => sample(kind === 'attendance' ? RAMPS[theme].seqAttendance : RAMPS[theme].seqRevenue, t);
export const formatColor = (theme: Theme, f: string | null | undefined) => RAMPS[theme].format[f ?? 'Unknown'] ?? RAMPS[theme].format.Unknown;
export const categorical = (theme: Theme, i: number) => RAMPS[theme].categorical[i % 10];
export const domainColor = (theme: Theme, d: string) => RAMPS[theme].domain[d] ?? RAMPS[theme].domain.neutral;

/** Relative luminance to decide text inversion past ~62% saturation of the ramp. */
export function needsInvert(color: string, theme: Theme) {
  const [r, g, b] = hex(color).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return theme === 'matte' ? L > 0.35 : L < 0.3;
}
