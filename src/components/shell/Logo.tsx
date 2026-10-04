import { useId } from 'react';

/** Atlas: a precise A monogram with a small upward signal. */
export function Logo({ size = 32, animate = true }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <svg className={`atlas-mark ${animate ? 'is-animated' : ''}`} width={size} height={size} viewBox="0 0 40 40"
      fill="none" role="img" aria-label="Atlas" focusable="false">
      <defs>
        <linearGradient id={`${id}-mark`} x1="8" y1="32" x2="31" y2="7" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--hue-attendance)" /><stop offset="1" stopColor="var(--hue-growth)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="var(--surface-2)" stroke="var(--hairline-strong)" strokeWidth="1" />
      <path className="atlas-mark-main" d="M9.5 30.5 19.8 9.5 30.5 30.5M14.2 23.5h11.2" stroke={`url(#${id}-mark)`} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path className="atlas-mark-signal" d="M13.3 31h7.2l5.2-6.4h5.4" stroke={`url(#${id}-mark)`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="atlas-mark-point" cx="31" cy="24.6" r="2" fill="var(--hue-growth)" />
    </svg>
  );
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="11" fill="#12243e"/><path d="M9.5 30.5 19.8 9.5 30.5 30.5M14.2 23.5h11.2" fill="none" stroke="#6db5ff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.3 31h7.2l5.2-6.4h5.4" fill="none" stroke="#54d9b1" stroke-width="1.7" stroke-linecap="round"/><circle cx="31" cy="24.6" r="2" fill="#54d9b1"/></svg>`;
