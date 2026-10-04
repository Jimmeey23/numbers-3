export type SheetKey =
  | 'sessions' | 'recurring' | 'teacherRecurring' | 'sales' | 'new' | 'payroll'
  | 'lapsed' | 'bookings' | 'leads' | 'checkins';

export type Format = 'Barre 57' | 'Cycle' | 'Strength' | 'Pilates' | 'Hosted' | 'Other' | 'Unknown';
export type TimeSlot = 'Morning' | 'Afternoon' | 'Evening';

/** Common dimensions every fact row exposes so one filter predicate works everywhere. */
export interface Dims {
  date: string | null;        // YYYY-MM-DD
  ts: number | null;          // epoch ms
  month: string | null;       // YYYY-MM
  location: string | null;
  location_short: string | null;
  trainer: string | null;
  format: Format | null;
  day: string | null;         // Monday..Sunday
  slot: TimeSlot | null;
  source: string | null;
  membership_type: string | null;
  is_new: boolean | null;
  is_import: boolean;
}

export interface SessionRow extends Dims {
  trainer_id: number | null;
  session_id: string;
  session_name: string | null;
  capacity: number | null;
  checked_in: number | null;
  late_cancelled: number | null;
  booked: number | null;
  complimentary: number | null;
  time: string | null;        // HH:MM
  revenue: number | null;
  non_paid: number | null;
  memberships: number | null;
  packages: number | null;
  intro_offers: number | null;
  single_classes: number | null;
  type: string | null;
  class_name: string | null;
  duration_min: number | null;
  duration_estimated: boolean;
  derived: boolean;
  week: string | null;
  capacity_estimated?: boolean;
}

export interface CheckinRow extends Dims {
  member_id: string | null;
  name: string | null;
  email: string | null;
  contactable: boolean;
  order_ts: number | null;
  paid: number | null;
  payment_method: string | null;
  checked_in: boolean;
  complimentary: boolean;
  late_cancelled: boolean;
  session_id: string | null;
  session_name: string | null;
  capacity: number | null;
  time: string | null;
  duration_min: number | null;
  product: string | null;
  category: string | null;
  class_name: string | null;
  class_no: number | null;
  is_new_label: string | null;
  lead_time_days: number | null;
  slot_uid: string | null;   // UniqueID1|UniqueID2 — identifies the RECURRING SLOT, not one occurrence
  session_key: string | null; // date + slot: the actual class occurrence
}

export interface SaleRow extends Dims {
  member_id: string | null;
  customer: string | null;
  email: string | null;
  sale_item_id: string | null;
  /** Sale-level payment value as supplied. It can repeat on multiple line items. */
  value: number | null;
  /** Payment allocated to this line from list-value weights; safe for category/product shares. */
  category_value: number | null;
  /** Line list value before discount. */
  list_value: number | null;
  /** Raw unit-level and sale-level discounts retained for reconciliation. */
  item_discount: number | null;
  sale_discount: number | null;
  vat: number | null;
  status: string | null;
  method: string | null;
  sold_by: string | null;
  product: string | null;
  category: string | null;
  purchase_type: string | null;
  net: number | null;
  net_reported: number | null;   // the sheet's own column, kept for the Data-health check
  discount: number | null;
  discount_code: string | null;
  sale_id: string | null;
  qty: number | null;
  unit_price: number | null;
  voided: boolean;
  mem_id: string | null;
  mem_start: string | null;
  mem_end: string | null;
  mem_total_classes: number | null;
  mem_classes_left: number | null;
  mem_total_money: number | null;
  mem_money_left: number | null;
  mem_type: string | null;
  mem_frozen: boolean;
  rev_per_credit: number | null;
  hour: number | null;
}

export interface NewRow extends Dims {
  member_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  contactable: boolean;
  first_visit_entity: string | null;
  first_visit_type: string | null;
  payment_method: string | null;
  memberships_used: string[];
  home_location: string | null;
  class_no: number | null;
  is_new_label: string | null;
  visits_post_trial: number | null;
  late_cancels_post_trial: number | null;
  memberships_bought: number | null;
  memberships_bought_products: string[];
  purchase_count: number | null;
  first_purchase_product: string | null;
  first_purchase_value: number | null;
  ltv: number | null;
  retention_status: string | null;
  conversion_status: string | null;
  first_purchase_date: string | null;
  visits: number | null;
  last_visit: string | null;
  days_since_last_visit: number | null;
  conversion_span: number | null;
  days_to_second_visit: number | null;
  locations_visited: number | null;
  ltv_post_trial: number | null;
  total_purchases: number | null;
  days_active: number | null;
  visits_per_month: number | null;
  late_cancel_rate: number | null;
  speed_bucket: string | null;
  lifecycle: string | null;
  converted: boolean;
  retained: boolean;
}

