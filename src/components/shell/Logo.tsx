/* Atlas — the mark.
 *
 * An atlas is a book of maps: the thing you consult to know where you are before deciding where to
 * go. The mark is a meridian globe — a circle crossed by one equator and two meridians — which
 * reads at 16px as a favicon and at 28px in the title bar, and carries the same geometry as the
 * app's own axes and rules. The meridians draw themselves in once on mount, the same gesture the
 * sparklines and chart paths use, so the brand and the data share one motion language.
 */
import { useId } from 'react';

export function Logo({ size = 26, animate = true }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <svg className={`atlas-mark ${animate ? 'is-animated' : ''}`} width={size} height={size} viewBox="0 0 32 32"
      fill="none" role="img" aria-label="Atlas" focusable="false">
      <defs>
        <linearGradient id={`${id}-g`} x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--hue)" />
          <stop offset="1" stopColor="var(--hue-growth, var(--hue))" />
        </linearGradient>
      </defs>
      {/* The sphere. A ring rather than a disc, so the mark stays legible on any surface. */}
      <circle cx="16" cy="16" r="12.4" stroke={`url(#${id}-g)`} strokeWidth="2.1" />
      {/* Equator and two meridians: the globe read as a set of axes. */}
      <path className="atlas-meridian" d="M3.6 16h24.8" stroke={`url(#${id}-g)`} strokeWidth="1.5" strokeLinecap="round" opacity=".75" />
      <path className="atlas-meridian" d="M16 3.6c4.3 4.2 4.3 20.6 0 24.8" stroke={`url(#${id}-g)`} strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
      <path className="atlas-meridian" d="M16 3.6c-4.3 4.2-4.3 20.6 0 24.8" stroke={`url(#${id}-g)`} strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
      {/* The fix: where you are on the map. */}
      <circle className="atlas-fix" cx="16" cy="16" r="2.7" fill="var(--hue)" />
    </svg>
  );
}

/** Standalone favicon markup, inlined into the document head as a data URI. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<circle cx="16" cy="16" r="12.4" fill="none" stroke="#5B8DEF" stroke-width="2.6"/>
<path d="M3.6 16h24.8" stroke="#5B8DEF" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>
<path d="M16 3.6c4.3 4.2 4.3 20.6 0 24.8" stroke="#5B8DEF" stroke-width="1.8" stroke-linecap="round" opacity=".55" fill="none"/>
<path d="M16 3.6c-4.3 4.2-4.3 20.6 0 24.8" stroke="#5B8DEF" stroke-width="1.8" stroke-linecap="round" opacity=".55" fill="none"/>
<circle cx="16" cy="16" r="3" fill="#5B8DEF"/></svg>`;
