/* Colour ramps per theme. Format colours are fixed and never reassigned. */
export type Theme = 'matte' | 'gloss';

export const RAMPS = {
  matte: {
    diverging: ['#FF3D8A', '#B8306C', '#6B2A4E', '#2A2F38', '#1E5A63', '#0FA5B8', '#00E0FF'],
    seqAttendance: ['#0D0F12', '#0B2A32', '#084754', '#05707F', '#00A3B8', '#00E0FF'],
    seqRevenue: ['#0D0F12', '#2E0F22', '#55163A', '#8A1D54', '#C42B72', '#FF3D8A'],
    categorical: ['#00E0FF', '#FF3D8A', '#00F5A0', '#FFA62B', '#9B5CFF', '#4DD8FF', '#FF7EB0', '#6BFFC4', '#FFC96B', '#BC94FF'],
    format: { 'Barre 57': '#FF3D8A', Cycle: '#00E0FF', Strength: '#FFA62B', Pilates: '#9B5CFF', Hosted: '#00F5A0', Other: '#00F5A0', Unknown: '#4A515E' } as Record<string, string>,
    domain: { attendance: '#00E0FF', revenue: '#FF3D8A', growth: '#00F5A0', people: '#9B5CFF', risk: '#FFA62B', neutral: '#4A515E' } as Record<string, string>,
    pos: '#00F5A0', neg: '#FF4D6D', warn: '#FFC53D', text3: '#6E7787', hairline: '#22262E', surface: '#0D0F12',
  },
  gloss: {
    diverging: ['#8A0A29', '#C10F3A', '#E8214F', '#F4A0B0', '#F2F4F8', '#9CB6F5', '#3B72FF', '#1D4ED8', '#0B2A6B'],
    seqAttendance: ['#F2F5FA', '#D3E0FA', '#A9C4F6', '#6E97EE', '#3B72FF', '#1D4ED8', '#0B2A6B'],
    seqRevenue: ['#FDF2F5', '#F9D3DC', '#F1A3B6', '#E56685', '#C10F3A', '#8A0A29'],
    categorical: ['#1D4ED8', '#C10F3A', '#0E7C86', '#A26A00', '#7A2E7E', '#3B72FF', '#E8214F', '#14A0AC', '#C98A16', '#A052A4'],
    format: { 'Barre 57': '#C10F3A', Cycle: '#1D4ED8', Strength: '#A26A00', Pilates: '#7A2E7E', Hosted: '#0E7C86', Other: '#0E7C86', Unknown: '#AFB8C6' } as Record<string, string>,
    domain: { attendance: '#1D4ED8', revenue: '#C10F3A', growth: '#0E7C86', people: '#7A2E7E', risk: '#A26A00', neutral: '#AFB8C6' } as Record<string, string>,
    pos: '#0E7C86', neg: '#C10F3A', warn: '#A26A00', text3: '#8390A3', hairline: '#DFE4EC', surface: '#FFFFFF',
  },
};

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Sample a ramp at t ∈ [0,1] with linear interpolation. */
export function sample(ramp: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
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
