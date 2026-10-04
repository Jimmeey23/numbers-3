import { useEffect, useState } from 'react';
import { cloudConfigured, cloudSignOut, cloudStatusEvent, currentCloudError, currentCloudUser, emailSignIn } from '../../sync/cloud';

const MEMORY_KEY = 'floor.memory.v1';

export function CloudSyncSettings() {
  const [account, setAccount] = useState(currentCloudUser);
  const [syncError, setSyncError] = useState(currentCloudError);
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState(() => localStorage.getItem(MEMORY_KEY) ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => { setAccount(currentCloudUser()); setSyncError(currentCloudError()); setNotes(localStorage.getItem(MEMORY_KEY) ?? ''); };
    window.addEventListener(cloudStatusEvent, update);
    return () => window.removeEventListener(cloudStatusEvent, update);
  }, []);
  const send = async () => {
    if (!email.trim()) return;
    setBusy(true); setMessage('');
    try { await emailSignIn(email.trim()); setMessage('Check your email for the sign-in link.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not send the sign-in link.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="settings-section">
      <div className="settings-section-head"><div><h3>Cloud workspace</h3><p>Save views, widgets, insights, reports, chat and workspace notes to your account across sessions.</p></div>
        <span className={`status-pill ${account && !syncError ? 'pos' : 'warn'}`}>{syncError ? 'Sync issue' : account ? 'Synced' : cloudConfigured ? 'Sign in to sync' : 'Not configured'}</span>
      </div>
      {account ? <div className="settings-actions"><span className="t-label-m">{account.email}</span><button className="btn btn-xs" onClick={() => void cloudSignOut().catch((error) => setMessage(String(error)))}>Sign out</button></div> : (
        <div className="settings-inline"><input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} placeholder="Work email" aria-label="Email for cloud sign-in" />
          <button className="btn btn-primary" disabled={!cloudConfigured || !email.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Send sign-in link'}</button></div>
      )}
      {message && <p className="t-label-s" role="status">{message}</p>}
      {syncError && <p className="t-label-s neg" role="alert">Cloud sync: {syncError}</p>}
      <label className="settings-field"><span>Workspace memory<small>Notes you want available when returning to the dashboard. This is saved with your cloud account when signed in.</small></span>
        <textarea className="input" rows={4} value={notes} onChange={(event) => { setNotes(event.target.value); localStorage.setItem(MEMORY_KEY, event.target.value); }} placeholder="Decisions, follow-ups, and operating context" /></label>
      <p className="privacy-note">Source sheets and OpenAI API keys are never copied to this cloud workspace. Saved items are private to the signed-in user.</p>
    </section>
  );
}
