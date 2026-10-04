import { create } from 'zustand';
import type { Row } from '../semantics/aggregations';
import type { TableName } from '../semantics/metrics';

export interface DrillTarget {
  title: string;
  breadcrumb: string[];
  table: TableName;
  rows: Row[];
  peerRows?: Row[];          // same-level siblings' rows for ranks
  peers?: { label: string; rows: Row[] }[];
  metricIds: string[];
  domain: string;
  sourceEl?: HTMLElement | null;
}

interface DrillState {
  stack: DrillTarget[];
  index: number;
  open: (t: DrillTarget) => void;
  back: () => void;
  forward: () => void;
  close: () => void;
}

export const useDrill = create<DrillState>((set) => ({
  stack: [], index: -1,
  open: (t) => set((s) => { const stack = [...s.stack.slice(0, s.index + 1), t]; return { stack, index: stack.length - 1 }; }),
  back: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  forward: () => set((s) => ({ index: Math.min(s.stack.length - 1, s.index + 1) })),
  close: () => set({ stack: [], index: -1 }),
}));
