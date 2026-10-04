import { useId, type CSSProperties, type ReactNode } from 'react';
import type { TabId } from '../state/view';

/** The motif on a tab's masthead.
 *
 *  Each tab gets its own composition, built from the same small vocabulary — guides, bars,
 *  drawn lines, tiles, rings, travelling points — so fourteen different drawings still look
 *  like one hand made them. The shapes are illustrative: they are drawn from the *shape* of
 *  what the tab measures (a funnel for acquisition, a timetable for slots, a pulse for data
 *  health) and never from the measurements themselves. Everything animates on a long, slow
 *  loop and stops entirely under prefers-reduced-motion.
 */
export function HeroGraphic({ tab }: { tab: TabId }) {
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '');
  const id = (n: string) => `${uid}-${n}`;
  const v = (i: number) => ({ ['--i' as string]: i }) as CSSProperties;

  /* ── vocabulary ─────────────────────────────────────────────────────────── */
  const guides = (ys: number[]) => (
    <g className="hg-guides">{ys.map((y) => <path key={y} className="hg-guide" d={`M6 ${y}H274`} />)}</g>
  );
  const line = (d: string, i = 0, cls = '') => (
    <path key={`l${d.slice(0, 8)}${i}`} className={`hg-line hg-draw ${cls}`} pathLength={1} d={d} style={v(i)} />
  );
  const area = (d: string, i = 0) => (
    <path key={`a${d.slice(0, 8)}`} className="hg-area" d={d} fill={`url(#${id('area')})`} style={v(i)} />
  );
  const bar = (x: number, y: number, w: number, h: number, i: number, strong = false) => (
    <rect key={`b${x}${y}`} className={`hg-bar ${strong ? 'hg-strong' : ''}`} x={x} y={y} width={w} height={h} rx={3} style={v(i)} />
  );
  const tile = (x: number, y: number, w: number, h: number, i: number, strong = false) => (
    <rect key={`t${x}${y}`} className={`hg-tile ${strong ? 'hg-strong' : ''}`} x={x} y={y} width={w} height={h} rx={4} style={v(i)} />
  );
  const dot = (x: number, y: number, i: number, r = 3.2) => (
    <circle key={`d${x}${y}`} className="hg-point" cx={x} cy={y} r={r} style={v(i)} />
  );
  const trace = (d: string, dur = 7, delay = 0) => (
    <circle key={`tr${d.slice(0, 6)}${delay}`} className="hg-trace" r="3.4"
      style={{ offsetPath: `path('${d}')`, animationDuration: `${dur}s`, animationDelay: `${delay}s` }} />
  );
  const halo = (x: number, y: number) => (
    <g key={`h${x}`}><circle className="hg-halo" cx={x} cy={y} r="11" /><circle className="hg-point" cx={x} cy={y} r="3.6" style={v(0)} /></g>
  );

  const CURVE = 'M14 104C54 100 66 74 104 72S160 86 186 60 236 28 268 22';
  const PULSE = 'M8 74h44l12-30 18 58 16-44 11 22h28l10-18 13 26h98';

  const art: Record<TabId, ReactNode> = {
    /* A month read at a glance: volume beneath, trend on top, today marked. */
    overview: <>
      {guides([34, 70, 106])}
      {[26, 38, 33, 58, 50, 76, 66, 88].map((h, i) => bar(18 + 32 * i, 118 - h, 18, h, i))}
      {area(`${CURVE} L268 122 L14 122 Z`)}
      {line(CURVE, 1)}
      {trace(CURVE, 9)}
      {halo(268, 22)}
    </>,

    /* Money stacking up, with the run-rate drawn over it. */
    sales: <>
      {guides([40, 78, 112])}
      {[34, 48, 42, 64, 58, 80, 74, 96].map((h, i) => bar(18 + 32 * i, 120 - h, 18, h, i, i > 5))}
      {[0, 1, 2].map((i) => <ellipse key={i} className="hg-coin" cx={238} cy={44 - i * 11} rx={16} ry={5.5} style={v(i)} />)}
      {line('M14 100C58 94 74 72 112 70S170 78 198 52 240 30 268 26', 2)}
      {halo(268, 26)}
    </>,

    /* Hours worked becoming money paid: bars, then the rate line across them. */
    payroll: <>
      {guides([38, 76, 112])}
      {[30, 46, 58, 50, 74, 68, 86, 80].map((h, i) => bar(18 + 32 * i, 120 - h, 18, h, i, h > 70))}
      {line('M18 96L50 88L82 78L114 82L146 62L178 68L210 44L258 50', 1, 'hg-dashed')}
      {[[50, 88], [114, 82], [178, 68], [258, 50]].map(([x, y], i) => dot(x, y, i))}
    </>,

    /* The funnel, stage by stage, with enquiries falling through it. */
    acquisition: <>
      {[0, 1, 2, 3].map((i) => (
        <path key={i} className="hg-fill" style={v(i)}
          d={`M${16 + i * 62} ${20 + i * 11}h${58 - i * 7}l-11 ${94 - i * 20}h-${36 - i * 3}Z`} />
      ))}
      {line('M28 34L90 48L152 62L214 78L262 92', 4)}
      {trace('M28 30L90 44L152 58L214 74L262 88', 6)}
      {trace('M28 30L90 44L152 58L214 74L262 88', 6, 2)}
    </>,

    /* Enquiry to member: four stages with the conversation moving between them. */
    leads: <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          {tile(16 + i * 66, 24 + i * 6, 52, 90 - i * 12, i)}
          <path className="hg-guide" d={`M${26 + i * 66} ${42 + i * 6}h32M${26 + i * 66} ${54 + i * 6}h22`} />
        </g>
      ))}
      {line('M42 118C78 118 86 110 108 110S152 108 174 106 220 100 240 96', 4)}
      {trace('M42 118C78 118 86 110 108 110S152 108 174 106 220 100 240 96', 7)}
      {halo(240, 96)}
    </>,

    /* Cohorts holding: rings turning at their own speed around a steady centre. */
    retention: <>
      <circle className="hg-ring hg-orbit" cx="140" cy="70" r="56" strokeDasharray="190 162" />
      <circle className="hg-ring hg-orbit hg-orbit-slow" cx="140" cy="70" r="40" strokeDasharray="120 132" />
      <circle className="hg-ring" cx="140" cy="70" r="24" />
      {line('M140 38V70l22 15', 2)}
      {halo(140, 70)}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} className="hg-spark" cx={140 + 56 * Math.cos((i / 6) * Math.PI * 2)} cy={70 + 56 * Math.sin((i / 6) * Math.PI * 2)} r="2.6" style={v(i)} />
      ))}
    </>,

    /* The timetable: a week of slots, the strong ones lighting in sequence. */
    slots: <>
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4, 5, 6].map((c) =>
        tile(14 + c * 38, 18 + r * 30, 32, 23, r * 7 + c, (r * 3 + c * 5) % 7 < 2)))}
      <rect className="hg-scan" x="14" y="14" width="32" height="118" rx="6" />
    </>,

    /* A class list: each occurrence a card, its fill drawn inside it. */
    classes: <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          {tile(16 + i * 44, 20 + (i % 2) * 10, 34, 92 - (i % 2) * 14, i)}
          {bar(23 + i * 44, 96 - (i % 3) * 16, 20, 14 + (i % 3) * 16, i, i % 3 === 2)}
        </g>
      ))}
      {line('M24 30C70 34 92 24 138 28S212 36 262 26', 6, 'hg-dashed')}
    </>,

    /* The booking sheet, ticked off. */
    bookings: <>
      {tile(28, 14, 170, 112, 0)}
      {line('M28 44h170M64 8v16M162 8v16', 1)}
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4].map((c) =>
        tile(42 + c * 32, 56 + r * 17, 22, 11, r * 5 + c, (r + c) % 4 === 0)))}
      <circle className="hg-ring hg-halo-ring" cx="226" cy="92" r="30" />
      {line('M210 91l11 12 21-26', 8)}
    </>,

    /* Who actually came: the line, with the reading head passing over it. */
    attendance: <>
      {guides([36, 74, 110])}
      {area(`${CURVE} L268 122 L14 122 Z`)}
      {line(CURVE, 0)}
      {[[14, 104], [64, 90], [104, 72], [150, 80], [186, 60], [228, 40], [268, 22]].map(([x, y], i) => dot(x, y, i))}
      <rect className="hg-scan" x="8" y="10" width="2" height="118" />
    </>,

    /* The team: each trainer a presence, with their own small record under them. */
    trainers: <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i} className="hg-bob" style={v(i)}>
          <circle className="hg-ring" cx={42 + i * 66} cy={38} r="16" />
          <circle className="hg-fill-c" cx={42 + i * 66} cy={38} r="10" />
          <path className="hg-fill" d={`M${16 + i * 66} 110V88q0-22 26-22t26 22v22Z`} />
          {bar(26 + i * 66, 118 - (10 + i * 5), 32, 10 + i * 5, i, i === 3)}
        </g>
      ))}
    </>,

    /* The cost of a late no-show: the clock that runs out, and the flag it raises. */
    'late-cancellations': <>
      <circle className="hg-ring" cx="96" cy="70" r="48" />
      <circle className="hg-ring hg-orbit" cx="96" cy="70" r="48" strokeDasharray="60 242" />
      {line('M96 34v36l24 16', 1)}
      {halo(96, 70)}
      <path className="hg-fill hg-flag" d="M212 30l40 72h-80Z" />
      {line('M212 52v24M212 84v3', 4, 'hg-warn')}
    </>,

    /* Format against format: paired bars under a comparison bracket. */
    'format-comparison': <>
      {guides([110])}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          {bar(24 + i * 84, 110 - (56 + i * 14), 26, 56 + i * 14, i)}
          {bar(56 + i * 84, 110 - (38 + i * 20), 26, 38 + i * 20, i + 3, true)}
        </g>
      ))}
      {line('M24 26h224M24 26v8M248 26v8M136 26v-14', 6, 'hg-dashed')}
    </>,

    /* The signal on the wire: nine sheets, one heartbeat. */
    health: <>
      {guides([110])}
      {line(PULSE, 0)}
      {trace(PULSE, 6)}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => bar(16 + i * 30, 118 - (6 + (i % 4) * 5), 20, 6 + (i % 4) * 5, i, i % 4 === 3))}
    </>,
  };

  return (
    <span className="hero-graphic" aria-hidden="true">
      <svg viewBox="0 0 280 140" role="presentation" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={id('area')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hue)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--hue)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id('stroke')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--hue)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--hue)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <g className="hg-art" style={{ ['--hg-stroke' as string]: `url(#${id('stroke')})` }}>{art[tab]}</g>
      </svg>
    </span>
  );
}
