import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, FileText, Fingerprint, History, ListTodo, Pencil, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api, displayDate, errorText, uploadFile, type Agent, type WorkspaceRecord } from '../lib/axon';
import { AxonEmpty, AxonModal } from './AxonPrimitives';
import { BotTeamAvatar, BOT_CHARACTERS, type BotCharacter } from './BotTeamAvatar';
import { useBotTeamActivity, type BotActivityToken, type BotTeamState } from './useBotTeamActivity';
interface Memory { id: string; text: string; source: string; version: number; createdAt: number; updatedAt: number }
interface Props { mcpMode?: boolean; messagesMode?: boolean; agentMode?: boolean; executionPolicy?: 'review-writes' | 'delegated'; replyState?: BotTeamState; profileId: string; name: string; ready: boolean; open: boolean; onClose: () => void; onAgent: (agent: Agent) => void; onNavigate: (route: string) => void; onBusyChange?: (busy: boolean) => void }
export function AxonInspector({ mcpMode = false, messagesMode = false, agentMode = false, executionPolicy = 'review-writes', replyState = 'idle', profileId, name, ready, open, onClose, onAgent, onNavigate, onBusyChange }: Props) {
  const taskActivity = useBotTeamActivity(profileId);
  const [pollFailure, setPollFailure] = useState<string | null>(null);
  const [watchedRun, setWatchedRun] = useState<{ id: string; profileId: string; token: BotActivityToken } | null>(null);
  const [tab, setTab] = useState<'tasks' | 'approvals' | 'identity'>('identity');
  const [detail, setDetail] = useState<'soul' | 'memory' | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<WorkspaceRecord[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [editCharacter, setEditCharacter] = useState<BotCharacter | null>(null);
  const [soulEdit, setSoulEdit] = useState<string | null>(null);
  const [memoryForm, setMemoryForm] = useState<{ id?: string; text: string; source: string; version?: number } | null>(null);
  const [memorySearch, setMemorySearch] = useState('');
  const [importText, setImportText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [taskForm, setTaskForm] = useState<Partial<WorkspaceRecord> | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<any | null>(null);
  const [eventDetail, setEventDetail] = useState<any | null>(null);
  const [removeMemory, setRemoveMemory] = useState<Memory | null>(null);
  const runAttempts = useRef(new Map<string, string>());
  const generation = useRef(0);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const prefix = `/local/agents/${encodeURIComponent(profileId)}`;
  useEffect(() => {
    setPollFailure(null); setWatchedRun(null); setAgent(null); setRuns([]); setDetail(null); setEditing(false); setSoulEdit(null); setMemoryForm(null); setImportText(null); setCandidates(null); setTaskForm(null); setSelectedApproval(null); setEventDetail(null); setRemoveMemory(null); setMemorySearch('');
  }, [profileId]);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setError(null);
    void Promise.all([
      api<{ agent: Agent }>(prefix), api<{ records: WorkspaceRecord[] }>(`/local/workspace/tasks?profileId=${encodeURIComponent(profileId)}`),
      api<{ runs: any[] }>(`/local/activity?profileId=${encodeURIComponent(profileId)}`), api<{ approvals: any[] }>(`/local/approvals?profileId=${encodeURIComponent(profileId)}`),
      api<{ memories?: Memory[]; entries?: Memory[] }>(`${prefix}/memory`), api<{ agent: Agent; versions: any[] }>(`${prefix}/soul`),
    ]).then(([identity, scheduled, activity, reviewed, memory, soul]) => {
      if (version !== generation.current) return;
      setAgent(identity.agent); onAgent(identity.agent); setTasks(scheduled.records); setRuns(activity.runs); setApprovals(reviewed.approvals); setMemories(memory.memories ?? memory.entries ?? []); setVersions(soul.versions);
    }).catch(cause => { if (version === generation.current) setError(errorText(cause)); }).finally(() => { if (version === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [profileId, revision]);
  const act = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(null); const version = generation.current;
    try { await action(); if (generation.current === version) setRevision(value => value + 1); }
    catch (cause) { if (generation.current === version) setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const hasRunningTask = watchedRun?.profileId === profileId || (agent?.id === profileId && runs.some(run => (run.state || run.status) === 'running'));
  // Only server-confirmed execution animates work; local policy may still require approval.
  const taskRequest = async <T extends { run?: any }>(executes: boolean, request: () => Promise<T>): Promise<T> => {
    if (executes && hasRunningTask) throw new Error('A task is already running. Check Activity before starting another.');
    const version = generation.current; setPollFailure(null);
    if (!hasRunningTask) taskActivity.reset();
    let token: BotActivityToken | undefined;
    try {
      const result = await request(), state = result.run?.state || result.run?.status;
      if (version !== generation.current) { taskActivity.finish(token); return result; }
      if (state === 'running') {
        token ??= taskActivity.begin('working');
        setWatchedRun({ id: result.run.id, profileId, token });
      } else if (state === 'completed') {
        token = taskActivity.begin('working'); taskActivity.finish(token, true);
      }
      return result;
    } catch (cause) { taskActivity.finish(token); throw cause; }
  };
  useEffect(() => {
    // Resuming an actually running task is truthful; completed historical rows are idle.
    const run = watchedRun?.profileId === profileId ? watchedRun : null;
    const observed = agent?.id === profileId ? runs.find(item => (item.state || item.status) === 'running' && item.id !== pollFailure) : undefined;
    if (!run && observed) { setWatchedRun({ id: observed.id, profileId, token: taskActivity.begin('working') }); return; }
    if (!run) return;
    let active = true; let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{ runs: any[] }>(`/local/activity?profileId=${encodeURIComponent(profileId)}`);
        if (!active) return;
        setRuns(result.runs);
        const latest = result.runs.find(item => item.id === run.id), state = latest?.state || latest?.status;
        if (state === 'running' || state === 'queued') timeout = setTimeout(poll, 1500);
        else { taskActivity.finish(run.token, state === 'completed'); setWatchedRun(null); }
      } catch (cause) {
        if (!active) return;
        taskActivity.finish(run.token); setWatchedRun(null); setPollFailure(run.id);
        setError(`Task status could not be checked. Refresh activity to check its outcome. ${errorText(cause)}`);
      }
    };
    timeout = setTimeout(poll, 500);
    return () => { active = false; clearTimeout(timeout); };
  }, [profileId, watchedRun, pollFailure, runs.some(run => (run.state || run.status) === 'running')]);
  useEffect(() => { setPollFailure(null); }, [revision]);
  useEffect(() => { if (replyState === 'thinking' && taskActivity.state === 'celebrating') taskActivity.reset(); }, [replyState, taskActivity.state, taskActivity.reset]);
  const portraitState: BotTeamState = taskActivity.state === 'working' ? 'working' : replyState === 'thinking' ? 'thinking' : replyState === 'celebrating' ? 'celebrating' : taskActivity.state;
  const saveMemory = () => act(async () => {
    if (!memoryForm?.text.trim()) return;
    await api(memoryForm.id ? `${prefix}/memory/${memoryForm.id}` : `${prefix}/memory`, memoryForm.id ? 'PATCH' : 'POST', memoryForm);
    setMemoryForm(null);
  });
  const saveTask = () => act(async () => {
    if (!taskForm?.title?.trim()) return;
    await api(taskForm.id ? `/local/workspace/tasks/${taskForm.id}` : '/local/workspace/tasks', taskForm.id ? 'PATCH' : 'POST', { ...taskForm, profileId });
    setTaskForm(null);
  });
  const openTask = (task?: WorkspaceRecord) => setTaskForm(task ? { ...task, data: { ...task.data } } : { title: '', body: '', status: 'active', data: { instructions: '', cron: '0 9 * * 1-5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York', enabled: false, requiresApproval: true } });
  return <aside className={`axon-inspector${open ? ' is-open' : ''}`} aria-label="Agent inspector" hidden={!open}>
    <div className="axon-inspector-top"><span>Agent workspace</span><button className="axon-icon" onClick={onClose} aria-label="Close agent inspector"><X size={18} /></button></div>
    <div className="axon-inspector-profile"><BotTeamAvatar name={agent?.name || name} character={agent?.avatarCharacter} src={agent?.avatarUrl} state={portraitState} size={80} /><h2>{agent?.name || name}</h2><span className={`axon-status${ready ? ' is-ready' : ''}`}>{ready ? 'Available · local assistant' : 'Gateway unavailable'}</span></div>
    <div className="axon-inspector-tabs" role="tablist" aria-label="Agent details">{([['tasks', ListTodo, 'Tasks'], ['approvals', ShieldCheck, 'Approvals'], ['identity', Fingerprint, 'Identity']] as const).map(([id, Glyph, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setDetail(null); }}><Glyph size={15} />{label}</button>)}</div>
    <div className="axon-inspector-scroll">
      {error && <div className="axon-alert" role="alert">{error}<button onClick={() => setRevision(v => v + 1)}>Reload records</button></div>}
      {loading ? <p className="axon-muted" role="status">Loading agent records…</p> : <>
        {tab === 'identity' && !detail && <><div className="axon-section-heading"><h3>Identity</h3><button className="axon-icon" aria-label="Edit agent identity" onClick={() => { setEditName(agent?.name || name); setEditAvatar(agent?.avatarUrl ?? null); setEditCharacter(agent?.avatarCharacter ?? null); setEditing(true); }}><Pencil size={16} /></button></div><button className="axon-identity-row" onClick={() => { setEditName(agent?.name || name); setEditAvatar(agent?.avatarUrl ?? null); setEditCharacter(agent?.avatarCharacter ?? null); setEditing(true); }}><strong>{agent?.name || name}</strong><span>Name and appearance</span><ChevronRight size={17} /></button><div className="axon-identity-tiles"><button onClick={() => setDetail('soul')}><Fingerprint size={23} /><strong>Soul</strong><span>Identity and instructions</span><small>View <ChevronRight size={15} /></small></button><button onClick={() => setDetail('memory')}><FileText size={23} /><strong>Memory</strong><span>Saved working context</span><small>{memories.length} entries <ChevronRight size={15} /></small></button></div><h3>Access</h3><p className="axon-help">{agentMode ? executionPolicy === 'delegated' ? 'Google agent mode is enabled for this conversation with delegated actions.' : 'Google agent mode is enabled for this conversation; writes require exact-action review.' : 'Google actions are off in this conversation. Enable agent mode in chat to review its permissions.'} {mcpMode ? 'Zapier/MCP tool access is enabled under this chat’s consent and per-tool permissions. ' : 'MCP actions are off. '}{messagesMode ? 'iMessage sends are enabled under this chat’s separate permission; delivery is not verified. ' : 'iMessage sends are off. '}Authorized connected content can enter the configured model. Borrower loan records and borrower-system access remain excluded.</p><button className="axon-button axon-full" onClick={() => onNavigate('/settings/permissions')}><ShieldCheck size={16} />Manage permissions</button></>}
        {tab === 'identity' && detail === 'soul' && <><button className="axon-back" onClick={() => setDetail(null)}><ArrowLeft size={15} />Identity</button><div className="axon-section-heading"><h3>Soul</h3><button className="axon-icon" aria-label="Edit Soul" onClick={() => setSoulEdit(agent?.soul ?? '')}><Pencil size={16} /></button></div><p className="axon-caption">Version {agent?.soulVersion} · {displayDate(agent?.updatedAt)}</p><p className="axon-help">Instructions for this assistant. The local safety boundary still applies.</p>{soulEdit === null ? <pre className="axon-text-preview">{agent?.soul || 'No additional instructions saved.'}</pre> : <><label className="axon-field">Instructions<textarea aria-label="Instructions" rows={12} value={soulEdit} onChange={e => setSoulEdit(e.target.value)} /></label><div className="axon-actions"><button className="axon-button" disabled={busy} onClick={() => setSoulEdit(null)}>Cancel</button><button className="axon-button axon-button--primary" disabled={busy} onClick={() => void act(async () => { const result = await api<{ agent: Agent }>(`${prefix}/soul`, 'PUT', { soul: soulEdit, version: agent?.soulVersion }); setAgent(result.agent); onAgent(result.agent); setSoulEdit(null); })}>Save instructions</button></div></>}<details className="axon-history"><summary><History size={15} />Previous versions ({versions?.length ?? 0})</summary>{versions?.map((version, i) => <details key={version.version ?? i}><summary>Version {version.version ?? version.soulVersion} · {displayDate(version.createdAt ?? version.updatedAt)}</summary><pre className="axon-text-preview">{version.soul ?? version.text}</pre></details>)}</details></>}
        {tab === 'identity' && detail === 'memory' && <><button className="axon-back" onClick={() => setDetail(null)}><ArrowLeft size={15} />Identity</button><div className="axon-section-heading"><h3>Memory</h3><button className="axon-icon" aria-label="Add memory" onClick={() => setMemoryForm({ text: '', source: 'Owner note' })}><Plus size={17} /></button></div><input className="axon-input" aria-label="Search agent memory" placeholder="Search saved context" value={memorySearch} onChange={e => setMemorySearch(e.target.value)} /><button className="axon-button axon-full" onClick={() => { setImportText(''); setCandidates(null); }}>Review an import</button>{memories.filter(m => `${m.text} ${m.source}`.toLowerCase().includes(memorySearch.toLowerCase())).map(memory => <article className="axon-memory" key={memory.id}><p>{memory.text}</p><small>{memory.source || 'Owner note'} · v{memory.version}<br />{displayDate(memory.updatedAt)}</small><div className="axon-actions"><button onClick={() => setMemoryForm(memory)}>Edit</button><button onClick={() => setRemoveMemory(memory)}>Remove</button></div></article>)}{!memories.length && <AxonEmpty title="No saved memories">Add a reviewed note or import selected context. Other assistants’ memories are not read automatically.</AxonEmpty>}</>}
        {tab === 'tasks' && <><div className="axon-section-heading"><h3>Scheduled tasks <span>{tasks.length}</span></h3><button className="axon-icon" aria-label="Create scheduled task" onClick={() => openTask()}><Plus size={17} /></button></div>{tasks.map(task => <button key={task.id} className="axon-record-row" onClick={() => openTask(task)}><Clock3 size={18} /><span><strong>{task.title}</strong><small>{task.data?.enabled ? task.data?.nextRun ? `Next: ${displayDate(task.data.nextRun)}` : 'Enabled · schedule pending' : 'Paused'}<br />{task.data?.cron || 'Manual only'} · {task.data?.timezone || 'Timezone not set'}</small></span><ChevronRight size={15} /></button>)}{!tasks.length && <AxonEmpty title="No scheduled tasks">Create a local draft task. Runs requiring review wait for an approval.</AxonEmpty>}<div className="axon-section-heading"><h3>Activity</h3><button className="axon-icon" aria-label="Refresh activity" onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} /></button></div>{runs.map(run => <button className="axon-record-row" key={run.id} onClick={() => setEventDetail(run)}><span className={`axon-run-dot axon-run-dot--${run.state || run.status}`} /><span><strong>{run.title || run.taskTitle || run.payload?.title || 'Task run'}</strong><small>{run.status || run.state} · {displayDate(run.createdAt ?? run.startedAt)}</small></span></button>)}{!runs.length && <p className="axon-help">No recorded executions for this assistant.</p>}</>}
        {tab === 'approvals' && <><h3>Approval history</h3><p className="axon-help">Each decision applies to its reviewed payload only.</p>{approvals.map(approval => <button className="axon-record-row" key={approval.id} onClick={() => setSelectedApproval(approval)}><ShieldCheck size={19} /><span><strong>{approval.title || approval.action || approval.payload?.title || 'Review task execution'}</strong><small>{approval.state || approval.status || approval.decision || 'pending'} · {displayDate(approval.decidedAt ?? approval.createdAt)}</small></span><ChevronRight size={15} /></button>)}{!approvals.length && <AxonEmpty title="Nothing awaiting review">No approval records for this assistant. External tools remain disconnected.</AxonEmpty>}</>}
      </>}
    </div>
    {editing && <AxonModal error={error} title="Edit agent identity" onClose={() => { if (!busy) setEditing(false); }}><label className="axon-field">Name<input value={editName} maxLength={80} onChange={e => setEditName(e.target.value)} /></label><BotTeamAvatar name={editName || name} character={editCharacter} src={editAvatar} size={80} /><fieldset className="bot-team-picker"><legend>Avatar character</legend><div className="bot-team-options">{BOT_CHARACTERS.map(character => <button key={character} type="button" disabled={busy} aria-label={`Use ${character} avatar`} aria-pressed={!editAvatar && editCharacter === character} onClick={() => { setEditCharacter(character); setEditAvatar(null); }}><BotTeamAvatar name={character} character={character} size={56} /><span>{character}</span></button>)}<button type="button" disabled={busy} aria-pressed={!editAvatar && !editCharacter} onClick={() => { setEditCharacter(null); setEditAvatar(null); }}><BotTeamAvatar name={editName || name} size={56} /><span>Use initials</span></button></div><p className="axon-help">Appearance only. Your assistant’s name, role and saved knowledge stay the same.</p></fieldset><label className="axon-field">Avatar image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void act(async () => { const uploaded = await uploadFile(file, { profileId }); setEditAvatar(`/api/local/files/${uploaded.id}/content`); }); }} /></label><div className="axon-actions"><button className="axon-button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button className="axon-button axon-button--primary" disabled={busy || !editName.trim()} onClick={() => void act(async () => { const result = await api<{ agent: Agent }>(prefix, 'PATCH', { name: editName.trim(), avatarUrl: editAvatar || '', avatarCharacter: editCharacter, version: agent?.version }); setAgent(result.agent); onAgent(result.agent); setEditing(false); })}>Save identity</button></div></AxonModal>}
    {memoryForm && <AxonModal error={error} title={memoryForm.id ? 'Edit memory' : 'Add memory'} onClose={() => { if (!busy) setMemoryForm(null); }}><label className="axon-field">Reviewed knowledge<textarea rows={7} value={memoryForm.text} onChange={e => setMemoryForm({ ...memoryForm, text: e.target.value })} /></label><label className="axon-field">Source / provenance<input value={memoryForm.source} onChange={e => setMemoryForm({ ...memoryForm, source: e.target.value })} /></label><div className="axon-actions"><button className="axon-button" disabled={busy} onClick={() => setMemoryForm(null)}>Cancel</button><button className="axon-button axon-button--primary" disabled={busy || !memoryForm.text.trim()} onClick={() => void saveMemory()}>Save memory</button></div></AxonModal>}
    {removeMemory && <AxonModal error={error} title="Remove this memory?" onClose={() => { if (!busy) setRemoveMemory(null); }}><p>This removes the saved entry for {agent?.name || name}. Conversation history is retained.</p><p className="axon-text-preview">{removeMemory.text}</p><div className="axon-actions"><button className="axon-button" disabled={busy} onClick={() => setRemoveMemory(null)}>Keep memory</button><button className="axon-button axon-button--danger" disabled={busy} onClick={() => void act(async () => { await api(`${prefix}/memory/${removeMemory.id}`, 'DELETE', { version: removeMemory.version }); setRemoveMemory(null); })}>Remove</button></div></AxonModal>}
    {importText !== null && <AxonModal error={error} title="Review memory import" onClose={() => { if (!busy) { setImportText(null); setCandidates(null); } }}><p className="axon-help">Paste exported or written knowledge. Review every selected entry; imported text cannot authorize actions.</p>{!candidates ? <><label className="axon-field">Import text<textarea rows={9} value={importText} onChange={e => setImportText(e.target.value)} /></label><button className="axon-button axon-button--primary" disabled={busy || !importText.trim()} onClick={() => void act(async () => { const result = await api<{ candidates: any[] }>(`${prefix}/memory/import/preview`, 'POST', { text: importText }); setCandidates(result.candidates); setSelectedCandidates(new Set(result.candidates.map((_, i) => i).filter(i => !result.candidates[i].duplicate))); })}>Preview entries</button></> : <><p>{candidates.length} candidate entries. Existing duplicates are unselected.</p>{candidates.map((item, i) => <label className="axon-import-entry" key={i}><input type="checkbox" checked={selectedCandidates.has(i)} disabled={!!item.duplicate} onChange={e => setSelectedCandidates(previous => { const next = new Set(previous); e.target.checked ? next.add(i) : next.delete(i); return next; })} /><span>{item.text}<small>{item.duplicate ? 'Already saved' : item.source || 'Reviewed import'}</small></span></label>)}<div className="axon-actions"><button className="axon-button" onClick={() => setCandidates(null)} disabled={busy}>Back</button><button className="axon-button axon-button--primary" disabled={busy || !selectedCandidates.size} onClick={() => void act(async () => { await api(`${prefix}/memory/import`, 'POST', { entries: candidates.filter((_, i) => selectedCandidates.has(i)).map(item => ({ text: item.text, source: item.source || 'Reviewed import' })) }); setImportText(null); setCandidates(null); })}>Save {selectedCandidates.size} selected</button></div></>}</AxonModal>}
    {taskForm && <AxonModal error={error} title={taskForm.id ? 'Scheduled task' : 'Create a task'} onClose={() => { if (!busy) setTaskForm(null); }}><label className="axon-field">Title<input value={taskForm.title || ''} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} /></label><label className="axon-field">Instructions<textarea rows={5} value={taskForm.data?.instructions || ''} onChange={e => setTaskForm({ ...taskForm, data: { ...taskForm.data, instructions: e.target.value } })} /></label><label className="axon-field">Schedule (five-field cron; paused tasks run manually)<input placeholder="0 9 * * 1-5" value={taskForm.data?.cron || ''} onChange={e => setTaskForm({ ...taskForm, data: { ...taskForm.data, cron: e.target.value } })} /></label><label className="axon-field">Timezone<input value={taskForm.data?.timezone || ''} onChange={e => setTaskForm({ ...taskForm, data: { ...taskForm.data, timezone: e.target.value } })} /></label><label className="axon-check"><input type="checkbox" checked={!!taskForm.data?.enabled} onChange={e => setTaskForm({ ...taskForm, data: { ...taskForm.data, enabled: e.target.checked } })} />Schedule enabled</label><label className="axon-check"><input type="checkbox" checked={taskForm.data?.requiresApproval !== false} onChange={e => setTaskForm({ ...taskForm, data: { ...taskForm.data, requiresApproval: e.target.checked } })} />Review approval before a run</label><p className="axon-help">Local drafts only. This does not enable connected tools or external actions.</p>{hasRunningTask && <p className="axon-help" role="status">A task is running. Check Activity before starting another.</p>}<div className="axon-actions">{taskForm.id && <button className="axon-button" disabled={busy || hasRunningTask} onClick={() => void act(async () => { const attemptKey = `${taskForm.id}:${taskForm.version}`; const requestId = runAttempts.current.get(attemptKey) || crypto.randomUUID(); runAttempts.current.set(attemptKey, requestId); const result = await taskRequest(tasks.find(task => task.id === taskForm.id)?.data?.requiresApproval === false, () => api<{ run: any; approval?: any }>(`/local/workspace/tasks/${taskForm.id}/run`, 'POST', { requestId })); runAttempts.current.delete(attemptKey); setTaskForm(null); if (result.approval) { setTab('approvals'); setSelectedApproval(result.approval); } else setEventDetail(result.run); })}>Run saved task</button>}<button className="axon-button" disabled={busy} onClick={() => setTaskForm(null)}>Cancel</button><button className="axon-button axon-button--primary" disabled={busy || !taskForm.title?.trim()} onClick={() => void saveTask()}>Save task</button></div>{taskForm.id && <details className="axon-history"><summary>Run history</summary>{runs.filter(run => run.taskId === taskForm.id || run.task_id === taskForm.id).map(run => <button key={run.id} className="axon-record-row" onClick={() => setEventDetail(run)}>{run.status || run.state} · {displayDate(run.createdAt)}</button>)}</details>}</AxonModal>}
    {selectedApproval && <AxonModal error={error} title="Review action" onClose={() => { if (!busy) setSelectedApproval(null); }}><h3>{selectedApproval.title || selectedApproval.action || selectedApproval.payload?.title || 'Task execution'}</h3><p>Status: {selectedApproval.state || selectedApproval.status || selectedApproval.decision || 'pending'}</p><p className="axon-help">Review the exact payload below. An approval covers this action only.</p><pre className="axon-text-preview">{JSON.stringify(selectedApproval.payload ?? selectedApproval, null, 2)}</pre><p className="axon-caption">Created {displayDate(selectedApproval.createdAt)} · Decision {displayDate(selectedApproval.decidedAt)}</p>{['pending', 'awaiting_approval'].includes(selectedApproval.state || selectedApproval.status || selectedApproval.decision || 'pending') && <div className="axon-actions">{(['denied', 'allowed'] as const).map(decision => <button className={`axon-button${decision === 'allowed' ? ' axon-button--primary' : ''}`} disabled={busy || (decision === 'allowed' && hasRunningTask)} key={decision} onClick={() => void act(async () => { const result = await taskRequest(decision === 'allowed', () => api<{ approval: any; run?: any }>(`/local/approvals/${selectedApproval.id}/decision`, 'POST', { decision })); setSelectedApproval(result.approval); })}>{decision === 'allowed' ? 'Allow this action' : 'Deny'}</button>)}</div>}</AxonModal>}
    {eventDetail && <AxonModal error={error} title="Activity detail" onClose={() => setEventDetail(null)}><h3>{eventDetail.title || eventDetail.taskTitle || eventDetail.payload?.title || 'Task run'}</h3><p>{eventDetail.status || eventDetail.state} · {displayDate(eventDetail.createdAt ?? eventDetail.startedAt)}</p><pre className="axon-text-preview">{JSON.stringify(eventDetail, null, 2)}</pre></AxonModal>}
  </aside>;
}
