import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../lib/axon';
import { nativeRequest } from '../lib/axon-native';
import type { McpConnection } from '../lib/mcp';
import type { AgentModeChat } from './GoogleAgentMode';
import { AxonModal } from './AxonPrimitives';
export function ConnectedAgentModes({ chat, ownerId, profileId, model, disabled, onChange, onCreate, onPause, onSetup }: {
  chat?: AgentModeChat; ownerId: string; profileId: string; model?: string; disabled: boolean;
  onChange: (chat: AgentModeChat) => void; onCreate: () => Promise<AgentModeChat | null>; onPause: () => Promise<void>; onSetup: () => void;
}) {
  const [open, setOpen] = useState<'mcp' | 'messages' | null>(null), [consent, setConsent] = useState(false), [delegated, setDelegated] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [connections, setConnections] = useState<McpConnection[]>([]), [connectionIds, setConnectionIds] = useState<string[]>([]), [messages, setMessages] = useState<any>(null);
  const generation = useRef(0), viewRef = useRef({ ownerId, profileId, chatId: chat?.id }), mounted = useRef(true); viewRef.current = { ownerId, profileId, chatId: chat?.id };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { generation.current++; setOpen(null); setError(''); setBusy(false); setConnections([]); setConnectionIds([]); setMessages(null); return () => { generation.current++; }; }, [ownerId, profileId, chat?.id]);
  async function show(kind: 'mcp' | 'messages') {
    const version = generation.current; setOpen(kind); setError(''); setConsent(kind === 'mcp' ? !!chat?.mcpContextConsent : !!chat?.messagesContextConsent); setDelegated(chat?.messagesExecutionPolicy === 'delegated'); setConnectionIds(chat?.mcpConnectionIds || []); setBusy(true);
    try { if (kind === 'mcp') { const result = await api<{ connections: McpConnection[] }>('/local/mcp/connections'); if (version === generation.current) setConnections(result.connections); } else { const result = await nativeRequest('messagesStatus', { scope: ownerId }); if (version === generation.current) setMessages(result); } }
    catch (cause) { if (version === generation.current) setError(errorText(cause)); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function save(kind: 'mcp' | 'messages', enabled: boolean) {
    const origin = { ownerId, profileId, chatId: chat?.id }, version = generation.current;
    let targetId = chat?.id, created = false;
    const currentView = () => mounted.current && viewRef.current.ownerId === origin.ownerId && viewRef.current.profileId === origin.profileId && (created ? viewRef.current.chatId === targetId || viewRef.current.chatId === undefined && generation.current === version : generation.current === version && viewRef.current.chatId === origin.chatId);
    setBusy(true); setError('');
    try {
      if (!enabled) { await onPause(); if (!currentView()) return; if (kind === 'messages') await nativeRequest('cancelMessagesActions').catch(() => {}); }
      if (!currentView()) return;
      const current = chat ?? await onCreate(); if (!current) return;
      if (!chat) { targetId = current.id; created = true; }
      if (!currentView()) return;
      const result = await api<{ chat: AgentModeChat }>(`/local/chats/${current.id}/${kind}-mode`, 'PATCH', { enabled, contextConsent: enabled && consent, ...(kind === 'messages' ? { executionPolicy: delegated ? 'delegated' : 'review-writes' } : { connectionIds: enabled ? connectionIds : [] }) });
      if (currentView()) { onChange(result.chat); setOpen(null); }
    } catch (cause) { if (currentView()) setError(errorText(cause)); }
    finally { if (currentView()) setBusy(false); }
  }
  const ready = open === 'mcp' ? connectionIds.length > 0 && connectionIds.every(id => connections.some(connection => connection.id === id && connection.quotaConfirmed && connection.tools.some(tool => !tool.blocked && tool.policy !== 'disabled'))) : messages?.permission === 'authorized';
  return <div className="axon-agent-mode axon-mcp-mode">
    <div className="axon-agent-mode-row"><span><strong>MCP app actions</strong><small>{chat?.mcpMode ? 'Enabled in this chat · per-tool permissions apply' : 'Off · separate from Google permissions'}</small></span>{chat?.mcpMode && <button disabled={busy} onClick={() => void save('mcp', false)}>Pause MCP</button>}<button disabled={busy || disabled} onClick={() => void show('mcp')}>{chat?.mcpMode ? 'MCP permissions' : 'Enable MCP'}</button></div>
    <div className="axon-agent-mode-row"><span><strong>iMessage on this Mac</strong><small>{chat?.messagesMode ? chat.messagesExecutionPolicy === 'delegated' ? 'Delegated sends · delivery not verified' : 'Review each send · delivery not verified' : 'Off · no incoming-message sync'}</small></span>{chat?.messagesMode && <button disabled={busy} onClick={() => void save('messages', false)}>Pause iMessage</button>}<button disabled={busy || disabled} onClick={() => void show('messages')}>{chat?.messagesMode ? 'iMessage permissions' : 'Enable iMessage'}</button></div>
    {!open && error && <p role="alert" className="axon-agent-error">{error}</p>}
    {open && <AxonModal title={open === 'mcp' ? 'MCP permissions for this chat' : 'iMessage permissions for this chat'} onClose={() => { if (!busy) setOpen(null); }} error={error}>
      {open === 'mcp' ? <><p>Only explicitly permitted tools from the connections selected below can run. Review tools ask for exact-action approval; delegated tools can read, write or send according to their schemas.</p><fieldset className="axon-agent-policy"><legend>Connections allowed in this conversation</legend>{connections.map(connection => <label key={connection.id}><input type="checkbox" checked={connectionIds.includes(connection.id)} disabled={!connection.configured} onChange={event => setConnectionIds(ids => event.target.checked ? [...ids, connection.id] : ids.filter(id => id !== connection.id))}/><span><strong>{connection.name}</strong><small>{!connection.configured ? 'Not configured' : connection.quotaConfirmed ? 'Existing allowance acknowledgment saved' : 'App calls blocked until allowance confirmation'}</small></span></label>)}</fieldset>{!connections.length && <p>No configured MCP connections.</p>}<p>Zapier app actions consume tasks. Direct Buffer calls do not consume Zapier tasks; existing Buffer plan limits still apply. No automatic test calls run here. Manage schemas, blocked tools and no-overage confirmation in connector settings.</p></> : <><p>Send through the existing iMessage account signed into Apple Messages on this Mac. No incoming messages or history are read. Accepting a request in Messages is not proof of delivery.</p><p>Mac permission: <strong>{messages?.permission || 'Unavailable'}</strong></p>{messages?.notice && <p>{messages.notice}</p>}<button disabled={busy} onClick={async () => { const version = generation.current; setBusy(true); setError(''); try { const result = await nativeRequest('reviewMessagesPermission', { scope: ownerId }); if (version === generation.current) setMessages(result); } catch (cause) { if (version === generation.current) setError(errorText(cause)); } finally { if (version === generation.current) setBusy(false); } }}>Review Mac Messages permission</button><p>Sign in to your intended existing account in Apple Messages first. This app does not create or connect a new account.</p></>}
      <label className="axon-agent-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>{open === 'mcp' ? 'I allow content returned by permitted tools from the selected MCP connections to be saved in this local conversation and sent to its configured model' : 'I allow this conversation to prepare and send my requested iMessages, including recipient and message content in its configured model'}{model ? ` (${model})` : ''}. With ChatGPT or another remote model, that content leaves this Mac. This permission applies only to this chat.</span></label>
      {open === 'messages' && <fieldset className="axon-agent-policy"><legend>Send permission</legend><label><input type="radio" checked={!delegated} onChange={() => setDelegated(false)}/><span>Review each exact message and recipient</span></label><label><input type="radio" checked={delegated} onChange={() => setDelegated(true)}/><span>Delegate sends explicitly requested in this chat</span></label></fieldset>}
      <p>Pause stops queued work. A request already dispatched may still finish; uncertain outcomes are never automatically retried. Drafts are preserved separately when chat permissions change.</p>
      <div className="axon-actions">{open === 'mcp' && <button onClick={onSetup} disabled={busy}>Connector setup</button>}<button className="axon-button axon-button--primary" disabled={busy || !consent || !ready} onClick={() => void save(open, true)}>Enable for this chat</button></div>{busy && <p role="status">Checking or saving permissions…</p>}
    </AxonModal>}
  </div>;
}
