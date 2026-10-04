import type { ReportModel } from './model';

export interface SavedReport {
  id: string; fingerprint: string; title: string; createdAt: string; dataThrough: string;
  scopeLine: string; aiGenerated: boolean; aiModel?: string; model: ReportModel;
}

const DB = 'floor-report-library'; const STORE = 'reports'; const VERSION = 1;
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) { const s = db.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('fingerprint', 'fingerprint', { unique: false }); s.createIndex('createdAt', 'createdAt'); } };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => { const tx = db.transaction(STORE, mode); const req = run(tx.objectStore(STORE)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close(); }));
}
export async function listSavedReports(): Promise<SavedReport[]> {
  const rows = await request<SavedReport[]>('readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function findSavedReport(fingerprint: string): Promise<SavedReport | null> {
  const rows = await request<SavedReport[]>('readonly', (s) => s.index('fingerprint').getAll(fingerprint));
  return rows.sort((a, b) => Number(b.aiGenerated) - Number(a.aiGenerated) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
export async function saveReport(model: ReportModel, fingerprint: string, aiGenerated: boolean, aiModel?: string): Promise<SavedReport> {
  const now = new Date().toISOString();
  const report: SavedReport = { id: `${fingerprint.slice(0, 16)}-${Date.now()}`, fingerprint, title: model.meta.title, createdAt: now,
    dataThrough: model.meta.dataThrough, scopeLine: model.meta.scopeLine, aiGenerated, aiModel, model };
  await request<IDBValidKey>('readwrite', (s) => s.put(report));
  return report;
}
export async function deleteSavedReport(id: string) { await request<undefined>('readwrite', (s) => s.delete(id)); }
export async function clearSavedReports() { await request<undefined>('readwrite', (s) => s.clear()); }
