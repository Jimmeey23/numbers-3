import { useId } from 'react';

/** Atlas: a rising analytical monogram with a continuously orbiting signal. */
export function Logo({ size = 32, animate = true }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <svg className={`atlas-mark ${animate ? 'is-animated' : ''}`} width={size} height={size} viewBox="0 0 40 40"
      fill="none" role="img" aria-label="Atlas" focusable="false">
      <defs>
        <linearGradient id={`${id}-g`} x1="7" y1="32" x2="32" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--hue)" /><stop offset="1" stopColor="var(--hue-growth, var(--hue))" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="var(--surface-2)" stroke={`url(#${id}-g)`} strokeOpacity=".35" />
      <path d="M11 29 20 10 29 29M15 23h10" stroke={`url(#${id}-g)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path className="atlas-signal" d="M13 29v-3m7 3v-7m7 7v-3" stroke={`url(#${id}-g)`} strokeWidth="2" strokeLinecap="round" opacity=".6" />
      <g className="atlas-orbit"><circle cx="20" cy="4" r="2" fill={`url(#${id}-g)`} /><circle cx="20" cy="4" r="4" fill="var(--hue)" opacity=".15" /></g>
    </svg>
  );
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="11" fill="#101827"/><path d="M11 29 20 10 29 29M15 23h10" fill="none" stroke="#73abff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="4" r="2" fill="#64d8b1"/></svg>`;
