import atlasLogo from '../../assets/atlas-analytics-logo-transparent.png';
import atlasLogoDark from '../../assets/atlas-analytics-logo-dark.png';

/** Transparent variants of the supplied Atlas artwork for both shell modes. */
export function Logo({ animate = true }: { animate?: boolean }) {
  return (
    <span className={`atlas-logo ${animate ? 'is-animated' : ''}`} aria-hidden="true">
      <img className="atlas-logo-art atlas-logo-art--light" src={atlasLogo} alt="" draggable={false} />
      <img className="atlas-logo-art atlas-logo-art--dark" src={atlasLogoDark} alt="" draggable={false} />
    </span>
  );
}
