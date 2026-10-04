# METRICS — implemented registry

Generated from `src/semantics/metrics.ts` (237 definitions). Every card, table column, chart and insight imports from this file; nothing is computed inline in a component.

Rules enforced by the engine:

- **Rates never average.** `aggregation: weighted` recomputes SUM(numerator)/SUM(denominator) at every rollup level and in totals rows.
- **Null ≠ zero.** Sums over all-null inputs return null and render as —.
- **Min sample.** Below `minSample` a value renders dimmed with an n= marker; ranking lists exclude it and footnote the exclusion.
- **Deltas.** Percentage-point for `percent` metrics, relative % for everything else.
- **Suspect inputs.** Metrics with a `suspect` hook render ⚠ while the Data-health check fails (currently every duration-derived metric, because `Checkins.Duration (Minutes)` is corrupted).

## Attendance

| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |
|---|---|---|---|---|---|---|---|---|
| `sessions` | Sessions | sessions | count | integer | ↑ | 1 | `COUNT(SessionID)` | Sessions.SessionID |
| `seats` | Seats offered | sessions | sum | integer | ↑ | 1 | `SUM(Capacity)` | Sessions.Capacity |
| `attendance` | Attendance | sessions | sum | integer | ↑ | 1 | `SUM(CheckedIn)` | Sessions.CheckedIn |
| `booked` | Booked | sessions | sum | integer | ↑ | 1 | `SUM(Booked)` | Sessions.Booked |
| `fill_rate` | Fill rate | sessions | weighted | percent | ↑ (target 60%) | 5 | `SUM(CheckedIn) / NULLIF(SUM(Capacity),0)` | Sessions.CheckedIn, Sessions.Capacity |
| `booking_fill_rate` | Booking fill rate | sessions | weighted | percent | ↑ | 5 | `SUM(Booked) / NULLIF(SUM(Capacity),0)` | Sessions.Booked, Sessions.Capacity |
| `show_up_rate` | Show-up rate | sessions | weighted | percent | ↑ (target 85%) | 5 | `SUM(CheckedIn) / NULLIF(SUM(Booked),0)` | Sessions.CheckedIn, Sessions.Booked |
| `avg_class_size_incl` | Avg class size | sessions | weighted | decimal | ↑ | 3 | `SUM(CheckedIn) / NULLIF(COUNT(SessionID),0)` | Sessions.CheckedIn, Sessions.SessionID |
| `avg_class_size_excl` | Avg size (non-empty) | sessions | weighted | decimal | ↑ | 3 | `SUM(CheckedIn) / NULLIF(COUNT(*) FILTER (CheckedIn>0),0)` | Sessions.CheckedIn |
| `reliability` | Reliability | sessions | weighted | percent | ↑ | 5 | `1 − empty_session_rate` | Sessions.CheckedIn |
| `attendance_cv` | Consistency (CV) | sessions | custom | ratio | ↓ | 5 | `STDDEV(CheckedIn) / NULLIF(AVG(CheckedIn),0)` | Sessions.CheckedIn |
| `seat_hours` | Seat-hours | sessions | sum | integer | ↑ | 1 | `SUM(Capacity × duration_hours)` | Sessions.Capacity |
| `active_slots` | Active slots | sessions | distinct | integer | ↑ | 1 | `COUNT(DISTINCT location, day, time, class)` | Sessions.Location, Sessions.Day, Sessions.Time, Sessions.Class |
| `visits` | Visits | visits | count | integer | ↑ | 1 | `COUNT(*) FILTER (attended)` | Checkins.Checked In, Bookings.Attended |
| `v_booked` | Bookings taken | visits | count | integer | ↑ | 1 | `COUNT(*)` | Checkins.Session ID, Bookings.Sale Id |
| `v_sessions` | Class occurrences | visits | distinct | integer | ↑ | 1 | `COUNT(DISTINCT session_key)` | Checkins.Session ID, Checkins.Date (IST) |
| `v_slots` | Recurring slots | visits | distinct | integer | ↑ | 1 | `COUNT(DISTINCT UniqueID1\|UniqueID2)` | Checkins.UniqueID1, Checkins.UniqueID2 |
| `v_visits_per_member` | Visits per member | visits | custom | decimal | ↑ | 5 | `visits / unique members` | Checkins.Member ID |
| `v_attendance_per_session` | Attendance per class | visits | custom | decimal | ↑ | 3 | `visits / COUNT(DISTINCT session_key)` | Checkins.Session ID |
| `v_show_up_rate` | Show-up rate | visits | weighted | percent | ↑ (target 85%) | 10 | `attended / (bookings − cancelled ahead)` | Checkins.Checked In, Bookings.Cancelled |
| `v_effective_attendance` | Effective attendance | visits | weighted | percent | ↑ (target 85%) | 10 | `attended / all bookings` | Checkins.Checked In |
| `v_fill_rate` | Fill rate | visits | custom | percent | ↑ (target 60%) | 5 | `visits / SUM(capacity per occurrence)` | Checkins.Checked In, Checkins.Capacity |
| `v_lead_time` | Booking lead time | visits | avg | days | ↑ | 10 | `AVG(class date − booking date)` | Checkins.Order At, Bookings.Sale Date |
| `v_same_day_share` | Same-day bookings | visits | weighted | percent | ↓ | 10 | `COUNT(*) FILTER (lead time < 1 day) / bookings with a lead time` | Checkins.Order At |
| `v_attendee_hours` | Attendee-hours | visits | sum | hours | ↑ | 1 | `SUM(duration) over attended visits` | Checkins.Duration (Minutes) |
| `avg_visits_post_trial` | Visits post-trial | newc | avg | decimal | ↑ | 5 | `AVG("Visits Post Trial") FILTER (new)` | New.Visits Post Trial |
| `sessions_limit_sum` | Sessions limit | lapsed | sum | integer | ↑ | 1 | `SUM("Sessions Limit")` | Lapsed.Sessions Limit |
| `completed_sessions` | Completed | lapsed | sum | integer | ↑ | 1 | `SUM("Completed Sessions")` | Lapsed.Completed Sessions |
| `l_attendance_rate` | Attendance rate | lapsed | avg | percent | ↑ | 5 | `AVG("Attendance Rate %")` | Lapsed.Attendance Rate % |
| `avg_sessions_month` | Sessions per month | lapsed | avg | decimal | ↑ | 3 | `AVG("Average Sessions Per Month")` | Lapsed.Average Sessions Per Month |
| `bookings` | Bookings | bookings | count | integer | ↑ | 1 | `COUNT(*)` | Bookings.Sale Id |
| `b_attended` | Attended | bookings | count | integer | ↑ | 1 | `COUNT(*) FILTER (Attended)` | Bookings.Attended |
| `effective_attendance` | Effective attendance | bookings | weighted | percent | ↑ (target 85%) | 5 | `1 − (cancel_rate + late_cancel_rate + no_show_rate)` | Bookings.Cancelled, Bookings.Late Cancelled, Bookings.No Show |
| `booking_lead_time_days` | Avg lead time | bookings | avg | days | ↑ | 5 | `AVG(DATEDIFF("Session Date","Sale Date"))` | Bookings.Session Date, Bookings.Sale Date |
| `same_day_share` | Same-day share | bookings | weighted | percent | ↓ | 5 | `COUNT(*) FILTER (lead_time < 1) / COUNT(*)` | Bookings.Session Date, Bookings.Sale Date |
| `lead_visits` | Visits per lead | leads | avg | decimal | ↑ | 10 | `AVG(Visits)` | Leads.Visits |
| `checkins` | Check-ins | checkins | count | integer | ↑ | 1 | `COUNT(*) FILTER ("Checked In")` | Checkins.Checked In |
| `visits_per_member` | Visits per member | checkins | custom | decimal | ↑ | 3 | `checkins / unique_attendees` | Checkins.Checked In, Checkins.Member ID |
| `class_hours` | Class-hours | checkins | custom | hours | ↑ | 1 | `COUNT(DISTINCT "Session ID") × duration / 60` | Checkins.Session ID, Checkins.Duration (Minutes) |
| `attendee_hours` | Attendee-hours | checkins | sum | hours | ↑ | 1 | `checkins × duration / 60` | Checkins.Duration (Minutes) |
| `avg_days_between_visits` | Days between visits | checkins | custom | days | ↓ | 5 | `AVG(gap between consecutive check-ins per member)` | Checkins.Member ID, Checkins.Date (IST) |
| `c_bookings` | Bookings | checkins | count | integer | ↑ | 1 | `COUNT(*)` | Checkins.Session ID |
| `p_customers` | Customers | payroll | sum | integer | ↑ | 1 | `SUM("Total Customers")` | Payroll.Total Customers |
| `p_avg_per_session` | Avg per session | payroll | weighted | decimal | ↑ | 3 | `SUM("Total Customers") / SUM("Total Sessions")` | Payroll.Total Customers, Payroll.Total Sessions |

