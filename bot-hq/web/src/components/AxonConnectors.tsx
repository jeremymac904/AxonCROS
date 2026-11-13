import { useEffect, useRef, useState } from 'react';
import { Check, Folder, Mail, MessageCircle, Monitor, Music2, RefreshCw, Search, Wallet, Users } from 'lucide-react';
import { api, displayDate, errorText } from '../lib/axon';
import { nativeRequest } from '../lib/axon-native';
import { AxonEmpty, AxonModal } from './AxonPrimitives';
import { AxonMcpConnectors } from './AxonMcpConnectors';
const catalog = [
  { id: 'plaid', name: 'Finances (Plaid)', description: 'Existing sandbox account metadata. Production and paid operations are blocked.', category: 'Featured', icon: Wallet },
  { id: 'spotify', name: 'Spotify', description: 'Read your profile and saved library with an existing eligible developer app.', category: 'Featured', icon: Music2 },
  { id: 'withings', name: 'Withings', description: 'Read-only wellness data with an existing account token.', category: 'Featured', icon: Check },
  { id: 'gmail', name: 'Gmail', description: 'Agentic mail search, reading, drafts, sending and supported message changes.', category: 'Productivity', icon: Mail },
  { id: 'google-calendar', name: 'Google Calendar', description: 'Read, create and update calendar events through authorized agent actions.', category: 'Productivity', icon: Monitor },
  { id: 'google-drive', name: 'Google Drive', description: 'Find and read files; create and change supported Drive content with agent permission.', category: 'Productivity', icon: Folder },
  { id: 'google-sheets', name: 'Google Sheets', description: 'Read and write spreadsheet content through bounded Google agent actions.', category: 'Productivity', icon: Monitor },
  { id: 'google-contacts', name: 'Google Contacts', description: 'Find, create and update contacts through the unified Google agent grant.', category: 'Productivity', icon: Users },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Phone metadata check with an existing business account. For supported messaging actions, use WhatsApp actions via Zapier MCP below.', category: 'Productivity', icon: MessageCircle },
];
const google = (id: string) => ['gmail', 'google-calendar', 'google-drive', 'google-sheets', 'google-contacts'].includes(id);
type Connector = { id: string; status?: string; connected?: boolean; authorized?: boolean; configured?: boolean; dependency?: string; notice?: string; lastCheckedAt?: number | null; capabilities?: unknown; transport?: string };
export function AxonConnectors({ native, scope }: { native: any; scope: string }) {
  const [records, setRecords] = useState<Connector[]>([]), [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [zapierRequest, setZapierRequest] = useState(0);
  const [query, setQuery] = useState(''), [tab, setTab] = useState('available'), [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(''), [preview, setPreview] = useState<any>(null), [clientId, setClientId] = useState(''), [consent, setConsent] = useState<any>(null);
  const [sheetId, setSheetId] = useState(''), [range, setRange] = useState('A1:D5'), [limit, setLimit] = useState(3);
  const mounted = useRef(true);
  const generation = useRef(0), currentScope = useRef(scope); currentScope.current = scope;
  async function load() {
    if (!mounted.current) return;
    const version = ++generation.current; setLoading(true); setError('');
    const results = await Promise.allSettled([api<{ connectors: Connector[] }>('/local/connectors'), native?.googleWorkspace ? nativeRequest('googleWorkspaceStatus', { scope }) : Promise.resolve(null)]);
    if (version !== generation.current) return;
    if (results[0].status === 'fulfilled') setRecords(results[0].value.connectors || []); else { setRecords([]); setError(errorText(results[0].reason)); }
    if (results[1].status === 'fulfilled') setWorkspace(results[1].value); else { const reason = results[1].reason; setWorkspace(null); setError(previous => [previous, errorText(reason)].filter(Boolean).join(' ')); }
    setLoading(false);
  }
  useEffect(() => { mounted.current = true; setRecords([]); setWorkspace(null); setPreview(null); setConsent(null); setDetail(null); void load(); return () => { mounted.current = false; generation.current++; }; }, [scope, native?.googleWorkspace]);
  function effective(id: string): Connector {
    const stored = records.find(item => item.id === id) || { id, status: 'not-configured', connected: false };
    if (!google(id)) return stored;
    const found = workspace?.connectors?.find((item: Connector) => item.id === id);
    return found ? { ...stored, ...found, configured: workspace.configured, dependency: found.dependency || workspace.notice } : { ...stored, status: native?.googleWorkspace ? 'not-configured' : 'blocked', connected: false, dependency: native?.googleWorkspace ? stored.dependency : 'Google Workspace requires the installed AxonCROS Mac app. A browser cannot use its Keychain or native consent.' };
  }
  function label(row: Connector) { return ['error','needs-attention'].includes(row.status || '') ? 'Needs attention' : row.connected ? 'Connected · checked' : row.authorized ? 'Authorized · check access' : row.configured ? 'Configured · check access' : row.status === 'blocked' ? 'Setup required' : 'Not configured'; }
  async function perform(action: string, operation: () => Promise<any>) {
    if (busy) return; const owner = scope; setBusy(action); setError(''); setMessage(''); setPreview(null);
    try {
      const result = await operation(); if (!mounted.current || currentScope.current !== owner) return;
      if (result?.cancelled) { setMessage('Cancelled. No connection changed.'); return; }
      if (result?.authorizationUrl) { const url = new URL(result.authorizationUrl); if (url.origin !== 'https://accounts.spotify.com' || url.pathname !== '/authorize') throw new Error('Unexpected authorization URL.'); setConsent(result); setMessage('Register the redirect URI below in your existing app, then open Spotify consent.'); }
      else if (action === 'read') { setPreview(google(detail || '') ? { ...result.result, items: result.items } : result.result); setMessage('Read completed. Nothing was sent to a model or written to the provider.'); }
      else setMessage(action === 'check' ? 'Access check completed.' : 'Local setup updated.');
      await load();
    } catch (cause) { if (mounted.current && currentScope.current === owner) { await load(); if (mounted.current && currentScope.current === owner) setError(errorText(cause)); } }
    finally { if (mounted.current && currentScope.current === owner) setBusy(''); }
  }
  const chosen = catalog.find(item => item.id === detail), row = detail ? effective(detail) : null;
  const connected = catalog.filter(item => effective(item.id).connected);
  const nativeGoogle = !!native?.googleWorkspace, nativeCredentials = !!native?.connectorCredentialPicker;
  const options = { scope, provider: detail, limit, ...(detail === 'google-sheets' ? { spreadsheetId: sheetId.trim(), range: range.trim() } : {}) };
  const check = () => perform('check', () => google(detail!) ? nativeRequest('checkGoogleWorkspace', options) : api(`/local/connectors/${detail}/check`, 'POST', { limit }));
  const read = () => perform('read', () => google(detail!) ? nativeRequest('readGoogleWorkspace', options) : api(`/local/connectors/${detail}/read`, 'POST', { limit }));
  return <>
    <p className="ax-notice">Google can act for you in conversations where you enable agent mode: choose review-before-write or delegated actions. This setup page only runs explicit read checks. Other connectors retain their listed limits; no account creation or purchase is enabled.</p>
    {!detail && error && <div className="ax-error" role="alert">{error}</div>}
    <div className="ax-toolbar"><label className="ax-search"><Search size={19}/><input aria-label="Search connectors" placeholder="Search connectors" value={query} onChange={event => setQuery(event.target.value)}/></label><button disabled={!!busy || loading} onClick={() => void load()}><RefreshCw size={16}/>Refresh status</button></div>
    <div className="ax-segment"><button className={tab === 'available' ? 'selected' : ''} onClick={() => setTab('available')}>Available catalog</button><button className={tab === 'connected' ? 'selected' : ''} onClick={() => setTab('connected')}>Connected {connected.length}</button></div>
    {loading && <p role="status">Checking local connector status…</p>}
    {!loading && tab === 'connected' && !connected.length ? <AxonEmpty title="No connected accounts">Configure an existing integration, then explicitly review consent and check access.</AxonEmpty> : ['Featured', 'Productivity'].map(category => <section key={category}><h2 className="ax-section-title">{category}</h2><div className={category === 'Featured' ? 'ax-connector-grid' : 'ax-connector-list'}>{catalog.filter(item => item.category === category && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()) && (tab !== 'connected' || effective(item.id).connected)).map(item => <article className="ax-card ax-connector" key={item.id}><span className="ax-tile-icon"><item.icon size={24}/></span><div><h3>{item.name}</h3><p>{item.description}</p></div><span className="ax-tag">{item.id === 'whatsapp' ? 'Phone metadata · ' : ''}{label(effective(item.id))}</span><button className="ax-text-button" onClick={() => { setDetail(item.id); setPreview(null); setError(''); setMessage(''); setConsent(null); }}>{item.id === 'whatsapp' ? 'View phone metadata setup' : 'View setup'}</button>{item.id === 'whatsapp' && <button className="ax-text-button" onClick={() => setZapierRequest(value => value + 1)}>WhatsApp actions via Zapier</button>}</article>)}</div></section>)}
    <AxonMcpConnectors native={native} scope={scope} zapierRequest={zapierRequest} />
    {chosen && row && <AxonModal title={chosen.name} wide onClose={() => { if (!busy) { setDetail(null); setPreview(null); setConsent(null); } }} error={error}>
      <p>{chosen.description}</p>{chosen.id === 'whatsapp' && <button disabled={!!busy} onClick={() => { setDetail(null); setZapierRequest(value => value + 1); }}>WhatsApp actions via Zapier</button>}<p><strong>{label(row)}</strong>{row.lastCheckedAt ? ` · Last checked ${displayDate(row.lastCheckedAt)}` : ''}</p>
      {message && <p className="ax-success" role="status">{message}</p>}{row.dependency && <p className="ax-notice">{row.dependency}</p>}
      {google(chosen.id) ? <>
        <h3>Google Workspace agent consent</h3><p>Use an existing Google Cloud project with Gmail, Calendar, Drive, Sheets and People APIs enabled and an existing Desktop OAuth client JSON. For a testing app, your account must be an allowed test user. Wider distribution may require Google verification; this app does not bypass that review.</p>
        <p>One explicit grant authorizes supported reads and writes across Gmail, Calendar, Drive, Sheets and Contacts. It can read content and send or modify provider data. Existing read-only Workspace grants need renewed consent before agent actions. The legacy Contacts import connection remains separate; enabling this grant does not import your address book.</p>
        <p><a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">Google Desktop OAuth setup</a> · <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">Review enabled APIs</a></p>
        {workspace?.accountName && <p>Workspace account: <strong>{workspace.accountName}</strong></p>}{!nativeGoogle && <p className="ax-notice">Open the Mac app for secure setup. Browser mode cannot access native credentials.</p>}
        <div className="ax-actions"><button disabled={!!busy || !nativeGoogle} onClick={() => void perform('configure', () => nativeRequest('configureGoogleWorkspace', { scope }))}>Choose existing OAuth JSON</button><button className="ax-primary" disabled={!!busy || !nativeGoogle || !workspace?.configured} onClick={() => void perform('connect', () => nativeRequest('connectGoogleWorkspace', { scope }))}>Review Google read/write consent</button>{busy === 'connect' && <button onClick={() => void nativeRequest('cancelGoogleWorkspaceAuth', { scope }).catch(cause => setError(errorText(cause)))}>Cancel authorization</button>}</div>
      </> : chosen.id === 'spotify' ? <>
        <h3>Existing Spotify developer app</h3><p>Use your existing eligible developer account and app. Spotify development mode requires an existing Premium developer owner and allows at most five allowlisted users. This app does not create an account, upgrade a plan or enable playback.</p><label className="axon-field">Public client ID<input value={clientId} autoComplete="off" onChange={event => setClientId(event.target.value)} placeholder="Existing Spotify app client ID"/></label><button disabled={!!busy || !clientId.trim()} onClick={() => void perform('connect', () => api('/local/connectors/spotify/connect', 'POST', { clientId: clientId.trim() }))}>Prepare Spotify consent</button>{consent && <><p>Register this redirect URI without a port in your existing Spotify app:</p><pre className="axon-text-preview">{consent.registeredRedirectUri || 'http://127.0.0.1/callback'}</pre><p><a className="ax-button" href={consent.authorizationUrl} target="_blank" rel="noreferrer">Open Spotify consent in browser</a></p><p>Return and refresh status after consent. Expires {displayDate(consent.expiresAt)}.</p></>}
      </> : <>
        <h3>Import existing credentials securely</h3><p>{chosen.id === 'plaid' ? 'Sandbox only: existing clientId, clientSecret, accessToken and environment: sandbox. Production bank connections and paid endpoints are blocked.' : chosen.id === 'whatsapp' ? 'This direct adapter checks phone metadata using an existing WhatsApp Business Cloud API accessToken and numeric phoneNumberId. Messaging actions use the separate Zapier MCP setup, with an existing supported WhatsApp account/action, per-tool permission and chat consent. This metadata credential alone does not authorize messaging.' : 'Existing Withings accessToken only; no automatic refresh. Under the free app plan, accounts created after October 12, 2026 require an existing Withings+ subscription; older accounts are exempt, with at most ten users before review. Stop if your account needs a purchase. When the token expires, import a refreshed token from your existing integration.'}</p>
        <p>Choose a local JSON file under 32 KB. Secret values go directly from native code to the private encrypted local store, never through chat or this page.</p><button disabled={!!busy || !nativeCredentials} onClick={() => void perform('configure', () => nativeRequest('configureConnectorToken', { scope, provider: chosen.id }))}>Choose existing credential JSON</button>{!nativeCredentials && <p className="ax-notice">Secure credential import requires the installed Mac app.</p>}
      </>}
      <hr/><h3>Explicit read-only test</h3><p>Use a synthetic test account or spreadsheet here. These preview results are cleared when closed and are not added to assistant context. In chat, separately enabling Google agent mode permits retrieved Google content to enter the configured model.</p>
      {chosen.id === 'google-sheets' && <div className="ax-form"><label>Existing spreadsheet ID<input value={sheetId} onChange={event => setSheetId(event.target.value)} placeholder="ID from your synthetic sheet URL"/></label><label>A1 range (at most 100 cells)<input value={range} onChange={event => setRange(event.target.value)}/></label></div>}
      <label className="axon-field">Maximum preview records<select value={limit} onChange={event => setLimit(Number(event.target.value))}>{[1,3,5,10].map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="ax-actions"><button disabled={!!busy || (google(chosen.id) && (!nativeGoogle || !row.authorized)) || (chosen.id === 'google-sheets' && !sheetId.trim())} onClick={() => void check()}>Check read access</button><button disabled={!!busy || (google(chosen.id) && (!nativeGoogle || !row.authorized)) || (chosen.id === 'google-sheets' && !sheetId.trim())} onClick={() => void read()}>Read limited preview</button><button disabled={!!busy} onClick={() => void load()}>Refresh status</button></div>
      {busy && <p role="status">{busy === 'connect' ? 'Waiting for explicit provider consent…' : 'Working on this request…'}</p>}{preview && <section className="ax-card"><h3>Read-only result</h3><pre className="axon-text-preview">{JSON.stringify(preview, null, 2)}</pre><button onClick={() => setPreview(null)}>Clear preview</button></section>}
      {(row.connected || row.configured || (google(chosen.id) && workspace?.connected)) && <div className="ax-actions"><button disabled={!!busy} onClick={() => { if (window.confirm('Disconnect only this app’s local connector credentials? Provider data and other apps stay unchanged.')) void perform('disconnect', () => google(chosen.id) ? nativeRequest('disconnectGoogleWorkspace', { scope }) : api(`/local/connectors/${chosen.id}`, 'DELETE')); }}>Disconnect this app{google(chosen.id) ? '’s Workspace grant' : ''}</button></div>}
    </AxonModal>}
  </>;
}
