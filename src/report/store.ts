import type { ReportModel } from './model';
import { clearCloudReports, currentCloudUser, deleteCloudReport, readCloudReports, saveCloudReport } from '../sync/cloud';

export interface SavedReport {
  id: string; fingerprint: string; title: string; createdAt: string; dataThrough: string; ownerId?: string;
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
  const [local, remote] = await Promise.all([
    request<SavedReport[]>('readonly', (s) => s.getAll()).catch(() => []),
    readCloudReports<SavedReport>(),
  ]);
  if (currentCloudUser() && remote) {
    const remoteIds = new Set(remote.map((item) => item.id));
    await Promise.all(local.filter((item) => (!item.ownerId || item.ownerId === currentCloudUser()?.id) && !remoteIds.has(item.id)).map((item) => saveCloudReport(item.id, item.fingerprint, item)));
  }
  const rows = new Map<string, SavedReport>();
  const ownerId = currentCloudUser()?.id;
  for (const row of [...local.filter((item) => !item.ownerId || item.ownerId === ownerId), ...(remote ?? [])]) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function findSavedReport(fingerprint: string): Promise<SavedReport | null> {
  const rows = (await listSavedReports()).filter((r) => r.fingerprint === fingerprint);
  return rows.sort((a, b) => Number(b.aiGenerated) - Number(a.aiGenerated) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
export async function saveReport(model: ReportModel, fingerprint: string, aiGenerated: boolean, aiModel?: string): Promise<SavedReport> {
  const now = new Date().toISOString();
  const report: SavedReport = { id: `${fingerprint.slice(0, 16)}-${Date.now()}`, fingerprint, title: model.meta.title, createdAt: now,
    dataThrough: model.meta.dataThrough, scopeLine: model.meta.scopeLine, aiGenerated, aiModel, model, ownerId: currentCloudUser()?.id };
  await request<IDBValidKey>('readwrite', (s) => s.put(report));
  await saveCloudReport(report.id, fingerprint, report);
  return report;
}
export async function deleteSavedReport(id: string) { await Promise.all([request<undefined>('readwrite', (s) => s.delete(id)), deleteCloudReport(id)]); }
export async function clearLocalSavedReports() { await request<undefined>('readwrite', (s) => s.clear()); }
export async function clearSavedReports() { await Promise.all([clearLocalSavedReports(), clearCloudReports()]); }
