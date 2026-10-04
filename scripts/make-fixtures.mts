/* Generate a small, realistic synthetic dataset so every tab can be rendered with rows in it.
 *
 *   npx tsx scripts/make-fixtures.mts [outDir]        # default /tmp/floor-fixtures
 *
 * The render test used to run against whatever CSVs happened to be in /tmp, and with none there it
 * rendered every tab against zero rows — which is exactly the state in which no aggregation, no
 * join and no chart scale can fail. Tabs reported "ok" while a real dataset crashed them.
 *
 * The values are invented. The shapes are not: columns, date formats, flag spellings and the
 * null patterns are taken from the declared schema, so the mappers, the metric engine and every
 * grouping run the same code paths they run against the real sheets.
 */
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '/tmp/floor-fixtures';
fs.mkdirSync(outDir, { recursive: true });

const { SHEETS } = await import('../src/data/sheets.config.ts');

/* ── deterministic pseudo-randomness, so a failure reproduces ── */
let seed = 20261004;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
/** `chance(0.1)` is true a tenth of the time — used to leave fields genuinely blank. */
const chance = (p: number) => rnd() < p;

const LOCATIONS = ['Kwality House, Kemps Corner', 'Supreme HQ, Bandra', 'Kenkere House'] as const;
const FORMATS = ['Barre 57', 'Cycle', 'Strength', 'Mat 57', 'Hosted Class'] as const;
const TRAINERS = ['Anisha Shah', 'Rohan Mehta', 'Priya Sharma', 'Karan Desai', 'Veena Narasimhan', 'Siya Mukund'] as const;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const TIMES = ['07:00', '08:00', '09:30', '11:00', '17:30', '18:45', '20:00'] as const;
const MEMBERSHIPS = ['Studio 1 Month Unlimited', 'Studio 8 Class Package', 'Studio Single Class', 'Studio Newcomers 2 For 1', 'Studio 4 Class Package'] as const;
const SOURCES = ['Website Form', 'Walk-in', 'Referral', 'Instagram', 'Hosted Class'] as const;
const METHODS = ['Card', 'UPI', 'Cash', 'Online'] as const;

/* Two distinct members deliberately share a display name, so identity handling is exercised. */
const MEMBERS = Array.from({ length: 220 }, (_, i) => ({
  id: `M${1000 + i}`,
  first: i === 7 || i === 8 ? 'Priya' : `First${i}`,
  last: i === 7 || i === 8 ? 'Sharma' : `Last${i}`,
  email: chance(0.04) ? '' : `member${i}@example.com`,
  phone: chance(0.06) ? '' : `98${String(10000000 + i)}`,
}));

/* The window ends before today so nothing in the fixture is a future occurrence. */
const END = new Date(Date.UTC(2026, 8, 30));
const DAY_MS = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const back = (days: number) => new Date(END.getTime() - days * DAY_MS);
const dayName = (d: Date) => DAYS[(d.getUTCDay() + 6) % 7];

const csv = (header: readonly string[], rows: Record<string, string | number>[]) => {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h] ?? '')).join(','))].join('\n');
};
const expectedOf = (key: string): string[] => {
  const cfg = SHEETS.find((c) => c.key === key);
  if (!cfg) throw new Error(`no sheet config for ${key}`);
  return cfg.expected;
};

/* ── Sessions: the schedule fact, including occurrences nobody attended ── */
type Occ = { id: string; date: Date; time: string; loc: string; fmt: string; trainer: string; capacity: number; attended: number; u1: string; u2: string };
const occurrences: Occ[] = [];
for (let d = 0; d < 180; d++) {
  const date = back(d);
  for (let k = 0; k < int(2, 5); k++) {
    const time = pick(TIMES); const loc = pick(LOCATIONS); const fmt = pick(FORMATS); const trainer = pick(TRAINERS);
    const capacity = fmt === 'Cycle' ? 20 : int(8, 14);
    // A real timetable has empty classes; the visit feed can never see them.
    const attended = chance(0.07) ? 0 : Math.min(capacity + (chance(0.03) ? 2 : 0), int(1, capacity));
    occurrences.push({ id: `S${occurrences.length + 1}`, date, time, loc, fmt, trainer, capacity, attended,
      u1: `${loc}|${dayName(date)}|${time}`, u2: fmt });
  }
}

