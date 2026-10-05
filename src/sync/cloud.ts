import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

/* Read through the whole env object rather than two static keys: Vite still substitutes it in
   the browser build, and the module can then be imported outside Vite (the render test loads the
   shell in plain Node) without throwing on an undefined `import.meta.env`. */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const url = env.VITE_SUPABASE_URL?.trim();
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const cloudConfigured = Boolean(url && key && !url.includes('your-project'));
export const cloud: SupabaseClient | null = cloudConfigured ? createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const STATE_KEYS = new Set([
  'floor.cards.v1', 'floor.widgets.v1', 'floor.views', 'floor.conversation.v1',
  'floor.thresholds', 'floor.rate', 'floor.dismissed', 'floor.theme', 'floor.density',
  'floor.sources.v1', 'floor.memory.v1', 'floor.ai.config.v1',
  'floor.filters.v1', 'floor.comparison', 'floor.tab',
]);
const isSyncedKey = (stateKey: string) => STATE_KEYS.has(stateKey);
const UPDATED_KEY = 'atlas.cloud.local-updated.v1';
const readLocalTimes = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(UPDATED_KEY) ?? '{}'); } catch { return {}; } };
const writeLocalTimes = (times: Record<string, number>) => { try { localStorage.setItem(UPDATED_KEY, JSON.stringify(times)); } catch { /* best effort */ } };
const RAW_STATE_KEYS = new Set(['floor.theme', 'floor.density', 'floor.memory.v1']);
const parseState = (stateKey: string, raw: string | null): unknown => {
  if (raw === null) return null;
  if (RAW_STATE_KEYS.has(stateKey)) return raw;
  try { return JSON.parse(raw); } catch { return raw; }
};
let user: User | null = null;
let syncError: string | null = null;
let hydrating = false;
let initialized = false;
const pending = new Map<string, number>();

export const currentCloudUser = () => user;
export const currentCloudError = () => syncError;
export const cloudStatusEvent = 'atlas:cloud-status';
const notify = () => window.dispatchEvent(new Event(cloudStatusEvent));

async function putState(stateKey: string, value: unknown) {
  if (!cloud || !user) return;
  const { error } = await cloud.from('atlas_user_state').upsert({ user_id: user.id, state_key: stateKey, value, updated_at: new Date().toISOString() });
  if (error) { syncError = error.message; notify(); console.warn('Atlas cloud state could not be saved:', error.message); }
  else if (syncError) { syncError = null; notify(); }
}

function scheduleState(stateKey: string) {
  if (!isSyncedKey(stateKey) || hydrating) return;
  writeLocalTimes({ ...readLocalTimes(), [stateKey]: Date.now() });
  if (!user) return;
  window.clearTimeout(pending.get(stateKey));
  pending.set(stateKey, window.setTimeout(() => {
    pending.delete(stateKey);
    void putState(stateKey, parseState(stateKey, localStorage.getItem(stateKey)));
  }, 400));
}

function watchLocalState() {
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (stateKey: string, value: string) {
    originalSet.call(this, stateKey, value);
    if (this === localStorage) scheduleState(stateKey);
  };
  Storage.prototype.removeItem = function (stateKey: string) {
    originalRemove.call(this, stateKey);
    if (this === localStorage) scheduleState(stateKey);
  };
}

