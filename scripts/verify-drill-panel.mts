import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Browser storage is needed when the persisted UI stores initialise.
const g = globalThis as any;
g.window = { location: { hash: '' }, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { buildDatasetFromText } = await import('../src/data/ingest.ts');
const { useData } = await import('../src/state/data.ts');
const { useFilters, DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { useDrill } = await import('../src/state/drill.ts');
const { historyMonths } = await import('../src/semantics/aggregations.ts');
assert.equal(historyMonths('2026-10')[0], '2025-09');
assert.equal(historyMonths('2026-01')[0], '2024-12');
assert.equal(historyMonths('2026-10', 6).length, 14);
assert.equal(historyMonths('2026-10', 24).length, 24);
const { DrillPanel } = await import('../src/components/DrillPanel/DrillPanel.tsx');
// Zustand's server snapshot normally uses the initial (empty) store state.
// Render each scenario with the state supplied by this regression fixture.
const dataSnapshot = useData.getInitialState();
const filterSnapshot = useFilters.getInitialState();
const drillSnapshot = useDrill.getInitialState();
const ds = await buildDatasetFromText({ sessions: 'SessionID,Capacity,CheckedIn,Booked,Location,Date,Time,Revenue\n1,10,5,6,Test Studio,2026-09-01,09:00,5000\n2,10,4,5,Peer Studio,2026-09-02,09:00,4000' });
assert.equal(ds.sessions.length, 2, 'Fixture must exercise real rows');
useData.setState({ dataset: ds, loads: ds.loads, status: 'ready' });
useFilters.setState({ filters: { ...DEFAULT_FILTERS, preset: 'all' } });
Object.assign(dataSnapshot, useData.getState());
Object.assign(filterSnapshot, useFilters.getState());
const base = { title: 'Test Studio', breadcrumb: ['Sessions', 'Test Studio'], table: 'sessions' as const, rows: ds.sessions.slice(0, 1), domain: 'attendance', peers: [{ label: 'Test Studio', rows: ds.sessions.slice(0, 1) }, { label: 'Peer Studio', rows: ds.sessions.slice(1) }] };
const render = (metricIds: string[]) => {
  useDrill.getState().open({ ...base, metricIds });
  Object.assign(drillSnapshot, useDrill.getState());
  return renderToString(React.createElement(DrillPanel)).replace(/<!--.*?-->/g, '');
};
const records = render([]);
assert.match(records, /Contributing rows/);
assert.doesNotMatch(records, /14 months vs peer median|Nearest peers by|kpi-strip/);
const valid = render(['sessions']);
assert.match(valid, /14 months vs peer median/);
assert.match(valid, /Nearest peers by Sessions/);
const many = render(['sessions', 'seats', 'attendance', 'booked', 'fill_rate', 'booking_fill_rate']);
assert.match(many, /--kpi-cols:4/);
assert.doesNotMatch(many, /Booking fill rate/);
const malformed = render([undefined as unknown as string, 'missing', 'gross_revenue', 'sessions', 'sessions']);
assert.match(malformed, /--kpi-cols:1/);
assert.match(malformed, /Nearest peers by Sessions/);
useDrill.getState().close();
Object.assign(drillSnapshot, useDrill.getState());
assert.equal(renderToString(React.createElement(DrillPanel)), '');
console.log('PASS: record-only, normal, six-metric, invalid/duplicate metric, and closed drill panels');
