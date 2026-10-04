import { useState } from 'react';
import { fmtCurrency, formatValue } from '../../semantics/formats';

type Driver = 'volume' | 'price';

/** The same exhaustive revenue decomposition as the former waterfall, shown as a readable equation. */
export function RevenueDrivers({ previous, current, volume, price, previousTransactions, currentTransactions, previousLabel, currentLabel }: {
  previous: number; current: number; volume: number; price: number;
  previousTransactions: number; currentTransactions: number; previousLabel: string; currentLabel: string;
}) {
  const [active, setActive] = useState<Driver>('volume');
  const max = Math.max(Math.abs(previous), Math.abs(current), 1);
  const delta = current - previous;
  const drivers = [
    { id: 'volume' as const, label: 'Transactions', value: volume, detail: 'How much revenue changed because the number of transactions changed.', formula: `${formatValue('decimal', currentTransactions)} − ${formatValue('decimal', previousTransactions)} transactions, valued at the earlier average transaction value.` },
    { id: 'price' as const, label: 'Average transaction value', value: price, detail: 'How much revenue changed because the average amount per transaction changed.', formula: 'Change in average transaction value × current transactions.' },
  ];
  const selected = drivers.find((driver) => driver.id === active)!;
  return (
    <div className="revenue-drivers">
      <div className="revenue-drivers-top">
        <div><span className="revenue-drivers-kicker">Revenue change</span><div className={`revenue-drivers-delta tabular ${delta >= 0 ? 'pos' : 'neg'}`}>{delta >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(delta))}</div></div>
        <span className="revenue-drivers-equation">{previousLabel} + transaction effect + average value effect = {currentLabel}</span>
      </div>
      <div className="revenue-drivers-periods" aria-label="Revenue by period">
        {[{ label: previousLabel, value: previous }, { label: currentLabel, value: current }].map((period) => <div className="revenue-drivers-period" key={period.label}>
          <div className="revenue-drivers-period-label"><span>{period.label}</span><strong className="tabular">{fmtCurrency(period.value)}</strong></div>
          <div className="revenue-drivers-track"><span style={{ width: `${Math.max(0, Math.abs(period.value) / max * 100)}%` }} /></div>
        </div>)}
      </div>
      <div className="revenue-drivers-choices" aria-label="Explore drivers of revenue change">
        {drivers.map((driver) => <button key={driver.id} type="button" className={`revenue-driver ${active === driver.id ? 'is-active' : ''}`} aria-pressed={active === driver.id} onClick={() => setActive(driver.id)}>
          <span className="revenue-driver-label">{driver.label}</span>
          <strong className={`tabular ${driver.value >= 0 ? 'pos' : 'neg'}`}>{driver.value >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(driver.value))}</strong>
          <span className="revenue-driver-bar"><i style={{ width: `${Math.abs(driver.value) / Math.max(Math.abs(volume), Math.abs(price), 1) * 100}%` }} /></span>
        </button>)}
      </div>
      <div className="revenue-drivers-detail" role="status" aria-live="polite">
        <strong>{selected.label}</strong><span>{selected.detail}</span><small>{selected.formula}</small>
      </div>
    </div>
  );
}