## Risk

| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |
|---|---|---|---|---|---|---|---|---|
| `no_shows` | No-shows | sessions | sum | integer | ↓ | 1 | `SUM(Booked − CheckedIn − LateCancelled)` | Sessions.Booked, Sessions.CheckedIn, Sessions.LateCancelled |
| `no_show_rate` | No-show rate | sessions | weighted | percent | ↓ (target 10%) | 5 | `no_shows / NULLIF(SUM(Booked),0)` | Sessions.Booked, Sessions.CheckedIn, Sessions.LateCancelled |
| `late_cancels` | Late cancellations | sessions | sum | integer | ↓ | 1 | `SUM(LateCancelled)` | Sessions.LateCancelled |
| `late_cancel_rate` | Late-cancel rate | sessions | weighted | percent | ↓ (target 8%) | 5 | `SUM(LateCancelled) / NULLIF(SUM(Booked),0)` | Sessions.LateCancelled, Sessions.Booked |
| `empty_sessions` | Empty sessions | sessions | count | integer | ↓ | 1 | `COUNT(*) FILTER (CheckedIn = 0)` | Sessions.CheckedIn |
| `empty_session_rate` | Empty-session rate | sessions | weighted | percent | ↓ (target 5%) | 5 | `empty_sessions / NULLIF(COUNT(SessionID),0)` | Sessions.CheckedIn, Sessions.SessionID |
| `unsold_seats` | Unsold seats | sessions | sum | integer | ↓ | 1 | `SUM(Capacity) − SUM(CheckedIn)` | Sessions.Capacity, Sessions.CheckedIn |
| `lost_revenue` | Lost revenue | sessions | custom | currency | ↓ | 3 | `unsold_seats × rev_pac` | Sessions.Capacity, Sessions.CheckedIn, Sessions.Revenue |
| `below_break_even` | Below break-even | sessions | count | integer | ↓ | 1 | `COUNT(*) FILTER (Revenue < rate_per_session)` | Settings.rate_per_session, Sessions.Revenue |
| `trainer_dependency_index` | Trainer dependency | sessions | custom | percent | ↓ | 3 | `top1_attendance / NULLIF(top5_combined_attendance,0)` | Sessions.Trainer, Sessions.CheckedIn, Recurring.Top5Trainers |
| `top3_revenue_concentration` | Top-3 revenue concentration | sessions | custom | percent | ↓ | 5 | `SUM(Revenue) of top-3 trainers / SUM(Revenue)` | Sessions.Trainer, Sessions.Revenue |
| `v_no_shows` | No-shows | visits | count | integer | ↓ | 1 | `COUNT(*) FILTER (no_show)` | Checkins.Checked In, Checkins.Is Late Cancelled |
| `v_no_show_rate` | No-show rate | visits | weighted | percent | ↓ (target 10%) | 10 | `no_shows / (bookings − cancelled ahead)` | Checkins.Checked In |
| `v_late_cancels` | Late cancellations | visits | count | integer | ↓ | 1 | `COUNT(*) FILTER (late_cancelled)` | Checkins.Is Late Cancelled |
| `v_late_cancel_rate` | Late-cancel rate | visits | weighted | percent | ↓ (target 8%) | 10 | `late cancellations / bookings` | Checkins.Is Late Cancelled |
| `v_cancelled` | Cancelled ahead | visits | count | integer | ↓ | 1 | `COUNT(*) FILTER (cancelled)` | Bookings.Cancelled |
| `v_cancel_rate` | Cancellation rate | visits | weighted | percent | ↓ | 10 | `cancelled / bookings covered by the Bookings sheet` | Bookings.Cancelled |
| `v_source_agreement` | Source agreement | visits | weighted | percent | ↑ | 10 | `COUNT(*) FILTER (in both) / COUNT(*)` | Checkins.Session ID, Bookings.UniqueID1 |
| `deferred_revenue` | Deferred revenue | sales | sum | currency | ↓ | 1 | `SUM("Sec. Membership Money Left")` | Sales.Sec. Membership Money Left |
| `unused_session_liability` | Unused session liability | sales | sum | currency | ↓ | 1 | `SUM("Sec. Membership Classes Left" × rev_per_credit)` | Sales.Sec. Membership Classes Left, Sales.Sec. Membership Revenue Per Event Credit Incl VAT |
| `voided_rate` | Voided rate | sales | weighted | percent | ↓ | 5 | `COUNT(*) FILTER ("Sec. Is Voided") / COUNT(*)` | Sales.Sec. Is Voided |
| `zero_return_rate` | Zero-return rate | newc | weighted | percent | ↓ | 10 | `COUNT(*) FILTER ("Visits Post Trial"=0) / NULLIF(new_clients,0)` | New.Visits Post Trial, New.Is New |
| `new_churn_rate` | Churned share | newc | weighted | percent | ↓ | 10 | `COUNT(*) FILTER (Lifecycle='Churned') / new_clients` | New.Lifecycle Status |
| `at_risk_actives` | At-risk actives | newc | count | integer | ↓ | 1 | `COUNT(*) FILTER (Lifecycle='Active' AND "Days Since Last Visit">21)` | New.Lifecycle Status, New.Days Since Last Visit |
| `new_late_cancel_rate` | Late-cancel rate | newc | avg | percent | ↓ | 5 | `AVG("Late Cancel Rate Post Trial")` | New.Late Cancel Rate Post Trial |
| `memberships` | Memberships | lapsed | count | integer | ↑ | 1 | `COUNT(*)` | Lapsed.Member ID |
| `churned_memberships` | Churned | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER ("Churned Date" IS NOT NULL OR Status=Lapsed)` | Lapsed.Churned Date, Lapsed.Status |
| `churn_rate` | Churn rate | lapsed | weighted | percent | ↓ | 10 | `COUNT(*) FILTER ("Churned Date" IS NOT NULL) / NULLIF(COUNT(*),0)` | Lapsed.Churned Date |
| `utilisation` | Utilisation | lapsed | weighted | percent | ↑ (target 70%) | 5 | `SUM("Completed Sessions") / NULLIF(SUM("Sessions Limit"),0)` | Lapsed.Completed Sessions, Lapsed.Sessions Limit |
| `zero_usage_memberships` | Zero-usage memberships | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER ("Completed Sessions"=0 AND days_elapsed>7)` | Lapsed.Completed Sessions, Lapsed.Start Date |
| `dormant_actives` | Dormant actives | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER (Status=Active AND "Days Since Last Visit">21)` | Lapsed.Status, Lapsed.Days Since Last Visit |
| `revenue_at_risk_30d` | Revenue at risk (30d) | lapsed | sum | currency | ↓ | 1 | `SUM("Amount Paid") FILTER ("End Date" BETWEEN today AND today+30)` | Lapsed.Amount Paid, Lapsed.End Date |
| `expiring_30d` | Expiring in 30 days | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER (active AND "End Date" BETWEEN today AND today+30)` | Lapsed.End Date |
| `avg_tenure_at_churn` | Avg tenure at churn | lapsed | avg | days | ↑ | 5 | `AVG("Membership Duration (Days)") FILTER (churned)` | Lapsed.Membership Duration (Days), Lapsed.Churned Date |
| `avg_duration` | Avg duration | lapsed | avg | days | ↑ | 5 | `AVG("Membership Duration (Days)")` | Lapsed.Membership Duration (Days) |
| `liability` | Liability value | lapsed | sum | currency | ↓ | 1 | `SUM("Remaining Sessions" × "Revenue Per Session")` | Lapsed.Remaining Sessions, Lapsed.Revenue Per Session |
| `remaining_sessions` | Remaining | lapsed | sum | integer | ↓ | 1 | `SUM("Remaining Sessions")` | Lapsed.Remaining Sessions |
| `l_cancel_rate` | Cancellation rate | lapsed | avg | percent | ↓ | 5 | `AVG("Cancellation Rate %")` | Lapsed.Cancellation Rate % |
| `l_late_cancels` | Late cancels | lapsed | sum | integer | ↓ | 1 | `SUM("Late Cancellations")` | Lapsed.Late Cancellations |
| `l_no_shows` | No-shows | lapsed | sum | integer | ↓ | 1 | `SUM("No Shows")` | Lapsed.No Shows |
| `avg_days_since_visit` | Days since last visit | lapsed | avg | days | ↓ | 3 | `AVG("Days Since Last Visit")` | Lapsed.Days Since Last Visit |
| `freeze_rate` | Freeze rate | lapsed | weighted | percent | ↓ | 5 | `COUNT(*) FILTER ("Membership Freeze Count">0) / COUNT(*)` | Lapsed.Membership Freeze Count |
| `days_frozen` | Days frozen | lapsed | sum | integer | ↓ | 1 | `SUM("Days Frozen")` | Lapsed.Days Frozen |
| `risk_score` | Risk score | lapsed | avg | score | ↓ | 1 | `w1(1−util) + w2 norm(days_since_visit) + w3 cancel_rate + w4 (1−attendance_rate), ×100` | Lapsed.Sessions Used %, Lapsed.Days Since Last Visit, Lapsed.Cancellation Rate %, Lapsed.Attendance Rate % |
| `churn_speed` | Days to churn | lapsed | median | days | ↑ | 5 | `MEDIAN("Membership Duration (Days)") FILTER (churned)` | Lapsed.Membership Duration (Days) |
| `utilisation_at_churn` | Utilisation at churn | lapsed | weighted | percent | ↑ | 5 | `SUM(completed) / SUM(limit) FILTER (churned)` | Lapsed.Completed Sessions, Lapsed.Sessions Limit |
| `never_activated` | Never activated | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER (Status = Not Activated)` | Lapsed.Status |
| `at_risk_value` | Value at risk | lapsed | sum | currency | ↓ | 1 | `SUM("Amount Paid") FILTER (active AND risk ≥ 60)` | Lapsed.Amount Paid |
| `high_risk_members` | High-risk actives | lapsed | count | integer | ↓ | 1 | `COUNT(*) FILTER (active AND risk ≥ 60)` | Lapsed.Sessions Used %, Lapsed.Days Since Last Visit, Lapsed.Cancellation Rate %, Lapsed.Attendance Rate % |
| `avg_gap_between_memberships` | Gap between memberships | lapsed | custom | days | ↓ | 5 | `MEDIAN(next start − previous end) per member` | Lapsed.Start Date, Lapsed.End Date |
| `b_cancelled` | Cancelled | bookings | count | integer | ↓ | 1 | `COUNT(*) FILTER (Cancelled)` | Bookings.Cancelled |
| `b_late` | Late cancelled | bookings | count | integer | ↓ | 1 | `COUNT(*) FILTER ("Late Cancelled")` | Bookings.Late Cancelled |
| `b_no_show` | No-shows | bookings | count | integer | ↓ | 1 | `COUNT(*) FILTER ("No Show")` | Bookings.No Show |
| `cancellation_rate` | Cancellation rate | bookings | weighted | percent | ↓ | 5 | `COUNT(*) FILTER (Cancelled) / COUNT(*)` | Bookings.Cancelled |
| `b_late_cancel_rate` | Late-cancel rate | bookings | weighted | percent | ↓ | 5 | `COUNT(*) FILTER ("Late Cancelled") / COUNT(*)` | Bookings.Late Cancelled |
| `b_no_show_rate` | No-show rate | bookings | weighted | percent | ↓ (target 10%) | 5 | `COUNT(*) FILTER ("No Show") / COUNT(*)` | Bookings.No Show |
| `refund_rate` | Refund rate | bookings | weighted | percent | ↓ | 5 | `COUNT(*) FILTER (Refunded) / COUNT(*)` | Bookings.Refunded |
| `untouched_leads` | Untouched leads | leads | count | integer | ↓ | 1 | `COUNT(*) FILTER ("Follow Up 1 Date" IS NULL AND age>48h)` | Leads.Follow Up 1 Date, Leads.Created At |
| `stale_leads` | Stale leads | leads | count | integer | ↓ | 1 | `COUNT(*) FILTER (open AND last touch > 14d)` | Leads.Follow Up 4 Date |
| `lost_leads` | Lost | leads | count | integer | ↓ | 1 | `COUNT(*) FILTER (Lost)` | Leads.Status |
| `c_late_cancels` | Late cancels | checkins | count | integer | ↓ | 1 | `COUNT(*) FILTER ("Is Late Cancelled")` | Checkins.Is Late Cancelled |
| `p_empty` | Empty | payroll | sum | integer | ↓ | 1 | `SUM("Total Empty Sessions")` | Payroll.Total Empty Sessions |
| `p_empty_rate` | Empty rate | payroll | weighted | percent | ↓ | 3 | `SUM("Total Empty Sessions") / SUM("Total Sessions")` | Payroll.Total Empty Sessions, Payroll.Total Sessions |
| `p_cost` | Payroll cost | payroll | sum | currency | ↓ | 1 | `SUM("Total Sessions") × rate_per_session` | Settings.rate_per_session, Payroll.Total Sessions |
| `payroll_pct_of_revenue` | Payroll % of revenue | payroll | weighted | percent | ↓ (target 40%) | 3 | `SUM(sessions × rate) / NULLIF(SUM("Total Paid"),0)` | Settings.rate_per_session, Payroll.Total Paid, Payroll.Total Sessions |
| `p_empty_cost` | Cost of empty sessions | payroll | sum | currency | ↓ | 1 | `SUM("Total Empty Sessions") × rate_per_session` | Settings.rate_per_session, Payroll.Total Empty Sessions |

## Growth

| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |
|---|---|---|---|---|---|---|---|---|
| `overbooked_sessions` | Overbooked sessions | sessions | count | integer | ↑ | 1 | `COUNT(*) FILTER (Booked > Capacity)` | Sessions.Booked, Sessions.Capacity |
| `intro_att_share` | Intro share | sessions | weighted | percent | ↑ | 5 | `SUM(IntroOffers) / SUM(all payment types)` | Sessions.IntroOffers |
| `intro_penetration` | Intro per session | sessions | weighted | decimal | ↑ | 3 | `SUM(IntroOffers) / NULLIF(COUNT(SessionID),0)` | Sessions.IntroOffers, Sessions.SessionID |
| `v_unique_members` | Unique members | visits | distinct | integer | ↑ | 1 | `COUNT(DISTINCT member) FILTER (attended)` | Checkins.Member ID |
| `v_new_share` | First-time share | visits | weighted | percent | ↑ | 10 | `COUNT(*) FILTER (attended AND is new) / visits` | Checkins.Is New |
| `v_repeat_rate` | Repeat-visit rate | visits | custom | percent | ↑ | 10 | `members with >1 visit / attending members` | Checkins.Member ID |
| `v_power_users` | Power users | visits | custom | integer | ↑ | 1 | `COUNT(DISTINCT member) FILTER (visits ≥ 8)` | Checkins.Member ID |
| `unique_buyers` | Unique buyers | sales | distinct | integer | ↑ | 1 | `COUNT(DISTINCT "Member ID")` | Sales.Member ID |
| `repeat_buyer_rate` | Repeat rate | sales | custom | percent | ↑ | 5 | `COUNT(DISTINCT member with >1 sale) / COUNT(DISTINCT member)` | Sales.Member ID, Sales.Sale ID |
| `new_clients` | New clients | newc | count | integer | ↑ | 1 | `COUNT(*) FILTER ("Is New" LIKE 'New%')` | New.Is New |
| `conversion_rate` | Conversion rate | newc | weighted | percent | ↑ (target 30%) | 10 | `COUNT(*) FILTER (Converted) / NULLIF(new_clients,0)` | New.Conversion Status, New.Is New |
| `second_visit_rate` | Second-visit rate | newc | weighted | percent | ↑ (target 50%) | 10 | `COUNT(*) FILTER ("Visits Post Trial">0) / NULLIF(new_clients,0)` | New.Visits Post Trial, New.Is New |
| `avg_conversion_span` | Avg conversion span | newc | avg | days | ↓ | 5 | `AVG("Conversion Span (Days)") FILTER (converted)` | New.Conversion Span (Days) |
| `median_conversion_span` | Median conversion span | newc | median | days | ↓ | 5 | `MEDIAN("Conversion Span (Days)") FILTER (converted)` | New.Conversion Span (Days) |
| `retention_rate` | Retention rate | newc | weighted | percent | ↑ | 10 | `COUNT(*) FILTER ("Retention Status"='Retained') / COUNT(*) FILTER (new)` | New.Retention Status |
| `active_members` | Active member base | newc | count | integer | ↑ | 1 | `COUNT(*) FILTER (Lifecycle='Active')` | New.Lifecycle Status |
| `survival_90` | 90-day survival | newc | weighted | percent | ↑ | 5 | `COUNT(*) FILTER (converted AND "Days Active" ≥ 90) / COUNT(*) FILTER (converted)` | New.Days Active, New.Conversion Status |
| `converted_count` | Converted | newc | count | integer | ↑ | 1 | `COUNT(*) FILTER (Converted)` | New.Conversion Status |
| `membership_buyers` | Bought membership | newc | count | integer | ↑ | 1 | `COUNT(*) FILTER ("Memberships Bought Post Trial">0)` | New.Memberships Bought Post Trial |
| `active_memberships` | Active memberships | lapsed | count | integer | ↑ | 1 | `COUNT(*) FILTER (Status IN (Active, Frozen, New))` | Lapsed.Status |
| `renewal_rate` | Renewed share | lapsed | weighted | percent | ↑ | 10 | `COUNT(*) FILTER (Status=Renewed) / COUNT(*)` | Lapsed.Status |
| `new_memberships` | New memberships | lapsed | count | integer | ↑ | 1 | `COUNT(*) FILTER ("Purchase Date" in period)` | Lapsed.Purchase Date |
| `memberships_per_member` | Memberships per member | lapsed | custom | decimal | ↑ | 5 | `COUNT(*) / COUNT(DISTINCT "Member ID")` | Lapsed.Member ID |
| `repeat_member_rate` | Repeat purchase rate | lapsed | custom | percent | ↑ | 10 | `members with >1 membership / all members` | Lapsed.Member ID |
| `winback_rate` | Win-back rate | lapsed | custom | percent | ↑ | 10 | `members with a purchase after a churn / members who churned` | Lapsed.Member ID, Lapsed.Churned Date, Lapsed.Purchase Date |
| `unique_bookers` | Unique bookers | bookings | distinct | integer | ↑ | 1 | `COUNT(DISTINCT "Member Id")` | Bookings.Member Id |
| `lead_conversion_rate` | Win rate | leads | weighted | percent | ↑ | 5 | `COUNT(*) FILTER (Status=Won) / COUNT(*)` | Leads.Status |
| `time_to_convert` | Time to convert | leads | avg | days | ↓ | 5 | `AVG(DATEDIFF("Converted To Customer At","Created At"))` | Leads.Converted To Customer At, Leads.Created At |
| `won_leads` | Won | leads | count | integer | ↑ | 1 | `COUNT(*) FILTER (Won)` | Leads.Status |
| `lead_trial_rate` | Trial rate | leads | weighted | percent | ↑ | 10 | `COUNT(*) FILTER (trialed) / COUNT(*)` | Leads.Trial Status, Leads.Visits |
| `unique_attendees` | Unique attendees | checkins | distinct | integer | ↑ | 1 | `COUNT(DISTINCT "Member ID") FILTER ("Checked In")` | Checkins.Member ID |
| `new_share` | New share | checkins | weighted | percent | ↑ | 5 | `COUNT(*) FILTER ("Is New" LIKE New%) / checkins` | Checkins.Is New |
| `power_users` | Power users | checkins | custom | integer | ↑ | 1 | `COUNT(DISTINCT member) FILTER (visits ≥ 8)` | Checkins.Member ID |
| `mau` | Monthly active | checkins | custom | integer | ↑ | 1 | `COUNT(DISTINCT member) FILTER (month = latest)` | Checkins.Member ID, Checkins.Date (IST) |
| `p_converted` | Converted | payroll | sum | integer | ↑ | 1 | `SUM(Converted)` | Payroll.Converted |
| `p_conversion_rate` | Conversion rate | payroll | weighted | percent | ↑ | 3 | `SUM(Converted) / NULLIF(SUM(New),0)` | Payroll.Converted, Payroll.New |
| `p_retained` | Retained | payroll | sum | integer | ↑ | 1 | `SUM(Retained)` | Payroll.Retained |
| `p_retention_rate` | Retention rate | payroll | weighted | percent | ↑ | 3 | `SUM(Retained) / NULLIF(SUM(New),0)` | Payroll.Retained, Payroll.New |
| `p_new` | New handled | payroll | sum | integer | ↑ | 1 | `SUM(New)` | Payroll.New |

## Revenue

| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |
|---|---|---|---|---|---|---|---|---|
| `complimentary` | Complimentary | sessions | sum | integer | ↓ | 1 | `SUM(Complimentary)` | Sessions.Complimentary |
| `revenue` | Revenue | sessions | sum | currency | ↑ | 1 | `SUM(Revenue)` | Sessions.Revenue |
| `revenue_per_session` | Revenue per session | sessions | weighted | currency | ↑ | 3 | `SUM(Revenue) / NULLIF(COUNT(SessionID),0)` | Sessions.Revenue, Sessions.SessionID |
| `rev_pac` | Revenue per attendee | sessions | weighted | currency | ↑ | 3 | `SUM(Revenue) / NULLIF(SUM(CheckedIn),0)` | Sessions.Revenue, Sessions.CheckedIn |
| `rev_pas` | Revenue per seat | sessions | weighted | currency | ↑ | 3 | `SUM(Revenue) / NULLIF(SUM(Capacity),0)` | Sessions.Revenue, Sessions.Capacity |
| `paid_attendance` | Paid attendance | sessions | sum | integer | ↑ | 1 | `SUM(CheckedIn) − SUM(NonPaid)` | Sessions.CheckedIn, Sessions.NonPaid |
| `non_paid_rate` | Non-paid rate | sessions | weighted | percent | ↓ | 5 | `SUM(NonPaid) / NULLIF(SUM(CheckedIn),0)` | Sessions.NonPaid, Sessions.CheckedIn |
| `membership_att_share` | Membership share | sessions | weighted | percent | ↑ | 5 | `SUM(Memberships) / NULLIF(SUM(Memberships+Packages+IntroOffers+SingleClasses),0)` | Sessions.Memberships, Sessions.Packages, Sessions.IntroOffers, Sessions.SingleClasses |
| `package_att_share` | Package share | sessions | weighted | percent | ↑ | 5 | `SUM(Packages) / SUM(all payment types)` | Sessions.Packages |
| `single_att_share` | Single-class share | sessions | weighted | percent | ↓ | 5 | `SUM(SingleClasses) / SUM(all payment types)` | Sessions.SingleClasses |
| `revenue_per_hour` | Revenue per hour | sessions | weighted | currency | ↑ | 3 | `SUM(Revenue) / NULLIF(SUM(duration_hours),0)` | Sessions.Revenue, Checkins.Duration (Minutes) |
| `rev_per_seat_hour` | Revenue per seat-hour | sessions | weighted | currency | ↑ | 3 | `SUM(Revenue) / NULLIF(SUM(seat_hours),0)` | Sessions.Revenue, Sessions.Capacity |
| `break_even_class_size` | Break-even size | sessions | custom | decimal | ↓ | 3 | `rate_per_session / NULLIF(rev_pac,0)` | Settings.rate_per_session, Sessions.Revenue, Sessions.CheckedIn |
| `gap_to_break_even` | Gap to break-even | sessions | custom | decimal | ↑ | 3 | `avg_class_size_incl − break_even_class_size` | Settings.rate_per_session, Sessions.Revenue, Sessions.CheckedIn |
| `v_revenue` | Attributed revenue | visits | sum | currency | ↑ | 1 | `SUM(paid) FILTER (attended)` | Checkins.Paid |
| `v_rev_per_visit` | Revenue per visit | visits | weighted | currency | ↑ | 5 | `SUM(paid) / visits` | Checkins.Paid |
| `v_rev_per_member` | Revenue per member | visits | custom | currency | ↑ | 5 | `SUM(paid) / unique members` | Checkins.Paid, Checkins.Member ID |
| `v_complimentary_rate` | Complimentary rate | visits | weighted | percent | ↓ | 10 | `COUNT(*) FILTER (attended AND paid = 0) / visits` | Checkins.Paid, Checkins.Complementary |
| `gross_revenue` | Gross revenue | sales | sum | currency | ↑ | 1 | `SUM("Payment Value")` | Sales.Payment Value |
| `net_revenue` | Net of VAT | sales | sum | currency | ↑ | 1 | `SUM("Payment Value" − "Payment VAT")` | Sales.Payment Value, Sales.Payment VAT |
| `vat` | VAT | sales | sum | currency | ↑ | 1 | `SUM("Payment VAT")` | Sales.Payment VAT |
| `transactions` | Transactions | sales | distinct | integer | ↑ | 1 | `COUNT(DISTINCT "Sale ID")` | Sales.Sale ID |
| `units` | Units | sales | sum | integer | ↑ | 1 | `SUM("Sale Item Quantity")` | Sales.Sale Item Quantity |
| `aov` | Average order value | sales | custom | currency | ↑ | 3 | `SUM("Payment Value") / NULLIF(COUNT(DISTINCT "Sale ID"),0)` | Sales.Payment Value, Sales.Sale ID |
| `arpu` | Revenue per buyer | sales | custom | currency | ↑ | 3 | `SUM("Payment Value") / NULLIF(COUNT(DISTINCT "Member ID"),0)` | Sales.Payment Value, Sales.Member ID |
| `discount_value` | Discount given | sales | sum | currency | ↓ | 1 | `SUM("Discount Value In Currency")` | Sales.Discount Value In Currency |
| `discount_rate` | Discount rate | sales | weighted | percent | ↓ (target 10%) | 5 | `SUM(discount) / NULLIF(SUM("Payment Value") + SUM(discount),0)` | Sales.Discount Value In Currency, Sales.Payment Value |
| `discounted_share` | Discounted share | sales | weighted | percent | ↓ | 5 | `COUNT(*) FILTER (discount > 0) / COUNT(*)` | Sales.Discount Value In Currency |
| `avg_unit_price` | Avg unit price | sales | avg | currency | ↑ | 3 | `AVG("Sale Item Unit Price Including VAT")` | Sales.Sale Item Unit Price Including VAT |
| `membership_rev_share` | Membership revenue share | sales | weighted | percent | ↑ | 5 | `SUM(pv) FILTER (Category='Memberships') / SUM(pv)` | Sales.Payment Value, Sales.Cleaned Category |
| `rev_per_buyer` | Revenue per buyer (line items) | sales | custom | currency | ↑ | 3 | `SUM("Payment Value") / COUNT(DISTINCT "Member ID")` | Sales.Payment Value, Sales.Member ID |
| `avg_first_purchase` | Avg first purchase | newc | avg | currency | ↑ | 5 | `AVG("First Purchase Value") FILTER (converted)` | New.First Purchase Value |
| `avg_ltv` | Avg LTV | newc | avg | currency | ↑ | 5 | `AVG(Ltv)` | New.Ltv |
| `median_ltv` | Median LTV | newc | median | currency | ↑ | 5 | `MEDIAN(Ltv) FILTER (Ltv > 0)` | New.Ltv |
| `avg_ltv_buyers` | Avg LTV (buyers) | newc | avg | currency | ↑ | 5 | `AVG(Ltv) FILTER (Ltv > 0)` | New.Ltv |
| `total_ltv` | Total LTV | newc | sum | currency | ↑ | 1 | `SUM(Ltv)` | New.Ltv |
| `ltv_to_first_purchase` | LTV : first purchase | newc | custom | ratio | ↑ | 5 | `AVG(Ltv) / NULLIF(AVG("First Purchase Value"),0)` | New.Ltv, New.First Purchase Value |
| `l_revenue` | Revenue | lapsed | sum | currency | ↑ | 1 | `SUM("Amount Paid")` | Lapsed.Amount Paid |
| `l_rev_per_session` | Revenue per session | lapsed | weighted | currency | ↑ | 3 | `SUM("Amount Paid") / NULLIF(SUM("Completed Sessions"),0)` | Lapsed.Amount Paid, Lapsed.Completed Sessions |
| `l_discount_rate` | Discount rate | lapsed | weighted | percent | ↓ | 5 | `SUM("Discount Value") / NULLIF(SUM("Original Amount"),0)` | Lapsed.Discount Value, Lapsed.Original Amount (Before Discount) |
| `member_ltv` | Member lifetime spend | lapsed | custom | currency | ↑ | 5 | `SUM("Amount Paid") / COUNT(DISTINCT "Member ID")` | Lapsed.Amount Paid, Lapsed.Member ID |
| `gross_revenue_retention` | Gross revenue retention | lapsed | weighted | percent | ↑ (target 70%) | 10 | `SUM(paid) FILTER (Renewed) / SUM(paid) FILTER (ended)` | Lapsed.Status, Lapsed.Amount Paid |
| `membership_backed_share` | Membership-backed | bookings | weighted | percent | ↑ | 5 | `COUNT(*) FILTER (membership_type IN (Unlimited, Class package)) / COUNT(*)` | Bookings.Membership Used |
| `b_revenue` | Revenue | bookings | sum | currency | ↑ | 1 | `SUM("Sale Value") FILTER (not import)` | Bookings.Sale Value |
| `rev_per_booking` | Revenue per booking | bookings | weighted | currency | ↑ | 3 | `SUM("Sale Value") / COUNT(*)` | Bookings.Sale Value |
| `zero_value_share` | Zero-value share | bookings | weighted | percent | ↓ | 5 | `COUNT(*) FILTER ("Sale Value"=0) / COUNT(*)` | Bookings.Sale Value |
| `lead_ltv` | Value per lead | leads | weighted | currency | ↑ | 10 | `SUM(LTV) / COUNT(*)` | Leads.LTV |
| `lead_cac_ratio` | Value : pipeline | leads | custom | ratio | ↑ | 20 | `AVG(LTV) / (win rate × median first membership)` | Leads.LTV, Leads.Status |
| `pipeline_value` | Pipeline value | leads | custom | currency | ↑ | 5 | `open_leads × lead_conversion_rate × avg_first_purchase_value` | Leads.Status |
| `complimentary_rate` | Complimentary rate | checkins | weighted | percent | ↓ | 5 | `COUNT(*) FILTER (Complementary OR Paid=0) / checkins` | Checkins.Complementary, Checkins.Paid |
| `revenue_per_checkin` | Revenue per check-in | checkins | weighted | currency | ↑ | 3 | `SUM(Paid) / checkins` | Checkins.Paid, Checkins.Checked In |
| `c_paid` | Paid value | checkins | sum | currency | ↑ | 1 | `SUM(Paid) FILTER ("Checked In")` | Checkins.Paid |
| `c_complimentary` | Complimentary | checkins | count | integer | ↓ | 1 | `COUNT(*) FILTER (Complementary)` | Checkins.Complementary |
| `rev_per_attendee_hour` | Revenue per attendee-hour | checkins | weighted | currency | ↑ | 3 | `SUM(Paid) / attendee_hours` | Checkins.Paid, Checkins.Duration (Minutes) |
| `p_revenue` | Revenue attributed | payroll | sum | currency | ↑ | 1 | `SUM("Total Paid")` | Payroll.Total Paid |
| `p_cycle_paid` | Cycle revenue | payroll | sum | currency | ↑ | 1 | `SUM("Cycle Paid")` | Payroll.Cycle Paid |
| `p_strength_paid` | Strength revenue | payroll | sum | currency | ↑ | 1 | `SUM("Strength Paid")` | Payroll.Strength Paid |
| `p_barre_paid` | Barre revenue | payroll | sum | currency | ↑ | 1 | `SUM("Barre Paid")` | Payroll.Barre Paid |
| `p_rev_per_session` | Revenue per session | payroll | weighted | currency | ↑ | 3 | `SUM("Total Paid") / SUM("Total Sessions")` | Payroll.Total Paid, Payroll.Total Sessions |
| `p_rev_per_customer` | Revenue per customer | payroll | weighted | currency | ↑ | 1 | `SUM("Total Paid") / SUM("Total Customers")` | Payroll.Total Paid, Payroll.Total Customers |
| `p_contribution` | Contribution | payroll | sum | currency | ↑ | 1 | `"Total Paid" − ("Total Sessions" × rate_per_session)` | Settings.rate_per_session, Payroll.Total Paid, Payroll.Total Sessions |
| `p_margin` | Contribution margin | payroll | weighted | percent | ↑ (target 60%) | 3 | `contribution / NULLIF("Total Paid",0)` | Settings.rate_per_session, Payroll.Total Paid, Payroll.Total Sessions |
| `p_conversion_value` | Conversion value | payroll | sum | currency | ↑ | 1 | `SUM(Converted) × 12,599` | Payroll.Converted |
| `p_cost_per_acquired` | Cost per acquired member | payroll | weighted | currency | ↓ | 1 | `SUM(sessions × rate) / NULLIF(SUM(Converted),0)` | Payroll.Total Sessions, Payroll.Converted |

## People

| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |
|---|---|---|---|---|---|---|---|---|
| `teaching_hours` | Teaching hours | sessions | sum | hours | ↑ | 1 | `SUM(duration_min) / 60` | Sessions.SessionID, Checkins.Duration (Minutes) |
| `prime_time_share` | Prime-time share | sessions | weighted | percent | ↑ | 3 | `COUNT(*) FILTER (prime) / COUNT(*)` | Sessions.Time |
| `draw_premium_pp` | Draw premium | sessions | custom | pp | ↑ | 5 | `trainer_fill_rate − Σ(capacity × slot_avg_fill) / Σ(capacity)` | Sessions.CheckedIn, Sessions.Capacity, Sessions.Location, Sessions.Day, Sessions.Time |
| `trainer_depth` | Trainer depth | sessions | distinct | integer | ↑ | 1 | `COUNT(DISTINCT Trainer)` | Sessions.Trainer |
| `locations_taught` | Locations | sessions | distinct | integer | ↑ | 1 | `COUNT(DISTINCT Location)` | Sessions.Location |
| `versatility` | Versatility | sessions | distinct | integer | ↑ | 1 | `COUNT(DISTINCT Class)` | Sessions.Class |
| `active_trainers` | Active trainers | sessions | distinct | integer | ↑ | 1 | `COUNT(DISTINCT Trainer)` | Sessions.Trainer |
| `draw_premium_spread` | Draw-premium spread | sessions | custom | pp | ↓ | 10 | `MAX(draw_premium_pp) − MIN(draw_premium_pp) across trainers` | Sessions.Trainer, Sessions.CheckedIn, Sessions.Capacity |
| `contactable_rate` | Contactable | newc | weighted | percent | ↑ | 5 | `COUNT(*) FILTER (contactable) / COUNT(*)` | New.Email, New.Phone Number |
| `distinct_members` | Members | lapsed | distinct | integer | ↑ | 1 | `COUNT(DISTINCT "Member ID")` | Lapsed.Member ID |
| `member_tenure` | Member tenure | lapsed | custom | days | ↑ | 5 | `AVG(last end − first start) per member` | Lapsed.Start Date, Lapsed.End Date |
| `single_location_share` | Single-location share | lapsed | weighted | percent | ↓ | 10 | `COUNT(*) FILTER (locations attended ≤ 1) / COUNT(*)` | Lapsed.Locations Attended |
| `leads` | Leads | leads | count | integer | ↑ | 1 | `COUNT(*)` | Leads.ID |
| `response_time_hours` | Avg response time | leads | avg | hours | ↓ (target 4) | 5 | `AVG(DATEDIFF("Follow Up 1 Date","Created At"))` | Leads.Follow Up 1 Date, Leads.Created At |
| `median_response_hours` | Median response | leads | median | hours | ↓ | 5 | `MEDIAN(response_hours)` | Leads.Follow Up 1 Date, Leads.Created At |
| `avg_touches` | Avg touches | leads | avg | decimal | ↑ | 5 | `AVG(count of Follow Up 1..4 Date)` | Leads.Follow Up 1 Date, Leads.Follow Up 2 Date, Leads.Follow Up 3 Date, Leads.Follow Up 4 Date |
| `touches_to_convert` | Touches to convert | leads | avg | decimal | ↓ | 5 | `AVG(touches) FILTER (Won)` | Leads.Status |
| `open_leads` | Open pipeline | leads | count | integer | ↑ | 1 | `COUNT(*) FILTER (Status NOT IN (Won, Lost))` | Leads.Status |
| `contacted_leads` | Contacted | leads | count | integer | ↑ | 1 | `COUNT(*) FILTER (touches>0)` | Leads.Follow Up 1 Date |
| `same_day_response` | Same-day response | leads | weighted | percent | ↑ | 5 | `COUNT(*) FILTER (response<24h) / COUNT(*) FILTER (contacted)` | Leads.Follow Up 1 Date, Leads.Created At |
| `p_sessions` | Sessions | payroll | sum | integer | ↑ | 1 | `SUM("Total Sessions")` | Payroll.Total Sessions |
| `p_cycle_sessions` | Cycle | payroll | sum | integer | ↑ | 1 | `SUM("Cycle Sessions")` | Payroll.Cycle Sessions |
| `p_strength_sessions` | Strength | payroll | sum | integer | ↑ | 1 | `SUM("Strength Sessions")` | Payroll.Strength Sessions |
| `p_barre_sessions` | Barre | payroll | sum | integer | ↑ | 1 | `SUM("Barre Sessions")` | Payroll.Barre Sessions |

## Adding a metric

Append one `MetricDef` to `defs` in `src/semantics/metrics.ts`. Declare `table`, `formula` (documentation), `aggregation` and the accessor(s):

- `sum` / `avg` / `median`: `num(r)`
- `count`: `num(r)` returning a boolean
- `weighted`: `num(r)` and `den(r)` — the only legal way to define a rate
- `distinct`: `distinctKey(r)`
- `custom`: `custom(rows, ctx)` for anything that needs the whole group (CV, concentration, draw premium)

The id is then usable in `KpiStrip`, `ColumnDef.metricId`, `MoMTable`, `RankingList` and insight rules with no further wiring.
