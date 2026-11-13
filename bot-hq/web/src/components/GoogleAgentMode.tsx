import { useEffect, useRef, useState } from 'react';
import { api, displayDate, errorText } from '../lib/axon';
import { nativeRequest } from '../lib/axon-native';
import { GoogleAgentWorker, type GoogleAction, type GoogleExecutionPolicy } from '../lib/google-agent-worker';
import { AxonModal } from './AxonPrimitives';
import '../styles/google-agent.css';

interface WorkspaceAccount { name: string | null; state: 'checking' | 'not-connected' | 'authorized' | 'needs-consent' | 'unavailable' }
export interface AgentModeChat { id: string; agentMode?: boolean; agentContextConsent?: boolean; executionPolicy?: GoogleExecutionPolicy; whatsappMode?: boolean; whatsappContextConsent?: boolean; whatsappExecutionPolicy?: GoogleExecutionPolicy; whatsappRecipients?: string[]; mcpMode?: boolean; mcpContextConsent?: boolean; mcpConnectionIds?: string[]; messagesMode?: boolean; messagesContextConsent?: boolean; messagesExecutionPolicy?: GoogleExecutionPolicy }
export function useGoogleAgentWorker(ownerId: string | null) {
  const [available, setAvailable] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [account, setAccount] = useState<WorkspaceAccount>({ name: null, state: 'checking' });
  const refreshAccount = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!ownerId) { setAvailable(false); setError(''); setAccount({ name: null, state: 'not-connected' }); return; }
    let active = true, timer: number | undefined, lastAccountCheck = 0;
    const checkAccount = async () => {
      lastAccountCheck = Date.now();
      try {
        const status = await nativeRequest('googleWorkspaceStatus', { scope: ownerId });
        if (active) { const name = typeof status.accountName === 'string' && status.accountName ? status.accountName : null; setAccount({ name, state: !name ? 'not-connected' : status.needsReconnect || !status.connectors?.length || !status.connectors.every((item: { authorized?: boolean }) => item.authorized) ? 'needs-consent' : 'authorized' }); }
      } catch { if (active) setAccount({ name: null, state: 'unavailable' }); }
    };
    refreshAccount.current = checkAccount;
    const worker = new GoogleAgentWorker(ownerId, {
      owner: async () => (await api<{ user: { id: string } | null }>('/auth/me')).user?.id ?? null,
      pending: async () => (await api<{ actions: GoogleAction[] }>('/local/agent-actions/pending')).actions,
      claim: async id => (await api<{ action: GoogleAction }>(`/local/agent-actions/${id}/claim`, 'POST')).action,
      execute: action => nativeRequest(action.executor === 'native-messages' ? 'executeMessagesAction' : 'executeGoogleAction', { operation: action.operation, args: action.args, requestId: action.id, expectedOwner: action.ownerId }),
      complete: (id, receipt) => api(`/local/agent-actions/${id}/complete`, 'POST', receipt),
    });
    const poll = async () => {
      try { await worker.tick(); if (active && Date.now() - lastAccountCheck > 10000) await checkAccount(); if (active) { setError(''); setRevision(value => value + 1); } }
      catch (cause) { if (active) setError(`Action processing paused: ${errorText(cause)} Any returned receipt will be saved before another action is claimed.`); }
      finally { if (active) timer = window.setTimeout(poll, 1500); }
    };
    setAvailable(false); setError(''); setAccount({ name: null, state: 'checking' });
    void Promise.allSettled([nativeRequest('googleActionCatalog', { scope: ownerId }), nativeRequest('messagesStatus', { scope: ownerId })]).then(results => {
      const result = results[0].status === 'fulfilled' ? results[0].value : null;
      if (!active) return;
      if (!result && results[1].status === 'rejected') throw new Error('Native action support is unavailable in this build.');
      setAvailable(!!result); void checkAccount(); void poll();
    }).catch(() => { if (active) { setAvailable(false); setAccount({ name: null, state: 'unavailable' }); } });
    return () => { active = false; worker.stop(); window.clearTimeout(timer); };
  }, [ownerId]);
  return { available, error, revision, account, refreshAccount: () => refreshAccount.current() };
}