const sessionRows = occurrences.map((o) => {
  const late = o.attended ? int(0, 2) : 0;
  const booked = o.attended + late + int(0, 3);
  const nonPaid = o.attended ? int(0, 1) : 0;
  const paidHeads = Math.max(0, o.attended - nonPaid);
  const mem = Math.floor(paidHeads * 0.5), pack = Math.floor(paidHeads * 0.25), intro = Math.floor(paidHeads * 0.1);
  return {
    TrainerID: TRAINERS.indexOf(o.trainer as typeof TRAINERS[number]) + 1, FirstName: o.trainer.split(' ')[0], LastName: o.trainer.split(' ')[1],
    Trainer: o.trainer, SessionID: o.id, SessionName: `${o.fmt} ${o.time}`,
    Capacity: o.capacity, CheckedIn: o.attended, LateCancelled: late, Booked: booked, Complimentary: o.attended ? int(0, 1) : 0,
    Location: o.loc, Date: iso(o.date), Day: dayName(o.date), Time: o.time,
    Revenue: paidHeads * int(450, 900), NonPaid: nonPaid, UniqueID1: o.u1, UniqueID2: o.u2,
    Memberships: mem, Packages: pack, IntroOffers: intro, SingleClasses: Math.max(0, paidHeads - mem - pack - intro),
    Type: 'Group', Class: o.fmt, Classes: 1,
  } as Record<string, string | number>;
});

/* ── Checkins: one row per member per occurrence, plus late cancels ── */
type Ck = { occ: Occ; member: typeof MEMBERS[number]; attended: boolean; late: boolean; paid: number | null; classNo: number };
const checkinRows: Record<string, string | number>[] = [];
const bookingRows: Record<string, string | number>[] = [];
const visitCount = new Map<string, number>();
const cks: Ck[] = [];
for (const o of occurrences) {
  const heads = o.attended + int(0, 2);
  for (let i = 0; i < heads; i++) {
    const member = pick(MEMBERS);
    const attended = i < o.attended;
    const late = !attended && chance(0.5);
    const n = (visitCount.get(member.id) ?? 0) + (attended ? 1 : 0);
    if (attended) visitCount.set(member.id, n);
    cks.push({ occ: o, member, attended, late, paid: chance(0.08) ? null : (chance(0.1) ? 0 : int(400, 1100)), classNo: n || 1 });
  }
}
for (const c of cks) {
  const orderAt = new Date(c.occ.date.getTime() - int(0, 10) * DAY_MS);
  checkinRows.push({
    'Member ID': c.member.id, 'First Name': c.member.first, 'Last Name': c.member.last, Email: c.member.email,
    'Order At': chance(0.05) ? '' : `${iso(orderAt)} ${String(int(6, 21)).padStart(2, '0')}:15:00`,
    Paid: c.paid === null ? '' : c.paid, 'Payment Method Name': pick(METHODS),
    'Checked In': c.attended ? 'TRUE' : 'FALSE', Complementary: c.paid === 0 ? 'TRUE' : 'FALSE',
    'Is Late Cancelled': c.late ? 'TRUE' : 'FALSE',
    'Session ID': c.occ.id, 'Date (IST)': iso(c.occ.date), Time: c.occ.time,
    Location: c.occ.loc, 'Cleaned Class': c.occ.fmt, Class: c.occ.fmt, Teacher: c.occ.trainer,
    Capacity: c.occ.capacity, 'Class No': c.classNo,
    'Is New': c.classNo <= 1 ? 'New' : 'Returning',
    UniqueID1: c.occ.u1, UniqueID2: c.occ.u2,
    // Reproduces the live corruption: the column holds dates, not minutes.
    'Duration (Minutes)': '1899-12-30 00:55:00',
    Product: pick(MEMBERSHIPS), Category: 'Class', 'Membership Used': pick(MEMBERSHIPS),
  });
  // Bookings covers part of the same reality, and adds cancellations Checkins never sees.
  if (chance(0.7)) {
    bookingRows.push({
      'Member Id': c.member.id, 'Sale Date': iso(new Date(c.occ.date.getTime() - int(0, 12) * DAY_MS)),
      'Sale Value': c.paid === null ? '' : c.paid, 'Sale Item': pick(MEMBERSHIPS),
      'Session Date': iso(c.occ.date), 'Payment Method': pick(METHODS), 'Membership Used': pick(MEMBERSHIPS),
      'Location Name': c.occ.loc, Cancelled: 'FALSE', 'Late Cancelled': c.late ? 'TRUE' : 'FALSE',
      'No Show': !c.attended && !c.late ? 'TRUE' : 'FALSE', Attended: c.attended ? 'TRUE' : 'FALSE',
      Refunded: chance(0.01) ? 'TRUE' : 'FALSE', Teacher: c.occ.trainer, Class: c.occ.fmt,
      'Class No': c.classNo, 'Is New': c.classNo <= 1 ? 'New' : 'Returning', Time: c.occ.time,
      UniqueID1: c.occ.u1, UniqueID2: c.occ.u2, 'Sale Id': `B${bookingRows.length + 1}`,
    });
  }
}
for (let i = 0; i < 400; i++) {                 // cancelled well before the class
  const o = pick(occurrences); const m = pick(MEMBERS);
  bookingRows.push({
    'Member Id': m.id, 'Sale Date': iso(new Date(o.date.getTime() - int(2, 20) * DAY_MS)), 'Sale Value': 0,
    'Sale Item': pick(MEMBERSHIPS), 'Session Date': iso(o.date), 'Payment Method': pick(METHODS),
    'Membership Used': pick(MEMBERSHIPS), 'Location Name': o.loc, Cancelled: 'TRUE', 'Late Cancelled': 'FALSE',
    'No Show': 'FALSE', Attended: 'FALSE', Refunded: 'FALSE', Teacher: o.trainer, Class: o.fmt,
    'Class No': 1, 'Is New': 'Returning', Time: o.time, UniqueID1: o.u1, UniqueID2: o.u2, 'Sale Id': `BC${i}`,
  });
}

