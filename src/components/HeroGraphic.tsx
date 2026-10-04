import type { ReactNode } from 'react';
import type { TabId } from '../state/view';

/** Animated, illustrative motifs. The shapes never encode measured values. */
export function HeroGraphic({ tab }: { tab: TabId }) {
  const grid = <path className="hg-guide" d="M8 20H232M8 50H232M8 80H232" />;
  const bars = (v: number[]) => v.map((h, i) => <rect key={i} className="hg-bar" x={15 + 28 * i} y={88 - h} width="17" height={h} rx="4" style={{ animationDelay: `${i * 90}ms` }} />);
  const points = (p: [number, number][]) => p.map(([x, y], i) => <circle key={i} className="hg-point" cx={x} cy={y} r="4" style={{ animationDelay: `${i * -250}ms` }} />);
  const art: Record<TabId, ReactNode> = {
    overview: <>{grid}{bars([20, 29, 25, 46, 40, 61, 51, 68])}<path className="hg-line" d="M15 69L45 62L73 66L101 44L129 50L157 31L185 39L225 18" /></>,
    sales: <>{grid}{bars([24, 36, 31, 50, 44, 63, 58, 76])}<path className="hg-line" d="M8 70Q65 68 105 51T232 19" /></>,
    leads: <>
      <path className="hg-guide" d="M12 81H228" />
      {[{ x: 15, y: 18, w: 45 }, { x: 72, y: 30, w: 40 }, { x: 123, y: 41, w: 35 }, { x: 169, y: 50, w: 29 }].map((s, i) =>
        <g key={i}><rect className="hg-tile" x={s.x} y={s.y} width={s.w} height={64 - i * 9} rx="7" />
          <path className="hg-guide" d={`M${s.x + 8} ${s.y + 13}h${s.w - 16}M${s.x + 8} ${s.y + 23}h${s.w - 23}`} /></g>)}
      <path className="hg-line" d="M22 70C54 69 63 60 85 61S128 59 140 62S180 65 215 54" />
      <circle className="hg-ring" cx="215" cy="54" r="15" />{points([[215,54]])}
    </>,
    acquisition: <>{[0, 1, 2, 3].map(i => <path key={i} className="hg-fill" d={`M${12 + i * 53} ${16 + i * 10}h${51 - i * 6}l-10 ${68 - i * 13}h-${31 - i * 2}Z`}/>)}<path className="hg-line" d="M23 25L76 37L129 48L182 61L224 73"/></>,
    retention: <><circle className="hg-ring hg-spin" cx="120" cy="49" r="39" strokeDasharray="180 65"/><circle className="hg-ring" cx="120" cy="49" r="24"/><path className="hg-line" d="M120 25V49L138 61"/>{points([[120,49]])}</>,
    classes: <>{[0,1,2,3,4,5].map(i => <g key={i}><rect className="hg-tile" x={17+i*37} y={18+(i%2)*9} width="29" height="60" rx="6"/><rect className="hg-bar" x={23+i*37} y={68-(i%3)*10} width="17" height={10+(i%3)*10} rx="3"/></g>)}</>,
    slots: <>{[0,1,2].flatMap(r => [0,1,2,3,4,5].map(c => <rect key={`${r}-${c}`} className={`hg-tile ${(r+c)%3===0?'hg-strong':''}`} x={13+c*37} y={10+r*29} width="30" height="23" rx="5"/>))}</>,
    bookings: <>
      <rect className="hg-tile" x="35" y="9" width="145" height="82" rx="10" />
      <path className="hg-line" d="M35 30H180M62 5V18M151 5V18" />
      {[0,1,2,3].flatMap(r => [0,1,2,3,4].map(c =>
        <rect key={`${r}-${c}`} className={`hg-tile ${(r+c)%4===0?'hg-strong':''}`} x={49+c*24} y={39+r*12} width="15" height="7" rx="3" />))}
      <circle className="hg-ring" cx="186" cy="68" r="24" />
      <path className="hg-line" d="M174 67l9 9 17-20" />
    </>,
    attendance: <>{grid}<path className="hg-line" d="M18 67L48 54L78 62L108 35L138 43L170 28L213 19"/>{points([[18,67],[48,54],[78,62],[108,35],[138,43],[170,28],[213,19]])}</>,
    trainers: <>{[0,1,2,3].map(i => <g key={i}><circle className="hg-ring" cx={34+i*56} cy="27" r="12"/><path className="hg-fill" d={`M${14+i*56} 83V65q0-18 20-18t20 18v18Z`}/><path className="hg-line" d={`M${19+i*56} ${91-i*7}h30`}/></g>)}</>,
    payroll: <>{grid}{bars([28,43,53,46,68,62,77,73])}<path className="hg-line" d="M15 75L43 67L71 60L99 64L127 48L155 52L183 33L213 37"/></>,
    'late-cancellations': <><circle className="hg-ring" cx="107" cy="49" r="38"/><path className="hg-line" d="M107 23V49L129 62"/><path className="hg-tile" d="M182 16l25 45h-50Z"/><path className="hg-line" d="M182 32v13M182 51v2"/></>,
    'format-comparison': <>{[0,1,2].map(i => <g key={i}><rect className="hg-bar" x={18+i*75} y={24+i*12} width="23" height={65-i*12} rx="5"/><rect className="hg-tile" x={46+i*75} y={51-i*10} width="18" height={38+i*10} rx="4"/></g>)}</>,
    health: <>{grid}<path className="hg-line" d="M8 50H46l15-24 21 48 24-36 16 12h29l16-22 18 22h45"/>{points([[46,50],[122,50],[185,50]])}</>,
  };
  return <span className="hero-graphic" aria-hidden="true"><svg viewBox="0 0 240 100" role="presentation">{art[tab]}</svg></span>;
}
