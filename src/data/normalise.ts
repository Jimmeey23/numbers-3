/* Every rule from §1.3, plus per-sheet mappers into the internal snake_case model. */
import type {
  BookingRow, CheckinRow, Format, VisitRow, LapsedRow, LeadRow, NewRow, PayrollRow, SaleRow, SessionRow, TimeSlot,
} from './types';
import { LOCATION_SHORT } from './sheets.config';

type Raw = Record<string, string>;

/* String interning. Across 460k rows the categorical columns (location, trainer, class, product,
   method, status) hold a few hundred distinct values but Papa allocates a fresh string per cell.
   Interning collapses those to one instance each and cuts retained heap by roughly half. */
const POOL = new Map<string, string>();
export const intern = (v: string | null): string | null => {
  if (v === null) return null;
  const hit = POOL.get(v);
  if (hit !== undefined) return hit;
  POOL.set(v, v);
  return v;
};
export const resetPool = () => { POOL.clear(); ISO_CACHE.clear(); DMY_CACHE.clear(); LOC_CACHE.clear(); FMT_CACHE.clear(); MEM_CACHE.clear(); NAME_CACHE.clear(); };

/** trim + intern, for repeated categorical columns. */
const catv = (v: unknown): string | null => intern(trim(v));

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

export const trim = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '-') return null;         // null sentinel and empty → NULL, never 0
  return s;
};

