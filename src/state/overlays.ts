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
      if (closeAllOverlays() > 0) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);   // capture, so it runs before local handlers
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