async function hydrateState() {
  if (!cloud || !user) return;
  const { data, error } = await cloud.from('atlas_user_state').select('state_key,value,updated_at').eq('user_id', user.id);
  if (error) { syncError = error.message; notify(); console.warn('Atlas cloud state could not be loaded:', error.message); return; }
  syncError = null;
  const remote = new Map((data ?? []).map((row) => [row.state_key as string, row]));
  const localTimes = readLocalTimes();
  const uploads: Promise<void>[] = [];
  let changed = false;
  hydrating = true;
  try {
    for (const stateKey of STATE_KEYS) {
      if (remote.has(stateKey)) {
        const row = remote.get(stateKey)!;
        const value = row.value;
        const current = localStorage.getItem(stateKey);
        if (current !== null && (localTimes[stateKey] ?? 0) > Date.parse(row.updated_at as string) + 1000) {
          uploads.push(putState(stateKey, parseState(stateKey, current)));
          continue;
        }
        const next = value === null ? null : RAW_STATE_KEYS.has(stateKey) ? String(value) : JSON.stringify(value);
        if (next !== current) {
          if (next === null) localStorage.removeItem(stateKey); else localStorage.setItem(stateKey, next);
          changed = true;
        }
        localTimes[stateKey] = Date.parse(row.updated_at as string) || Date.now();
      } else {
        const raw = localStorage.getItem(stateKey);
        if (raw !== null) uploads.push(putState(stateKey, parseState(stateKey, raw)));
      }
    }
    await Promise.all(uploads);
  } finally { hydrating = false; writeLocalTimes(localTimes); }
  if (changed) window.location.reload();
}

export async function initializeCloudSync() {
  if (initialized) return;
  initialized = true;
  if (!cloud) return;
  watchLocalState();
  const { data } = await cloud.auth.getSession();
  user = data.session?.user ?? null;
  if (user) await hydrateState();
  notify();
  cloud.auth.onAuthStateChange((event, session) => {
    const previousId = user?.id;
    user = session?.user ?? null;
    notify();
    if (event === 'SIGNED_IN' && user && previousId !== user.id) window.setTimeout(() => void hydrateState(), 0);
  });
}

export async function emailSignIn(email: string) {
  if (!cloud) throw new Error('Supabase is not configured. Add the project URL and publishable key to .env.');
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  if (error) throw error;
}

export async function cloudSignOut() {
  if (!cloud) return;
  const { error } = await cloud.auth.signOut();
  if (error) throw error;
  user = null;
  for (const stateKey of STATE_KEYS) localStorage.removeItem(stateKey);
  localStorage.removeItem(UPDATED_KEY);
  const { clearLocalSavedReports } = await import('../report/store');
  await clearLocalSavedReports().catch(() => undefined);
  notify();
  window.location.reload();
}

export async function readAIFromCloud<T>(fingerprint: string): Promise<T | null> {
  if (!cloud || !user) return null;
  const { data, error } = await cloud.from('atlas_ai_cache').select('content').eq('user_id', user.id).eq('fingerprint', fingerprint).maybeSingle();
  if (error) { console.warn('Atlas AI cache could not be read:', error.message); return null; }
  return (data?.content as T) ?? null;
}

export async function saveAIToCloud(fingerprint: string, kind: 'signals' | 'report', tab: string | null, scopeMonth: string, locations: string[], content: unknown) {
  if (!cloud || !user) return;
  const { error } = await cloud.from('atlas_ai_cache').upsert({ user_id: user.id, fingerprint, kind, tab, scope_month: scopeMonth, locations, content });
  if (error) console.warn('Atlas AI cache could not be saved:', error.message);
}

export async function readCloudReports<T>(): Promise<T[] | null> {
  if (!cloud || !user) return null;
  const { data, error } = await cloud.from('atlas_reports').select('report').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { console.warn('Atlas reports could not be loaded:', error.message); return null; }
  return (data ?? []).map((row) => row.report as T);
}

export async function saveCloudReport(id: string, fingerprint: string, report: unknown) {
  if (!cloud || !user) return;
  const { error } = await cloud.from('atlas_reports').upsert({ user_id: user.id, id, fingerprint, report });
  if (error) console.warn('Atlas report could not be saved:', error.message);
}

export async function deleteCloudReport(id: string) {
  if (!cloud || !user) return;
  await cloud.from('atlas_reports').delete().eq('user_id', user.id).eq('id', id);
}

export async function clearCloudReports() {
  if (!cloud || !user) return;
  await cloud.from('atlas_reports').delete().eq('user_id', user.id);
}
