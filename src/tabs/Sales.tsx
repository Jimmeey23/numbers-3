import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty, SheetMissing } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel, seriesBy } from '../semantics/aggregations';
import { categorical } from '../design/ramps';
import { useView } from '../state/view';
import { useFilters } from '../state/filters';
import { fmtCurrency, fmtDate, fmtMonthShort, formatValue } from '../semantics/formats';
import { useData } from '../state/data';
import { maxBy } from '../semantics/stats';

const S_METRICS = ['category_revenue', 'transactions', 'aov', 'atv_net', 'discount_rate', 'discount_efficiency', 'unique_buyers', 'purchase_frequency', 'package_sell_through', 'net_revenue', 'discounted_share'];

export function Sales({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const theme = useView((s) => s.theme);
  const addTransient = useFilters((s) => s.addTransient);
  const load = useData((s) => s.loads.find((l) => l.key === 'sales'));
  const rows = scope.tables.sales;
  const cats = useMemo(() => [...new Set(scope.all.sales.map((r) => r.category).filter(Boolean))] as string[], [scope.all.sales]);
  const stacked = useMemo(() => { const s = seriesBy(scope.all.sales, (r) => r.month, ['gross_revenue', 'aov'], scope.ctx, months); return { cats: s.map((x) => fmtMonthShort(x.key)), series: cats.map((c, i) => ({ id: c, label: c, color: categorical(theme, i), kind: 'bar' as const, values: s.map((x) => { const v = metricValues(x.rows.filter((r) => r.category === c), ['category_revenue'], scope.ctx).category_revenue.value; return v ?? 0; }) })), aov: s.map((x) => x.values.aov.value), keys: s.map((x) => x.key) }; }, [scope.all.sales, months, cats, theme, scope.ctx]);
  const totalGross = useMemo(() => metricValues(rows, ['category_revenue'], scope.ctx).category_revenue.value, [rows, scope.ctx]);
  const productSeries = useMemo(() => { const by = new Map<string, typeof rows>(); for (const r of scope.all.sales) { const k = r.product ?? '(none)'; let a = by.get(k); if (!a) { a = []; by.set(k, a); } a.push(r); } const out = new Map<string, (number | null)[]>(); for (const [k, rs] of by) out.set(k, seriesBy(rs, (r) => r.month, ['category_revenue'], scope.ctx, months).map((x) => x.values.category_revenue.value)); return out; }, [scope.all.sales, scope.ctx, months]);
  const columns: ColumnDef[] = useMemo(() => [
    { id: 'transactions', metricId: 'transactions', family: 'Volume', bar: true }, { id: 'units', metricId: 'units', family: 'Volume' },
    { id: 'category_revenue', metricId: 'category_revenue', family: 'Revenue', bar: true }, { id: 'net_revenue', metricId: 'net_revenue', family: 'Revenue' }, { id: 'vat', metricId: 'vat', family: 'Revenue', hidden: true },
    { id: 'aov', metricId: 'aov', family: 'Revenue', heat: true }, { id: 'avg_unit_price', metricId: 'avg_unit_price', family: 'Revenue', hidden: true },
    { id: 'discount_value', metricId: 'discount_value', family: 'Revenue' }, { id: 'discount_rate', metricId: 'discount_rate', family: 'Revenue', heat: true }, { id: 'discounted_share', metricId: 'discounted_share', family: 'Behaviour' },
    { id: 'share', label: '% of total', family: 'Revenue', value: (n) => (totalGross ? (n.values.category_revenue?.value ?? 0) / totalGross : null), format: 'percent' },
    { id: 'units_per_transaction', metricId: 'units_per_transaction', family: 'Behaviour' }, { id: 'distinct_products', metricId: 'distinct_products', family: 'Volume' }, { id: 'top_product_share', metricId: 'top_product_share', family: 'Behaviour', hidden: true },
    { id: 'unique_buyers', metricId: 'unique_buyers', family: 'Volume' }, { id: 'arpu', metricId: 'arpu', family: 'Revenue' }, { id: 'repeat_buyer_rate', metricId: 'repeat_buyer_rate', family: 'Behaviour', heat: true }, { id: 'voided_rate', metricId: 'voided_rate', family: 'Behaviour' },
    { id: 'membership_rev_share', metricId: 'membership_rev_share', family: 'Revenue', hidden: true },
    { id: 'spark', label: '14 months', family: 'Behaviour', spark: (rs) => (rs[0] ? productSeries.get(rs[0].product ?? '(none)') ?? [] : []) },
  ], [totalGross, productSeries]);
  const productNodes = useMemo(() => rollupLevel(rows, ['product'], 0, S_METRICS, scope.ctx), [rows, scope.ctx]);
  const productPrev = useMemo(() => rollupLevel(scope.compare.sales, ['product'], 0, S_METRICS, scope.ctx), [scope.compare.sales, scope.ctx]);
  const discountAudit = useMemo(() => rollupLevel(rows.filter((r) => (r.discount ?? 0) > 0), ['discount_code'], 0, ['discount_value', 'discount_rate', 'category_revenue', 'transactions', 'unique_buyers'], scope.ctx)
    .sort((a, b) => (b.values.discount_value.value ?? 0) - (a.values.discount_value.value ?? 0)), [rows, scope.ctx]);
  /* Discount effectiveness, as a ledger rather than a scatter. For each band of discount depth:
     what was given away, what came back, whether those buyers stayed, and what each retained
     buyer cost in foregone revenue. The old chart plotted depth against a retention proxy for
     codes with three or more buyers — usually five or six points, with no reading that led to
     an action, and it credited retention to a code rather than to the discount. */
  const discountBands = useMemo(() => {
    const BANDS: { label: string; lo: number; hi: number }[] = [
      { label: 'Full price', lo: -Infinity, hi: 0.0001 },
      { label: 'Up to 10%', lo: 0.0001, hi: 0.1 },
      { label: '10–25%', lo: 0.1, hi: 0.25 },
      { label: '25–50%', lo: 0.25, hi: 0.5 },
      { label: 'Over 50%', lo: 0.5, hi: Infinity },
    ];
    // One member is "retained" if any membership of theirs is still active or was renewed.
    const retainedMember = new Map<string, boolean>();
    for (const l of scope.all.lapsed) if (l.member_id) retainedMember.set(l.member_id, (retainedMember.get(l.member_id) ?? false) || l.status === 'Renewed' || l.status === 'Active');
    const live = rows.filter((r) => !r.voided);
    return BANDS.map((b) => {
      const inBand = live.filter((r) => {
        const list = (r.value ?? 0) + (r.discount ?? 0);
        const depth = list > 0 ? (r.discount ?? 0) / list : 0;
        return depth >= b.lo && depth < b.hi;
      });
      const v = metricValues(inBand, ['gross_revenue', 'discount_value', 'transactions', 'unique_buyers', 'aov'], scope.ctx);
      const buyers = [...new Set(inBand.map((r) => r.member_id).filter(Boolean))] as string[];
      const retained = buyers.filter((m) => retainedMember.get(m)).length;
      const given = v.discount_value.value ?? 0;
      return {
        ...b, rows: inBand.length,
        revenue: v.gross_revenue.value, given, transactions: v.transactions.value, aov: v.aov.value,
        buyers: buyers.length, retained,
        retentionRate: buyers.length ? retained / buyers.length : null,
        // What each retained buyer cost in revenue given up. Full price costs nothing, so null.
        costPerRetained: retained > 0 && given > 0 ? given / retained : null,
        // Rupees of revenue booked per rupee discounted — the payback on the giveaway.
        returnOnDiscount: given > 0 ? (v.gross_revenue.value ?? 0) / given : null,
      };
    }).filter((b) => b.rows > 0);
  }, [rows, scope.all.lapsed, scope.ctx]);
  const fullPriceRetention = discountBands.find((b) => b.label === 'Full price')?.retentionRate ?? null;
  const hourDay = useMemo(() => { const cells = []; const m = new Map<string, typeof rows>(); for (const r of rows) { if (r.hour === null || !r.day) continue; const k = `${String(r.hour).padStart(2, '0')}:00|${r.day}`; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); } for (const [k, rs] of m) { const [x, y] = k.split('|'); cells.push({ x, y, value: metricValues(rs, ['gross_revenue'], scope.ctx).gross_revenue.value, n: rs.length }); } return { xs: [...new Set(cells.map((c) => c.x))].sort(), cells }; }, [rows, scope.ctx]);
  const salespeople = useMemo(() => rollupLevel(rows, ['sold_by'], 0, ['gross_revenue', 'transactions', 'aov', 'membership_rev_share', 'discount_rate', 'discount_value', 'unique_buyers'], scope.ctx).sort((a, b) => (b.values.gross_revenue.value ?? 0) - (a.values.gross_revenue.value ?? 0)), [rows, scope.ctx]);
  const liability = useMemo(() => rows.filter((r) => r.mem_end && r.mem_end >= scope.today && ((r.mem_classes_left ?? 0) > 0 || (r.mem_money_left ?? 0) > 0)).map((r) => ({ ...r, value_left: (r.mem_money_left ?? 0) || ((r.mem_classes_left ?? 0) * (r.rev_per_credit ?? 0)) })).sort((a, b) => a.mem_end!.localeCompare(b.mem_end!)).slice(0, 40), [rows, scope.today]);
  const price = useMemo(() => rollupLevel(rows, ['product'], 0, ['avg_unit_price', 'units', 'gross_revenue', 'discount_rate'], scope.ctx).map((n) => { const list = maxBy(n.rows, (r) => r.unit_price, 0); const realised = (n.values.gross_revenue.value ?? 0) / Math.max(1, n.values.units.value ?? 1); return { n, list, realised, ratio: list ? realised / list : null }; }).filter((x) => x.n.rows.length >= 5).sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1)), [rows, scope.ctx]);
  if (load?.status === 'error') return <div style={{ paddingTop: 20 }}><SheetMissing title="Sales sheet" load={load} /></div>;
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="sales" scope={scope} /></div>;
  return (
    <>
      <WidgetSection tab="sales" scope={scope} placement="top" />
      <Register title="Sales" subtitle="Track what community members buy, how much they spend, and where discounts change realised revenue." domain="revenue">
        <KpiStrip scope={scope} table="sales" ids={['gross_revenue', 'net_revenue', 'transactions', 'aov', 'unique_buyers', 'arpu', 'discount_rate', 'deferred_revenue']} />
      </Register>
      <Register title="Revenue by category over time" subtitle="Each sale payment is allocated once across its post-discount line items; category shares therefore reconcile to total gross revenue" domain="revenue">
        <ChartModule title="Gross payment allocated by category" table={{ columns: ['Month', ...cats, 'AOV'], rows: stacked.cats.map((c, i) => [c, ...stacked.series.map((s) => Math.round(s.values[i])), Math.round(stacked.aov[i] ?? 0)]) }}>
          <XYChart categories={stacked.cats} series={[...stacked.series, { id: 'aov', label: 'AOV', color: 'var(--text-1)', values: stacked.aov, axis: 'right', fmt: 'currency' }]} stacked fmtLeft="currency" fmtRight="currency" onClick={(i) => addTransient({ dim: 'month', value: stacked.keys[i], label: stacked.cats[i] })} />
        </ChartModule>
      </Register>
      <Register title="Drill down" subtitle="Category → product → location → salesperson" domain="revenue" id="drill-table">
        <NestedTable title="Sales" rows={rows} compareRows={scope.compare.sales} table="sales" groupKeys={['category', 'product', 'location', 'sold_by']} availableKeys={['category', 'product', 'location', 'sold_by', 'method', 'discount_code', 'membership_type', 'month', 'quarter', 'year', 'day', 'weekpart', 'hour', 'spend_band', 'member']} columns={columns} ctx={scope.ctx} domain="revenue" defaultSort={{ id: 'category_revenue', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="category_revenue" leafLabel="line items" />
      </Register>
      <Register title="Products and discount codes" domain="revenue" lazy>
        <Two a={<RankingList title="Products by" nodes={productNodes} compareNodes={productPrev} metricOptions={['category_revenue', 'discount_rate', 'aov', 'unique_buyers', 'transactions']} ctx={scope.ctx} table="sales" domain="revenue" minSample={5} sampleLabel="line items" />}
          b={<ChartModule title="Does discounting pay for itself?" subtitle="Every line item placed in a discount band, then followed through to whether those buyers are still members"
            table={{ columns: ['Discount band', 'Revenue', 'Given away', 'Buyers', 'Still members', 'Retention', 'Revenue per ₹1 discounted', 'Discount per retained buyer'],
              rows: discountBands.map((b) => [b.label, Math.round(b.revenue ?? 0), Math.round(b.given), b.buyers, b.retained, b.retentionRate === null ? null : `${(b.retentionRate * 100).toFixed(0)}%`, b.returnOnDiscount === null ? null : `${b.returnOnDiscount.toFixed(1)}×`, b.costPerRetained === null ? null : Math.round(b.costPerRetained)]) }}>
            {discountBands.length ? (
              <div className="discount-ledger">
                <p className="t-body-s muted" style={{ margin: '0 0 10px' }}>
                  Read each row as one question: for everything sold at this depth of discount, how much was given up, and are those buyers still here? A band whose retention is no better than full price is a band where the money bought nothing.
                </p>
                <div className="table-scroll" style={{ maxHeight: 300 }}
                  data-summary-title="Discount effectiveness by band"
                  data-summary="Each row groups every non-voided sale line by how deeply it was discounted. Revenue is what was booked at that depth, Given away is the discount reconciled onto those lines, and Retention is the share of those buyers who still hold an active or renewed membership."
                  data-calculation="Discount depth is the discount divided by the list price before discount, computed per line. A buyer counts as retained if any membership of theirs is active or renewed, so a buyer appearing in two bands is counted in both. Revenue per ₹1 discounted is revenue booked in the band divided by the discount given in it; it is blank for full price, where nothing was given up.">
                  <table className="tbl">
                    <thead><tr>
                      <th className="t-heading-s">Discount band</th><th className="t-heading-s">Revenue</th><th className="t-heading-s">Given away</th>
                      <th className="t-heading-s">Buyers</th><th className="t-heading-s">Still members</th><th className="t-heading-s">Back per ₹1 given</th>
                    </tr></thead>
                    <tbody>
                      {discountBands.map((b) => {
                        // Retention is only meaningful against the full-price baseline on the same data.
                        const vsFull = b.retentionRate !== null && fullPriceRetention !== null && b.label !== 'Full price' ? b.retentionRate - fullPriceRetention : null;
                        return (
                          <tr key={b.label} style={{ cursor: 'pointer' }} onClick={() => addTransient({ dim: 'spend_band', value: b.label })}>
                            <td className="t-body-s">{b.label}<small className="faint" style={{ display: 'block' }}>{b.transactions ?? 0} transactions</small></td>
                            <td className="t-num">{fmtCurrency(b.revenue)}</td>
                            <td className="t-num">{b.given > 0 ? fmtCurrency(b.given) : '—'}</td>
                            <td className="t-num">{b.buyers.toLocaleString('en-IN')}</td>
                            <td className="t-num">
                              {b.retentionRate === null ? '—' : formatValue('percent', b.retentionRate)}
                              {vsFull !== null && <small className={vsFull >= 0 ? 'pos' : 'neg'} style={{ display: 'block' }}>{vsFull >= 0 ? '+' : '−'}{Math.abs(vsFull * 100).toFixed(0)}pp vs full price</small>}
                            </td>
                            <td className={`t-num ${b.returnOnDiscount !== null && b.returnOnDiscount < 2 ? 'neg' : ''}`}>{b.returnOnDiscount === null ? '—' : `${b.returnOnDiscount.toFixed(1)}×`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="t-label-s faint" style={{ marginTop: 7 }}>
                  A band is working when its retention beats full price by more than the discount costs. Click a band to filter the tab to it. A buyer who bought at two depths is counted in both, so the buyer column does not sum to the total.
                </div>
              </div>
            ) : <div className="muted t-body-s">No non-voided sale lines in this scope.</div>}
          </ChartModule>} />
        <div style={{ marginTop: 18 }}><div className="t-heading-m" style={{ marginBottom: 6 }}>Discount reconciliation by code</div>
          <div className="t-label-s muted" style={{ marginBottom: 8 }}>Unit discounts are multiplied by quantity. If only a sale-level discount exists, it is allocated once across that sale's lines. Voided lines are excluded; rate = reconciled discount ÷ list price before discount.</div>
          <div className="table-scroll" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr><th className="t-heading-s">Discount code</th><th className="t-heading-s">Discount given</th><th className="t-heading-s">List value</th><th className="t-heading-s">Discount rate</th><th className="t-heading-s">Allocated revenue</th><th className="t-heading-s">Transactions</th><th className="t-heading-s">Buyers</th></tr></thead><tbody>{discountAudit.map((n) => { const d = n.values.discount_value.value ?? 0; const rate = n.values.discount_rate.value; const list = rate ? d / rate : null; return <tr key={n.id}><td className="t-body-s">{n.label === '(none)' ? 'No code recorded' : n.label}</td><td className="t-num">{fmtCurrency(d)}</td><td className="t-num">{fmtCurrency(list)}</td><td className="t-num">{formatValue('percent', rate)}</td><td className="t-num">{fmtCurrency(n.values.category_revenue.value)}</td><td className="t-num">{n.values.transactions.value}</td><td className="t-num">{n.values.unique_buyers.value}</td></tr>; })}</tbody></table></div>
          {!discountAudit.length && <div className="muted t-body-s">No non-voided discounted line items in this scope.</div>}
        </div>
      </Register>
      <Register title="Hour × day by revenue" subtitle="Front-desk staffing evidence" domain="revenue" lazy>
        <Heatmap xs={hourDay.xs} ys={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']} cells={hourDay.cells} fmt="currency" kind="revenue" yLabel={(y) => y.slice(0, 3)} onClick={(c) => addTransient({ dim: 'day', value: c.y })} />
      </Register>
      <Register title="Month on month" domain="revenue" lazy>
        <MoMTable rows={scope.all.sales} metricIds={['gross_revenue', 'net_revenue', 'transactions', 'aov', 'discount_rate', 'membership_rev_share', 'unique_buyers', 'deferred_revenue']} months={months} ctx={scope.ctx} domain="revenue" />
      </Register>
      <Register title="Salesperson scorecard, payment mix, membership liability, voids, price realisation" domain="revenue" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Salesperson scorecard</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Salesperson</th><th className="t-heading-s">Revenue</th><th className="t-heading-s">Transactions</th><th className="t-heading-s">AOV</th><th className="t-heading-s">Membership attach</th><th className="t-heading-s">Discount given</th><th className="t-heading-s">Discount rate</th><th className="t-heading-s">Buyers</th></tr></thead><tbody>{salespeople.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{fmtCurrency(n.values.gross_revenue.value)}</td><td className="t-num">{n.values.transactions.value}</td><td className="t-num">{fmtCurrency(n.values.aov.value)}</td><td className="t-num">{formatValue('percent', n.values.membership_rev_share.value)}</td><td className="t-num">{fmtCurrency(n.values.discount_value.value)}</td><td className="t-num">{formatValue('percent', n.values.discount_rate.value)}</td><td className="t-num">{n.values.unique_buyers.value}</td></tr>)}</tbody></table></div></div>
          <NestedTable title="Payment method and source mix" rows={rows} table="sales" groupKeys={['method', 'category']} availableKeys={['method', 'category', 'location']} columns={columns.filter((c) => ['transactions', 'category_revenue', 'aov', 'share', 'discount_rate'].includes(c.id))} ctx={scope.ctx} domain="revenue" filtersLabel={filtersLabel(scope)} maxHeight={300} />
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Membership liability — live memberships with unused value, by expiry</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Customer</th><th className="t-heading-s">Membership</th><th className="t-heading-s">Ends</th><th className="t-heading-s">Classes left</th><th className="t-heading-s">Money left</th><th className="t-heading-s">Value at risk</th></tr></thead><tbody>{liability.map((r, i) => <tr key={i}><td className="t-body-s">{r.customer}</td><td className="t-body-s">{r.product}</td><td className="t-num">{fmtDate(r.mem_end)}</td><td className="t-num">{r.mem_classes_left ?? '—'}</td><td className="t-num">{fmtCurrency(r.mem_money_left)}</td><td className="t-num warn">{fmtCurrency(r.value_left)}</td></tr>)}</tbody></table></div>{!liability.length && <div className="muted t-body-s">No live memberships with unused value in this scope.</div>}</div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Voided transactions</div><div className="t-body-s muted">{rows.filter((r) => r.voided).length} voided of {rows.length} line items ({formatValue('percent', metricValues(rows, ['voided_rate'], scope.ctx).voided_rate.value)}). Payment status: {[...new Set(rows.map((r) => r.status))].join(', ')}.</div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Price realisation by product — realised unit price against the highest list price seen</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Product</th><th className="t-heading-s">List</th><th className="t-heading-s">Realised</th><th className="t-heading-s">Realisation</th><th className="t-heading-s">Units</th></tr></thead><tbody>{price.slice(0, 20).map((p) => <tr key={p.n.id}><td className="t-body-s">{p.n.label}</td><td className="t-num">{fmtCurrency(p.list)}</td><td className="t-num">{fmtCurrency(p.realised)}</td><td className={`t-num ${(p.ratio ?? 1) < 0.8 ? 'neg' : ''}`}>{formatValue('percent', p.ratio)}</td><td className="t-num">{p.n.values.units.value}</td></tr>)}</tbody></table></div></div>
        </div>
      </Register>
      <WidgetSection tab="sales" scope={scope} placement="bottom" />
    </>
  );
}
