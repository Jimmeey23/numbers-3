/* One concept, one metric.
 *
 * The product's cardinal rule is that the same question must not get two answers on two tabs. This
 * is the list of questions the app answers more than one way, the metric that is allowed to answer
 * each of them, and the variants kept only so the sources can be compared.
 *
 * `scripts/audit-bindings.mts` enforces it statically: a tab that binds a variant instead of the
 * canonical metric fails the build. The Data health reconciliation panel renders it, so wherever a
 * variant still exists the operator can see the gap and its cause rather than discovering it by
 * noticing two different numbers on two screens.
 */
import type { TableName } from './metrics';

export interface ConceptVariant {
  metricId: string;
  table: TableName;
  /** Why this one can differ from the canonical figure. */
  because: string;
}

export interface Concept {
  id: string;
  question: string;
  canonical: { metricId: string; table: TableName };
  variants: ConceptVariant[];
  /** Variance above this is a problem rather than an expected difference in basis. */
  tolerance: number;
}

export const CONCEPTS: Concept[] = [
  {
    id: 'attendance', question: 'How many attended visits were there?', tolerance: 0.02,
    canonical: { metricId: 'visits', table: 'visits' },
    variants: [
      { metricId: 'attendance', table: 'sessions', because: 'The Sessions sheet totals its own CheckedIn column. It covers occurrences the visit feed never sees, including classes nobody attended.' },
      { metricId: 'checkins', table: 'checkins', because: 'The raw Checkins sheet before reconciliation with Bookings; duplicate rows are not yet collapsed.' },
      { metricId: 'b_attended', table: 'bookings', because: 'The Bookings sheet records attendance separately and is known to disagree with Checkins on shared sessions.' },
      { metricId: 'p_customers', table: 'payroll', because: 'Payroll counts customers taught, enriched upstream on its own schedule.' },
    ],
  },
  {
    id: 'bookings_taken', question: 'How many bookings were made?', tolerance: 0.02,
    canonical: { metricId: 'v_booked', table: 'visits' },
    variants: [
      { metricId: 'booked', table: 'sessions', because: 'The Sessions sheet totals its own Booked column per occurrence.' },
      { metricId: 'bookings', table: 'bookings', because: 'Raw Bookings rows, including any the visit reconciliation merged.' },
    ],
  },
  {
    id: 'unique_members', question: 'How many distinct people attended?', tolerance: 0.02,
    canonical: { metricId: 'v_unique_members', table: 'visits' },
    variants: [{ metricId: 'unique_attendees', table: 'checkins', because: 'Counted on raw Checkins rows before reconciliation.' }],
  },
  {
    id: 'late_cancels', question: 'How many late cancellations were there?', tolerance: 0.02,
    canonical: { metricId: 'v_late_cancels', table: 'visits' },
    variants: [
      { metricId: 'late_cancels', table: 'sessions', because: 'Session-level LateCancelled totals from the Sessions sheet.' },
      { metricId: 'c_late_cancels', table: 'checkins', because: 'Raw Checkins flag before reconciliation.' },
      { metricId: 'b_late', table: 'bookings', because: 'The Bookings sheet keeps its own late-cancel flag.' },
      { metricId: 'l_late_cancels', table: 'lapsed', because: 'A lifetime per-membership total, not a count inside the period.' },
    ],
  },
  {
    id: 'no_shows', question: 'How many booked and did not come?', tolerance: 0.02,
    canonical: { metricId: 'v_no_shows', table: 'visits' },
    variants: [
      { metricId: 'no_shows', table: 'sessions', because: 'Derived as Booked − CheckedIn − LateCancelled, which also absorbs any pre-class cancellations the sheet counted as booked.' },
      { metricId: 'b_no_show', table: 'bookings', because: 'The Bookings sheet keeps its own no-show flag.' },
      { metricId: 'l_no_shows', table: 'lapsed', because: 'A lifetime per-membership total, not a count inside the period.' },
    ],
  },
  {
    id: 'late_cancel_rate', question: 'What share of bookings late-cancelled?', tolerance: 0.02,
    canonical: { metricId: 'v_late_cancel_rate', table: 'visits' },
    variants: [
      { metricId: 'late_cancel_rate', table: 'sessions', because: 'Divides by the Sessions sheet’s Booked column rather than by reconciled bookings that reached the class.' },
      { metricId: 'b_late_cancel_rate', table: 'bookings', because: 'Divides by all Bookings rows, including those cancelled well ahead.' },
      { metricId: 'new_late_cancel_rate', table: 'newc', because: 'A mean of each client’s own post-trial rate, so every client counts once regardless of volume.' },
    ],
  },
  {
    id: 'no_show_rate', question: 'What share of bookings were no-shows?', tolerance: 0.02,
    canonical: { metricId: 'v_no_show_rate', table: 'visits' },
    variants: [
      { metricId: 'no_show_rate', table: 'sessions', because: 'Session-level derivation over the sheet’s own Booked column.' },
      { metricId: 'b_no_show_rate', table: 'bookings', because: 'Divides by all Bookings rows, including those cancelled ahead.' },
    ],
  },
  {
    id: 'cancel_rate', question: 'What share of bookings cancelled ahead?', tolerance: 0.02,
    canonical: { metricId: 'v_cancel_rate', table: 'visits' },
    variants: [
      { metricId: 'cancellation_rate', table: 'bookings', because: 'Raw Bookings rows, without the coverage correction the canonical rate applies.' },
      { metricId: 'l_cancel_rate', table: 'lapsed', because: 'A mean of each membership’s own lifetime cancellation rate.' },
    ],
  },
  {
    id: 'show_up_rate', question: 'What share of bookings turned up?', tolerance: 0.02,
    canonical: { metricId: 'v_show_up_rate', table: 'visits' },
    variants: [{ metricId: 'show_up_rate', table: 'sessions', because: 'CheckedIn over Booked from the Sessions sheet.' }],
  },
  {
    id: 'effective_attendance', question: 'What share of bookings became a visit?', tolerance: 0.02,
    canonical: { metricId: 'v_effective_attendance', table: 'visits' },
    variants: [{ metricId: 'effective_attendance', table: 'bookings', because: 'Computed on raw Bookings rows.' }],
  },
  {
    id: 'complimentary_rate', question: 'What share of visits produced no revenue?', tolerance: 0.02,
    canonical: { metricId: 'v_complimentary_rate', table: 'visits' },
    variants: [
      { metricId: 'complimentary_rate', table: 'checkins', because: 'Computed on raw Checkins rows before reconciliation.' },
      { metricId: 'non_paid_rate', table: 'sessions', because: 'Uses the Sessions sheet’s own NonPaid column.' },
    ],
  },
  {
    id: 'rev_per_visit', question: 'What is a visit worth?', tolerance: 0.02,
    canonical: { metricId: 'v_rev_per_visit', table: 'visits' },
    variants: [
      { metricId: 'revenue_per_checkin', table: 'checkins', because: 'Raw Checkins rows before reconciliation.' },
      { metricId: 'rev_pac', table: 'sessions', because: 'Session-attributed revenue over the sheet’s CheckedIn total.' },
      { metricId: 'rev_per_booking', table: 'bookings', because: 'Sale value per booking row, which is a funding value rather than a per-visit allocation.' },
    ],
  },
  {
    id: 'attributed_revenue', question: 'What were the visits in this period worth?', tolerance: 0.02,
    canonical: { metricId: 'v_revenue', table: 'visits' },
    variants: [
      { metricId: 'revenue', table: 'sessions', because: 'The Sessions sheet’s own Revenue column, attributed per occurrence.' },
      { metricId: 'c_paid', table: 'checkins', because: 'Paid value on raw Checkins rows.' },
      { metricId: 'b_revenue', table: 'bookings', because: 'Sale value on bookings — what funded the booking, not what the visit consumed.' },
      { metricId: 'gross_revenue', table: 'sales', because: 'Money received at purchase. A membership bought in March pays for April’s visits, so this is a different question, not a different answer.' },
      { metricId: 'p_revenue', table: 'payroll', because: 'Revenue attributed to trainers by the payroll export’s own rules.' },
    ],
  },
  {
    id: 'lead_time', question: 'How far ahead do people book?', tolerance: 0.05,
    canonical: { metricId: 'v_lead_time', table: 'visits' },
    variants: [{ metricId: 'booking_lead_time_days', table: 'bookings', because: 'Measured from Bookings Sale Date, which may be payment time rather than reservation time.' }],
  },
  {
    id: 'same_day', question: 'What share booked inside a day?', tolerance: 0.02,
    canonical: { metricId: 'v_same_day_share', table: 'visits' },
    variants: [{ metricId: 'same_day_share', table: 'bookings', because: 'Measured on raw Bookings rows.' }],
  },
  {
    id: 'visits_per_member', question: 'How often does a member come?', tolerance: 0.02,
    canonical: { metricId: 'v_visits_per_member', table: 'visits' },
    variants: [{ metricId: 'visits_per_member', table: 'checkins', because: 'Raw Checkins rows before reconciliation.' }],
  },
  {
    id: 'power_users', question: 'How many members came eight or more times?', tolerance: 0.02,
    canonical: { metricId: 'v_power_users', table: 'visits' },
    variants: [{ metricId: 'power_users', table: 'checkins', because: 'Raw Checkins rows before reconciliation.' }],
  },
  {
    id: 'attendee_hours', question: 'How many attendee-hours were delivered?', tolerance: 0.02,
    canonical: { metricId: 'v_attendee_hours', table: 'visits' },
    variants: [{ metricId: 'attendee_hours', table: 'checkins', because: 'Raw Checkins rows before reconciliation.' }],
  },
];
