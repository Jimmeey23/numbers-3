/* One-way channel for sending a question into the Ask panel from elsewhere in the app.
 *
 * The panel owns its thread and its persistence; a caller only needs to say "ask this". An
 * event keeps that one-directional, so no other component has to hold a handle on the panel.
 */
const EVENT = 'floor:ask-question';

export function askQuestionInPanel(question: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: question }));
}

export function onAskQuestion(handler: (question: string) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
