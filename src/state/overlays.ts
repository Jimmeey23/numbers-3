/* Escape closes whatever is open — all of it, in one press.
 *
 * Overlays used to each listen for Escape themselves, so whether a key press reached the thing the
 * operator meant depended on mount order and on which element happened to hold focus. Anything
 * that covers the page registers here instead: a popout, a drawer, a drill panel, a dialog. One
 * document-level listener closes every open overlay, so Escape is never ambiguous.
 */
import { useEffect } from 'react';

type Closer = () => void;
const open = new Map<symbol, Closer>();

/** Close every registered overlay. Returns how many were open. */
export function closeAllOverlays(): number {
  const n = open.size;
  // Copy first: a closer may unregister itself while we iterate.
  for (const close of [...open.values()]) { try { close(); } catch { /* an overlay that cannot close must not block the rest */ } }
  open.clear();
  return n;
}

export const anyOverlayOpen = () => open.size > 0;

/* Docked panels are not modals: the insight rail is a standing preference, toggled with S, and
   collapsing it on every Escape would fight that toggle. They register here instead, as a second
   tier — Escape reaches them only once nothing modal is left open, so one press still ends with
   nothing covering the page. */
const docked = new Map<symbol, Closer>();
export function closeDockedPanels(): number {
  const n = docked.size;
  for (const close of [...docked.values()]) { try { close(); } catch { /* one panel must not block the rest */ } }
  return n;
}
export function useDockedPanel(isOpen: boolean, close: Closer) {
  useEffect(() => {
    if (!isOpen) return;
    const key = Symbol('docked');
    docked.set(key, close);
    return () => { docked.delete(key); };
  }, [isOpen, close]);
}

/**
 * Register `close` for as long as `isOpen` is true.
 * The overlay keeps owning its own state; this only makes Escape reach it.
 */
export function useOverlay(isOpen: boolean, close: Closer) {
  useEffect(() => {
    if (!isOpen) return;
    const key = Symbol('overlay');
    open.set(key, close);
    return () => { open.delete(key); };
  }, [isOpen, close]);
}

/** Mounted once, by the shell. */
export function useEscapeClosesEverything() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* Let a text field take Escape first — in a search box or a filter input it means "clear
         what I am typing", and stealing it would make those inputs feel broken. */
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing && (el as HTMLInputElement).value) return;
      const closed = closeAllOverlays() || closeDockedPanels();
      if (closed > 0) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);   // capture, so it runs before local handlers
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