export const num = (v: unknown): number | null => {
  const s = trim(v);
  if (s === null) return null;
  const cleaned = s.replace(/[₹,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export const money = num;

/** Percent → 0–1. `45.16%` → .4516; bare `50` in a %-named column → .5 */
export const pct = (v: unknown, bareIsPercent = true): number | null => {
  const s = trim(v);
  if (s === null) return null;
  if (s.includes('%')) { const n = num(s.replace('%', '')); return n === null ? null : n / 100; }
  const n = num(s);
  if (n === null) return null;
  return bareIsPercent ? n / 100 : n;
};

export const bool = (v: unknown): boolean => {
  const s = trim(v);
  return s !== null && /^(true|yes|1)$/i.test(s);
};

const pad = (n: number) => String(n).padStart(2, '0');

/* Date results are cached on the raw cell text. A 211k-row sheet holds only ~25k distinct
   timestamps, so every row after the first shares one immutable {date, ts} and one date string
   instead of allocating a fresh pair. This is the single largest memory saving in ingest. */
type DateHit = { date: string; ts: number } | null;
const ISO_CACHE = new Map<string, DateHit>();
const DMY_CACHE = new Map<string, DateHit>();
const CACHE_CAP = 120000;

/** ISO forms: `2026-08-30 17:19:13`, `2024-01-17 00:00`, `2026-09-01, 19:04:40`, `2026-09-20` */
export const dateISO = (v: unknown): DateHit => {
  const s = trim(v);
  if (s === null) return null;
  const hit = ISO_CACHE.get(s);
  if (hit !== undefined) return hit;
  const out = parseISO(s);
  if (ISO_CACHE.size < CACHE_CAP) ISO_CACHE.set(s, out);
  return out;
};
const parseISO = (s: string): DateHit => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  const ts = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (!Number.isFinite(ts)) return null;
  return { date: intern(`${y}-${mo}-${d}`)!, ts };
};

/** DD/MM/YYYY HH:MM:SS (Lapsed). Never let a Date constructor guess. */
export const dateDMY = (v: unknown): DateHit => {
  const s = trim(v);
  if (s === null) return null;
  const hit = DMY_CACHE.get(s);
  if (hit !== undefined) return hit;
  const out = parseDMY(s);
  if (DMY_CACHE.size < CACHE_CAP) DMY_CACHE.set(s, out);
  return out;
};
const parseDMY = (s: string): DateHit => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return dateISO(s);
  const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
  const ts = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  return { date: intern(`${y}-${pad(+mo)}-${pad(+d)}`)!, ts };
};

/** `Feb-2024`, `January 2024`, `Jan-2020`, `January-2020`, `2024-02` → `2024-02` */
export const monthLabel = (v: unknown): string | null => {
  const s = trim(v);
  if (s === null) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const m = s.match(/^([A-Za-z]+)[\s-]+(\d{4})$/);
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (idx < 0) return null;
  return `${m[2]}-${pad(idx + 1)}`;
};

export const monthOf = (date: string | null) => (date ? intern(date.slice(0, 7)) : null);

export const isoWeek = (date: string | null): string | null => {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;            // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return intern(d.toISOString().slice(0, 10));    // week start (Monday)
};

export const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const dayOf = (date: string | null): string | null => {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z');
  return DAYS[(d.getUTCDay() + 6) % 7];
};

export const timeHM = (v: unknown): string | null => {
  const s = trim(v);
  if (s === null) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? intern(`${pad(+m[1])}:${m[2]}`) : null;
};

export const slotOf = (time: string | null): TimeSlot | null => {
  if (!time) return null;
  const h = +time.slice(0, 2);
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
};

export const PLACEHOLDER_EMAIL = /^noemail\+?\d*@|^no-?email|@example\.|^test@/i;
export const contactable = (email: string | null, phone?: string | null) =>
  !!(email && !PLACEHOLDER_EMAIL.test(email)) || !!(phone && phone.replace(/\D/g, '').length >= 10);

/* Person names arrive with double spaces and inconsistent case across sheets — four of 32 trainers
   failed the Payroll join on whitespace alone. One normaliser, applied everywhere a person is named. */
const NAME_CACHE = new Map<string, string>();
export const personName = (v: unknown): string | null => {
  const raw = trim(v);
  if (!raw) return null;
  const hit = NAME_CACHE.get(raw);
  if (hit !== undefined) return hit;
  const out = intern(raw.replace(/\s+/g, ' ').trim())!;
  NAME_CACHE.set(raw, out);
  return out;
};

const LOC_CACHE = new Map<string, string>();
export const canonLocation = (v: unknown): string | null => {
  const raw = trim(v);
  if (!raw) return null;
  const hit = LOC_CACHE.get(raw);
  if (hit !== undefined) return hit;
  const out = intern(raw.replace(/\s+/g, ' '))!;
  LOC_CACHE.set(raw, out);
  return out;
};
export const shortLocation = (loc: string | null) => (loc ? LOCATION_SHORT[loc] ?? loc.split(',')[0] : null);

const FMT_CACHE = new Map<string, Format>();
export const formatOf = (cls: unknown): Format => {
  const key = trim(cls) ?? '';
  const hit = FMT_CACHE.get(key);
  if (hit !== undefined) return hit;
  const out = computeFormat(key);
  FMT_CACHE.set(key, out);
  return out;
};
const computeFormat = (raw: string): Format => {
  const s = raw.toLowerCase();
  if (!s || s === 'unknown class') return 'Unknown';
  if (s.includes('cycle')) return 'Cycle';
  if (s.includes('barre')) return 'Barre 57';
  if (/(strength|fit\b|amped|blaze|hiit|sweat|foundations)/.test(s)) return 'Strength';
  if (/(mat|pilates|recovery|reformer)/.test(s)) return 'Pilates';
  if (s.includes('hosted')) return 'Hosted';
  return 'Other';
};

const MEM_CACHE = new Map<string, string>();
export const membershipTypeOf = (name: unknown): string => {
  const key = trim(name) ?? '';
  const hit = MEM_CACHE.get(key);
  if (hit !== undefined) return hit;
  const out = intern(computeMemType(key))!;
  MEM_CACHE.set(key, out);
  return out;
};
const computeMemType = (raw: string): string => {
  const s = raw.toLowerCase();
  if (!s) return 'Unknown';
  if (/unlimited|month|annual|year/.test(s)) return 'Unlimited';
  if (/(\d+)\s*class|package|pack/.test(s)) return 'Class package';
  if (/single|session|drop/.test(s)) return 'Single class';
  if (/newcomer|2 for 1|intro|trial/.test(s)) return 'Newcomer';
  if (/complimentary|staff|family|referral|open barre|free|promo/.test(s)) return 'Complimentary';
  if (/private/.test(s)) return 'Private';
  if (/credit|gift/.test(s)) return 'Credit';
  return 'Other';
};

const isImportRow = (r: Raw) =>
  /import visits/i.test(r['Sale Item'] ?? r['First Visit Entity Name'] ?? '') ||
  /^imported$/i.test(r['Payment Method'] ?? '');



/* ---------- Checkins ---------- */
/* Identity of a class occurrence.
   UniqueID1|UniqueID2 looks like a shared key but is NOT: measured across Sep 2026, only 6 of 339
   booking slot ids appear in Checkins, while date+time+member matches 100%. The pairs are
   generated per sheet. A class occurrence is therefore identified by when and where it ran. */
export const sessionKeyOf = (date: string | null, time: string | null, location: string | null, cls: string | null): string | null =>
  date && time ? intern(`${date}|${time}|${location ?? '?'}|${cls ?? '?'}`) : null;

export const DURATION_SERIAL_DEFAULT = 55;
export interface CheckinStats { corrupted: number }

export function mapCheckinRow(r: Raw, stats: CheckinStats): CheckinRow {
  const dt = dateISO(r['Date (IST)']);
  const date = dt?.date ?? null; const ts = dt?.ts ?? null;
  const location = canonLocation(r['Location']);
  const className = catv(r['Cleaned Class']);
  const time = timeHM(r['Time']);
  const isNewLabel = catv(r['Is New']);
  const durRaw = trim(r['Duration (Minutes)']);
  let duration: number | null = null;
  if (durRaw && /^\d{4}-\d{2}-\d{2}/.test(durRaw)) stats.corrupted++; else duration = num(durRaw);
  const order = dateISO(r['Order At']);
  const email = intern(trim(r['Email']));
  const sessionTs = ts !== null && time ? ts + (+time.slice(0, 2)) * 3.6e6 + (+time.slice(3, 5)) * 6e4 : ts;
  const first = trim(r['First Name']); const last = trim(r['Last Name']);
  const u1 = trim(r['UniqueID1']); const u2 = trim(r['UniqueID2']);
  // One flat literal, one hidden class. Object.assign onto a partial object puts V8 into
  // dictionary mode, which costs ~2.9 kB per row instead of ~400 bytes at this row count.
  return {
    date, ts, month: monthOf(date) ?? monthLabel(r['Month Year']),
    location, location_short: shortLocation(location),
    trainer: personName(r['Teacher Name']),
    format: formatOf(className ?? r['Session Name']),
    day: catv(r['Day of Week']) ?? dayOf(date),
    slot: slotOf(time),
    source: null,
    membership_type: membershipTypeOf(r['Cleaned Product'] ?? r['Payment Method Name']),
    is_new: isNewLabel ? /^new/i.test(isNewLabel) : null,
    is_import: false,
    member_id: intern(trim(r['Member ID'])),
    name: first || last ? `${first ?? ''}${first && last ? ' ' : ''}${last ?? ''}` : null,
    email, contactable: contactable(email),
    order_ts: order?.ts ?? null,
    paid: money(r['Paid']),
    payment_method: catv(r['Payment Method Name']),
    checked_in: bool(r['Checked In']),
    complimentary: bool(r['Complementary']),
    late_cancelled: bool(r['Is Late Cancelled']),
    session_id: intern(trim(r['Session ID'])),
    session_name: catv(r['Session Name']),
    capacity: num(r['Capacity']),
    time: intern(time),
    duration_min: duration,
    product: catv(r['Cleaned Product']),
    category: catv(r['Cleaned Category']),
    class_name: className,
    class_no: num(r['Class No']),
    is_new_label: isNewLabel,
    lead_time_days: order && sessionTs !== null ? Math.max(0, (sessionTs - order.ts) / 864e5) : null,
    slot_uid: u1 && u2 ? `${u1}|${u2}` : null,
    session_key: sessionKeyOf(date, time, location, className),
  };
}
export function mapCheckins(raw: Raw[]): { rows: CheckinRow[]; corruptedDurations: number } {
  const stats: CheckinStats = { corrupted: 0 };
  const rows = raw.map((r) => mapCheckinRow(r, stats));
  return { rows, corruptedDurations: stats.corrupted };
}

/* ---------- Sessions (true schema) ---------- */
export function mapSessionRow(r: Raw): SessionRow {
    const dt = dateISO(r['Date']);
  const location = canonLocation(r['Location']);
  const time = timeHM(r['Time']);
  const date = dt?.date ?? null;
  const ts = dt?.ts ?? null;
    return {
    date,
    ts,
    month: monthOf(date),
    location: location,
    location_short: shortLocation(location),
    trainer: personName(r['Trainer']),
    format: formatOf(r['Class'] ?? r['Type']),
    day: trim(r['Day']) ?? dayOf(date),
    slot: slotOf(time),
    source: null,
    membership_type: null,
    is_new: null,
    is_import: false,
      trainer_id: num(r['TrainerID']),
      session_id: trim(r['SessionID']) ?? `${r['UniqueID1']}-${r['UniqueID2']}`,
      session_name: trim(r['SessionName']),
      capacity: num(r['Capacity']), checked_in: num(r['CheckedIn']), late_cancelled: num(r['LateCancelled']),
      booked: num(r['Booked']), complimentary: num(r['Complimentary']), time,
      revenue: money(r['Revenue']), non_paid: num(r['NonPaid']),
      memberships: num(r['Memberships']), packages: num(r['Packages']), intro_offers: num(r['IntroOffers']), single_classes: num(r['SingleClasses']),
      type: trim(r['Type']), class_name: trim(r['Class']),
      duration_min: null, duration_estimated: true, derived: false, week: isoWeek(date),
      };
}
export const mapSessions = (raw: Raw[]): SessionRow[] => raw.map((r) => mapSessionRow(r));


/* ---------- Sessions derived from Checkins (one row per Session ID) ----------
   Checkins holds a real Capacity per session, so fill rate is measured, not estimated.
   Bookings, when present, contributes the cancellations that never reach a check-in row. */
export function deriveSessions(checkins: CheckinRow[], bookings?: BookingRow[]): SessionRow[] {
  const map = new Map<string, SessionRow>();
  for (const c of checkins) {
    const id = c.session_id ?? c.session_key ?? `${c.date}|${c.time}|${c.trainer}|${c.location}`;
    let s = map.get(id);
    if (!s) {
      s = {
        date: c.date, ts: c.ts, month: c.month, location: c.location, location_short: c.location_short,
        trainer: c.trainer, format: c.format, day: c.day, slot: c.slot, source: null, membership_type: null,
        is_new: null, is_import: false,
        trainer_id: null, session_id: id, session_name: c.session_name, capacity: c.capacity,
        checked_in: 0, late_cancelled: 0, booked: 0, complimentary: 0, time: c.time, revenue: 0, non_paid: 0,
        memberships: 0, packages: 0, intro_offers: 0, single_classes: 0, type: c.category, class_name: c.class_name,
        duration_min: c.duration_min, duration_estimated: c.duration_min === null, derived: true, week: isoWeek(c.date),
        capacity_estimated: c.capacity === null,
      };
      map.set(id, s);
    }
    s.booked = (s.booked ?? 0) + 1;
    if (c.late_cancelled) s.late_cancelled = (s.late_cancelled ?? 0) + 1;
    if (c.checked_in) {
      s.checked_in = (s.checked_in ?? 0) + 1;
      s.revenue = (s.revenue ?? 0) + (c.paid ?? 0);
      if (!c.paid) s.non_paid = (s.non_paid ?? 0) + 1;
      if (c.complimentary) s.complimentary = (s.complimentary ?? 0) + 1;
      const mt = c.membership_type;
      if (mt === 'Unlimited') s.memberships = (s.memberships ?? 0) + 1;
      else if (mt === 'Class package') s.packages = (s.packages ?? 0) + 1;
      else if (mt === 'Newcomer') s.intro_offers = (s.intro_offers ?? 0) + 1;
      else if (mt === 'Single class') s.single_classes = (s.single_classes ?? 0) + 1;
    }
    if ((c.capacity ?? 0) > (s.capacity ?? 0)) s.capacity = c.capacity;
  }
  // Fold in bookings that were cancelled before the class, which never produce a check-in row.
  if (bookings) {
    const byOccurrence = new Map<string, SessionRow>();
    for (const s of map.values()) {
      const k = sessionKeyOf(s.date, s.time, s.location, s.class_name);
      if (k) byOccurrence.set(k, s);
    }
    for (const b of bookings) {
      if (!b.cancelled || b.late_cancelled) continue;
      const s = b.session_key ? byOccurrence.get(b.session_key) : undefined;
      if (s) s.booked = (s.booked ?? 0) + 1;
    }
  }
  return [...map.values()];
}

/* ---------- THE canonical visit grain ---------- */
/** One row per (session occurrence × member), reconciling Checkins and Bookings.
 *  Checkins wins on attendance because Bookings demonstrably misses rows; Bookings contributes the
 *  booking lifecycle — cancellations made before the class never reach a check-in row at all. */
export function buildVisits(checkins: CheckinRow[], bookings: BookingRow[]): VisitRow[] {
  const out: VisitRow[] = [];
  const index = new Map<string, VisitRow>();
  /* A member cannot be in two classes at the same minute, so date+time+member identifies a visit
     uniquely and — unlike the sheet-local UniqueIDs — matches across both sources. */
  const key = (date: string | null, time: string | null, member: string | null) =>
    member ? `${date ?? '?'}|${time ?? '?'}|${member}` : null;

  for (const c of checkins) {
    /* Rows carrying no member id cannot be deduplicated or matched — collapsing them would
       silently delete attendance, so each is kept as its own unresolved visit. */
    const k = key(c.date, c.time, c.member_id);
    if (k !== null && index.has(k)) continue;       // genuine duplicate check-in row
    const v: VisitRow = {
      date: c.date, ts: c.ts, month: c.month, location: c.location, location_short: c.location_short,
      trainer: c.trainer, format: c.format, day: c.day, slot: c.slot, source: null,
      membership_type: c.membership_type, is_new: c.is_new, is_import: false,
      session_key: c.session_key, session_id: c.session_id, slot_uid: c.slot_uid,
      member_id: c.member_id, member_name: c.name, email: c.email, time: c.time,
      class_name: c.class_name, capacity: c.capacity,
      attended: c.checked_in, late_cancelled: c.late_cancelled, cancelled: false,
      no_show: !c.checked_in && !c.late_cancelled, complimentary: c.complimentary,
      paid: c.paid, product: c.product, category: c.category, class_no: c.class_no,
      is_new_label: c.is_new_label, lead_time_days: c.lead_time_days, booked_ts: c.order_ts,
      in_checkins: true, in_bookings: false, duration_min: c.duration_min,
    };
    if (k !== null) index.set(k, v);
    out.push(v);
  }

  for (const b of bookings) {
    if (b.derived) continue;                        // derived from checkins — nothing new to add
    const k = key(b.date, b.time, b.member_id);
    const hit = k === null ? undefined : index.get(k);
    if (hit) {
      hit.in_bookings = true;
      hit.cancelled = b.cancelled;                  // only Bookings knows about pre-class cancellations
      if (hit.session_key === null) hit.session_key = b.session_key;
      if (hit.slot_uid === null) hit.slot_uid = b.slot_uid;
      if (b.lead_time_days !== null) hit.lead_time_days = b.lead_time_days;
      if (b.sale_ts !== null) hit.booked_ts = b.sale_ts;
      continue;
    }
    // A booking with no check-in row: a cancellation, or a session Checkins does not cover.
    const v: VisitRow = {
      date: b.date, ts: b.ts, month: b.month, location: b.location, location_short: b.location_short,
      trainer: b.trainer, format: b.format, day: b.day, slot: b.slot, source: null,
      membership_type: b.membership_type, is_new: b.is_new, is_import: b.is_import,
      session_key: b.session_key, session_id: null, slot_uid: b.slot_uid,
      member_id: b.member_id, member_name: b.customer, email: b.email, time: b.time,
      class_name: b.class_name, capacity: null,
      attended: b.attended, late_cancelled: b.late_cancelled, cancelled: b.cancelled,
      no_show: b.no_show, complimentary: false,
      paid: b.value, product: b.sale_item, category: null, class_no: b.class_no,
      is_new_label: b.is_new_label, lead_time_days: b.lead_time_days, booked_ts: b.sale_ts,
      in_checkins: false, in_bookings: true, duration_min: null,
    };
    if (k !== null) index.set(k, v);
    out.push(v);
  }
  return out;
}

/* ---------- Bookings derived from Checkins (one row per booking) ---------- */
export function deriveBookings(checkins: CheckinRow[]): BookingRow[] {
  return checkins.map((c) => ({
    date: c.date, ts: c.ts, month: c.month, location: c.location, location_short: c.location_short,
    trainer: c.trainer, format: c.format, day: c.day, slot: c.slot, source: null, membership_type: c.membership_type,
    is_new: c.is_new, is_import: false,
    member_id: c.member_id, customer: c.name, email: c.email, sale_ts: c.order_ts, session_ts: c.ts,
    value: c.paid, sale_item: c.product, sale_id: null, payment_method: c.payment_method, membership_used: c.payment_method,
    refunded: false, cancelled: false, late_cancelled: c.late_cancelled,
    no_show: !c.checked_in && !c.late_cancelled, attended: c.checked_in,
    teacher: c.trainer, class_name: c.class_name, class_no: c.class_no, is_new_label: c.is_new_label,
    time: c.time, lead_time_days: c.lead_time_days, derived: true, slot_uid: c.slot_uid, session_key: c.session_key,
  }));
}

export function mapBookingRow(r: Raw, names?: Map<string, string>): BookingRow {
  const sess = dateISO(r['Session Date']); const sale = dateISO(r['Sale Date']);
  const date = sess?.date ?? null; const ts = sess?.ts ?? null;
  const location = canonLocation(r['Location Name']);
  const trainer = personName(r['Teacher Name']);
  const className = catv(r['Cleaned Class']);
  const isNewLabel = catv(r['Is New']);
  const membershipUsed = catv(r['Membership Used']);
  const saleItem = catv(r['Sale Item']);
  const memberId = intern(trim(r['Member Id']));
  // The sheet has no separate time column; time of day comes off the Session Date timestamp.
  const time = sess ? intern(`${pad(new Date(sess.ts).getUTCHours())}:${pad(new Date(sess.ts).getUTCMinutes())}`) : null;
  const u1 = trim(r['UniqueID1']); const u2 = trim(r['UniqueID2']);
  return {
    date, ts, month: monthOf(date),
    location, location_short: shortLocation(location),
    trainer, format: formatOf(className),
    day: catv(r['Day Of Week']) ?? dayOf(date),
    slot: (catv(r['Time Slot']) as TimeSlot | null) ?? slotOf(time),
    source: null,
    membership_type: membershipTypeOf(membershipUsed ?? saleItem),
    is_new: isNewLabel ? /^new/i.test(isNewLabel) : null,
    is_import: isImportRow(r),
    member_id: memberId,
    customer: (memberId && names?.get(memberId)) ?? personName(r['Customer Name']) ?? null,
    email: intern(trim(r['Customer Email'])),
    sale_ts: sale?.ts ?? null, session_ts: ts, value: money(r['Sale Value']), sale_item: saleItem,
    sale_id: trim(r['Sale Id']), payment_method: catv(r['Payment Method']), membership_used: membershipUsed,
    refunded: bool(r['Refunded']), cancelled: bool(r['Cancelled']), late_cancelled: bool(r['Late Cancelled']),
    no_show: bool(r['No Show']), attended: bool(r['Attended']), teacher: trainer, class_name: className,
    class_no: num(r['Class No']), is_new_label: isNewLabel, time,
    lead_time_days: sess && sale ? (sess.ts - sale.ts) / 864e5 : null, derived: false,
    slot_uid: u1 && u2 ? `${u1}|${u2}` : null,
    session_key: sessionKeyOf(date, time, location, className),
  };
}
export const mapBookings = (raw: Raw[], names?: Map<string, string>): BookingRow[] => raw.map((r) => mapBookingRow(r, names));

/** Session grain rebuilt from Bookings when the Sessions sheet is private.
 *  Bookings has no Capacity column, so capacity is taken from the matching Checkins session
 *  (joined on UniqueID1+UniqueID2) and otherwise from the modal capacity for that location+class. */
export function deriveSessionsFromBookings(bookings: BookingRow[], checkins: CheckinRow[]): SessionRow[] {
  const capByUid = new Map<string, number>();
  const capProfile = new Map<string, Map<number, number>>();
  for (const c of checkins) {
    if (c.capacity === null) continue;
    if (c.slot_uid) capByUid.set(c.slot_uid, Math.max(capByUid.get(c.slot_uid) ?? 0, c.capacity));
    const k = `${c.location}|${c.class_name}`;
    let m = capProfile.get(k); if (!m) { m = new Map(); capProfile.set(k, m); }
    m.set(c.capacity, (m.get(c.capacity) ?? 0) + 1);
  }
  const modal = new Map<string, number>();
  for (const [k, m] of capProfile) { let best = 0; let n = -1; for (const [cap, c] of m) if (c > n) { n = c; best = cap; } modal.set(k, best); }

  const map = new Map<string, SessionRow>();
  for (const b of bookings) {
    if (!b.date) continue;
    const id = b.session_key ?? `${b.date}|${b.time}|${b.trainer}|${b.location}|${b.class_name}`;
    let s = map.get(id);
    if (!s) {
      const cap = (b.slot_uid ? capByUid.get(b.slot_uid) : undefined) ?? modal.get(`${b.location}|${b.class_name}`) ?? null;
      s = {
        date: b.date, ts: b.ts, month: b.month, location: b.location, location_short: b.location_short,
        trainer: b.trainer, format: b.format, day: b.day, slot: b.slot, source: null, membership_type: null,
        is_new: null, is_import: b.is_import,
        trainer_id: null, session_id: id, session_name: b.class_name, capacity: cap,
        checked_in: 0, late_cancelled: 0, booked: 0, complimentary: 0, time: b.time, revenue: 0, non_paid: 0,
        memberships: 0, packages: 0, intro_offers: 0, single_classes: 0, type: b.class_name, class_name: b.class_name,
        duration_min: null, duration_estimated: true, derived: true, week: isoWeek(b.date),
        capacity_estimated: !(b.slot_uid && capByUid.has(b.slot_uid)),
      };
      map.set(id, s);
    }
    if (b.cancelled && !b.late_cancelled) continue;      // cancelled well ahead: never occupied a seat
    s.booked = (s.booked ?? 0) + 1;
    if (b.late_cancelled) s.late_cancelled = (s.late_cancelled ?? 0) + 1;
    if (b.attended) {
      s.checked_in = (s.checked_in ?? 0) + 1;
      const v = b.is_import ? 0 : b.value ?? 0;
      s.revenue = (s.revenue ?? 0) + v;
      if (!v) s.non_paid = (s.non_paid ?? 0) + 1;
      const mt = b.membership_type;
      if (mt === 'Unlimited') s.memberships = (s.memberships ?? 0) + 1;
      else if (mt === 'Class package') s.packages = (s.packages ?? 0) + 1;
      else if (mt === 'Newcomer') s.intro_offers = (s.intro_offers ?? 0) + 1;
      else if (mt === 'Single class') s.single_classes = (s.single_classes ?? 0) + 1;
    }
  }
  return [...map.values()];
}

/* ---------- Sales ---------- */
export function mapSaleRow(r: Raw): SaleRow {
    const dt = dateISO(r['Payment Date']) ?? dateISO(r['Created At']);
  const location = canonLocation(r['Calculated Location']);
    const hour = dt ? new Date(dt.ts).getUTCHours() : null;
    const memStart = dateISO(r['Sec. Membership Start Date']); const memEnd = dateISO(r['Sec. Membership End Date']);
  const date = dt?.date ?? null;
  const ts = dt?.ts ?? null;
    return {
    date,
    ts,
    month: monthOf(date),
    location: location,
    location_short: shortLocation(location),
    trainer: personName(r['Sold By']),
    format: formatOf(r['Cleaned Product']),
    day: dayOf(date),
    slot: hour === null ? null : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening',
    source: null,
    membership_type: membershipTypeOf(r['Cleaned Product']),
    is_new: null,
    is_import: false, member_id: trim(r['Member ID']), customer: personName(r['Customer Name']), email: trim(r['Customer Email']),
      sale_item_id: trim(r['Sale Item ID']), value: money(r['Payment Value']),
      category_value: null,
      list_value: (() => { const unit = money(r['Sale Item Unit Price Including VAT']); return unit === null ? null : unit * (num(r['Sale Item Quantity']) ?? 1); })(),
      item_discount: money(r['Sale Item Unit Discount Value']), sale_discount: money(r['Discount Value In Currency']) ?? money(r['Sale Total Discount Value']),
      vat: money(r['Payment VAT']),
      status: catv(r['Payment Status']), method: catv(r['Payment Method']), sold_by: personName(r['Sold By']),
      product: catv(r['Cleaned Product']), category: catv(r['Cleaned Category']), purchase_type: catv(r['Purchase Type']),
      net: (() => {
      /* "Price Excluding VAT In Currency" is inflated on some rows (₹400,000 against a ₹42,000
         payment and a ₹40,000 unit price), so net is derived from figures that reconcile:
         payment minus VAT, falling back to unit price × quantity. */
      const gross = money(r['Payment Value']); const vat = money(r['Payment VAT']);
      if (gross !== null) return gross - (vat ?? 0);
      const unit = money(r['Sale Item Unit Price Excluding VAT']); const qty = num(r['Sale Item Quantity']);
      return unit !== null ? unit * (qty ?? 1) : money(r['Price Excluding VAT In Currency']);
    })(),
    net_reported: money(r['Price Excluding VAT In Currency']),
      discount: (() => { const item = money(r['Sale Item Unit Discount Value']); return item === null ? null : Math.abs(item) * (num(r['Sale Item Quantity']) ?? 1); })(),
      discount_code: catv(r['Discount Code']), sale_id: trim(r['Sale ID']), qty: num(r['Sale Item Quantity']),
      unit_price: money(r['Sale Item Unit Price Including VAT']), voided: bool(r['Sec. Is Voided']),
      mem_id: trim(r['Sec. Membership ID']), mem_start: memStart?.date ?? null, mem_end: memEnd?.date ?? null,
      mem_total_classes: num(r['Sec. Membership Total Classes']), mem_classes_left: num(r['Sec. Membership Classes Left']),
      mem_total_money: money(r['Sec. Membership Total Money']), mem_money_left: money(r['Sec. Membership Money Left']),
      mem_type: catv(r['Sec. Membership Type']), mem_frozen: bool(r['Sec. Membership Is Freezed']),
      rev_per_credit: money(r['Sec. Membership Revenue Per Event Credit Incl VAT']), hour,
      };
}
export const reconcileSales = (rows: SaleRow[]): SaleRow[] => {
  const sales = new Map<string, SaleRow[]>();
  for (const r of rows) { const key = r.sale_id ?? r.sale_item_id ?? `row:${sales.size}`; const group = sales.get(key); if (group) group.push(r); else sales.set(key, [r]); }
  for (const group of sales.values()) {
    /* The export repeats sale-level payment and sale-level discount on each line. Item discount,
       when present, is genuinely unit-level. Allocate repeated totals once, in proportion to the
       line's post-discount list value, so category shares reconcile to the sale payment. */
    const listTotal = group.reduce((a, r) => a + Math.max(0, r.list_value ?? 0), 0);
    const hasItemDiscount = group.some((r) => r.item_discount !== null);
    if (!hasItemDiscount) {
      const saleDiscount = Math.max(0, ...group.map((r) => Math.abs(r.sale_discount ?? 0)));
      for (const r of group) r.discount = saleDiscount ? saleDiscount * (listTotal ? (r.list_value ?? 0) / listTotal : 1 / group.length) : 0;
    }
    const paymentValues = group.map((r) => r.value).filter((v): v is number => v !== null);
    const payment = paymentValues.length ? Math.max(0, ...paymentValues) : null;
    const weights = group.map((r) => Math.max(0, (r.list_value ?? r.value ?? 0) - (r.discount ?? 0)));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    group.forEach((r, i) => { r.category_value = r.voided ? null : payment === null ? null : payment * (weightTotal ? weights[i] / weightTotal : 1 / group.length); });
  }
  return rows;
};
export const mapSales = (raw: Raw[]): SaleRow[] => reconcileSales(raw.map((r) => mapSaleRow(r)));


/* ---------- New ---------- */
/* "Memberships Bought Post Trial" holds product descriptions, not a number — `Studio 1 Month
   Unlimited, Studio 8 Class Package`. Passing it through num() erased every populated row. */
const productList = (v: unknown): string[] =>
  (trim(v) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/** Count only recurring memberships: the same column also lists single classes and packages. */
const MEMBERSHIP_PRODUCT = /unlimited|month|membership|annual|year/i;
const countProducts = (v: unknown): number | null => {
  const list = productList(v);
  if (!list.length) return num(v);                  // numeric exports still parse as a count
  return list.filter((x) => MEMBERSHIP_PRODUCT.test(x)).length;
};

export function mapNewRow(r: Raw): NewRow {
    const dt = dateISO(r['First Visit Date']);
  const location = canonLocation(r['First Visit Location'] || r['Home Location']);
  const isNewLabel = trim(r['Is New']);
    const memUsed = (trim(r['Membership Used']) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const email = trim(r['Email']); const phone = trim(r['Phone Number']);
    const conv = catv(r['Conversion Status']); const ret = catv(r['Retention Status']);
  const date = dt?.date ?? null;
  const ts = dt?.ts ?? null;
    return {
    date,
    ts,
    month: monthOf(date) ?? monthLabel(r['Month Year']),
    location: location,
    location_short: shortLocation(location),
    trainer: personName(r['Trainer Name']),
    format: formatOf(r['First Visit Entity Name']),
    day: trim(r['First Visit Day']) ?? dayOf(date),
    slot: trim(r['First Visit Time Slot']) as TimeSlot | null,
    source: catv(r['Source']) ?? 'Unattributed',
    membership_type: membershipTypeOf(trim(r['First Purchase Post Trial']) ?? memUsed[0]),
    is_new: isNewLabel ? /^new/i.test(isNewLabel) : false,
    is_import: isImportRow(r), member_id: trim(r['Member Id']), name: [trim(r['First Name']), trim(r['Last Name'])].filter(Boolean).join(' ') || null,
      email, phone, contactable: contactable(email, phone),
      first_visit_entity: catv(r['First Visit Entity Name']), first_visit_type: catv(r['First Visit Type']),
      payment_method: catv(r['Payment Method']), memberships_used: memUsed, home_location: canonLocation(r['Home Location']),
      class_no: num(r['Class No']), is_new_label: isNewLabel,
      visits_post_trial: num(r['Visits Post Trial']), late_cancels_post_trial: num(r['Late Cancellations Post Trial']),
      memberships_bought: countProducts(r['Memberships Bought Post Trial']), memberships_bought_products: productList(r['Memberships Bought Post Trial']),
      purchase_count: num(r['Purchase Count Post Trial']),
      first_purchase_product: trim(r['First Purchase Post Trial']), first_purchase_value: money(r['First Purchase Value']),
      ltv: money(r['Ltv']), retention_status: ret, conversion_status: conv,
      first_purchase_date: dateISO(r['First Purchase Date'])?.date ?? null, visits: num(r['No of Visits']),
      last_visit: dateISO(r['Last Visit Date'])?.date ?? null, days_since_last_visit: num(r['Days Since Last Visit']),
      conversion_span: num(r['Conversion Span (Days)']), days_to_second_visit: num(r['Days To Second Visit']),
      locations_visited: num(r['Unique Locations Visited Post Trial']), ltv_post_trial: money(r['Ltv Post Trial']),
      total_purchases: num(r['Total Purchases All Time']), days_active: num(r['Days Active']), visits_per_month: num(r['Visits Per Month']),
      late_cancel_rate: pct(r['Late Cancel Rate Post Trial']), speed_bucket: catv(r['Conversion Speed Bucket']), lifecycle: catv(r['Lifecycle Status']),
      converted: conv === 'Converted', retained: ret === 'Retained',
      };
}
export const mapNew = (raw: Raw[]): NewRow[] => raw.map((r) => mapNewRow(r));


/* ---------- Lapsed ---------- */
const RISK_W = { util: 0.3, recency: 0.35, cancel: 0.15, attendance: 0.2 };
export function mapLapsedRow(r: Raw, todayTs: number): LapsedRow {
    const purchase = dateDMY(r['Purchase Date']); const start = dateDMY(r['Start Date']); const end = dateDMY(r['End Date']); const churn = dateDMY(r['Churned Date']);
  const location = canonLocation(r['Primary Location']);
    const email = trim(r['Member Email']); const phone = trim(r['Member Phone']);
    const limitRaw = trim(r['Sessions Limit']);
    const unlimited = /unlimited/i.test(limitRaw ?? '');
    const sessions_limit = unlimited ? null : num(limitRaw);
    const status = catv(r['Status']);
    const completed = num(r['Total Sessions Completed']) ?? num(r['Completed Sessions']);
    const usedPct = pct(r['Sessions Used %']);
    const cancelRate = pct(r['Cancellation Rate %']);
    const attendanceRate = pct(r['Attendance Rate %']);
    const dsl = num(r['Days Since Last Visit']);
    const amount = money(r['Amount Paid']);
    const remaining = num(r['Remaining Sessions']);
    const daysElapsed = start ? Math.max(0, Math.floor((todayTs - start.ts) / 864e5)) : null;
    const util = sessions_limit && sessions_limit > 0 ? Math.min(1, (completed ?? 0) / sessions_limit) : usedPct;
    const recency = dsl === null ? 0.5 : Math.min(1, dsl / 60);
    /* How much of the four-input model was measured rather than filled with a neutral default.
       A score built from one observed input must not read like a score built from four. */
    const riskInputs = (util !== null && util !== undefined ? 1 : 0) + (dsl !== null ? 1 : 0)
      + (cancelRate !== null ? 1 : 0) + (attendanceRate !== null ? 1 : 0);
    const risk = Math.round(100 * (
      RISK_W.util * (1 - (util ?? 0.5)) + RISK_W.recency * recency +
      RISK_W.cancel * (cancelRate ?? 0) + RISK_W.attendance * (1 - (attendanceRate ?? 0.5))));
    const revPerSession = money(r['Revenue Per Session']);
    const liability = remaining !== null && revPerSession !== null ? remaining * revPerSession
      : remaining !== null && amount !== null && sessions_limit ? remaining * (amount / sessions_limit) : null;
    const churned = !!churn || status === 'Lapsed';
    /* Single-class products and zero-value rows are not memberships: a drop-in that "lapses" is
       just a class that was used. The reference implementation excludes them from every lapsed
       and churn figure, and so do we — but the rows are kept and flagged, so Data health can say
       how many were set aside instead of the exclusion being invisible.
       Deliberately narrow: it must not match a membership called "Single Location". */
    const singleClass = /single[\s-]*class|single[\s-]*session|\b1[\s-]*class\b|one[\s-]*class|drop[\s-]*in|trial[\s-]*class/i.test(trim(r['Membership Name']) ?? '');
    const qualifies = !singleClass && (amount ?? 0) > 0;
  const date = purchase?.date ?? start?.date ?? null;
  const ts = purchase?.ts ?? start?.ts ?? null;
    return {
    date,
    ts,
    month: monthOf(date),
    location: location,
    location_short: shortLocation(location),
    trainer: personName(r['Sold By']) ?? personName(r['Created By']),
    format: null,
    day: dayOf(date),
    slot: null,
    source: null,
    membership_type: membershipTypeOf(r['Membership Name']),
    is_new: null,
    is_import: false, member_name: personName(r['Member Name']), member_id: trim(r['Member ID']), email, phone, contactable: contactable(email, phone),
      status, membership_name: catv(r['Membership Name']), sessions_limit, unlimited,
      purchase_date: purchase?.date ?? null, start_date: start?.date ?? null, start_ts: start?.ts ?? null, end_date: end?.date ?? null, end_ts: end?.ts ?? null,
      churned_date: churn?.date ?? null, amount_paid: amount, discount_code: trim(r['Discount Code']), discount_value: money(r['Discount Value']),
      original_amount: money(r['Original Amount (Before Discount)']), sold_by: personName(r['Sold By']) ?? personName(r['Created By']),
      last_visit: dateDMY(r['Most Recent Visit Date'])?.date ?? null, first_visit: dateDMY(r['First Visit Date'])?.date ?? null,
      completed, used_pct: usedPct, remaining, cancellations: num(r['Total Cancellations']), late_cancellations: num(r['Late Cancellations']),
      no_shows: num(r['No Shows']), cancel_rate: cancelRate, booking_method: catv(r['Preferred Booking Method']),
      freeze_count: num(r['Membership Freeze Count']), days_frozen: num(r['Days Frozen']), duration_days: num(r['Membership Duration (Days)']),
      days_active: num(r['Days Active']), days_since_last_visit: dsl, avg_sessions_month: num(r['Average Sessions Per Month']),
      rev_per_session: revPerSession, attendance_rate: attendanceRate,
      churned, active: status === 'Active' || status === 'Frozen' || status === 'New', frozen: status === 'Frozen',
      single_class: singleClass, qualifies, days_elapsed: daysElapsed,
      risk_score: risk, risk_inputs: riskInputs, liability,
    multi_location: (trim(r['Locations Attended']) ?? '').includes(','),
    renewed: status === 'Renewed',
      };
}
export const mapLapsed = (raw: Raw[], todayTs: number): LapsedRow[] => raw.map((r) => mapLapsedRow(r, todayTs));


/* ---------- Payroll ---------- */
export function mapPayrollRow(r: Raw): PayrollRow {
  const location = canonLocation(r['Location']);
  const month = monthLabel(r['Month Year']);
  const date = month ? intern(`${month}-01`) : null;
  return {
    date,
    ts: date ? Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, 1) : null,
    month,
    location,
    location_short: shortLocation(location),
    trainer: personName(r['Teacher Name']),
    format: null,
    day: null,
    slot: null,
    source: null,
    membership_type: null,
    is_new: null,
    is_import: false,
    teacher_id: trim(r['Teacher ID']), email: trim(r['Teacher Email']),
    cycle_sessions: num(r['Cycle Sessions']), cycle_empty: num(r['Empty Cycle Sessions']), cycle_customers: num(r['Cycle Customers']), cycle_paid: money(r['Cycle Paid']),
    strength_sessions: num(r['Strength Sessions']), strength_empty: num(r['Empty Strength Sessions']), strength_customers: num(r['Strength Customers']), strength_paid: money(r['Strength Paid']),
    barre_sessions: num(r['Barre Sessions']), barre_empty: num(r['Empty Barre Sessions']), barre_customers: num(r['Barre Customers']), barre_paid: money(r['Barre Paid']),
    total_sessions: num(r['Total Sessions']), total_empty: num(r['Total Empty Sessions']), total_nonempty: num(r['Total Non-Empty Sessions']),
    total_customers: num(r['Total Customers']), total_paid: money(r['Total Paid']),
    converted: num(r['Converted']), conversion_rate: pct(r['Conversion Rate']), retained: num(r['Retained']), retention_rate: pct(r['Retention Rate']), new_count: num(r['New']),
  };
}

export const mapPayroll = (raw: Raw[]): PayrollRow[] => raw.map((r) => mapPayrollRow(r));


/* ---------- Leads ---------- */
export const LEAD_WON = new Set(['Won']);
export const LEAD_LOST = new Set(['Lost', 'Disqualified', 'Unresponsive']);

export function mapLeadRow(r: Raw, todayTs: number): LeadRow {
  const created = dateISO(r['Created At']);
  const date = created?.date ?? null;
  const location = canonLocation(r['Center']);
  const associate = personName(r['Associate']) ?? 'Unassigned';
  const source = catv(r['Source Name']) ?? 'Unattributed';
  const fus: number[] = [];
  for (let i = 1; i <= 4; i++) { const t = dateISO(r[`Follow Up ${i} Date`])?.ts; if (t !== undefined && t !== null) fus.push(t); }
  fus.sort((a, b) => a - b);
  const status = catv(r['Status']) ?? 'Open';
  const conv = dateISO(r['Converted To Customer At']);
  const first = fus.length ? fus[0] : null;
  const email = intern(trim(r['Email'])); const phone = trim(r['Phone Number']);
  const won = LEAD_WON.has(status); const lost = LEAD_LOST.has(status);
  const lastTouch = fus.length ? fus[fus.length - 1] : created?.ts ?? null;
  const visits = num(r['Visits']);
  return {
    date,
    ts: created?.ts ?? null,
    month: monthOf(date),
    location,
    location_short: shortLocation(location),
    trainer: associate,
    format: formatOf(r['Class Type']),
    day: dayOf(date),
    slot: null,
    source,
    membership_type: null,
    is_new: null,
    is_import: false,
    id: trim(r['ID']), name: personName(r['Full Name']), phone, email,
    created_ts: created?.ts ?? null,
    source_name: source, member_id: trim(r['Member ID']), converted_ts: conv?.ts ?? null,
    stage: catv(r['Stage Name']), associate, follow_ups: fus, touches: fus.length,
    center: location, class_type: catv(r['Class Type']), status,
    channel: catv(trim(r['Channel'])?.replace(/&amp;/g, '&')) ?? 'Unattributed',
    response_hours: first !== null && created ? Math.max(0, (first - created.ts) / 3.6e6) : null,
    won, lost, open: !won && !lost,
    utm_source: catv(r['UTM Source']), utm_medium: catv(r['UTM Medium']), utm_campaign: catv(r['UTM Campaign']),
    purchases: num(r['Purchases Made']), ltv: money(r['LTV']), visits,
    trial_status: catv(r['Trial Status']), conversion_status: catv(r['Conversion Status']), retention_status: catv(r['Retention Status']),
    trialed: /completed|attended|scheduled/i.test(trim(r['Trial Status']) ?? '') || (visits ?? 0) > 0,
    last_touch_ts: lastTouch,
    stale: !won && !lost && lastTouch !== null && todayTs - lastTouch > 14 * 864e5,
    contactable: contactable(email, phone),
  };
}

export const mapLeads = (raw: Raw[], todayTs: number): LeadRow[] => raw.map((r) => mapLeadRow(r, todayTs));