function WorkspaceAccountLine({ account }: { account: WorkspaceAccount }) {
  return <p className="axon-workspace-account"><strong>Current Workspace account: </strong>{account.name || (account.state === 'checking' ? 'Checking…' : account.state === 'not-connected' ? 'Not connected' : 'Status unavailable')}{account.state === 'needs-consent' && <small>Renew Google action permissions in Settings → Connectors.</small>}{account.state === 'not-connected' && <small>Connect your intended Google account in Settings → Connectors before requesting actions.</small>}{account.state === 'authorized' && <small>Account authorized. Each service’s successful access check is separate.</small>}</p>;
}

export function GoogleAgentMode({ chat, ownerId, model, account, onRefreshAccount, available, disabled, workerError, activityHint, onActivity, onChange, onCreate, onSetup, onPause }: {
  chat?: AgentModeChat; ownerId: string; model?: string; account: WorkspaceAccount; onRefreshAccount: () => Promise<void>; available: boolean; disabled: boolean; workerError: string; activityHint: string; onActivity: () => void;
  onChange: (chat: AgentModeChat) => void; onCreate: () => Promise<AgentModeChat | null>; onSetup: () => void; onPause: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [consent, setConsent] = useState(false), [policy, setPolicy] = useState<GoogleExecutionPolicy>('review-writes');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setOpen(false); setError(''); }, [chat?.id, ownerId]);
  async function save(enabled: boolean) {
    setSaving(true); setError('');
    try {
      if (!enabled) await onPause();
      const current = chat ?? await onCreate();
      if (!current) return;
      const result = await api<{ chat: AgentModeChat }>(`/local/chats/${current.id}/agent-mode`, 'PATCH', { enabled, contextConsent: enabled && consent, executionPolicy: policy });
      if (active.current) { onChange(result.chat); setOpen(false); }
    } catch (cause) { if (active.current) setError(errorText(cause)); }
    finally { if (active.current) setSaving(false); }
  }
  return <div className="axon-agent-mode">
    <div className="axon-agent-mode-row"><span><strong>{chat?.agentMode ? 'Google agent mode' : 'Google actions off'}</strong><small>{chat?.agentMode ? chat.executionPolicy === 'delegated' ? 'Delegated Google actions · receipts saved' : 'Google reads · review each write' : 'Google actions are off in this conversation'}</small></span>
      {chat?.agentMode && <button disabled={saving} onClick={() => void save(false)}>Pause agent</button>}
      <button disabled={disabled || saving} onClick={() => { setConsent(!!chat?.agentContextConsent); setPolicy(chat?.executionPolicy || 'review-writes'); setError(''); setOpen(true); void onRefreshAccount(); }}>{chat?.agentMode ? 'Permissions' : 'Enable agent mode'}</button>
    </div>
    {activityHint && <button className="axon-agent-activity-link" onClick={onActivity}>{activityHint} · View actions</button>}
    {chat?.agentMode && !available && <p role="status">Keep this conversation open in an updated AxonCROS Mac app to execute queued Google actions.</p>}
    {(error || workerError) && <p className="axon-agent-error" role="alert">{error || workerError}</p>}
    {open && <AxonModal title="Google agent permissions" onClose={() => { if (!saving) setOpen(false); }} error={error}>
      <WorkspaceAccountLine account={account} />
      <p>This conversation can use your authorized Gmail, Calendar, Drive, Sheets and Contacts. Nothing is enabled in other conversations.</p>
      <label className="axon-agent-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>I allow Google content retrieved for my requests to be stored in this local conversation and sent to its configured model{model ? ` (${model})` : ''}. If the model uses ChatGPT or another remote provider, that content leaves this Mac.</span></label>
      <fieldset className="axon-agent-policy"><legend>How may this assistant act?</legend><label><input type="radio" name="google-policy" checked={policy === 'review-writes'} onChange={() => setPolicy('review-writes')}/><span><strong>Review each write</strong><small>Reads run automatically. Review the exact action and arguments before a send, edit, create or other write.</small></span></label><label><input type="radio" name="google-policy" checked={policy === 'delegated'} onChange={() => setPolicy('delegated')}/><span><strong>Delegate actions in this chat</strong><small>Supported Google reads and writes run automatically to carry out your requests, including messages and changes to provider data. Action receipts remain visible.</small></span></label></fieldset>
      <p>Pause stops new queued work; a request already sent to Google may still finish. Your text-mode draft is preserved separately.</p>
      {!available && <p className="axon-agent-error">Google action execution needs the updated Mac app. Configure and consent to the Workspace grant first; existing read-only grants need renewed permissions.</p>}
      <div className="axon-actions"><button className="axon-button" disabled={saving} onClick={onSetup}>Google setup</button><button className="axon-button axon-button--primary" disabled={!consent || !available || saving} onClick={() => void save(true)}>{saving ? 'Saving…' : 'Enable these permissions'}</button></div>
    </AxonModal>}
  </div>;
}

