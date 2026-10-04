/* Trainer thumbnails.
 *
 * The portraits come from the reference app (physique57-analytics-hub, public/images), resized to
 * 128px JPEGs — 25 files, 115 KB in total, served from public/trainers/ rather than inlined, so
 * the bundle stays the size it was.
 *
 * Matching is on the full name only. The reference app falls back to a first-name match, which on
 * this roster would put Shruti Kulkarni's face next to Shruti Suresh; a wrong face on a
 * performance table is worse than no face, so an unmatched trainer gets initials instead.
 */

const normalise = (v: string) => v.toLowerCase().replace(/[’']/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Full name, as the Payroll and Sessions sheets write it → file in public/trainers. */
const THUMBS: Record<string, string> = {
  'anisha shah': 'anisha.jpg',
  'atulan purohit': 'atulan.jpg',
  'anmol sharma': 'anmol.jpg',
  'bret saldanha': 'bret.jpg',
  'cauveri vikrant': 'cauveri.jpg',
  'janhavi jain': 'janhavi.jpg',
  'kabir varma': 'kabir.jpg',
  'kajol kanchan': 'kajol-kanchan.jpg',
  'karan bhatia': 'karan-bhatia.jpg',
  'mrigakshi jaiswal': 'mrigakshi.jpg',
  'nishanth raj': 'nishanth.jpg',
  'pranjali jain': 'pranjali.jpg',
  'pushyank nahar': 'pushyank-nahar.jpg',
  'raunak khemuka': 'raunak.jpg',
  'reshma sharma': 'reshma.jpg',
  'richard dcosta': 'richard.jpg',
  'rohan dahima': 'rohan.jpg',
  'saniya jaiswal': 'saniya.jpg',
  'shruti kulkarni': 'shruti-kulkarni.jpg',
  'simonelle de vitre': 'simonelle.jpg',
  'simran dutt': 'simran.jpg',
  'sovena shetty': 'sovena.jpg',
  'upasna paranjpe': 'upasna.jpg',
  'veena narasimhan': 'veena.jpg',
  'vivaran dhasmana': 'vivaran.jpg',
};

/* Spellings the sheets use for someone already in the map. Karanvir Bhatia is deliberately absent:
   the reference app aliases it to Karan Bhatia, but both names teach in the same months with
   comparable volume, so they may be two people. Until that is confirmed, Karanvir gets initials. */
const ALIASES: Record<string, string> = {
  'richard d costa': 'richard dcosta',
  'richard dsouza': 'richard dcosta',
  'upasana paranjpe': 'upasna paranjpe',
  'simonelle devitre': 'simonelle de vitre',
};

/** Path to a trainer's thumbnail, or null when there is no confident match. */
export function trainerThumb(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = normalise(name);
  const file = THUMBS[key] ?? THUMBS[ALIASES[key] ?? ''];
  return file ? `/trainers/${file}` : null;
}

/** Two letters for the fallback chip. */
export function trainerInitials(name: string | null | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

/** Trainers in the roster that have a portrait, for the Data health coverage note. */
export const TRAINERS_WITH_THUMBS = Object.keys(THUMBS).length;

/* Studio photographs, same treatment: 256px JPEGs in public/studios. Only the three permanent
   studios have one — pop-ups and host venues deliberately do not. */
const STUDIOS: Record<string, string> = {
  'kwality house kemps corner': 'kwality-house.jpg',
  'supreme hq bandra': 'supreme-hq.jpg',
  'kenkere house': 'kenkere-house.jpg',
};

/** Path to a studio photograph, or null for a venue that has none. */
export function studioThumb(location: string | null | undefined): string | null {
  if (!location) return null;
  const file = STUDIOS[normalise(location)];
  return file ? `/studios/${file}` : null;
}
