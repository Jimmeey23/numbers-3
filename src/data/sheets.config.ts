import type { SheetKey } from './types';

export interface SheetConfig {
  key: SheetKey;
  title: string;
  spreadsheetId: string;
  /** Columns that must be present for the response to be accepted as this tab. */
  required: string[];
  /** Full expected schema (for drift reporting). */
  expected: string[];
  /** Optional gviz column projection — these sheets are tens of MB and we only read what we use. */
  select?: string;
  /** Human note about what the projection drops. */
  projectionNote?: string;
  derivedFrom?: SheetKey;
  /** Approximate payload, used for the loading progress weighting. */
  weight?: number;
}

const SESSIONS_COLS = ['TrainerID','FirstName','LastName','Trainer','SessionID','SessionName','Capacity','CheckedIn','LateCancelled','Booked','Complimentary','Location','Date','Day','Time','Revenue','NonPaid','UniqueID1','UniqueID2','Memberships','Packages','IntroOffers','SingleClasses','Type','Class','Classes'];

export const SHEETS: SheetConfig[] = [
  { key: 'sessions', title: 'Sessions', spreadsheetId: '16wFlke0bHFcmfn-3UyuYlGnImBq0DY7ouVYAlAFTZys',
    required: ['SessionID','Capacity','CheckedIn','Booked','Location','Date','Time','Revenue'], expected: SESSIONS_COLS, derivedFrom: 'checkins', weight: 1 },
  { key: 'recurring', title: 'Recurring', spreadsheetId: '16wFlke0bHFcmfn-3UyuYlGnImBq0DY7ouVYAlAFTZys',
    required: ['SessionID','FillRate','Top5Trainers','EmptySessions'], expected: [...SESSIONS_COLS,'EmptySessions','NonEmptySessions','TotalCheckedInSum','TotalCapacitySum','TotalRevenueSum','ClassAvgInclEmpty','ClassAvgExclEmpty','FillRate','WeightedAverage','Top5Trainers'], derivedFrom: 'checkins', weight: 1 },
  { key: 'teacherRecurring', title: 'Teacher Recurring', spreadsheetId: '16wFlke0bHFcmfn-3UyuYlGnImBq0DY7ouVYAlAFTZys',
    required: ['SessionID','FillRate','TotalSessions'], expected: [...SESSIONS_COLS,'TotalSessions','EmptySessions','NonEmptySessions','TotalCheckedInSum','TotalCapacitySum','TotalRevenueSum','ClassAvgInclEmpty','ClassAvgExclEmpty','FillRate','WeightedAverage'], derivedFrom: 'checkins', weight: 1 },
  { key: 'sales', title: 'Sales', spreadsheetId: '1HbGnJk-peffUp7XoXSlsL55924E9yUt8cP_h93cdTT0',
    required: ['Member ID','Payment Date','Payment Value','Cleaned Category','Sale ID'], weight: 14,
    expected: ['Member ID','Customer Name','Customer Email','Paying Member ID','Sale Item ID','Payment Date','Payment Value','Paid In Money Credits','Payment VAT','Payment Status','Payment Method','Payment Transaction ID','Stripe Token','Sold By','Sale Reference','Calculated Location','Cleaned Product','Cleaned Category','Host Id','Purchase Type','Payment Source','Paid In Event Credits','Price Excluding VAT In Currency','Discount Value In Currency','Discount Code','Created At','Modified At','Sale ID','Sale Total Discount Value','Sale Item Quantity','Sale Item Unit Price Including VAT','Sale Item Unit Price Excluding VAT','Sale Item Unit VAT Amount','Sale Item Unit Discount Value','Sec. Is Voided','Sec. Membership ID','Sec. Membership Start Date','Sec. Membership End Date','Sec. Membership Total Classes','Sec. Membership Classes Left','Sec. Membership Total Money','Sec. Membership Money Left','Sec. Membership Type','Sec. Membership Is Freezed','Sec. Membership Used Session Credits','Sec. Membership Revenue Per Event Credit Incl VAT','Sec. Membership Activated On First Use','Sec. Membership Name'] },
  { key: 'new', title: 'New', spreadsheetId: '149ILDqovzZA6FRUJKOwzutWdVqmqWBtWPfzG3A0zxTI',
    required: ['Member Id','First Visit Date','Conversion Status','Ltv','Is New'], weight: 10,
    expected: ['Member Id','First Name','Last Name','Email','Phone Number','First Visit Date','First Visit Entity Name','First Visit Type','First Visit Location','Payment Method','Membership Used','Home Location','Class No','Trainer Name','Is New','Visits Post Trial','Visits Post Trial Same Month','Late Cancellations Post Trial','Memberships Bought Post Trial','Purchase Count Post Trial','First Purchase Post Trial','First Purchase Value','Ltv','Retention Status','Conversion Status','First Purchase Date','No of Visits','Last Visit Date','Days Since Last Visit','Conversion Span (Days)','Days To Second Visit','Unique Locations Visited Post Trial','Month Year','Source','Ltv Post Trial','Avg Purchase Value Post Trial','Last Purchase Date','Last Purchase Value','Total Purchases All Time','Days Active','Visits Per Month','Late Cancel Rate Post Trial','First Visit Day','First Visit Time Slot','Conversion Speed Bucket','Lifecycle Status'] },
  { key: 'payroll', title: 'Payroll', spreadsheetId: '149ILDqovzZA6FRUJKOwzutWdVqmqWBtWPfzG3A0zxTI',
    required: ['Teacher ID','Teacher Name','Total Sessions','Total Paid','Month Year'], weight: 1,
    expected: ['Teacher ID','Teacher Name','Teacher Email','Location','Cycle Sessions','Empty Cycle Sessions','Non-Empty Cycle Sessions','Cycle Customers','Cycle Paid','Strength Sessions','Empty Strength Sessions','Non-Empty Strength Sessions','Strength Customers','Strength Paid','Barre Sessions','Empty Barre Sessions','Non-Empty Barre Sessions','Barre Customers','Barre Paid','Total Sessions','Total Empty Sessions','Total Non-Empty Sessions','Total Customers','Total Paid','Month Year','Unique Key','Converted','Conversion Rate','Retained','Retention Rate','New'] },
  { key: 'lapsed', title: 'Lapsed', spreadsheetId: '1x-0iFgnYmEqt-b2MfAgHVx5CErcX5NtZYB9p5Rh6f1I',
    required: ['Member ID','Status','Membership Name','Purchase Date','End Date','Amount Paid'], weight: 11,
    expected: ['Member Name','Member ID','Member Email','Member Phone','Host ID','Status','Membership Name','Sessions Limit','Purchase Date','Start Date','End Date','Churned Date','Amount Paid','Discount Code','Discount Value','Original Amount (Before Discount)','Sold By','Created By','Most Recent Visit Date','First Visit Date','Total Sessions Completed','Sessions Used %','Remaining Sessions','Total Cancellations','Late Cancellations','No Shows','Cancellation Rate %','Preferred Booking Method','Primary Location','Locations Attended','Membership Freeze Count','Days Frozen','Membership Duration (Days)','Days Active','Days Since Last Visit','Average Sessions Per Month','Revenue Per Session','Attendance Rate %'] },
  { key: 'bookings', title: 'Bookings', spreadsheetId: '1OO-Pk7P__1uqsRdmFZ82JBl4-LGPPr7MCTbwKgeLqL0',
    required: ['Member Id','Sale Date','Session Date','Cancelled','Late Cancelled','No Show','Attended'], weight: 59,
    select: 'select A,B,E,F,H,I,J,N,P,Q,R,S,T,U,V,W,X,Y,Z,AB,AC',
    projectionNote: 'Customer name, email, Stripe token, VAT, Sold by and Host ID are not fetched — 211k rows would add ~23 MB. Member names come from the New and Checkins lookup instead.',
    expected: ['Member Id','Sale Date','Sale Value','Sale Item','Session Date','Payment Method','Membership Used','Location Name','Cancelled','Late Cancelled','No Show','Trainer Id','Teacher Name','Cleaned Class','Attended','Class No','Is New','Day Of Week','Time Slot','UniqueID1','UniqueID2'],
    derivedFrom: 'checkins' },
  { key: 'leads', title: 'Leads', spreadsheetId: '1dQMNF69WnXVQdhlLvUZTig3kL97NA21k6eZ9HRu6xiQ',
    required: ['ID','Created At','Source Name','Stage Name','Status'], weight: 10,
    select: 'select A,B,C,D,E,F,G,H,I,J,K,M,O,Q,S,U,V,W,X,Y,Z,AA,AB,AC,AD,AE,AF,AG,AH,AI,AJ,AK',
    projectionNote: 'The four free-text follow-up comment columns and Remarks are not fetched — they are ~6 MB of prose that no metric reads.',
    expected: ['ID','Full Name','Phone Number','Email','Created At','Source ID','Source Name','Member ID','Converted To Customer At','Stage Name','Associate','Follow Up 1 Date','Follow Up 2 Date','Follow Up 3 Date','Follow Up 4 Date','Center','Class Type','Host ID','Status','Channel','Period','UTM Source','UTM Medium','UTM Campaign','UTM Term','UTM Content','Purchases Made','LTV','Visits','Trial Status','Conversion Status','Retention Status'] },
  { key: 'checkins', title: 'Checkins', spreadsheetId: '1a7XKv2WCog7o8nYuV8YcFdqtfPYJNRO6DelJ6Hn_z6Q',
    required: ['Member ID','Session ID','Checked In','Capacity','Location','Date (IST)','Time','Teacher Name'], weight: 64,
    expected: ['Member ID','First Name','Last Name','Email','Order At','Paid','Payment Method Name','Checked In','Complementary','Is Late Cancelled','Session ID','Session Name','Capacity','Location','Date (IST)','Day of Week','Time','Duration (Minutes)','Teacher Name','Cleaned Product','Cleaned Category','Cleaned Class','Host ID','Month','Year','Class No','Is New','UniqueID1','UniqueID2'] },
];

/* Sheet text is cached until the operator asks for fresh data, not for a fixed window: an
   ordinary page reload must not re-download 165 MB. This value is no longer an expiry — it is
   only the age past which the UI calls the cached copy stale and offers to refresh. */
export const CACHE_STALE_AFTER_MS = 15 * 60 * 1000;

export const LOCATION_SHORT: Record<string, string> = {
  'Kwality House, Kemps Corner': 'Kemps Corner',
  'Kenkere House': 'Kenkere',
  'Plash Pilates': 'Plash',
  'Supreme HQ, Bandra': 'Bandra',
  'Taj Wellington Mews, Colaba, Mumbai': 'Colaba',
  'South United Football Club': 'South United',
  'WeWork Prestige Central': 'WeWork Central',
  'Pop-up': 'Pop-up',
  Online: 'Online',
};

export function sheetUrl(cfg: SheetConfig) {
  const base = `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.title)}`;
  return cfg.select ? `${base}&tq=${encodeURIComponent(cfg.select)}` : base;
}

export const sheetUiUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
