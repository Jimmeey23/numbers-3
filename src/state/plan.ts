/* The action plan.
 *
 * AI recommendations are worth nothing if they evaporate on the next generation. Anything the
 * operator accepts is copied into a persistent, owned, dated worklist with a status, so the
 * month can be reviewed against what was actually decided — and so the estimated rupee impact
 * can be totalled across open work rather than read one card at a time.
 */
import { create } from 'zustand';
import type { TabId } from './view';

export type PlanStatus = 'open' | 'doing' | 'done' | 'dropped';
export interface PlanItem {
  id: string; tab: TabId; title: string; rationale: string; steps: string[];
  priority: 'now' | 'this-week' | 'this-month';
  owner?: string; impactINR?: number; metricId?: string; source: 'ai' | 'manual';
  status: PlanStatus; createdAt: number; updatedAt: number; note?: string;
}

const KEY = 'floor.action-plan.v1';
const read = (): PlanItem[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const write = (items: PlanItem[]) => { try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 300))); } catch { /* quota */ } };

type Store = {
  items: PlanItem[];
  add: (item: Omit<PlanItem, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: PlanStatus }) => PlanItem;
  update: (id: string, patch: Partial<PlanItem>) => void;
  remove: (id: string) => void;
  clearDone: () => void;
  has: (tab: TabId, title: string) => boolean;
};

export const usePlan = create<Store>((set, get) => ({
  items: read(),
  add: (input) => {
    const now = Date.now();
    const item: PlanItem = { ...input, status: input.status ?? 'open', id: `plan-${now}-${Math.random().toString(36).slice(2, 6)}`, createdAt: now, updatedAt: now };
    const items = [item, ...get().items];
    write(items); set({ items });
    return item;
  },
  update: (id, patch) => { const items = get().items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)); write(items); set({ items }); },
  remove: (id) => { const items = get().items.filter((i) => i.id !== id); write(items); set({ items }); },
  clearDone: () => { const items = get().items.filter((i) => i.status !== 'done' && i.status !== 'dropped'); write(items); set({ items }); },
  has: (tab, title) => get().items.some((i) => i.tab === tab && i.title.toLowerCase() === title.toLowerCase()),
}));

export const openImpact = (items: PlanItem[]) =>
  items.filter((i) => i.status === 'open' || i.status === 'doing').reduce((a, i) => a + (i.impactINR ?? 0), 0);
