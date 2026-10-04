/* Colour per theme.
 *
 * A theme is declared once, here, as its five domain accents plus the few neutrals the charts
 * need. Everything else — the sequential and diverging ramps, the categorical series order, the
 * per-format colours — is derived from that declaration, so adding a theme is one entry rather
 * than six hand-tuned ramps that drift apart. `src/design/tokens.css` carries the same palette as
 * CSS custom properties for the chrome; this is the half the canvas and SVG need as values.
 *
 * Format colours are assigned from the accents and never reassigned: Barre, Cycle and Strength
 * keep the same relative hue in every theme, so switching theme never makes a reader re-learn
 * which line is which.
 */
export type Theme = 'matte' | 'gloss' | 'carbon' | 'aurora' | 'paper' | 'contrast';

export interface ThemeMeta {
  id: Theme;
  label: string;
  /** One line, shown in the theme menu. */
  blurb: string;
  dark: boolean;
}

interface ThemeSpec extends ThemeMeta {
  surface: string;
  /** Domain accents, in the order attendance · revenue · growth · people · risk. */
  accents: [string, string, string, string, string];
  pos: string; neg: string; warn: string; text3: string; hairline: string; nullc: string;
}

const SPECS: ThemeSpec[] = [
  { id: 'matte', label: 'Matte', blurb: 'Matte black, neon accents. Light comes only from the data.', dark: true,
    surface: '#0E0E0F', accents: ['#00E5FF', '#FF2E88', '#00FFA3', '#B87CFF', '#FFC400'],
    pos: '#00FFA3', neg: '#FF4D6A', warn: '#FFC400', text3: '#7F7F88', hairline: '#242427', nullc: '#4A4A52' },
  { id: 'gloss', label: 'Gloss', blurb: 'Bright white, blue accents. Surfaces extrude from the page.', dark: false,
    surface: '#FFFFFF', accents: ['#1668E3', '#0B3FA8', '#0B7765', '#5C46D4', '#A35C00'],
    pos: '#0E8A5F', neg: '#C32B4B', warn: '#A35C00', text3: '#5D6C84', hairline: '#E2EAF4', nullc: '#9AA8BC' },
  { id: 'carbon', label: 'Carbon', blurb: 'Graphite and warm, restrained accents. The quietest theme.', dark: true,
    surface: '#1C2023', accents: ['#3FBFA8', '#E8756B', '#9FC46A', '#8E9BF0', '#E8A33D'],
    pos: '#7FC77A', neg: '#E8756B', warn: '#E8A33D', text3: '#7E888F', hairline: '#32383D', nullc: '#59616A' },
  { id: 'aurora', label: 'Aurora', blurb: 'Deep indigo night with cool pastels. Dark without being black.', dark: true,
    surface: '#121831', accents: ['#6FD3FF', '#FF9BC2', '#74E8C3', '#B8A1FF', '#FFD27A'],
    pos: '#74E8C3', neg: '#FF8095', warn: '#FFD27A', text3: '#7C88B4', hairline: '#2A3560', nullc: '#4C5882' },
  { id: 'paper', label: 'Paper', blurb: 'Warm cream and editorial ink. The theme to print from.', dark: false,
    surface: '#FFFDF7', accents: ['#2B5C8A', '#96333D', '#5C6B2F', '#6A4A7A', '#9A6B1E'],
    pos: '#4F6B33', neg: '#96333D', warn: '#9A6B1E', text3: '#6B6459', hairline: '#E0D8C8', nullc: '#A89B84' },
  { id: 'contrast', label: 'Contrast', blurb: 'Okabe–Ito on white: every series stays separable for colour blindness.', dark: false,
    surface: '#FFFFFF', accents: ['#0072B2', '#B04E00', '#007A5A', '#A8537F', '#8A6100'],
    pos: '#007A5A', neg: '#B04E00', warn: '#8A6100', text3: '#4A4A4A', hairline: '#CFCFCF', nullc: '#767676' },
];

