/* A trainer's face next to their name.
 *
 * Used wherever a row is a person: the Trainers and Payroll tables, the drill panel header. Falls
 * back to initials, and to initials again if the image 404s, so a missing file never leaves a
 * blank square where a face should be.
 */
import { useState } from 'react';
import { studioThumb, trainerInitials, trainerThumb } from '../data/trainers';

export function TrainerChip({ name, size = 22 }: { name: string; size?: number }) {
  const src = trainerThumb(name);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="trainer-chip is-initials" style={{ width: size, height: size }} aria-hidden>{trainerInitials(name)}</span>;
  }
  return <img className="trainer-chip" style={{ width: size, height: size }} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** A studio photograph beside its name. Nothing is drawn for a venue with no photograph. */
export function StudioChip({ location, size = 22 }: { location: string; size?: number }) {
  const src = studioThumb(location);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className="trainer-chip is-studio" style={{ width: size, height: size }} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