/* ── Sales: sale-level fields repeat across line items, exactly as the export writes them ── */
const salesRows: Record<string, string | number>[] = [];
for (let i = 0; i < 700; i++) {
  const m = pick(MEMBERS); const date = back(int(0, 180));
  const lines = chance(0.25) ? 2 : 1;
  const payment = int(1500, 24000); const vat = Math.round(payment * 0.18);
  const saleId = `SA${i}`;
  const voided = chance(0.02);
  for (let l = 0; l < lines; l++) {
    const unit = Math.round(payment / lines);
    salesRows.push({
      'Member ID': m.id, 'Customer Name': `${m.first} ${m.last}`, 'Customer Email': m.email, 'Paying Member ID': m.id,
      'Sale Item ID': `${saleId}-${l}`, 'Payment Date': iso(date), 'Payment Value': payment, 'Paid In Money': payment,
      'Payment VAT': vat, 'Sale ID': saleId, 'Sale Item Quantity': 1,
      'Sale Item Unit Price Including VAT': unit,
      'Sale Item Unit Discount Value': chance(0.3) ? int(100, 900) : '',
      'Discount Value In Currency': chance(0.2) ? int(200, 1200) : '',
      'Discount Code': chance(0.2) ? pick(['WELCOME', 'FRIEND', 'WINBACK']) : '',
      'Cleaned Category': pick(['Memberships', 'Packages', 'Retail', 'Single Classes']),
      'Cleaned Product': pick(MEMBERSHIPS), 'Payment Method': pick(METHODS),
      'Calculated Location': pick(LOCATIONS), 'Sold By': pick(TRAINERS),
      'Sec. Is Voided': voided ? 'TRUE' : 'FALSE',
      'Sec. Membership Money Left': chance(0.3) ? int(0, 9000) : '',
      'Sec. Membership Classes Left': chance(0.3) ? int(0, 12) : '',
      'Sec. Membership Revenue Per Event Credit Incl VAT': chance(0.3) ? int(400, 1200) : '',
    });
  }
}

/* ── New: one row per first visit ── */
const newRows = MEMBERS.map((m, i) => {
  const first = back(int(1, 200));
  const converted = chance(0.35);
  const visitsPost = converted ? int(1, 40) : (chance(0.4) ? int(1, 3) : 0);
  return {
    'Member Id': m.id, 'First Name': m.first, 'Last Name': m.last, Email: m.email, 'Phone Number': m.phone,
    'First Visit Date': iso(first), 'First Visit Entity Name': pick(MEMBERSHIPS), 'First Visit Type': 'Trial',
    'First Visit Location': pick(LOCATIONS), 'First Visit Day': dayName(first), 'First Visit Time Slot': pick(['Morning', 'Afternoon', 'Evening']),
    'Home Location': pick(LOCATIONS), 'Trainer Name': pick(TRAINERS), Source: pick(SOURCES),
    'Is New': i % 23 === 0 ? 'Returning' : 'New',
    'Visits Post Trial': visitsPost, 'Late Cancellations Post Trial': int(0, 3),
    // Product descriptions, not a count — the column the numeric parser used to erase.
    'Memberships Bought Post Trial': converted ? (chance(0.3) ? `${pick(MEMBERSHIPS)}, ${pick(MEMBERSHIPS)}` : pick(MEMBERSHIPS)) : '',
    'Purchase Count Post Trial': converted ? int(1, 4) : 0,
    'First Purchase Post Trial': converted ? pick(MEMBERSHIPS) : '', 'First Purchase Value': converted ? int(2000, 20000) : '',
    Ltv: converted ? int(2000, 180000) : 0, 'Ltv Post Trial': converted ? int(1000, 150000) : 0,
    'Conversion Status': converted ? 'Converted' : 'Not Converted',
    'Retention Status': converted && chance(0.6) ? 'Retained' : 'Not Retained',
    'Lifecycle Status': pick(['Active', 'Churned', 'Lapsed', 'Active']),
    'Conversion Span (Days)': converted ? int(0, 120) : '', 'Days To Second Visit': visitsPost ? int(1, 60) : '',
    'Unique Locations Visited Post Trial': int(1, 3), 'Total Purchases All Time': converted ? int(1, 6) : 0,
    'Days Active': int(0, 400), 'Visits Per Month': +(rnd() * 8).toFixed(1),
    'Late Cancel Rate Post Trial': +(rnd() * 0.3).toFixed(3),
    'Conversion Speed Bucket': converted ? pick(['Same Day', '1-7 Days', '8-30 Days', '31-90 Days']) : 'Not Converted',
    'No of Visits': visitsPost + 1, 'Last Visit Date': iso(back(int(0, 160))), 'Days Since Last Visit': int(0, 160),
    'First Purchase Date': converted ? iso(back(int(0, 180))) : '', 'Month Year': `${iso(first).slice(0, 7)}`,
    'Class No': 1, 'Payment Method': pick(METHODS),
  } as Record<string, string | number>;
});