export const THEMES: ThemeMeta[] = SPECS.map(({ id, label, blurb, dark }) => ({ id, label, blurb, dark }));
export const THEME_IDS = SPECS.map((s) => s.id);
export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEME_IDS as string[]).includes(v);
export const isDark = (t: Theme) => SPEC[t].dark;

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const blend = (a: string, b: string, f: number) => { const A = hex(a); const B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * f)); };

/** A sequential ramp: five steps from the surface to the accent, then one past it.
 *  On a dark theme "past it" means brighter; on a light theme it means deeper. */
const seq = (spec: ThemeSpec, accent: string) => [
  spec.surface,
  blend(spec.surface, accent, 0.22),
  blend(spec.surface, accent, 0.44),
  blend(spec.surface, accent, 0.68),
  accent,
  blend(accent, spec.dark ? '#FFFFFF' : '#000000', 0.22),
];

/** Diverging: revenue hue → the surface at zero → attendance hue. Zero disappears into the page. */
const div = (spec: ThemeSpec) => {
  const [a, r] = [spec.accents[0], spec.accents[1]];
  return [blend(r, spec.dark ? '#FFFFFF' : '#000000', 0.18), r, blend(spec.surface, r, 0.45),
    spec.surface, blend(spec.surface, a, 0.45), a, blend(a, spec.dark ? '#FFFFFF' : '#000000', 0.18)];
};

interface Ramp {
  diverging: string[]; seqAttendance: string[]; seqRevenue: string[]; categorical: string[];
  format: Record<string, string>; domain: Record<string, string>;
  pos: string; neg: string; warn: string; text3: string; hairline: string; surface: string;
}

function build(spec: ThemeSpec): Ramp {
  const [att, rev, gro, peo, ris] = spec.accents;
  const lift = (c: string) => blend(c, spec.dark ? '#FFFFFF' : '#000000', 0.26);
  return {
    diverging: div(spec),
    seqAttendance: seq(spec, att),
    seqRevenue: seq(spec, rev),
    /* Ten series: the five accents, then the same five shifted, so the sixth line is related to
       the first rather than an eleventh unrelated hue. */
    categorical: [att, rev, gro, ris, peo, lift(att), lift(rev), lift(gro), lift(ris), lift(peo)],
    format: { 'Barre 57': rev, Cycle: att, Strength: ris, Pilates: peo, Hosted: gro, Other: gro, Unknown: spec.nullc },
    domain: { attendance: att, revenue: rev, growth: gro, people: peo, risk: ris, neutral: spec.nullc },
    pos: spec.pos, neg: spec.neg, warn: spec.warn, text3: spec.text3, hairline: spec.hairline, surface: spec.surface,
  };
}

const SPEC = Object.fromEntries(SPECS.map((s) => [s.id, s])) as Record<Theme, ThemeSpec>;
export const RAMPS = Object.fromEntries(SPECS.map((s) => [s.id, build(s)])) as Record<Theme, Ramp>;

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

const ramp = (theme: Theme) => RAMPS[theme] ?? RAMPS.matte;

/** Diverging fill: t ∈ [-1,1]; 0 disappears into the surface. */
export const diverging = (theme: Theme, t: number) => sample(ramp(theme).diverging, (Math.max(-1, Math.min(1, t)) + 1) / 2);
export const sequential = (theme: Theme, kind: 'attendance' | 'revenue', t: number) => sample(kind === 'attendance' ? ramp(theme).seqAttendance : ramp(theme).seqRevenue, t);
export const formatColor = (theme: Theme, f: string | null | undefined) => ramp(theme).format[f ?? 'Unknown'] ?? ramp(theme).format.Unknown;
export const categorical = (theme: Theme, i: number) => ramp(theme).categorical[i % 10];
export const domainColor = (theme: Theme, d: string) => ramp(theme).domain[d] ?? ramp(theme).domain.neutral;

/** Relative luminance, to decide whether a heat cell needs inverted text. */
export function needsInvert(color: string, theme: Theme) {
  const [r, g, b] = hex(color).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return isDark(theme) ? L > 0.35 : L < 0.3;
}