export interface LapsedRow extends Dims {
  member_name: string | null;
  member_id: string | null;
  email: string | null;
  phone: string | null;
  contactable: boolean;
  status: string | null;
  membership_name: string | null;
  sessions_limit: number | null;
  unlimited: boolean;
  purchase_date: string | null;
  start_date: string | null;
  start_ts: number | null;
  end_date: string | null;
  end_ts: number | null;
  churned_date: string | null;
  amount_paid: number | null;
  discount_code: string | null;
  discount_value: number | null;
  original_amount: number | null;
  sold_by: string | null;
  last_visit: string | null;
  first_visit: string | null;
  completed: number | null;
  used_pct: number | null;
  remaining: number | null;
  cancellations: number | null;
  late_cancellations: number | null;
  no_shows: number | null;
  cancel_rate: number | null;
  booking_method: string | null;
  freeze_count: number | null;
  days_frozen: number | null;
  duration_days: number | null;
  days_active: number | null;
  days_since_last_visit: number | null;
  avg_sessions_month: number | null;
  rev_per_session: number | null;
  attendance_rate: number | null;
  churned: boolean;
  active: boolean;
  frozen: boolean;
  single_class: boolean;      // a drop-in or single-class product, not a membership
  qualifies: boolean;         // counts towards membership and churn figures
  days_elapsed: number | null;
  risk_score: number | null;
  risk_inputs: number;        // 0–4: how many of the risk model's inputs were observed
  liability: number | null;
  multi_location: boolean;
  renewed: boolean;
}

export interface PayrollRow extends Dims {
  teacher_id: string | null;
  email: string | null;
  cycle_sessions: number | null; cycle_empty: number | null; cycle_customers: number | null; cycle_paid: number | null;
  strength_sessions: number | null; strength_empty: number | null; strength_customers: number | null; strength_paid: number | null;
  barre_sessions: number | null; barre_empty: number | null; barre_customers: number | null; barre_paid: number | null;
  total_sessions: number | null; total_empty: number | null; total_nonempty: number | null; total_customers: number | null; total_paid: number | null;
  converted: number | null; conversion_rate: number | null; retained: number | null; retention_rate: number | null; new_count: number | null;
}

export interface LeadRow extends Dims {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_ts: number | null;
  source_name: string | null;
  member_id: string | null;
  converted_ts: number | null;
  stage: string | null;
  associate: string | null;
  follow_ups: number[];        // epoch ms for each non-null follow-up
  touches: number;
  center: string | null;
  class_type: string | null;
  status: string | null;
  channel: string | null;
  response_hours: number | null;
  won: boolean;
  lost: boolean;
  open: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  purchases: number | null;
  ltv: number | null;
  visits: number | null;
  trial_status: string | null;
  conversion_status: string | null;
  retention_status: string | null;
  trialed: boolean;
  last_touch_ts: number | null;
  stale: boolean;
  contactable: boolean;
}

export interface BookingRow extends Dims {
  member_id: string | null;
  customer: string | null;
  email: string | null;
  sale_ts: number | null;
  session_ts: number | null;
  value: number | null;
  sale_item: string | null;
  sale_id: string | null;
  payment_method: string | null;
  membership_used: string | null;
  refunded: boolean;
  cancelled: boolean;
  late_cancelled: boolean;
  no_show: boolean;
  attended: boolean;
  teacher: string | null;
  class_name: string | null;
  class_no: number | null;
  is_new_label: string | null;
  time: string | null;
  lead_time_days: number | null;
  derived: boolean;
  slot_uid: string | null;   // UniqueID1|UniqueID2 — identifies the RECURRING SLOT, not one occurrence
  session_key: string | null; // date + slot: the actual class occurrence
}

/** THE canonical visit grain: one row per (session occurrence × member).
 *  Checkins is authoritative for who attended — Bookings is a strict subset of it (283 attendees in
 *  Sep-2026 appear in Checkins and are absent from Bookings entirely). Booking-lifecycle facts
 *  (cancellations, lead time) are joined on where they exist. Every tab counts visits from here,
 *  so "visits" can never mean two different things on two tabs. */
export interface VisitRow extends Dims {
  session_key: string | null;
  session_id: string | null;
  slot_uid: string | null;
  member_id: string | null;
  member_name: string | null;
  email: string | null;
  time: string | null;
  class_name: string | null;
  capacity: number | null;
  attended: boolean;
  late_cancelled: boolean;
  cancelled: boolean;         // cancelled ahead of the class (only visible via Bookings)
  no_show: boolean;
  complimentary: boolean;
  paid: number | null;
  product: string | null;
  category: string | null;
  class_no: number | null;
  is_new_label: string | null;
  lead_time_days: number | null;
  booked_ts: number | null;
  in_checkins: boolean;
  in_bookings: boolean;
  duration_min: number | null;
}

export interface SheetLoad {
  key: SheetKey;
  title: string;
  spreadsheetId: string;
  status: 'ok' | 'error' | 'empty' | 'derived' | 'pending' | 'unused';
  rows: number;
  columns: string[];
  expected: string[];
  missing: string[];
  extra: string[];
  loadMs: number;
  fromCache: boolean;
  fetchedAt: number | null;
  error?: string;
  hint?: string;
  url?: string;
  overridden?: boolean;
}

export interface Defect {
  id: string;
  sheet: string;
  column: string;
  description: string;
  rowsAffected: number;
  impact: string;
  status: 'open' | 'mitigated';
}

export interface Dataset {
  visits: VisitRow[];
  sessions: SessionRow[];
  checkins: CheckinRow[];
  sales: SaleRow[];
  newc: NewRow[];
  lapsed: LapsedRow[];
  payroll: PayrollRow[];
  leads: LeadRow[];
  bookings: BookingRow[];
  loads: SheetLoad[];
  defects: Defect[];
  today: string;            // operational today, IST wall clock (YYYY-MM-DD)
  todayTs: number;
  dataThrough: string;      // latest observation on or before today — source freshness, not "now"

  loadedAt: number;
  /** Metric ids whose only source column is present but never populated. */
  emptyColumnMetrics: string[];
}