/* ── Lapsed: memberships, with purchase and start deliberately different dates ── */
const lapsedRows: Record<string, string | number>[] = [];
for (let i = 0; i < 420; i++) {
  const m = pick(MEMBERS);
  const purchase = back(int(10, 420));
  const start = new Date(purchase.getTime() + int(0, 14) * DAY_MS);
  const end = new Date(start.getTime() + int(28, 365) * DAY_MS);
  const status = pick(['Active', 'Lapsed', 'Renewed', 'Frozen', 'Not Activated', 'Active']);
  const unlimited = chance(0.3);
  const limit = unlimited ? 'Unlimited' : (chance(0.55) ? '' : String(int(4, 24)));   // blank caps are the live reality
  const completed = int(0, 24);
  const amount = chance(0.2) ? 0 : int(3000, 60000);
  lapsedRows.push({
    'Member Name': `${m.first} ${m.last}`, 'Member ID': m.id, 'Member Email': m.email, 'Member Phone': m.phone,
    'Host ID': 'H1', Status: status, 'Membership Name': pick(MEMBERSHIPS), 'Sessions Limit': limit,
    'Purchase Date': dmy(purchase), 'Start Date': dmy(start), 'End Date': dmy(end),
    'Churned Date': status === 'Lapsed' ? dmy(new Date(end.getTime() - int(0, 40) * DAY_MS)) : '',
    'Amount Paid': amount, 'Original Amount (Before Discount)': amount ? amount + int(0, 4000) : 0,
    'Discount Value': chance(0.3) ? int(200, 3000) : '', 'Discount Code': chance(0.3) ? 'WELCOME' : '',
    'Total Sessions Completed': completed, 'Completed Sessions': completed,
    'Sessions Used %': limit && limit !== 'Unlimited' ? `${Math.min(100, Math.round((completed / +limit) * 100))}%` : '',
    'Remaining Sessions': limit && limit !== 'Unlimited' ? Math.max(0, +limit - completed) : '',
    'Revenue Per Session': completed ? Math.round(amount / Math.max(1, completed)) : '',
    'Total Cancellations': int(0, 6), 'Late Cancellations': int(0, 4), 'No Shows': int(0, 3),
    'Cancellation Rate %': `${int(0, 30)}%`, 'Attendance Rate %': chance(0.15) ? '' : `${int(40, 100)}%`,
    'Days Since Last Visit': chance(0.18) ? '' : int(0, 200),
    'Membership Duration (Days)': Math.round((end.getTime() - start.getTime()) / DAY_MS),
    'Days Active': int(0, 400), 'Average Sessions Per Month': +(rnd() * 10).toFixed(1),
    'Membership Freeze Count': chance(0.15) ? int(1, 2) : 0, 'Days Frozen': chance(0.15) ? int(5, 40) : 0,
    'Primary Location': pick(LOCATIONS), 'Locations Attended': chance(0.3) ? `${pick(LOCATIONS)}, ${pick(LOCATIONS)}` : pick(LOCATIONS),
    'Most Recent Visit Date': dmy(back(int(0, 150))), 'First Visit Date': dmy(back(int(100, 400))),
    'Preferred Booking Method': pick(['App', 'Web', 'Front desk']), 'Sold By': pick(TRAINERS), 'Created By': pick(TRAINERS),
  });
}

