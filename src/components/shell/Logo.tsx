import { useId } from 'react';

/** Atlas: an aperture of four blades around a rising signal. The mark reads at 24px
    and still holds its geometry at 64. */
export function Logo({ size = 34, animate = true }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <svg className={`atlas-mark ${animate ? 'is-animated' : ''}`} width={size} height={size} viewBox="0 0 40 40"
      fill="none" role="img" aria-label="Atlas" focusable="false">
      <defs>
        <linearGradient id={`${id}-a`} x1="4" y1="36" x2="36" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--hue-attendance)" />
          <stop offset=".55" stopColor="var(--hue-people)" />
          <stop offset="1" stopColor="var(--hue-growth)" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="8" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--surface-3)" />
          <stop offset="1" stopColor="var(--surface-1)" />
        </linearGradient>
      </defs>

      <rect x="1.5" y="1.5" width="37" height="37" rx="12" fill={`url(#${id}-b)`} stroke="var(--hairline-strong)" strokeWidth="1" />

      {/* aperture blades */}
      <g opacity=".5" stroke={`url(#${id}-a)`} strokeWidth="1.5" strokeLinecap="round">
        <path className="atlas-mark-blade" d="M20 7.5A12.5 12.5 0 0 1 31.6 15" />
        <path className="atlas-mark-blade" d="M32.5 20A12.5 12.5 0 0 1 25 31.6" />
        <path className="atlas-mark-blade" d="M20 32.5A12.5 12.5 0 0 1 8.4 25" />
        <path className="atlas-mark-blade" d="M7.5 20A12.5 12.5 0 0 1 15 8.4" />
      </g>

      {/* the signal: a rising line that resolves into a point */}
      <path className="atlas-mark-main" d="M12 25.5 17.5 19.5 22.5 23 28.5 14.5"
        stroke={`url(#${id}-a)`} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="atlas-mark-signal" d="M12 29.5h16.5"
        stroke={`url(#${id}-a)`} strokeWidth="1.6" strokeLinecap="round" opacity=".65" />
      <circle className="atlas-mark-point" cx="28.5" cy="14.5" r="2.4" fill="var(--hue-growth)" />
    </svg>
  );
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="1.5" y="1.5" width="37" height="37" rx="12" fill="#0D0E12"/><path d="M12 25.5 17.5 19.5 22.5 23 28.5 14.5" fill="none" stroke="#38BDF8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 29.5h16.5" stroke="#A78BFA" stroke-width="1.6" stroke-linecap="round" opacity=".65"/><circle cx="28.5" cy="14.5" r="2.4" fill="#34D399"/></svg>`;
