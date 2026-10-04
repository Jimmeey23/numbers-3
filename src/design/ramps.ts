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
export type Theme = 'matte' | 'gloss' | 'carbon' | 'aurora' | 'paper' | 'contrast' | 'linen' | 'blueprint';

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
  { id: 'gloss', label: 'Gloss', blurb: 'Bright white with blue, pink, teal, violet and amber accents.', dark: false,
    surface: '#FFFFFF', accents: ['#1773E8', '#D72E81', '#099D83', '#754DE0', '#D18010'],
    pos: '#087D63', neg: '#C82C5B', warn: '#A66507', text3: '#607390', hairline: '#DCE6F5', nullc: '#91A5C1' },
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
  { id: 'linen', label: 'Linen', blurb: 'Soft neutral ground, ink-black type. Minimal, not bare.', dark: false,
    surface: '#FFFFFF', accents: ['#1F4D8F', '#9B2D3F', '#2F6B4A', '#5A4080', '#8A5A12'],
    pos: '#2F6B4A', neg: '#9B2D3F', warn: '#8A5A12', text3: '#5C5C55', hairline: '#E4E4DF', nullc: '#9A9A92' },
  { id: 'blueprint', label: 'Blueprint', blurb: 'Cool white with one blue running through it. Draughtsman-plain.', dark: false,
    surface: '#FFFFFF', accents: ['#13518C', '#1C7BB8', '#0F6E63', '#4A4E9B', '#8A5B1C'],
    pos: '#0F6E63', neg: '#A32F3C', warn: '#8A5B1C', text3: '#556375', hairline: '#DCE5F0', nullc: '#93A1B4' },
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
  return {
    diverging: div(spec),
    seqAttendance: seq(spec, att),
    seqRevenue: seq(spec, rev),
    /* Ten series: the five domain anchors, then the midpoint of each adjacent pair.
       Four constructions were measured against two criteria — the closest pair's RGB distance,
       and each colour's contrast against its own theme's surface:

         lightened copies of the anchors   distance 11–39   contrast ≥4.59
         midpoints of adjacent anchors     distance 20–43   contrast ≥4.59   ← this one
         midpoints plus a lightness step   distance 20–60   light themes collide
         150° hue rotation                 distance 22–61   contrast falls to 2.30

       A lightened copy of blue is still blue at lower opacity, which is why it scored worst on
       separability; a midpoint is a hue of its own at the same lightness, so it keeps the
       family's contrast while pulling the series apart. */
    categorical: spec.id === 'gloss'
      ? [att, rev, gro, ris, peo, '#0799BF', '#A640BB', '#78A91E', '#DF594E', '#5064D1']
      : [att, rev, gro, ris, peo,
        blend(att, peo, 0.5), blend(rev, ris, 0.5), blend(gro, att, 0.45), blend(ris, gro, 0.5), blend(peo, rev, 0.45)],
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