/* ── Payroll: one row per trainer per month ── */
const payrollRows: Record<string, string | number>[] = [];
for (let mo = 0; mo < 6; mo++) {
  const d = new Date(Date.UTC(2026, 8 - mo, 1));
  const label = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  for (const t of TRAINERS) {
    const cycle = int(0, 30), strength = int(0, 20), barre = int(5, 40);
    const total = cycle + strength + barre;
    // One trainer–month with sessions taught and no outcome enrichment at all.
    const enriched = !(mo === 0 && t === TRAINERS[0]);
    payrollRows.push({
      'Teacher ID': TRAINERS.indexOf(t) + 1, 'Teacher Name': t, 'Teacher Email': `${t.split(' ')[0].toLowerCase()}@example.com`,
      Location: pick(LOCATIONS), 'Cycle Sessions': cycle, 'Empty Cycle Sessions': int(0, 3), 'Non-Empty Cycle Sessions': Math.max(0, cycle - 2),
      'Strength Sessions': strength, 'Barre Sessions': barre, 'Total Sessions': total, 'Total Empty Sessions': int(0, 5),
      'Total Customers': total * int(4, 11), 'Cycle Customers': cycle * 8, 'Strength Customers': strength * 6, 'Barre Customers': barre * 7,
      'Total Paid': chance(0.08) ? 0 : total * int(2500, 6000), 'Cycle Paid': cycle * 3000, 'Strength Paid': strength * 2800, 'Barre Paid': barre * 3200,
      New: enriched ? int(0, 12) : 0, Converted: enriched ? int(0, 6) : 0, Retained: enriched ? int(0, 8) : 0,
      'Month Year': label, 'Unique Customers': total * 3,
    });
  }
}

/* ── Leads ── */
const leadRows = Array.from({ length: 300 }, (_, i) => {
  const created = back(int(0, 200));
  const touches = int(0, 4);
  const won = chance(0.18);
  const f = (n: number) => (touches >= n ? iso(new Date(created.getTime() + n * int(1, 5) * DAY_MS)) : '');
  return {
    ID: `L${i}`, 'Full Name': `Lead ${i}`, 'Phone Number': `97${String(10000000 + i)}`, Email: `lead${i}@example.com`,
    'Created At': `${iso(created)} 10:00:00`, 'Source ID': String(int(1, 5)), 'Source Name': pick(SOURCES),
    'Member ID': won ? pick(MEMBERS).id : '', 'Converted To Customer At': won ? `${iso(new Date(created.getTime() + int(1, 40) * DAY_MS))} 12:00:00` : '',
    Status: won ? 'Won' : pick(['Open', 'Lost', 'Contacted', 'Open']), Stage: pick(['New', 'Contacted', 'Trial booked', 'Closed']),
    'Associate Name': pick(TRAINERS), Center: pick(LOCATIONS), Remarks: '', 'Trial Status': pick(['Completed', 'Scheduled', 'Not scheduled']),
    'Follow Up 1 Date': f(1), 'Follow Up 2 Date': f(2), 'Follow Up 3 Date': f(3), 'Follow Up 4 Date': f(4),
    'Follow Up Comments 1': '', 'Follow Up Comments 2': '', 'Follow Up Comments 3': '', 'Follow Up Comments 4': '',
    LTV: won ? int(3000, 90000) : 0, Visits: won ? int(1, 30) : int(0, 2),
    'Channel Name': pick(['Organic', 'Paid', 'Referral']), 'Utm Source': pick(['google', 'meta', 'direct']),
    'Utm Medium': pick(['cpc', 'organic', 'social']), 'Utm Campaign': pick(['always-on', 'newcomer']),
  } as Record<string, string | number>;
});

const FILES: [string, string, Record<string, string | number>[]][] = [
  ['sessions', 'Sessions', sessionRows],
  ['checkins', 'Checkins', checkinRows],
  ['bookings', 'Bookings', bookingRows],
  ['sales', 'Sales', salesRows],
  ['new', 'New', newRows],
  ['lapsed', 'Lapsed', lapsedRows],
  ['payroll', 'Payroll', payrollRows],
  ['leads', 'Leads', leadRows],
];

for (const [key, file, rows] of FILES) {
  const header = expectedOf(key);
  fs.writeFileSync(path.join(outDir, `${file}.csv`), csv(header, rows));
  console.log(`${file.padEnd(10)} ${String(rows.length).padStart(7)} rows · ${header.length} columns`);
}
console.log(`\nwritten to ${outDir}`);
