/// <reference lib="webworker" />
import { buildReport } from './model';
import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';

interface Request { scope: Scope; thresholds: Thresholds; studio: string }
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    self.postMessage({ type: 'stage', stage: 'Computing metrics and chapter evidence off the main thread…' });
    const model = buildReport(event.data.scope, event.data.thresholds, event.data.studio);
    self.postMessage({ type: 'done', model });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' });
  }
};