const stateLabels: Record<string, string> = { review: 'Needs your review', queued: 'Queued', running: 'Running with provider', succeeded: 'Completed', failed: 'Failed', uncertain: 'Outcome uncertain — check provider', cancelled: 'Cancelled' };
export function GoogleActionActivity({ chatId, revision, enabled, ownerId, account, onActivity }: { chatId: string | null; revision: number; enabled: boolean; ownerId: string; account: WorkspaceAccount; onActivity: (hint: string) => void }) {
  const [actions, setActions] = useState<GoogleAction[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const generation = useRef(0);
  const load = async (version: number) => {
    if (!chatId) return;
    try { const result = await api<{ actions: GoogleAction[] }>(`/local/chats/${chatId}/agent-actions`); if (version === generation.current) { setActions(result.actions); setError(''); const reviews = result.actions.filter(action => action.state === 'review').length; onActivity(reviews ? `${reviews} action${reviews === 1 ? '' : 's'} need review` : result.actions.some(action => action.state === 'running') ? 'Provider action running' : result.actions.some(action => action.state === 'queued') ? 'Provider action queued' : result.actions.some(action => action.state === 'uncertain') ? 'An action has an uncertain outcome' : ''); } }
    catch (cause) { if (version === generation.current) setError(errorText(cause)); }
  };
  useEffect(() => { const version = ++generation.current; setActions([]); setError(''); setBusy(null); onActivity(''); void load(version); const timer = window.setInterval(() => void load(version), 2500); return () => { generation.current++; clearInterval(timer); }; }, [chatId, ownerId]);
  useEffect(() => { if (chatId && enabled) void load(generation.current); }, [revision]);
  async function decide(action: GoogleAction, approved: boolean) {
    const version = generation.current; setBusy(action.id); setError('');
    try { await api(`/local/agent-actions/${action.id}/decision`, 'POST', { approved }); if (version === generation.current) await load(version); }
    catch (cause) { if (version === generation.current) setError(errorText(cause)); }
    finally { if (version === generation.current) setBusy(null); }
  }
  if (!enabled && !actions.length && !error) return null;
  return <section id="google-action-activity" tabIndex={-1} className="axon-google-activity" aria-label="Connected action activity"><details open={actions.some(action => ['review', 'queued', 'running'].includes(action.state))}><summary>Connected actions {actions.length ? `(${actions.length})` : ''}</summary>{actions.some(action => !action.executor || action.executor === 'native-google') && <WorkspaceAccountLine account={account} />}{error && <p className="axon-agent-error" role="alert">{error}<button onClick={() => void load(generation.current)}>Refresh actions</button></p>}{!actions.length && !error && <p>No connected action has been requested in this conversation.</p>}{actions.map(action => <article key={action.id} data-google-action={action.id} data-state={action.state}><div><strong>{action.operation === 'mcp.call' ? `MCP ${String(action.args.connectionId || 'provider')} · ${String(action.args.toolName || 'tool')}` : action.operation}</strong><span className={`axon-google-state is-${action.state}`}>{stateLabels[action.state] || action.state}</span></div><small>{displayDate(action.createdAt)}{action.executor === 'server-whatsapp' ? ' · Direct WhatsApp · acceptance does not confirm delivery' : action.executor === 'server-mcp' ? ' · Remote MCP · provider allowance applies' : action.executor === 'native-messages' ? ' · Apple Messages · acceptance does not confirm delivery' : ' · Google Workspace'}</small><details open={action.state === 'review'}><summary>Exact arguments</summary><pre>{JSON.stringify(action.args, null, 2)}</pre></details>{action.error && <p className="axon-agent-error">{action.error}</p>}{action.result && <details><summary>Saved provider receipt</summary><pre>{JSON.stringify(action.result, null, 2)}</pre></details>}{action.state === 'review' && <div className="axon-actions"><button disabled={!!busy} onClick={() => void decide(action, false)}>Deny action</button><button className="axon-button axon-button--primary" disabled={!!busy || !enabled} onClick={() => void decide(action, true)}>Approve this exact action</button></div>}{action.state === 'uncertain' && <p>No automatic retry. Check the provider before requesting the action again.</p>}</article>)}</details></section>;
}
