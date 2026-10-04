/* The tab footer.
 *
 * Every tab used to end in the same three things scattered down the page: a collapsed register of
 * reference tables, a widget section, and the agent endpoint. They are reference material, not
 * analysis, so they now live in one place — a single collapsed footer at the foot of the canvas.
 *
 * A collapsed `<Register>` does not render where it is written; it registers itself here and
 * portals its body into the footer. The tab keeps authoring its own reference tables in context,
 * and the reader gets one shelf instead of four.
 */
import { create } from 'zustand';

export type FooterSection = 'reference' | 'widgets' | 'api';

export interface FooterSlot { id: string; title: string; index?: string }

interface FooterState {
  /** The portal target inside the footer; null until the footer has mounted. */
  el: HTMLElement | null;
  slots: FooterSlot[];
  open: boolean;
  section: FooterSection;
  setEl: (el: HTMLElement | null) => void;
  register: (slot: FooterSlot) => void;
  unregister: (id: string) => void;
  setOpen: (open: boolean) => void;
  setSection: (section: FooterSection) => void;
  /** Open the footer on a given section — used by the keyboard shortcut and the status bar. */
  reveal: (section: FooterSection) => void;
}

export const useFooter = create<FooterState>((set) => ({
  el: null,
  slots: [],
  open: false,
  section: 'reference',
  setEl: (el) => set({ el }),
  register: (slot) => set((s) => (s.slots.some((x) => x.id === slot.id) ? s : { slots: [...s.slots, slot] })),
  unregister: (id) => set((s) => ({ slots: s.slots.filter((x) => x.id !== id) })),
  setOpen: (open) => set({ open }),
  setSection: (section) => set({ section }),
  reveal: (section) => set({ open: true, section }),
}));
